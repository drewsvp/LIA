import { q, withDbContext, type DbContext } from "../db/client";

export type EngagementEventType =
  | "card_click"
  | "detail_view"
  | "product_link_click"
  | "form_start"
  | "item_selected"
  | "role_selected";

export type RequestKind = "item" | "volunteer";

export type RecordEngagementInput = {
  clientEventId: string;
  eventType: EngagementEventType;
  requestKind: RequestKind;
  requestId: string;
  targetId: string | null;
  userId: string | null;
};

export type RecordEngagementResult = "recorded" | "duplicate" | "not_public" | "invalid_target";

/**
 * Validate visibility and child ownership in the same transaction that writes
 * the event. Runtime DB credentials bypass RLS, so every public predicate is
 * explicit here. A duplicate client id is a successful no-op.
 */
export async function recordPublicEvent(
  ctx: DbContext,
  input: RecordEngagementInput,
): Promise<RecordEngagementResult> {
  return withDbContext(ctx, async (client) => {
    const requestRows =
      input.requestKind === "item"
        ? await q<{ id: string }>(
            client,
            `select r.id
               from item_requests r
               join organizations o on o.id = r.org_id
              where r.id = $1
                and r.status = 'active'
                and o.kind = 'member_org'
                and o.status = 'approved'
                and not item_request_expired_on(
                  r.deadline_type, r.deadline_date, r.expires_on,
                  item_request_current_la_date()
                )`,
            [input.requestId],
          )
        : await q<{ id: string }>(
            client,
            `select r.id
               from volunteer_requests r
               join organizations o on o.id = r.org_id
              where r.id = $1
                and r.status = 'active'
                and o.kind = 'member_org'
                and o.status = 'approved'
                and not (
                  (r.expires_on is not null and r.expires_on < item_request_current_la_date())
                  or (
                    r.deadline_type = 'date_specific'
                    and r.deadline_date is not null
                    and r.deadline_date < item_request_current_la_date()
                  )
                )`,
            [input.requestId],
          );
    if (!requestRows[0]) return "not_public";

    if (input.targetId !== null) {
      const childRows =
        input.requestKind === "item"
          ? await q<{ id: string }>(
              client,
              `select id from items where id = $1 and item_request_id = $2`,
              [input.targetId, input.requestId],
            )
          : await q<{ id: string }>(
              client,
              `select id from volunteer_roles where id = $1 and volunteer_request_id = $2`,
              [input.targetId, input.requestId],
            );
      if (!childRows[0]) return "invalid_target";
    }

    const rows = await q<{ inserted: boolean }>(
      client,
      `insert into request_engagement_events (
         client_event_id, event_type, request_kind,
         item_request_id, volunteer_request_id,
         item_id, volunteer_role_id, user_id
       )
       values (
         $1, $2, $3,
         case when $3 = 'item' then $4::uuid else null end,
         case when $3 = 'volunteer' then $4::uuid else null end,
         case when $3 = 'item' then $5::uuid else null end,
         case when $3 = 'volunteer' then $5::uuid else null end,
         $6
       )
       on conflict (client_event_id) do nothing
       returning true as inserted`,
      [
        input.clientEventId,
        input.eventType,
        input.requestKind,
        input.requestId,
        input.targetId,
        input.userId,
      ],
    );
    return rows[0]?.inserted === true ? "recorded" : "duplicate";
  });
}

export type RecentlyViewedRequest = {
  requestKind: RequestKind;
  requestId: string;
  title: string;
  orgName: string;
  lastViewedAt: string;
  available: boolean;
  converted: boolean;
};

/** Distinct detail views for exactly one signed-in user, newest first. */
export async function listRecentlyViewedForUser(
  ctx: DbContext,
  userId: string,
  personId: string,
  limit = 20,
): Promise<RecentlyViewedRequest[]> {
  return withDbContext(ctx, (client) =>
    q<RecentlyViewedRequest>(
      client,
      `with latest as (
         select request_kind,
                coalesce(item_request_id, volunteer_request_id) as request_id,
                max(created_at) as last_viewed_at
           from request_engagement_events
          where user_id = $1 and event_type = 'detail_view'
          group by request_kind, coalesce(item_request_id, volunteer_request_id)
       )
       select l.request_kind as "requestKind", l.request_id as "requestId",
              coalesce(ir.title, vr.title) as title, o.name as "orgName",
              l.last_viewed_at as "lastViewedAt",
              case
                when l.request_kind = 'item' then (
                  ir.status = 'active' and o.status = 'approved' and o.kind = 'member_org'
                  and not item_request_expired_on(
                    ir.deadline_type, ir.deadline_date, ir.expires_on,
                    item_request_current_la_date()
                  )
                )
                else (
                  vr.status = 'active' and o.status = 'approved' and o.kind = 'member_org'
                  and not (
                    (vr.expires_on is not null and vr.expires_on < item_request_current_la_date())
                    or (
                      vr.deadline_type = 'date_specific'
                      and vr.deadline_date is not null
                      and vr.deadline_date < item_request_current_la_date()
                    )
                  )
                )
              end as available,
              case
                when l.request_kind = 'item' then exists (
                  select 1 from item_pledges ip
                   where ip.person_id = $2 and ip.item_request_id = l.request_id
                )
                else exists (
                  select 1 from volunteer_signups vs
                   where vs.person_id = $2 and vs.volunteer_request_id = l.request_id
                )
              end as converted
         from latest l
         left join item_requests ir
           on l.request_kind = 'item' and ir.id = l.request_id
         left join volunteer_requests vr
           on l.request_kind = 'volunteer' and vr.id = l.request_id
         join organizations o on o.id = coalesce(ir.org_id, vr.org_id)
        order by l.last_viewed_at desc
        limit $3`,
      [userId, personId, limit],
    ),
  );
}

