/**
 * People — one human is one row, permanently, keyed by lower(email).
 * A person is identified by email, never by name (replit.md rule 11).
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { Person } from "../../shared/types";

const COLS = `id, first_name as "firstName", last_name as "lastName", email, phone,
  needs_review as "needsReview", review_note as "reviewNote", source_note as "sourceNote",
  legacy_wix_contact_id as "legacyWixContactId", created_at as "createdAt", updated_at as "updatedAt"`;

export type CreatePersonInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  sourceNote?: string | null;
};

/** Find by case-insensitive email. */
export async function findByEmail(ctx: DbContext, email: string): Promise<Person | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<Person>(c, `select ${COLS} from people where lower(email) = lower($1)`, [email]),
  );
  return rows[0] ?? null;
}

export async function getById(ctx: DbContext, personId: string): Promise<Person | null> {
  const rows = await withDbContext(ctx, (c) => q<Person>(c, `select ${COLS} from people where id = $1`, [personId]));
  return rows[0] ?? null;
}

/** Tx-composable variant (ADMIN-01 reads the primary contact inside the approval tx). */
export async function getByIdInTx(c: PoolClient, personId: string): Promise<Person | null> {
  const rows = await q<Person>(c, `select ${COLS} from people where id = $1`, [personId]);
  return rows[0] ?? null;
}

/** Create a person. Two name inputs, two columns, stored as entered. */
export async function create(ctx: DbContext, input: CreatePersonInput): Promise<Person> {
  return withDbContext(ctx, (c) => createInTx(c, input));
}

/** Transaction-composable variant (MP-03 one-tx signup). */
export async function createInTx(c: PoolClient, input: CreatePersonInput): Promise<Person> {
  const rows = await q<Person>(
    c,
    `insert into people (first_name, last_name, email, phone, source_note)
     values ($1, $2, $3, $4, $5) returning ${COLS}`,
    [input.firstName, input.lastName, input.email, input.phone ?? null, input.sourceNote ?? null],
  );
  const person = rows[0];
  if (!person) throw new Error("people.create returned no row");
  return person;
}

/** Transaction-composable find by email (MP-03 one-tx signup). */
export async function findByEmailInTx(c: PoolClient, email: string): Promise<Person | null> {
  const rows = await q<Person>(c, `select ${COLS} from people where lower(email) = lower($1)`, [email]);
  return rows[0] ?? null;
}

/** Update both names in place. Never concatenated, never split. */
export async function updateNames(
  ctx: DbContext,
  personId: string,
  firstName: string,
  lastName: string,
): Promise<Person> {
  const rows = await withDbContext(ctx, (c) =>
    q<Person>(
      c,
      `update people set first_name = $2, last_name = $3 where id = $1 returning ${COLS}`,
      [personId, firstName, lastName],
    ),
  );
  const person = rows[0];
  if (!person) throw new Error(`people.updateNames: person not found: ${personId}`);
  return person;
}

/**
 * Full contact update (MP-05 primary-contact fields bind directly to
 * people.*). Caller normalizes the email; the lower(email) unique index is
 * the collision backstop.
 */
export async function updateContactInTx(
  c: PoolClient,
  personId: string,
  input: { firstName: string; lastName: string; email: string; phone: string | null },
): Promise<Person> {
  const rows = await q<Person>(
    c,
    `update people set first_name = $2, last_name = $3, email = $4, phone = $5 where id = $1 returning ${COLS}`,
    [personId, input.firstName, input.lastName, input.email, input.phone],
  );
  const person = rows[0];
  if (!person) throw new Error(`people.updateContactInTx: person not found: ${personId}`);
  return person;
}

/** Flag a person for staff review (ADMIN-04) with a note explaining why. */
export async function flagForReview(ctx: DbContext, personId: string, note: string): Promise<Person> {
  const rows = await withDbContext(ctx, (c) =>
    q<Person>(
      c,
      `update people set needs_review = true, review_note = $2 where id = $1 returning ${COLS}`,
      [personId, note],
    ),
  );
  const person = rows[0];
  if (!person) throw new Error(`people.flagForReview: person not found: ${personId}`);
  return person;
}

/**
 * Clear the review flag, PRESERVING review_note (D17): the note is the
 * record of why the row was ever flagged, and clearing the flag is a
 * decision that should stay explainable afterwards.
 */
export async function clearReviewFlag(ctx: DbContext, personId: string): Promise<Person> {
  const rows = await withDbContext(ctx, (c) =>
    q<Person>(
      c,
      `update people set needs_review = false where id = $1 returning ${COLS}`,
      [personId],
    ),
  );
  const person = rows[0];
  if (!person) throw new Error(`people.clearReviewFlag: person not found: ${personId}`);
  return person;
}

/** People currently flagged for review, oldest first (ADMIN-04). */
export async function listNeedingReview(ctx: DbContext): Promise<Person[]> {
  return withDbContext(ctx, (c) =>
    q<Person>(c, `select ${COLS} from people where needs_review order by updated_at asc`),
  );
}

/**
 * Delete a person row. Seed-migration support (legacy synthetic staff_admin
 * removal) — every referencing row must be re-pointed or detached first, or
 * the FKs will reject this loudly, which is the correct failure mode.
 */
export async function removeById(ctx: DbContext, personId: string): Promise<void> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `delete from people where id = $1 returning id`, [personId]),
  );
  if (!rows[0]) throw new Error(`people.removeById: person not found: ${personId}`);
}

/**
 * Thrown when a member-lane flow resolves an existing person by email who
 * has no prior relationship with the acting organization. Attaching would
 * let anyone who knows a stranger's email pull that person's stored
 * name/phone back off a member GET (or, in org-settings' null-contact
 * branch, overwrite the row). Routes map this to their surface's generic
 * failure copy — the response must not confirm the email exists.
 */
export class ContactNotVisibleError extends Error {
  constructor() {
    super("contact email is not visible to this organization");
    this.name = "ContactNotVisibleError";
  }
}

/**
 * True when the person already has a relationship with the organization:
 * its primary contact, a contact on any of its requests, a user with a
 * membership, or a supporter who pledged/signed up to one of its requests
 * (the org already sees those people on MP-13). This is the §11 boundary
 * for reusing a people row resolved by member-supplied email — RLS is
 * bypassed at runtime, so this explicit check is the only wall.
 */
export async function isVisibleToOrgInTx(c: PoolClient, personId: string, orgId: string): Promise<boolean> {
  const rows = await q<{ visible: boolean }>(
    c,
    `select
       exists(select 1 from organizations where id = $2 and primary_contact_person_id = $1)
       or exists(select 1 from item_requests where org_id = $2 and contact_person_id = $1)
       or exists(select 1 from volunteer_requests where org_id = $2 and contact_person_id = $1)
       or exists(select 1 from users u
                   join org_memberships m on m.user_id = u.id
                  where m.org_id = $2 and u.person_id = $1)
       or exists(select 1 from item_pledges ip
                   join item_requests ir on ir.id = ip.item_request_id
                  where ir.org_id = $2 and ip.person_id = $1)
       or exists(select 1 from volunteer_signups vs
                   join volunteer_requests vr on vr.id = vs.volunteer_request_id
                  where vr.org_id = $2 and vs.person_id = $1)
       as visible`,
    [personId, orgId],
  );
  return rows[0]?.visible === true;
}
