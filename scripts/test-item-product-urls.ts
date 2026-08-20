/**
 * Regression coverage for long, per-item product URLs.
 *
 * Requires the development workflow and seeded quick-login accounts.
 * Writes zz_fixture rows and removes them before exit.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-item-product-urls.ts
 */
import { pool } from "../server/db/client";
import { MAX_PRODUCT_URL_LENGTH } from "../shared/item-product-url";

const BASE = "http://localhost:5000";
const marker = `zz_fixture_product_urls_${process.pid}`;
const contactEmail = `${marker}@example.invalid`;
let passed = 0;
let failed = 0;
let requestId: string | null = null;

type ItemPayload = {
  id: string;
  name: string;
  description: string | null;
  productUrl: string | null;
  condition: string | null;
  quantityRequested: number;
  quantityClaimed: number;
  quantityReceived: number;
  sortOrder: number;
};

function assert(condition: boolean, label: string, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function cookies(res: Response): string {
  const headers = res.headers as unknown as { getSetCookie?: () => string[]; get: (name: string) => string | null };
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return raw.map((value) => value.split(";")[0]).join("; ");
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "org_owner" }),
  });
  if (!res.ok) throw new Error(`quick login org_owner failed: ${res.status}`);
  return cookies(res);
}

async function request(cookie: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function amazonUrl(asin: string, trackingCharacter: string, trackingLength = 900): string {
  return `https://www.amazon.com/dp/${asin}?tag=product-url-test-20&ref_=fixture&tracking=${trackingCharacter.repeat(trackingLength)}`;
}

function editRow(item: ItemPayload): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? "",
    productUrl: item.productUrl,
    condition: item.condition,
    quantityRequested: item.quantityRequested,
    quantityReceived: item.quantityReceived,
  };
}