export type AnalyticsFilters = {
  from: string;
  to: string;
  kind: RequestKind | null;
  orgId: string | null;
};

export type RequestPerformanceRow = {
  requestKind: RequestKind;
  requestId: string;
  title: string;
  orgId: string;
  orgName: string;
  status: string;
  cardClicks: number;
  detailViews: number;
  productLinkClicks: number;
  formStarts: number;
  selections: number;
  conversions: number;
  conversionRate: number;
};

export type DailyMetricRow = {
  date: string;
  engagementEvents: number;
  detailViews: number;
  conversions: number;
};

export type AnalyticsReport = {
  performance: RequestPerformanceRow[];
  daily: DailyMetricRow[];
};

export async function listReportingOrganizations(
  ctx: DbContext,
): Promise<Array<{ id: string; name: string }>> {
  return withDbContext(ctx, (client) =>
    q<{ id: string; name: string }>(
      client,
      `select id, name
         from organizations
        where kind = 'member_org'
        order by name`,
    ),
  );
}

function analyticsParams(filters: AnalyticsFilters): readonly unknown[] {
  return [filters.from, filters.to, filters.kind, filters.orgId];
}

const REQUESTS_CTE = `
  requests as (
    select 'item'::text as request_kind, r.id as request_id, r.title,
           r.org_id, o.name as org_name, r.status
      from item_requests r join organizations o on o.id = r.org_id
    union all
    select 'volunteer'::text, r.id, r.title, r.org_id, o.name, r.status
      from volunteer_requests r join organizations o on o.id = r.org_id
  )`;

const EVENT_WINDOW = `
  e.created_at >= ($1::date::timestamp at time zone 'America/Los_Angeles')
  and e.created_at < (($2::date + 1)::timestamp at time zone 'America/Los_Angeles')`;

const CONVERSION_WINDOW = `
  created_at >= ($1::date::timestamp at time zone 'America/Los_Angeles')
  and created_at < (($2::date + 1)::timestamp at time zone 'America/Los_Angeles')`;

