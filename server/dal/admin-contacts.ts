import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { Person } from "../../shared/types";
import { normalizeEmail, updateEmailInTx } from "./people";
import * as authProvider from "./auth-provider";

export type ContactDirectoryRow = Person & {
  hasUser: boolean;
  pledgeCount: number;
  signupCount: number;
  membershipCount: number;
  primaryContactCount: number;
};
export type PendingContactEmail = { email: string; expiresAt: string };
export type ContactAuditRow = {
  id: string;
  action: string;
  outcome: string;
  actorName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};
export class ContactNotFoundError extends Error {}
export class ContactEmailConflictError extends Error {}
export class ContactMissingAuthIdentityError extends Error {}

const COLS = `p.id, p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone,
 p.needs_review as "needsReview", p.review_note as "reviewNote", p.source_note as "sourceNote",
 p.legacy_wix_contact_id as "legacyWixContactId", p.created_at as "createdAt", p.updated_at as "updatedAt"`;
const COUNTS = `(select count(*)::int from item_pledges x where x.person_id=p.id) as "pledgeCount",
 (select count(*)::int from volunteer_signups x where x.person_id=p.id) as "signupCount",
 (select count(*)::int from org_memberships m join users u on u.id=m.user_id where u.person_id=p.id) as "membershipCount",
 (select count(*)::int from organizations o where o.primary_contact_person_id=p.id) as "primaryContactCount"`;

export async function list(ctx: DbContext, input: { search?: string; reviewStatus?: "all" | "review" | "clear"; page: number; pageSize: number; sort?: "name" | "email" | "review" | "attached"; direction?: "asc" | "desc" }) {
  const search = input.search?.trim().toLowerCase() ?? "";
  const params: unknown[] = [];
  let where = "";
  if (search) {
    params.push(`%${search}%`);
    where = `where (lower(p.email) like $1 or lower(p.first_name || ' ' || p.last_name) like $1
      or lower(p.last_name || ' ' || p.first_name) like $1 or coalesce(p.phone, '') like $1
      or lower(coalesce(p.review_note, '')) like $1
      or (select count(*)::text from item_pledges x where x.person_id=p.id) like $1
      or (select count(*)::text from volunteer_signups x where x.person_id=p.id) like $1
      or (select count(*)::text from org_memberships m join users u on u.id=m.user_id where u.person_id=p.id) like $1
      or (select count(*)::text from organizations o where o.primary_contact_person_id=p.id) like $1)`;
  }
  if (input.reviewStatus === "review" || input.reviewStatus === "clear") {
    const clause = input.reviewStatus === "review" ? "p.needs_review = true" : "p.needs_review = false";
    where += where ? ` and ${clause}` : `where ${clause}`;
  }
  const sortColumns = {
    name: "lower(p.last_name), lower(p.first_name)",
    email: "lower(p.email)",
    review: "p.needs_review, lower(coalesce(p.review_note, ''))",
    attached: `(select count(*) from item_pledges x where x.person_id=p.id)
      + (select count(*) from volunteer_signups x where x.person_id=p.id)
      + (select count(*) from org_memberships m join users u on u.id=m.user_id where u.person_id=p.id)
      + (select count(*) from organizations o where o.primary_contact_person_id=p.id)`,
  } as const;
  const direction = input.direction === "desc" ? "desc" : "asc";
  const order = input.sort === "review"
    ? `p.needs_review ${direction}, lower(coalesce(p.review_note, '')) ${direction}`
    : (input.sort ?? "name") === "name"
      ? `lower(p.last_name) ${direction} nulls last, lower(p.first_name) ${direction} nulls last`
      : `${sortColumns[input.sort ?? "name"] ?? sortColumns.name} ${direction}`;
  params.push(input.pageSize, (input.page - 1) * input.pageSize);
  return withDbContext(ctx, async (c) => {
    const rows = await q<ContactDirectoryRow & { total: number }>(c, `select ${COLS},
      exists(select 1 from users u where u.person_id=p.id) as "hasUser", ${COUNTS},
      count(*) over()::int as total from people p ${where}
       order by ${order}, p.id limit $${params.length - 1} offset $${params.length}`, params);
    return { people: rows.map(({ total: _total, ...person }) => person), total: rows[0]?.total ?? 0, page: input.page, pageSize: input.pageSize };
  });
}

