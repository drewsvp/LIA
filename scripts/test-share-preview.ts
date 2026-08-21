/**
 * Regression checks for server-rendered share previews (/o/:slug, /items/:id,
 * /volunteer/:id).
 *
 * These assertions read the RAW HTML response, never a browser DOM: the whole
 * point of this feature is what a crawler sees before any JavaScript runs, and
 * devtools would show the post-mount DOM and hide exactly the regression this
 * guards. The checks that matter:
 *   - exactly one <title>, og:title, og:description, og:image per response
 *     (duplicated keys make crawler behaviour non-deterministic);
 *   - the 1200x630 dimension hints appear ONLY with the site-wide fallback
 *     image, never with a per-record image of unknown size;
 *   - member free text is HTML-escaped on the way into attribute values;
 *   - anything that does not resolve — unknown id, non-approved organization,
 *     non-active request, any other route — still serves the default HTML.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-share-preview.ts
 * Exit 0 = pass. The temporary request is removed in a finally block.
 */
import { pool, SYSTEM } from "../server/db/client";
import * as dal from "../server/dal";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5000";
const ctx = SYSTEM;
/** zz_fixture marks a deliberately created row — see the fixture conventions. */
const FIXTURE_TITLE = 'zz_fixture "Winter" Coats & <Boots>';
const DEFAULT_TITLE = "Love in Action | The Alliance";

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

type Page = { status: number; html: string };

/** Fetch as a crawler would: no JavaScript, just the bytes off the wire. */
async function getPage(path: string): Promise<Page> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
  });
  return { status: res.status, html: await res.text() };
}

function head(html: string): string {
  return /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
}

function metaValues(html: string, key: string): string[] {
  const values: string[] = [];
  for (const tag of head(html).match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /(?:property|name)\s*=\s*"([^"]*)"/i.exec(tag)?.[1]?.toLowerCase();
    if (name !== key.toLowerCase()) continue;
    values.push(/content\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "");
  }
  return values;
}

function meta(html: string, key: string): string | null {
  const values = metaValues(html, key);
  return values.length === 1 ? values[0]! : null;
}

function titles(html: string): string[] {
  return (head(html).match(/<title>[\s\S]*?<\/title>/gi) ?? []).map((t) =>
    t.replace(/^<title>/i, "").replace(/<\/title>$/i, ""),
  );
}

function canonicals(html: string): string[] {
  return (head(html).match(/<link\b[^>]*\brel\s*=\s*"canonical"[^>]*>/gi) ?? []).map(
    (tag) => /href\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "",
  );
}

/** Every tag a crawler reads must appear exactly once. */
function checkSingleton(page: Page, label: string): void {
  check(page.status === 200, `${label}: responds 200`);
  check(page.html.includes('<div id="root">'), `${label}: still serves the SPA shell`);
  check(titles(page.html).length === 1, `${label}: exactly one <title>`);
  check(canonicals(page.html).length === 1, `${label}: exactly one canonical link`);
  for (const key of ["og:title", "og:description", "og:url", "og:image", "og:image:alt", "description"]) {
    check(metaValues(page.html, key).length === 1, `${label}: exactly one ${key}`);
  }
}

function checkDefaults(page: Page, label: string): void {
  check(titles(page.html)[0] === DEFAULT_TITLE, `${label}: keeps the default <title>`);
  check(meta(page.html, "og:title") === "Love in Action Database | The Alliance", `${label}: keeps the default og:title`);
  check(
    meta(page.html, "og:url") === "https://lia.defendingthecause.org/",
    `${label}: keeps the site-root og:url`,
  );
}

