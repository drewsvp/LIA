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

async function quickLogin(role: "staff_admin" | "staff_approver" | "org_owner" | "supporter"): Promise<string> {
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

async function post(path: string, body: unknown, cookie = ""): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => null) };
}

type DonationRow = {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  notes: string | null;
  status: "active" | "cancelled";
  updatedAt: string;
  participationVersion: number;
  organization: { id: string; name: string };
  request: { id: string; type: "item"; title: string };
  lines: Array<{ id: string; name: string; quantity: number }>;
};

type VolunteerRow = {
  id: string;
  notes: string | null;
  status: "active" | "cancelled";
  updatedAt: string;
  participationVersion: number;
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
    `insert into items (id, item_request_id, name, quantity_requested, quantity_claimed, sort_order)
     values ($1, $2, 'Blankets', 20, 3, 1),
            ($3, $2, 'Coats', 20, 2, 2),
            ($4, $5, 'Rice', 20, 4, 1)`,
    [ids.itemA1, ids.itemRequestA, ids.itemA2, ids.itemB, ids.itemRequestB],
  );
  await pool.query(
    `insert into volunteer_roles (id, volunteer_request_id, name, quantity_needed, quantity_interested, sort_order)
     values ($1, $2, 'Driver', 10, 1, 1),
            ($3, $2, 'Loader', 10, 1, 2)`,
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
  await pool.query(`delete from approval_events where entity_id = any($1::uuid[])`, [[ids.pledgeA, ids.pledgeB, ids.pledgeC, ids.signup]]);
  await pool.query(`delete from item_pledges where id = any($1::uuid[])`, [[ids.pledgeA, ids.pledgeB, ids.pledgeC]]);
  await pool.query(`delete from volunteer_signups where id = $1`, [ids.signup]);
  await pool.query(`delete from participation_history where entity_id = any($1::uuid[])`, [[ids.pledgeA, ids.pledgeB, ids.pledgeC, ids.signup]]);
  await pool.query(`delete from item_requests where id = any($1::uuid[])`, [[ids.itemRequestA, ids.itemRequestB]]);
  await pool.query(`delete from volunteer_requests where id = $1`, [ids.volunteerRequest]);
  await pool.query(`delete from people where id = any($1::uuid[])`, [[ids.personA, ids.personB, ids.personC]]);
  await pool.query(`delete from organizations where id = any($1::uuid[])`, [[ids.orgA, ids.orgB]]);
}

