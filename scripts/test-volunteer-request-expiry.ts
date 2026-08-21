/**
 * Regression checks for expired volunteer request visibility (PB-04).
 *
 * A volunteer request keeps status = 'active' until the nightly expiry job
 * moves it, so public reads must re-check expires_on themselves rather than
 * trust the status column. These checks fail loudly if the date predicate is
 * ever dropped from the detail endpoint, the signup POST, the share-preview
 * handler, or the SQL write function.
 *
 * Covered cases:
 *   - The detail GET returns 404 once expires_on has passed.
 *   - The signup POST returns 404 for the same expired request.
 *   - The share-preview handler falls back to the default site card for an
 *     expired volunteer URL (crawlers must not see stale live-looking cards).
 *   - record_volunteer_signup() refuses an expired-but-active request under
 *     its own row lock, closing the race window between the route gate and
 *     the actual write.
 *   - Both endpoints accept the request once the date is moved into the future.
 *   - Requests whose status is not 'active' are also 404 on the detail GET.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-volunteer-request-expiry.ts
 * Exit 0 = pass. The temporary request is removed in a finally block, including
 * after a failed check.
 */
import { pool, SYSTEM } from "../server/db/client";
import * as dal from "../server/dal/index";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5000";
const ctx = SYSTEM;
/** zz_fixture marks a deliberately created row — see the fixture conventions. */
const FIXTURE_TITLE = "zz_fixture expired volunteer need (PB-04 expiry)";
const DEFAULT_OG_TITLE = "Love in Action Database | The Alliance";

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
}

/** A YYYY-MM-DD Los Angeles calendar date, offset by whole days. */
function laDate(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const noonUtc = new Date(`${today}T12:00:00Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() + offsetDays);
  return noonUtc.toISOString().slice(0, 10);
}

async function getDetail(id: string): Promise<{ status: number }> {
  const res = await fetch(`${BASE}/api/public/volunteer-requests/${id}`);
  return { status: res.status };
}

async function postSignup(id: string): Promise<{ status: number }> {
  // Intentionally incomplete body — we only care about whether the gate
  // rejects before validation, not about a successful signup.
  const res = await fetch(`${BASE}/api/public/volunteer-requests/${id}/signups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return { status: res.status };
}

/** Fetch as a social crawler would, to trigger the share-preview middleware. */
async function getPreviewPage(id: string): Promise<{ status: number; ogTitle: string | null }> {
  const res = await fetch(`${BASE}/volunteer/${id}`, {
    headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
  });
  const html = await res.text();
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  const ogTitleMatch = head.match(/<meta\b[^>]*property\s*=\s*"og:title"[^>]*content\s*=\s*"([^"]*)"/i)
    ?? head.match(/<meta\b[^>]*content\s*=\s*"([^"]*)"[^>]*property\s*=\s*"og:title"/i);
  return { status: res.status, ogTitle: ogTitleMatch?.[1] ?? null };
}

