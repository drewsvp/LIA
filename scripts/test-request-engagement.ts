/**
 * End-to-end privacy/authorization regression coverage for request engagement.
 * Requires the development workflow and seeded quick-login accounts.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-request-engagement.ts
 */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db/client";

const BASE = "http://127.0.0.1:5000";
const marker = `zz_fixture_engagement_${process.pid}`;
const eventIds: string[] = [];
let fixturePledgeId: string | null = null;
let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`, detail ?? "");
  }
}

function responseCookies(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function quickLogin(role: "staff_admin" | "staff_approver" | "org_owner"): Promise<string> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error(`quick login ${role} failed: ${response.status} ${await response.text()}`);
  return responseCookies(response);
}

async function json<T>(path: string, cookie = ""): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
  return { response, body: (await response.json()) as T };
}

type EventBody = {
  eventId: string;
  eventType: string;
  requestKind: "item" | "volunteer";
  requestId: string;
  targetId?: string;
  [key: string]: unknown;
};

async function postEvent(body: EventBody, cookie = ""): Promise<Response> {
  eventIds.push(body.eventId);
  return fetch(`${BASE}/api/public/engagement`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const [adminCookie, approverCookie, ownerCookie] = await Promise.all([
    quickLogin("staff_admin"),
    quickLogin("staff_approver"),
    quickLogin("org_owner"),
  ]);
  const adminSession = (await json<{ user: { id: string; personId: string }; activeOrgId: string | null }>(
    "/api/session",
    adminCookie,
  )).body;
  const ownerSession = (await json<{ user: { id: string; personId: string }; activeOrgId: string | null }>(
    "/api/session",
    ownerCookie,
  )).body;

  const browse = (
    await json<{
      requests: Array<{ id: string; title: string }>;
    }>("/api/public/item-requests")
  ).body;
  if (browse.requests.length < 2) throw new Error("test needs at least two active public item requests");
  if (!ownerSession.activeOrgId) throw new Error("organization owner session has no active organization");
  const publicRequestRows = await pool.query<{ id: string; title: string; org_id: string }>(
    `select ir.id, ir.title, ir.org_id
       from item_requests ir
       join organizations o on o.id = ir.org_id
      where ir.status = 'active'
        and o.kind = 'member_org'
        and o.status = 'approved'
        and exists (select 1 from items i where i.item_request_id = ir.id)
        and not item_request_expired_on(
          ir.deadline_type, ir.deadline_date, ir.expires_on,
          item_request_current_la_date()
        )
      order by ir.created_at`,
  );
  const ownerRequest = publicRequestRows.rows.find((row) => row.org_id === ownerSession.activeOrgId);
  const adminRequest = publicRequestRows.rows.find((row) => row.org_id !== ownerSession.activeOrgId);
  if (!ownerRequest || !adminRequest) {
    throw new Error("test needs public item requests inside and outside the owner's organization");
  }
  assert(
    browse.requests.some((row) => row.id === ownerRequest.id) &&
      browse.requests.some((row) => row.id === adminRequest.id),
    "organization reporting fixtures are publicly browseable",
  );
  const detail = (
    await json<{ items: Array<{ id: string }> }>(`/api/public/item-requests/${adminRequest.id}`)
  ).body;
  if (!detail.items[0]) throw new Error("test needs a public request with an item");
  const volunteerBrowse = (
    await json<{ requests: Array<{ id: string; title: string }> }>("/api/public/volunteer-requests")
  ).body;
  if (!volunteerBrowse.requests[0]) throw new Error("test needs an active public volunteer request");
  const volunteerRequest = volunteerBrowse.requests[0];

  // Allowlisting, shape, visibility, and child ownership.
  const malformed = await postEvent({
    eventId: randomUUID(),
    eventType: "unsupported",
    requestKind: "item",
    requestId: adminRequest.id,
  });
  assert(malformed.status === 400, "unsupported event types are rejected", malformed.status);

  const extraField = await postEvent({
    eventId: randomUUID(),
    eventType: "detail_view",
    requestKind: "item",
    requestId: adminRequest.id,
    email: "must-not-be-captured@example.test",
  });
  assert(extraField.status === 400, "unexpected identifying/form fields are rejected", extraField.status);

  const wrongChild = await postEvent({
    eventId: randomUUID(),
    eventType: "item_selected",
    requestKind: "item",
    requestId: adminRequest.id,
    targetId: randomUUID(),
  });
  assert(wrongChild.status === 400, "a child outside the request is rejected", wrongChild.status);
  const wrongRole = await postEvent({
    eventId: randomUUID(),
    eventType: "role_selected",
    requestKind: "volunteer",
    requestId: volunteerRequest.id,
    targetId: randomUUID(),
  });
  assert(wrongRole.status === 400, "a role outside the volunteer request is rejected", wrongRole.status);

  const foreignItem = await pool.query<{ id: string; item_request_id: string }>(
    `select id, item_request_id from items where item_request_id <> $1 limit 1`,
    [adminRequest.id],
  );
  if (!foreignItem.rows[0]) throw new Error("test needs an item on another request");
  const dbOwnershipEventId = randomUUID();
  eventIds.push(dbOwnershipEventId);
  let ownershipConstraint = false;
  try {
    await pool.query(
      `insert into request_engagement_events (
         client_event_id, event_type, request_kind, item_request_id, item_id
       ) values ($1, 'item_selected', 'item', $2, $3)`,
      [dbOwnershipEventId, adminRequest.id, foreignItem.rows[0].id],
    );
  } catch (err) {
    ownershipConstraint =
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string; constraint?: string }).code === "23503" &&
      (err as { constraint?: string }).constraint === "request_engagement_item_ownership_fk";
  }
  assert(ownershipConstraint, "database constraints reject a child attached to the wrong request");

  const nonPublicRows = await pool.query<{ id: string }>(
    `select id from item_requests where status <> 'active' order by created_at limit 1`,
  );
  if (!nonPublicRows.rows[0]) throw new Error("test needs a non-public item request");
  const nonPublic = await postEvent({
    eventId: randomUUID(),
    eventType: "detail_view",
    requestKind: "item",
    requestId: nonPublicRows.rows[0].id,
  });
  assert(nonPublic.status === 404, "non-public request events are rejected without disclosure", nonPublic.status);

  // Anonymous aggregation and idempotency.
  const anonymousEventId = randomUUID();
  const anonymousBody: EventBody = {
    eventId: anonymousEventId,
    eventType: "detail_view",
    requestKind: "item",
    requestId: adminRequest.id,
  };
  const firstAnonymous = await postEvent(anonymousBody);
  const duplicateAnonymous = await postEvent(anonymousBody);
  assert(firstAnonymous.status === 202 && duplicateAnonymous.status === 202, "duplicate delivery is harmless");
  const anonymousRows = await pool.query<{ count: string; user_id: string | null }>(
    `select count(*)::text as count, max(user_id::text) as user_id
       from request_engagement_events where client_event_id = $1`,
    [anonymousEventId],
  );
  assert(anonymousRows.rows[0]?.count === "1", "one event id stores exactly one row", anonymousRows.rows[0]);
  assert(anonymousRows.rows[0]?.user_id === null, "anonymous rows contain no user attribution", anonymousRows.rows[0]);

  // Signed-in attribution and strict self-history.
  const adminViewId = randomUUID();
  const adminVolunteerViewId = randomUUID();
  const ownerViewId = randomUUID();
  assert(
    (
      await postEvent(
        {
          eventId: adminVolunteerViewId,
          eventType: "detail_view",
          requestKind: "volunteer",
          requestId: volunteerRequest.id,
        },
        adminCookie,
      )
    ).status === 202,
    "signed-in volunteer detail view is accepted",
  );
  assert(
    (
      await postEvent(
        {
          eventId: adminViewId,
          eventType: "detail_view",
          requestKind: "item",
          requestId: adminRequest.id,
        },
        adminCookie,
      )
    ).status === 202,
    "signed-in event is accepted",
  );
  assert(
    (
      await postEvent(
        {
          eventId: ownerViewId,
          eventType: "detail_view",
          requestKind: "item",
          requestId: ownerRequest.id,
        },
        ownerCookie,
      )
    ).status === 202,
    "a second signed-in user's event is accepted",
  );
  const signedRows = await pool.query<{ client_event_id: string; user_id: string | null }>(
    `select client_event_id::text, user_id::text
       from request_engagement_events
      where client_event_id = any($1::uuid[])`,
    [[adminViewId, adminVolunteerViewId, ownerViewId]],
  );
  const attribution = new Map(signedRows.rows.map((row) => [row.client_event_id, row.user_id]));
  assert(attribution.get(adminViewId) === adminSession.user.id, "session user is attached to signed-in activity");
  assert(
    attribution.get(adminVolunteerViewId) === adminSession.user.id,
    "signed-in attribution applies to volunteer activity",
  );
  assert(attribution.get(ownerViewId) === ownerSession.user.id, "attribution never crosses signed-in users");

  type Profile = {
    recentlyViewed: Array<{ requestId: string; converted: boolean; lastViewedAt: string }>;
  };
  const adminProfile = await json<Profile>("/api/supporter/profile", adminCookie);
  const ownerProfile = await json<Profile>("/api/supporter/profile", ownerCookie);
  assert(adminProfile.response.status === 200 && ownerProfile.response.status === 200, "authenticated self-history loads");
  assert(
    adminProfile.body.recentlyViewed.some((row) => row.requestId === adminRequest.id) &&
      adminProfile.body.recentlyViewed.some((row) => row.requestId === volunteerRequest.id) &&
      !adminProfile.body.recentlyViewed.some((row) => row.requestId === ownerRequest.id),
    "self-history includes item and volunteer views but not another user's unique view",
  );
  assert(
    ownerProfile.body.recentlyViewed.some((row) => row.requestId === ownerRequest.id) &&
      !ownerProfile.body.recentlyViewed.some((row) => row.requestId === adminRequest.id),
    "recent history is isolated in both directions",
  );

  // Organization reporting is session scoped and aggregate-only.
  const ownerReport = await json<{
    daily: Array<{ engagementEvents: number; detailViews: number }>;
    performance: Array<{ requestId: string; orgId: string; detailViews: number }>;
  }>("/api/dashboard/engagement", ownerCookie);
  assert(ownerReport.response.status === 200, "organization engagement report loads");
  assert(
    ownerReport.body.performance.every((row) => row.orgId === ownerSession.activeOrgId),
    "organization report contains only the session-selected organization",
  );
  assert(
    ownerReport.body.performance.some(
      (row) =>
        row.requestId === ownerRequest.id &&
        row.orgId === ownerSession.activeOrgId &&
        row.detailViews >= 1,
    ) &&
      ownerReport.body.daily.some((row) => row.engagementEvents >= 1 && row.detailViews >= 1),
    "organization report includes its recorded engagement with nonzero metrics",
  );
  assert(
    !ownerReport.body.performance.some((row) => row.requestId === adminRequest.id),
    "events for another organization stay outside the member report",
  );
  const attemptedOverride = await json<{
    filters: { orgId: string };
    performance: Array<{ requestId: string; orgId: string; detailViews: number }>;
  }>(`/api/dashboard/engagement?orgId=${adminRequest.org_id}`, ownerCookie);
  assert(
    attemptedOverride.body.filters.orgId === ownerSession.activeOrgId &&
      attemptedOverride.body.performance.some(
        (row) => row.requestId === ownerRequest.id && row.detailViews >= 1,
      ) &&
      !attemptedOverride.body.performance.some((row) => row.requestId === adminRequest.id),
    "a caller-supplied organization cannot override the session organization",
  );
  assert(
    ownerReport.body.performance.every(
      (row) => !("email" in row) && !("userId" in row) && !("firstName" in row),
    ),
    "organization aggregates expose no viewer identities",
  );

  // Staff-admin authorization mirrors client discoverability.
  const adminReport = await json<{ performance: unknown[] }>("/api/admin/analytics", adminCookie);
  const approverReport = await json<{ message: string }>("/api/admin/analytics", approverCookie);
  const ownerAdminReport = await json<{ message: string }>("/api/admin/analytics", ownerCookie);
  assert(adminReport.response.status === 200, "staff admins can load analytics");
  assert(
    approverReport.response.status === 404 && approverReport.body.message === "Not found",
    "staff approvers cannot discover analytics",
  );
  assert(
    ownerAdminReport.response.status === 404 && ownerAdminReport.body.message === "Not found",
    "non-staff cannot discover analytics",
  );

  // Outreach audience is supporter-only; staff/member browsing never becomes
  // a selectable outreach identity.
  const beforeAudience = await json<{
    rows: Array<{ userId: string; requestId: string }>;
  }>("/api/admin/analytics/audience?pageSize=100", adminCookie);
  assert(
    !beforeAudience.body.rows.some(
      (row) => row.userId === adminSession.user.id && row.requestId === adminRequest.id,
    ),
    "staff viewers stay outside the supporter outreach audience",
  );
  const pledge = await pool.query<{ id: string }>(
    `insert into item_pledges (legacy_wix_id, person_id, item_request_id, notes)
     values ($1, $2, $3, 'request engagement regression fixture')
     returning id`,
    [marker, adminSession.user.personId, adminRequest.id],
  );
  fixturePledgeId = pledge.rows[0]!.id;
  const afterAudience = await json<{
    rows: Array<{ userId: string; requestId: string }>;
  }>("/api/admin/analytics/audience?pageSize=100", adminCookie);
  assert(
    !afterAudience.body.rows.some(
      (row) => row.userId === adminSession.user.id && row.requestId === adminRequest.id,
    ),
    "staff viewers remain outside the outreach audience after conversion",
  );
  const convertedProfile = await json<Profile>("/api/supporter/profile", adminCookie);
  assert(
    convertedProfile.body.recentlyViewed.some(
      (row) => row.requestId === adminRequest.id && row.converted,
    ),
    "recent history derives converted state from authoritative pledges",
  );
}

async function cleanup(): Promise<void> {
  if (fixturePledgeId) {
    await pool.query(`delete from item_pledges where id = $1`, [fixturePledgeId]);
  }
  if (eventIds.length > 0) {
    await pool.query(`delete from request_engagement_events where client_event_id = any($1::uuid[])`, [eventIds]);
  }
}

main()
  .catch((err) => {
    failed += 1;
    console.error(err);
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (err) {
      failed += 1;
      console.error("fixture cleanup failed", err);
    }
    await pool.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  });