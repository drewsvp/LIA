/**
 * Integration coverage for ADMIN-02 staff corrections and returned recovery.
 *
 * Requires the development workflow and seeded quick-login accounts.
 * Writes zz_fixture rows and removes them before exit.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-staff-request-edits.ts
 */
import { pool } from "../server/db/client";
import { approveRequest } from "../server/services/request-approval";
import { MAX_PRODUCT_URL_LENGTH } from "../shared/item-product-url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const BASE = "http://localhost:5000";
const BROWSER_BASE = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : BASE;
const marker = `zz_fixture_staff_edit_${process.pid}`;
let passed = 0;
let failed = 0;
const requestIds: string[] = [];
let contactId: string | null = null;
let volunteerCategoryId: string | null = null;
type RequestKind = "item" | "volunteer";
type QueueContractRow = {
  id: string;
  type: RequestKind;
  deadlineType: "date_specific" | "until_fulfilled" | "ongoing";
  deadlineDate: string | null;
  expiresOn: string | null;
};

function amazonUrl(asin: string, markerValue: string): string {
  return `https://www.amazon.com/dp/${asin}?tag=staff-edit-20&ref_=fixture&tracking=${markerValue.repeat(650)}`;
}

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

function browserCookies(cookie: string) {
  return cookie.split("; ").map((pair) => {
    const separator = pair.indexOf("=");
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      url: BROWSER_BASE,
      httpOnly: true,
      secure: BROWSER_BASE.startsWith("https://"),
      sameSite: "Lax" as const,
    };
  });
}

async function appearsPublic(kind: RequestKind, requestId: string): Promise<boolean> {
  const path = kind === "item" ? "/api/public/item-requests" : "/api/public/volunteer-requests";
  const res = await fetch(`${BASE}${path}`);
  const body = (await res.json()) as { requests?: Array<{ id: string }> };
  return res.ok && body.requests?.some((row) => row.id === requestId) === true;
}

