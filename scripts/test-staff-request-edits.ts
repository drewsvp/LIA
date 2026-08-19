/**
 * Integration coverage for ADMIN-02 staff corrections and returned recovery.
 *
 * Requires the development workflow and seeded quick-login accounts.
 * Writes zz_fixture rows and removes them before exit.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-staff-request-edits.ts
 */
import { pool } from "../server/db/client";

const BASE = "http://localhost:5000";
const marker = `zz_fixture_staff_edit_${process.pid}`;
let passed = 0;
let failed = 0;
const requestIds: string[] = [];
let contactId: string | null = null;

function assert(condition: boolean, label: string, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function cookies(res: Response): string {
  const headers = res.headers as unknown as { getSetCookie?: () => string[]; get: (name: string) => string | null };
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return raw.map((value) => value.split(";")[0]).join("; ");
}

async function login(role: "staff_approver" | "org_owner"): Promise<string> {
  const res = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`quick login ${role} failed: ${res.status}`);
  return cookies(res);
}

async function request(cookie: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function main(): Promise<void> {
  console.log("\n[staff request edit tests]\n");
  const staff = await login("staff_approver");
  const member = await login("org_owner");
  const org = await pool.query<{ id: string }>(
    `select id from organizations where kind = 'member_org' and status = 'approved' order by created_at limit 1`,
  );
  const orgId = org.rows[0]?.id;
  if (!orgId) throw new Error("No approved member organization found — run db:seed first.");

  const contact = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, phone, source_note)
     values ('ZZ', 'Fixture', $1, '555-0100', $2) returning id`,
    [`${marker}@example.invalid`, marker],
  );
  contactId = contact.rows[0]!.id;

  const itemRequest = await pool.query<{ id: string }>(
    `insert into item_requests
       (org_id, title, description, dropoff_location, people_helped, deadline_type,
        contact_person_id, status, submitted_at)
     values ($1, $2, 'Original item description', 'Old dropoff', 2, 'ongoing', $3, 'pending', now())
     returning id`,
    [orgId, `${marker} item`, contactId],
  );
  const itemId = itemRequest.rows[0]!.id;
  requestIds.push(itemId);
  await pool.query(
    `insert into approval_events (entity_type, entity_id, from_status, to_status, note)
     values ('item_request', $1, 'draft', 'pending', $2)`,
    [itemId, marker],
  );
  const itemRows = await pool.query<{ id: string }>(
    `insert into items (item_request_id, name, description, condition, quantity_requested, sort_order)
     values ($1, 'Remove me', 'First', 'new', 1, 0), ($1, 'Keep me', 'Second', 'any', 2, 1)
     returning id`,
    [itemId],
  );

  const volunteerRequest = await pool.query<{ id: string }>(
    `insert into volunteer_requests
       (org_id, title, description, details, event_location, people_helped, deadline_type,
        contact_person_id, status, submitted_at)
     values ($1, $2, 'Original volunteer description', 'Original details', 'Old location', 3,
             'ongoing', $3, 'pending', now())
     returning id`,
    [orgId, `${marker} volunteer`, contactId],
  );
  const volunteerId = volunteerRequest.rows[0]!.id;
  requestIds.push(volunteerId);
  await pool.query(
    `insert into approval_events (entity_type, entity_id, from_status, to_status, note)
     values ('volunteer_request', $1, 'draft', 'pending', $2)`,
    [volunteerId, marker],
  );
  const roleRows = await pool.query<{ id: string }>(
    `insert into volunteer_roles (volunteer_request_id, name, description, quantity_needed, sort_order)
     values ($1, 'Remove role', 'First', 1, 0), ($1, 'Keep role', 'Second', 2, 1)
     returning id`,
    [volunteerId],
  );

  const unauthorized = await request(member, `/api/admin/requests/item/${itemId}`);
  assert(unauthorized.status === 404, "organization member cannot open the staff editor", `status ${unauthorized.status}`);

  const pending = await request(staff, "/api/admin/requests?status=pending");
  const pendingBody = (await pending.json()) as { requests?: Array<{ id: string }> };
  assert(
    pending.ok && pendingBody.requests?.some((row) => row.id === itemId) === true,
    "pending fixture appears in the staff queue",
  );

  const itemEditBody = {
    title: `${marker} item corrected`,
    description: "Corrected item description",
    contactFirstName: "Corrected",
    contactLastName: "Contact",
    contactEmail: `${marker}@example.invalid`,
    contactPhone: "555-0199",
    deadlineType: "date_specific",
    deadlineDate: "2027-01-15",
    peopleHelped: 5,
    dropoffLocation: "Corrected dropoff",
    children: [
      {
        id: itemRows.rows[1]!.id,
        name: "Kept and reordered",
        description: "Updated second",
        condition: "gently_used",
        productUrl: "https://example.com/item",
        quantityRequested: 7,
      },
      {
        name: "New item",
        description: "Added by staff",
        condition: "new",
        productUrl: null,
        quantityRequested: 4,
      },
    ],
  };
  const itemEdit = await request(staff, `/api/admin/requests/item/${itemId}/edit`, itemEditBody);
  assert(itemEdit.ok, "staff can atomically correct every item request field and child structure", `status ${itemEdit.status}`);
  const itemCheck = await pool.query<{
    title: string;
    status: string;
    names: string[];
    requested: number[];
    claimed: number[];
    received: number[];
  }>(
    `select r.title, r.status,
            array_agg(i.name order by i.sort_order) as names,
            array_agg(i.quantity_requested order by i.sort_order)::int[] as requested,
            array_agg(i.quantity_claimed order by i.sort_order)::int[] as claimed,
            array_agg(i.quantity_received order by i.sort_order)::int[] as received
       from item_requests r join items i on i.item_request_id = r.id
      where r.id = $1 group by r.id`,
    [itemId],
  );
  assert(
    itemCheck.rows[0]?.status === "pending" &&
      itemCheck.rows[0]?.names.join("|") === "Kept and reordered|New item" &&
      itemCheck.rows[0]?.requested.join("|") === "7|4" &&
      itemCheck.rows[0]?.claimed.every((n) => n === 0) &&
      itemCheck.rows[0]?.received.every((n) => n === 0),
    "item edit preserves Pending and never writes claim/receipt activity",
  );
  const contactCheck = await pool.query<{ firstName: string; lastName: string; phone: string }>(
    `select first_name as "firstName", last_name as "lastName", phone from people where id = $1`,
    [contactId],
  );
  assert(
    contactCheck.rows[0]?.firstName === "Corrected" &&
      contactCheck.rows[0]?.lastName === "Contact" &&
      contactCheck.rows[0]?.phone === "555-0199",
    "staff can edit the currently attached request contact's name and phone",
  );

  const returnNote = "Contact the organization directly about the corrected location.";
  const returned = await request(staff, `/api/admin/requests/item/${itemId}/return-to-draft`, { note: returnNote });
  assert(returned.ok, "staff can return the item request with an instruction/history note");
  const returnedQueue = await request(staff, "/api/admin/requests?status=returned");
  const returnedBody = (await returnedQueue.json()) as { requests?: Array<{ id: string }> };
  assert(
    returnedQueue.ok && returnedBody.requests?.some((row) => row.id === itemId) === true,
    "returned view contains the previously submitted draft",
  );
  const returnedDetail = await request(staff, `/api/admin/requests/item/${itemId}`);
  const returnedDetailBody = (await returnedDetail.json()) as { latestReturn?: { note?: string }; editability?: { editable?: boolean } };
  assert(
    returnedDetailBody.latestReturn?.note === returnNote && returnedDetailBody.editability?.editable === true,
    "returned detail exposes the latest return note and stays editable",
  );
  const neverSubmitted = await pool.query<{ id: string }>(
    `insert into item_requests (org_id, title, status) values ($1, $2, 'draft') returning id`,
    [orgId, `${marker} ordinary draft`],
  );
  requestIds.push(neverSubmitted.rows[0]!.id);
  const returnedAgain = await request(staff, "/api/admin/requests?status=returned");
  const returnedAgainBody = (await returnedAgain.json()) as { requests?: Array<{ id: string }> };
  assert(
    returnedAgainBody.requests?.some((row) => row.id === neverSubmitted.rows[0]!.id) === false,
    "returned view excludes never-submitted organization drafts",
  );
  const ordinaryDetail = await request(staff, `/api/admin/requests/item/${neverSubmitted.rows[0]!.id}`);
  const ordinaryDetailBody = (await ordinaryDetail.json()) as { editability?: { editable?: boolean } };
  assert(
    ordinaryDetailBody.editability?.editable === false,
    "direct detail access does not advertise ordinary organization drafts as staff-editable",
  );

  const itemPending = await request(staff, `/api/admin/requests/item/${itemId}/move-to-pending`, {});
  assert(itemPending.ok, "staff can deliberately move a corrected returned item request to Pending");
  const itemEmails = await pool.query<{ count: string }>(
    `select count(*)::text as count from email_log where entity_id = $1`,
    [itemId],
  );
  assert(Number(itemEmails.rows[0]?.count ?? 0) === 0, "return and staff recovery queue no email");

  const liveItem = await pool.query<{ id: string }>(
    `select id from items where item_request_id = $1 order by sort_order limit 1`,
    [itemId],
  );
  await pool.query(`update items set quantity_received = 1 where id = $1`, [liveItem.rows[0]!.id]);
  const blockedItem = await request(staff, `/api/admin/requests/item/${itemId}/edit`, {
    ...itemEditBody,
    title: "must not save",
    children: itemEditBody.children.map((row, index) => ({
      ...row,
      id: index === 0 ? liveItem.rows[0]!.id : undefined,
    })),
  });
  assert(blockedItem.status === 409, "item edits are rejected after receipt activity begins", `status ${blockedItem.status}`);
  const unchangedItem = await pool.query<{ title: string }>(`select title from item_requests where id = $1`, [itemId]);
  assert(unchangedItem.rows[0]?.title !== "must not save", "blocked item edit rolls back every request-field change");
  await pool.query(`update items set quantity_received = 0 where item_request_id = $1`, [itemId]);
  await pool.query(`update item_requests set status = 'active', approved_at = now() where id = $1`, [itemId]);
  const blockedApprovedItem = await request(staff, `/api/admin/requests/item/${itemId}/edit`, itemEditBody);
  assert(blockedApprovedItem.status === 409, "approved requests cannot be edited", `status ${blockedApprovedItem.status}`);

  const volunteerEditBody = {
    title: `${marker} volunteer corrected`,
    description: "Corrected volunteer description",
    details: "Corrected role details",
    eventLocation: "Corrected event location",
    contactFirstName: "Corrected",
    contactLastName: "Contact",
    contactEmail: `${marker}@example.invalid`,
    contactPhone: "555-0199",
    deadlineType: "date_specific",
    deadlineDate: "2027-02-15",
    peopleHelped: 8,
    children: [
      {
        id: roleRows.rows[1]!.id,
        name: "Kept role reordered",
        description: "Updated role",
        quantityNeeded: 6,
      },
      { name: "New role", description: "Added by staff", quantityNeeded: 3 },
    ],
  };
  const volunteerEdit = await request(
    staff,
    `/api/admin/requests/volunteer/${volunteerId}/edit`,
    volunteerEditBody,
  );
  assert(volunteerEdit.ok, "staff can atomically correct every volunteer field and role structure", `status ${volunteerEdit.status}`);
  const volunteerCheck = await pool.query<{
    status: string;
    names: string[];
    needed: number[];
    interested: number[];
    confirmed: number[];
  }>(
    `select r.status,
            array_agg(vr.name order by vr.sort_order) as names,
            array_agg(vr.quantity_needed order by vr.sort_order)::int[] as needed,
            array_agg(vr.quantity_interested order by vr.sort_order)::int[] as interested,
            array_agg(vr.quantity_confirmed order by vr.sort_order)::int[] as confirmed
       from volunteer_requests r join volunteer_roles vr on vr.volunteer_request_id = r.id
      where r.id = $1 group by r.id`,
    [volunteerId],
  );
  assert(
    volunteerCheck.rows[0]?.status === "pending" &&
      volunteerCheck.rows[0]?.names.join("|") === "Kept role reordered|New role" &&
      volunteerCheck.rows[0]?.needed.join("|") === "6|3" &&
      volunteerCheck.rows[0]?.interested.every((n) => n === 0) &&
      volunteerCheck.rows[0]?.confirmed.every((n) => n === 0),
    "volunteer edit preserves Pending and never writes interest/confirmation activity",
  );
  const volunteerReturned = await request(
    staff,
    `/api/admin/requests/volunteer/${volunteerId}/return-to-draft`,
    { note: "Clarify the shift." },
  );
  assert(volunteerReturned.ok, "volunteer return still works and records history");
  const volunteerPending = await request(
    staff,
    `/api/admin/requests/volunteer/${volunteerId}/move-to-pending`,
    {},
  );
  assert(volunteerPending.ok, "returned volunteer request can recover to Pending without approval");
  const liveRole = await pool.query<{ id: string }>(
    `select id from volunteer_roles where volunteer_request_id = $1 order by sort_order limit 1`,
    [volunteerId],
  );
  await pool.query(`update volunteer_roles set quantity_confirmed = 1 where id = $1`, [liveRole.rows[0]!.id]);
  const blockedVolunteer = await request(staff, `/api/admin/requests/volunteer/${volunteerId}/edit`, {
    ...volunteerEditBody,
    title: "must not save volunteer",
    children: volunteerEditBody.children.map((row, index) => ({
      ...row,
      id: index === 0 ? liveRole.rows[0]!.id : undefined,
    })),
  });
  assert(
    blockedVolunteer.status === 409,
    "volunteer edits are rejected after confirmation activity begins",
    `status ${blockedVolunteer.status}`,
  );

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

async function cleanup(): Promise<void> {
  if (requestIds.length > 0) {
    await pool.query(`delete from approval_events where entity_id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from email_log where entity_id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from item_requests where id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from volunteer_requests where id = any($1::uuid[])`, [requestIds]);
  }
  if (contactId) await pool.query(`delete from people where id = $1`, [contactId]);
  await pool.end();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);