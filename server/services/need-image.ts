/**
 * Auto-sourced images for item requests (needs).
 *
 * Sourcing order (user decision, Aug 2026): try a Pexels stock-photo search
 * first (free, real photos); when Pexels finds nothing, fall back to OpenAI
 * image generation. Either way the bytes land in the app's own object
 * storage via storeImage — external provider URLs are never written to the
 * database (Handbook §7, same rule as uploads).
 *
 * Uploaded-photo-wins is enforced in the DAL (recordGeneratedImage): an
 * automatic write only fills a NULL image_url; a staff regenerate may also
 * replace a previous auto image, never an uploaded one. When the guard
 * loses, the just-stored object is deleted again.
 *
 * Submission never blocks on this: sourceNeedImageInBackground is
 * fire-and-forget after the submit transaction commits. Every failure is
 * recorded on the row (image_gen_status = 'failed' + message) so it is
 * visible on the admin request panel, where staff can retry via Regenerate.
 */
import { SYSTEM } from "../db/client";
import * as itemRequests from "../dal/item-requests";
import * as items from "../dal/items";
import { storeImage, deleteImage } from "../storage/object-storage";
import type { ItemRequest } from "../../shared/types";

export class NeedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedImageError";
  }
}

const FETCH_TIMEOUT_MS = 60_000;

async function timedFetch(url: string, init: RequestInit): Promise<globalThis.Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

type SourcedImage = { data: Buffer; filename: string; source: "stock" | "ai" };

/** Pexels photo search. Returns null when nothing matches (that is not an error). */
async function searchPexels(query: string): Promise<SourcedImage | null> {
  const key = (process.env.PEXELS_API_KEY ?? "").trim();
  if (key === "") return null;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
  const res = await timedFetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new NeedImageError(`Pexels search failed (HTTP ${res.status})`);
  const body = (await res.json()) as { photos?: { src?: { large?: string } }[] };
  const photoUrl = body.photos?.[0]?.src?.large;
  if (!photoUrl) return null;
  const dl = await timedFetch(photoUrl, {});
  if (!dl.ok) throw new NeedImageError(`Pexels photo download failed (HTTP ${dl.status})`);
  const ext = /\.png(\?|$)/i.test(photoUrl) ? "png" : "jpg";
  return { data: Buffer.from(await dl.arrayBuffer()), filename: `stock.${ext}`, source: "stock" };
}

/** OpenAI image generation fallback. */
async function generateWithOpenAi(request: ItemRequest, itemNames: string[]): Promise<SourcedImage> {
  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  if (key === "") {
    throw new NeedImageError("No stock photo matched and OPENAI_API_KEY is not configured — image not generated.");
  }
  const parts = [
    `A warm, realistic photograph of: ${request.title}.`,
    itemNames.length > 0 ? `The items are: ${itemNames.join(", ")}.` : "",
    request.description ? `Context: ${request.description.slice(0, 400)}` : "",
    "Wide 16:10 composition, neutral background, natural light, suitable as a listing photo for a charity donation request. No text, no words, no people.",
  ].filter((p) => p !== "");
  const res = await timedFetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      // gpt-image-1 returns base64 image data by default (the older
      // response_format parameter is rejected by the current API).
      model: "gpt-image-1",
      prompt: parts.join(" "),
      n: 1,
      size: "1536x1024",
      quality: "medium",
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) detail = `${detail}: ${err.error.message}`;
    } catch {
      /* keep the status-only detail */
    }
    throw new NeedImageError(`OpenAI image generation failed (${detail})`);
  }
  const body = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new NeedImageError("OpenAI image generation returned no image data.");
  return { data: Buffer.from(b64, "base64"), filename: "generated.png", source: "ai" };
}

export type SourceNeedImageResult = {
  request: ItemRequest;
  source: "stock" | "ai";
};

/**
 * Source, store, and record an image for one item request. Throws
 * NeedImageError with the failure already recorded on the row.
 * `overwriteGenerated` is the staff-regenerate mode.
 */
export async function sourceNeedImage(
  requestId: string,
  opts: { overwriteGenerated: boolean },
): Promise<SourceNeedImageResult> {
  const request = await itemRequests.getById(SYSTEM, requestId);
  if (!request) throw new NeedImageError(`Request not found: ${requestId}`);
  if (request.imageUrl !== null && !request.imageGenerated) {
    throw new NeedImageError("This request has an uploaded photo — it is never replaced automatically.");
  }
  if (request.imageUrl !== null && !opts.overwriteGenerated) {
    return { request, source: request.imageGenerated ? "stock" : "ai" };
  }

  const marked = await itemRequests.markImageGenPending(SYSTEM, requestId);
  if (!marked) throw new NeedImageError("This request is no longer eligible for pre-approval image changes.");
  try {
    const requestItems = await items.listByRequest(SYSTEM, requestId);
    const itemNames = requestItems.map((i) => i.name).slice(0, 5);
    const query = [request.title, ...itemNames.slice(0, 2)].join(" ").slice(0, 100);

    const sourced = (await searchPexels(query)) ?? (await generateWithOpenAi(request, itemNames));
    const stored = await storeImage({ data: sourced.data, filename: sourced.filename });
    const previousUrl = request.imageUrl;
    const updated = await itemRequests.recordGeneratedImage(SYSTEM, requestId, stored.url, {
      overwriteGenerated: opts.overwriteGenerated,
    });
    if (updated === null) {
      // An uploaded photo won the race — discard ours, uploaded wins.
      await deleteImage(stored.url).catch(() => undefined);
      const current = await itemRequests.getById(SYSTEM, requestId);
      if (!current) throw new NeedImageError(`Request disappeared: ${requestId}`);
      return { request: current, source: sourced.source };
    }
    if (previousUrl !== null && previousUrl !== stored.url) {
      // Regenerate replaced an old auto image; clean up the orphaned object.
      await deleteImage(previousUrl).catch(() => undefined);
    }
    return { request: updated, source: sourced.source };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await itemRequests.recordImageGenFailure(SYSTEM, requestId, message).catch((recordErr) => {
      console.error(`[need-image] could not record failure for ${requestId}:`, recordErr);
    });
    throw err instanceof NeedImageError ? err : new NeedImageError(message);
  }
}

/**
 * Fire-and-forget hook for the submit flow. Never throws; failures are
 * recorded on the row and logged.
 */
export function sourceNeedImageInBackground(request: ItemRequest): void {
  if (request.imageUrl !== null) return; // a photo exists — nothing to fill
  void sourceNeedImage(request.id, { overwriteGenerated: false })
    .then((result) => {
      console.log(`[need-image] ${request.id} "${request.title}": ${result.source} image stored`);
    })
    .catch((err) => {
      console.error(`[need-image] ${request.id} "${request.title}" failed:`, err instanceof Error ? err.message : err);
    });
}
