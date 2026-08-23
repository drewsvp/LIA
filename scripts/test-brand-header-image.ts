/**
 * Task 313 — Confirm replacing or clearing the email header image removes the
 * old file from storage.
 *
 * Tests POST /api/admin/email-brand/header-image and the headerImageUrl:null
 * path of PUT /api/admin/email-brand against the running dev server.
 *
 * Cases:
 *   1. Upload with no prior image: 200, /storage/images/ URL in response and DB.
 *   2. Upload when a prior /storage/images/ URL is in the DB: new URL stored,
 *      prior storage object confirmed gone via readImage().
 *   3. StorageError from storeImage → 503 with a clear message, DB unchanged.
 *      Runs only when object storage is unavailable; skipped otherwise.
 *   4. PUT /api/admin/email-brand with headerImageUrl:null when current value
 *      is a /storage/images/ path: DB cleared, storage object confirmed gone.
 *   5. setHeaderImageUrl INSERT path: temporarily removes the settings row and
 *      confirms the upload re-creates it with valid brand defaults (NOT NULL
 *      columns satisfied).
 *
 * Safety:
 *   - Skips when any header image URL is already configured — never clears or
 *     deletes a user's existing header image URL, whether it is a storage path
 *     or an external URL pasted by an admin.
 *   - Restores the full original brand settings (non-image fields) at exit.
 *
 * Prerequisite: the dev server must be running and the seed must have been run
 * (quick-login is only active in NODE_ENV=development).
 *
 * Usage: npm run test:brand-header-image
 * Exit 0 = all checks passed or gracefully skipped.
 * Exit 1 = at least one failure.
 */
import { pool } from "../server/db/client";
import { readImage, deleteImage, StorageError } from "../server/storage/object-storage";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

// Minimal valid 1×1 PNG — starts with 89 50 4E 47 (PNG magic bytes).
const MIN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=",
  "base64",
);

let passed = 0;
let failed = 0;

function ok(label: string): void {
  console.log(`  ✓ ${label}`);
  passed++;
}
function fail(label: string, detail?: unknown): void {
  console.error(`  ✗ FAIL: ${label}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`);
  failed++;
}
function assert(cond: boolean, label: string, detail?: unknown): void {
  if (cond) ok(label); else fail(label, detail);
}
function skip(label: string): void {
  console.log(`  — SKIP: ${label}`);
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

function parseCookies(res: Response): string[] {
  const h = res.headers as unknown as { getSetCookie?: () => string[]; get: (n: string) => string | null };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const raw = h.get("set-cookie");
  return raw ? raw.split(/,(?=\s*\w+=)/) : [];
}
function cookieHeader(cookies: string[]): string {
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

async function quickLoginCookie(): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/api/login/quick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "staff_admin" }),
    });
    if (res.status === 429) {
      const ms = 1000 * 2 ** attempt;
      console.log(`  (quick-login rate-limited; retrying in ${ms / 1000}s…)`);
      await new Promise((r) => setTimeout(r, ms));
      continue;
    }
    if (!res.ok) throw new Error(`quick-login failed: ${res.status}`);
    return cookieHeader(parseCookies(res));
  }
  throw new Error("quick-login rate-limited after 4 attempts");
}

// ── Brand-settings helpers ────────────────────────────────────────────────────

type BrandBody = {
  primaryColor: string; fontStack: string; orgName: string; programName: string;
  signatureName: string; directorName: string; directorEmail: string; directorTitle: string;
  headerImageUrl: string | null;
};

