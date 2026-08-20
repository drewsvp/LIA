/**
 * Auto-sourced images for item requests and volunteer requests.
 *
 * Sourcing is AI generation only (D67). Stock-photo search was removed: a
 * keyword match has no mechanism to constrain who or what appears in frame,
 * so it can misrepresent the requester. Generation runs every image through
 * the same fixed guardrail block below — a shared core (never-show list,
 * house style) plus a per-kind people/category section. The bytes land in the
 * app's own object storage via storeImage; external provider URLs are never
 * written to the database (Handbook §7, same rule as uploads).
 *
 * Both kinds share this one module rather than a copied twin: the guardrail
 * and prompt logic is the single source of truth, and everything table-shaped
 * is reached through a per-kind DAL adapter.
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
import { SYSTEM, type DbContext } from "../db/client";
import * as itemRequests from "../dal/item-requests";
import * as items from "../dal/items";
import * as volunteerRequests from "../dal/volunteer-requests";
import * as volunteerRoles from "../dal/volunteer-roles";
import { storeImage, deleteImage } from "../storage/object-storage";

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

export type RequestKind = "item" | "volunteer";

/**
 * The common shape the prompt builder and sourcing logic need, whichever
 * table backs the row. Both ItemRequest and VolunteerRequest satisfy it.
 */
export type ImageableRequest = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  imageGenerated: boolean;
};

type KindAdapter = {
  getById: (ctx: DbContext, id: string) => Promise<ImageableRequest | null>;
  markImageGenPending: (ctx: DbContext, id: string) => Promise<boolean>;
  recordGeneratedImage: (
    ctx: DbContext,
    id: string,
    url: string,
    opts: { overwriteGenerated: boolean },
  ) => Promise<ImageableRequest | null>;
  recordImageGenFailure: (ctx: DbContext, id: string, message: string) => Promise<void>;
  clearGeneratedImage: (ctx: DbContext, id: string) => Promise<ImageableRequest | null>;
  /** Child names used as prompt context: item names, or volunteer role names. */
  listSubNames: (ctx: DbContext, requestId: string) => Promise<string[]>;
};

const adapters: Record<RequestKind, KindAdapter> = {
  item: {
    getById: itemRequests.getById,
    markImageGenPending: itemRequests.markImageGenPending,
    recordGeneratedImage: itemRequests.recordGeneratedImage,
    recordImageGenFailure: itemRequests.recordImageGenFailure,
    clearGeneratedImage: itemRequests.clearGeneratedImage,
    listSubNames: async (ctx, requestId) => (await items.listByRequest(ctx, requestId)).map((i) => i.name),
  },
  volunteer: {
    getById: volunteerRequests.getById,
    markImageGenPending: volunteerRequests.markImageGenPending,
    recordGeneratedImage: volunteerRequests.recordGeneratedImage,
    recordImageGenFailure: volunteerRequests.recordImageGenFailure,
    clearGeneratedImage: volunteerRequests.clearGeneratedImage,
    listSubNames: async (ctx, requestId) => (await volunteerRoles.listByRequest(ctx, requestId)).map((r) => r.name),
  },
};

// ---------------------------------------------------------------------------
// Guardrails. Held fixed for every generation of a kind — never conditional on
// the individual request. Adapted from the trauma-informed image guardrails,
// with one deliberate, documented reversal: people ARE shown (Tiffany, Aug 20
// 2026) because a child asleep in the crib or a real volunteer moment drives
// donation intent more than an unused product shot. The never-show list is
// unchanged; this is warm and ordinary, not a staged appeal.
// ---------------------------------------------------------------------------

const GUARDRAIL_CORE = `
CORE RULE: Depict the item or activity genuinely in use — warm and
ordinary, never deprivation, never a staged charity moment.

NEVER SHOW: empty containers, bare shelves, unmade beds; worn, dirty,
damaged, or secondhand-looking goods — nothing shown is ever worn,
soiled, faded, or broken, even while being actively used; items on the
ground or in disarray; cluttered, dim, or unsanitary settings;
institutional settings (shelters, waiting rooms, intake desks, fluorescent
light); charity iconography (donation bins, collection boxes, giving
hands, checks, coins); cash, currency, price tags; expressions of
distress, anguish, shame, or defeat; before/after or rescue framing;
benefactor-and-beneficiary staging of any kind — one person presenting,
bestowing, or handing something down to another, or standing over a
seated or smaller figure as a giver; violence, weapons, restraints,
needles; religious symbols or devotional imagery; brand marks or legible
packaging; any text, words, letters, or signage.

ORDINARY CARE IS NOT CHARITY STAGING: the rule above is about donor-and-
recipient framing between strangers, not about ordinary closeness. A
parent, caregiver, teacher, or volunteer leaning over a crib, bending
down, kneeling beside a child, lifting a toddler, or looking down at a
child with affection is exactly right and always welcome. Looking down at
a baby is tenderness, not a downcast gaze.

ALWAYS SHOW: items or settings brand-new and pristine, even mid-use; warm
soft daylight; uncluttered composition with generous negative space; a
domestic, cared-for surface or setting (light wood, linen, clean counter);
natural texture; genuine, contented engagement — never posed, never
transactional.

SAFETY: any person shown, adult or child, is fully clothed in ordinary
daily wear appropriate to the scene. The one expected exception is a
diaper worn as intended, depicted exactly as in standard baby product
photography — never suggestive, never the sole focus of the composition.

HOUSE STYLE (hold fixed, vary only the subject):
- Lighting: soft diffused daylight, single source upper-left, gentle
  falloff, no harsh shadows or artificial color.
- Camera: 50mm-equivalent, f/4, eye-level or slight three-quarter overhead;
  subject fills roughly the center 60% of frame.
- Surface/background: warm neutral (light wood, cream linen, oatmeal, pale
  sage), gently out of focus, no studio-white void, no busy environment.
- Palette: warm neutrals, muted natural accents, nothing saturated or
  brand-colored.
- Finish: photographic, matte, slightly desaturated, fine natural grain, no
  gloss, no HDR, no vignette.
`.trim();

