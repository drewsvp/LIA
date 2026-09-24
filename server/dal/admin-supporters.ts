import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { Person } from "../../shared/types";

export type SupporterDirectoryRow = {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  alertsEnabled: boolean;
  pledgeCount: number;
  signupCount: number;
  viewCount: number;
};

export type SupporterProfile = {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: "active" | "disabled";
  authSubject: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  alertsEnabled: boolean;
  alertInterests: string[];
};

export type SupporterAdminAuditInput = {
  actorUserId: string | null;
  targetUserId: string | null;
  contextId?: string | null;
  action: string;
  outcome: string;
  details?: Record<string, unknown>;
};

const PROFILE_COLS = `u.id, u.person_id as "personId", p.first_name as "firstName",
  p.last_name as "lastName", p.email, p.phone, u.status,
  u.auth_subject as "authSubject", u.last_login_at as "lastLoginAt",
  u.created_at as "createdAt", u.updated_at as "updatedAt"`;

function supporterWhere(status: "active" | "disabled", search: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [status];
  const terms = [
    `u.kind = 'supporter'`,
    `u.status = $1`,
    `not exists (
      select 1 from org_memberships om
       where om.user_id = u.id and om.status = 'active'
    )`,
  ];
  if (search !== "") {
    params.push(`%${search.toLowerCase()}%`);
    terms.push(`(
      lower(p.email) like $${params.length}
      or coalesce(p.phone, '') like $${params.length}
      or coalesce(to_char(u.last_login_at, 'Mon DD, YYYY'), '') ilike $${params.length}
      or lower(p.first_name || ' ' || p.last_name) like $${params.length}
      or lower(p.last_name || ' ' || p.first_name) like $${params.length}
    )`);
  }
  return { sql: terms.join(" and "), params };
}