async function itemCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from items where item_request_id = $1`,
    [requestId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  console.log("\n[item product URL tests]\n");
  const member = await login();

  const created = await request(member, "/api/dashboard/items", {
    contactFirstName: "ZZ",
    contactLastName: "Fixture",
    contactEmail,
    contactPhone: "555-0100",
    title: `${marker} request`,
    description: "Product URL regression fixture",
    deadlineType: "ongoing",
    deadlineDate: "",
    peopleHelped: 1,
  });
  const createdBody = (await created.json()) as { id?: string; message?: string };
  requestId = createdBody.id ?? null;
  assert(created.ok && requestId !== null, "member creates an item request draft", `status ${created.status}`);
  if (!requestId) throw new Error(`item request creation failed: ${createdBody.message ?? created.status}`);

  const originalA = amazonUrl("B000000101", "a");
  const originalB = amazonUrl("B000000102", "b");
  assert(originalA.length > 500 && originalB.length > 500, "fixtures exceed the old 500-character limit");

  const addedA = await request(member, `/api/dashboard/items/${requestId}/items`, {
    name: "Long link A",
    description: "First long marketplace link",
    quantityRequested: 2,
    condition: "new",
    productUrl: originalA,
  });
  const addedABody = (await addedA.json()) as { item?: ItemPayload; message?: string };
  assert(
    addedA.ok && addedABody.item?.productUrl === originalA,
    "initial add returns the first complete long URL",
    addedABody.message ?? `status ${addedA.status}`,
  );

  const addedB = await request(member, `/api/dashboard/items/${requestId}/items`, {
    name: "Long link B",
    description: "Second long marketplace link",
    quantityRequested: 3,
    condition: "gently_used",
    productUrl: originalB,
  });
  const addedBBody = (await addedB.json()) as { item?: ItemPayload; message?: string };
  assert(
    addedB.ok && addedBBody.item?.productUrl === originalB,
    "initial add returns a distinct second long URL",
    addedBBody.message ?? `status ${addedB.status}`,
  );

  const addPage = await request(member, `/api/dashboard/items/${requestId}`);
  const addPageBody = (await addPage.json()) as { items?: ItemPayload[] };
  assert(
    addPage.ok &&
      addPageBody.items?.[0]?.productUrl === originalA &&
      addPageBody.items?.[1]?.productUrl === originalB,
    "add-page response keeps each long URL on its own item",
  );

  const storedInitial = await pool.query<{ name: string; productUrl: string | null }>(
    `select name, product_url as "productUrl"
       from items where item_request_id = $1 order by sort_order`,
    [requestId],
  );
  assert(
    storedInitial.rows[0]?.name === "Long link A" &&
      storedInitial.rows[0]?.productUrl === originalA &&
      storedInitial.rows[1]?.name === "Long link B" &&
      storedInitial.rows[1]?.productUrl === originalB,
    "database rows preserve the two initial URLs independently",
  );

  const editPage = await request(member, `/api/dashboard/items/${requestId}/edit`);
  const editPageBody = (await editPage.json()) as { items?: ItemPayload[] };
  const rows = editPageBody.items ?? [];
  if (rows.length !== 2) throw new Error(`expected two editable items, got ${rows.length}`);

  const editedA = amazonUrl("B000000101", "c", 1_100);
  const editedB = amazonUrl("B000000102", "d", 1_200);
  const bulkEdit = await request(member, `/api/dashboard/items/${requestId}/edit/items`, {
    items: rows.map((item, index) => ({
      ...editRow(item),
      productUrl: index === 0 ? editedA : editedB,
    })),
  });
  const bulkEditBody = (await bulkEdit.json()) as { items?: ItemPayload[]; message?: string };
  assert(
    bulkEdit.ok &&
      bulkEditBody.items?.[0]?.productUrl === editedA &&
      bulkEditBody.items?.[1]?.productUrl === editedB,
    "bulk edit returns both independently updated long URLs",
    bulkEditBody.message ?? `status ${bulkEdit.status}`,
  );

  const inlineUrl = amazonUrl("B000000103", "e", 1_300);
  const inlineAdd = await request(member, `/api/dashboard/items/${requestId}/edit/add-item`, {
    name: "Inline long link",
    description: "Added from the edit page",
    quantityRequested: 4,
    condition: "any",
    productUrl: inlineUrl,
  });
  const inlineAddBody = (await inlineAdd.json()) as { item?: ItemPayload; message?: string };
  assert(
    inlineAdd.ok && inlineAddBody.item?.productUrl === inlineUrl,
    "inline edit-page add returns its complete long URL",
    inlineAddBody.message ?? `status ${inlineAdd.status}`,
  );

  const blankAdd = await request(member, `/api/dashboard/items/${requestId}/edit/add-item`, {
    name: "Optional blank link",
    description: "No specific product requested",
    quantityRequested: 1,
    condition: "any",
    productUrl: "   ",
  });
  const blankAddBody = (await blankAdd.json()) as { item?: ItemPayload; message?: string };
  assert(
    blankAdd.ok && blankAddBody.item?.productUrl === null,
    "blank optional product links still save as null",
    blankAddBody.message ?? `status ${blankAdd.status}`,
  );

  const countBeforeInvalidAdds = await itemCount();
  const invalidValues = [
    { label: "malformed", value: "not a product URL" },
    { label: "unsupported protocol", value: "ftp://www.amazon.com/dp/B000000104" },
    {
      label: "excessive",
      value: `https://www.amazon.com/dp/B000000105?tracking=${"x".repeat(MAX_PRODUCT_URL_LENGTH)}`,
    },
  ];
  for (const invalid of invalidValues) {
    const rejected = await request(member, `/api/dashboard/items/${requestId}/edit/add-item`, {
      name: `Rejected ${invalid.label}`,
      description: "This row must not be inserted",
      quantityRequested: 1,
      condition: "new",
      productUrl: invalid.value,
    });
    const rejectedBody = (await rejected.json().catch(() => null)) as { message?: string } | null;
    assert(
      rejected.status === 400 && Boolean(rejectedBody?.message),
      `${invalid.label} product URL fails visibly`,
      `status ${rejected.status}`,
    );
  }
  assert((await itemCount()) === countBeforeInvalidAdds, "invalid add attempts insert no partial item rows");

  const beforeAtomicFailure = await request(member, `/api/dashboard/items/${requestId}/edit`);
  const beforeAtomicFailureBody = (await beforeAtomicFailure.json()) as { items: ItemPayload[] };
  const atomicRows = beforeAtomicFailureBody.items;
  const firstBefore = atomicRows[0]!;
  const atomicFailure = await request(member, `/api/dashboard/items/${requestId}/edit/items`, {
    items: atomicRows.map((item, index) => ({
      ...editRow(item),
      name: index === 0 ? "This name must not save" : item.name,
      productUrl: index === 1 ? "javascript:alert('no')" : item.productUrl,
    })),
  });
  assert(atomicFailure.status === 400, "bulk edit rejects an invalid neighboring product URL");
  const firstAfterFailure = await pool.query<{ name: string; productUrl: string | null }>(
    `select name, product_url as "productUrl" from items where id = $1`,
    [firstBefore.id],
  );
  assert(
    firstAfterFailure.rows[0]?.name === firstBefore.name &&
      firstAfterFailure.rows[0]?.productUrl === firstBefore.productUrl,
    "failed bulk URL validation rolls back every neighboring edit",
  );

  await pool.query(`update item_requests set status = 'active', approved_at = now() where id = $1`, [requestId]);
  const publicResponse = await fetch(`${BASE}/api/public/item-requests/${requestId}`);
  const publicBody = (await publicResponse.json()) as { items?: ItemPayload[] };
  const publicByName = new Map((publicBody.items ?? []).map((item) => [item.name, item.productUrl]));
  assert(
    publicResponse.ok &&
      publicByName.get("Long link A") === editedA &&
      publicByName.get("Long link B") === editedB &&
      publicByName.get("Inline long link") === inlineUrl &&
      publicByName.get("Optional blank link") === null,
    "public item-detail payload returns every product URL on the corresponding card",
    `status ${publicResponse.status}`,
  );

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

async function cleanup(): Promise<void> {
  if (requestId) {
    await pool.query(`delete from approval_events where entity_id = $1`, [requestId]);
    await pool.query(`delete from email_log where entity_id = $1`, [requestId]);
    await pool.query(`delete from item_requests where id = $1`, [requestId]);
  }
  await pool.query(`delete from people where lower(email) = lower($1)`, [contactEmail]);
  await pool.end();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);