const GUARDRAIL_ITEM = `
PEOPLE: Always include a person actively using the item — wearing it,
holding it, sitting on it, eating it, whatever "in use" means for this
item. Faces visible, ordinary warm or contented expression, never
distress. For child-relevant items (diapers, cribs, car seats, clothing,
backpacks), show a child using the item — a baby settled and asleep in a
crib, or a toddler wearing a fresh, unworn diaper, is the expected image,
not an empty product shot. The item itself stays brand-new and pristine
throughout — never soiled, faded, or worn-looking, no matter how it's
being used.

CATEGORY GUIDANCE (apply when the item matches):
- Infant/child supplies (diapers, formula, wipes, car seats): shown in
  use, always crisp and clean — a baby wearing a fresh unworn diaper, a
  toddler in a like-new car seat, a bottle being held. Never soiled,
  faded, or worn-looking.
- Clothing/shoes: worn naturally by a child or adult, garment itself
  looking brand-new — no wrinkles, no fading, no wear.
- Furniture/bedding: in use and looking new — a baby settled in a crib
  with a crisp unworn fitted sheet, a made bed with clean linens, a
  family at a well-kept table.
- Food/groceries: fresh and appetizing, being eaten or served at a table,
  people present, abundant enough to read as a real meal.
- School/learning supplies: a child at a desk using a backpack or books
  that look new — no worn spines, no scuffed corners.
- Hygiene/household goods: in use and looking fresh — hands washing with
  a full clean bar or bottle, a brand-new-looking toothbrush, nothing
  depleted or grubby.
`.trim();

const GUARDRAIL_VOLUNTEER = `
PEOPLE: Always include people actively engaged in the activity — a
volunteer and the person or people they're working with, mid-task, not
posed. Faces visible, ordinary warm or contented expression, never
distress. Depict the moment as shared work between equals: side by side,
attention on the same task. A volunteer bending or kneeling to meet a
child at the child's own level is right; a volunteer standing over
someone and handing them something is not.

CATEGORY GUIDANCE: depict the actual service happening, not an empty
setting waiting for someone. A mentor and a child working through the
same book together. A tutor and student both looking at the same page. A
small group organizing supplies together at a table. Someone driving with
a passenger beside them in easy conversation. The moment is warm,
ordinary, and mid-activity, never staged as a photo-op and never framed
as one person rescuing another.
`.trim();

/**
 * Casting rotation.
 *
 * Silence in a prompt is not neutrality. Left unspecified, the model picks a
 * single default person and returns it every time — two unrelated test
 * prompts (a crib request and a tutoring request) came back with visibly the
 * same woman. Unaddressed, every family on the site would look alike.
 *
 * So the casting is named explicitly, and rotated by a stable hash of the
 * request id: varied across requests, stable for any one request, so a staff
 * Regenerate returns the same family rather than reshuffling who they are.
 * Volunteer scenes draw a second, always-different descriptor for the person
 * being helped — since both ends come from the same rotation, no fixed
 * pairing (such as one background always in the helper role) can settle in.
 */
const CASTING = [
  "Black",
  "East Asian",
  "Latino or Hispanic",
  "South Asian",
  "White",
  "Middle Eastern or North African",
  "Southeast Asian",
  "multiracial",
  "Indigenous American",
  "Pacific Islander",
] as const;

/** FNV-1a: stable across processes and restarts, unlike an ad hoc char sum. */
function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function buildCasting(kind: RequestKind, requestId: string): string {
  const h = stableHash(requestId);
  const firstIdx = h % CASTING.length;
  const first = CASTING[firstIdx];

  if (kind === "item") {
    return [
      `CASTING: the people in this photograph are ${first}. Anyone else in`,
      "frame belongs to the same family. Vary age and body type naturally for",
      "the scene. Their background is never the subject of the photograph —",
      "they are simply the people in it, doing an ordinary thing.",
    ].join("\n");
  }

  // Offset by at least 1 so the pair is never the same descriptor twice.
  const secondIdx = (firstIdx + 1 + ((h >>> 8) % (CASTING.length - 1))) % CASTING.length;
  const second = CASTING[secondIdx];
  return [
    `CASTING: the volunteer is ${first}. The person or people they are`,
    `working with are ${second}. Vary age and body type naturally for the`,
    "scene. Their backgrounds are never the subject of the photograph — they",
    "are simply the people in it, working on something together.",
  ].join("\n");
}

type SourcedImage = { data: Buffer; filename: string };

/**
 * The exact prompt sent to the provider. Exported so the guardrails can be
 * previewed and tuned (scripts/print-need-image-prompt.ts) without spending
 * a generation.
 */
export function buildPrompt(kind: RequestKind, request: ImageableRequest, subNames: string[]): string {
  const subject = [
    `A warm, realistic photograph of: ${request.title}.`,
    subNames.length > 0
      ? kind === "item"
        ? `The items are: ${subNames.join(", ")}.`
        : `The volunteer roles are: ${subNames.join(", ")}.`
      : "",
    request.description ? `Context: ${request.description.slice(0, 400)}` : "",
    "Square 1:1 composition, suitable as a listing photo for a community donation request.",
  ].filter((p) => p !== "");
  const perKind = kind === "item" ? GUARDRAIL_ITEM : GUARDRAIL_VOLUNTEER;
  return [subject.join(" "), GUARDRAIL_CORE, perKind, buildCasting(kind, request.id)].join("\n\n");
}

/** OpenAI image generation — the only sourcing path. */
async function generateWithOpenAi(
  kind: RequestKind,
  request: ImageableRequest,
  subNames: string[],
): Promise<SourcedImage> {
  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  if (key === "") {
    throw new NeedImageError("OPENAI_API_KEY is not configured — image not generated.");
  }
  const res = await timedFetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      // gpt-image-1 returns base64 image data by default (the older
      // response_format parameter is rejected by the current API).
      model: "gpt-image-1",
      prompt: buildPrompt(kind, request, subNames),
      n: 1,
      // Native square generation, not a post-hoc crop — matches the square
      // format used by request cards and social sharing.
      size: "1024x1024",
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
  return { data: Buffer.from(b64, "base64"), filename: "generated.png" };
}

export type SourceNeedImageResult = {
  request: ImageableRequest;
  /** Always "ai" now that stock search is gone; kept so callers stay explicit. */
  source: "ai";
};

/**
 * Source, store, and record an image for one request of either kind. Throws
 * NeedImageError with the failure already recorded on the row.
 * `overwriteGenerated` is the staff-regenerate mode.
 */
export async function sourceNeedImage(
  kind: RequestKind,
  requestId: string,
  opts: { overwriteGenerated: boolean },
): Promise<SourceNeedImageResult> {
  const dal = adapters[kind];
  const request = await dal.getById(SYSTEM, requestId);
  if (!request) throw new NeedImageError(`Request not found: ${requestId}`);
  if (request.imageUrl !== null && !request.imageGenerated) {
    throw new NeedImageError("This request has an uploaded photo — it is never replaced automatically.");
  }
  if (request.imageUrl !== null && !opts.overwriteGenerated) {
    return { request, source: "ai" };
  }

  const marked = await dal.markImageGenPending(SYSTEM, requestId);
  if (!marked) throw new NeedImageError("This request is no longer eligible for pre-approval image changes.");
  try {
    const subNames = (await dal.listSubNames(SYSTEM, requestId)).slice(0, 5);

    const sourced = await generateWithOpenAi(kind, request, subNames);
    const stored = await storeImage({ data: sourced.data, filename: sourced.filename });
    const previousUrl = request.imageUrl;
    const updated = await dal.recordGeneratedImage(SYSTEM, requestId, stored.url, {
      overwriteGenerated: opts.overwriteGenerated,
    });
    if (updated === null) {
      // An uploaded photo won the race — discard ours, uploaded wins.
      await deleteImage(stored.url).catch(() => undefined);
      const current = await dal.getById(SYSTEM, requestId);
      if (!current) throw new NeedImageError(`Request disappeared: ${requestId}`);
      return { request: current, source: "ai" };
    }
    if (previousUrl !== null && previousUrl !== stored.url) {
      // Regenerate replaced an old auto image; clean up the orphaned object.
      await deleteImage(previousUrl).catch(() => undefined);
    }
    return { request: updated, source: "ai" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dal.recordImageGenFailure(SYSTEM, requestId, message).catch((recordErr) => {
      console.error(`[need-image] could not record failure for ${kind} ${requestId}:`, recordErr);
    });
    throw err instanceof NeedImageError ? err : new NeedImageError(message);
  }
}

/**
 * Fire-and-forget hook for the submit flow. Never throws; failures are
 * recorded on the row and logged.
 */
export function sourceNeedImageInBackground(request: ImageableRequest, kind: RequestKind): void {
  if (request.imageUrl !== null) return; // a photo exists — nothing to fill
  void sourceNeedImage(kind, request.id, { overwriteGenerated: false })
    .then(() => {
      console.log(`[need-image] ${kind} ${request.id} "${request.title}": ai image stored`);
    })
    .catch((err) => {
      console.error(
        `[need-image] ${kind} ${request.id} "${request.title}" failed:`,
        err instanceof Error ? err.message : err,
      );
    });
}
