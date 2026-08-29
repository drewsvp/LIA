import { SYSTEM } from "../db/client";
import * as cleanup from "../dal/storage-cleanup";
import { deleteImage } from "../storage/object-storage";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Delete now; if storage is unavailable, durably queue the object for retry. */
export async function deleteImageOrQueue(url: string, reason: string): Promise<void> {
  // Legacy externally hosted images are not ours to delete.
  if (!url.startsWith("/storage/")) return;
  try {
    await deleteImage(url);
  } catch (error) {
    await cleanup.enqueue(SYSTEM, { objectUrl: url, reason, error: errorText(error) });
    console.error(`[storage-cleanup] queued ${url} after deletion failed (${reason}):`, error);
  }
}

/** Retry every due cleanup row. Missing objects count as successful deletion. */
export async function sweepStorageCleanup(): Promise<{ deleted: number; failed: number }> {
  const result = { deleted: 0, failed: 0 };
  const rows = await cleanup.listDue(SYSTEM);
  for (const row of rows) {
    try {
      await deleteImage(row.objectUrl);
      await cleanup.remove(SYSTEM, row.id);
      result.deleted += 1;
    } catch (error) {
      await cleanup.recordFailure(SYSTEM, row.id, errorText(error));
      result.failed += 1;
      console.error(`[storage-cleanup] retry failed for ${row.objectUrl}:`, error);
    }
  }
  if (rows.length > 0) {
    console.warn(`[storage-cleanup] pass complete: ${result.deleted} deleted, ${result.failed} failed`);
  }
  return result;
}