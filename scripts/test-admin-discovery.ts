import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const base = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
async function login(role: string) {
  const res = await fetch(`${base}/api/login/quick`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }),
  });
  assert.equal(res.status, 200, `${role} login`);
  const cookie = res.headers.getSetCookie().find(value => value.includes("session_token"));
  assert.ok(cookie, `${role} session cookie`);
  return cookie.split(";")[0]!;
}
async function get(path: string, cookie: string) {
  return fetch(`${base}${path}`, { headers: { cookie } });
}
async function main() {
  const admin = await login("staff_admin");
  const approver = await login("staff_approver");
  const paths = [
    "/api/admin/members?status=pending&sort=email&direction=asc&page=1&pageSize=1",
    "/api/admin/requests?status=pending&type=item&sort=childCount&direction=desc&page=1&pageSize=1",
    "/api/admin/people?sort=attached&direction=desc&page=1&pageSize=1",
    "/api/admin/email?sort=recipient&direction=asc&page=1&pageSize=1",
    "/api/admin/activity?sort=note&direction=desc&page=1&pageSize=1",
    "/api/admin/subscribers?sort=email&direction=asc&page=1&pageSize=1",
    "/api/admin/supporters?sort=email&direction=desc&page=1&pageSize=1",
    "/api/admin/participation/donations?sort=organization&direction=asc&page=1&pageSize=1",
    "/api/admin/volunteer-interest-report?sort=name&direction=asc&page=1&pageSize=1",
    "/api/admin/analytics/audience?sort=request&direction=asc&page=1&pageSize=1",
  ];
  for (const path of paths) {
    const res = await get(path, admin);
    assert.equal(res.status, 200, path);
    const payload = await res.json();
    assert.ok(Array.isArray(payload.rows ?? payload.members ?? payload.requests ?? payload.people ?? payload.supporters), `${path}: rows`);
    assert.equal(typeof payload.total, "number", `${path}: total`);
  }
  const alternatePaths = [
    "/api/admin/organizations?status=approved&search=zz&sort=contact&direction=desc&pageSize=1",
    "/api/admin/requests?status=returned&search=zz&sort=returnedAt&direction=desc&pageSize=1",
    "/api/admin/members?status=active&search=zz&sort=inviter&direction=desc&pageSize=1",
    "/api/admin/email?search=zz&sort=related&direction=asc&pageSize=1",
    "/api/admin/activity?search=zz&sort=entity&direction=asc&pageSize=1",
    "/api/admin/subscribers?search=zz&sort=status&direction=asc&pageSize=1",
    "/api/admin/participation/volunteers?search=zz&sort=request&direction=desc&pageSize=1",
    "/api/admin/analytics/audience?search=zz&sort=organization&direction=asc&pageSize=1",
  ];
  for (const path of alternatePaths) {
    const res = await get(path, admin);
    assert.equal(res.status, 200, path);
    assert.equal(typeof (await res.json()).total, "number", path);
  }
  // Name is a two-part SQL sort: DESC must reverse the surname as well as
  // the given-name key, not merely the final expression in ORDER BY.
  for (const endpoint of [
    "/api/admin/people",
    "/api/admin/supporters",
    "/api/admin/volunteer-interest-report",
    "/api/admin/analytics/audience",
  ]) {
    const load = async (direction: "asc" | "desc", page: number) => {
      const response = await get(`${endpoint}?sort=name&direction=${direction}&page=${page}&pageSize=100`, admin);
      assert.equal(response.status, 200, `${endpoint} ${direction} page ${page}`);
      return response.json();
    };
    const ascending = await load("asc", 1);
    const descending = await load("desc", 1);
    const entries = (payload: any) => payload.people ?? payload.supporters ?? payload.rows;
    const name = (row: { lastName: string; firstName: string }) =>
      `${row.lastName ?? ""}\u0000${row.firstName ?? ""}`.toLocaleLowerCase();
    const ascRows = entries(ascending);
    const descRows = entries(descending);
    assert.equal(ascending.total, descending.total, `${endpoint} totals agree`);
    if (ascending.total > 1) {
      const lastAsc = ascending.total <= 100
        ? ascRows[ascRows.length - 1]
        : entries(await load("asc", Math.ceil(ascending.total / 100))).at(-1);
      assert.ok(name(ascRows[0]) <= name(lastAsc), `${endpoint} ascending names`);
      assert.ok(name(descRows[0]) >= name(lastAsc), `${endpoint} descending reverses primary name key`);
      if (ascRows.length > 1) assert.ok(name(ascRows[0]) <= name(ascRows[1]), `${endpoint} ascending first page`);
      if (descRows.length > 1) assert.ok(name(descRows[0]) >= name(descRows[1]), `${endpoint} descending first page`);
    }
  }
  const selectedSubscribers = await (await get("/api/admin/subscribers?status=subscribed&search=zz_fixture&pageSize=100", admin)).json();
  const csv = await (await get("/api/admin/subscribers/export.csv?status=subscribed&search=zz_fixture", admin)).text();
  assert.equal(csv.trim().split("\n").length - 1, selectedSubscribers.total, "subscriber export matches filtered list");
  // Compare server pages against the same full-filter ordering rather than
  // sorting a client-visible slice. Fixtures from quick login and admin tests
  // supply members even in a clean development database.
  const membersPath = "/api/admin/members?status=active&sort=email&direction=asc&pageSize=1";
  const first = await (await get(`${membersPath}&page=1`, admin)).json();
  if (first.total > 1) {
    const second = await (await get(`${membersPath}&page=2`, admin)).json();
    assert.equal(second.total, first.total);
    assert.ok(first.members[0].email.localeCompare(second.members[0].email, undefined, { sensitivity: "base" }) <= 0);
    assert.notEqual(first.members[0].id, second.members[0].id);
    const reverse = await (await get("/api/admin/members?status=active&sort=email&direction=desc&pageSize=1", admin)).json();
    assert.equal(reverse.total, first.total);
    assert.ok(reverse.members[0].email.localeCompare(first.members[0].email, undefined, { sensitivity: "base" }) >= 0);
  }
  if (first.members.length) {
    const part = first.members[0].email.slice(0, 5);
    const search = await (await get(`/api/admin/members?status=active&search=${encodeURIComponent(part)}&orgId=${first.members[0].orgId}&sort=email&direction=asc&pageSize=1`, admin)).json();
    assert.ok(search.members.some((row: { id: string }) => row.id === first.members[0].id), "combined org/search/sort matches across full roster");
    assert.ok(search.total >= 1);
  }
  for (const path of ["/api/admin/members", "/api/admin/requests", "/api/admin/people", "/api/admin/email"]) {
    assert.equal((await get(`${path}?sort=not_a_column`, admin)).status, 400, `${path} rejects sort injection`);
    assert.equal((await get(`${path}?direction=sideways`, admin)).status, 400, `${path} rejects invalid direction`);
  }
  assert.equal((await get("/api/admin/people?sort=name", approver)).status, 404, "contacts remain staff-admin only");
  const browser = await chromium.launch({ headless: true, executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(), args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext();
    const [name, value] = admin.split("=");
    assert.ok(name && value);
    await context.addCookies([{ name, value, url: base }]);
    const page = await context.newPage();
    await page.goto(`${base}/admin/members`);
    await page.getByRole("heading", { name: "Members" }).waitFor();
    await page.getByRole("tab", { name: "Active" }).click();
    const header = page.getByRole("columnheader", { name: /Email/ });
    await header.getByRole("button").click();
    assert.equal(await header.getAttribute("aria-sort"), "ascending");
    await header.getByRole("button").press("Enter");
    assert.equal(await header.getAttribute("aria-sort"), "descending");
    const search = page.getByRole("searchbox", { name: /Search/ });
    await search.fill("unlikely-member-phrase-zz");
    await page.getByText(/No .*match|No members are waiting|No active members|No removed members/i).waitFor();
    await page.getByRole("button", { name: "Clear filters" }).click();
    assert.equal(await search.inputValue(), "");
  } finally { await browser.close(); }
  console.log("Admin discovery API and keyboard/ARIA checks passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });