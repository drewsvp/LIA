/**
 * ADMIN-09 — invite a new staff member.
 *
 * One transaction: person (resolved by lower(email), never duplicated),
 * user at 'invited' if none exists, membership at 'active' (staff are
 * pre-approved by the inviting admin — no separate approval queue), and
 * the staff_invited email to the invitee.
 *
 * Each invitation (fresh or re-invite) uses a fresh UUID as the email
 * entity_id so the once-only log index never blocks a new send — even if
 * the previous invitation was successfully delivered. The real membershipId
 * is stored as an extra (non-rendered) var in the payload so the resend
 * rebuilder can look up the current member name and role.
 */
import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { SYSTEM, withDbContext, q } from "../db/client";
import type { OrgMembership } from "../../shared/types";
import * as people from "../dal/people";
import * as users from "../dal/users";
import * as memberships from "../dal/memberships";
import { insertInTx } from "../dal/approval-events";
import { queueProductEmailInTx, pushDispatch, absoluteUrl, type PendingDispatch } from "../email/send";

/** An active or pending platform_owner membership already covers this person. */
export class DuplicateStaffMembershipError extends Error {
  constructor() {
    super("email already has an active or pending platform_owner staff membership");
    this.name = "DuplicateStaffMembershipError";
  }
}

/** A staff admin cannot invite themselves (same guard as self-demotion). */
export class SelfInviteError extends Error {
  constructor() {
    super("a staff admin cannot invite themselves");
    this.name = "SelfInviteError";
  }
}

/**
 * The person's account is disabled and cannot receive a magic-link login.
 * A disabled account gaining an active staff membership would be inaccessible.
 */
export class DisabledUserError extends Error {
  constructor() {
    super("this account is disabled and cannot be invited to staff");
    this.name = "DisabledUserError";
  }
}

export type StaffInviteInput = {
  actorUserId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "staff_admin" | "staff_approver";
};

export type StaffInviteResult = {
  membershipId: string;
  dispatches: PendingDispatch[];
};

type StaffInvitationEmailInput = {
  c: PoolClient;
  membershipId: string;
  toEmail: string;
  inviteeName: string;
  role: "staff_admin" | "staff_approver";
};

/** Queue the shared staff onboarding email for both fresh and recovered invites. */
async function queueStaffInvitationEmailInTx(input: StaffInvitationEmailInput): Promise<PendingDispatch | null> {
  return queueProductEmailInTx(input.c, {
    key: "staff_invited",
    entityId: randomUUID(),
    toEmail: input.toEmail,
    vars: {
      inviteeName: input.inviteeName,
      inviteeRole: input.role === "staff_admin" ? "Staff Admin" : "Staff Approver",
      loginUrl: absoluteUrl("/login"),
      // Non-rendered anchor used by the email-log resend path.
      membershipId: input.membershipId,
    },
  });
}

