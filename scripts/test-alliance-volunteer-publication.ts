/**
 * End-to-end regression coverage for Alliance volunteer and physical-need publication.
 * Requires the development workflow and seeded quick-login accounts.
 */
import { randomUUID } from "node:crypto";
import { pool, SYSTEM } from "../server/db/client";
import * as dal from "../server/dal";
import { resolveItemDropoffLocation } from "../client/src/pages/public/item-detail-location";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5000";
const runId = `${process.pid}-${Date.now()}`;
const title = `zz_fixture Alliance volunteer publication ${runId}`;
const itemTitle = `zz_fixture Alliance physical-need publication ${runId}`;
const supporterEmail = `zz.fixture.alliance-volunteer.${runId}@example.org`;
const signupEmail = `zz.fixture.alliance-signup.${runId}@example.org`;
const pledgeEmail = `zz.fixture.alliance-pledge.${runId}@example.org`;

let volunteerRequestId: string | null = null;
let volunteerRoleId: string | null = null;
let itemRequestId: string | null = null;
let itemId: string | null = null;
let pledgeId: string | null = null;
let supporterUserId: string | null = null;
let supporterPersonId: string | null = null;
let signupPersonId: string | null = null;
let pledgePersonId: string | null = null;
const engagementEventId = randomUUID();
const itemEngagementEventId = randomUUID();
const rlsRoleName = `zz_alliance_public_${process.pid}_${Date.now()}`;
let rlsRoleCreated = false;
let passed = 0;
let failed = 0;

function check(condition: unknown, label: string, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

function cookies(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  return (typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [])
    .map((value) => value.split(";")[0])
    .join("; ");
}

async function request(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // HTML share previews and empty error responses are asserted by status/text.
  }
  return { response, body };
}

function hasRequest(body: Record<string, unknown>, key: "requests" | "volunteerRequests" | "itemRequests", id: string): boolean {
  const rows = body[key];
  return Array.isArray(rows) && rows.some((row) => typeof row === "object" && row !== null && "id" in row && row.id === id);
}

async function publicRlsItemCounts(requestId: string, childId: string | null): Promise<{ requests: number; children: number } | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.context', 'public', true)");
    await client.query(`set local role ${rlsRoleName}`);
    const result = await client.query<{ requests: number; children: number }>(
      `select (select count(*)::int from item_requests where id = $1) as requests,
              (select count(*)::int from items where id = $2) as children`,
      [requestId, childId],
    );
    await client.query("rollback");
    return result.rows[0] ?? null;
  } finally {
    try {
      await client.query("rollback");
    } catch {
      // The transaction may already be closed.
    }
    client.release();
  }
}

