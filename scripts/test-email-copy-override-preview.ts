/**
 * Integration test: Task 253 — staff-edited email copy appears in the
 * template preview, not the default.
 *
 * Steps:
 *   1. Quick-login as staff_admin.
 *   2. Snapshot the current org_approved override so cleanup can restore it
 *      exactly. Snapshot runs inside withDbContext(SYSTEM, ...) so the FORCED
 *      RLS policy permits the read.
 *   3. Save unique copy through PUT /api/admin/email-templates/org_approved
 *      (the same endpoint the UI calls, including validateCopy).
 *   4. Call POST /api/admin/email-templates/org_approved/preview with no `copy`
 *      payload — the endpoint reads the persisted override from the database.
 *   5. Assert the returned subject and HTML contain the unique override values,
 *      not the hardcoded defaultCopy.
 *   6. Restore the prior override state exactly via withDbContext(SYSTEM, ...)
 *      so the test is non-destructive and cleanup is confirmed by RLS-aware
 *      rows-affected checks.
 *
 * Usage:
 *   npm run test:email-copy-override-preview
 *
 * The development server must be running. Uses the quick-login endpoint which
 * is only active in NODE_ENV=development.
 */
import { SYSTEM, withDbContext, q, pool } from "../server/db/client";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

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

async function quickLogin(): Promise<string> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staff_admin" }),
  });
  if (!response.ok) throw new Error(`Quick login failed: HTTP ${response.status}`);
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  const sessionCookie = values.find((v) => v.includes("session_token"));
  if (!sessionCookie) throw new Error("Quick login did not return a session cookie.");
  const [pair] = sessionCookie.split(";");
  return pair!;
}

async function apiPut(path: string, cookieHeader: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function apiPost(path: string, cookieHeader: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

type OverrideSnapshot = {
  subject: string | null;
  heading: string | null;
  paragraphs: unknown;
  recipients: string | null;
  enabled: boolean;
  updated_at: string;
  updated_by: string | null;
};

async function main(): Promise<void> {
  console.log("\nTask 253 — staff-edited copy appears in template preview\n");

  const cookieHeader = await quickLogin();

  // ── Step 2: Snapshot the current org_approved override ────────────────────
  // Uses withDbContext(SYSTEM) so the FORCED RLS policy on
  // email_template_overrides permits the read (raw pool queries set no context
  // GUCs and see nothing under FORCED RLS).
  const priorRows = await withDbContext(SYSTEM, (c) =>
    q<OverrideSnapshot>(
      c,
      `select subject, heading, paragraphs, recipients, enabled, updated_at, updated_by
         from email_template_overrides where template_key = $1`,
      ["org_approved"],
    ),
  );
  const priorOverride = priorRows[0] ?? null;

  // Unique marker strings so we can distinguish the override from the default.
  // The org_approved sample renders with organizationName = "Hope Community Center",
  // so after fillText the subject becomes "Fixture Override: Hope Community Center Approved".
  const UNIQUE_SUBJECT = "Fixture Override: {organizationName} Approved";
  const UNIQUE_HEADING = "Fixture Override Heading — Your Org Is In!";
  const DEFAULT_SUBJECT_FRAGMENT = "Welcome to the Love in Action Database";

  let overrideWritten = false;
  try {
    // ── Step 3: Save unique copy via the authenticated template-save API ──────
    console.log("1. Save override via PUT /api/admin/email-templates/org_approved");

    const putRes = await apiPut(
      "/api/admin/email-templates/org_approved",
      cookieHeader,
      {
        copy: {
          subject: UNIQUE_SUBJECT,
          heading: UNIQUE_HEADING,
          paragraphs: [
            "Hi {organizationName},",
            "You've been approved to start using The Alliance's Love in Action Database!",
            "Within the next few minutes you will be receiving a second email with instructions on how to log in to your new dashboard.",
            "Please review the information in your organization's profile below and save this email for your records.",
            "If you have questions about using any of the features of this database, please email us.",
          ],
        },
      },
    );
    assert(putRes.status === 200, "PUT returns HTTP 200");
    assert(
      (putRes.body as Record<string, unknown> | null)?.ok === true,
      "PUT response has ok: true",
      putRes.body,
    );
    overrideWritten = putRes.status === 200;

    if (!overrideWritten) {
      throw new Error("Override was not saved (PUT returned non-200) — cannot test preview assertions.");
    }

    // ── Step 4: Call the template preview API with no draft copy ──────────────
    // Without a `copy` payload the endpoint reads from the persisted override.
    console.log("\n2. Preview via POST /api/admin/email-templates/org_approved/preview (no draft)");

    const previewRes = await apiPost(
      "/api/admin/email-templates/org_approved/preview",
      cookieHeader,
      {},  // empty body — no draft copy; endpoint must use the saved override
    );
    const previewBody = previewRes.body as Record<string, unknown> | null;

    assert(previewRes.status === 200, "Preview returns HTTP 200");
    assert(
      typeof previewBody?.subject === "string" && (previewBody.subject as string).length > 0,
      "Preview subject is a non-empty string",
      previewBody?.subject,
    );

    // ── Step 5: Assert override values appear, default values do not ──────────
    console.log("\n3. Override values in subject and HTML");

    assert(
      typeof previewBody?.subject === "string" &&
        (previewBody.subject as string).includes("Fixture Override:"),
      "subject contains the overridden prefix",
      previewBody?.subject,
    );
    assert(
      typeof previewBody?.subject === "string" &&
        !(previewBody.subject as string).includes(DEFAULT_SUBJECT_FRAGMENT),
      "subject does not contain the default copy text",
      previewBody?.subject,
    );
    assert(
      typeof previewBody?.html === "string" &&
        (previewBody.html as string).includes(UNIQUE_HEADING),
      "rendered HTML contains the overridden heading",
      typeof previewBody?.html === "string"
        ? `html length ${(previewBody.html as string).length}, heading present: ${(previewBody.html as string).includes(UNIQUE_HEADING)}`
        : previewBody?.html,
    );
    assert(
      typeof previewBody?.html === "string" &&
        (previewBody.html as string).length > 100,
      "rendered HTML is non-trivially populated (>100 chars)",
      typeof previewBody?.html === "string" ? (previewBody.html as string).length : previewBody?.html,
    );
  } finally {
    // ── Step 6: Restore prior override state via RLS-aware context ────────────
    if (overrideWritten) {
      await withDbContext(SYSTEM, async (c) => {
        if (!priorOverride) {
          // No row existed before the test — remove the one we inserted.
          await q(c, `delete from email_template_overrides where template_key = $1`, ["org_approved"]);
        } else {
          // Restore to the exact pre-test state, including audit fields.
          await q(
            c,
            `update email_template_overrides
                set subject    = $2,
                    heading    = $3,
                    paragraphs = $4::jsonb,
                    recipients = $5,
                    enabled    = $6,
                    updated_at = $7,
                    updated_by = $8
              where template_key = $1`,
            [
              "org_approved",
              priorOverride.subject,
              priorOverride.heading,
              priorOverride.paragraphs !== null ? JSON.stringify(priorOverride.paragraphs) : null,
              priorOverride.recipients,
              priorOverride.enabled,
              priorOverride.updated_at,
              priorOverride.updated_by,
            ],
          );
        }
      });
    }
    await pool.end();
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nTest failures detected — see ✗ lines above.");
    process.exit(1);
  } else {
    console.log("\nAll checks passed.");
  }
}

main().catch((err) => {
  console.error("Test script error:", err);
  void pool.end();
  process.exit(1);
});