export async function get(ctx: DbContext, personId: string): Promise<ContactDirectoryRow | null> {
  return withDbContext(ctx, async (c) => (await q<ContactDirectoryRow>(c, `select ${COLS},
    exists(select 1 from users u where u.person_id=p.id) as "hasUser", ${COUNTS} from people p where p.id=$1`, [personId]))[0] ?? null);
}

export async function getPendingEmail(ctx: DbContext, personId: string): Promise<PendingContactEmail | null> {
  return withDbContext(ctx, async (c) => (await q<PendingContactEmail>(c, `select value::jsonb ->> 'newEmail' as email, "expiresAt" as "expiresAt"
    from verification where identifier like 'profile-email-change:%' and "expiresAt" > now()
      and value is json object and value::jsonb ->> 'personId'=$1
    order by "createdAt" desc limit 1`, [personId]))[0] ?? null);
}
/** Includes expired rows for resend, which replaces rather than revives them. */
export async function getLatestPendingEmail(ctx: DbContext, personId: string): Promise<PendingContactEmail | null> {
  return withDbContext(ctx, async (c) => (await q<PendingContactEmail>(c, `select value::jsonb ->> 'newEmail' as email, "expiresAt" as "expiresAt"
    from verification where identifier like 'profile-email-change:%' and value is json object
      and value::jsonb ->> 'personId'=$1 order by "createdAt" desc limit 1`, [personId]))[0] ?? null);
}

export async function listAuditHistory(ctx: DbContext, personId: string): Promise<ContactAuditRow[]> {
  return withDbContext(ctx, (c) =>
    q<ContactAuditRow>(
      c,
      `select ca.id, ca.action, ca.outcome,
              nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as "actorName",
              ca.details, ca.created_at as "createdAt"
         from contact_admin_audit ca
         left join users u on u.id = ca.actor_user_id
         left join people p on p.id = u.person_id
        where ca.person_id = $1
        order by ca.created_at desc, ca.id desc
        limit 100`,
      [personId],
    ),
  );
}

export async function recordAuditInTx(c: PoolClient, input: { actorUserId: string; personId: string; action: string; outcome: string; details?: Record<string, unknown> }) {
  await c.query(`insert into contact_admin_audit (actor_user_id, person_id, action, outcome, details)
    values ($1,$2,$3,$4,$5::jsonb)`, [input.actorUserId, input.personId, input.action, input.outcome, JSON.stringify(input.details ?? {})]);
}

export async function update(
  ctx: DbContext,
  input: { actorUserId: string; personId: string; firstName: string; lastName: string; phone: string | null; email: string; tokenHash?: string },
): Promise<{ contact: ContactDirectoryRow; pendingEmail: string | null; linked: boolean }> {
  return withDbContext(ctx, async (c) => {
    const people = await q<{ id: string; email: string }>(
      c,
      `select id, email from people where id = $1 for update`,
      [input.personId],
    );
    const person = people[0];
    if (!person) throw new ContactNotFoundError();
    const users = await q<{ userId: string; authSubject: string | null }>(
      c,
      `select id as "userId", auth_subject as "authSubject"
         from users
        where person_id = $1
        for update`,
      [input.personId],
    );
    const linkedUser = users[0] ?? null;
    const current = {
      ...person,
      userId: linkedUser?.userId ?? null,
      authSubject: linkedUser?.authSubject ?? null,
    };
    const email = normalizeEmail(input.email);
    const changed = normalizeEmail(current.email) !== email;
    const personConflict = await q<{ id: string }>(c, `select id from people where id<>$1 and lower(btrim(email))=$2 limit 1`, [input.personId, email]);
    if (personConflict[0]) throw new ContactEmailConflictError();
    if (changed && current.authSubject && await authProvider.emailInUseByAnotherUserInTx(c, email, current.authSubject)) throw new ContactEmailConflictError();
    await c.query(`update people set first_name=$2,last_name=$3,phone=$4${changed && !current.userId ? ",email=$5" : ""} where id=$1`,
      changed && !current.userId ? [input.personId,input.firstName,input.lastName,input.phone,email] : [input.personId,input.firstName,input.lastName,input.phone]);
    if (current.authSubject) await authProvider.updateUserContactInTx(c, current.authSubject, current.email, `${input.firstName} ${input.lastName}`);
    let pendingEmail: string | null = null;
    if (changed && current.userId) {
      if (!current.authSubject) throw new ContactMissingAuthIdentityError();
      if (!input.tokenHash) throw new Error("Missing confirmation token.");
      await authProvider.createProfileEmailChangeInTx(c, { userId: current.userId, personId: input.personId, authUserId: current.authSubject, newEmail: email, tokenHash: input.tokenHash, initiatedByUserId: input.actorUserId });
      pendingEmail = email;
    }
    await recordAuditInTx(c, { actorUserId: input.actorUserId, personId: input.personId, action: "contact_edit", outcome: pendingEmail ? "confirmation_pending" : "success", details: { emailChanged: changed, pendingEmail } });
    const contact = await getInTx(c, input.personId); if (!contact) throw new Error("Contact disappeared.");
    return { contact, pendingEmail, linked: !!current.userId };
  });
}