export async function inviteStaff(input: StaffInviteInput): Promise<StaffInviteResult> {
  return withDbContext(SYSTEM, async (c) => {
    // (a) look up the platform_owner org
    const orgRows = await q<{ id: string }>(
      c,
      `select id from organizations where kind = 'platform_owner' limit 1`,
    );
    const platformOwnerId = orgRows[0]?.id;
    if (!platformOwnerId) throw new Error("staff-invite: platform_owner organization not found");

    // (b) resolve or create people row by lower(email) — one human, one row
    const person =
      (await people.findByEmailInTx(c, input.email)) ??
      (await people.createInTx(c, {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: null,
        sourceNote: "staff invite (ADMIN-09)",
      }));

    // (c) resolve or create users row (defaults to status='invited', kind='member')
    const user =
      (await users.findByPersonIdInTx(c, person.id)) ??
      (await users.createInTx(c, { personId: person.id }));

    // Self-invite guard: the invitee resolves to the same user as the actor
    if (user.id === input.actorUserId) throw new SelfInviteError();

    // Disabled-user guard: a disabled account cannot receive magic-link logins,
    // so granting it an active staff membership would leave it inaccessible.
    if (user.status === "disabled") throw new DisabledUserError();

    // (d) check for an existing platform_owner membership on this user
    const existing = await memberships.findByOrgAndUserInTx(c, platformOwnerId, user.id);
    if (existing !== null && (existing.status === "active" || existing.status === "pending")) {
      throw new DuplicateStaffMembershipError();
    }

    let membershipId: string;

    if (existing !== null && existing.status === "removed") {
      // Re-invite: update the removed row back to active with the new role
      const rows = await q<{ id: string }>(
        c,
        `update org_memberships
            set status = 'active', role = $2, invited_by = $3, approved_by = $3, approved_at = now()
          where id = $1
          returning id`,
        [existing.id, input.role, input.actorUserId],
      );
      membershipId = rows[0]?.id ?? "";
      if (!membershipId) throw new Error("staff-invite: re-activate update returned no row");
      await insertInTx(c, {
        entityType: "org_membership",
        entityId: membershipId,
        fromStatus: "removed",
        toStatus: "active",
        actorUserId: input.actorUserId,
        note: "Staff re-invited via ADMIN-09",
      });
    } else {
      // Fresh insert: status='active', approved immediately by the actor
      const rows = await q<{ id: string }>(
        c,
        `insert into org_memberships (org_id, user_id, role, status, invited_by, approved_by, approved_at)
         values ($1, $2, $3, 'active', $4, $4, now())
         returning id`,
        [platformOwnerId, user.id, input.role, input.actorUserId],
      );
      membershipId = rows[0]?.id ?? "";
      if (!membershipId) throw new Error("staff-invite: membership insert returned no row");
      await insertInTx(c, {
        entityType: "org_membership",
        entityId: membershipId,
        fromStatus: "pending",
        toStatus: "active",
        actorUserId: input.actorUserId,
        note: "Staff invited via ADMIN-09",
      });
    }

    const dispatches: PendingDispatch[] = [];
    pushDispatch(
      dispatches,
      await queueStaffInvitationEmailInTx({
        c,
        membershipId,
        toEmail: input.email,
        inviteeName: `${person.firstName} ${person.lastName}`,
        role: input.role,
      }),
    );

    return { membershipId, dispatches };
  });
}

/** A row that is not the one deliberate Alliance recovery operation. */
export class AllianceInviteConversionError extends Error {
  constructor(
    message = "Only a pending Member invitation at The Alliance can be converted to Staff approver. Nothing was changed.",
  ) {
    super(message);
    this.name = "AllianceInviteConversionError";
  }
}

export type AllianceInviteConversionResult = {
  outcome: "converted" | "already_converted";
  membershipId: string;
  inviteeName: string;
  inviteeEmail: string;
  membership: OrgMembership;
  dispatches: PendingDispatch[];
};

/**
 * Recover a malformed member invitation at the platform owner organization.
 * The DAL performs the locked state transition; this function queues the
 * shared staff email in the same transaction for dispatch after commit.
 */
export async function convertAllianceInviteToStaffApproverInTx(
  c: PoolClient,
  membershipId: string,
  actorUserId: string,
): Promise<AllianceInviteConversionResult> {
  const row = await memberships.getRoleAdminRowInTx(c, membershipId);
  if (!row) throw new AllianceInviteConversionError("That membership could not be found. Nothing was changed.");
  if (row.orgKind === "platform_owner" && row.role === "staff_approver" && row.status === "active") {
    return {
      outcome: "already_converted",
      membershipId,
      inviteeName: `${row.firstName} ${row.lastName}`.trim(),
      inviteeEmail: row.email,
      membership: row,
      dispatches: [],
    };
  }
  if (row.orgKind !== "platform_owner" || row.role !== "member" || row.status !== "pending") {
    throw new AllianceInviteConversionError();
  }
  if (row.userStatus === "disabled") {
    throw new AllianceInviteConversionError("This account is disabled and cannot be activated as staff. Nothing was changed.");
  }

  const membership = await memberships.convertPendingAllianceMemberInTx(c, membershipId, actorUserId);
  const inviteeName = `${row.firstName} ${row.lastName}`.trim();
  const dispatches: PendingDispatch[] = [];
  pushDispatch(
    dispatches,
    await queueStaffInvitationEmailInTx({
      c,
      membershipId,
      toEmail: row.email,
      inviteeName,
      role: "staff_approver",
    }),
  );
  return {
    outcome: "converted",
    membershipId,
    inviteeName,
    inviteeEmail: row.email,
    membership,
    dispatches,
  };
}
