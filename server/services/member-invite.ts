/**
 * MP-06 — invite a teammate (docs/specs/MP-06.md).
 *
 * One transaction: person (resolved by lower(email), never duplicated, and an
 * existing person's stored fields are never overwritten — one human, one
 * row), user at 'invited' if none exists, membership at 'pending' (or a
 * removed one re-invited back to pending), and the staff notification rows.
 * A person with no membership, or a staff email for a membership that was
 * never written, is the original Handbook §16 fault — everything commits or
 * nothing does.
 *
 * No approval_events row on the create path (§3: a fresh membership has not
 * transitioned from anything). Re-inviting a removed membership IS a
 * transition and its event is written by the DAL in the same transaction.
 */
import { SYSTEM, withDbContext } from "../db/client";
import * as organizations from "../dal/organizations";
import * as people from "../dal/people";
import * as users from "../dal/users";
import * as memberships from "../dal/memberships";
import { queueProductEmailInTx, absoluteUrl, type PendingDispatch } from "../email/send";

/** §12: an active or pending membership already covers this person here. */
export class DuplicateMembershipError extends Error {
  constructor() {
    super("person already holds a membership in this organization");
    this.name = "DuplicateMembershipError";
  }
}

export type SubmitMemberInviteInput = {
  orgId: string;
  actorUserId: string;
  /** Session user's email — resolves the submitter's person row for the staff email. */
  actorEmail: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type SubmitMemberInviteResult = {
  membershipId: string;
  dispatches: PendingDispatch[];
};

export async function submitMemberInvite(input: SubmitMemberInviteInput): Promise<SubmitMemberInviteResult> {
  const [org, submitter] = await Promise.all([
    organizations.getById(SYSTEM, input.orgId),
    people.findByEmail(SYSTEM, input.actorEmail),
  ]);
  if (org === null) throw new Error(`member-invite: organization not found: ${input.orgId}`);
  if (submitter === null) throw new Error(`member-invite: no person row for submitter ${input.actorEmail}`);

  return withDbContext(SYSTEM, async (c) => {
    // One identifier resolves the person (§1): lower(email). An existing row
    // is attached exactly as stored — the form's name/phone are not written
    // over it (§12 row 1).
    const person =
      (await people.findByEmailInTx(c, input.email)) ??
      (await people.createInTx(c, {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        sourceNote: "member invite (MP-06)",
      }));

    const user =
      (await users.findByPersonIdInTx(c, person.id)) ?? (await users.createInTx(c, { personId: person.id }));

    const existing = await memberships.findByOrgAndUserInTx(c, input.orgId, user.id);
    if (existing !== null && (existing.status === "active" || existing.status === "pending")) {
      throw new DuplicateMembershipError();
    }
    const membership =
      existing !== null
        ? await memberships.reinviteInTx(c, existing.id, input.actorUserId)
        : await memberships.createInTx(c, { orgId: input.orgId, userId: user.id, invitedBy: input.actorUserId });

    // Staff notification to both addresses (D53 pattern); a missing env is loud.
    const staffPrimary = (process.env.STAFF_NOTIFY_PRIMARY ?? "").trim();
    const staffSecondary = (process.env.STAFF_NOTIFY_SECONDARY ?? "").trim();
    const recipients = [...new Set([staffPrimary, staffSecondary].filter((e) => e !== ""))];
    if (staffPrimary === "" || staffSecondary === "") {
      console.error(
        `[member-invite] membership ${membership.id}: STAFF_NOTIFY_PRIMARY/SECONDARY not fully configured — staff_new_user copies incomplete`,
      );
    }
    const dispatches: PendingDispatch[] = [];
    for (const toEmail of recipients) {
      dispatches.push(
        await queueProductEmailInTx(c, {
          key: "staff_new_user",
          entityId: membership.id,
          toEmail,
          vars: {
            memberName: `${person.firstName} ${person.lastName}`,
            memberEmail: person.email,
            memberPhone: person.phone,
            organizationName: org.name,
            submitterName: `${submitter.firstName} ${submitter.lastName}`,
            submitterEmail: submitter.email,
            adminUrl: absoluteUrl("/admin/members"),
          },
        }),
      );
    }

    return { membershipId: membership.id, dispatches };
  });
}