async function getApiBrand(cookie: string): Promise<BrandBody> {
  const res = await fetch(`${BASE}/api/admin/email-brand`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET /api/admin/email-brand: ${res.status}`);
  return ((await res.json()) as { settings: BrandBody }).settings;
}

async function putBrand(cookie: string, body: BrandBody): Promise<Response> {
  return fetch(`${BASE}/api/admin/email-brand`, {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function dbHeaderUrl(): Promise<string | null> {
  const { rows } = await pool.query<{ v: string | null }>(
    `SELECT header_image_url AS v FROM email_brand_settings WHERE id = 1`,
  );
  return rows[0]?.v ?? null;
}

async function uploadHeaderImage(cookie: string): Promise<{ res: Response; body: Record<string, unknown> }> {
  const fd = new FormData();
  fd.append("image", new Blob([MIN_PNG], { type: "image/png" }), "task-313-fixture.png");
  const res = await fetch(`${BASE}/api/admin/email-brand/header-image`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: fd,
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

/**
 * Try to read a storage URL and confirm it is gone (throws StorageError).
 * Retries briefly to accommodate eventual-consistency deletion propagation.
 * Returns true when the object is confirmed absent, false if still readable.
 */
async function waitUntilGone(url: string, maxMs = 5000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (true) {
    try {
      await readImage(url);
      // Still readable.
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      if (err instanceof StorageError) return true;
      throw err; // unexpected non-storage error
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\nTask 313 — email header image storage cleanup\n");

  // ── Pre-flight ────────────────────────────────────────────────────────────
  const { rows: brandRows } = await pool.query(
    `SELECT 1 FROM email_brand_settings WHERE id = 1 LIMIT 1`,
  );
  if (brandRows.length === 0) {
    console.warn("  SKIP: email_brand_settings row absent — run db:seed first");
    process.exit(0);
  }

  let cookie: string;
  try {
    cookie = await quickLoginCookie();
  } catch (err) {
    console.warn("  SKIP:", err instanceof Error ? err.message : String(err));
    process.exit(0);
  }

  const original = await getApiBrand(cookie);

  // Safety: skip entirely whenever a header image URL is configured — whether
  // it is a /storage/images/ path or an external URL pasted by an admin.
  // The clean-slate PUT would clear it, and the finally block restores only
  // non-image brand fields.  Ask the tester to clear the header first.
  if (original.headerImageUrl !== null) {
    console.warn(
      `  SKIP: a header image URL is already configured (${original.headerImageUrl}).\n` +
      `  Clear it in the admin Settings panel (or run db:seed) before testing cleanup.\n`,
    );
    process.exit(0);
  }

  /** Full PUT payload using original non-image fields. */
  function withHeaderUrl(url: string | null): BrandBody {
    return {
      primaryColor: original.primaryColor,
      fontStack: original.fontStack,
      orgName: original.orgName,
      programName: original.programName,
      signatureName: original.signatureName,
      directorName: original.directorName,
      directorEmail: original.directorEmail,
      directorTitle: original.directorTitle,
      headerImageUrl: url,
    };
  }

  // Track uploaded storage URLs for cleanup in the finally block.
  const uploadedUrls: string[] = [];
  const confirmedDeleted = new Set<string>();

  try {
    // ── Establish clean starting state via API (also warms server cache) ──
    await putBrand(cookie, withHeaderUrl(null));

    // ── Storage probe (doubles as Case 1) ─────────────────────────────────
    console.log("Case 1 — upload with no prior image\n");
    const { res: probeRes, body: probeBody } = await uploadHeaderImage(cookie);
    const storageAvailable = probeRes.status === 200;

    if (storageAvailable) {
      // ── Cases 1, 2, 4, 5 (storage available) ──────────────────────────

      const probeUrl = typeof probeBody.url === "string" ? probeBody.url : null;
      if (probeUrl) uploadedUrls.push(probeUrl);

      assert(probeRes.status === 200, "1a: status 200", probeRes.status);
      assert(
        typeof probeBody.url === "string" && (probeBody.url as string).startsWith("/storage/images/"),
        "1b: URL starts with /storage/images/", probeBody.url,
      );
      assert(probeBody.ok === true, "1c: ok:true", probeBody.ok);
      assert(await dbHeaderUrl() === probeUrl, "1d: URL written to DB");

      // ── Case 2: upload again — prior object must be deleted ────────────
      // The DB and server cache both hold probeUrl (set by Case 1's handler).
      // The second upload should replace it and delete the first object.
      console.log("\nCase 2 — upload replaces a prior /storage/images/ URL\n");

      const { res: res2, body: body2 } = await uploadHeaderImage(cookie);
      const url2 = typeof body2.url === "string" ? body2.url : null;
      if (url2) uploadedUrls.push(url2);

      assert(res2.status === 200, "2a: status 200", res2.status);
      assert(
        typeof body2.url === "string" && (body2.url as string).startsWith("/storage/images/"),
        "2b: response URL is a storage path", body2.url,
      );
      assert(url2 !== probeUrl, "2c: new URL differs from prior URL",
        { new: url2, old: probeUrl });
      assert(await dbHeaderUrl() === url2, "2d: new URL written to DB");

      if (probeUrl) {
        const gone = await waitUntilGone(probeUrl);
        assert(gone, "2e: prior storage object is deleted from bucket", probeUrl);
        if (gone) confirmedDeleted.add(probeUrl);
      }

      skip("Case 3 (StorageError → 503) — storage is available in this environment");

      // ── Case 4: PUT null — current object must be deleted ─────────────
      // DB and cache hold url2.  PUT with null should clear DB + delete url2.
      console.log("\nCase 4 — PUT headerImageUrl:null clears a storage path from DB\n");

      const put4 = await putBrand(cookie, withHeaderUrl(null));
      const body4 = (await put4.json()) as { ok?: boolean; settings?: BrandBody };

      assert(put4.status === 200, "4a: status 200", put4.status);
      assert(body4.ok === true, "4b: ok:true", body4.ok);
      assert(body4.settings?.headerImageUrl === null,
        "4c: response settings.headerImageUrl is null", body4.settings?.headerImageUrl);
      assert(await dbHeaderUrl() === null, "4d: DB headerImageUrl cleared to null");

      if (url2) {
        const gone = await waitUntilGone(url2);
        assert(gone, "4e: prior storage object is deleted from bucket", url2);
        if (gone) confirmedDeleted.add(url2);
      }

      // ── Case 5: setHeaderImageUrl INSERT path (settings row absent) ────
      // Temporarily removes the row via SQL (server cache is unaffected) and
      // verifies that the upload handler still returns 200 and re-creates the
      // row with valid non-null brand defaults — i.e. NOT NULL constraints are
      // satisfied via the BRAND_DEFAULTS seed in setHeaderImageUrl().
      console.log("\nCase 5 — upload succeeds and seeds defaults when settings row is absent\n");

      // Save the current row for restoration.
      const { rows: savedRows } = await pool.query<{
        primaryColor: string; fontStack: string; orgName: string; programName: string;
        signatureName: string; directorName: string; directorEmail: string; directorTitle: string;
      }>(`SELECT primary_color     AS "primaryColor",
                font_stack         AS "fontStack",
                org_name           AS "orgName",
                program_name       AS "programName",
                signature_name     AS "signatureName",
                director_name      AS "directorName",
                director_email     AS "directorEmail",
                director_title     AS "directorTitle"
           FROM email_brand_settings WHERE id = 1`);
      const savedRow = savedRows[0];

      // Delete the row so the upload hits the INSERT path.
      await pool.query(`DELETE FROM email_brand_settings WHERE id = 1`);

      const { res: res5, body: body5 } = await uploadHeaderImage(cookie);
      const url5 = typeof body5.url === "string" ? body5.url : null;
      if (url5) uploadedUrls.push(url5);

      assert(res5.status === 200,
        "5a: upload succeeds even when settings row was absent", res5.status);

      if (res5.status === 200 && url5) {
        const { rows: newRows } = await pool.query<{
          primaryColor: string; headerImageUrl: string | null;
        }>(`SELECT primary_color     AS "primaryColor",
                  header_image_url   AS "headerImageUrl"
             FROM email_brand_settings WHERE id = 1`);

        assert(newRows.length === 1, "5b: settings row re-created by INSERT", newRows.length);
        assert(
          typeof newRows[0]?.primaryColor === "string" && newRows[0].primaryColor.length > 0,
          "5c: primary_color seeded from brand defaults (not null)",
          newRows[0]?.primaryColor,
        );
        assert(newRows[0]?.headerImageUrl === url5,
          "5d: header_image_url written correctly", { db: newRows[0]?.headerImageUrl, expected: url5 });
      }

      // Restore the settings row with the original brand values.
      if (savedRow) {
        await putBrand(cookie, {
          primaryColor: savedRow.primaryColor,
          fontStack: savedRow.fontStack,
          orgName: savedRow.orgName,
          programName: savedRow.programName,
          signatureName: savedRow.signatureName,
          directorName: savedRow.directorName,
          directorEmail: savedRow.directorEmail,
          directorTitle: savedRow.directorTitle,
          headerImageUrl: null, // storage objects from Case 5 are cleaned up below
        });
      }

    } else {
      // ── Case 3 (storage unavailable) ────────────────────────────────────
      console.log("\nCase 3 — StorageError from storeImage → 503\n");

      assert(probeRes.status === 503, "3a: status 503", probeRes.status);
      const msg = typeof probeBody.message === "string" ? probeBody.message : "";
      assert(msg.length > 0, "3b: response body has a non-empty message", probeBody.message);
      assert(/storage|unavailable/i.test(msg),
        "3c: message mentions storage or unavailability", msg);
      assert(await dbHeaderUrl() === null, "3d: DB not modified on StorageError");

      skip("Cases 1, 2, 4, 5 — object storage not available in this environment");
    }

  } finally {
    // Restore all brand fields; leave headerImageUrl null (tests deleted it).
    try { await putBrand(cookie, withHeaderUrl(null)); } catch { /* best-effort */ }

    // Delete any storage objects we created that were not confirmed deleted.
    for (const url of uploadedUrls) {
      if (!confirmedDeleted.has(url)) {
        try {
          await deleteImage(url);
          console.log(`  (cleaned up ${url})`);
        } catch { /* best-effort */ }
      }
    }

    await pool.end();
  }

  console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