/** Aggregate-only organization or staff report. No viewer identity is selected. */
export async function getAnalyticsReport(
  ctx: DbContext,
  filters: AnalyticsFilters,
): Promise<AnalyticsReport> {
  return withDbContext(ctx, async (client) => {
    const performance = await q<RequestPerformanceRow>(
      client,
      `with ${REQUESTS_CTE},
       event_counts as (
         select request_kind, coalesce(item_request_id, volunteer_request_id) as request_id,
                count(*) filter (where event_type = 'card_click')::int as card_clicks,
                count(*) filter (where event_type = 'detail_view')::int as detail_views,
                count(*) filter (where event_type = 'product_link_click')::int as product_link_clicks,
                count(*) filter (where event_type = 'form_start')::int as form_starts,
                count(*) filter (where event_type in ('item_selected', 'role_selected'))::int as selections
           from request_engagement_events e
          where ${EVENT_WINDOW}
          group by request_kind, coalesce(item_request_id, volunteer_request_id)
       ),
       conversions as (
         select 'item'::text as request_kind, item_request_id as request_id, count(*)::int as conversions
           from item_pledges where ${CONVERSION_WINDOW}
          group by item_request_id
         union all
         select 'volunteer'::text, volunteer_request_id, count(*)::int
           from volunteer_signups where ${CONVERSION_WINDOW}
          group by volunteer_request_id
       )
       select r.request_kind as "requestKind", r.request_id as "requestId",
              r.title, r.org_id as "orgId", r.org_name as "orgName", r.status,
              coalesce(e.card_clicks, 0)::int as "cardClicks",
              coalesce(e.detail_views, 0)::int as "detailViews",
              coalesce(e.product_link_clicks, 0)::int as "productLinkClicks",
              coalesce(e.form_starts, 0)::int as "formStarts",
              coalesce(e.selections, 0)::int as selections,
              coalesce(c.conversions, 0)::int as conversions,
              case when coalesce(e.detail_views, 0) = 0 then 0
                   else round((coalesce(c.conversions, 0)::numeric / e.detail_views) * 100, 1)::float
               end as "conversionRate"
         from requests r
         left join event_counts e using (request_kind, request_id)
         left join conversions c using (request_kind, request_id)
        where ($3::text is null or r.request_kind = $3)
          and ($4::uuid is null or r.org_id = $4)
        order by coalesce(e.detail_views, 0) desc, r.title asc`,
      analyticsParams(filters),
    );

    const daily = await q<DailyMetricRow>(
      client,
      `with ${REQUESTS_CTE},
       events as (
         select (e.created_at at time zone 'America/Los_Angeles')::date as date,
                count(*)::int as engagement_events,
                count(*) filter (where e.event_type = 'detail_view')::int as detail_views
           from request_engagement_events e
           join requests r
             on r.request_kind = e.request_kind
            and r.request_id = coalesce(e.item_request_id, e.volunteer_request_id)
          where ${EVENT_WINDOW}
            and ($3::text is null or r.request_kind = $3)
            and ($4::uuid is null or r.org_id = $4)
          group by date
       ),
       conversion_rows as (
         select ip.created_at, 'item'::text as request_kind, ip.item_request_id as request_id
           from item_pledges ip
         union all
         select vs.created_at, 'volunteer'::text, vs.volunteer_request_id
           from volunteer_signups vs
       ),
       conversions as (
         select (c.created_at at time zone 'America/Los_Angeles')::date as date,
                count(*)::int as conversions
           from conversion_rows c
           join requests r using (request_kind, request_id)
          where c.created_at >= ($1::date::timestamp at time zone 'America/Los_Angeles')
            and c.created_at < (($2::date + 1)::timestamp at time zone 'America/Los_Angeles')
            and ($3::text is null or r.request_kind = $3)
            and ($4::uuid is null or r.org_id = $4)
          group by date
       ),
       dates as (
         select generate_series($1::date, $2::date, interval '1 day')::date as date
       )
       select d.date::text as date,
              coalesce(e.engagement_events, 0)::int as "engagementEvents",
              coalesce(e.detail_views, 0)::int as "detailViews",
              coalesce(c.conversions, 0)::int as conversions
         from dates d
         left join events e using (date)
         left join conversions c using (date)
        order by d.date`,
      analyticsParams(filters),
    );
    return { performance, daily };
  });
}

export type AudienceRow = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  requestKind: RequestKind;
  requestId: string;
  requestTitle: string;
  orgName: string;
  lastViewedAt: string;
};

export type OutreachRecipient = {
  userId: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  requestKind: RequestKind;
  requestId: string;
  requestTitle: string;
  orgName: string;
  lastViewedAt: string;
};

export type OutreachEligibility = {
  request: { kind: RequestKind; id: string; title: string; orgName: string } | null;
  recipients: OutreachRecipient[];
  preferenceExcludedCount: number;
};

export async function listUnconvertedViewers(
  ctx: DbContext,
  filters: AnalyticsFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: AudienceRow[]; total: number }> {
  return withDbContext(ctx, async (client) => {
    const params = [...analyticsParams(filters), pageSize, (page - 1) * pageSize];
    const base = `
      with ${REQUESTS_CTE},
      viewed as (
        select e.user_id, e.request_kind,
               coalesce(e.item_request_id, e.volunteer_request_id) as request_id,
               max(e.created_at) as last_viewed_at
          from request_engagement_events e
         where e.user_id is not null
           and e.event_type = 'detail_view'
           and ${EVENT_WINDOW}
         group by e.user_id, e.request_kind,
                  coalesce(e.item_request_id, e.volunteer_request_id)
      ),
      eligible as (
        select v.user_id, v.request_kind, v.request_id, v.last_viewed_at,
               r.title, r.org_name, u.person_id, p.first_name, p.last_name, p.email
          from viewed v
          join requests r using (request_kind, request_id)
          join users u
            on u.id = v.user_id
           and u.status = 'active'
           and u.kind = 'supporter'
          join people p on p.id = u.person_id
         where ($3::text is null or v.request_kind = $3)
           and ($4::uuid is null or r.org_id = $4)
           and (
             (v.request_kind = 'item' and not exists (
               select 1 from item_pledges ip
                where ip.person_id = u.person_id and ip.item_request_id = v.request_id
             ))
             or
             (v.request_kind = 'volunteer' and not exists (
               select 1 from volunteer_signups vs
                where vs.person_id = u.person_id and vs.volunteer_request_id = v.request_id
             ))
           )
      )`;
    const rows = await q<AudienceRow>(
      client,
      `${base}
       select user_id as "userId", first_name as "firstName", last_name as "lastName",
              email, request_kind as "requestKind", request_id as "requestId",
              title as "requestTitle", org_name as "orgName",
              last_viewed_at as "lastViewedAt"
         from eligible
        order by last_viewed_at desc, user_id
        limit $5 offset $6`,
      params,
    );
    const totals = await q<{ total: number }>(
      client,
      `${base} select count(*)::int as total from eligible`,
      analyticsParams(filters),
    );
    return { rows, total: totals[0]?.total ?? 0 };
  });
}

