import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdminCsvExportButton,
  downloadCsv,
  fetchAllAdminPages,
  type CsvColumn,
} from "../client/src/components/admin/AdminCsvExportButton";

type Row = { id: string; value: string };
const readRows = (payload: unknown): { rows: Row[]; total: number } =>
  payload as { rows: Row[]; total: number };
const params = new URLSearchParams({
  status: "active",
  search: "Jane Doe",
  sort: "lastName",
  direction: "desc",
  page: "4",
  pageSize: "25",
});

function response(payload: unknown, ok = true): Response {
  return { ok, json: async () => payload } as Response;
}

async function withFetch(
  handler: (url: string) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://admin.example" } },
  });
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    handler(String(input))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
}

async function testFetchAllPages(): Promise<void> {
  const requested: URL[] = [];
  const rows = Array.from({ length: 205 }, (_, index) => ({
    id: `row-${index}`,
    value: `Value ${index}`,
  }));
  await withFetch(async (input) => {
    const url = new URL(input, "https://admin.example");
    requested.push(url);
    const page = Number(url.searchParams.get("page"));
    assert.equal(url.searchParams.get("pageSize"), "100");
    assert.equal(url.searchParams.get("status"), "active");
    assert.equal(url.searchParams.get("search"), "Jane Doe");
    assert.equal(url.searchParams.get("sort"), "lastName");
    assert.equal(url.searchParams.get("direction"), "desc");
    return response({ rows: rows.slice((page - 1) * 100, page * 100), total: rows.length });
  }, async () => {
    const exported = await fetchAllAdminPages("/api/admin/members", params, readRows);
    assert.equal(exported.length, 205);
    assert.deepEqual(exported, rows);
  });
  assert.deepEqual(requested.map((url) => url.searchParams.get("page")), ["1", "2", "3"]);
  assert.equal(params.get("page"), "4");
  assert.equal(params.get("pageSize"), "25");

  await withFetch(async () => response({ message: "forbidden" }, false), async () => {
    await assert.rejects(fetchAllAdminPages("/api/admin/members", params, readRows), /could not be exported/);
  });

  let downloads = 0;
  const exportAfterFetch = async (): Promise<void> => {
    const exported = await fetchAllAdminPages("/api/admin/members", params, readRows);
    downloads += 1;
    return void exported;
  };
  await withFetch(async (input) => {
    const page = Number(new URL(input, "https://admin.example").searchParams.get("page"));
    return response({ rows: rows.slice((page - 1) * 100, page * 100), total: page === 1 ? 101 : 102 });
  }, async () => {
    await assert.rejects(exportAfterFetch(), /changed during export/);
  });
  assert.equal(downloads, 0, "a total drift must not start a partial download");

  await withFetch(async (input) => {
    const page = Number(new URL(input, "https://admin.example").searchParams.get("page"));
    return response({
      rows: page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ id: `row-${index}`, value: `${index}` }))
        : [{ id: "row-0", value: "duplicate" }],
      total: 101,
    });
  }, async () => {
    await assert.rejects(exportAfterFetch(), /changed during export/);
  });
  assert.equal(downloads, 0, "repeated IDs must not start a partial download");

  await withFetch(async (input) => {
    const page = Number(new URL(input, "https://admin.example").searchParams.get("page"));
    return response({
      rows: page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ userId: `person-${index}`, requestId: "request-1" }))
        : [{ userId: "person-0", requestId: "request-1" }],
      total: 101,
    });
  }, async () => {
    await assert.rejects(
      fetchAllAdminPages(
        "/api/admin/analytics/audience",
        params,
        (payload) => payload as { rows: { userId: string; requestId: string }[]; total: number },
        (row) => `${row.userId}:${row.requestId}`,
      ),
      /changed during export/,
    );
  });
}

async function testDownloadCsv(): Promise<void> {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const captured = { blob: null as Blob | null };
  let downloadName = "";
  let clicked = false;
  const link = {
    href: "",
    download: "",
    click() {
      clicked = true;
      downloadName = this.download;
    },
    remove() {},
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://admin.example" }, setTimeout: () => 0 },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => link,
      body: { appendChild: () => undefined },
    },
  });
  URL.createObjectURL = ((value: Blob) => {
    captured.blob = value;
    return "blob:admin-csv-test";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

  try {
    const columns: CsvColumn<{ [key: string]: string }>[] = [
      { label: "Comma", value: (row) => row.comma },
      { label: "Newline", value: (row) => row.newline },
      { label: "Quote", value: (row) => row.quote },
      { label: "Formula", value: (row) => row.ascii },
      { label: "Ignorable", value: (row) => row.ignorable },
      { label: "BOM prefix", value: (row) => row.bomPrefix },
    ];
    downloadCsv([{
      comma: "one, two",
      newline: "first line\nsecond line",
      quote: 'She said "yes"',
      ascii: "=1+1",
      ignorable: "\u200B@SUM(A1:A2)",
      bomPrefix: "\uFEFF+SUM(A1:A2)",
    }], columns, "admin-records");
    assert.ok(captured.blob);
    const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await captured.blob.arrayBuffer());
    assert.ok(csv.startsWith("\uFEFF"), "CSV should begin with a UTF-8 BOM");
    assert.ok(csv.includes('"one, two"'));
    assert.ok(csv.includes('"first line\nsecond line"'));
    assert.ok(csv.includes('"She said ""yes"""'));
    assert.ok(csv.includes('"\'=1+1"'), "ASCII formula payloads should be neutralized");
    assert.ok(csv.includes('"\'\u200B@SUM(A1:A2)"'), "Unicode-ignorable prefixes should be neutralized");
    assert.ok(csv.includes('"\'\uFEFF+SUM(A1:A2)"'), "BOM prefixes should be neutralized");
    assert.equal(clicked, true);
    assert.equal(downloadName, "admin-records.csv");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
}

async function main(): Promise<void> {
  await testFetchAllPages();
  await testDownloadCsv();
  const markup = renderToStaticMarkup(
    <AdminCsvExportButton filename="member-list" columns={[]} getRows={async () => []} />,
  );
  assert.match(markup, /Export CSV/);
  assert.match(markup, /aria-label="Export member list CSV"/);
  console.log("Admin CSV export utility and control assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});