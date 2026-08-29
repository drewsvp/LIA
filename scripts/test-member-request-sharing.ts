/**
 * Authenticated HTTP regression coverage for organization-owned member needs.
 *
 * Requires the development workflow and seeded organization-owner accounts.
 * Writes zz_fixture rows and removes them before exit.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-member-request-sharing.ts
 */
import { randomUUID } from "node:crypto";
import { auth } from "../server/auth/auth";
import { pool } from "../server/db/client";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5000";
const runId = `${process.pid}-${Date.now()}`;
const marker = `zz_fixture_org_share_${runId}`;
const fixtureEmails = [
  `${marker}.teammate@example.org`,
  `${marker}.outside@example.org`,
  `${marker}.pending@example.org`,
  `${marker}.removed@example.org`,
];
const requestIds: string[] = [];
const personIds: string[] = [];
const userIds: string[] = [];
const membershipIds: string[] = [];
let passed = 0;
let failed = 0;

type Json = Record<string, unknown>;
type FixtureUser = { personId: string; userId: string; membershipId: string; cookie: string };

function check(condition: unknown, label: string, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function request(
  path: string,
  options: { cookie?: string; method?: string; body?: unknown } = {},
): Promise<{ response: Response; body: Json }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body: Json = {};
  try {
    body = (await response.json()) as Json;
  } catch {
    // Assertions below include the response status.
  }
  return { response, body };
}

async function mintCookie(email: string): Promise<string> {
  const token = `${marker}-${randomUUID()}`;
  await pool.query(
    `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
    [token, JSON.stringify({ email })],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: Response = await (auth.api as any).magicLinkVerify({
    query: { token, callbackURL: "/dashboard" },
    headers: new Headers(),
    asResponse: true,
  });
  const cookie = cookieHeader(response);
  if (!cookie.includes("session_token")) throw new Error(`Could not establish fixture session for ${email}`);
  return cookie;
}

async function createFixtureUser(
  email: string,
  orgId: string,
  membershipStatus: "active" | "pending" | "removed",
): Promise<FixtureUser> {
  const person = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, phone, source_note)
     values ('ZZ', 'Organization Sharing', $1, '555-0199', $2)
     returning id`,
    [email, marker],
  );
  const personId = person.rows[0]!.id;
  personIds.push(personId);
  const user = await pool.query<{ id: string }>(
    `insert into users (person_id, status, kind) values ($1, 'active', 'member') returning id`,
    [personId],
  );
  const userId = user.rows[0]!.id;
  userIds.push(userId);
  const membership = await pool.query<{ id: string }>(
    `insert into org_memberships (org_id, user_id, role, status)
     values ($1, $2, 'member', $3)
     returning id`,
    [orgId, userId, membershipStatus],
  );
  const membershipId = membership.rows[0]!.id;
  membershipIds.push(membershipId);
  return { personId, userId, membershipId, cookie: await mintCookie(email) };
}

async function quickLoginCookie(role: "org_owner" | "supporter"): Promise<string> {
  const login = await request("/api/login/quick", {
    method: "POST",
    body: { role },
  });
  const cookie = cookieHeader(login.response);
  if (!login.response.ok || cookie === "") {
    throw new Error(`Seeded ${role} login failed: ${login.response.status}`);
  }
  return cookie;
}

function idsFrom(body: Json, key: "itemRequests" | "volunteerRequests"): string[] {
  const rows = body[key];
  return Array.isArray(rows)
    ? rows.flatMap((row) =>
        typeof row === "object" && row !== null && "id" in row && typeof row.id === "string" ? [row.id] : [],
      )
    : [];
}

async function cleanup(): Promise<void> {
  if (requestIds.length > 0) {
    await pool.query(`delete from email_log where entity_id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from approval_events where entity_id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from item_requests where id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from volunteer_requests where id = any($1::uuid[])`, [requestIds]);
  }
  if (membershipIds.length > 0) {
    await pool.query(`delete from org_memberships where id = any($1::uuid[])`, [membershipIds]);
  }
  await pool.query(
    `delete from session where "userId" in (select id from "user" where email = any($1::text[]))`,
    [fixtureEmails],
  );
  await pool.query(
    `delete from account where "userId" in (select id from "user" where email = any($1::text[]))`,
    [fixtureEmails],
  );
  await pool.query(`delete from "user" where email = any($1::text[])`, [fixtureEmails]);
  await pool.query(`delete from verification where identifier like $1 or value like $2`, [
    `${marker}%`,
    `%${marker}%`,
  ]);
  if (userIds.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [userIds]);
  if (personIds.length > 0) await pool.query(`delete from people where id = any($1::uuid[])`, [personIds]);
}

