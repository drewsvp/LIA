/**
 * Regression coverage for date-specific item-request expiry.
 *
 * Requires the development workflow and a migrated database. Creates
 * zz_fixture rows and removes them before exit.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-item-request-expiry.ts
 */
import { pool } from "../server/db/client";
import { SYSTEM, withDbContext } from "../server/db/client";
import * as itemRequests from "../server/dal/item-requests";
import { runExpiryOnce } from "../server/jobs/expiry";

const BASE =
  process.env.TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
const marker = `zz_fixture_item_expiry_${process.pid}`;
const contactEmail = `${marker}@example.invalid`;
let passed = 0;
let failed = 0;
const requestIds: string[] = [];
const volunteerRequestIds: string[] = [];

type Fixture = { id: string; itemId: string };
type BrowseBody = { requests?: { id: string }[] };

function assert(condition: boolean, label: string, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

async function laDates(): Promise<{ yesterday: string; today: string; tomorrow: string }> {
  const result = await pool.query<{ today: string; yesterday: string; tomorrow: string }>(`
    select (now() at time zone 'America/Los_Angeles')::date::text as today,
           ((now() at time zone 'America/Los_Angeles')::date - 1)::text as yesterday,
           ((now() at time zone 'America/Los_Angeles')::date + 1)::text as tomorrow
  `);
  const row = result.rows[0];
  if (!row) throw new Error("could not resolve the LA fixture dates");
  return row;
}

async function createFixture(input: {
  title: string;
  deadlineType: "date_specific" | "until_fulfilled" | "ongoing";
  deadlineDate?: string | null;
  expiresOn?: string | null;
}): Promise<Fixture> {
  const org = await pool.query<{ id: string }>(`
    select id from organizations
     where status = 'approved' and kind = 'member_org'
     order by created_at
     limit 1
  `);
  const orgId = org.rows[0]?.id;
  if (!orgId) throw new Error("an approved member organization is required for expiry fixtures");
  const request = await pool.query<{ id: string }>(
    `insert into item_requests (
       org_id, title, description, deadline_type, deadline_date, expires_on, status, approved_at
     ) values ($1, $2, 'Expiry regression fixture', $3, $4, $5, 'active', now())
     returning id`,
    [orgId, `${marker} ${input.title}`, input.deadlineType, input.deadlineDate ?? null, input.expiresOn ?? null],
  );
  const id = request.rows[0]?.id;
  if (!id) throw new Error(`failed to create fixture ${input.title}`);
  requestIds.push(id);
  const item = await pool.query<{ id: string }>(
    `insert into items (item_request_id, name, quantity_requested)
     values ($1, 'Fixture item', 2)
     returning id`,
    [id],
  );
  const itemId = item.rows[0]?.id;
  if (!itemId) throw new Error(`failed to create fixture item for ${input.title}`);
  return { id, itemId };
}

async function createVolunteerFixture(input: {
  title: string;
  deadlineDate: string;
}): Promise<{ id: string }> {
  const org = await pool.query<{ id: string }>(`
    select id from organizations
     where status = 'approved' and kind = 'member_org'
     order by created_at
     limit 1
  `);
  const orgId = org.rows[0]?.id;
  if (!orgId) throw new Error("an approved member organization is required for expiry fixtures");
  const request = await pool.query<{ id: string }>(
    `insert into volunteer_requests (
       org_id, title, description, deadline_type, deadline_date, status, approved_at
     ) values ($1, $2, 'Expiry regression fixture', 'date_specific', $3, 'active', now())
     returning id`,
    [orgId, `${marker} ${input.title}`, input.deadlineDate],
  );
  const id = request.rows[0]?.id;
  if (!id) throw new Error(`failed to create volunteer fixture ${input.title}`);
  volunteerRequestIds.push(id);
  return { id };
}

async function publicDetailStatus(requestId: string): Promise<number> {
  return (await fetch(`${BASE}/api/public/item-requests/${requestId}`)).status;
}

async function publicBrowseIds(): Promise<Set<string>> {
  const response = await fetch(`${BASE}/api/public/item-requests`);
  const body = (await response.json()) as BrowseBody;
  if (!response.ok) throw new Error(`public browse failed: ${response.status}`);
  return new Set((body.requests ?? []).map((r) => r.id));
}

async function pledgeStatus(fixture: Fixture): Promise<number> {
  const response = await fetch(`${BASE}/api/public/item-requests/${fixture.id}/pledges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "ZZ",
      lastName: "Expiry Fixture",
      email: contactEmail,
      phone: "555-0199",
      agree: true,
      lines: [{ itemId: fixture.itemId, quantity: 1 }],
    }),
  });
  return response.status;
}

async function main(): Promise<void> {
  console.log("\n[item request expiry tests]\n");
  console.log(`Base URL: ${BASE}`);
  const { yesterday, today, tomorrow } = await laDates();

  const pastDeadline = await createFixture({
    title: "past date-specific deadline",
    deadlineType: "date_specific",
    deadlineDate: yesterday,
  });
  const currentDeadline = await createFixture({
    title: "current LA-day deadline",
    deadlineType: "date_specific",
    deadlineDate: today,
  });
  const futureDeadline = await createFixture({
    title: "future date-specific deadline",
    deadlineType: "date_specific",
    deadlineDate: tomorrow,
  });
  const ongoing = await createFixture({
    title: "ongoing ignores incidental deadline date",
    deadlineType: "ongoing",
    deadlineDate: yesterday,
  });
  const untilFulfilled = await createFixture({
    title: "until fulfilled ignores incidental deadline date",
    deadlineType: "until_fulfilled",
    deadlineDate: yesterday,
  });
  const legacyArchive = await createFixture({
    title: "legacy archive date",
    deadlineType: "until_fulfilled",
    expiresOn: yesterday,
  });
  const staleSelection = await createFixture({
    title: "deadline extended after expiry selection",
    deadlineType: "date_specific",
    deadlineDate: yesterday,
  });
  const volunteerPastDeadline = await createVolunteerFixture({
    title: "volunteer past deadline remains out of scope",
    deadlineDate: yesterday,
  });

  const boundary = await pool.query<{ yesterdayExpired: boolean; todayExpired: boolean; futureExpired: boolean }>(
    `select item_request_expired_on('date_specific', $1::date, null, $2::date) as "yesterdayExpired",
            item_request_expired_on('date_specific', $2::date, null, $2::date) as "todayExpired",
            item_request_expired_on('date_specific', $3::date, null, $2::date) as "futureExpired"`,
    [yesterday, today, tomorrow],
  );
  const boundaryRow = boundary.rows[0];
  assert(
    boundaryRow?.yesterdayExpired === true && boundaryRow.todayExpired === false && boundaryRow.futureExpired === false,
    "the shared LA-date rule expires only days before today",
  );
  const clock = await pool.query<{ volatile: boolean; laToday: string }>(
    `select p.provolatile = 'v' as volatile,
            item_request_current_la_date()::text as "laToday"
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = current_schema()
        and p.proname = 'item_request_current_la_date'`,
  );
  assert(
    clock.rows[0]?.volatile === true && clock.rows[0]?.laToday === today,
    "write-time LA date source is volatile rather than frozen at transaction start",
  );

  const initiallySelected = await itemRequests.expiredActiveIds(SYSTEM, 500);
  assert(initiallySelected.includes(staleSelection.id), "nightly selection initially includes a past deadline");
  await pool.query(`update item_requests set deadline_date = $2 where id = $1`, [staleSelection.id, tomorrow]);
  const staleArchived = await withDbContext(SYSTEM, (c) =>
    itemRequests.archiveExpiredIfEligibleInTx(c, staleSelection.id),
  );
  const staleRow = await pool.query<{ status: string; eventCount: string }>(
    `select r.status,
            (select count(*)::text from approval_events e
              where e.entity_type = 'item_request' and e.entity_id = r.id
                and e.to_status = 'archived' and e.note = 'expired') as "eventCount"
       from item_requests r where r.id = $1`,
    [staleSelection.id],
  );
  assert(
    staleArchived === false &&
      staleRow.rows[0]?.status === "active" &&
      staleRow.rows[0]?.eventCount === "0",
    "locked expiry recheck skips a request whose deadline was extended after selection",
  );

  const browseBefore = await publicBrowseIds();
  assert(!browseBefore.has(pastDeadline.id), "past date-specific need is absent from public browse before archival");
  assert(!browseBefore.has(legacyArchive.id), "past legacy archive-date need remains absent from public browse");
  for (const [label, fixture] of [
    ["current-day date-specific", currentDeadline],
    ["future date-specific", futureDeadline],
    ["ongoing", ongoing],
    ["until-fulfilled", untilFulfilled],
  ] as const) {
    assert(browseBefore.has(fixture.id), `${label} need remains in public browse`);
  }

  assert((await publicDetailStatus(pastDeadline.id)) === 404, "past date-specific detail is unavailable before archival");
  assert((await publicDetailStatus(legacyArchive.id)) === 404, "past legacy archive-date detail is unavailable before archival");
  assert((await pledgeStatus(pastDeadline)) === 410, "past date-specific need rejects a new donation claim");
  assert((await pledgeStatus(legacyArchive)) === 410, "past legacy archive-date need rejects a new donation claim");
  for (const [label, fixture] of [
    ["date-specific need on its LA deadline day", currentDeadline],
    ["future date-specific need", futureDeadline],
    ["ongoing need", ongoing],
    ["until-fulfilled need", untilFulfilled],
  ] as const) {
    assert((await publicDetailStatus(fixture.id)) === 200, `${label} has an available public detail`);
    assert((await pledgeStatus(fixture)) === 201, `${label} accepts a donation claim`);
  }
  const volunteerBrowseResponse = await fetch(`${BASE}/api/public/volunteer-requests`);
  const volunteerBrowse = (await volunteerBrowseResponse.json()) as BrowseBody;
  assert(
    volunteerBrowseResponse.ok && volunteerBrowse.requests?.some((r) => r.id === volunteerPastDeadline.id) === true,
    "volunteer date-specific deadline behavior remains unchanged",
  );

  await runExpiryOnce();
  const rows = await pool.query<{ id: string; status: string; archivedReason: string | null }>(
    `select id, status, archived_reason as "archivedReason"
       from item_requests where id = any($1::uuid[])`,
    [requestIds],
  );
  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  for (const fixture of [pastDeadline, legacyArchive]) {
    const row = byId.get(fixture.id);
    assert(row?.status === "archived" && row.archivedReason === "expired", "nightly expiry archives the past item need as expired");
    const event = await pool.query<{ count: string; automated: boolean; note: string | null }>(
      `select count(*)::text as count, bool_and(actor_user_id is null) as automated, max(note) as note
         from approval_events
        where entity_type = 'item_request' and entity_id = $1
          and from_status = 'active' and to_status = 'archived' and note = 'expired'`,
      [fixture.id],
    );
    const eventRow = event.rows[0];
    assert(
      eventRow?.count === "1" && eventRow.automated === true && eventRow.note === "expired",
      "expiry writes one automated expired activity event",
    );
  }
  for (const fixture of [currentDeadline, futureDeadline, ongoing, untilFulfilled]) {
    assert(byId.get(fixture.id)?.status === "active", "non-expired deadline modes remain active after nightly expiry");
  }
  const volunteerAfter = await pool.query<{ status: string }>(
    `select status from volunteer_requests where id = $1`,
    [volunteerPastDeadline.id],
  );
  assert(volunteerAfter.rows[0]?.status === "active", "nightly expiry leaves volunteer deadline dates unchanged");

  await runExpiryOnce();
  for (const fixture of [pastDeadline, legacyArchive]) {
    const events = await pool.query<{ count: string }>(
      `select count(*)::text as count from approval_events
        where entity_type = 'item_request' and entity_id = $1
          and from_status = 'active' and to_status = 'archived' and note = 'expired'`,
      [fixture.id],
    );
    assert(events.rows[0]?.count === "1", "repeat expiry pass is idempotent");
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

async function cleanup(): Promise<void> {
  if (requestIds.length > 0) {
    await pool.query(`delete from approval_events where entity_type = 'item_request' and entity_id = any($1::uuid[])`, [requestIds]);
    await pool.query(
      `delete from item_pledge_lines
        where item_pledge_id in (
          select id from item_pledges where item_request_id = any($1::uuid[])
        )`,
      [requestIds],
    );
    await pool.query(`delete from item_pledges where item_request_id = any($1::uuid[])`, [requestIds]);
    await pool.query(`delete from item_requests where id = any($1::uuid[])`, [requestIds]);
  }
  if (volunteerRequestIds.length > 0) {
    await pool.query(
      `delete from approval_events where entity_type = 'volunteer_request' and entity_id = any($1::uuid[])`,
      [volunteerRequestIds],
    );
    await pool.query(`delete from volunteer_requests where id = any($1::uuid[])`, [volunteerRequestIds]);
  }
  await pool.query(`delete from people where lower(email) = lower($1)`, [contactEmail]);
  await pool.end();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);