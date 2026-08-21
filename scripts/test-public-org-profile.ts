/**
 * Regression checks for the PB-07 public organization profile.
 *
 * The case that matters most here is expiry. A volunteer request that is past
 * its expires_on date stays status = 'active' until the nightly expiry job
 * moves it, and that job runs on a schedule and can fail or lag. Public reads
 * therefore have to re-check the date themselves; if that predicate is ever
 * dropped from the shared public list query, an expired need reappears on both
 * the browse page and the organization profile. These checks fail loudly when
 * that happens.
 *
 * Also covers the visibility rules the profile endpoint owns: an approved
 * organization is public, and a pending, disabled, or unknown slug is a 404
 * that cannot be told apart from a slug that never existed.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-public-org-profile.ts
 * Exit 0 = pass. The temporary request is removed in a finally block, including
 * after a failed check.
 */
import { pool, SYSTEM } from "../server/db/client";
import * as dal from "../server/dal/index";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5000";
const ctx = SYSTEM;
/** zz_fixture marks a deliberately created row — see the fixture conventions. */
const FIXTURE_TITLE = "zz_fixture expired volunteer need (PB-07)";

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

type ProfileResponse = {
  status: number;
  body: {
    organization?: { name: string; slug: string };
    itemRequests?: { id: string; organization: { slug: string } }[];
    volunteerRequests?: { id: string; organization: { slug: string } }[];
  };
};

async function getProfile(slug: string): Promise<ProfileResponse> {
  const res = await fetch(`${BASE}/api/public/organizations/${slug}`);
  return { status: res.status, body: (await res.json()) as ProfileResponse["body"] };
}

async function volunteerBrowseIds(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/public/volunteer-requests`);
  const body = (await res.json()) as { requests: { id: string }[] };
  return body.requests.map((r) => r.id);
}

async function main(): Promise<void> {
  // An approved member organization: the only kind whose requests are public.
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

  let requestId: string | null = null;
  try {
    console.log("\nExpired volunteer requests stay out of public reads");
    const draft = await dal.volunteerRequests.createDraft(ctx, org.id, {
      title: FIXTURE_TITLE,
      description: "Temporary row created by the PB-07 regression check.",
      details: "Temporary row created by the PB-07 regression check.",
      eventLocation: "Roseville",
      expiresOn: laDate(-1),
    });
    requestId = draft.id;
    await dal.volunteerRequests.transitionStatus(ctx, { requestId, to: "pending", actorUserId });
    await dal.volunteerRequests.transitionStatus(ctx, { requestId, to: "active", actorUserId });

    const live = await dal.volunteerRequests.getById(ctx, requestId);
    check(live?.status === "active", "the fixture request is active, so only the date can hide it");

    const expiredProfile = await getProfile(org.slug);
    check(expiredProfile.status === 200, "the organization profile loads");
    check(
      !(expiredProfile.body.volunteerRequests ?? []).some((r) => r.id === requestId),
      "an expired volunteer request is absent from the organization profile",
    );
    check(
      !(await volunteerBrowseIds()).includes(requestId),
      "an expired volunteer request is absent from the public browse list",
    );

    // Same row, same status — only the date moves.
    await pool.query(`update volunteer_requests set expires_on = $1 where id = $2`, [laDate(7), requestId]);

    const currentProfile = await getProfile(org.slug);
    check(
      (currentProfile.body.volunteerRequests ?? []).some((r) => r.id === requestId),
      "the same request appears once its expiry date is in the future",
    );
    check(
      (await volunteerBrowseIds()).includes(requestId),
      "the browse list and the profile agree about the unexpired request",
    );

    console.log("\nProfile payload and visibility");
    check(currentProfile.body.organization?.slug === org.slug, "the profile returns the organization slug");
    check(
      [...(currentProfile.body.itemRequests ?? []), ...(currentProfile.body.volunteerRequests ?? [])].every(
        (r) => r.organization.slug === org.slug,
      ),
      "every card payload carries the slug the profile link is built from",
    );

    for (const [slug, why] of [
      ["second-harbor-collective", "a pending organization"],
      ["test-harbor-community-aid", "a disabled organization"],
      ["zz-no-such-organization", "an unknown slug"],
    ] as const) {
      const res = await getProfile(slug);
      check(res.status === 404, `${why} is a 404`);
    }
  } finally {
    if (requestId !== null) {
      await pool.query(`delete from approval_events where entity_type = 'volunteer_request' and entity_id = $1`, [
        requestId,
      ]);
      await pool.query(`delete from volunteer_requests where id = $1`, [requestId]);
    }
    const leftovers = await pool.query<{ count: string }>(
      `select count(*)::text as count from volunteer_requests where title = $1`,
      [FIXTURE_TITLE],
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