async function getInTx(c: PoolClient, id: string): Promise<ContactDirectoryRow | null> {
  return (await q<ContactDirectoryRow>(c, `select ${COLS},exists(select 1 from users u where u.person_id=p.id) as "hasUser",${COUNTS} from people p where p.id=$1`, [id]))[0] ?? null;
}

export async function cancelPending(ctx: DbContext, actorUserId: string, personId: string): Promise<boolean> {
  return withDbContext(ctx, async c => {
    const users = await q<{ id: string }>(c, `select id from users where person_id=$1 for update`, [personId]);
    if (!users[0]) throw new ContactNotFoundError();
    const before = await getPendingEmailInTx(c, personId);
    await authProvider.cancelProfileEmailChangesInTx(c, users[0].id);
    await recordAuditInTx(c, { actorUserId, personId, action: "contact_email_cancel", outcome: before ? "success" : "not_pending" });
    return !!before;
  });
}
export async function replacePending(
  ctx: DbContext, input: { actorUserId: string; personId: string; tokenHash: string },
): Promise<{ email: string; firstName: string; userId: string }> {
  return withDbContext(ctx, async c => {
    const rows = await q<{ id: string; firstName: string; userId: string; authSubject: string | null; email: string }>(c, `select p.id,p.first_name as "firstName",u.id as "userId",u.auth_subject as "authSubject",
      v.value::jsonb ->> 'newEmail' as email from people p join users u on u.person_id=p.id
      join lateral (select value from verification where identifier like 'profile-email-change:%'
        and value is json object and value::jsonb ->> 'personId'=p.id::text order by "createdAt" desc limit 1) v on true
      where p.id=$1 for update of p,u`, [input.personId]);
    const row = rows[0]; if (!row) throw new ContactNotFoundError();
    if (!row.authSubject) throw new ContactMissingAuthIdentityError();
    const normalized = normalizeEmail(row.email);
    const conflict = await q<{ id: string }>(c, `select id from people where id<>$1 and lower(btrim(email))=$2 limit 1`, [input.personId, normalized]);
    if (conflict[0] || await authProvider.emailInUseByAnotherUserInTx(c, normalized, row.authSubject)) throw new ContactEmailConflictError();
    await authProvider.createProfileEmailChangeInTx(c, { userId: row.userId, personId: input.personId, authUserId: row.authSubject, newEmail: normalized, tokenHash: input.tokenHash, initiatedByUserId: input.actorUserId });
    await recordAuditInTx(c, { actorUserId: input.actorUserId, personId: input.personId, action: "contact_email_resend", outcome: "pending_replaced", details: { newEmail: normalized } });
    return { email: normalized, firstName: row.firstName, userId: row.userId };
  });
}
async function getPendingEmailInTx(c: PoolClient, personId: string) {
  return (await q<PendingContactEmail>(c, `select value::jsonb ->> 'newEmail' as email,"expiresAt" as "expiresAt" from verification where identifier like 'profile-email-change:%' and "expiresAt">now() and value is json object and value::jsonb ->> 'personId'=$1 limit 1 for update`, [personId]))[0] ?? null;
}