/**
 * ADMIN-14 regression coverage.
 *
 * Requires the development workflow and seeded quick-login accounts.
 * Creates isolated participation rows, verifies cross-organization listing,
 * detail fidelity, filters, stable pagination, and the staff-admin boundary,
 * then removes every fixture row.
 */
import { randomUUID } from "node:crypto";
import { pool } from "../server/db/client";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
const marker = `zz_fixture_participation_${process.pid}`;
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

async function get(path: string, cookie = ""): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : undefined });
  const body = await response.json().catch(() => null);
  return { response, body };
}

type DonationRow = {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  notes: string | null;
  organization: { id: string; name: string };
  request: { id: string; type: "item"; title: string };
  lines: Array<{ id: string; name: string; quantity: number }>;
};

type VolunteerRow = {
  id: string;
  notes: string | null;
  organization: { id: string; name: string };
  request: { id: string; type: "volunteer"; title: string };
  roles: Array<{ id: string; name: string }>;
};

type Page<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  snapshotAt: string;
};

const ids = {
  orgA: randomUUID(),
  orgB: randomUUID(),
  personA: randomUUID(),
  personB: randomUUID(),
  personC: randomUUID(),
  itemRequestA: randomUUID(),
  itemRequestB: randomUUID(),
  volunteerRequest: randomUUID(),
  itemA1: randomUUID(),
  itemA2: randomUUID(),
  itemB: randomUUID(),
  role1: randomUUID(),
  role2: randomUUID(),
  pledgeA: randomUUID(),
  pledgeB: randomUUID(),
  pledgeC: randomUUID(),
  signup: randomUUID(),
};

async function createFixtures(): Promise<void> {
  await pool.query(
    `insert into organizations (id, name, slug, kind, status)
     values ($1, $2, $3, 'member_org', 'approved'),
            ($4, $5, $6, 'member_org', 'approved')`,
    [
      ids.orgA,
      `${marker} Alpha`,
      `${marker.replaceAll("_", "-")}-alpha`,
      ids.orgB,
      `${marker} Beta`,
      `${marker.replaceAll("_", "-")}-beta`,
    ],
  );
  await pool.query(
    `insert into people (id, first_name, last_name, email, phone, source_note, needs_review)
     values ($1, 'Ada', $2, $3, '555-0101', 'zz_fixture participation test', true),
            ($4, 'Ben', $5, $6, null, 'zz_fixture participation test', false)`,
    [
      ids.personA,
      marker,
      `${marker}.ada@example.com`,
      ids.personB,
      marker,
      `${marker}.ben@example.com`,
    ],
  );
  await pool.query(
    `insert into item_requests (id, org_id, title, deadline_type, status)
     values ($1, $2, $3, 'ongoing', 'active'),
            ($4, $5, $6, 'ongoing', 'active')`,
    [ids.itemRequestA, ids.orgA, `${marker} Winter supplies`, ids.itemRequestB, ids.orgB, `${marker} Pantry restock`],
  );
  await pool.query(
    `insert into volunteer_requests (id, org_id, title, deadline_type, status)
     values ($1, $2, $3, 'ongoing', 'active')`,
    [ids.volunteerRequest, ids.orgB, `${marker} Delivery crew`],
  );
  await pool.query(
    `insert into items (id, item_request_id, name, quantity_requested, sort_order)
     values ($1, $2, 'Blankets', 20, 1),
            ($3, $2, 'Coats', 20, 2),
            ($4, $5, 'Rice', 20, 1)`,
    [ids.itemA1, ids.itemRequestA, ids.itemA2, ids.itemB, ids.itemRequestB],
  );
  await pool.query(
    `insert into volunteer_roles (id, volunteer_request_id, name, quantity_needed, sort_order)
     values ($1, $2, 'Driver', 10, 1),
            ($3, $2, 'Loader', 10, 2)`,
    [ids.role1, ids.volunteerRequest, ids.role2],
  );
  await pool.query(
    `insert into item_pledges (id, person_id, item_request_id, notes)
     values ($1, $2, $3, 'zz_fixture can deliver Tuesday'),
            ($4, $5, $6, 'zz_fixture porch pickup')`,
    [ids.pledgeA, ids.personA, ids.itemRequestA, ids.pledgeB, ids.personB, ids.itemRequestB],
  );
  await pool.query(
    `insert into item_pledge_lines (item_pledge_id, item_id, quantity)
     values ($1, $2, 3), ($1, $3, 2), ($4, $5, 4)`,
    [ids.pledgeA, ids.itemA1, ids.itemA2, ids.pledgeB, ids.itemB],
  );
  await pool.query(
    `insert into volunteer_signups (id, person_id, volunteer_request_id, notes)
     values ($1, $2, $3, 'zz_fixture has a large vehicle')`,
    [ids.signup, ids.personA, ids.volunteerRequest],
  );
  await pool.query(
    `insert into volunteer_signup_roles (volunteer_signup_id, volunteer_role_id)
     values ($1, $2), ($1, $3)`,
    [ids.signup, ids.role1, ids.role2],
  );
}

async function cleanup(): Promise<void> {
  await pool.query(`delete from item_pledges where id = any($1::uuid[])`, [[ids.pledgeA, ids.pledgeB, ids.pledgeC]]);
  await pool.query(`delete from volunteer_signups where id = $1`, [ids.signup]);
  await pool.query(`delete from item_requests where id = any($1::uuid[])`, [[ids.itemRequestA, ids.itemRequestB]]);
  await pool.query(`delete from volunteer_requests where id = $1`, [ids.volunteerRequest]);
  await pool.query(`delete from people where id = any($1::uuid[])`, [[ids.personA, ids.personB, ids.personC]]);
  await pool.query(`delete from organizations where id = any($1::uuid[])`, [[ids.orgA, ids.orgB]]);
}

