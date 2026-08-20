/**
 * Supporter matching-alert consent, recipient resolution, and once-only
 * approval claims.
 *
 * The recipient query intentionally repeats every eligibility predicate. A
 * caller cannot accidentally alert an opted-out/disabled supporter or publish
 * an archived, expired, uncategorized, or unapproved-organization request by
 * relying on an earlier read.
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import { replaceForPersonInTx } from "./volunteer-interests";

export type VolunteerAlertPreference = {
  enabled: boolean;
};

export type MatchingVolunteerRecipient = {
  userId: string;
  personId: string;
  firstName: string;
  email: string;
  unsubscribeToken: string;
  matchingCategoryNames: string[];
};

export class VolunteerAlertUserScopeError extends Error {
  constructor() {
    super("Volunteer alert preferences are scoped to the signed-in supporter.");
    this.name = "VolunteerAlertUserScopeError";
  }
}

export class VolunteerAlertSupporterOnlyError extends Error {
  constructor() {
    super("Matching volunteer alerts are available only for supporter profiles.");
    this.name = "VolunteerAlertSupporterOnlyError";
  }
}

async function assertUserScope(c: PoolClient, ctx: DbContext, userId: string): Promise<void> {
  if (ctx.kind === "member" && ctx.userId !== userId) throw new VolunteerAlertUserScopeError();
  if (ctx.kind === "staff" && ctx.userId !== userId) throw new VolunteerAlertUserScopeError();
  const rows = await q<{ allowed: boolean }>(
    c,
    `select exists(
       select 1 from users
        where id = $1
          and ($2 = 'system' or id = nullif(current_setting('app.user_id', true), '')::uuid)
     ) as allowed`,
    [userId, ctx.kind],
  );
  if (rows[0]?.allowed !== true) throw new VolunteerAlertUserScopeError();
}

export async function getForUser(ctx: DbContext, userId: string): Promise<VolunteerAlertPreference> {
  return withDbContext(ctx, async (c) => {
    await assertUserScope(c, ctx, userId);
    const rows = await q<VolunteerAlertPreference>(
      c,
      `select enabled from volunteer_alert_preferences where user_id = $1`,
      [userId],
    );
    return rows[0] ?? { enabled: false };
  });
}

/**
 * Save interests and, when supplied, alert consent in one transaction. Older
 * clients that omit `matchingAlertsEnabled` preserve the current consent.
 */
export async function saveSupporterPreferences(
  ctx: DbContext,
  input: {
    userId: string;
    personId: string;
    categoryIds: string[];
    matchingAlertsEnabled?: boolean;
  },
): Promise<VolunteerAlertPreference> {
  return withDbContext(ctx, async (c) => {
    await assertUserScope(c, ctx, input.userId);
    await replaceForPersonInTx(c, input.personId, input.categoryIds);

    if (input.matchingAlertsEnabled !== undefined) {
      const userRows = await q<{ kind: string; status: string }>(
        c,
        `select kind, status from users where id = $1 and person_id = $2 for update`,
        [input.userId, input.personId],
      );
      const user = userRows[0];
      if (!user) throw new VolunteerAlertUserScopeError();
      if (user.kind !== "supporter" || user.status !== "active") {
        throw new VolunteerAlertSupporterOnlyError();
      }
      await c.query(
        `insert into volunteer_alert_preferences
           (user_id, enabled, enabled_at, disabled_at)
         values
           ($1, $2, case when $2 then now() else null end, case when $2 then null else now() end)
         on conflict (user_id) do update
           set enabled = excluded.enabled,
               enabled_at = case
                 when excluded.enabled and not volunteer_alert_preferences.enabled then now()
                 else volunteer_alert_preferences.enabled_at
               end,
               disabled_at = case when excluded.enabled then null else now() end`,
        [input.userId, input.matchingAlertsEnabled],
      );
    }

    const rows = await q<VolunteerAlertPreference>(
      c,
      `select enabled from volunteer_alert_preferences where user_id = $1`,
      [input.userId],
    );
    return rows[0] ?? { enabled: false };
  });
}

/** Idempotent, token-scoped opt-out. The token can only disable, never enable. */
export async function disableByToken(ctx: DbContext, token: string): Promise<boolean> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ userId: string }>(
      c,
      `update volunteer_alert_preferences
          set enabled = false, disabled_at = coalesce(disabled_at, now())
        where unsubscribe_token = $1
        returning user_id as "userId"`,
      [token],
    ),
  );
  return rows.length > 0;
}

export async function listMatchingRecipientsInTx(
  c: PoolClient,
  volunteerRequestId: string,
): Promise<MatchingVolunteerRecipient[]> {
  return q<MatchingVolunteerRecipient>(
    c,
    `select u.id as "userId",
            p.id as "personId",
            p.first_name as "firstName",
            p.email,
            vap.unsubscribe_token as "unsubscribeToken",
            array_agg(distinct vc.name order by vc.name) as "matchingCategoryNames"
       from volunteer_requests r
       join organizations o
         on o.id = r.org_id
        and o.kind = 'member_org'
        and o.status = 'approved'
       join volunteer_request_categories vrc
         on vrc.volunteer_request_id = r.id
       join volunteer_categories vc
         on vc.id = vrc.category_id
        and vc.is_active
       join person_volunteer_interests pvi
         on pvi.category_id = vc.id
       join users u
         on u.person_id = pvi.person_id
        and u.kind = 'supporter'
        and u.status = 'active'
       join people p
         on p.id = u.person_id
       join volunteer_alert_preferences vap
         on vap.user_id = u.id
        and vap.enabled
      where r.id = $1
        and r.status = 'active'
        and (r.expires_on is null or r.expires_on >= (now() at time zone 'America/Los_Angeles')::date)
        and btrim(p.email) <> ''
      group by u.id, p.id, p.first_name, p.email, vap.unsubscribe_token
      order by u.id`,
    [volunteerRequestId],
  );
}

export async function listMatchingRecipients(
  ctx: DbContext,
  volunteerRequestId: string,
): Promise<MatchingVolunteerRecipient[]> {
  return withDbContext(ctx, (c) => listMatchingRecipientsInTx(c, volunteerRequestId));
}

/** Returns false when this request/account was already claimed. */
export async function claimRecipientInTx(
  c: PoolClient,
  input: { volunteerRequestId: string; userId: string; toEmail: string },
): Promise<boolean> {
  const rows = await q<{ userId: string }>(
    c,
    `insert into volunteer_match_alert_claims (volunteer_request_id, user_id, to_email)
     values ($1, $2, $3)
     on conflict do nothing
     returning user_id as "userId"`,
    [input.volunteerRequestId, input.userId, input.toEmail],
  );
  return rows.length > 0;
}