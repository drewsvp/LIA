/**
 * E2E check for the need auto-image pipeline (task: AI-generated images).
 * Creates a zz_fixture draft request, sources an image (Pexels-first,
 * OpenAI fallback), verifies storage + flags, checks uploaded-photo-wins,
 * remove, and the failure-recording path. Cleans its fixture up afterwards.
 */
import { SYSTEM, withDbContext, q } from "../server/db/client";
import * as itemRequests from "../server/dal/item-requests";
import { sourceNeedImage, NeedImageError } from "../server/services/need-image";
import { readImage, deleteImage, isAvailable } from "../server/storage/object-storage";

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`ok: ${label}`);
}

async function main(): Promise<void> {
  assert(await isAvailable(), "object storage reachable");

  const orgRows = await withDbContext(SYSTEM, (c) => q<{ id: string }>(c, "select id from organizations limit 1", []));
  const orgId = orgRows[0]?.id;
  if (!orgId) throw new Error("no organization in DB — run the seed first");

  const request = await itemRequests.createDraft(SYSTEM, orgId, {
    title: "Warm winter coats for kids",
    description: "zz_fixture — gently used or new winter coats, sizes 6-12.",
  });
  console.log("fixture request:", request.id);

  try {
    // 1. Auto-source (submission path behavior).
    const result = await sourceNeedImage(request.id, { overwriteGenerated: false });
    assert(result.request.imageUrl !== null, `image stored (${result.source}): ${result.request.imageUrl}`);
    assert(result.request.imageGenerated, "imageGenerated flag set");
    assert(result.request.imageGenStatus === "succeeded", "status succeeded");
    const img = await readImage(result.request.imageUrl!);
    assert(img.data.length > 5_000, `stored object readable (${img.data.length} bytes, ${img.contentType})`);

    // 2. Regenerate replaces the auto image (staff path).
    const regen = await sourceNeedImage(request.id, { overwriteGenerated: true });
    assert(regen.request.imageUrl !== null && regen.request.imageGenerated, "regenerate produced a new auto image");
    // old object should be gone
    let oldGone = false;
    try {
      await readImage(result.request.imageUrl!);
    } catch {
      oldGone = true;
    }
    assert(oldGone || result.request.imageUrl === regen.request.imageUrl, "previous auto image cleaned up");

    // 3. Uploaded photo wins: simulate an upload, then confirm auto refuses.
    const uploadedUrl = regen.request.imageUrl!;
    await itemRequests.update(SYSTEM, orgId, request.id, {
      imageGenerated: false,
      imageGenStatus: null,
      imageGenError: null,
    });
    let refused = false;
    try {
      await sourceNeedImage(request.id, { overwriteGenerated: true });
    } catch (err) {
      refused = err instanceof NeedImageError;
    }
    assert(refused, "refuses to replace an uploaded photo");
    const afterRefuse = await itemRequests.getById(SYSTEM, request.id);
    assert(afterRefuse?.imageUrl === uploadedUrl, "uploaded photo untouched");

    // 4. Remove only touches auto images.
    assert((await itemRequests.clearGeneratedImage(SYSTEM, request.id)) === null, "remove no-ops on uploaded photo");
    await itemRequests.update(SYSTEM, orgId, request.id, { imageGenerated: true });
    const cleared = await itemRequests.clearGeneratedImage(SYSTEM, request.id);
    assert(cleared !== null && cleared.imageUrl === null && cleared.imageGenStatus === null, "auto image removed");
    await deleteImage(uploadedUrl).catch(() => undefined);

    // 5. Failure is recorded, not swallowed: break the keys for one call.
    const savedPexels = process.env.PEXELS_API_KEY;
    const savedOpenAi = process.env.OPENAI_API_KEY;
    process.env.PEXELS_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    let failed = false;
    try {
      await sourceNeedImage(request.id, { overwriteGenerated: false });
    } catch {
      failed = true;
    }
    process.env.PEXELS_API_KEY = savedPexels;
    process.env.OPENAI_API_KEY = savedOpenAi;
    const afterFail = await itemRequests.getById(SYSTEM, request.id);
    assert(failed && afterFail?.imageGenStatus === "failed" && afterFail.imageGenError !== null,
      `failure recorded on row: ${afterFail?.imageGenError}`);

    console.log("ALL CHECKS PASSED");
  } finally {
    await withDbContext(SYSTEM, (c) => q(c, "delete from item_requests where id = $1", [request.id])).then(
      () => console.log("fixture cleaned up"),
      (err) => console.error("fixture cleanup failed (leaving zz_fixture row):", err),
    );
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
