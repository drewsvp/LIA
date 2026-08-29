/**
 * End-to-end regression coverage for Alliance volunteer publication.
 * Requires the development workflow and seeded quick-login accounts.
 */
import { randomUUID } from "node:crypto";
import { pool, SYSTEM } from "../server/db/client";
import * as dal from "../server/dal";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5000";
const runId = `${process.pid}-${Date.now()}`;
const title = `zz_fixture Alliance volunteer publication ${runId}`;
const itemTitle = `zz_fixture Alliance item exclusion ${runId}`;
const supporterEmail = `zz.fixture.alliance-volunteer.${runId}@example.org`;
const signupEmail = `zz.fixture.alliance-signup.${runId}@example.org`;

let volunteerRequestId: string | null = null;
let volunteerRoleId: string | null = null;
let itemRequestId: string | null = null;
let supporterUserId: string | null = null;
let supporterPersonId: string | null = null;
let signupPersonId: string | null = null;
const engagementEventId = randomUUID();
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
  const actorRows = await pool.query<{ firstName: string; lastName: string }>(
    `select p.first_name as "firstName", p.last_name as "lastName"
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

    console.log("\nItem exclusion, member-org parity, and RLS intent");
    const itemRows = await pool.query<{ id: string }>(
      `insert into item_requests
         (org_id, title, description, dropoff_location, people_helped, deadline_type, status, created_by)
       values ($1, $2, 'Temporary fixture.', 'Roseville', 1, 'until_fulfilled', 'active', $3)
       returning id`,
      [alliance.id, itemTitle, user.id],
    );
    itemRequestId = itemRows.rows[0]?.id ?? null;
    if (!itemRequestId) throw new Error("Alliance item fixture creation failed");
    await pool.query(
      `insert into items (item_request_id, name, description, condition, quantity_requested, sort_order)
       values ($1, 'Fixture item', 'Temporary fixture.', 'new', 1, 0)`,
      [itemRequestId],
    );
    const itemBrowse = await request("/api/public/item-requests");
    profile = await request(`/api/public/organizations/${alliance.slug}`);
    check(!hasRequest(itemBrowse.body, "requests", itemRequestId), "Alliance item stays out of item browse");
    check(!hasRequest(profile.body, "itemRequests", itemRequestId), "Alliance item stays off the Alliance profile");
    check((await request(`/api/public/item-requests/${itemRequestId}`)).response.status === 404, "Alliance item detail stays hidden");

    const memberVolunteer = await pool.query<{ id: string }>(
      `select r.id
         from volunteer_requests r join organizations o on o.id = r.org_id
        where r.status = 'active' and o.status = 'approved' and o.kind = 'member_org'
          and (r.expires_on is null or r.expires_on >= current_date)
        limit 1`,
    );
    const memberVolunteerId = memberVolunteer.rows[0]?.id;
    check(
      typeof memberVolunteerId === "string" &&
        (await request(`/api/public/volunteer-requests/${memberVolunteerId}`)).response.status === 200,
      "existing member-organization volunteer detail remains public",
    );

    const policies = await pool.query<{ name: string; expression: string }>(
      `select polname as name, pg_get_expr(polqual, polrelid) as expression
         from pg_policy
        where polname in ('item_requests_public_select', 'volunteer_requests_public_select', 'volunteer_roles_public_select')`,
    );
    const byName = new Map(policies.rows.map((row) => [row.name, row.expression]));
    check(byName.get("volunteer_requests_public_select")?.includes("platform_owner"), "volunteer request RLS allows the platform owner");
    check(byName.get("volunteer_roles_public_select")?.includes("platform_owner"), "volunteer role RLS allows the platform owner");
    check(!byName.get("item_requests_public_select")?.includes("platform_owner"), "item request RLS remains member-org-only");

    const rlsClient = await pool.connect();
    try {
      await rlsClient.query(`create role ${rlsRoleName} nologin`);
      rlsRoleCreated = true;
      await rlsClient.query(
        `grant usage on schema public to ${rlsRoleName};
         grant select on organizations, organization_populations, org_memberships,
           volunteer_requests, volunteer_roles, item_requests
           to ${rlsRoleName}`,
      );
      await rlsClient.query("begin");
      await rlsClient.query("select set_config('app.context', 'public', true)");
      await rlsClient.query(`set local role ${rlsRoleName}`);
      const enforced = await rlsClient.query<{ orgs: number; volunteers: number; roles: number; items: number }>(
        `select
           (select count(*)::int from organizations where id = $1) as orgs,
           (select count(*)::int from volunteer_requests where id = $2) as volunteers,
           (select count(*)::int from volunteer_roles where id = $3) as roles,
           (select count(*)::int from item_requests where id = $4) as items`,
        [alliance.id, volunteerRequestId, volunteerRoleId, itemRequestId],
      );
      await rlsClient.query("rollback");
      const visible = enforced.rows[0];
      check(
        visible?.orgs === 1 && visible.volunteers === 1 && visible.roles === 1,
        "a non-bypassing public role can read the Alliance organization, volunteer request, and role",
        visible,
      );
      check(visible?.items === 0, "the same RLS role cannot read an Alliance item", visible);
    } finally {
      try {
        await rlsClient.query("rollback");
      } catch {
        // The transaction may already be closed.
      }
      rlsClient.release();
    }
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
      await pool.query(`delete from approval_events where entity_type = 'item_request' and entity_id = $1`, [itemRequestId]);
      await pool.query(`delete from item_requests where id = $1`, [itemRequestId]);
    }
    if (supporterUserId) await pool.query(`delete from users where id = $1`, [supporterUserId]);
    if (supporterPersonId) await pool.query(`delete from people where id = $1`, [supporterPersonId]);
    if (signupPersonId) await pool.query(`delete from people where id = $1`, [signupPersonId]);
    if (rlsRoleCreated) {
      await pool.query(`drop owned by ${rlsRoleName}`);
      await pool.query(`drop role if exists ${rlsRoleName}`);
    }
    await pool.query(`delete from request_engagement_events where client_event_id = $1`, [engagementEventId]);
    const leftovers = await pool.query<{ count: number }>(
      `select (
         (select count(*) from volunteer_requests where title = $1) +
         (select count(*) from item_requests where title = $2) +
         (select count(*) from people where email in ($3, $4))
       )::int as count`,
      [title, itemTitle, supporterEmail, signupEmail],
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