async function main(): Promise<void> {
  console.log("\n[member organization request sharing]\n");
  const ownerCookie = await quickLoginCookie("org_owner");
  const supporterCookie = await quickLoginCookie("supporter");
  const ownerSession = await request("/api/session", { cookie: ownerCookie });
  const owner = ownerSession.body.user as { id?: string } | undefined;
  const targetOrgId = typeof ownerSession.body.activeOrgId === "string" ? ownerSession.body.activeOrgId : null;
  if (!owner?.id || !targetOrgId) throw new Error("Seeded owner session did not resolve an active organization");

  const outsideOrg = await pool.query<{ orgId: string }>(
    `select m.org_id as "orgId"
       from org_memberships m
       join users u on u.id = m.user_id
       join people p on p.id = u.person_id
      where m.status = 'active'
        and lower(p.email) = 'samuel@newhorizons.example.org'
      limit 1`,
  );
  const outsideOrgId = outsideOrg.rows[0]?.orgId;
  if (!outsideOrgId || outsideOrgId === targetOrgId) {
    throw new Error("A second seeded member organization is required — run db:seed first");
  }

  const teammate = await createFixtureUser(fixtureEmails[0]!, targetOrgId, "active");
  const outside = await createFixtureUser(fixtureEmails[1]!, outsideOrgId, "active");
  const pending = await createFixtureUser(fixtureEmails[2]!, targetOrgId, "pending");
  const removed = await createFixtureUser(fixtureEmails[3]!, targetOrgId, "removed");

  const contact = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, phone, source_note)
     values ('ZZ', 'Request Contact', $1, '555-0100', $2)
     returning id`,
    [`${marker}.contact@example.org`, marker],
  );
  const contactId = contact.rows[0]!.id;
  personIds.push(contactId);

  const statuses = ["draft", "pending", "active", "archived"] as const;
  const itemByStatus = new Map<string, string>();
  const volunteerByStatus = new Map<string, string>();
  for (const [index, status] of statuses.entries()) {
    const item = await pool.query<{ id: string }>(
      `insert into item_requests
         (org_id, title, description, dropoff_location, people_helped, deadline_type,
          contact_person_id, status, created_by, archived_reason)
       values ($1, $2, 'Fixture item request', 'Fixture dropoff', 2, 'until_fulfilled',
               $3, $4, $5, case when $4 = 'archived' then 'manual' else null end)
       returning id`,
      [targetOrgId, `${marker} item ${status}`, contactId, status, owner.id],
    );
    const itemId = item.rows[0]!.id;
    requestIds.push(itemId);
    itemByStatus.set(status, itemId);
    await pool.query(
      `insert into items
         (item_request_id, name, description, condition, quantity_requested, sort_order)
       values ($1, $2, 'Fixture item', 'new', 3, 0)`,
      [itemId, `${marker} item child ${index}`],
    );

    const volunteer = await pool.query<{ id: string }>(
      `insert into volunteer_requests
         (org_id, title, description, details, event_location, people_helped, deadline_type,
          contact_person_id, status, created_by, archived_reason)
       values ($1, $2, 'Fixture volunteer request', 'Fixture details', 'Fixture location', 2, 'ongoing',
               $3, $4, $5, case when $4 = 'archived' then 'manual' else null end)
       returning id`,
      [targetOrgId, `${marker} volunteer ${status}`, contactId, status, owner.id],
    );
    const volunteerId = volunteer.rows[0]!.id;
    requestIds.push(volunteerId);
    volunteerByStatus.set(status, volunteerId);
    await pool.query(
      `insert into volunteer_roles
         (volunteer_request_id, name, description, quantity_needed, sort_order)
       values ($1, $2, 'Fixture role', 3, 0)`,
      [volunteerId, `${marker} volunteer role ${index}`],
    );
  }

  const activeItemId = itemByStatus.get("active")!;
  const activeVolunteerId = volunteerByStatus.get("active")!;

  console.log("Dashboard visibility");
  const [creatorOverview, teammateOverview, outsideOverview] = await Promise.all([
    request("/api/dashboard/overview", { cookie: ownerCookie }),
    request("/api/dashboard/overview", { cookie: teammate.cookie }),
    request("/api/dashboard/overview", { cookie: outside.cookie }),
  ]);
  const expectedItemIds = [...itemByStatus.values()];
  const expectedVolunteerIds = [...volunteerByStatus.values()];
  check(
    creatorOverview.response.ok &&
      expectedItemIds.every((id) => idsFrom(creatorOverview.body, "itemRequests").includes(id)) &&
      expectedVolunteerIds.every((id) => idsFrom(creatorOverview.body, "volunteerRequests").includes(id)),
    "creator sees every organization request status",
  );
  check(
    teammateOverview.response.ok &&
      expectedItemIds.every((id) => idsFrom(teammateOverview.body, "itemRequests").includes(id)) &&
      expectedVolunteerIds.every((id) => idsFrom(teammateOverview.body, "volunteerRequests").includes(id)),
    "same-organization teammate sees all item and volunteer requests",
  );
  check(
    outsideOverview.response.ok &&
      expectedItemIds.every((id) => !idsFrom(outsideOverview.body, "itemRequests").includes(id)) &&
      expectedVolunteerIds.every((id) => !idsFrom(outsideOverview.body, "volunteerRequests").includes(id)),
    "another organization cannot discover target requests in its dashboard",
    outsideOverview.response.status,
  );

  console.log("\nAuthorization boundary");
  for (const [label, cookie] of [
    ["pending member", pending.cookie],
    ["removed member", removed.cookie],
  ] as const) {
    const overview = await request("/api/dashboard/overview", { cookie });
    const detail = await request(`/api/dashboard/items/${activeItemId}/edit`, { cookie });
    check(
      overview.response.status === 403 && detail.response.status === 403,
      `${label} cannot list or load organization requests`,
      `${overview.response.status}/${detail.response.status}`,
    );
  }
  const supporterOverview = await request("/api/dashboard/overview", { cookie: supporterCookie });
  const supporterItem = await request(`/api/dashboard/items/${activeItemId}`, { cookie: supporterCookie });
  const supporterVolunteer = await request(`/api/dashboard/volunteers/${activeVolunteerId}`, {
    cookie: supporterCookie,
  });
  check(
    supporterOverview.response.status === 403 &&
      supporterItem.response.status === 403 &&
      supporterVolunteer.response.status === 403,
    "supporter cannot list or load organization requests",
    `${supporterOverview.response.status}/${supporterItem.response.status}/${supporterVolunteer.response.status}`,
  );

  const foreignChecks: ReadonlyArray<readonly [string, unknown?]> = [
    [`/api/dashboard/items/${activeItemId}`],
    [`/api/dashboard/items/${activeItemId}/edit`, undefined],
    [`/api/dashboard/volunteers/${activeVolunteerId}`],
    [`/api/dashboard/volunteers/${activeVolunteerId}/edit`, undefined],
    [
      `/api/dashboard/items/${activeItemId}/edit/items`,
      {
        items: [
          {
            id: randomUUID(),
            name: "Foreign item",
            description: "Must not save",
            condition: "new",
            quantityRequested: 1,
            quantityReceived: 0,
          },
        ],
      },
    ],
    [
      `/api/dashboard/items/${activeItemId}/edit/add-item`,
      { name: "Foreign item", description: "Must not save", condition: "new", quantityRequested: 1 },
    ],
    [
      `/api/dashboard/items/${activeItemId}/edit/request`,
      { title: "Foreign request", statusTo: "archived" },
    ],
    [
      `/api/dashboard/volunteers/${activeVolunteerId}/edit/roles`,
      {
        roles: [
          {
            id: randomUUID(),
            name: "Foreign role",
            description: "Must not save",
            quantityNeeded: 1,
            quantityConfirmed: 0,
          },
        ],
      },
    ],
    [
      `/api/dashboard/volunteers/${activeVolunteerId}/edit/add-role`,
      { name: "Foreign role", description: "Must not save", quantityNeeded: 1 },
    ],
    [
      `/api/dashboard/volunteers/${activeVolunteerId}/edit/request`,
      { title: "Foreign request", statusTo: "archived" },
    ],
  ];
  for (const [path, body] of foreignChecks) {
    const result = await request(path, {
      cookie: outside.cookie,
      ...(body === undefined ? {} : { method: "POST", body }),
    });
    check(
      result.response.status === 404 && result.body.message === "Not found",
      `foreign organization receives canonical not-found for ${path}`,
      `${result.response.status} ${JSON.stringify(result.body)}`,
    );
  }
  const missingId = randomUUID();
  const [missingItem, missingVolunteer, foreignItem, foreignVolunteer] = await Promise.all([
    request(`/api/dashboard/items/${missingId}/edit`, { cookie: teammate.cookie }),
    request(`/api/dashboard/volunteers/${missingId}/edit`, { cookie: teammate.cookie }),
    request(`/api/dashboard/items/${activeItemId}/edit`, { cookie: outside.cookie }),
    request(`/api/dashboard/volunteers/${activeVolunteerId}/edit`, { cookie: outside.cookie }),
  ]);
  check(
    missingItem.response.status === foreignItem.response.status &&
      JSON.stringify(missingItem.body) === JSON.stringify(foreignItem.body),
    "foreign and missing item requests are indistinguishable",
    `${missingItem.response.status}/${foreignItem.response.status}`,
  );
  check(
    missingVolunteer.response.status === foreignVolunteer.response.status &&
      JSON.stringify(missingVolunteer.body) === JSON.stringify(foreignVolunteer.body),
    "foreign and missing volunteer requests are indistinguishable",
    `${missingVolunteer.response.status}/${foreignVolunteer.response.status}`,
  );

  console.log("\nSame-organization item workflow");
  const itemPage = await request(`/api/dashboard/items/${activeItemId}`, { cookie: teammate.cookie });
  const itemEditPage = await request(`/api/dashboard/items/${activeItemId}/edit`, { cookie: teammate.cookie });
  const itemRows = itemEditPage.body.items as Array<{ id: string; name: string }> | undefined;
  const itemId = itemRows?.[0]?.id;
  check(itemPage.response.ok && itemEditPage.response.ok && !!itemId, "teammate opens item details and edit data");
  if (!itemId) throw new Error("Active item fixture did not load");
  const itemSave = await request(`/api/dashboard/items/${activeItemId}/edit/items`, {
    method: "POST",
    cookie: teammate.cookie,
    body: {
      items: [
        {
          id: itemId,
          name: `${marker} item edited by teammate`,
          description: "Updated by a teammate",
          productUrl: "",
          condition: "gently_used",
          quantityRequested: 4,
          quantityReceived: 1,
        },
      ],
    },
  });
  check(itemSave.response.ok, "teammate saves item fields and receipt count", itemSave.body);
  const addItem = await request(`/api/dashboard/items/${activeItemId}/edit/add-item`, {
    method: "POST",
    cookie: teammate.cookie,
    body: {
      name: `${marker} added item`,
      description: "Added by a teammate",
      productUrl: null,
      condition: "new",
      quantityRequested: 2,
    },
  });
  check(addItem.response.ok, "teammate adds an item to the organization request", addItem.body);
  const itemRequestSave = await request(`/api/dashboard/items/${activeItemId}/edit/request`, {
    method: "POST",
    cookie: teammate.cookie,
    body: {
      contactFirstName: "ZZ",
      contactLastName: "Request Contact",
      contactEmail: `${marker}.contact@example.org`,
      contactPhone: "555-0100",
      title: `${marker} item request edited`,
      description: "Request details updated by a teammate",
      dropoffLocation: "Updated fixture dropoff",
      peopleHelped: 4,
      deadlineType: "until_fulfilled",
      deadlineDate: "",
      statusTo: "archived",
    },
  });
  check(itemRequestSave.response.ok, "teammate edits and archives the item request", itemRequestSave.body);

  console.log("\nSame-organization volunteer workflow");
  const volunteerPage = await request(`/api/dashboard/volunteers/${activeVolunteerId}`, { cookie: teammate.cookie });
  const volunteerEditPage = await request(`/api/dashboard/volunteers/${activeVolunteerId}/edit`, {
    cookie: teammate.cookie,
  });
  const roleRows = volunteerEditPage.body.roles as Array<{ id: string; name: string }> | undefined;
  const roleId = roleRows?.[0]?.id;
  check(
    volunteerPage.response.ok && volunteerEditPage.response.ok && !!roleId,
    "teammate opens volunteer details and edit data",
  );
  if (!roleId) throw new Error("Active volunteer role fixture did not load");
  const roleSave = await request(`/api/dashboard/volunteers/${activeVolunteerId}/edit/roles`, {
    method: "POST",
    cookie: teammate.cookie,
    body: {
      roles: [
        {
          id: roleId,
          name: `${marker} role edited by teammate`,
          description: "Updated by a teammate",
          quantityNeeded: 4,
          quantityConfirmed: 1,
        },
      ],
    },
  });
  check(roleSave.response.ok, "teammate saves role fields and confirmation count", roleSave.body);
  const addRole = await request(`/api/dashboard/volunteers/${activeVolunteerId}/edit/add-role`, {
    method: "POST",
    cookie: teammate.cookie,
    body: { name: `${marker} added role`, description: "Added by a teammate", quantityNeeded: 2 },
  });
  check(addRole.response.ok, "teammate adds a role to the organization request", addRole.body);
  const volunteerRequestSave = await request(`/api/dashboard/volunteers/${activeVolunteerId}/edit/request`, {
    method: "POST",
    cookie: teammate.cookie,
    body: {
      contactFirstName: "ZZ",
      contactLastName: "Request Contact",
      contactEmail: `${marker}.contact@example.org`,
      contactPhone: "555-0100",
      title: `${marker} volunteer request edited`,
      description: "Request details updated by a teammate",
      details: "Updated fixture details",
      eventLocation: "Updated fixture location",
      peopleHelped: 4,
      deadlineType: "ongoing",
      deadlineDate: "",
      statusTo: "archived",
    },
  });
  check(
    volunteerRequestSave.response.ok,
    "teammate edits and archives the volunteer request",
    volunteerRequestSave.body,
  );

  const attribution = await pool.query<{
    itemCreatedBy: string;
    volunteerCreatedBy: string;
    itemActor: string;
    volunteerActor: string;
    itemReceived: number;
    volunteerConfirmed: number;
  }>(
    `select
       (select created_by from item_requests where id = $1) as "itemCreatedBy",
       (select created_by from volunteer_requests where id = $2) as "volunteerCreatedBy",
       (select actor_user_id from approval_events
         where entity_type = 'item_request' and entity_id = $1 and to_status = 'archived'
         order by created_at desc limit 1) as "itemActor",
       (select actor_user_id from approval_events
         where entity_type = 'volunteer_request' and entity_id = $2 and to_status = 'archived'
         order by created_at desc limit 1) as "volunteerActor",
       (select quantity_received from items where id = $3) as "itemReceived",
       (select quantity_confirmed from volunteer_roles where id = $4) as "volunteerConfirmed"`,
    [activeItemId, activeVolunteerId, itemId, roleId],
  );
  const audit = attribution.rows[0];
  check(
    audit?.itemCreatedBy === owner.id &&
      audit.volunteerCreatedBy === owner.id &&
      audit.itemActor === teammate.userId &&
      audit.volunteerActor === teammate.userId,
    "historical creator is retained while lifecycle actions name the teammate actor",
    audit,
  );
  check(
    audit?.itemReceived === 1 && audit.volunteerConfirmed === 1,
    "organization activity counters retain teammate-entered receipt and confirmation values",
    audit,
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error("Fixture cleanup failed:", error);
      process.exitCode = 1;
    }
    await pool.end();
  });