async function main(): Promise<void> {
  await createFixtures();
  try {
    const [adminCookie, approverCookie, ownerCookie] = await Promise.all([
      quickLogin("staff_admin"),
      quickLogin("staff_approver"),
      quickLogin("org_owner"),
    ]);

    const orgFilter = encodeURIComponent(marker);
    const pageOne = await get(`/api/admin/participation/donations?organization=${orgFilter}&page=1&pageSize=1`, adminCookie);
    const donationsOne = pageOne.body as Page<DonationRow>;
    await pool.query(
      `insert into people (id, first_name, last_name, email, source_note)
       values ($1, 'New', 'Arrival', $2, 'zz_fixture participation test')`,
      [ids.personC, `${marker}.new@example.com`],
    );
    await pool.query(
      `insert into item_pledges (id, person_id, item_request_id, notes)
       values ($1, $2, $3, 'zz_fixture arrived after snapshot')`,
      [ids.pledgeC, ids.personC, ids.itemRequestA],
    );
    await pool.query(
      `insert into item_pledge_lines (item_pledge_id, item_id, quantity)
       values ($1, $2, 1)`,
      [ids.pledgeC, ids.itemA1],
    );
    const pageTwo = await get(
      `/api/admin/participation/donations?organization=${orgFilter}&page=2&pageSize=1&snapshotAt=${encodeURIComponent(donationsOne.snapshotAt)}`,
      adminCookie,
    );
    const donationsTwo = pageTwo.body as Page<DonationRow>;
    assert(pageOne.response.status === 200 && pageTwo.response.status === 200, "staff admin can list donations");
    assert(donationsOne.total === 2 && donationsOne.totalPages === 2, "cross-organization total and page count are complete", donationsOne);
    assert(
      donationsOne.rows[0]?.id !== donationsTwo.rows[0]?.id &&
        new Set([donationsOne.rows[0]?.id, donationsTwo.rows[0]?.id]).has(ids.pledgeA) &&
        new Set([donationsOne.rows[0]?.id, donationsTwo.rows[0]?.id]).has(ids.pledgeB),
      "stable pagination returns both organizations without duplication",
      [donationsOne.rows[0]?.id, donationsTwo.rows[0]?.id],
    );
    assert(donationsTwo.total === 2, "new participation does not shift an in-progress paging snapshot", donationsTwo);

    const pledgeA = await get(
      `/api/admin/participation/donations?requestId=${ids.itemRequestA}&supporter=${encodeURIComponent("Ada")}`,
      adminCookie,
    );
    const pledgeARow = (pledgeA.body as Page<DonationRow>).rows[0];
    assert(pledgeARow?.notes === "zz_fixture can deliver Tuesday", "donation notes are returned exactly");
    assert(
      pledgeARow?.organization.id === ids.orgA &&
        pledgeARow.request.id === ids.itemRequestA &&
        pledgeARow.request.type === "item",
      "donation organization and request relationships are authoritative",
      pledgeARow,
    );
    assert(
      pledgeARow?.lines.map((line) => `${line.quantity}:${line.name}`).join("|") === "3:Blankets|2:Coats",
      "multi-item quantities render in request order",
      pledgeARow?.lines,
    );

    const volunteer = await get(
      `/api/admin/participation/volunteers?organizationId=${ids.orgB}&request=${encodeURIComponent("Delivery crew")}`,
      adminCookie,
    );
    const volunteerPage = volunteer.body as Page<VolunteerRow>;
    const volunteerRow = volunteerPage.rows[0];
    assert(volunteer.response.status === 200 && volunteerPage.total === 1, "organization and request filters narrow volunteers");
    assert(volunteerRow?.notes === "zz_fixture has a large vehicle", "volunteer notes are returned exactly");
    assert(
      volunteerRow?.roles.map((role) => role.name).join("|") === "Driver|Loader",
      "multi-role selections render in request order",
      volunteerRow?.roles,
    );

    const search = await get(`/api/admin/participation/donations?search=${encodeURIComponent("Pantry restock")}`, adminCookie);
    assert(
      (search.body as Page<DonationRow>).rows.some((row) => row.id === ids.pledgeB),
      "general search finds a request across organizations",
    );
    const dateRange = await get(
      `/api/admin/participation/donations?organization=${orgFilter}&from=2000-01-01&to=2100-01-01`,
      adminCookie,
    );
    assert((dateRange.body as Page<DonationRow>).total === 3, "inclusive date filters retain matching participation");
    const invalid = await get("/api/admin/participation/donations?from=2026-02-30", adminCookie);
    assert(invalid.response.status === 400, "invalid calendar dates are rejected");

    for (const [label, cookie] of [
      ["staff approver", approverCookie],
      ["organization member", ownerCookie],
      ["anonymous visitor", ""],
    ] as const) {
      const denied = await get("/api/admin/participation/donations", cookie);
      assert(denied.response.status === 404, `${label} cannot discover the participation API`, denied.response.status);
      assert(
        JSON.stringify(denied.body) === JSON.stringify({ message: "Not found" }),
        `${label} receives the unknown-route response`,
        denied.body,
      );
    }
  } finally {
    await cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});