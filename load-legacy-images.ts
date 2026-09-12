/**
 * load-legacy-images.ts
 *
 * One-off: moves the legacy images harvested off the old Wix site into object
 * storage and points the matching database rows at them.
 *
 * Run from the repository root:
 *   npx tsx load-legacy-images.ts                    # dry run, writes nothing
 *   DATABASE_URL="$PROD_URL" npx tsx load-legacy-images.ts --apply
 *
 * Inputs:
 *   request_image_map.csv   local_file,target_table,target_id,legacy_wix_id,title,organization,status
 *   org_logo_map.csv        org_id,org_name,org_slug,local_file,confidence,needs_review
 *   media/requests/<local_file>
 *   media/logos/<local_file>
 *
 * Notes that matter:
 *
 * - Uploads go through storeImage() in the storage adapter, the only module
 *   allowed to touch the bucket. It assigns an `images/<uuid>.<ext>` object
 *   name; the read route serves nothing else. Never upload through the App
 *   Storage pane: objects keep their original filenames there and become
 *   unreachable.
 *
 * - image_generated is set to false on every request row written here. These
 *   are real photographs from the old site, so uploaded-wins must protect them
 *   from the AI image sweep. Setting image_url without this flag would leave
 *   them eligible for overwrite.
 *
 * - Rows whose target already holds a /storage/ URL are skipped unless
 *   --force is passed. Re-running without that would upload a second copy and
 *   orphan the first, since the cleanup queue only fires on app-initiated
 *   replacement.
 *
 * - Upload and update happen per row, upload first. A failed update leaves one
 *   orphaned object, reported at the end, rather than a row pointing at
 *   nothing. Orphans are harmless and listed so they can be deleted by hand.
 *
 * - No GUCs are set, deliberately. guard_member_request_transitions only acts
 *   when app.context = 'member', and capture_organization_context_action only
 *   when app.organization_context_id is set. Both no-op here. The production
 *   role has BYPASSRLS, so RLS does not block the writes.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { storeImage } from "./server/storage/object-storage";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { cur.push(field); field = ""; }
    else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

type Job = {
  kind: "item_request" | "volunteer_request" | "organization";
  table: string;
  column: "image_url" | "logo_url";
  id: string;
  file: string;
  label: string;
  flagged: boolean;
};

async function main() {
  const jobs: Job[] = [];
  const problems: string[] = [];

  // Requests: matched on the legacy Wix id embedded in the filename, so these
  // are exact joins rather than guesses.
  const reqMapPath = "request_image_map.csv";
  if (!existsSync(reqMapPath)) throw new Error(`Missing ${reqMapPath}`);
  for (const r of parseCsv(await readFile(reqMapPath, "utf8"))) {
    if (!r.local_file) continue;
    const file = path.join("media/requests", r.local_file);
    if (!existsSync(file)) { problems.push(`file not found: ${file}`); continue; }
    jobs.push({
      kind: r.target_table === "volunteer_requests" ? "volunteer_request" : "item_request",
      table: r.target_table,
      column: "image_url",
      id: r.target_id,
      file,
      label: `${r.organization} — ${r.title}`,
      flagged: false,
    });
  }

  // Logos: slug/name matched. needs_review=YES rows are still loaded (the
  // fuzzy and containment matches were eyeballed), but reported separately.
  const logoMapPath = "org_logo_map.csv";
  if (!existsSync(logoMapPath)) throw new Error(`Missing ${logoMapPath}`);
  for (const r of parseCsv(await readFile(logoMapPath, "utf8"))) {
    if (!r.local_file) continue;
    const file = path.join("media/logos", r.local_file);
    if (!existsSync(file)) { problems.push(`file not found: ${file}`); continue; }
    jobs.push({
      kind: "organization",
      table: "organizations",
      column: "logo_url",
      id: r.org_id,
      file,
      label: r.org_name,
      flagged: r.needs_review === "YES",
    });
  }

  const counts = {
    item_request: jobs.filter((j) => j.kind === "item_request").length,
    volunteer_request: jobs.filter((j) => j.kind === "volunteer_request").length,
    organization: jobs.filter((j) => j.kind === "organization").length,
  };
  console.log(`\nJobs assembled: ${jobs.length}`);
  console.log(`  item request images:      ${counts.item_request}`);
  console.log(`  volunteer request images: ${counts.volunteer_request}`);
  console.log(`  organization logos:       ${counts.organization}` +
              ` (${jobs.filter((j) => j.kind === "organization" && j.flagged).length} fuzzy-matched)`);
  if (problems.length) {
    console.log(`\nMissing local files (${problems.length}):`);
    for (const p of problems) console.log(`  ${p}`);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  const { rows: [who] } = await db.query("select current_database() as db");
  console.log(`\nDatabase: ${who.db}`);
  if (!APPLY) console.log("DRY RUN — pass --apply to write. Nothing will be uploaded or changed.\n");

  // Skip anything already pointing at storage, so a re-run does not orphan.
  const existing = new Map<string, string | null>();
  for (const table of ["item_requests", "volunteer_requests", "organizations"]) {
    const col = table === "organizations" ? "logo_url" : "image_url";
    const ids = jobs.filter((j) => j.table === table).map((j) => j.id);
    if (!ids.length) continue;
    const { rows } = await db.query(
      `select id, ${col} as url from ${table} where id = any($1::uuid[])`, [ids],
    );
    for (const row of rows) existing.set(`${table}:${row.id}`, row.url);
  }

  const todo = jobs.filter((j) => {
    const cur = existing.get(`${j.table}:${j.id}`);
    if (cur === undefined) { problems.push(`no such row: ${j.table} ${j.id} (${j.label})`); return false; }
    if (cur && cur.startsWith("/storage/") && !FORCE) return false;
    return true;
  });
  const skipped = jobs.length - todo.length - problems.filter((p) => p.startsWith("no such row")).length;
  if (skipped > 0) console.log(`Skipping ${skipped} row(s) that already have a stored image (--force overrides).`);

  if (!APPLY) {
    console.log(`\nWould upload and link ${todo.length} image(s):`);
    for (const j of todo.slice(0, 15)) {
      console.log(`  ${j.kind.padEnd(18)} ${j.flagged ? "[review] " : ""}${j.label.slice(0, 62)}`);
    }
    if (todo.length > 15) console.log(`  … and ${todo.length - 15} more`);
    db.release(); await pool.end();
    console.log("");
    return;
  }

  let ok = 0;
  const orphans: string[] = [];
  const failures: string[] = [];

  for (const [i, j] of todo.entries()) {
    const n = `[${i + 1}/${todo.length}]`;
    let url: string;
    try {
      const data = await readFile(j.file);
      ({ url } = await storeImage({ data, filename: path.basename(j.file) }));
    } catch (err) {
      failures.push(`upload failed: ${j.label} (${(err as Error).message})`);
      console.log(`${n} UPLOAD FAILED  ${j.label.slice(0, 54)}`);
      continue;
    }
    try {
      // image_generated stays false so uploaded-wins protects these from the
      // AI sweep; organizations has no such column.
      const sql = j.column === "logo_url"
        ? `update organizations set logo_url = $1 where id = $2`
        : `update ${j.table} set image_url = $1, image_generated = false where id = $2`;
      const res = await db.query(sql, [url, j.id]);
      if (res.rowCount !== 1) {
        orphans.push(`${url} (no row updated for ${j.table} ${j.id})`);
        console.log(`${n} NO ROW         ${j.label.slice(0, 54)}`);
        continue;
      }
      ok++;
      console.log(`${n} ok             ${j.label.slice(0, 54)}`);
    } catch (err) {
      orphans.push(`${url} (update failed: ${(err as Error).message})`);
      console.log(`${n} UPDATE FAILED  ${j.label.slice(0, 54)}`);
    }
  }

  console.log(`\nLinked ${ok} of ${todo.length}.`);
  if (failures.length) {
    console.log(`\nUpload failures (${failures.length}), nothing stored, safe to re-run:`);
    for (const f of failures) console.log(`  ${f}`);
  }
  if (orphans.length) {
    console.log(`\nOrphaned objects (${orphans.length}) — uploaded but not linked. Delete by hand:`);
    for (const o of orphans) console.log(`  ${o}`);
  }

  db.release();
  await pool.end();
  console.log("");
}

main().catch((err) => { console.error("\nFAILED:", err.message, "\n"); process.exit(1); });
