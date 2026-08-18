/**
 * One-time backfill: source images for active item requests that still show
 * the gray placeholder (image_url IS NULL).
 *
 * Uses sourceNeedImage (Pexels-first, OpenAI fallback) — identical to the
 * submission-time pipeline. Uploaded-photo-wins and failure recording behave
 * exactly as they do in production:
 *   • success → image_gen_status = 'succeeded', image_url set
 *   • failure → image_gen_status = 'failed', image_gen_error set (visible in
 *               the admin request panel so staff can Regenerate individually)
 *
 * Runs with a concurrency cap so we don't hammer Pexels / OpenAI.
 *
 * Usage:
 *   npx tsx scripts/backfill-need-images.ts
 *   npx tsx scripts/backfill-need-images.ts --dry-run   # list IDs only
 */
import { SYSTEM, withDbContext, q } from "../server/db/client";
import { sourceNeedImage } from "../server/services/need-image";

const CONCURRENCY = 3; // parallel sourcing requests
const DRY_RUN = process.argv.includes("--dry-run");

async function fetchTargetIds(): Promise<{ id: string; title: string }[]> {
  return withDbContext(SYSTEM, (c) =>
    q<{ id: string; title: string }>(
      c,
      `select id, title
         from item_requests
        where status = 'active'
          and image_url is null
        order by created_at asc`,
      [],
    ),
  );
}

/** Run at most `concurrency` promises at a time. */
async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      if (item !== undefined) await fn(item, i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

async function main(): Promise<void> {
  const targets = await fetchTargetIds();

  if (targets.length === 0) {
    console.log("No active item requests are missing an image — nothing to do.");
    return;
  }

  console.log(`Found ${targets.length} active request(s) with no image.`);

  if (DRY_RUN) {
    console.log("\n--dry-run mode: listing targets only (no images sourced)\n");
    for (const t of targets) {
      console.log(`  ${t.id}  "${t.title}"`);
    }
    return;
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failures: { id: string; title: string; error: string }[] = [];

  await pool(targets, CONCURRENCY, async (target, i) => {
    const prefix = `[${i + 1}/${targets.length}] ${target.id} "${target.title}"`;
    try {
      const result = await sourceNeedImage(target.id, { overwriteGenerated: false });
      if (result.request.imageUrl !== null) {
        console.log(`${prefix}: ✓ ${result.source} image stored`);
        succeeded++;
      } else {
        // imageUrl still null means the guard decided nothing to do (shouldn't
        // happen here since we filtered, but be safe)
        console.log(`${prefix}: – skipped (image already present or guard blocked)`);
        skipped++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${prefix}: ✗ ${message}`);
      failures.push({ id: target.id, title: target.title, error: message });
      failed++;
    }
  });

  console.log("\n=== Backfill complete ===");
  console.log(`  Succeeded : ${succeeded}`);
  console.log(`  Failed    : ${failed}`);
  if (skipped > 0) console.log(`  Skipped   : ${skipped}`);
  console.log(`  Total     : ${targets.length}`);

  if (failures.length > 0) {
    console.log("\nFailed requests (image_gen_status = 'failed' in the admin panel):");
    for (const f of failures) {
      console.log(`  ${f.id}  "${f.title}"`);
      console.log(`    ${f.error}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Backfill script crashed:", err);
    process.exit(1);
  },
);
