/**
 * Failed-image sweep — retries item requests whose auto-sourced image is
 * stuck in 'failed' (provider hiccup, rate limit) or stranded 'pending'
 * (process restarted before the result could be recorded).
 *
 * Mirrors the email-sweep pattern:
 *   - startup pass to recover from the last crash
 *   - periodic re-sweep to catch transient provider errors
 *   - a durable per-row retry counter (image_gen_retries) caps attempts so
 *     a persistently-failing need stops being retried; the failed status
 *     remains visible on the admin request panel.
 *
 * Uploaded-photo-wins is enforced in recordGeneratedImage (SQL guard) —
 * the sweep never replaces an uploaded photo.
 */
import * as itemRequests from "../dal/item-requests";
import { SYSTEM } from "../db/client";
import { sourceNeedImage } from "../services/need-image";

/** A stranded 'pending' row must be at least this old before the sweep
 *  touches it — a freshly-submitted request is normally resolved within
 *  seconds, so we give it breathing room. */
const STRANDED_AFTER_MINUTES = 5;

/** Maximum number of sweep-triggered retries per row.  After this the row
 *  stays at image_gen_status = 'failed' and only a staff Regenerate click
 *  can kick it again. */
const MAX_RETRIES = 3;

/** Re-sweep interval.  Startup covers crash recovery; this covers transient
 *  provider errors that clear within a few minutes. */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export type ImageSweepSummary = { retried: number; failed: number; skipped: number; total: number };

/** One sweep pass.  Never throws; every row it touches ends succeeded or
 *  failed, never silently dropped. */
export async function sweepFailedImages(): Promise<ImageSweepSummary> {
  const summary: ImageSweepSummary = { retried: 0, failed: 0, skipped: 0, total: 0 };

  let rows;
  try {
    rows = await itemRequests.listFailedOrStrandedImageGen(SYSTEM, STRANDED_AFTER_MINUTES, MAX_RETRIES);
  } catch (err) {
    console.error("[image-sweep] could not query failed/stranded rows:", err);
    return summary;
  }

  if (rows.length === 0) return summary;
  summary.total = rows.length;
  console.warn(
    `[image-sweep] found ${rows.length} failed/stranded image sourcing row(s) (retries < ${MAX_RETRIES})`,
  );

  for (const row of rows) {
    try {
      // Atomic claim: increments image_gen_retries + sets status = 'pending'.
      // A concurrent sweep (e.g. restart during the loop) will see the row
      // already 'pending' or at the cap and skip it.
      const claimed = await itemRequests.claimImageGenForSweep(SYSTEM, row.id, MAX_RETRIES, STRANDED_AFTER_MINUTES);
      if (!claimed) {
        console.warn(`[image-sweep] skip "${row.title}" (${row.id}): claimed or capped concurrently`);
        summary.skipped += 1;
        continue;
      }

      // sourceNeedImage re-calls markImageGenPending (idempotent here) then
      // runs the Pexels → OpenAI sourcing pipeline.  It records failures on
      // the row itself, so no extra write is needed on the error path.
      await sourceNeedImage(row.id, { overwriteGenerated: false });
      console.warn(`[image-sweep] retry succeeded for "${row.title}" (${row.id})`);
      summary.retried += 1;
    } catch (err) {
      // sourceNeedImage already wrote image_gen_status = 'failed' + error msg.
      // Log loudly so the operator can see it without opening the admin panel.
      console.error(
        `[image-sweep] retry failed for "${row.title}" (${row.id}):`,
        err instanceof Error ? err.message : err,
      );
      summary.failed += 1;
    }
  }

  console.warn(
    `[image-sweep] pass complete: ${summary.retried} succeeded, ${summary.failed} failed, ` +
      `${summary.skipped} skipped, of ${summary.total} candidates`,
  );
  return summary;
}

/** Startup sweep plus a periodic re-sweep.  Mirrors startEmailSweep:
 *  in-memory state, unref'd timer so it does not prevent clean shutdown. */
export function startImageSweep(): void {
  void sweepFailedImages();
  const timer = setInterval(() => void sweepFailedImages(), SWEEP_INTERVAL_MS);
  timer.unref();
}