/**
 * Resolve a staff-selected outreach audience from the authoritative event and
 * conversion records. The caller supplies only ids from an earlier screen;
 * every current predicate is intentionally rechecked here before preview,
 * export, or delivery. Anonymous rows cannot join because user_id is required.
 *
 * Volunteer outreach is communication about a volunteer opportunity, so it
 * observes the explicit matching-alert consent setting. Item outreach has no
 * equivalent communication preference in the current product.
 */
export async function listEligibleOutreachRecipients(
  ctx: DbContext,
  input: { requestKind: RequestKind; requestId: string; userIds: readonly string[] },
): Promise<OutreachEligibility> {
  if (input.userIds.length === 0) {
    return { request: null, recipients: [], preferenceExcludedCount: 0 };
  }
  return withDbContext(ctx, async (client) => {
    const rows = await q<
      OutreachRecipient & {
        preferenceEligible: boolean;
      }
    >(
      client,
      `with selected_request as (
         select 'item'::text as request_kind, r.id as request_id, r.title,
                o.name as org_name,
                r.status = 'active'
                  and o.kind = 'member_org'
                  and o.status = 'approved'
                  and not item_request_expired_on(
                    r.deadline_type, r.deadline_date, r.expires_on,
                    item_request_current_la_date()
                  ) as available
           from item_requests r
           join organizations o on o.id = r.org_id
          where $1 = 'item' and r.id = $2
         union all
         select 'volunteer'::text, r.id, r.title, o.name,
                r.status = 'active'
                  and o.kind = 'member_org'
                  and o.status = 'approved'
                  and not (
                    (r.expires_on is not null and r.expires_on < item_request_current_la_date())
                    or (
                      r.deadline_type = 'date_specific'
                      and r.deadline_date is not null
                      and r.deadline_date < item_request_current_la_date()
                    )
                  )
           from volunteer_requests r
           join organizations o on o.id = r.org_id
          where $1 = 'volunteer' and r.id = $2
       ),
       viewed as (
         select e.user_id, max(e.created_at) as last_viewed_at
           from request_engagement_events e
          where e.user_id = any($3::uuid[])
            and e.event_type = 'detail_view'
            and e.request_kind = $1
            and coalesce(e.item_request_id, e.volunteer_request_id) = $2
          group by e.user_id
       ),
       unconverted as (
         select v.user_id, v.last_viewed_at, sr.request_kind, sr.request_id,
                sr.title, sr.org_name, u.person_id, p.first_name, p.last_name, p.email,
                case when sr.request_kind = 'volunteer'
                     then coalesce(vap.enabled, false)
                     else true end as preference_eligible
           from viewed v
           join selected_request sr on sr.available
           join users u
             on u.id = v.user_id
            and u.status = 'active'
            and u.kind = 'supporter'
           join people p on p.id = u.person_id
           left join volunteer_alert_preferences vap on vap.user_id = u.id
          where btrim(p.email) <> ''
            and (
              (sr.request_kind = 'item' and not exists (
                select 1 from item_pledges ip
                 where ip.person_id = u.person_id and ip.item_request_id = sr.request_id
              ))
              or
              (sr.request_kind = 'volunteer' and not exists (
                select 1 from volunteer_signups vs
                 where vs.person_id = u.person_id and vs.volunteer_request_id = sr.request_id
              ))
            )
       )
       select user_id as "userId", person_id as "personId",
              first_name as "firstName", last_name as "lastName", email,
              request_kind as "requestKind", request_id as "requestId",
              title as "requestTitle", org_name as "orgName",
              last_viewed_at as "lastViewedAt",
              preference_eligible as "preferenceEligible"
         from unconverted
        order by last_viewed_at desc, user_id`,
      [input.requestKind, input.requestId, input.userIds],
    );
    const request = rows[0]
      ? {
          kind: rows[0].requestKind,
          id: rows[0].requestId,
          title: rows[0].requestTitle,
          orgName: rows[0].orgName,
        }
      : null;
    const preferenceExcludedCount = rows.filter((row) => !row.preferenceEligible).length;
    return {
      request,
      recipients: rows
        .filter((row) => row.preferenceEligible)
        .map(({ preferenceEligible: _preferenceEligible, ...recipient }) => recipient),
      preferenceExcludedCount,
    };
  });
}