export async function list(
  ctx: DbContext,
  input: { status: "active" | "disabled"; search?: string; page?: number; pageSize?: number; sort?: "name" | "email" | "lastLogin" | "donations" | "volunteer"; direction?: "asc" | "desc" },
): Promise<{ supporters: SupporterDirectoryRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 25)));
  const search = (input.search ?? "").trim();
  const where = supporterWhere(input.status, search);
  const sortColumns = {
    name: "lower(p.last_name), lower(p.first_name)",
    email: "lower(p.email)",
    lastLogin: "u.last_login_at",
    donations: `(select count(*) from item_pledges ip2 where ip2.person_id = u.person_id and ip2.status = 'active')`,
    volunteer: `(select count(*) from volunteer_signups vs2 where vs2.person_id = u.person_id and vs2.status = 'active')`,
  } as const;
  const direction = input.direction === "desc" ? "desc" : "asc";
  const sort = (input.sort ?? "name") === "name"
    ? `lower(p.last_name) ${direction} nulls last, lower(p.first_name) ${direction} nulls last`
    : `${sortColumns[input.sort ?? "name"] ?? sortColumns.name} ${direction} nulls last`;
  const params = [...where.params, pageSize, (page - 1) * pageSize];
  return withDbContext(ctx, async (client) => {
    const rows = await q<SupporterDirectoryRow & { total: number }>(
      client,
      `select u.id, u.person_id as "personId", p.first_name as "firstName",
              p.last_name as "lastName", p.email, p.phone, u.status,
              u.last_login_at as "lastLoginAt", u.created_at as "createdAt",
              coalesce(vap.enabled, false) as "alertsEnabled",
               (select count(*)::int from item_pledges ip where ip.person_id = u.person_id and ip.status = 'active') as "pledgeCount",
               (select count(*)::int from volunteer_signups vs where vs.person_id = u.person_id and vs.status = 'active') as "signupCount",
              (select count(*)::int from request_engagement_events re where re.user_id = u.id) as "viewCount",
              count(*) over()::int as total
         from users u
         join people p on p.id = u.person_id
         left join volunteer_alert_preferences vap on vap.user_id = u.id
        where ${where.sql}
         order by ${sort}, u.id
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return {
      supporters: rows.map(({ total: _total, ...row }) => row),
      total: rows[0]?.total ?? 0,
      page,
      pageSize,
    };
  });
}

export async function getById(ctx: DbContext, userId: string): Promise<SupporterProfile | null> {
  return withDbContext(ctx, async (client) => {
    const rows = await q<SupporterProfile>(
      client,
      `select ${PROFILE_COLS},
              coalesce(vap.enabled, false) as "alertsEnabled",
              coalesce((
                select array_agg(vc.name order by vc.name)
                  from person_volunteer_interests pvi
                  join volunteer_categories vc on vc.id = pvi.category_id
                 where pvi.person_id = u.person_id
              ), '{}'::text[]) as "alertInterests"
         from users u
         join people p on p.id = u.person_id
         left join volunteer_alert_preferences vap on vap.user_id = u.id
        where u.id = $1 and u.kind = 'supporter'
          and not exists (
            select 1 from org_memberships om
             where om.user_id = u.id and om.status = 'active'
          )`,
      [userId],
    );
    return rows[0] ?? null;
  });
}

export async function getByIdInTx(client: PoolClient, userId: string, forUpdate = false): Promise<SupporterProfile | null> {
  const rows = await q<SupporterProfile>(
    client,
    `select ${PROFILE_COLS},
            coalesce(vap.enabled, false) as "alertsEnabled",
            '{}'::text[] as "alertInterests"
       from users u
       join people p on p.id = u.person_id
       left join volunteer_alert_preferences vap on vap.user_id = u.id
      where u.id = $1 and u.kind = 'supporter'
        and not exists (
          select 1 from org_memberships om
           where om.user_id = u.id and om.status = 'active'
        )${forUpdate ? " for update of u, p" : ""}`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function recordAuditInTx(client: PoolClient, input: SupporterAdminAuditInput): Promise<void> {
  await client.query(
    `insert into supporter_admin_audit
       (actor_user_id, target_user_id, context_id, action, outcome, details)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.actorUserId,
      input.targetUserId,
      input.contextId ?? null,
      input.action,
      input.outcome,
      JSON.stringify(input.details ?? {}),
    ],
  );
}

export async function recordAudit(ctx: DbContext, input: SupporterAdminAuditInput): Promise<void> {
  return withDbContext(ctx, (client) => recordAuditInTx(client, input));
}

export type ContactUpdateInput = {
  actorUserId: string;
  targetUserId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  requestedEmail: string;
  confirmationTokenHash: string | null;
  confirmationToken?: string;
};

export type ContactUpdateResult = {
  supporter: SupporterProfile;
  emailChanged: boolean;
  pendingEmail: string | null;
};

export class SupporterNotFoundError extends Error {}
export class SupporterEmailConflictError extends Error {}

