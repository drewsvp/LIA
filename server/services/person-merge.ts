/**
 * ADMIN-04 — the merge bundle (spec §6, D16, D31): merge_people() and its
 * approval_events row in ONE transaction, so the audit trail can never
 * describe a merge that didn't happen, and no merge can happen without its
 * trail.
 *
 * merge_people() (migrations/0003) reassigns every FK that references
 * people — the eight audited columns — and deletes the duplicate row, the
 * system's only row delete. This service adds what the database function
 * cannot know: who did it (actor) and the human-readable record of what
 * moved, written against the SURVIVOR (the row that still exists), with
 * the deleted row's id, name, and email preserved in the note (D31).
 *
 * The both-logins case throws BEFORE calling the function so the route can
 * render the §8 blocked line; the function's own guard is defense in depth,
 * not the primary path.
 */
import * as dal from "../dal";
import type { Person } from "../../shared/types";
import type { DbContext } from "../db/client";
import { q, withDbContext } from "../db/client";

export class MergePersonNotFoundError extends Error {
  constructor(personId: string) {
    super(`person not found: ${personId}`);
    this.name = "MergePersonNotFoundError";
  }
}

export class MergeBothHaveUsersError extends Error {
  constructor() {
    super("both records have login accounts");
    this.name = "MergeBothHaveUsersError";
  }
}

export type MergeMovedCounts = {
  pledges: number;
  signups: number;
  users: number;
  digestSubscribers: number;
  orgPrimaryContacts: number;
  emailLogEntries: number;
  itemRequestContacts: number;
  volunteerRequestContacts: number;
};

export type MergeResult = {
  survivor: Person;
  moved: MergeMovedCounts;
  summary: string;
};

const PERSON_COLS = `id, first_name as "firstName", last_name as "lastName", email, phone,
  needs_review as "needsReview", review_note as "reviewNote", source_note as "sourceNote",
  created_at as "createdAt", updated_at as "updatedAt"`;

/** Human-readable moved summary: only the parts that actually moved. */
export function summarizeMoved(moved: MergeMovedCounts): string {
  const parts: string[] = [];
  const add = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  add(moved.pledges, "pledge", "pledges");
  add(moved.signups, "signup", "signups");
  add(moved.users, "login account", "login accounts");
  add(moved.digestSubscribers, "digest subscription", "digest subscriptions");
  add(moved.orgPrimaryContacts, "organization primary-contact reference", "organization primary-contact references");
  add(moved.emailLogEntries, "email log entry", "email log entries");
  add(
    moved.itemRequestContacts + moved.volunteerRequestContacts,
    "request contact reference",
    "request contact references",
  );
  return parts.length === 0 ? "no attached records" : parts.join(", ");
}

/**
 * Merge duplicate into survivor. Throws MergePersonNotFoundError /
 * MergeBothHaveUsersError before writing anything; any failure inside the
 * transaction rolls back both the merge and its event row.
 */
export async function mergePeople(
  ctx: DbContext,
  args: { duplicateId: string; survivorId: string; actorUserId: string },
): Promise<MergeResult> {
  const { duplicateId, survivorId, actorUserId } = args;
  return withDbContext(ctx, async (client) => {
    // Read both rows first: the duplicate's identity must be captured
    // BEFORE the delete or the note can never name it.
    const dupRows = await q<Person>(client, `select ${PERSON_COLS} from people where id = $1`, [duplicateId]);
    const duplicate = dupRows[0];
    if (!duplicate) throw new MergePersonNotFoundError(duplicateId);
    const surRows = await q<Person>(client, `select ${PERSON_COLS} from people where id = $1`, [survivorId]);
    const survivorBefore = surRows[0];
    if (!survivorBefore) throw new MergePersonNotFoundError(survivorId);

    // §12 readable pre-check (the function's guard is defense in depth).
    const userCounts = await q<{ personId: string }>(
      client,
      `select person_id as "personId" from users where person_id = $1 or person_id = $2`,
      [duplicateId, survivorId],
    );
    const dupHasUser = userCounts.some((r) => r.personId === duplicateId);
    const surHasUser = userCounts.some((r) => r.personId === survivorId);
    if (dupHasUser && surHasUser) throw new MergeBothHaveUsersError();

    const mergedRows = await q<{ moved: MergeMovedCounts }>(
      client,
      `select merge_people($1, $2) as moved`,
      [duplicateId, survivorId],
    );
    const moved = mergedRows[0]?.moved;
    if (!moved) throw new Error("merge_people returned no result");

    const summary = summarizeMoved(moved);
    await dal.approvalEvents.insertInTx(client, {
      entityType: "person",
      entityId: survivorId,
      fromStatus: "duplicate",
      toStatus: "merged",
      actorUserId,
      note:
        `Merged ${duplicate.firstName} ${duplicate.lastName} <${duplicate.email}> ` +
        `(deleted id ${duplicateId}) into this record. Moved: ${summary}.`,
    });

    // Re-read the survivor inside the tx: reassignment may have bumped
    // updated_at via triggers, and the result should state what is true.
    const afterRows = await q<Person>(client, `select ${PERSON_COLS} from people where id = $1`, [survivorId]);
    const survivor = afterRows[0];
    if (!survivor) throw new Error(`survivor vanished during merge: ${survivorId}`);

    return { survivor, moved, summary };
  });
}
