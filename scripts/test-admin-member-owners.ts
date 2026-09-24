/**
 * Active organization owners are visible on the member roster, not in the
 * member approval workflow. Requires the development server and seeded staff.
 * Fixtures are removed even when an assertion fails.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { pool } from "../server/db/client";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
const marker = `zz.member-owners.${process.pid}.${Date.now()}`;
const orgIds: string[] = [];
const personIds: string[] = [];
const membershipIds: string[] = [];
type Status = "active" | "pending" | "removed";
type Row = { id: string; role: string; status: string };

async function createMembership(role: "owner" | "member", status: Status): Promise<string> {
  const suffix = `${role}-${status}`;
  const org = await pool.query<{ id: string }>(
    `insert into organizations (kind, name, slug, status)
     values ('member_org', $1, $2, 'approved') returning id`,
    [`ZZ fixture ${marker} ${suffix}`, `${marker}-${suffix}`],
  );
  const orgId = org.rows[0]!.id;
  orgIds.push(orgId);
  const person = await pool.query<{ id: string }>(
    `insert into people (first_name, last_name, email, source_note)
     values ('ZZ', $1, $2, $3) returning id`,
    [suffix, `${marker}.${suffix}@example.invalid`, marker],
  );
  const personId = person.rows[0]!.id;
  personIds.push(personId);
  const user = await pool.query<{ id: string }>(
    `insert into users (person_id, status, kind)
     values ($1, 'invited', 'member') returning id`,
    [personId],
  );
  const membership = await pool.query<{ id: string }>(
    `insert into org_memberships (org_id, user_id, role, status)
     values ($1, $2, $3, $4) returning id`,
    [orgId, user.rows[0]!.id, role, status],
  );
  membershipIds.push(membership.rows[0]!.id);
  return membership.rows[0]!.id;
}

async function cleanup(): Promise<void> {
  if (membershipIds.length) {
    await pool.query(`delete from org_memberships where id = any($1::uuid[])`, [membershipIds]);
  }
  if (orgIds.length) {
    await pool.query(`delete from organizations where id = any($1::uuid[])`, [orgIds]);
  }
  if (personIds.length) {
    await pool.query(`delete from users where person_id = any($1::uuid[])`, [personIds]);
    await pool.query(`delete from people where id = any($1::uuid[])`, [personIds]);
  }
}

async function main(): Promise<void> {
  try {
    const activeOwner = await createMembership("owner", "active");
    const pendingOwner = await createMembership("owner", "pending");
    const removedOwner = await createMembership("owner", "removed");
    const activeMember = await createMembership("member", "active");
    const login = await fetch(`${BASE}/api/login/quick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "staff_admin" }),
    });
    assert.equal(login.status, 200, "staff quick login");
    const cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(";")[0]).join("; ");
    assert.ok(cookie, "staff session cookie");

    async function request(path: string, method = "GET") {
      return fetch(`${BASE}${path}`, { method, headers: { cookie } });
    }
    async function list(status: Status): Promise<{ members: Row[]; total: number }> {
      const response = await request(`/api/admin/members?status=${status}&search=${encodeURIComponent(marker)}`);
      assert.equal(response.status, 200, `${status} member roster loads`);
      return response.json() as Promise<{ members: Row[]; total: number }>;
    }

    const active = await list("active");
    assert.equal(active.total, 2);
    assert.deepEqual(
      new Map(active.members.map(row => [row.id, row.role])),
      new Map([[activeOwner, "owner"], [activeMember, "member"]]),
      "active owners and members are both returned",
    );
    for (const status of ["pending", "removed"] as const) {
      const result = await list(status);
      assert.equal(result.total, 0, `${status} owners stay out of member approval lists`);
      assert.deepEqual(result.members, []);
    }
    const detail = await request(`/api/admin/members/${activeOwner}`);
    assert.equal(detail.status, 200, "active owner detail is readable");
    const body = await detail.json() as {
      membership: { role: string; status: string };
      person: { email: string };
    };
    assert.equal(body.membership.role, "owner");
    assert.equal(body.membership.status, "active");
    assert.equal(body.person.email, `${marker}.owner-active@example.invalid`);
    for (const id of [pendingOwner, removedOwner]) {
      assert.equal((await request(`/api/admin/members/${id}`)).status, 404, "non-active owner detail is excluded");
    }
    for (const action of ["approve", "reject", "reinstate"]) {
      assert.equal(
        (await request(`/api/admin/members/${activeOwner}/${action}`, "POST")).status,
        404,
        `active owner cannot use member ${action} action`,
      );
    }

    const browser = await chromium.launch({
      headless: true,
      executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
    });
    try {
      const context = await browser.newContext();
      await context.addCookies(cookie.split("; ").map(pair => {
        const split = pair.indexOf("=");
        return { name: pair.slice(0, split), value: pair.slice(split + 1), url: BASE };
      }));
      const page = await context.newPage();
      await page.goto(`${BASE}/admin/members`);
      await page.getByRole("tab", { name: "Active" }).waitFor({ timeout: 10000 }).catch(async error => {
        throw new Error(`Member page failed to show Active tab at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 1000)}`, { cause: error });
      });
      await page.getByRole("tab", { name: "Active" }).click();
      await page.getByRole("searchbox", { name: "Search" }).fill(marker);
      const table = page.locator("table.adm-table");
      await table.getByText(`${marker}.owner-active@example.invalid`).waitFor();
      assert.equal(await table.locator("thead").innerText().then(text => text.includes("Role")), true);
      const ownerRow = table.locator("tr", { hasText: `${marker}.owner-active@example.invalid` });
      const memberRow = table.locator("tr", { hasText: `${marker}.member-active@example.invalid` });
      assert.equal(await ownerRow.locator("td").nth(3).innerText(), "Owner");
      assert.equal(await memberRow.locator("td").nth(3).innerText(), "Member");
      await ownerRow.click();
      const panel = page.locator(".adm-detail");
      await panel.getByText(`${marker}.owner-active@example.invalid`).waitFor();
      assert.equal(await panel.getByText("Owner", { exact: true }).count(), 1);
      for (const action of ["Approve", "Reject", "Reinstate"]) {
        assert.equal(await panel.getByRole("button", { name: action }).count(), 0, `owner has no ${action} button`);
      }
      await context.close();
    } finally {
      await browser.close();
    }
    console.log("Admin member owner roster checks passed.");
  } finally {
    try {
      await cleanup();
    } finally {
      await pool.end();
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });