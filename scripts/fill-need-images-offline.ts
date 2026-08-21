/**
 * Offline need-photo filling — for when the app's own provider call cannot
 * run (billing limit, outage) but photos are still needed on the site.
 *
 * The images are produced outside this process; this script only supplies the
 * exact prompt the pipeline would have used, and writes an already-generated
 * file through the app's own storage and DAL path. Nothing here bypasses a
 * pipeline rule: the prompt comes from buildPrompt (same guardrails, same
 * per-request casting), the bytes go through storeImage (no provider or local
 * path is ever written to an image column), and the row is written by
 * recordGeneratedImage, so uploaded-photo-wins and the status flags behave
 * exactly as they do at submission time.
 *
 * Two modes:
 *
 *   # 1. print the prompts as JSON, one entry per request
 *   npx tsx scripts/fill-need-images-offline.ts --prompts item:<id> volunteer:<id> …
 *
 *   # 2. store the generated files and record them on their requests
 *   npx tsx scripts/fill-need-images-offline.ts --store <manifest.json>
 *
 * The manifest is [{ id, kind, title, filePath }] — the same entries returned
 * by --prompts, each with the path of the image generated from its prompt.
 *
 * Candidates are requests whose image_url is null; selecting by
 * image_gen_status instead would wrongly include uploaded photos, which carry
 * no status and must never be replaced.
 */
import { readFile } from "node:fs/promises";
import { SYSTEM } from "../server/db/client";
import * as itemRequests from "../server/dal/item-requests";
import * as items from "../server/dal/items";
import * as volunteerRequests from "../server/dal/volunteer-requests";
import * as volunteerRoles from "../server/dal/volunteer-roles";
import { storeImage, deleteImage } from "../server/storage/object-storage";
import { buildPrompt, type RequestKind } from "../server/services/need-image";

type Target = { id: string; kind: RequestKind; title: string };
type PromptEntry = Target & { prompt: string };
type ManifestEntry = Target & { filePath: string };

const DAL = { item: itemRequests, volunteer: volunteerRequests };

/** The statuses the pipeline's own claim accepts — archived rows are never candidates. */
const ELIGIBLE_STATUSES = new Set(["draft", "pending", "active"]);

function parseTarget(arg: string): { kind: RequestKind; id: string } {
  const [kind, id] = arg.split(":");
  if ((kind !== "item" && kind !== "volunteer") || !id) {
    throw new Error(`expected "item:<id>" or "volunteer:<id>", got "${arg}"`);
  }
  return { kind, id };
}

async function subNamesFor(kind: RequestKind, requestId: string): Promise<string[]> {
  const names =
    kind === "item"
      ? (await items.listByRequest(SYSTEM, requestId)).map((i) => i.name)
      : (await volunteerRoles.listByRequest(SYSTEM, requestId)).map((r) => r.name);
  return names.slice(0, 5);
}

/** Mode 1 — the exact prompt the pipeline would send, per request. */
async function printPrompts(args: string[]): Promise<void> {
  const out: PromptEntry[] = [];
  for (const arg of args) {
    const { kind, id } = parseTarget(arg);
    const request = await DAL[kind].getById(SYSTEM, id);
    if (!request) throw new Error(`request not found: ${arg}`);
    if (request.imageUrl !== null) throw new Error(`request already has a photo, refusing: ${arg}`);
    // Refuse before anything is generated: an archived row can never receive
    // an auto photo, so generating one for it would only waste the spend.
    if (!ELIGIBLE_STATUSES.has(request.status)) {
      throw new Error(`request is ${request.status}, not eligible for an auto photo: ${arg}`);
    }
    out.push({ id, kind, title: request.title, prompt: buildPrompt(kind, request, await subNamesFor(kind, id)) });
  }
  console.log(JSON.stringify(out, null, 2));
}

/** Mode 2 — store generated files exactly as the pipeline would. */
async function storeFromManifest(manifestPath: string): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("manifest must be an array of { id, kind, title, filePath }");
  const entries = parsed.map((raw, i) => {
    const e = raw as Partial<ManifestEntry>;
    // A bad kind would otherwise index the DAL map with undefined and crash
    // mid-batch, after earlier rows have already been written.
    if (e.kind !== "item" && e.kind !== "volunteer") {
      throw new Error(`manifest entry ${i}: kind must be "item" or "volunteer", got ${JSON.stringify(e.kind)}`);
    }
    if (typeof e.id !== "string" || e.id === "") throw new Error(`manifest entry ${i}: missing id`);
    if (typeof e.filePath !== "string" || e.filePath === "") {
      throw new Error(`manifest entry ${i}: missing filePath`);
    }
    return { id: e.id, kind: e.kind, title: e.title ?? e.id, filePath: e.filePath } satisfies ManifestEntry;
  });
  let stored = 0;
  let skipped = 0;

  for (const entry of entries) {
    const dal = DAL[entry.kind];

    // Look before claiming. A row that already has a photo — because an
    // earlier run of this same manifest filled it, or because someone
    // uploaded one — must be left exactly as it is: claiming it first would
    // strand a finished row at 'pending', which the sweep would then retry.
    const before = await dal.getById(SYSTEM, entry.id);
    if (!before) {
      console.error(`✗ ${entry.kind} "${entry.title}": request not found — skipped`);
      skipped += 1;
      continue;
    }
    if (before.imageUrl !== null) {
      console.log(`–  ${entry.kind} "${entry.title}": already has a photo — left untouched`);
      skipped += 1;
      continue;
    }
    if (!ELIGIBLE_STATUSES.has(before.status)) {
      console.error(`✗ ${entry.kind} "${entry.title}": ${before.status} — not eligible, skipped`);
      skipped += 1;
      continue;
    }

    if (!(await dal.markImageGenPending(SYSTEM, entry.id))) {
      console.error(`✗ ${entry.kind} "${entry.title}": could not claim the row — skipped`);
      skipped += 1;
      continue;
    }

    // Past the claim the row is 'pending', so every exit records an outcome —
    // exactly as the pipeline does. A row left 'pending' would be swept and
    // retried forever.
    let object: { url: string } | null = null;
    try {
      const data = await readFile(entry.filePath);
      object = await storeImage({ data, filename: "generated.png" });
      const updated = await dal.recordGeneratedImage(SYSTEM, entry.id, object.url, { overwriteGenerated: false });
      if (updated === null) {
        // An uploaded photo won the race — discard the object, uploaded wins.
        await deleteImage(object.url).catch(() => undefined);
        await dal.recordImageGenFailure(SYSTEM, entry.id, "offline fill: an uploaded photo won the guard");
        console.error(`✗ ${entry.kind} "${entry.title}": an uploaded photo won the guard — nothing written`);
        skipped += 1;
        continue;
      }
      console.log(`✓ ${entry.kind} "${entry.title}": ${updated.imageUrl}`);
      stored += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (object !== null) await deleteImage(object.url).catch(() => undefined);
      await dal
        .recordImageGenFailure(SYSTEM, entry.id, `offline fill: ${message}`)
        .catch((recordErr) => console.error(`  could not record the failure either:`, recordErr));
      console.error(`✗ ${entry.kind} "${entry.title}": ${message}`);
      skipped += 1;
    }
  }

  console.log(`\n${stored} photo(s) stored, ${skipped} skipped, of ${entries.length}.`);
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "--prompts" && rest.length > 0) return printPrompts(rest);
  if (mode === "--store" && rest[0]) return storeFromManifest(rest[0]);
  throw new Error(
    "usage:\n" +
      "  npx tsx scripts/fill-need-images-offline.ts --prompts item:<id> volunteer:<id> …\n" +
      "  npx tsx scripts/fill-need-images-offline.ts --store <manifest.json>",
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