async function main(): Promise<void> {
  await createFixtures();
  try {
    const [adminCookie, approverCookie, ownerCookie, supporterCookie] = await Promise.all([
      quickLogin("staff_admin"),
      quickLogin("staff_approver"),
      quickLogin("org_owner"),
      quickLogin("supporter"),
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

    const donationDetail = await get(`/api/admin/participation/donations/${ids.pledgeA}`, adminCookie);
    const donationDetailBody = donationDetail.body as {
      record: DonationRow;
      choices: unknown[];
      history: unknown[];
    };
    assert(
      donationDetail.response.status === 200 &&
        donationDetailBody.record.status === "active" &&
        donationDetailBody.choices.length === 2,
      "staff admin can load editable donation detail",
      donationDetail.body,
    );
    const donationEdited = await post(
      `/api/admin/participation/donations/${ids.pledgeA}/edit`,
      {
        expectedUpdatedAt: donationDetailBody.record.updatedAt,
        expectedVersion: donationDetailBody.record.participationVersion,
        reason: "zz_fixture correct quantities",
        notes: "zz_fixture corrected note",
        lines: [
          { itemId: ids.itemA1, quantity: 4 },
          { itemId: ids.itemA2, quantity: 1 },
        ],
      },
      adminCookie,
    );
    const donationEditedRow = (donationEdited.body as { record: DonationRow }).record;
    assert(donationEdited.response.status === 200, "donation correction succeeds", donationEdited.body);
    const correctedCounters = await pool.query<{ id: string; quantity_claimed: number }>(
      `select id, quantity_claimed from items where id = any($1::uuid[]) order by id`,
      [[ids.itemA1, ids.itemA2]],
    );
    assert(
      correctedCounters.rows.reduce<Record<string, number>>((out, row) => ({ ...out, [row.id]: row.quantity_claimed }), {})[ids.itemA1] === 4 &&
        correctedCounters.rows.reduce<Record<string, number>>((out, row) => ({ ...out, [row.id]: row.quantity_claimed }), {})[ids.itemA2] === 1,
      "donation correction updates protected counters exactly once",
      correctedCounters.rows,
    );
    const staleCancel = await post(
      `/api/admin/participation/donations/${ids.pledgeA}/cancel`,
      { expectedUpdatedAt: donationDetailBody.record.updatedAt, expectedVersion: donationDetailBody.record.participationVersion, reason: "zz_fixture stale cancel" },
      adminCookie,
    );
    assert(staleCancel.response.status === 409, "stale donation change is rejected without a partial write", staleCancel.body);
    await pool.query(
      `update item_requests set status = 'archived', archived_reason = 'fulfilled', archived_at = now() where id = $1`,
      [ids.itemRequestA],
    );
    const reducedFulfilled = await post(
      `/api/admin/participation/donations/${ids.pledgeA}/edit`,
      {
        expectedUpdatedAt: donationEditedRow.updatedAt,
        expectedVersion: donationEditedRow.participationVersion,
        reason: "zz_fixture reduce fulfilled pledge",
        notes: "zz_fixture corrected note",
        lines: [
          { itemId: ids.itemA1, quantity: 3 },
          { itemId: ids.itemA2, quantity: 1 },
        ],
      },
      adminCookie,
    );
    const reducedFulfilledRow = (reducedFulfilled.body as { record: DonationRow }).record;
    const requestAfterReduction = await pool.query<{ status: string }>(
      `select status from item_requests where id = $1`,
      [ids.itemRequestA],
    );
    assert(
      reducedFulfilled.response.status === 200 && requestAfterReduction.rows[0]?.status === "active",
      "reducing an active pledge reopens an automatically fulfilled request",
      { response: reducedFulfilled.body, request: requestAfterReduction.rows },
    );
    await pool.query(
      `update item_requests set status = 'archived', archived_reason = 'fulfilled', archived_at = now() where id = $1`,
      [ids.itemRequestA],
    );
    const donationCancelled = await post(
      `/api/admin/participation/donations/${ids.pledgeA}/cancel`,
      { expectedUpdatedAt: reducedFulfilledRow.updatedAt, expectedVersion: reducedFulfilledRow.participationVersion, reason: "zz_fixture supporter withdrew" },
      adminCookie,
    );
    const donationCancelledRow = (donationCancelled.body as { record: DonationRow }).record;
    assert(donationCancelled.response.status === 200 && donationCancelledRow.status === "cancelled", "donation cancellation preserves a cancelled row");
    const reopenedRequest = await pool.query<{ status: string; archived_reason: string | null }>(
      `select status, archived_reason from item_requests where id = $1`,
      [ids.itemRequestA],
    );
    assert(
      reopenedRequest.rows[0]?.status === "active" && reopenedRequest.rows[0]?.archived_reason === null,
      "cancelling participation reopens only an automatically fulfilled item request",
      reopenedRequest.rows,
    );
    const countersAfterCancel = await pool.query<{ total: number }>(
      `select sum(quantity_claimed)::int as total from items where id = any($1::uuid[])`,
      [[ids.itemA1, ids.itemA2]],
    );
    assert(countersAfterCancel.rows[0]?.total === 0, "donation cancellation releases all active quantities", countersAfterCancel.rows);
    await pool.query(`update items set quantity_requested = case when id = $1 then 3 else 1 end where id = any($2::uuid[])`, [
      ids.itemA1,
      [ids.itemA1, ids.itemA2],
    ]);
    const donationReinstated = await post(
      `/api/admin/participation/donations/${ids.pledgeA}/reinstate`,
      { expectedUpdatedAt: donationCancelledRow.updatedAt, expectedVersion: donationCancelledRow.participationVersion, reason: "zz_fixture commitment restored" },
      adminCookie,
    );
    const donationReinstatedRow = (donationReinstated.body as { record: DonationRow }).record;
    assert(donationReinstated.response.status === 200 && donationReinstatedRow.status === "active", "donation can be reinstated after locked capacity checks");
    const requestAfterReinstate = await pool.query<{ status: string; archived_reason: string | null }>(
      `select status, archived_reason from item_requests where id = $1`,
      [ids.itemRequestA],
    );
    assert(
      requestAfterReinstate.rows[0]?.status === "archived" && requestAfterReinstate.rows[0]?.archived_reason === "fulfilled",
      "reinstating a pledge that fills final capacity archives the request as fulfilled",
      requestAfterReinstate.rows,
    );
    await pool.query(`update items set quantity_requested = 4 where id = $1`, [ids.itemA1]);
    const overCapacity = await post(
      `/api/admin/participation/donations/${ids.pledgeA}/edit`,
      {
        expectedUpdatedAt: donationReinstatedRow.updatedAt,
        expectedVersion: donationReinstatedRow.participationVersion,
        reason: "zz_fixture impossible increase",
        lines: [{ itemId: ids.itemA1, quantity: 5 }],
      },
      adminCookie,
    );
    assert(overCapacity.response.status === 409, "capacity conflict fails visibly", overCapacity.body);
    const wrongRequestChild = await post(
      `/api/admin/participation/donations/${ids.pledgeA}/edit`,
      {
        expectedUpdatedAt: donationReinstatedRow.updatedAt,
        expectedVersion: donationReinstatedRow.participationVersion,
        reason: "zz_fixture wrong request child",
        lines: [{ itemId: ids.itemB, quantity: 1 }],
      },
      adminCookie,
    );
    assert(wrongRequestChild.response.status === 400, "an item from another request is rejected atomically", wrongRequestChild.body);
    await pool.query(`update items set quantity_requested = 10 where id = $1`, [ids.itemA1]);
    const concurrentBodies = [
      {
        expectedUpdatedAt: donationReinstatedRow.updatedAt,
        expectedVersion: donationReinstatedRow.participationVersion,
        reason: "zz_fixture concurrent correction A",
        lines: [{ itemId: ids.itemA1, quantity: 2 }],
      },
      {
        expectedUpdatedAt: donationReinstatedRow.updatedAt,
        expectedVersion: donationReinstatedRow.participationVersion,
        reason: "zz_fixture concurrent correction B",
        lines: [{ itemId: ids.itemA1, quantity: 3 }],
      },
    ];
    const concurrent = await Promise.all(
      concurrentBodies.map((body) =>
        post(`/api/admin/participation/donations/${ids.pledgeA}/edit`, body, adminCookie),
      ),
    );
    assert(
      concurrent.map((result) => result.response.status).sort().join(",") === "200,409",
      "concurrent corrections serialize and exactly one stale writer loses",
      concurrent.map((result) => ({ status: result.response.status, body: result.body })),
    );
    const counterAfterRace = await pool.query<{ quantity_claimed: number }>(
      `select quantity_claimed from items where id = $1`,
      [ids.itemA1],
    );
    assert(
      [2, 3].includes(counterAfterRace.rows[0]?.quantity_claimed ?? -1),
      "concurrent correction leaves the winner's exact counter with no partial loser update",
      counterAfterRace.rows,
    );

    const volunteerDetail = await get(`/api/admin/participation/volunteers/${ids.signup}`, adminCookie);
    const volunteerDetailBody = volunteerDetail.body as { record: VolunteerRow; history: unknown[] };
    const volunteerEdited = await post(
      `/api/admin/participation/volunteers/${ids.signup}/edit`,
      {
        expectedUpdatedAt: volunteerDetailBody.record.updatedAt,
        expectedVersion: volunteerDetailBody.record.participationVersion,
        reason: "zz_fixture correct role",
        notes: "zz_fixture corrected volunteer note",
        roleIds: [ids.role1],
      },
      adminCookie,
    );
    const volunteerEditedRow = (volunteerEdited.body as { record: VolunteerRow }).record;
    assert(volunteerEdited.response.status === 200, "volunteer role correction succeeds", volunteerEdited.body);
    const volunteerCancelled = await post(
      `/api/admin/participation/volunteers/${ids.signup}/cancel`,
      { expectedUpdatedAt: volunteerEditedRow.updatedAt, expectedVersion: volunteerEditedRow.participationVersion, reason: "zz_fixture no longer available" },
      adminCookie,
    );
    const volunteerCancelledRow = (volunteerCancelled.body as { record: VolunteerRow }).record;
    assert(volunteerCancelled.response.status === 200 && volunteerCancelledRow.status === "cancelled", "volunteer cancellation preserves history");
    const repeatVolunteerCancel = await post(
      `/api/admin/participation/volunteers/${ids.signup}/cancel`,
      { expectedUpdatedAt: volunteerCancelledRow.updatedAt, expectedVersion: volunteerCancelledRow.participationVersion, reason: "zz_fixture duplicate cancellation" },
      adminCookie,
    );
    assert(repeatVolunteerCancel.response.status === 409, "repeat cancellation is rejected without changing counters");
    const cancelledVolunteerEdit = await post(
      `/api/admin/participation/volunteers/${ids.signup}/edit`,
      {
        expectedUpdatedAt: volunteerCancelledRow.updatedAt,
        expectedVersion: volunteerCancelledRow.participationVersion,
        reason: "zz_fixture correct cancelled role",
        notes: "zz_fixture corrected while cancelled",
        roleIds: [ids.role2],
      },
      adminCookie,
    );
    const cancelledVolunteerEditRow = (cancelledVolunteerEdit.body as { record: VolunteerRow }).record;
    assert(
      cancelledVolunteerEdit.response.status === 200 && cancelledVolunteerEditRow.status === "cancelled",
      "a cancelled volunteer signup can be corrected without becoming active",
      cancelledVolunteerEdit.body,
    );
    const cancelledRoleCounters = await pool.query<{ total: number }>(
      `select sum(quantity_interested)::int as total from volunteer_roles where id = any($1::uuid[])`,
      [[ids.role1, ids.role2]],
    );
    assert(cancelledRoleCounters.rows[0]?.total === 0, "editing a cancelled signup does not decrement released counters again");
    const volunteerReinstated = await post(
      `/api/admin/participation/volunteers/${ids.signup}/reinstate`,
      { expectedUpdatedAt: cancelledVolunteerEditRow.updatedAt, expectedVersion: cancelledVolunteerEditRow.participationVersion, reason: "zz_fixture available again" },
      adminCookie,
    );
    assert(volunteerReinstated.response.status === 200, "volunteer signup can be reinstated");
    const roleCounters = await pool.query<{ id: string; quantity_interested: number }>(
      `select id, quantity_interested from volunteer_roles where id = any($1::uuid[]) order by id`,
      [[ids.role1, ids.role2]],
    );
    const byRole = Object.fromEntries(roleCounters.rows.map((row) => [row.id, row.quantity_interested]));
    assert(byRole[ids.role1] === 0 && byRole[ids.role2] === 1, "volunteer counters follow active selected roles", roleCounters.rows);
    const audit = await pool.query<{ history: number; activity: number; distinct_actors: number }>(
      `select
         (select count(*)::int from participation_history where entity_id = any($1::uuid[])) as history,
         (select count(*)::int from approval_events where entity_id = any($1::uuid[])) as activity,
         (select count(distinct actor_user_id)::int from participation_history where entity_id = any($1::uuid[])) as distinct_actors`,
      [[ids.pledgeA, ids.signup]],
    );
    assert(
      (audit.rows[0]?.history ?? 0) >= 6 &&
        audit.rows[0]?.activity === audit.rows[0]?.history &&
        audit.rows[0]?.distinct_actors === 1,
      "every management change has immutable before/after history and the real staff actor",
      audit.rows,
    );
    const historyId = await pool.query<{ id: string }>(
      `select id from participation_history where entity_id = $1 order by created_at limit 1`,
      [ids.pledgeA],
    );
    let historyMutationBlocked = false;
    try {
      await pool.query(`update participation_history set reason = 'tampered' where id = $1`, [historyId.rows[0]!.id]);
    } catch (error) {
      historyMutationBlocked = String(error).includes("participation_history_is_append_only");
    }
    assert(historyMutationBlocked, "participation history cannot be rewritten after creation");

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
      ["supporter", supporterCookie],
      ["anonymous visitor", ""],
    ] as const) {
      const denied = await get("/api/admin/participation/donations", cookie);
      assert(denied.response.status === 404, `${label} cannot discover the participation API`, denied.response.status);
      assert(
        JSON.stringify(denied.body) === JSON.stringify({ message: "Not found" }),
        `${label} receives the unknown-route response`,
        denied.body,
      );
      const deniedMutation = await post(
        `/api/admin/participation/donations/${ids.pledgeA}/cancel`,
        { expectedUpdatedAt: donationReinstatedRow.updatedAt, expectedVersion: donationReinstatedRow.participationVersion, reason: "zz_fixture forbidden" },
        cookie,
      );
      assert(deniedMutation.response.status === 404, `${label} cannot mutate participation`, deniedMutation.body);
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