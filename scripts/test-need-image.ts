/**
 * E2E check for the auto-image pipeline, run once per request kind
 * (item and volunteer — D67 gives them the same pipeline).
 *
 * Two phases per kind:
 *   A. Guard suite — uploaded-photo-wins, regenerate, remove, sweep
 *      eligibility.  Uses a synthetic stored object, so it never touches the
 *      image provider and always runs.
 *   B. Live generation — the real sourceNeedImage path.  When the provider is
 *      unavailable (no key, billing/quota limit), this phase reports SKIPPED
 *      instead of failing, but still asserts the failure landed on the row
 *      where staff can see it.
 *
 * Fixtures are zz_fixture-marked and cleaned up afterwards.
 * Usage: NODE_ENV=development npx tsx scripts/test-need-image.ts
 */
import { SYSTEM, withDbContext, q } from "../server/db/client";
import * as itemRequests from "../server/dal/item-requests";
import * as volunteerRequests from "../server/dal/volunteer-requests";
import { sourceNeedImage, NeedImageError, type RequestKind } from "../server/services/need-image";
import { storeImage, readImage, deleteImage, isAvailable } from "../server/storage/object-storage";

let passed = 0;
let failed = 0;
const skipped: string[] = [];

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✓  ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗  ${label}`);
    failed += 1;
  }
}

function skip(label: string, why: string): void {
  console.warn(`  –  SKIPPED ${label}: ${why}`);
  skipped.push(label);
}

/** A provider outage the environment cannot fix (no key, no credit, rate cap). */
function isProviderUnavailable(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /not configured|billing|quota|insufficient|rate limit|429/i.test(m);
}

/** 1x1 PNG — stands in for a generated image in the guard suite. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type ImageRow = {
  imageUrl: string | null;
  imageGenerated: boolean;
  imageGenStatus: string | null;
  imageGenError: string | null;
  imageGenRetries: number;
};

/** The DAL surface both kinds must implement identically. */
type KindHarness = {
  table: string;
  create: (orgId: string) => Promise<{ id: string }>;
  getById: (id: string) => Promise<ImageRow | null>;
  patch: (
    orgId: string,
    id: string,
    p: { imageGenerated?: boolean; imageGenStatus?: null; imageGenError?: null },
  ) => Promise<unknown>;
  markPending: (id: string) => Promise<boolean>;
  record: (id: string, url: string, opts: { overwriteGenerated: boolean }) => Promise<ImageRow | null>;
  recordFailure: (id: string, message: string) => Promise<void>;
  clearGenerated: (id: string) => Promise<ImageRow | null>;
  listSweepable: (afterMinutes: number, maxRetries: number) => Promise<{ id: string }[]>;
  claimForSweep: (id: string, maxRetries: number, strandedAfterMinutes: number) => Promise<boolean>;
};

const HARNESSES: Record<RequestKind, KindHarness> = {
  item: {
    table: "item_requests",
    create: (orgId) =>
      itemRequests.createDraft(SYSTEM, orgId, {
        title: "Warm winter coats for kids",
        description: "zz_fixture — new winter coats, sizes 6-12.",
      }),
    getById: (id) => itemRequests.getById(SYSTEM, id),
    patch: (orgId, id, p) => itemRequests.update(SYSTEM, orgId, id, p),
    markPending: (id) => itemRequests.markImageGenPending(SYSTEM, id),
    record: (id, url, opts) => itemRequests.recordGeneratedImage(SYSTEM, id, url, opts),
    recordFailure: (id, m) => itemRequests.recordImageGenFailure(SYSTEM, id, m),
    clearGenerated: (id) => itemRequests.clearGeneratedImage(SYSTEM, id),
    listSweepable: (a, m) => itemRequests.listFailedOrStrandedImageGen(SYSTEM, a, m),
    claimForSweep: (id, m, s) => itemRequests.claimImageGenForSweep(SYSTEM, id, m, s),
  },
  volunteer: {
    table: "volunteer_requests",
    create: (orgId) =>
      volunteerRequests.createDraft(SYSTEM, orgId, {
        title: "Weekly reading tutors for elementary students",
        description: "zz_fixture — volunteers read one-on-one with students after school.",
      }),
    getById: (id) => volunteerRequests.getById(SYSTEM, id),
    patch: (orgId, id, p) => volunteerRequests.update(SYSTEM, orgId, id, p),
    markPending: (id) => volunteerRequests.markImageGenPending(SYSTEM, id),
    record: (id, url, opts) => volunteerRequests.recordGeneratedImage(SYSTEM, id, url, opts),
    recordFailure: (id, m) => volunteerRequests.recordImageGenFailure(SYSTEM, id, m),
    clearGenerated: (id) => volunteerRequests.clearGeneratedImage(SYSTEM, id),
    listSweepable: (a, m) => volunteerRequests.listFailedOrStrandedImageGen(SYSTEM, a, m),
    claimForSweep: (id, m, s) => volunteerRequests.claimImageGenForSweep(SYSTEM, id, m, s),
  },
};

/** Phase A — guards, no provider involved. */
async function guardSuite(kind: RequestKind, orgId: string, h: KindHarness, requestId: string): Promise<void> {
  console.log(`\n  ${kind}: guard suite (no provider)`);
  const stored = await storeImage({ data: TINY_PNG, filename: "generated.png" });
  const orphans: string[] = [stored.url];
  try {
    assert(await h.markPending(requestId), "markImageGenPending claims a fresh draft");

    const recorded = await h.record(requestId, stored.url, { overwriteGenerated: false });
    assert(
      recorded !== null && recorded.imageUrl === stored.url && recorded.imageGenerated,
      "recordGeneratedImage fills an empty image_url and flags it auto-sourced",
    );
    assert(recorded?.imageGenStatus === "succeeded", "status succeeded");
    const readBack = await readImage(stored.url);
    assert(readBack.data.length === TINY_PNG.length, "stored object readable from app storage");

    // Regenerate may replace an auto image.
    const second = await storeImage({ data: TINY_PNG, filename: "generated.png" });
    orphans.push(second.url);
    const replaced = await h.record(requestId, second.url, { overwriteGenerated: true });
    assert(replaced?.imageUrl === second.url, "regenerate replaces a previous auto image");

    // Uploaded-photo-wins: flip the row to "uploaded" and try both write paths.
    await h.patch(orgId, requestId, { imageGenerated: false, imageGenStatus: null, imageGenError: null });
    const third = await storeImage({ data: TINY_PNG, filename: "generated.png" });
    orphans.push(third.url);
    assert(
      (await h.record(requestId, third.url, { overwriteGenerated: false })) === null,
      "auto write refuses an uploaded photo",
    );
    assert(
      (await h.record(requestId, third.url, { overwriteGenerated: true })) === null,
      "staff regenerate refuses an uploaded photo",
    );
    let refused = false;
    try {
      await sourceNeedImage(kind, requestId, { overwriteGenerated: true });
    } catch (err) {
      refused = err instanceof NeedImageError && /uploaded photo/.test(err.message);
    }
    assert(refused, "sourceNeedImage refuses an uploaded photo before calling the provider");
    assert((await h.getById(requestId))?.imageUrl === second.url, "uploaded photo untouched");

    // Remove only touches auto images.
    assert((await h.clearGenerated(requestId)) === null, "remove no-ops on an uploaded photo");
    await h.patch(orgId, requestId, { imageGenerated: true });
    const cleared = await h.clearGenerated(requestId);
    assert(
      cleared !== null && cleared.imageUrl === null && cleared.imageGenStatus === null,
      "remove clears an auto image and its status",
    );

    // Sweep eligibility: a recorded failure is visible and claimable once.
    await h.recordFailure(requestId, "zz_fixture — synthetic failure");
    const afterFail = await h.getById(requestId);
    assert(
      afterFail?.imageGenStatus === "failed" && afterFail.imageGenError !== null,
      "failure is recorded on the row, not swallowed",
    );
    const sweepable = await h.listSweepable(5, 3);
    assert(sweepable.some((r) => r.id === requestId), "sweep lists the failed row");
    assert(await h.claimForSweep(requestId, 3, 5), "sweep claims the failed row");
    assert(!(await h.claimForSweep(requestId, 3, 5)), "a concurrent sweep cannot re-claim it");
    assert((await h.getById(requestId))?.imageGenRetries === 1, "retry counter incremented exactly once");
  } finally {
    for (const url of orphans) await deleteImage(url).catch(() => undefined);
  }
}

/** Phase B — the live provider path. */
async function livePath(kind: RequestKind, orgId: string, h: KindHarness, requestId: string): Promise<void> {
  console.log(`\n  ${kind}: live generation`);
  // Reset the row so the pipeline sees a clean, eligible draft.
  await h.patch(orgId, requestId, { imageGenerated: false, imageGenStatus: null, imageGenError: null });
  await withDbContext(SYSTEM, (c) =>
    q(c, `update ${h.table} set image_url = null, image_gen_retries = 0 where id = $1`, [requestId]),
  );

  try {
    const result = await sourceNeedImage(kind, requestId, { overwriteGenerated: false });
    assert(result.request.imageUrl !== null, `image generated and stored: ${result.request.imageUrl}`);
    assert(result.request.imageGenerated, "imageGenerated flag set");
    const img = await readImage(result.request.imageUrl!);
    assert(img.data.length > 5_000, `stored object readable (${img.data.length} bytes, ${img.contentType})`);
    console.log(`     review this image by hand: ${result.request.imageUrl}`);
    await deleteImage(result.request.imageUrl!).catch(() => undefined);
  } catch (err) {
    const row = await h.getById(requestId);
    assert(
      row?.imageGenStatus === "failed" && row.imageGenError !== null,
      "a provider failure lands on the row where staff can see it",
    );
    if (isProviderUnavailable(err)) {
      skip(`${kind} live generation`, err instanceof Error ? err.message : String(err));
      return;
    }
    assert(false, `live generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runKind(kind: RequestKind, orgId: string): Promise<void> {
  const h = HARNESSES[kind];
  console.log(`\n──── ${kind} requests ────`);
  const request = await h.create(orgId);
  try {
    await guardSuite(kind, orgId, h, request.id);
    await livePath(kind, orgId, h, request.id);
  } finally {
    await withDbContext(SYSTEM, (c) => q(c, `delete from ${h.table} where id = $1`, [request.id])).then(
      () => console.log(`  fixture cleaned up (${request.id})`),
      (err) => console.error("  fixture cleanup failed (leaving zz_fixture row):", err),
    );
  }
}

async function main(): Promise<void> {
  assert(await isAvailable(), "object storage reachable");

  const orgRows = await withDbContext(SYSTEM, (c) => q<{ id: string }>(c, "select id from organizations limit 1", []));
  const orgId = orgRows[0]?.id;
  if (!orgId) throw new Error("no organization in DB — run the seed first");

  await runKind("item", orgId);
  await runKind("volunteer", orgId);

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped.length} skipped`);
  if (skipped.length > 0) {
    console.warn(`Skipped (provider unavailable): ${skipped.join(", ")}`);
  }
  if (failed > 0) throw new Error(`${failed} check(s) failed`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
