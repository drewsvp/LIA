/**
 * Legacy staff removal — seed-migration support (staff correction, Aug 2026).
 *
 * Databases seeded before the staff correction carry a synthetic staff_admin
 * (admin@thealliance.example.org). Removing a person row is only safe when
 * every foreign key that references it is accounted for, and only when the
 * whole rewrite happens atomically — a partial removal (attribution already
 * re-pointed, person still present) would be worse than either outcome.
 *
 * Policy, enforced in ONE transaction:
 * - Attribution history (approval_events.actor_user_id, membership
 *   approved_by / invited_by, organization approved_by, request
 *   created_by / approved_by) is re-pointed to the replacement staff user.
 * - The platform owner's primary contact is re-pointed to the replacement
 *   person.
 * - email_log rows keep their history but drop the person link (to_person_id
 *   is nullable by design; to_email preserves the record).
 * - Anything that means the synthetic account saw REAL use — pledges,
 *   volunteer signups, digest subscriptions, request contact assignments,
 *   member-org memberships, member-org primary contacts — aborts the removal
 *   loudly BEFORE any write. Those rows need a human decision, not a script.
 */
import { q, withDbContext, type DbContext } from "../db/client";

export type LegacyStaffRemovalCounts = {
  approvalEvents: number;
  membershipApprovals: number;
  membershipInvites: number;
  orgApprovals: number;
  itemRequestCreated: number;
  itemRequestApproved: number;
  volunteerRequestCreated: number;
  volunteerRequestApproved: number;
  primaryContacts: number;
  emailLogsDetached: number;
  membershipsDeleted: number;
};

export type LegacyStaffRemovalResult =
  | { removed: false }
  | { removed: true; personId: string; userId: string | null; counts: LegacyStaffRemovalCounts };

/**
 * References this migration deliberately has NO policy for. Any hit aborts
 * the whole transaction with nothing written. `kind` selects the bind value:
 * the legacy person id or the legacy user id.
 */
const BLOCKERS: ReadonlyArray<{ label: string; sql: string; kind: "person" | "user" }> = [
  {
    label: "digest subscription(s) (digest_subscribers.person_id)",
    sql: "select count(*)::int as n from digest_subscribers where person_id = $1",
    kind: "person",
  },
  {
    label: "item pledge(s) (item_pledges.person_id)",
    sql: "select count(*)::int as n from item_pledges where person_id = $1",
    kind: "person",
  },
  {
    label: "volunteer signup(s) (volunteer_signups.person_id)",
    sql: "select count(*)::int as n from volunteer_signups where person_id = $1",
    kind: "person",
  },
  {
    label: "item request contact(s) (item_requests.contact_person_id)",
    sql: "select count(*)::int as n from item_requests where contact_person_id = $1",
    kind: "person",
  },
  {
    label: "volunteer request contact(s) (volunteer_requests.contact_person_id)",
    sql: "select count(*)::int as n from volunteer_requests where contact_person_id = $1",
    kind: "person",
  },
  {
    label: "member-org primary contact(s) (organizations.primary_contact_person_id outside the platform owner)",
    sql: "select count(*)::int as n from organizations where primary_contact_person_id = $1 and kind <> 'platform_owner'",
    kind: "person",
  },
  {
    label: "member-org membership(s) (org_memberships outside the platform owner)",
    sql: "select count(*)::int as n from org_memberships m join organizations o on o.id = m.org_id where m.user_id = $1 and o.kind <> 'platform_owner'",
    kind: "user",
  },
];

/**
 * Atomically remove the legacy synthetic staff_admin identified by email.
 * Returns { removed: false } when no such person exists (the normal case on
 * freshly seeded databases). Handles the person-without-user edge state.
 * Throws — leaving the database untouched — on any reference listed above.
 */
