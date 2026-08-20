/**
 * Print the exact prompt the auto-image pipeline would send for a given
 * request, without calling the provider or touching the database. Use this to
 * review or tune the guardrail block for free.
 *
 * Usage:
 *   npx tsx scripts/print-need-image-prompt.ts item "Crib for a newborn" "Mom is due in three weeks." crib,mattress
 *   npx tsx scripts/print-need-image-prompt.ts volunteer "Weekly reading tutors" "" "Reading tutor"
 */
import { buildPrompt, type RequestKind } from "../server/services/need-image";

const [kindArg, title, description = "", subNamesArg = ""] = process.argv.slice(2);

if (kindArg !== "item" && kindArg !== "volunteer") {
  console.error('First argument must be "item" or "volunteer".');
  process.exit(1);
}
if (!title) {
  console.error("Second argument must be the request title.");
  process.exit(1);
}

const kind: RequestKind = kindArg;
const subNames = subNamesArg
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s !== "");

console.log(
  buildPrompt(
    kind,
    { id: "preview", title, description: description === "" ? null : description, imageUrl: null, imageGenerated: false },
    subNames,
  ),
);
