/**
 * Integration test: Task 287 — magic-link send path writes a failed
 * email_log row when finalizeHtml() throws (broken HTML shell).
 *
 * Exercises the real sendMagicLinkEmail() function (extracted from auth.ts)
 * with a registered fixture user from the seed and a patched render function
 * whose HTML has had HEADER_IMAGE_MARKER stripped. This is the same control
 * flow the sendMagicLink Better Auth callback executes in production:
 *
 *   sendMagicLinkEmail(email, url, renderFn?)
 *     → findByEmail (gate — finds the seeded user, passes the gate)
 *     → renderFn (returns HTML without the slot marker)
 *     → finalizeHtml (throws — slot marker missing)
 *     → insertQueued + markFailed (failed audit row written)
 *     → re-throws
 *     → sendEmail  ← NEVER REACHED
 *
 * Checks:
 *   1a. The call throws (not a silent return or no-op).
 *   1b. The thrown error message mentions "header slot marker missing".
 *   2a. One new email_log row is written for the fixture user + template.
 *   2b. The new row has status='failed'.
 *   2c. The new row has failure_category='render'.
 *
 * Prerequisite: the seed must have been run so that the fixture user exists
 * and is active. The test emits a clear skip message if the user is absent.
 *
 * Usage:
 *   npm run test:magic-link-finalize-throw
 *
 * The failed row written by the test remains in the DB — it is the audit
 * trail the task demands. Re-running the test adds another row each time
 * (no once-only index applies: entity_id is null for magic-link rows).
 */
import { pool } from "../server/db/client";
import { sendMagicLinkEmail } from "../server/auth/auth";
import { renderMagicLinkEmail } from "../server/email/templates/auth-magic-link";
import { HEADER_IMAGE_MARKER } from "../server/email/render";

// Use a reliably seeded, active user — Tiffany is the platform staff admin
// created unconditionally by seed.ts and always active.
const FIXTURE_EMAIL = "tiffany@defendingthecause.org";
const FIXTURE_URL = "https://fixture.test/auth/magic-link?token=zz-fixture-286";
const TEMPLATE_KEY = "auth_magic_link";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const extra = detail !== undefined ? `: ${JSON.stringify(detail)}` : "";
    console.error(`  ✗ FAIL: ${label}${extra}`);
    failed++;
  }
}

async function countEmailLogRows(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from email_log
      where to_email = $1
        and template_key = $2`,
    [FIXTURE_EMAIL, TEMPLATE_KEY],
  );
  return parseInt(rows[0]!.count, 10);
}

async function latestEmailLogRow(): Promise<{ status: string; failureCategory: string | null; error: string | null } | null> {
  const { rows } = await pool.query<{ status: string; failureCategory: string | null; error: string | null }>(
    `select status,
            failure_category as "failureCategory",
            error
       from email_log
      where to_email = $1
        and template_key = $2
      order by created_at desc
      limit 1`,
    [FIXTURE_EMAIL, TEMPLATE_KEY],
  );
  return rows[0] ?? null;
}

async function main(): Promise<void> {
  console.log("\nTask 287 — magic-link sendMagicLinkEmail finalizeHtml-throw → failed audit row written\n");

  // Pre-flight: confirm the fixture user exists in the seeded DB.
  const { rows: userRows } = await pool.query<{ status: string }>(
    `select u.status
       from users u
       join people p on p.id = u.person_id
      where p.email = $1
      limit 1`,
    [FIXTURE_EMAIL],
  );
  if (userRows.length === 0 || userRows[0]!.status !== "active") {
    console.error(
      `  SKIP: fixture user ${FIXTURE_EMAIL} not found or not active — run db:seed first`,
    );
    process.exit(1);
  }

  // Snapshot the email_log count before the call so we can assert it does
  // not increase (regardless of any pre-existing rows for this user).
  const countBefore = await countEmailLogRows();

  // ── Broken render function ────────────────────────────────────────────────
  // Renders normally then strips the slot marker, simulating a template whose
  // shell() call is broken or missing. Passed as the third argument to
  // sendMagicLinkEmail so the real production callback and DAL code all run,
  // only the render result is altered.
  const brokenRender: typeof renderMagicLinkEmail = (vars) => {
    const result = renderMagicLinkEmail(vars);
    return {
      ...result,
      html: result.html.replace(HEADER_IMAGE_MARKER, "<!-- marker removed by fixture -->"),
    };
  };

  // ── Section 1: throw behaviour ────────────────────────────────────────────
  console.log("1. sendMagicLinkEmail — finalizeHtml throws when HEADER_IMAGE_MARKER is absent");

  let thrownError: unknown = null;
  try {
    // This runs the full sendMagicLink control flow:
    //   findByEmail → user gate passes → brokenRender → finalizeHtml (throws)
    //   → insertQueued + markFailed (failed audit row written) → re-throws
    // sendEmail() is never reached.
    await sendMagicLinkEmail(FIXTURE_EMAIL, FIXTURE_URL, brokenRender);
  } catch (err) {
    thrownError = err;
  }

  assert(
    thrownError !== null,
    "1a: throws — finalizeHtml detected missing slot marker before sendEmail()",
    thrownError instanceof Error
      ? `${thrownError.name}: ${thrownError.message}`
      : String(thrownError),
  );
  assert(
    thrownError instanceof Error &&
      thrownError.message.includes("header slot marker missing"),
    "1b: error message contains 'header slot marker missing'",
    thrownError instanceof Error ? thrownError.message : undefined,
  );

  // ── Section 2: failed email_log row written ───────────────────────────────
  console.log("\n2. Failed email_log row written — staff can see the attempted send in ADMIN-06");

  const countAfter = await countEmailLogRows();
  assert(
    countAfter === countBefore + 1,
    "2a: one new email_log row written for the fixture user + template",
    { countBefore, countAfter },
  );

  const latestRow = await latestEmailLogRow();
  assert(
    latestRow?.status === "failed",
    "2b: the new row has status='failed'",
    latestRow ?? undefined,
  );
  assert(
    latestRow?.failureCategory === "render",
    "2c: the new row has failure_category='render'",
    latestRow ?? undefined,
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
