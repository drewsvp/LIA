/**
 * Request-centric participant regression coverage.
 *
 * Requires the development server and seeded quick-login accounts.
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";

type Kind = "item" | "volunteer";
type RequestRow = {
  type: Kind;
  id: string;
  title: string;
  status: string;
  orgStatus: "pending" | "approved" | "disabled";
  tab: "pending" | "active" | "archived";
};
type Participant = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  lines?: { itemId: string; itemName: string; quantity: number }[];
  roles?: { roleId: string; roleName: string }[];
};
type ParticipantsPayload = { participants: Participant[]; counterTotal: number };
type Login = { cookieHeader: string; browserCookie: Parameters<BrowserContext["addCookies"]>[0][number] };

let passed = 0;

function assert(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) {
    throw new Error(`${label}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
  passed += 1;
  console.log(`PASS ${label}`);
}

async function login(role: "staff_admin" | "org_owner"): Promise<Login> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  assert(response.ok, `${role} quick login succeeds`, response.status);
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  const sessionCookie = values.find((value) => value.includes("session_token"));
  assert(sessionCookie !== undefined, `${role} quick login returns a session cookie`);
  const [pair] = sessionCookie.split(";");
  const separator = pair!.indexOf("=");
  return {
    cookieHeader: values.map((value) => value.split(";")[0]).join("; "),
    browserCookie: {
      name: pair!.slice(0, separator),
      value: pair!.slice(separator + 1),
      url: BASE,
      httpOnly: /;\s*httponly/i.test(sessionCookie),
      secure: /;\s*secure/i.test(sessionCookie),
      sameSite: "Lax",
    },
  };
}

async function getJson(path: string, cookieHeader?: string): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The assertions below report the status/body mismatch.
  }
  return { response, body };
}

function participantTotal(kind: Kind, participants: Participant[]): number {
  return participants.reduce(
    (total, participant) =>
      total +
      (kind === "item"
        ? (participant.lines ?? []).reduce((lineTotal, line) => lineTotal + line.quantity, 0)
        : (participant.roles ?? []).length),
    0,
  );
}

async function selectRequest(page: Page, row: RequestRow): Promise<void> {
  await page.getByRole("tab", { name: row.tab === "active" ? "Active" : row.tab === "archived" ? "Archived" : "Pending" }).click();
  await page.getByText(row.title, { exact: true }).first().click();
}

async function main(): Promise<void> {
  const staff = await login("staff_admin");
  const member = await login("org_owner");
  const rows: RequestRow[] = [];
  for (const tab of ["pending", "active", "archived"] as const) {
    const result = await getJson(`/api/admin/requests?status=${tab}`, staff.cookieHeader);
    assert(result.response.ok, `${tab} request list loads`);
    const requests = (result.body as { requests?: Omit<RequestRow, "tab">[] }).requests;
    assert(Array.isArray(requests), `${tab} request list has rows`);
    rows.push(...requests.map((row) => ({ ...row, tab })));
  }

  const first = rows[0];
  assert(first !== undefined, "seed contains an admin request");
  for (const [label, cookie] of [["anonymous", undefined], ["member", member.cookieHeader]] as const) {
    const denied = await getJson(`/api/admin/requests/${first.type}/${first.id}/participants`, cookie);
    assert(denied.response.status === 404, `${label} participant read is hidden`, denied.body);
    assert(JSON.stringify(denied.body) === JSON.stringify({ message: "Not found" }), `${label} gets generic not-found body`);
  }
  const wrongKind = await getJson(
    `/api/admin/requests/${first.type === "item" ? "volunteer" : "item"}/${first.id}/participants`,
    staff.cookieHeader,
  );
  assert(wrongKind.response.status === 404, "request/type mismatch is hidden");

  let activeItem: RequestRow | undefined;
  let activeVolunteer: RequestRow | undefined;
  let pendingForLoading: RequestRow | undefined;
  let archivedForFailure: RequestRow | undefined;
  let disabledHistory: RequestRow | undefined;
  const coveredStatuses = new Set<string>();
  let sawMultiItem = false;
  let sawMultiVolunteer = false;

  for (const row of rows) {
    const result = await getJson(
      `/api/admin/requests/${row.type}/${row.id}/participants`,
      staff.cookieHeader,
    );
    assert(result.response.ok, `${row.type} participant snapshot loads for ${row.status}`);
    const payload = result.body as ParticipantsPayload;
    assert(Array.isArray(payload.participants), "participant response contains a list");
    const shown = participantTotal(row.type, payload.participants);
    assert(shown === payload.counterTotal, "participant lines reconcile with the same-snapshot request counter", {
      requestId: row.id,
      shown,
      counter: payload.counterTotal,
    });
    for (const participant of payload.participants) {
      assert(
        typeof participant.firstName === "string" &&
          typeof participant.lastName === "string" &&
          typeof participant.email === "string" &&
          typeof participant.createdAt === "string" &&
          "phone" in participant &&
          "notes" in participant,
        "participant includes contact, notes, and participation date",
      );
      assert(!("personId" in participant), "participant response omits internal person identifiers");
    }
    if (payload.participants.length > 0) {
      coveredStatuses.add(row.tab);
      if (row.type === "item" && row.tab === "active" && !activeItem) activeItem = row;
      if (row.type === "volunteer" && row.tab === "active" && !activeVolunteer) activeVolunteer = row;
      if (row.tab === "archived" && !archivedForFailure) archivedForFailure = row;
      if (row.type === "item") {
        sawMultiItem ||= payload.participants.some((participant) => (participant.lines?.length ?? 0) > 1);
      } else {
        sawMultiVolunteer ||= payload.participants.some((participant) => (participant.roles?.length ?? 0) > 1);
      }
    }
    if (row.tab === "pending" && !pendingForLoading) pendingForLoading = row;
    if (row.orgStatus === "disabled" && !disabledHistory) disabledHistory = row;
  }

  assert(activeItem !== undefined, "seed covers an active item request with donors");
  assert(activeVolunteer !== undefined, "seed covers an active volunteer request with signups");
  assert(sawMultiItem, "seed covers a donor with multiple item lines");
  assert(sawMultiVolunteer, "seed covers a volunteer with multiple selected roles");
  assert(coveredStatuses.has("pending") && coveredStatuses.has("active") && coveredStatuses.has("archived"), "participant history covers pending, active, and archived requests");
  assert(disabledHistory !== undefined, "disabled-organization request history remains discoverable to staff");
  assert(pendingForLoading !== undefined && archivedForFailure !== undefined, "seed has rows for loading and failure UI checks");

  const publicDetail = await getJson(`/api/public/item-requests/${activeItem.id}`);
  assert(publicDetail.response.ok, "public request detail still loads");
  assert(!("participants" in (publicDetail.body as Record<string, unknown>)), "public response shape does not expose participants");

  const browser = await chromium.launch({
    headless: true,
    executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([staff.browserCookie]);
    const page = await context.newPage();
    await page.goto(`${BASE}/admin/requests`, { waitUntil: "networkidle" });

    await selectRequest(page, activeItem);
    await page.getByRole("heading", { name: "Donations" }).waitFor();
    await page.locator(".adm-participant-table tbody tr").first().waitFor();
    assert((await page.locator(".adm-participant-summary").innerText()).includes("request counter:"), "item UI shows counter reconciliation");

    await selectRequest(page, activeVolunteer);
    await page.getByRole("heading", { name: "Volunteer signups" }).waitFor();
    await page.locator(".adm-participant-table tbody tr").first().waitFor();
    assert((await page.locator(".adm-participant-summary").innerText()).includes("interested"), "volunteer UI shows counter reconciliation");

    await selectRequest(page, disabledHistory);
    await page.getByText(/No (donations|volunteer signups) have been recorded for this request\./).waitFor();
    assert(true, "disabled-organization history renders an explicit empty participant state");

    const loadingPath = `/api/admin/requests/${pendingForLoading.type}/${pendingForLoading.id}/participants`;
    await page.route(`**${loadingPath}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await selectRequest(page, pendingForLoading);
    await page.getByText("Loading participants…", { exact: true }).waitFor();
    assert(true, "participant section renders an independent loading state");
    await page.unroute(`**${loadingPath}`);

    const failurePath = `/api/admin/requests/${archivedForFailure.type}/${archivedForFailure.id}/participants`;
    await page.route(`**${failurePath}`, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "fixture failure" }) }),
    );
    await selectRequest(page, archivedForFailure);
    await page.getByText("Participants could not be loaded. Please refresh the page and try again.", { exact: true }).waitFor();
    assert(true, "participant failure renders an error instead of an empty list");
    await context.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} participant checks passed.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});