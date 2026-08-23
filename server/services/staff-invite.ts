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
import { SYSTEM, withDbContext, q } from "../db/client";
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

    // (g) queue staff_invited email to the invitee's address.
    //
    // entity_id is a fresh UUID per invitation occurrence so the once-only
    // log index never blocks a re-invite — even if the prior invitation was
    // successfully delivered. The real membershipId is stored as a non-rendered
    // var in the payload so the resend rebuilder can resolve the current
    // member name and role without a separate lookup table.
    const emailEntityId = randomUUID();
    const roleName = input.role === "staff_admin" ? "Staff Admin" : "Staff Approver";
    const dispatches: PendingDispatch[] = [];
    pushDispatch(
      dispatches,
      await queueProductEmailInTx(c, {
        key: "staff_invited",
        entityId: emailEntityId,
        toEmail: input.email,
        vars: {
          inviteeName: `${person.firstName} ${person.lastName}`,
          inviteeRole: roleName,
          loginUrl: absoluteUrl("/login"),
          // Non-rendered anchor: stored in payload so the resend rebuilder
          // can look up the membership for current name/role.
          membershipId,
        },
      }),
    );

    return { membershipId, dispatches };
  });
}