export async function removeLegacyStaffAdmin(
  ctx: DbContext,
  input: {
    email: string;
    reassignAttributionToUserId: string;
    replacementPrimaryContactPersonId: string;
  },
): Promise<LegacyStaffRemovalResult> {
  return withDbContext(ctx, async (client) => {
    const [person] = await q<{ id: string }>(client, "select id from people where lower(email) = lower($1)", [
      input.email,
    ]);
    if (!person) return { removed: false };

    const [user] = await q<{ id: string }>(client, "select id from users where person_id = $1", [person.id]);
    if (user && user.id === input.reassignAttributionToUserId) {
      throw new Error(
        `removeLegacyStaffAdmin: refusing to re-point attribution to the user being removed (${input.email})`,
      );
    }
    if (person.id === input.replacementPrimaryContactPersonId) {
      throw new Error(
        `removeLegacyStaffAdmin: replacement primary contact is the person being removed (${input.email})`,
      );
    }

    // Preflight: abort before ANY write when the legacy account has references
    // this migration has no policy for. The transaction would roll back the
    // writes anyway; checking first keeps the failure message readable and
    // the abort provably write-free.
    const blockers: string[] = [];
    for (const check of BLOCKERS) {
      let bindId: string;
      if (check.kind === "person") bindId = person.id;
      else if (user) bindId = user.id;
      else continue; // user-scoped check, and no user row exists to check
      const [row] = await q<{ n: number }>(client, check.sql, [bindId]);
      if (row && row.n > 0) blockers.push(`${row.n} ${check.label}`);
    }
    if (blockers.length > 0) {
      throw new Error(
        `removeLegacyStaffAdmin: ${input.email} has references that need a human decision — ` +
          `${blockers.join("; ")}. Nothing was changed.`,
      );
    }

    const count = async (sql: string, params: readonly unknown[]): Promise<number> =>
      (await q<{ one: number }>(client, sql, params)).length;

    const counts: LegacyStaffRemovalCounts = {
      approvalEvents: 0,
      membershipApprovals: 0,
      membershipInvites: 0,
      orgApprovals: 0,
      itemRequestCreated: 0,
      itemRequestApproved: 0,
      volunteerRequestCreated: 0,
      volunteerRequestApproved: 0,
      primaryContacts: 0,
      emailLogsDetached: 0,
      membershipsDeleted: 0,
    };

    if (user) {
      const to = input.reassignAttributionToUserId;
      counts.approvalEvents = await count(
        "update approval_events set actor_user_id = $2 where actor_user_id = $1 returning 1 as one",
        [user.id, to],
      );
      counts.membershipApprovals = await count(
        "update org_memberships set approved_by = $2 where approved_by = $1 returning 1 as one",
        [user.id, to],
      );
      counts.membershipInvites = await count(
        "update org_memberships set invited_by = $2 where invited_by = $1 returning 1 as one",
        [user.id, to],
      );
      counts.orgApprovals = await count(
        "update organizations set approved_by = $2 where approved_by = $1 returning 1 as one",
        [user.id, to],
      );
      counts.itemRequestCreated = await count(
        "update item_requests set created_by = $2 where created_by = $1 returning 1 as one",
        [user.id, to],
      );
      counts.itemRequestApproved = await count(
        "update item_requests set approved_by = $2 where approved_by = $1 returning 1 as one",
        [user.id, to],
      );
      counts.volunteerRequestCreated = await count(
        "update volunteer_requests set created_by = $2 where created_by = $1 returning 1 as one",
        [user.id, to],
      );
      counts.volunteerRequestApproved = await count(
        "update volunteer_requests set approved_by = $2 where approved_by = $1 returning 1 as one",
        [user.id, to],
      );
    }

    // Preflight guarantees only platform-owner rows remain for these two.
    counts.primaryContacts = await count(
      "update organizations set primary_contact_person_id = $2 where primary_contact_person_id = $1 returning 1 as one",
      [person.id, input.replacementPrimaryContactPersonId],
    );
    counts.emailLogsDetached = await count(
      "update email_log set to_person_id = null where to_person_id = $1 returning 1 as one",
      [person.id],
    );

    if (user) {
      counts.membershipsDeleted = await count("delete from org_memberships where user_id = $1 returning 1 as one", [
        user.id,
      ]);
      await q(client, "delete from users where id = $1", [user.id]);
    }
    await q(client, "delete from people where id = $1", [person.id]);

    return { removed: true, personId: person.id, userId: user ? user.id : null, counts };
  });
}