async function main(): Promise<void> {
  // An approved member organization: the only kind whose requests are public.
  const org = await dal.organizations.getBySlug(ctx, "hearts-hands-family-services");
  if (!org || org.status !== "approved") {
    throw new Error("expected an approved hearts-hands fixture organization");
  }

  const actors = await pool.query<{ id: string }>(
    `select u.id from users u
       join org_memberships m on m.user_id = u.id
      where m.role = 'staff_admin' and m.status = 'active' and u.status = 'active'
      limit 1`,
  );
  const actorUserId = actors.rows[0]?.id;
  if (!actorUserId) throw new Error("expected an active staff admin to approve the fixture request");

  let requestId: string | null = null;
  let extensionRequestId: string | null = null;
  try {
    console.log("\nExpired volunteer request: detail GET and signup POST");

    const draft = await dal.volunteerRequests.createDraft(ctx, org.id, {
      title: FIXTURE_TITLE,
      description: "Temporary row created by the PB-04 expiry regression check.",
      details: "Temporary row created by the PB-04 expiry regression check.",
      eventLocation: "Roseville",
      expiresOn: laDate(-1), // yesterday — already expired
    });
    requestId = draft.id;
    await dal.volunteerRequests.transitionStatus(ctx, { requestId, to: "pending", actorUserId });
    await dal.volunteerRequests.transitionStatus(ctx, { requestId, to: "active", actorUserId });

    // Confirm the fixture is still 'active' so the date is the only filter.
    const live = await dal.volunteerRequests.getById(ctx, requestId);
    check(live?.status === "active", "fixture request is still status=active after approval");
    check(live?.expiresOn != null, "fixture request has an expires_on date");

    // Route-level gates must treat an expired-active request as nonexistent.
    const expiredDetail = await getDetail(requestId);
    check(expiredDetail.status === 404, "detail GET returns 404 for expired-but-active request");

    const expiredSignup = await postSignup(requestId);
    check(expiredSignup.status === 404, "signup POST returns 404 for expired-but-active request");

    console.log("\nExpired volunteer request: share-preview falls back to default site card");

    // The share-preview handler must not produce a live-looking card for an
    // expired need. A crawler fetching the URL should see the site-wide defaults.
    const expiredPreview = await getPreviewPage(requestId);
    check(
      expiredPreview.ogTitle === DEFAULT_OG_TITLE,
      "share preview falls back to the default og:title for an expired request",
    );

    console.log("\nExpired volunteer request: write-time boundary in record_volunteer_signup()");

    // The SQL function re-checks expires_on under its own row lock, so even a
    // request that expires between the route gate and the actual write is refused.
    // We call the function directly (bypassing the route gate) to test this path.
    // An expired request must raise 'request_not_active', not 'no_roles' — if the
    // expiry check is missing, the empty-roles guard fires first and the test fails.
    let writeTimeBoundaryPassed = false;
    try {
      // Parameter order matches the function signature:
      // (first_name, last_name, email, phone, request_id, notes, role_ids)
      await pool.query(
        `select record_volunteer_signup('Test', 'User', 'zz.expiry-boundary@example.com', null, $1, null, '{}'::uuid[])`,
        [requestId],
      );
    } catch (err: unknown) {
      const msg = String((err as { message?: unknown }).message ?? "");
      writeTimeBoundaryPassed = msg.startsWith("request_not_active");
    }
    check(
      writeTimeBoundaryPassed,
      "record_volunteer_signup() raises request_not_active (not no_roles) for an expired-but-active request",
    );

    console.log("\nSame request becomes visible once expires_on is in the future");

    // Move the expiry date into the future — same row, same status.
    await pool.query(`update volunteer_requests set expires_on = $1 where id = $2`, [
      laDate(7),
      requestId,
    ]);

    const activeDetail = await getDetail(requestId);
    check(activeDetail.status === 200, "detail GET returns 200 once expires_on is in the future");

    // An incomplete signup body should be rejected by validation (422), not
    // silently gated out (404), confirming the request is now reachable.
    const activeSignup = await postSignup(requestId);
    check(
      activeSignup.status !== 404,
      "signup POST reaches validation (not gated) once expires_on is in the future",
    );

    const activePreview = await getPreviewPage(requestId);
    check(
      activePreview.ogTitle !== DEFAULT_OG_TITLE && activePreview.ogTitle !== null,
      "share preview shows per-request og:title once expires_on is in the future",
    );

    console.log("\nNon-active status: detail GET");

    // Archive the request and confirm the detail endpoint hides it.
    await dal.volunteerRequests.transitionStatus(ctx, {
      requestId,
      to: "archived",
      actorUserId,
      archivedReason: "manual",
    });
    const archivedDetail = await getDetail(requestId);
    check(archivedDetail.status === 404, "detail GET returns 404 for an archived (non-active) request");

    console.log("\nDeadline extension restores DAL-level visibility immediately (volunteer)");

    // Create a second fixture with expires_on in the past. This is the same
    // expiry field the DAL predicate (VOLUNTEER_REQUEST_EXPIRED) actually checks.
    const extensionDraft = await dal.volunteerRequests.createDraft(ctx, org.id, {
      title: "zz_fixture expired volunteer need (PB-04 extension)",
      description: "Temporary row for deadline extension DAL test.",
      details: "Temporary row for deadline extension DAL test.",
      expiresOn: laDate(-1), // yesterday — already expired
    });
    extensionRequestId = extensionDraft.id;
    await dal.volunteerRequests.transitionStatus(ctx, { requestId: extensionRequestId, to: "pending", actorUserId });
    await dal.volunteerRequests.transitionStatus(ctx, { requestId: extensionRequestId, to: "active", actorUserId });

    // The expiry predicate in listActivePublic is evaluated at read time.
    // An expired-but-active fixture must be absent from the public list.
    const dalListBefore = await dal.volunteerRequests.listActivePublic(ctx);
    const dalListBeforeIds = new Set(dalListBefore.map((r) => r.id));
    check(
      !dalListBeforeIds.has(extensionRequestId),
      "listActivePublic (DAL) excludes the expired volunteer fixture before deadline extension",
    );

    // getActiveAvailableById must return null for the same expired row.
    const dalDetailBefore = await dal.volunteerRequests.getActiveAvailableById(ctx, extensionRequestId);
    check(
      dalDetailBefore === null,
      "getActiveAvailableById (DAL) returns null for the expired volunteer fixture before extension",
    );

    // Extend the deadline via updateInTx — the same DAL path member-facing
    // routes use. No status change, no re-approval: visibility must restore
    // purely because the predicate re-evaluates expires_on at read time.
    await dal.volunteerRequests.update(ctx, org.id, extensionRequestId, { expiresOn: laDate(1) });

    // The request must now reappear in the public list.
    const dalListAfter = await dal.volunteerRequests.listActivePublic(ctx);
    const dalListAfterIds = new Set(dalListAfter.map((r) => r.id));
    check(
      dalListAfterIds.has(extensionRequestId),
      "listActivePublic (DAL) includes the volunteer fixture immediately after deadline extension",
    );

    // getActiveAvailableById must return the row once expires_on is in the future.
    const dalDetailAfter = await dal.volunteerRequests.getActiveAvailableById(ctx, extensionRequestId);
    check(
      dalDetailAfter !== null && dalDetailAfter.id === extensionRequestId,
      "getActiveAvailableById (DAL) returns the row immediately after deadline extension",
    );
  } finally {
    for (const id of [requestId, extensionRequestId]) {
      if (id !== null) {
        await pool.query(
          `delete from approval_events where entity_type = 'volunteer_request' and entity_id = $1`,
          [id],
        );
        await pool.query(`delete from volunteer_requests where id = $1`, [id]);
      }
    }
    const leftovers = await pool.query<{ count: string }>(
      `select count(*)::text as count from volunteer_requests where title like 'zz_fixture%'`,
    );
    if (Number(leftovers.rows[0]!.count) !== 0) {
      console.error("FAIL: fixture cleanup left a zz_fixture volunteer request behind");
      failed += 1;
    }
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