async function lockWaiterCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from pg_stat_activity
      where pid <> pg_backend_pid() and wait_event_type = 'Lock'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function waitForAdditionalLockWaiters(baseline: number, additional: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await lockWaiterCount()) >= baseline + additional) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${additional} additional database lock waiter(s)`);
}

async function preparePreviouslyApprovedRequest(input: {
  kind: RequestKind;
  requestId: string;
  staffUserId: string;
  recipientPersonId: string;
  recipientEmail: string;
}): Promise<string> {
  const table = input.kind === "item" ? "item_requests" : "volunteer_requests";
  const entityType = input.kind === "item" ? "item_request" : "volunteer_request";
  const stamped = await pool.query<{ approvedAt: string }>(
    `update ${table}
        set status = 'active', approved_at = now() - interval '1 minute', approved_by = $2
      where id = $1
      returning approved_at as "approvedAt"`,
    [input.requestId, input.staffUserId],
  );
  await pool.query(
    `insert into approval_events
       (entity_type, entity_id, from_status, to_status, actor_user_id, note)
     values ($1, $2, 'pending', 'active', $3, $4)`,
    [entityType, input.requestId, input.staffUserId, marker],
  );
  await pool.query(
    `insert into email_log
       (template_key, to_email, to_person_id, entity_type, entity_id, payload, status, provider_message_id, sent_at)
     values ('org_request_approved', $1, $2, $3, $4, $5::jsonb, 'sent', $6, now())`,
    [
      input.recipientEmail,
      input.recipientPersonId,
      entityType,
      input.requestId,
      JSON.stringify({ zz_fixture: marker }),
      `zz-provider-${input.requestId}`,
    ],
  );
  return stamped.rows[0]!.approvedAt;
}

async function main(): Promise<void> {
  console.log("\n[staff request edit tests]\n");
  const staff = await login("staff_approver");
  const member = await login("org_owner");
  const org = await pool.query<{ id: string; contactPersonId: string; contactEmail: string }>(
    `select o.id, p.id as "contactPersonId", p.email as "contactEmail"
       from organizations o
       join people p on p.id = o.primary_contact_person_id
       join org_memberships om on om.org_id = o.id and om.status = 'active'
       join users member_user on member_user.id = om.user_id
       join people member_person on member_person.id = member_user.person_id
      where o.kind = 'member_org' and o.status = 'approved'
        and lower(member_person.email) = 'dana@heartsandhands.example.org'
      order by o.created_at
      limit 1`,
  );
  const fixtureOrg = org.rows[0];
  if (!fixtureOrg) throw new Error("No approved member organization with a contact found — run db:seed first.");
  const orgId = fixtureOrg.id;
  const staffUser = await pool.query<{ id: string }>(
    `select u.id
       from users u
       join people p on p.id = u.person_id
      where lower(p.email) = 'approver@thealliance.example.org'`,
  );
  const staffUserId = staffUser.rows[0]?.id;
  if (!staffUserId) throw new Error("Seeded staff approver user not found — run db:seed first.");

  const contact = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, phone, source_note)
     values ('ZZ', 'Fixture', $1, '555-0100', $2) returning id`,
    [`${marker}@example.invalid`, marker],
  );
  contactId = contact.rows[0]!.id;

  const itemRequest = await pool.query<{ id: string }>(
    `insert into item_requests
       (org_id, title, description, dropoff_location, people_helped, deadline_type,
         deadline_date, expires_on, contact_person_id, status, submitted_at)
      values ($1, $2, 'Original item description', 'Old dropoff', 2, 'date_specific',
              '2027-02-03', '2027-01-20', $3, 'pending', now())
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
              'until_fulfilled', $3, 'pending', now())
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
  const volunteerCategory = await pool.query<{ id: string }>(
    `insert into volunteer_categories (name) values ($1) returning id`,
    [`${marker} category`],
  );
  volunteerCategoryId = volunteerCategory.rows[0]!.id;
  await pool.query(
    `insert into volunteer_request_categories (volunteer_request_id, category_id) values ($1, $2)`,
    [volunteerId, volunteerCategoryId],
  );

  const unauthorized = await request(member, `/api/admin/requests/item/${itemId}`);
  assert(unauthorized.status === 404, "organization member cannot open the staff editor", `status ${unauthorized.status}`);

  const pending = await request(staff, "/api/admin/requests?status=pending");
  const pendingBody = (await pending.json()) as { requests?: QueueContractRow[] };
  const queuedItem = pendingBody.requests?.find((row) => row.id === itemId);
  const queuedVolunteer = pendingBody.requests?.find((row) => row.id === volunteerId);
  assert(
    pending.ok && pendingBody.requests?.some((row) => row.id === itemId) === true,
    "pending fixture appears in the staff queue",
  );
  assert(
    queuedItem?.type === "item" &&
      queuedItem.deadlineType === "date_specific" &&
      queuedItem.deadlineDate === "2027-02-03" &&
      queuedItem.expiresOn === "2027-01-20" &&
      queuedVolunteer?.type === "volunteer" &&
      queuedVolunteer.deadlineType === "until_fulfilled" &&
      queuedVolunteer.deadlineDate === null &&
      queuedVolunteer.expiresOn === null,
    "pending item and volunteer rows expose the same complete expiration contract",
    JSON.stringify({ item: queuedItem, volunteer: queuedVolunteer }),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() ||
      execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
  });
  try {
    const context = await browser.newContext();
    await context.addCookies(browserCookies(staff));
    const page = await context.newPage();
    await page.goto(`${BROWSER_BASE}/admin/requests`, { waitUntil: "networkidle" });
    const queueTable = page.locator(".adm-table");
    await queueTable.waitFor();
    const headers = await queueTable.locator("th").allTextContents();
    const itemQueueRow = queueTable.getByRole("row").filter({ hasText: `${marker} item` });
    const volunteerQueueRow = queueTable.getByRole("row").filter({ hasText: `${marker} volunteer` });
    assert(
      headers.includes("Expiration") &&
        (await itemQueueRow.getByRole("cell", { name: "Jan 20, 2027", exact: true }).count()) === 1 &&
        (await volunteerQueueRow.getByRole("cell", { name: "Until fulfilled", exact: true }).count()) === 1,
      "the queue renders date and non-date expiration labels without shifting calendar days",
      JSON.stringify(headers),
    );
    await itemQueueRow.click();
    assert(
      await itemQueueRow.evaluate((row) => row.classList.contains("adm-row-on")),
      "selecting a queue row still works with the expiration cell",
    );
    await page.getByRole("button", { name: "Items", exact: true }).click();
    assert(
      headers.includes("Expiration") &&
        (await queueTable.getByRole("row").filter({ hasText: `${marker} item` }).count()) === 1,
      "the Items filter keeps the expiration column and matching selected row",
    );
    await page.getByRole("button", { name: "Volunteer", exact: true }).click();
    assert(
      headers.includes("Expiration") &&
        (await queueTable.getByRole("row").filter({ hasText: `${marker} volunteer` }).count()) === 1,
      "the Volunteer filter keeps the expiration column and matching row",
    );
  } finally {
    await browser.close();
  }

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
        productUrl: amazonUrl("B000000001", "a"),
        quantityRequested: 7,
      },
      {
        name: "New item",
        description: "Added by staff",
        condition: "new",
        productUrl: amazonUrl("B000000002", "b"),
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
    productUrls: string[];
  }>(
    `select r.title, r.status,
            array_agg(i.name order by i.sort_order) as names,
            array_agg(i.quantity_requested order by i.sort_order)::int[] as requested,
            array_agg(i.quantity_claimed order by i.sort_order)::int[] as claimed,
             array_agg(i.quantity_received order by i.sort_order)::int[] as received,
             array_agg(i.product_url order by i.sort_order) as "productUrls"
       from item_requests r join items i on i.item_request_id = r.id
      where r.id = $1 group by r.id`,
    [itemId],
  );
  assert(
    itemCheck.rows[0]?.status === "pending" &&
      itemCheck.rows[0]?.names.join("|") === "Kept and reordered|New item" &&
      itemCheck.rows[0]?.requested.join("|") === "7|4" &&
      itemCheck.rows[0]?.claimed.every((n) => n === 0) &&
      itemCheck.rows[0]?.received.every((n) => n === 0) &&
      itemCheck.rows[0]?.productUrls[0] === itemEditBody.children[0]!.productUrl &&
      itemCheck.rows[0]?.productUrls[1] === itemEditBody.children[1]!.productUrl,
    "item edit preserves Pending, distinct long URLs, and claim/receipt activity",
  );
  const oversizedStaffEdit = await request(staff, `/api/admin/requests/item/${itemId}/edit`, {
    ...itemEditBody,
    title: "must not save oversized URL",
    children: itemEditBody.children.map((row, index) => ({
      ...row,
      productUrl:
        index === 0
          ? `https://www.amazon.com/dp/B000000003?tracking=${"x".repeat(MAX_PRODUCT_URL_LENGTH)}`
          : row.productUrl,
    })),
  });
  const oversizedStaffEditBody = (await oversizedStaffEdit.json()) as { message?: string };
  assert(
    oversizedStaffEdit.status === 400 &&
      oversizedStaffEditBody.message?.includes("Item 1") === true &&
      oversizedStaffEditBody.message?.includes("Product URL") === true,
    "invalid staff edits name the exact item field that must be fixed",
    oversizedStaffEditBody.message,
  );
  const unchangedAfterOversized = await pool.query<{ title: string; productUrls: string[] }>(
    `select r.title, array_agg(i.product_url order by i.sort_order) as "productUrls"
       from item_requests r join items i on i.item_request_id = r.id
      where r.id = $1 group by r.id`,
    [itemId],
  );
  assert(
    unchangedAfterOversized.rows[0]?.title === itemEditBody.title &&
      unchangedAfterOversized.rows[0]?.productUrls[0] === itemEditBody.children[0]!.productUrl &&
      unchangedAfterOversized.rows[0]?.productUrls[1] === itemEditBody.children[1]!.productUrl,
    "an invalid staff product URL leaves every request and item field unchanged",
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
  const returnedBody = (await returnedQueue.json()) as { requests?: QueueContractRow[] };
  const returnedItem = returnedBody.requests?.find((row) => row.id === itemId);
  assert(
    returnedQueue.ok && returnedBody.requests?.some((row) => row.id === itemId) === true,
    "returned view contains the previously submitted draft",
  );
  assert(
    returnedItem?.deadlineType === "date_specific" &&
      returnedItem.deadlineDate === itemEditBody.deadlineDate &&
      returnedItem.expiresOn === "2027-01-20",
    "returned item rows retain both current and legacy expiration data",
    JSON.stringify(returnedItem),
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

  const firstItemApprovalAt = await preparePreviouslyApprovedRequest({
    kind: "item",
    requestId: itemId,
    staffUserId,
    recipientPersonId: fixtureOrg.contactPersonId,
    recipientEmail: fixtureOrg.contactEmail,
  });
  assert(await appearsPublic("item", itemId), "an active item request appears publicly before correction");
  const activeItemDetail = await request(staff, `/api/admin/requests/item/${itemId}`);
  const activeItemBody = (await activeItemDetail.json()) as {
    editability?: { editable?: boolean; unapprovable?: boolean; reason?: string };
  };
  assert(
    activeItemBody.editability?.editable === false &&
      activeItemBody.editability?.unapprovable === true &&
      activeItemBody.editability?.reason?.includes("Unapprove") === true,
    "active item detail explains that unapproval is required before editing",
  );
  const blockedApprovedItem = await request(staff, `/api/admin/requests/item/${itemId}/edit`, itemEditBody);
  assert(blockedApprovedItem.status === 409, "approved requests cannot be edited", `status ${blockedApprovedItem.status}`);
  const unauthorizedUnapproveItem = await request(member, `/api/admin/requests/item/${itemId}/unapprove`, {});
  assert(
    unauthorizedUnapproveItem.status === 404,
    "organization members cannot unapprove an item request",
    `status ${unauthorizedUnapproveItem.status}`,
  );
  const itemUnapproved = await request(staff, `/api/admin/requests/item/${itemId}/unapprove`, {});
  assert(itemUnapproved.ok, "staff can unapprove an active item request with no activity", `status ${itemUnapproved.status}`);
  const itemAfterUnapprove = await pool.query<{
    status: string;
    approvedAt: string | null;
    approvedBy: string | null;
  }>(
    `select status, approved_at as "approvedAt", approved_by as "approvedBy"
       from item_requests where id = $1`,
    [itemId],
  );
  assert(
    itemAfterUnapprove.rows[0]?.status === "pending" &&
      itemAfterUnapprove.rows[0]?.approvedAt === null &&
      itemAfterUnapprove.rows[0]?.approvedBy === null &&
      !(await appearsPublic("item", itemId)),
    "item unapproval atomically clears the live approval stamp and public visibility",
  );
  const staleItemUnapprove = await request(staff, `/api/admin/requests/item/${itemId}/unapprove`, {});
  const staleItemBody = (await staleItemUnapprove.json()) as { message?: string };
  assert(
    staleItemUnapprove.status === 409 && staleItemBody.message?.includes("pending") === true,
    "a stale repeated item unapproval reports the current state without another transition",
  );
  const itemReapprovalEdit = await request(staff, `/api/admin/requests/item/${itemId}/edit`, {
    ...itemEditBody,
    title: `${marker} item corrected after unapproval`,
  });
  assert(itemReapprovalEdit.ok, "the unapproved item request is immediately editable");
  const itemReapproved = await request(staff, `/api/admin/requests/item/${itemId}/approve`, {});
  const itemReapprovedBody = (await itemReapproved.json()) as { message?: string };
  assert(
    itemReapproved.ok && itemReapprovedBody.message?.includes("no duplicate was queued") === true,
    "item reapproval publishes without duplicating a prior successful approval email",
    itemReapprovedBody.message,
  );
  const itemAfterReapproval = await pool.query<{
    status: string;
    approvedAt: string;
    approvedBy: string;
  }>(
    `select status, approved_at as "approvedAt", approved_by as "approvedBy"
       from item_requests where id = $1`,
    [itemId],
  );
  const itemEvents = await pool.query<{
    fromStatus: string;
    toStatus: string;
    actorUserId: string | null;
  }>(
    `select from_status as "fromStatus", to_status as "toStatus", actor_user_id as "actorUserId"
       from approval_events
      where entity_type = 'item_request' and entity_id = $1
        and ((from_status = 'active' and to_status = 'pending')
          or (from_status = 'pending' and to_status = 'active'))
      order by created_at`,
    [itemId],
  );
  const itemEmailCount = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from email_log
      where template_key = 'org_request_approved' and entity_type = 'item_request' and entity_id = $1`,
    [itemId],
  );
  assert(
    itemAfterReapproval.rows[0]?.status === "active" &&
      new Date(itemAfterReapproval.rows[0]!.approvedAt).getTime() > new Date(firstItemApprovalAt).getTime() &&
      itemAfterReapproval.rows[0]?.approvedBy === staffUserId &&
      itemEvents.rows.filter((row) => row.fromStatus === "active" && row.toStatus === "pending").length === 1 &&
      itemEvents.rows.filter((row) => row.fromStatus === "pending" && row.toStatus === "active").length === 2 &&
      itemEvents.rows.every((row) => row.actorUserId === staffUserId) &&
      Number(itemEmailCount.rows[0]?.count ?? 0) === 1 &&
      (await appearsPublic("item", itemId)),
    "item reapproval refreshes the stamp, records both staff actions, stays once-only by email, and republishes",
  );

  await pool.query(`update items set quantity_received = 1 where id = $1`, [liveItem.rows[0]!.id]);
  const itemStampBeforeBlockedUnapprove = itemAfterReapproval.rows[0]!.approvedAt;
  const blockedItemUnapprove = await request(staff, `/api/admin/requests/item/${itemId}/unapprove`, {});
  const blockedItemUnapproveBody = (await blockedItemUnapprove.json()) as { message?: string };
  const itemAfterBlockedUnapprove = await pool.query<{ status: string; approvedAt: string; events: string }>(
    `select r.status, r.approved_at as "approvedAt",
            (select count(*)::text from approval_events ae
              where ae.entity_type = 'item_request' and ae.entity_id = r.id
                and ae.from_status = 'active' and ae.to_status = 'pending') as events
       from item_requests r where r.id = $1`,
    [itemId],
  );
  assert(
    blockedItemUnapprove.status === 409 &&
      blockedItemUnapproveBody.message?.includes("activity") === true &&
      itemAfterBlockedUnapprove.rows[0]?.status === "active" &&
      new Date(itemAfterBlockedUnapprove.rows[0]!.approvedAt).getTime() ===
        new Date(itemStampBeforeBlockedUnapprove).getTime() &&
      itemAfterBlockedUnapprove.rows[0]?.events === "1",
    "receipt activity blocks item unapproval and rolls back status, stamp, and history",
    JSON.stringify({
      status: blockedItemUnapprove.status,
      message: blockedItemUnapproveBody.message,
      before: itemStampBeforeBlockedUnapprove,
      after: itemAfterBlockedUnapprove.rows[0],
    }),
  );
  await pool.query(`update items set quantity_received = 0 where item_request_id = $1`, [itemId]);

  await pool.query(
    `update email_log
        set status = 'failed', error = $2, provider_message_id = null, sent_at = null
      where template_key = 'org_request_approved'
        and entity_type = 'item_request' and entity_id = $1 and status = 'sent'`,
    [itemId, `${marker} simulated delivery failure`],
  );
  const itemRetryUnapprove = await request(staff, `/api/admin/requests/item/${itemId}/unapprove`, {});
  const itemRetryApproval = await approveRequest({ kind: "item", requestId: itemId, staffUserId });
  const itemRetryRows = await pool.query<{ status: string }>(
    `select status from email_log
      where template_key = 'org_request_approved'
        and entity_type = 'item_request' and entity_id = $1
      order by created_at`,
    [itemId],
  );
  assert(
    itemRetryUnapprove.ok &&
      itemRetryApproval.emails.some((email) => email.outcome === "queued") &&
      itemRetryRows.rows.map((row) => row.status).join("|") === "failed|queued",
    "a failed item approval notification remains eligible when the request is re-approved",
  );

  const memberItemRows = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    productUrl: string | null;
    condition: string | null;
    quantityRequested: number;
    quantityReceived: number;
  }>(
    `select id, name, description, product_url as "productUrl", condition,
            quantity_requested as "quantityRequested", quantity_received as "quantityReceived"
       from items where item_request_id = $1 order by sort_order`,
    [itemId],
  );
  const itemBlocker = await pool.connect();
  let racedItemUnapprove: Response;
  let racedItemReceipt: Response;
  try {
    await itemBlocker.query("begin");
    await itemBlocker.query(`select id from items where id = $1 for update`, [memberItemRows.rows[0]!.id]);
    const baselineWaiters = await lockWaiterCount();
    const unapprovePromise = request(staff, `/api/admin/requests/item/${itemId}/unapprove`, {});
    await waitForAdditionalLockWaiters(baselineWaiters, 1);
    const receiptPromise = request(member, `/api/dashboard/items/${itemId}/edit/items`, {
      items: memberItemRows.rows.map((row, index) => ({
        ...row,
        quantityReceived: row.quantityReceived + (index === 0 ? 1 : 0),
      })),
    });
    await waitForAdditionalLockWaiters(baselineWaiters, 2);
    await itemBlocker.query("commit");
    [racedItemUnapprove, racedItemReceipt] = await Promise.all([unapprovePromise, receiptPromise]);
  } finally {
    await itemBlocker.query("rollback").catch(() => undefined);
    itemBlocker.release();
  }
  const itemAfterRace = await pool.query<{ status: string; received: string }>(
    `select r.status, coalesce(sum(i.quantity_received), 0)::text as received
       from item_requests r join items i on i.item_request_id = r.id
      where r.id = $1 group by r.id`,
    [itemId],
  );
  assert(
    racedItemUnapprove.ok &&
      racedItemReceipt.status === 409 &&
      itemAfterRace.rows[0]?.status === "pending" &&
      itemAfterRace.rows[0]?.received === "0" &&
      !(await appearsPublic("item", itemId)),
    "an item receipt racing unapproval cannot commit activity onto the Pending request",
    JSON.stringify({
      unapprove: racedItemUnapprove.status,
      receipt: racedItemReceipt.status,
      stored: itemAfterRace.rows[0],
    }),
  );

  const volunteerEditBody = {
    title: `${marker} volunteer corrected`,
    description: "Corrected volunteer description",
    details: "Corrected role details",
    eventLocation: "Corrected event location",
    contactFirstName: "Corrected",
    contactLastName: "Contact",
    contactEmail: `${marker}@example.invalid`,
    contactPhone: "555-0199",
    deadlineType: "until_fulfilled",
    deadlineDate: null,
    peopleHelped: 8,
    categoryIds: [volunteerCategoryId],
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
    deadlineType: string;
    names: string[];
    needed: number[];
    interested: number[];
    confirmed: number[];
  }>(
    `select r.status, r.deadline_type as "deadlineType",
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
      volunteerCheck.rows[0]?.deadlineType === "until_fulfilled" &&
      volunteerCheck.rows[0]?.names.join("|") === "Kept role reordered|New role" &&
      volunteerCheck.rows[0]?.needed.join("|") === "6|3" &&
      volunteerCheck.rows[0]?.interested.every((n) => n === 0) &&
      volunteerCheck.rows[0]?.confirmed.every((n) => n === 0),
    "volunteer edit preserves a stored Until fulfilled deadline, Pending status, and zero activity",
  );
  const volunteerReturned = await request(
    staff,
    `/api/admin/requests/volunteer/${volunteerId}/return-to-draft`,
    { note: "Clarify the shift." },
  );
  assert(volunteerReturned.ok, "volunteer return still works and records history");
  const volunteerReturnedQueue = await request(staff, "/api/admin/requests?status=returned");
  const volunteerReturnedBody = (await volunteerReturnedQueue.json()) as { requests?: QueueContractRow[] };
  const returnedVolunteer = volunteerReturnedBody.requests?.find((row) => row.id === volunteerId);
  assert(
    returnedVolunteer?.type === "volunteer" &&
      returnedVolunteer.deadlineType === "until_fulfilled" &&
      returnedVolunteer.deadlineDate === null &&
      returnedVolunteer.expiresOn === null,
    "returned volunteer rows keep the complete expiration contract",
    JSON.stringify(returnedVolunteer),
  );
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
  await pool.query(`update volunteer_roles set quantity_confirmed = 0 where volunteer_request_id = $1`, [volunteerId]);

  const firstVolunteerApprovalAt = await preparePreviouslyApprovedRequest({
    kind: "volunteer",
    requestId: volunteerId,
    staffUserId,
    recipientPersonId: fixtureOrg.contactPersonId,
    recipientEmail: fixtureOrg.contactEmail,
  });
  assert(await appearsPublic("volunteer", volunteerId), "an active volunteer request appears publicly before correction");
  const activeVolunteerDetail = await request(staff, `/api/admin/requests/volunteer/${volunteerId}`);
  const activeVolunteerBody = (await activeVolunteerDetail.json()) as {
    editability?: { editable?: boolean; unapprovable?: boolean; reason?: string };
  };
  assert(
    activeVolunteerBody.editability?.editable === false &&
      activeVolunteerBody.editability?.unapprovable === true &&
      activeVolunteerBody.editability?.reason?.includes("Unapprove") === true,
    "active volunteer detail advertises the safe correction workflow",
  );
  const volunteerUnapproved = await request(staff, `/api/admin/requests/volunteer/${volunteerId}/unapprove`, {});
  assert(
    volunteerUnapproved.ok && !(await appearsPublic("volunteer", volunteerId)),
    "staff unapproval immediately removes a volunteer request from public view",
    `status ${volunteerUnapproved.status}`,
  );
  const volunteerAfterUnapprove = await pool.query<{
    status: string;
    approvedAt: string | null;
    approvedBy: string | null;
  }>(
    `select status, approved_at as "approvedAt", approved_by as "approvedBy"
       from volunteer_requests where id = $1`,
    [volunteerId],
  );
  assert(
    volunteerAfterUnapprove.rows[0]?.status === "pending" &&
      volunteerAfterUnapprove.rows[0]?.approvedAt === null &&
      volunteerAfterUnapprove.rows[0]?.approvedBy === null,
    "volunteer unapproval returns to Pending and clears the current approval stamp",
  );
  const volunteerReapprovalEdit = await request(staff, `/api/admin/requests/volunteer/${volunteerId}/edit`, {
    ...volunteerEditBody,
    title: `${marker} volunteer corrected after unapproval`,
  });
  assert(volunteerReapprovalEdit.ok, "the unapproved volunteer request is immediately editable");
  const volunteerReapproved = await request(staff, `/api/admin/requests/volunteer/${volunteerId}/approve`, {});
  const volunteerReapprovedBody = (await volunteerReapproved.json()) as { message?: string };
  assert(
    volunteerReapproved.ok && volunteerReapprovedBody.message?.includes("no duplicate was queued") === true,
    "volunteer reapproval reports that the prior successful email was not duplicated",
    volunteerReapprovedBody.message,
  );
  const volunteerAfterReapproval = await pool.query<{
    status: string;
    approvedAt: string;
    approvedBy: string;
    deadlineType: string;
  }>(
    `select status, approved_at as "approvedAt", approved_by as "approvedBy",
            deadline_type as "deadlineType"
       from volunteer_requests where id = $1`,
    [volunteerId],
  );
  const volunteerEvents = await pool.query<{
    fromStatus: string;
    toStatus: string;
    actorUserId: string | null;
  }>(
    `select from_status as "fromStatus", to_status as "toStatus", actor_user_id as "actorUserId"
       from approval_events
      where entity_type = 'volunteer_request' and entity_id = $1
        and ((from_status = 'active' and to_status = 'pending')
          or (from_status = 'pending' and to_status = 'active'))
      order by created_at`,
    [volunteerId],
  );
  const volunteerEmailCount = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from email_log
      where template_key = 'org_request_approved'
        and entity_type = 'volunteer_request' and entity_id = $1`,
    [volunteerId],
  );
  assert(
    volunteerAfterReapproval.rows[0]?.status === "active" &&
      volunteerAfterReapproval.rows[0]?.deadlineType === "until_fulfilled" &&
      new Date(volunteerAfterReapproval.rows[0]!.approvedAt).getTime() >
        new Date(firstVolunteerApprovalAt).getTime() &&
      volunteerAfterReapproval.rows[0]?.approvedBy === staffUserId &&
      volunteerEvents.rows.filter((row) => row.fromStatus === "active" && row.toStatus === "pending").length === 1 &&
      volunteerEvents.rows.filter((row) => row.fromStatus === "pending" && row.toStatus === "active").length === 2 &&
      volunteerEvents.rows.every((row) => row.actorUserId === staffUserId) &&
      Number(volunteerEmailCount.rows[0]?.count ?? 0) === 1 &&
      (await appearsPublic("volunteer", volunteerId)),
    "volunteer reapproval refreshes history/stamps, preserves its deadline, stays once-only, and republishes",
  );

  await pool.query(`update volunteer_roles set quantity_confirmed = 1 where id = $1`, [liveRole.rows[0]!.id]);
  const volunteerStampBeforeBlockedUnapprove = volunteerAfterReapproval.rows[0]!.approvedAt;
  const blockedVolunteerUnapprove = await request(
    staff,
    `/api/admin/requests/volunteer/${volunteerId}/unapprove`,
    {},
  );
  const blockedVolunteerUnapproveBody = (await blockedVolunteerUnapprove.json()) as { message?: string };
  const volunteerAfterBlockedUnapprove = await pool.query<{
    status: string;
    approvedAt: string;
    events: string;
  }>(
    `select r.status, r.approved_at as "approvedAt",
            (select count(*)::text from approval_events ae
              where ae.entity_type = 'volunteer_request' and ae.entity_id = r.id
                and ae.from_status = 'active' and ae.to_status = 'pending') as events
       from volunteer_requests r where r.id = $1`,
    [volunteerId],
  );
  assert(
    blockedVolunteerUnapprove.status === 409 &&
      blockedVolunteerUnapproveBody.message?.includes("activity") === true &&
      volunteerAfterBlockedUnapprove.rows[0]?.status === "active" &&
      new Date(volunteerAfterBlockedUnapprove.rows[0]!.approvedAt).getTime() ===
        new Date(volunteerStampBeforeBlockedUnapprove).getTime() &&
      volunteerAfterBlockedUnapprove.rows[0]?.events === "1",
    "confirmation activity blocks volunteer unapproval and rolls back status, stamp, and history",
    JSON.stringify({
      status: blockedVolunteerUnapprove.status,
      message: blockedVolunteerUnapproveBody.message,
      before: volunteerStampBeforeBlockedUnapprove,
      after: volunteerAfterBlockedUnapprove.rows[0],
    }),
  );
  await pool.query(`update volunteer_roles set quantity_confirmed = 0 where volunteer_request_id = $1`, [volunteerId]);

  await pool.query(
    `update email_log
        set status = 'skipped', error = $2, provider_message_id = null, sent_at = null
      where template_key = 'org_request_approved'
        and entity_type = 'volunteer_request' and entity_id = $1 and status = 'sent'`,
    [volunteerId, `${marker} simulated disabled template`],
  );
  const volunteerRetryUnapprove = await request(staff, `/api/admin/requests/volunteer/${volunteerId}/unapprove`, {});
  const volunteerRetryApproval = await approveRequest({ kind: "volunteer", requestId: volunteerId, staffUserId });
  const volunteerRetryRows = await pool.query<{ status: string }>(
    `select status from email_log
      where template_key = 'org_request_approved'
        and entity_type = 'volunteer_request' and entity_id = $1
      order by created_at`,
    [volunteerId],
  );
  assert(
    volunteerRetryUnapprove.ok &&
      volunteerRetryApproval.emails.some((email) => email.outcome === "queued") &&
      volunteerRetryRows.rows.map((row) => row.status).join("|") === "skipped|queued",
    "a disabled/skipped volunteer approval notification remains eligible when the request is re-approved",
  );

  const memberRoleRows = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    quantityNeeded: number;
    quantityConfirmed: number;
  }>(
    `select id, name, description, quantity_needed as "quantityNeeded",
            quantity_confirmed as "quantityConfirmed"
       from volunteer_roles where volunteer_request_id = $1 order by sort_order`,
    [volunteerId],
  );
  const volunteerBlocker = await pool.connect();
  let racedVolunteerUnapprove: Response;
  let racedVolunteerConfirmation: Response;
  try {
    await volunteerBlocker.query("begin");
    await volunteerBlocker.query(`select id from volunteer_roles where id = $1 for update`, [
      memberRoleRows.rows[0]!.id,
    ]);
    const baselineWaiters = await lockWaiterCount();
    const unapprovePromise = request(staff, `/api/admin/requests/volunteer/${volunteerId}/unapprove`, {});
    await waitForAdditionalLockWaiters(baselineWaiters, 1);
    const confirmationPromise = request(member, `/api/dashboard/volunteers/${volunteerId}/edit/roles`, {
      roles: memberRoleRows.rows.map((row, index) => ({
        ...row,
        description: row.description ?? "",
        quantityConfirmed: row.quantityConfirmed + (index === 0 ? 1 : 0),
      })),
    });
    await waitForAdditionalLockWaiters(baselineWaiters, 2);
    await volunteerBlocker.query("commit");
    [racedVolunteerUnapprove, racedVolunteerConfirmation] = await Promise.all([
      unapprovePromise,
      confirmationPromise,
    ]);
  } finally {
    await volunteerBlocker.query("rollback").catch(() => undefined);
    volunteerBlocker.release();
  }
  const volunteerAfterRace = await pool.query<{ status: string; confirmed: string }>(
    `select r.status, coalesce(sum(vr.quantity_confirmed), 0)::text as confirmed
       from volunteer_requests r join volunteer_roles vr on vr.volunteer_request_id = r.id
      where r.id = $1 group by r.id`,
    [volunteerId],
  );
  assert(
    racedVolunteerUnapprove.ok &&
      racedVolunteerConfirmation.status === 409 &&
      volunteerAfterRace.rows[0]?.status === "pending" &&
      volunteerAfterRace.rows[0]?.confirmed === "0" &&
      !(await appearsPublic("volunteer", volunteerId)),
    "a volunteer confirmation racing unapproval cannot commit activity onto the Pending request",
    JSON.stringify({
      unapprove: racedVolunteerUnapprove.status,
      confirmation: racedVolunteerConfirmation.status,
      stored: volunteerAfterRace.rows[0],
    }),
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
  if (volunteerCategoryId) await pool.query(`delete from volunteer_categories where id = $1`, [volunteerCategoryId]);
  await pool.end();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);