export async function updateContact(
  ctx: DbContext,
  input: ContactUpdateInput,
): Promise<ContactUpdateResult> {
  return withDbContext(ctx, async (client) => {
    const supporter = await getByIdInTx(client, input.targetUserId, true);
    if (!supporter) throw new SupporterNotFoundError();
    const normalizedEmail = input.requestedEmail.trim().toLowerCase();
    const emailChanged = normalizedEmail !== supporter.email.toLowerCase();
    const personConflict = await q<{ id: string }>(
      client,
      `select id from people where id <> $1 and lower(btrim(email)) = $2 limit 1`,
      [supporter.personId, normalizedEmail],
    );
    if (personConflict[0]) throw new SupporterEmailConflictError();
    if (emailChanged) {
      const authConflict = await q<{ id: string }>(
        client,
        `select id from "user" where lower(email) = $1 and id <> $2`,
        [normalizedEmail, supporter.authSubject],
      );
      if (authConflict[0]) throw new SupporterEmailConflictError();
    }

    // A linked account retains its current identity until the mailbox owner
    // confirms the new address. Names and phone are safe to save immediately.
    await q<Person>(
      client,
      `update people set first_name = $2, last_name = $3, phone = $4
        where id = $1 returning id, first_name as "firstName", last_name as "lastName",
          email, phone, needs_review as "needsReview", review_note as "reviewNote",
          source_note as "sourceNote", legacy_wix_contact_id as "legacyWixContactId",
          created_at as "createdAt", updated_at as "updatedAt"`,
      [supporter.personId, input.firstName, input.lastName, input.phone],
    );
    if (!supporter.authSubject) throw new Error("Supporter account is missing its auth identity.");
    await client.query(
      `update "user" set name = $2, "updatedAt" = now() where id = $1`,
      [supporter.authSubject, `${input.firstName} ${input.lastName}`],
    );
    if (emailChanged) {
      if (!input.confirmationTokenHash) throw new Error("Email confirmation token is missing.");
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.targetUserId]);
      await client.query(
        `delete from verification where identifier like 'profile-email-change:%'
           and value is json object and value::jsonb ->> 'userId' = $1`,
        [input.targetUserId],
      );
      await client.query(
        `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, $2, now() + interval '1 hour', now(), now())`,
        [
          `profile-email-change:${input.confirmationTokenHash}`,
          JSON.stringify({
            userId: input.targetUserId,
            personId: supporter.personId,
            authUserId: supporter.authSubject,
            newEmail: normalizedEmail,
            initiatedByUserId: input.actorUserId,
          }),
        ],
      );
    } else {
      await client.query(
        `delete from verification where identifier like 'profile-email-change:%'
           and value is json object and value::jsonb ->> 'userId' = $1`,
        [input.targetUserId],
      );
    }
    await recordAuditInTx(client, {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: "contact_edit",
      outcome: emailChanged ? "confirmation_pending" : "success",
      details: { emailChanged, pendingEmail: emailChanged ? normalizedEmail : null },
    });
    const updated = await getByIdInTx(client, input.targetUserId);
    if (!updated) throw new Error("Supporter account disappeared after contact update.");
    return { supporter: updated, emailChanged, pendingEmail: emailChanged ? normalizedEmail : null };
  });
}

export async function recordEmailConfirmation(
  ctx: DbContext,
  input: { actorUserId: string; targetUserId: string; newEmail: string },
): Promise<void> {
  await recordAudit(ctx, {
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    action: "contact_email_confirm",
    outcome: "success",
    details: { newEmail: input.newEmail },
  });
}

export async function changeStatus(
  ctx: DbContext,
  input: { actorUserId: string; targetUserId: string; status: "active" | "disabled" },
): Promise<SupporterProfile> {
  return withDbContext(ctx, async (client) => {
    const supporter = await getByIdInTx(client, input.targetUserId, true);
    if (!supporter) throw new SupporterNotFoundError();
    if (supporter.status === input.status) return supporter;
    await client.query(`update users set status = $2 where id = $1`, [input.targetUserId, input.status]);
    if (input.status === "disabled") {
      const ended = await q<{ id: string; adminUserId: string }>(
        client,
        `update supporter_impersonation_contexts
            set ended_at = now(), end_reason = 'target_disabled'
          where supporter_user_id = $1 and ended_at is null
          returning id, admin_user_id as "adminUserId"`,
        [input.targetUserId],
      );
      for (const context of ended) {
        await recordAuditInTx(client, {
          actorUserId: context.adminUserId,
          targetUserId: input.targetUserId,
          contextId: context.id,
          action: "impersonate",
          outcome: "target_disabled",
        });
      }
    }
    await recordAuditInTx(client, {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.status === "disabled" ? "disable" : "reactivate",
      outcome: "success",
    });
    const updated = await getByIdInTx(client, input.targetUserId);
    if (!updated) throw new Error("Supporter account disappeared after status change.");
    return updated;
  });
}