async function main(): Promise<void> {
  const org = await dal.organizations.getBySlug(ctx, "hearts-hands-family-services");
  if (!org || org.status !== "approved") throw new Error("expected an approved hearts-hands fixture organization");

  const actors = await pool.query<{ id: string }>(
    `select u.id from users u
       join org_memberships m on m.user_id = u.id
      where m.role = 'staff_admin' and m.status = 'active' and u.status = 'active'
      limit 1`,
  );
  const actorUserId = actors.rows[0]?.id;
  if (!actorUserId) throw new Error("expected an active staff admin to approve the fixture request");

  const withImage = await pool.query<{ id: string; imageUrl: string }>(
    `select id, image_url as "imageUrl" from item_requests where status = 'active' and image_url is not null limit 1`,
  );
  const withoutImage = await pool.query<{ id: string; orgLogoUrl: string | null }>(
    `select ir.id, o.logo_url as "orgLogoUrl"
     from item_requests ir
     join organizations o on o.id = ir.org_id
     where ir.status = 'active' and ir.image_url is null
     limit 1`,
  );
  const volunteer = await pool.query<{ id: string }>(
    `select id from volunteer_requests where status = 'active' limit 1`,
  );

  let requestId: string | null = null;
  try {
    console.log("\nPer-record tags replace the site-wide defaults");
    const orgPage = await getPage(`/o/${org.slug}`);
    checkSingleton(orgPage, "organization profile");
    check(
      titles(orgPage.html)[0] === meta(orgPage.html, "og:title"),
      "organization profile: <title> and og:title carry the same string",
    );
    check(
      (meta(orgPage.html, "og:title") ?? "").includes("Love in Action Database"),
      "organization profile: the title names the organization and the site",
    );
    check(
      meta(orgPage.html, "og:url") === canonicals(orgPage.html)[0],
      "organization profile: canonical and og:url agree",
    );
    check(
      (meta(orgPage.html, "og:url") ?? "").endsWith(`/o/${org.slug}`),
      "organization profile: og:url points at the record, not the site root",
    );
    check(
      (meta(orgPage.html, "og:description") ?? "").length <= 156,
      "organization profile: the description is truncated to preview length",
    );
    check(
      !(meta(orgPage.html, "og:description") ?? "x").endsWith(" …"),
      "organization profile: truncation lands on a word boundary, not a bare space",
    );

    const volunteerId = volunteer.rows[0]?.id;
    if (!volunteerId) throw new Error("expected an active volunteer request in the seed data");
    const volunteerPage = await getPage(`/volunteer/${volunteerId}`);
    checkSingleton(volunteerPage, "volunteer detail");
    check(
      (meta(volunteerPage.html, "og:url") ?? "").endsWith(`/volunteer/${volunteerId}`),
      "volunteer detail: og:url points at the record",
    );

    console.log("\nImage branches");
    const fallbackId = withoutImage.rows[0]?.id;
    if (!fallbackId) throw new Error("expected an active item request with no image in the seed data");
    const fallbackPage = await getPage(`/items/${fallbackId}`);
    checkSingleton(fallbackPage, "item without an image");
    const seedOrgLogoUrl = withoutImage.rows[0]?.orgLogoUrl ?? null;
    if (seedOrgLogoUrl) {
      // Seed org already has a logo — the need should show it instead of the default.
      check(
        meta(fallbackPage.html, "og:image") === `${BASE}${seedOrgLogoUrl}`,
        "item without an image: falls back to the organization logo when the org has one",
      );
      check(
        metaValues(fallbackPage.html, "og:image:width").length === 0 &&
          metaValues(fallbackPage.html, "og:image:height").length === 0 &&
          metaValues(fallbackPage.html, "og:image:type").length === 0,
        "item without an image (org logo): no dimension hints for logo of unknown size",
      );
    } else {
      // Neither the need nor its org has an image — expect the site-wide fallback.
      check(
        (meta(fallbackPage.html, "og:image") ?? "").endsWith("/og-image.jpg"),
        "item without an image: falls back to the stable site-wide share image",
      );
      check(
        (meta(fallbackPage.html, "og:image") ?? "").startsWith("http"),
        "item without an image: the fallback image URL is absolute",
      );
      check(
        meta(fallbackPage.html, "og:image:width") === "1200" && meta(fallbackPage.html, "og:image:height") === "630",
        "item without an image: keeps the dimension hints that describe og-image.jpg",
      );
    }

    const imageId = withImage.rows[0]?.id;
    const imageUrl = withImage.rows[0]?.imageUrl;
    if (!imageId || !imageUrl) throw new Error("expected an active item request with an image in the seed data");
    const imagePage = await getPage(`/items/${imageId}`);
    checkSingleton(imagePage, "item with an image");
    check(
      meta(imagePage.html, "og:image") === `${new URL(meta(imagePage.html, "og:url") ?? BASE).origin}${imageUrl}`,
      "item with an image: the stored path is absolutized against the app base URL",
    );
    check(
      metaValues(imagePage.html, "og:image:width").length === 0 &&
        metaValues(imagePage.html, "og:image:height").length === 0 &&
        metaValues(imagePage.html, "og:image:type").length === 0,
      "item with an image: no stale dimension hints for an image of unknown size",
    );
    const imageRes = await fetch(meta(imagePage.html, "og:image") ?? "");
    check(imageRes.ok, "item with an image: a crawler can fetch the advertised image without auth");

    console.log("\nMember free text is escaped");
    const draft = await dal.itemRequests.createDraft(ctx, org.id, {
      title: FIXTURE_TITLE,
      description: "Temporary row created by the share-preview regression check.",
      dropoffLocation: "Roseville",
    });
    requestId = draft.id;
    await dal.itemRequests.transitionStatus(ctx, { requestId, to: "pending", actorUserId });
    await dal.itemRequests.transitionStatus(ctx, { requestId, to: "active", actorUserId });

    const escapedPage = await getPage(`/items/${requestId}`);
    checkSingleton(escapedPage, "item with quotes, ampersands, and angle brackets");
    const escapedTitle = meta(escapedPage.html, "og:title") ?? "";
    check(
      escapedTitle.includes("&quot;Winter&quot;") &&
        escapedTitle.includes("&amp;") &&
        escapedTitle.includes("&lt;Boots&gt;"),
      "escaping: quotes, ampersands, and angle brackets are entity-encoded in the attribute",
    );
    check(!head(escapedPage.html).includes("<Boots>"), "escaping: no raw markup reaches the <head>");
    check(
      titles(escapedPage.html)[0]?.includes("&lt;Boots&gt;") === true,
      "escaping: the plain <title> is escaped too",
    );

    console.log("\nOrg-logo fallback");
    // requestId has no image_url. Give the org a logo and verify the need adopts it.
    const FIXTURE_LOGO_PATH = "/storage/images/zz-fixture-test-logo.png";
    await pool.query(`update organizations set logo_url = $1 where id = $2`, [FIXTURE_LOGO_PATH, org.id]);
    const logoFallbackPage = await getPage(`/items/${requestId}`);
    checkSingleton(logoFallbackPage, "item without image, org has logo");
    check(
      meta(logoFallbackPage.html, "og:image") ===
        `${new URL(meta(logoFallbackPage.html, "og:url") ?? BASE).origin}${FIXTURE_LOGO_PATH}`,
      "org-logo fallback: og:image uses the organization logo when the need has no image",
    );
    check(
      (meta(logoFallbackPage.html, "og:image") ?? "").startsWith("http"),
      "org-logo fallback: the logo image URL is absolute",
    );
    check(
      metaValues(logoFallbackPage.html, "og:image:width").length === 0 &&
        metaValues(logoFallbackPage.html, "og:image:height").length === 0 &&
        metaValues(logoFallbackPage.html, "og:image:type").length === 0,
      "org-logo fallback: no dimension hints for a logo of unknown size",
    );
    // Remove the logo — the need should revert to the site-wide fallback.
    await pool.query(`update organizations set logo_url = null where id = $1`, [org.id]);
    const pureFallbackPage = await getPage(`/items/${requestId}`);
    check(
      (meta(pureFallbackPage.html, "og:image") ?? "").endsWith("/og-image.jpg"),
      "org-logo fallback: reverts to the site-wide image when neither need nor org has an image",
    );
    check(
      meta(pureFallbackPage.html, "og:image:width") === "1200" &&
        meta(pureFallbackPage.html, "og:image:height") === "630",
      "org-logo fallback: site-wide dimension hints are restored when falling back to og-image.jpg",
    );

    console.log("\nUnresolvable records and every other route keep the default HTML");
    await dal.itemRequests.transitionStatus(ctx, {
      requestId,
      to: "archived",
      actorUserId,
      archivedReason: "fulfilled",
    });
    const archivedPage = await getPage(`/items/${requestId}`);
    checkSingleton(archivedPage, "archived item request");
    checkDefaults(archivedPage, "archived item request");

    for (const [path, why] of [
      ["/items/00000000-0000-0000-0000-000000000000", "an unknown item id"],
      ["/volunteer/00000000-0000-0000-0000-000000000000", "an unknown volunteer id"],
      ["/items/not-a-uuid", "a malformed item id"],
      ["/o/zz-no-such-organization", "an unknown organization slug"],
      ["/o/second-harbor-collective", "a pending organization"],
      ["/o/test-harbor-community-aid", "a disabled organization"],
      ["/", "the home page"],
      ["/items", "the item browse page"],
      ["/volunteer", "the volunteer browse page"],
      ["/about", "the about page"],
      ["/dashboard", "the member dashboard"],
      ["/admin/requests", "a staff admin surface"],
    ] as const) {
      const page = await getPage(path);
      check(page.status === 200, `${why}: still responds 200`);
      checkDefaults(page, why);
    }
  } finally {
    // Reset any fixture logo that may have been set during the org-logo fallback tests.
    await pool.query(`update organizations set logo_url = null where id = $1 and logo_url like '/storage/images/zz-%'`, [org.id]);
    if (requestId !== null) {
      await pool.query(`delete from approval_events where entity_type = 'item_request' and entity_id = $1`, [
        requestId,
      ]);
      await pool.query(`delete from item_requests where id = $1`, [requestId]);
    }
    const leftovers = await pool.query<{ count: string }>(
      `select count(*)::text as count from item_requests where title = $1`,
      [FIXTURE_TITLE],
    );
    if (Number(leftovers.rows[0]!.count) !== 0) {
      console.error("FAIL: fixture cleanup left a zz_fixture item request behind");
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