async function main(): Promise<void> {
  const login = await request("/api/login/quick", {
    method: "POST",
    body: { role: "staff_admin" },
  });
  if (!login.response.ok) throw new Error(`staff quick login failed: ${login.response.status}`);
  const cookie = cookies(login.response);
  if (cookie === "") throw new Error("staff quick login returned no session cookie");

  const session = await request("/api/session", { cookie });
  const activeOrgId = typeof session.body.activeOrgId === "string" ? session.body.activeOrgId : null;
  const user = session.body.user as { id?: string; email?: string } | undefined;
  if (!activeOrgId || !user?.id || !user.email) throw new Error("staff session is missing its Alliance organization or user");

  const alliance = await dal.organizations.getById(SYSTEM, activeOrgId);
  if (!alliance || alliance.kind !== "platform_owner" || alliance.status !== "approved") {
    throw new Error("staff quick login did not resolve the approved Alliance organization");
  }
  const actorRows = await pool.query<{ firstName: string; lastName: string; personId: string }>(
    `select p.id as "personId", p.first_name as "firstName", p.last_name as "lastName"
       from users u join people p on p.id = u.person_id
      where u.id = $1`,
    [user.id],
  );
  const actor = actorRows.rows[0];
  if (!actor) throw new Error("staff user has no person row");

  const categories = await request("/api/dashboard/volunteer-categories", { cookie });
  const categoryRows = categories.body.categories;
  const categoryId =
    Array.isArray(categoryRows) && typeof categoryRows[0] === "object" && categoryRows[0] !== null && "id" in categoryRows[0]
      ? String(categoryRows[0].id)
      : null;
  if (!categoryId) throw new Error("no active volunteer category is available");

  const beforeApproval = new Date(Date.now() - 60_000).toISOString();
  try {
    console.log("\nAlliance member workflow and non-public states");
    const created = await request("/api/dashboard/volunteers", {
      method: "POST",
      cookie,
      body: {
        contactFirstName: actor.firstName,
        contactLastName: actor.lastName,
        contactEmail: user.email,
        contactPhone: "555-0100",
        title,
        description: "Temporary Alliance volunteer opportunity.",
        details: "Temporary regression fixture created through the organization dashboard API.",
        eventLocation: "Roseville",
        deadlineType: "ongoing",
        peopleHelped: 1,
        categoryIds: [categoryId],
      },
    });
    volunteerRequestId = typeof created.body.id === "string" ? created.body.id : null;
    check(created.response.status === 200 && volunteerRequestId !== null, "Alliance staff creates a volunteer draft");
    if (!volunteerRequestId) throw new Error("volunteer draft creation returned no id");

    let profile = await request(`/api/public/organizations/${alliance.slug}`);
    check(!hasRequest(profile.body, "volunteerRequests", volunteerRequestId), "draft is hidden from the Alliance profile");
    check((await request(`/api/public/volunteer-requests/${volunteerRequestId}`)).response.status === 404, "draft detail is hidden");

    const role = await request(`/api/dashboard/volunteers/${volunteerRequestId}/roles`, {
      method: "POST",
      cookie,
      body: { name: "Fixture helper", description: "Help with the fixture opportunity.", quantityNeeded: 2 },
    });
    const roleBody = role.body.role as { id?: string } | undefined;
    volunteerRoleId = typeof roleBody?.id === "string" ? roleBody.id : null;
    check(role.response.status === 200 && volunteerRoleId !== null, "Alliance staff adds a volunteer role");
    if (!volunteerRoleId) throw new Error("volunteer role creation returned no id");

    const submitted = await request(`/api/dashboard/volunteers/${volunteerRequestId}/submit`, {
      method: "POST",
      cookie,
    });
    check(submitted.response.status === 200, "Alliance staff submits through the normal approval workflow");
    check((await dal.volunteerRequests.getById(SYSTEM, volunteerRequestId))?.status === "pending", "submission is pending");
    check((await request(`/api/public/volunteer-requests/${volunteerRequestId}`)).response.status === 404, "pending detail is hidden");

    const supporter = await dal.people.create(SYSTEM, {
      firstName: "zz_fixture",
      lastName: "Alliance Match",
      email: supporterEmail,
      sourceNote: "zz_fixture Alliance volunteer publication regression",
    });
    supporterPersonId = supporter.id;
    const supporterUser = await dal.users.create(SYSTEM, {
      personId: supporter.id,
      status: "active",
      kind: "supporter",
    });
    supporterUserId = supporterUser.id;
    await pool.query(`insert into person_volunteer_interests (person_id, category_id) values ($1, $2)`, [
      supporter.id,
      categoryId,
    ]);
    await pool.query(`insert into volunteer_alert_preferences (user_id, enabled) values ($1, true)`, [supporterUser.id]);

    const approved = await request(`/api/admin/requests/volunteer/${volunteerRequestId}/approve`, {
      method: "POST",
      cookie,
    });
    check(approved.response.status === 200, "staff approval activates the Alliance opportunity", approved.body);
    check((await dal.volunteerRequests.getById(SYSTEM, volunteerRequestId))?.status === "active", "approved request is active");

    console.log("\nPublic discovery, action, and downstream behavior");
    const browse = await request("/api/public/volunteer-requests");
    profile = await request(`/api/public/organizations/${alliance.slug}`);
    const detail = await request(`/api/public/volunteer-requests/${volunteerRequestId}`);
    check(hasRequest(browse.body, "requests", volunteerRequestId), "opportunity appears in volunteer browse");
    check(hasRequest(profile.body, "volunteerRequests", volunteerRequestId), "opportunity appears on the Alliance profile");
    check(detail.response.status === 200, "public volunteer detail loads");

    const shareResponse = await fetch(`${BASE}/volunteer/${volunteerRequestId}`);
    const shareHtml = await shareResponse.text();
    check(shareResponse.status === 200 && shareHtml.includes(title), "server-rendered share preview uses the Alliance opportunity");

    const engagement = await request("/api/public/engagement", {
      method: "POST",
      body: {
        eventId: engagementEventId,
        eventType: "detail_view",
        requestKind: "volunteer",
        requestId: volunteerRequestId,
      },
    });
    check(engagement.response.status === 202, "public engagement accepts the Alliance opportunity");

    const digestNeeds = await dal.digestRuns.newActiveNeeds(SYSTEM, beforeApproval, new Date(Date.now() + 60_000).toISOString());
    check(
      digestNeeds.some((need) => need.type === "volunteer" && need.id === volunteerRequestId),
      "digest selection includes the Alliance opportunity",
    );
    const upcoming = await dal.digestRuns.upcomingNeeds(SYSTEM);
    check(upcoming.needs.some((need) => need.type === "volunteer" && need.id === volunteerRequestId), "digest preview includes it");

    const matchingRows = await pool.query<{ count: number }>(
      `select count(*)::int as count
         from volunteer_match_alert_claims
        where volunteer_request_id = $1 and user_id = $2`,
      [volunteerRequestId, supporterUserId],
    );
    check(matchingRows.rows[0]?.count === 1, "approval creates the matching-alert once-only claim");

    const outreachEvent = await pool.query<{ id: string }>(
      `insert into request_engagement_events
         (client_event_id, event_type, request_kind, volunteer_request_id, user_id)
       values (gen_random_uuid(), 'detail_view', 'volunteer', $1, $2)
       returning id`,
      [volunteerRequestId, supporterUserId],
    );
    check(outreachEvent.rows.length === 1, "attributed engagement fixture is recorded");
    const outreach = await dal.requestEngagement.listEligibleOutreachRecipients(SYSTEM, {
      requestKind: "volunteer",
      requestId: volunteerRequestId,
      userIds: [supporterUserId],
    });
    check(outreach.recipients.some((recipient) => recipient.userId === supporterUserId), "outreach revalidation includes it");

    const signup = await request(`/api/public/volunteer-requests/${volunteerRequestId}/signups`, {
      method: "POST",
      body: {
        firstName: "zz_fixture",
        lastName: "Alliance Signup",
        email: signupEmail,
        phone: "555-0110",
        notes: "Temporary regression signup.",
        roleIds: [volunteerRoleId],
      },
    });
    check(signup.response.status === 201, "public volunteer signup succeeds", signup.body);
    const counter = await pool.query<{ quantityInterested: number }>(
      `select quantity_interested as "quantityInterested" from volunteer_roles where id = $1`,
      [volunteerRoleId],
    );
    check(counter.rows[0]?.quantityInterested === 1, "signup updates the volunteer-role counter");
    const signupPerson = await dal.people.findByEmail(SYSTEM, signupEmail);
    signupPersonId = signupPerson?.id ?? null;
    const signupEmails = await pool.query<{ keys: string[] }>(
      `select coalesce(array_agg(distinct template_key), '{}') as keys
         from email_log
        where entity_type = 'volunteer_signup'
          and entity_id in (select id from volunteer_signups where volunteer_request_id = $1)`,
      [volunteerRequestId],
    );
    check(
      signupEmails.rows[0]?.keys.includes("donor_volunteer_confirmation") === true &&
        signupEmails.rows[0]?.keys.includes("org_new_volunteer") === true,
      "signup queues the normal volunteer notifications",
      signupEmails.rows[0]?.keys,
    );

    await pool.query(
      `update volunteer_requests
          set expires_on = (now() at time zone 'America/Los_Angeles')::date - 1
        where id = $1`,
      [volunteerRequestId],
    );
    check((await request(`/api/public/volunteer-requests/${volunteerRequestId}`)).response.status === 404, "expired opportunity is hidden");
    await pool.query(`update volunteer_requests set expires_on = null where id = $1`, [volunteerRequestId]);

    const archived = await request(`/api/admin/requests/volunteer/${volunteerRequestId}/archive`, {
      method: "POST",
      cookie,
    });
    check(archived.response.status === 200, "normal staff archive succeeds");
    check((await request(`/api/public/volunteer-requests/${volunteerRequestId}`)).response.status === 404, "archived detail is hidden");

    console.log("\nAlliance physical-need publication, parity, and RLS intent");
    await pool.query(`create role ${rlsRoleName} nologin`);
    rlsRoleCreated = true;
    await pool.query(
      `grant usage on schema public to ${rlsRoleName};
       grant select on organizations, item_requests, items to ${rlsRoleName}`,
    );
    const itemCreated = await request("/api/dashboard/items", {
      method: "POST",
      cookie,
      body: {
        contactFirstName: actor.firstName,
        contactLastName: actor.lastName,
        contactEmail: user.email,
        contactPhone: "555-0120",
        title: itemTitle,
        description: "Temporary Alliance physical need.",
        deadlineType: "until_fulfilled",
        peopleHelped: 1,
      },
    });
    itemRequestId = typeof itemCreated.body.id === "string" ? itemCreated.body.id : null;
    check(itemCreated.response.status === 200 && itemRequestId !== null, "Alliance staff creates a physical-need draft");
    if (!itemRequestId) throw new Error("physical-need draft creation returned no id");

    let itemBrowse = await request("/api/public/item-requests");
    profile = await request(`/api/public/organizations/${alliance.slug}`);
    check(!hasRequest(itemBrowse.body, "requests", itemRequestId), "physical-need draft is hidden from browse");
    check(!hasRequest(profile.body, "itemRequests", itemRequestId), "physical-need draft is hidden from the Alliance profile");
    check((await request(`/api/public/item-requests/${itemRequestId}`)).response.status === 404, "physical-need draft detail is hidden");
    const draftRls = await publicRlsItemCounts(itemRequestId, null);
    check(draftRls?.requests === 0, "a non-bypassing public role cannot read the physical-need draft", draftRls);

    const itemEdit = await request(`/api/dashboard/items/${itemRequestId}/edit`, { cookie });
    check(itemEdit.response.status === 200, "Alliance staff opens the physical-need dashboard edit endpoint");
    const edited = await request(`/api/dashboard/items/${itemRequestId}/edit/request`, {
      method: "POST",
      cookie,
      body: {
        contactFirstName: actor.firstName,
        contactLastName: actor.lastName,
        contactEmail: user.email,
        contactPhone: "555-0120",
        title: itemTitle,
        description: "Temporary Alliance physical need edited through the dashboard.",
        dropoffLocation: "Roseville",
        peopleHelped: 2,
        deadlineType: "until_fulfilled",
        deadlineDate: "",
        statusTo: null,
      },
    });
    check(edited.response.status === 200, "Alliance staff edits the physical-need dashboard draft");
    const addedItem = await request(`/api/dashboard/items/${itemRequestId}/edit/add-item`, {
      method: "POST",
      cookie,
      body: {
        name: "Alliance publication fixture item",
        description: "Temporary requested physical item.",
        productUrl: null,
        condition: "new",
        quantityRequested: 2,
      },
    });
    const addedItemBody = addedItem.body.item as { id?: string } | undefined;
    itemId = typeof addedItemBody?.id === "string" ? addedItemBody.id : null;
    check(addedItem.response.status === 200 && itemId !== null, "Alliance staff adds a requested physical item");
    if (!itemId) throw new Error("physical-need item creation returned no id");

    const itemSubmitted = await request(`/api/dashboard/items/${itemRequestId}/submit`, { method: "POST", cookie });
    check(itemSubmitted.response.status === 200, "Alliance staff submits the physical need");
    check((await dal.itemRequests.getById(SYSTEM, itemRequestId))?.status === "pending", "physical-need submission is pending");
    check((await request(`/api/public/item-requests/${itemRequestId}`)).response.status === 404, "pending physical-need detail is hidden");
    const pendingRls = await publicRlsItemCounts(itemRequestId, itemId);
    check(
      pendingRls?.requests === 0 && pendingRls.children === 0,
      "a non-bypassing public role cannot read pending physical-need rows",
      pendingRls,
    );

    const itemApproved = await request(`/api/admin/requests/item/${itemRequestId}/approve`, { method: "POST", cookie });
    check(itemApproved.response.status === 200, "staff approval activates the Alliance physical need", itemApproved.body);
    check((await dal.itemRequests.getById(SYSTEM, itemRequestId))?.status === "active", "approved physical need is active");

    itemBrowse = await request("/api/public/item-requests");
    profile = await request(`/api/public/organizations/${alliance.slug}`);
    let itemDetail = await request(`/api/public/item-requests/${itemRequestId}`);
    check(hasRequest(itemBrowse.body, "requests", itemRequestId), "physical need appears in item browse");
    check(hasRequest(profile.body, "itemRequests", itemRequestId), "physical need appears on the Alliance profile");
    check(itemDetail.response.status === 200, "public physical-need detail loads");
    check(
      (itemDetail.body.request as { dropoffLocation?: string | null } | undefined)?.dropoffLocation === "Roseville" &&
        (itemDetail.body.organization as { city?: string | null } | undefined)?.city === alliance.city,
      "public physical-need detail exposes the explicit dropoff location and nonprofit city",
      itemDetail.body,
    );
    check(
      resolveItemDropoffLocation("Specific loading dock", "Alliance City") === "Specific loading dock",
      "item detail displays an explicit dropoff location before the nonprofit city",
    );
    await pool.query(`update item_requests set dropoff_location = '   ' where id = $1`, [itemRequestId]);
    itemDetail = await request(`/api/public/item-requests/${itemRequestId}`);
    check(
      (itemDetail.body.request as { dropoffLocation?: string | null } | undefined)?.dropoffLocation === "   " &&
        (itemDetail.body.organization as { city?: string | null } | undefined)?.city === alliance.city,
      "public physical-need detail provides the nonprofit city when dropoff location is blank",
      itemDetail.body,
    );
    check(
      resolveItemDropoffLocation("   ", "Alliance City") === "Alliance City",
      "item detail displays the nonprofit city when dropoff location is blank",
    );
    await pool.query(`update organizations set city = null where id = $1`, [alliance.id]);
    itemDetail = await request(`/api/public/item-requests/${itemRequestId}`);
    check(
      (itemDetail.body.request as { dropoffLocation?: string | null } | undefined)?.dropoffLocation === "   " &&
        (itemDetail.body.organization as { city?: string | null } | undefined)?.city === null,
      "public physical-need detail keeps both location values empty when neither exists",
      itemDetail.body,
    );
    check(
      resolveItemDropoffLocation(null, "   ") === "",
      "item detail keeps a blank value when neither location exists",
    );
    await pool.query(`update organizations set city = $1 where id = $2`, [alliance.city, alliance.id]);
    await pool.query(`update item_requests set dropoff_location = 'Roseville' where id = $1`, [itemRequestId]);
    const itemShareResponse = await fetch(`${BASE}/items/${itemRequestId}`);
    check(
      itemShareResponse.status === 200 && (await itemShareResponse.text()).includes(itemTitle),
      "server-rendered share preview uses the Alliance physical need",
    );
    check(
      (
        await request("/api/public/engagement", {
          method: "POST",
          cookie,
          body: { eventId: itemEngagementEventId, eventType: "detail_view", requestKind: "item", requestId: itemRequestId },
        })
      ).response.status === 202,
      "public engagement accepts the Alliance physical need",
    );
    const itemDigestNeeds = await dal.digestRuns.newActiveNeeds(SYSTEM, beforeApproval, new Date(Date.now() + 60_000).toISOString());
    check(itemDigestNeeds.some((need) => need.type === "item" && need.id === itemRequestId), "digest selection includes the Alliance physical need");
    check((await dal.digestRuns.upcomingNeeds(SYSTEM)).needs.some((need) => need.type === "item" && need.id === itemRequestId), "digest preview includes the Alliance physical need");

    const recentlyViewed = await dal.requestEngagement.listRecentlyViewedForUser(SYSTEM, user.id, actor.personId);
    check(recentlyViewed.some((row) => row.requestKind === "item" && row.requestId === itemRequestId && row.available), "attributed recently-viewed history marks the Alliance physical need available");
    await pool.query(
      `insert into request_engagement_events (client_event_id, event_type, request_kind, item_request_id, user_id)
       values (gen_random_uuid(), 'detail_view', 'item', $1, $2)`,
      [itemRequestId, supporterUserId],
    );
    const itemOutreach = await dal.requestEngagement.listEligibleOutreachRecipients(SYSTEM, {
      requestKind: "item",
      requestId: itemRequestId,
      userIds: [supporterUserId!],
    });
    check(itemOutreach.recipients.some((recipient) => recipient.userId === supporterUserId), "outreach revalidation includes the Alliance physical need");

    const pledge = await request(`/api/public/item-requests/${itemRequestId}/pledges`, {
      method: "POST",
      body: {
        firstName: "zz_fixture",
        lastName: "Alliance Pledge",
        email: pledgeEmail,
        phone: "555-0130",
        agree: true,
        lines: [{ itemId, quantity: 1 }],
      },
    });
    check(pledge.response.status === 201, "public physical-need pledge succeeds", pledge.body);
    const pledgeRow = await pool.query<{ id: string }>(`select id from item_pledges where item_request_id = $1 and person_id = (select id from people where email = $2)`, [itemRequestId, pledgeEmail]);
    pledgeId = pledgeRow.rows[0]?.id ?? null;
    pledgePersonId = (await dal.people.findByEmail(SYSTEM, pledgeEmail))?.id ?? null;
    const itemCounter = await pool.query<{ quantityClaimed: number }>(`select quantity_claimed as "quantityClaimed" from items where id = $1`, [itemId]);
    const pledgeEmails = await pool.query<{ keys: string[] }>(`select coalesce(array_agg(distinct template_key), '{}') as keys from email_log where entity_id = $1`, [pledgeId]);
    check(itemCounter.rows[0]?.quantityClaimed === 1, "pledge updates the physical-item counter");
    check(pledgeEmails.rows[0]?.keys.includes("donor_item_confirmation") === true && pledgeEmails.rows[0]?.keys.includes("org_new_item_donation") === true, "pledge queues normal item confirmation emails", pledgeEmails.rows[0]?.keys);

    await pool.query(`update item_requests set expires_on = (now() at time zone 'America/Los_Angeles')::date - 1 where id = $1`, [itemRequestId]);
    check((await request(`/api/public/item-requests/${itemRequestId}`)).response.status === 404, "expired physical need is hidden");
    const expiredRls = await publicRlsItemCounts(itemRequestId, itemId);
    check(
      expiredRls?.requests === 0 && expiredRls.children === 0,
      "a non-bypassing public role cannot read expired physical-need rows",
      expiredRls,
    );
    const expiredDigestNeeds = await dal.digestRuns.newActiveNeeds(
      SYSTEM,
      beforeApproval,
      new Date(Date.now() + 60_000).toISOString(),
    );
    check(
      !expiredDigestNeeds.some((need) => need.type === "item" && need.id === itemRequestId),
      "digest selection excludes the expired Alliance physical need",
    );
    check(
      !(await dal.digestRuns.upcomingNeeds(SYSTEM)).needs.some(
        (need) => need.type === "item" && need.id === itemRequestId,
      ),
      "digest preview excludes the expired Alliance physical need",
    );
    await pool.query(`update item_requests set expires_on = null where id = $1`, [itemRequestId]);
    await pool.query(`update organizations set status = 'disabled' where id = $1`, [alliance.id]);
    check((await request(`/api/public/item-requests/${itemRequestId}`)).response.status === 404, "disabled-organization physical need is hidden");
    const disabledPledgeCountBefore = await pool.query<{ count: number }>(
      `select count(*)::int as count from item_pledges where item_request_id = $1`,
      [itemRequestId],
    );
    const disabledPledge = await request(`/api/public/item-requests/${itemRequestId}/pledges`, {
      method: "POST",
      body: {
        firstName: "zz_fixture",
        lastName: "Blocked Alliance Pledge",
        email: `blocked.${pledgeEmail}`,
        phone: "555-0131",
        agree: true,
        lines: [{ itemId, quantity: 1 }],
      },
    });
    const disabledPledgeCountAfter = await pool.query<{ count: number }>(
      `select count(*)::int as count from item_pledges where item_request_id = $1`,
      [itemRequestId],
    );
    check(
      disabledPledge.response.status === 404 &&
        disabledPledgeCountAfter.rows[0]?.count === disabledPledgeCountBefore.rows[0]?.count,
      "disabled-organization pledge is rejected without writing",
      { status: disabledPledge.response.status, before: disabledPledgeCountBefore.rows[0], after: disabledPledgeCountAfter.rows[0] },
    );
    await pool.query(`update organizations set status = 'approved' where id = $1`, [alliance.id]);

    const memberItem = await pool.query<{ id: string }>(`select r.id from item_requests r join organizations o on o.id = r.org_id where r.status = 'active' and o.status = 'approved' and o.kind = 'member_org' and exists (select 1 from items i where i.item_request_id = r.id) and not item_request_expired_on(r.deadline_type, r.deadline_date, r.expires_on, item_request_current_la_date()) limit 1`);
    check(typeof memberItem.rows[0]?.id === "string" && (await request(`/api/public/item-requests/${memberItem.rows[0]!.id}`)).response.status === 200, "member-organization physical-need detail remains public");

    const policies = await pool.query<{ name: string; expression: string }>(`select polname as name, pg_get_expr(polqual, polrelid) as expression from pg_policy where polname in ('item_requests_public_select', 'items_public_select')`);
    const byName = new Map(policies.rows.map((row) => [row.name, row.expression]));
    check(byName.get("item_requests_public_select")?.includes("platform_owner"), "item request RLS allows the platform owner");
    check(byName.get("items_public_select")?.includes("platform_owner"), "item child RLS allows the platform owner");

    const enforced = await publicRlsItemCounts(itemRequestId, itemId);
    check(enforced?.requests === 1 && enforced.children === 1, "a non-bypassing public role can read the Alliance request and child after publication", enforced);
    const itemArchived = await request(`/api/admin/requests/item/${itemRequestId}/archive`, { method: "POST", cookie });
    check(itemArchived.response.status === 200, "normal staff archives the Alliance physical need");
    check((await request(`/api/public/item-requests/${itemRequestId}`)).response.status === 404, "archived physical need detail is hidden");
    const archivedRls = await publicRlsItemCounts(itemRequestId, itemId);
    check(
      archivedRls?.requests === 0 && archivedRls.children === 0,
      "a non-bypassing public role cannot read archived physical-need rows",
      archivedRls,
    );
  } finally {
    if (volunteerRequestId) {
      // Signup notifications dispatch after the HTTP response. Do not delete
      // their log rows while a provider completion can still update them.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const unsettled = await pool.query<{ count: number }>(
          `select count(*)::int as count
             from email_log
            where status in ('queued', 'sending')
              and (
                entity_id = $1
                or (
                  entity_type = 'volunteer_signup'
                  and entity_id in (
                    select id from volunteer_signups where volunteer_request_id = $1
                  )
                )
              )`,
          [volunteerRequestId],
        );
        if (unsettled.rows[0]?.count === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await pool.query(
        `delete from email_log
          where entity_type = 'volunteer_signup'
            and entity_id in (select id from volunteer_signups where volunteer_request_id = $1)`,
        [volunteerRequestId],
      );
      await pool.query(`delete from email_log where entity_id = $1`, [volunteerRequestId]);
      await pool.query(`delete from request_engagement_events where volunteer_request_id = $1`, [volunteerRequestId]);
      await pool.query(
        `delete from volunteer_signup_roles signup_role
          using volunteer_signups signup
         where signup_role.volunteer_signup_id = signup.id
           and signup.volunteer_request_id = $1`,
        [volunteerRequestId],
      );
      await pool.query(`delete from volunteer_signups where volunteer_request_id = $1`, [volunteerRequestId]);
      await pool.query(`delete from approval_events where entity_type = 'volunteer_request' and entity_id = $1`, [
        volunteerRequestId,
      ]);
      await pool.query(`delete from volunteer_requests where id = $1`, [volunteerRequestId]);
    }
    if (itemRequestId) {
      // Pledge notifications dispatch after the HTTP response, just like
      // volunteer signup notifications. Wait before deleting their rows.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const unsettled = await pool.query<{ count: number }>(
          `select count(*)::int as count from email_log
            where status in ('queued', 'sending')
              and entity_id in (select id from item_pledges where item_request_id = $1)`,
          [itemRequestId],
        );
        if (unsettled.rows[0]?.count === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await pool.query(
        `delete from email_log where entity_id in (select id from item_pledges where item_request_id = $1)`,
        [itemRequestId],
      );
      await pool.query(
        `delete from item_pledge_lines where item_pledge_id in (select id from item_pledges where item_request_id = $1)`,
        [itemRequestId],
      );
      await pool.query(`delete from item_pledges where item_request_id = $1`, [itemRequestId]);
      await pool.query(`delete from request_engagement_events where item_request_id = $1`, [itemRequestId]);
      await pool.query(`delete from approval_events where entity_type = 'item_request' and entity_id = $1`, [itemRequestId]);
      await pool.query(`delete from item_requests where id = $1`, [itemRequestId]);
    }
    if (supporterUserId) await pool.query(`delete from users where id = $1`, [supporterUserId]);
    if (supporterPersonId) await pool.query(`delete from people where id = $1`, [supporterPersonId]);
    if (signupPersonId) await pool.query(`delete from people where id = $1`, [signupPersonId]);
    if (pledgePersonId) await pool.query(`delete from people where id = $1`, [pledgePersonId]);
    // This fixture only exercises an approved Alliance organization, but make
    // a failed disabled-org assertion incapable of leaving seed state altered.
    await pool.query(`update organizations set status = 'approved' where id = $1`, [alliance.id]);
    if (rlsRoleCreated) {
      await pool.query(`drop owned by ${rlsRoleName}`);
      await pool.query(`drop role if exists ${rlsRoleName}`);
    }
    await pool.query(`delete from request_engagement_events where client_event_id = any($1::uuid[])`, [
      [engagementEventId, itemEngagementEventId],
    ]);
    const leftovers = await pool.query<{ count: number }>(
      `select (
         (select count(*) from volunteer_requests where title = $1) +
         (select count(*) from item_requests where title = $2) +
          (select count(*) from people where email in ($3, $4, $5))
       )::int as count`,
      [title, itemTitle, supporterEmail, signupEmail, pledgeEmail],
    );
    check(leftovers.rows[0]?.count === 0, "fixture cleanup leaves no Alliance publication rows");
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});