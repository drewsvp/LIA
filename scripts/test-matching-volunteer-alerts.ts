/**
 * End-to-end regression checks for immediate matching-volunteer alerts.
 *
 * Requires the request-category relationship delivered by the volunteer-need
 * classification feature. All rows are zz_fixture-marked and removed on exit.
 *
 * Usage: NODE_ENV=development npx tsx scripts/test-matching-volunteer-alerts.ts
 */
import { auth } from "../server/auth/auth";
import * as dal from "../server/dal";
import { pool, q, SYSTEM, withDbContext } from "../server/db/client";
import { approveRequest } from "../server/services/request-approval";
import { ResendBlockedError, resendEmail } from "../server/services/email-resend";
import { unapproveRequestForCorrection } from "../server/services/staff-request-edit";

const BASE = "http://localhost:5000";
const runId = `${process.pid}-${Date.now()}`;
const fixtureEmail = (label: string) => `zz.fixture.matching-alert.${label}.${runId}@example.org`;
const fixtureRequestIds: string[] = [];
const fixtureUserIds: string[] = [];
const fixturePersonIds: string[] = [];
const fixtureCategoryIds: string[] = [];
let fixtureOrgId: string | null = null;
let unapprovedOrgId: string | null = null;
let originalTemplateOverride:
  | {
      subject: string | null;
      heading: string | null;
      paragraphs: unknown;
      recipients: string | null;
      enabled: boolean;
      updatedBy: string | null;
    }
  | null = null;

type FixtureSupporter = {
  userId: string;
  personId: string;
  email: string;
  firstName: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function cookieHeader(response: Response): string {
  const headers = response.headers as unknown as {
    getSetCookie?: () => string[];
    get: (name: string) => string | null;
  };
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function mintSessionCookie(email: string, label: string): Promise<string> {
  const token = `zz-matching-alert-${runId}-${label}`;
  await pool.query(
    `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
    [token, JSON.stringify({ email })],
  );
  type MagicLinkApi = {
    magicLinkVerify(input: {
      query: { token: string; callbackURL: string };
      headers: Headers;
      asResponse: true;
    }): Promise<Response>;
  };
  let response: Response;
  try {
    response = await (auth.api as unknown as MagicLinkApi).magicLinkVerify({
      query: { token, callbackURL: "/profile" },
      headers: new Headers(),
      asResponse: true,
    });
  } finally {
    await pool.query(`delete from verification where identifier = $1`, [token]);
  }
  assert(response.ok || response.status === 302, `${label} session mint succeeds`);
  const cookie = cookieHeader(response);
  assert(cookie !== "", `${label} session cookie is present`);
  return cookie;
}

async function request(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Status assertions still provide a useful failure.
  }
  return { response, body };
}

async function createSupporter(
  label: string,
  options: { status?: "active" | "disabled"; kind?: "supporter" | "member" } = {},
): Promise<FixtureSupporter> {
  const firstName = `zz_fixture_${label}`;
  const email = fixtureEmail(label);
  const person = await dal.people.create(SYSTEM, {
    firstName,
    lastName: "Matching Alert",
    email,
    sourceNote: "zz_fixture matching volunteer alert regression",
  });
  const user = await dal.users.create(SYSTEM, {
    personId: person.id,
    status: options.status ?? "active",
    kind: options.kind ?? "supporter",
  });
  fixturePersonIds.push(person.id);
  fixtureUserIds.push(user.id);
  return { userId: user.id, personId: person.id, email, firstName };
}

async function setPreferences(
  supporter: FixtureSupporter,
  categoryIds: string[],
  enabled: boolean,
): Promise<void> {
  await dal.volunteerInterests.replaceForPerson(SYSTEM, supporter.personId, categoryIds);
  if (enabled) {
    await dal.volunteerAlerts.saveSupporterPreferences(SYSTEM, {
      userId: supporter.userId,
      personId: supporter.personId,
      categoryIds,
      matchingAlertsEnabled: true,
    });
  }
}

async function createRequest(
  label: string,
  categoryIds: string[],
  options: {
    status?: "pending" | "active" | "archived";
    expiresOn?: string | null;
    orgId?: string;
    title?: string;
  } = {},
): Promise<string> {
  if (!fixtureOrgId) throw new Error("fixture org not initialized");
  return withDbContext(SYSTEM, async (client) => {
    const requestRows = await q<{ id: string }>(
      client,
      `insert into volunteer_requests
         (org_id, title, description, details, event_location, deadline_type, expires_on,
          status, submitted_at, approved_at, archived_at, archived_reason)
       values
         ($1, $2, 'zz_fixture matching alert description', 'zz_fixture matching alert details',
          'zz_fixture location', 'ongoing', $3, $4, now(),
          case when $4 = 'active' then now() else null end,
          case when $4 = 'archived' then now() else null end,
          case when $4 = 'archived' then 'manual' else null end)
       returning id`,
      [
        options.orgId ?? fixtureOrgId,
        options.title ?? `zz_fixture Matching Opportunity ${label} ${runId}`,
        options.expiresOn ?? null,
        options.status ?? "pending",
      ],
    );
    const requestId = requestRows[0]!.id;
    fixtureRequestIds.push(requestId);
    await client.query(
      `insert into volunteer_roles
         (volunteer_request_id, name, description, quantity_needed, sort_order)
       values ($1, 'zz_fixture Volunteer Role', 'zz_fixture role details', 2, 0)`,
      [requestId],
    );
    for (const categoryId of categoryIds) {
      await client.query(
        `insert into volunteer_request_categories (volunteer_request_id, category_id)
         values ($1, $2)`,
        [requestId, categoryId],
      );
    }
    return requestId;
  });
}

async function matchingLogRows(requestId: string) {
  return withDbContext(SYSTEM, (client) =>
    q<{
      id: string;
      status: string;
      toEmail: string;
      toPersonId: string | null;
      payload: { vars?: Record<string, unknown> };
      error: string | null;
    }>(
      client,
      `select id, status, to_email as "toEmail", to_person_id as "toPersonId", payload, error
         from email_log
        where template_key = 'supporter_volunteer_match' and entity_id = $1
        order by created_at, id`,
      [requestId],
    ),
  );
}

async function setup(): Promise<{
  staffUserId: string;
  categoryA: string;
  categoryB: string;
  inactiveCategory: string;
}> {
  const categoryTable = await pool.query<{ tableName: string | null }>(
    `select to_regclass('public.volunteer_request_categories')::text as "tableName"`,
  );
  assert(
    categoryTable.rows[0]?.tableName === "volunteer_request_categories",
    "volunteer-request category assignments are installed",
  );

  const staff = await pool.query<{ id: string }>(
    `select u.id
       from users u join people p on p.id = u.person_id
      where lower(p.email) = 'tiffany@defendingthecause.org'
      limit 1`,
  );
  const staffUserId = staff.rows[0]?.id;
  if (!staffUserId) throw new Error("Seeded staff admin is required.");

  const org = await dal.organizations.create(SYSTEM, {
    name: `zz_fixture Matching Alert Org ${runId}`,
    slug: `zz-fixture-matching-alert-${runId}`,
    kind: "member_org",
  });
  fixtureOrgId = org.id;
  const pendingOrg = await dal.organizations.create(SYSTEM, {
    name: `zz_fixture Unapproved Matching Alert Org ${runId}`,
    slug: `zz-fixture-unapproved-matching-alert-${runId}`,
    kind: "member_org",
  });
  unapprovedOrgId = pendingOrg.id;
  await withDbContext(SYSTEM, (client) =>
    client.query(`update organizations set status = 'approved' where id = $1`, [org.id]),
  );

  const names = ["Alpha", "Bravo", "Inactive"];
  for (const name of names) {
    const rows = await withDbContext(SYSTEM, (client) =>
      q<{ id: string }>(
        client,
        `insert into volunteer_categories (name, is_active)
         values ($1, $2) returning id`,
        [`zz_fixture ${name} Matching ${runId}`, name !== "Inactive"],
      ),
    );
    fixtureCategoryIds.push(rows[0]!.id);
  }
  originalTemplateOverride = await withDbContext(SYSTEM, async (client) => {
    const rows = await q<NonNullable<typeof originalTemplateOverride>>(
      client,
      `select subject, heading, paragraphs, recipients, enabled, updated_by as "updatedBy"
         from email_template_overrides
        where template_key = 'supporter_volunteer_match'`,
    );
    return rows[0] ?? null;
  });
  return {
    staffUserId,
    categoryA: fixtureCategoryIds[0]!,
    categoryB: fixtureCategoryIds[1]!,
    inactiveCategory: fixtureCategoryIds[2]!,
  };
}

async function testConsentAndAdmin(
  categoryA: string,
): Promise<void> {
  console.log("\nConsent, profile, unsubscribe, and admin controls");
  const supporter = await createSupporter("profile");
  const cookie = await mintSessionCookie(supporter.email, "supporter");
  const initial = await request("/api/supporter/profile", { cookie });
  assert(initial.response.status === 200, "supporter profile loads");
  assert(initial.body.matchingVolunteerAlertsEnabled === false, "matching alerts default to off without a preference row");
  assert(initial.body.matchingVolunteerAlertsEligible === true, "active supporter profile is eligible to opt in");

  const enabled = await request("/api/supporter/profile/volunteer-interests", {
    method: "PUT",
    cookie,
    body: { categoryIds: [categoryA], matchingVolunteerAlertsEnabled: true },
  });
  assert(enabled.response.status === 200, "supporter can explicitly opt in while saving interests");
  assert(enabled.body.matchingVolunteerAlertsEnabled === true, "saved API response confirms alerts are on");
  const preference = await dal.volunteerAlerts.getForUser(SYSTEM, supporter.userId);
  assert(preference.enabled, "explicit opt-in is durable");
  const preferenceRows = await withDbContext(SYSTEM, (client) =>
    q<{ unsubscribeToken: string }>(
      client,
      `select unsubscribe_token as "unsubscribeToken"
         from volunteer_alert_preferences where user_id = $1`,
      [supporter.userId],
    ),
  );
  const unsubscribeToken = preferenceRows[0]?.unsubscribeToken;
  if (!unsubscribeToken) throw new Error("Opted-in preference has no unsubscribe token.");

  const invalid = await request("/api/public/volunteer-alerts/unsubscribe", {
    method: "POST",
    body: { token: "not-a-token" },
  });
  assert(invalid.response.status === 200 && invalid.body.ok === false, "invalid opt-out capabilities expose no account data");
  const disabled = await request("/api/public/volunteer-alerts/unsubscribe", {
    method: "POST",
    body: { token: unsubscribeToken },
  });
  assert(disabled.response.status === 200 && disabled.body.ok === true, "email opt-out capability disables future alerts");
  const afterOptOut = await dal.volunteerAlerts.getForUser(SYSTEM, supporter.userId);
  assert(!afterOptOut.enabled, "token opt-out persists");

  const staffCookie = await mintSessionCookie("tiffany@defendingthecause.org", "staff admin");
  const templatesResponse = await request("/api/admin/email-templates", { cookie: staffCookie });
  const templates = templatesResponse.body.templates as Array<{ key: string; name: string; enabled: boolean }>;
  const template = templates.find((candidate) => candidate.key === "supporter_volunteer_match");
  assert(templatesResponse.response.status === 200 && Boolean(template), "matching alert appears in Automated Emails");
  assert(template?.name === "Matching volunteer opportunity, supporter", "Automated Emails uses a readable template name");
}

async function testMatchingAndEligibility(input: {
  staffUserId: string;
  categoryA: string;
  categoryB: string;
  inactiveCategory: string;
}): Promise<{ matchingSupporter: FixtureSupporter; firstRequestId: string }> {
  console.log("\nRecipient matching and approval fan-out");
  const matchingSupporter = await createSupporter("matching");
  const disabledSupporter = await createSupporter("disabled");
  const memberUser = await createSupporter("member", { kind: "member" });
  const optedOut = await createSupporter("opted-out");
  const inactiveInterest = await createSupporter("inactive-interest");
  await setPreferences(matchingSupporter, [input.categoryA, input.categoryB], true);
  await setPreferences(disabledSupporter, [input.categoryA], true);
  await withDbContext(SYSTEM, (client) =>
    client.query(`update users set status = 'disabled' where id = $1`, [disabledSupporter.userId]),
  );
  await dal.volunteerInterests.replaceForPerson(SYSTEM, memberUser.personId, [input.categoryA]);
  await withDbContext(SYSTEM, (client) =>
    client.query(
      `insert into volunteer_alert_preferences (user_id, enabled) values ($1, true)`,
      [memberUser.userId],
    ),
  );
  await dal.volunteerInterests.replaceForPerson(SYSTEM, optedOut.personId, [input.categoryA]);
  await withDbContext(SYSTEM, async (client) => {
    await client.query(
      `insert into person_volunteer_interests (person_id, category_id) values ($1, $2)`,
      [inactiveInterest.personId, input.inactiveCategory],
    );
    await client.query(
      `insert into volunteer_alert_preferences
         (user_id, enabled, enabled_at, disabled_at)
       values ($1, true, now(), null)`,
      [inactiveInterest.userId],
    );
  });

  const requestId = await createRequest("multi-match", [input.categoryB, input.categoryA]);
  const result = await approveRequest({
    kind: "volunteer",
    requestId,
    staffUserId: input.staffUserId,
  });
  assert(result.matchingVolunteerAlerts.length === 1, "overlapping categories still produce one recipient alert");
  const alert = result.matchingVolunteerAlerts[0];
  assert(alert?.outcome === "queued", "eligible supporter alert is durably queued before dispatch");
  if (alert?.outcome !== "queued") throw new Error("Expected queued matching alert.");
  assert(alert.toEmail === matchingSupporter.email, "disabled, opted-out, member, and nonmatching accounts are excluded");
  assert(
    alert.dispatch.html.includes(`/volunteer/${requestId}`) &&
      alert.dispatch.html.includes("/volunteer-alerts/unsubscribe/"),
    "rendered alert contains the direct opportunity and opt-out links",
  );
  assert(
    alert.dispatch.text?.includes(`zz_fixture Alpha Matching ${runId}`) &&
      alert.dispatch.text.includes(`zz_fixture Bravo Matching ${runId}`),
    "rendered alert identifies every matching category",
  );
  const rows = await matchingLogRows(requestId);
  assert(rows.length === 1 && rows[0]?.status === "queued", "one readable email-log row is queued for the supporter");
  const claims = await withDbContext(SYSTEM, (client) =>
    q<{ count: number }>(
      client,
      `select count(*)::int as count from volunteer_match_alert_claims where volunteer_request_id = $1`,
      [requestId],
    ),
  );
  assert(claims[0]?.count === 1, "the once-only claim commits with the queued email row");

  const expired = await createRequest("expired", [input.categoryA], {
    status: "active",
    expiresOn: "2000-01-01",
  });
  const archived = await createRequest("archived", [input.categoryA], { status: "archived" });
  const noCategory = await createRequest("no-category", [], { status: "active" });
  const inactiveAssignment = await createRequest("inactive-assignment", [input.inactiveCategory], { status: "active" });
  const unapprovedOrg = await createRequest("unapproved-org", [input.categoryA], {
    status: "active",
    orgId: unapprovedOrgId!,
  });
  for (const [label, ineligibleRequestId] of [
    ["expired", expired],
    ["archived", archived],
    ["uncategorized", noCategory],
    ["inactive-category", inactiveAssignment],
    ["unapproved-organization", unapprovedOrg],
  ] as const) {
    const recipients = await dal.volunteerAlerts.listMatchingRecipients(SYSTEM, ineligibleRequestId);
    assert(recipients.length === 0, `${label} opportunities produce no matching recipients`);
  }
  return { matchingSupporter, firstRequestId: requestId };
}

async function testOnceOnlyAndFailures(input: {
  staffUserId: string;
  categoryA: string;
  categoryB: string;
  matchingSupporter: FixtureSupporter;
  firstRequestId: string;
}): Promise<void> {
  console.log("\nOnce-only, concurrency, disabled-template, and failure behavior");
  await unapproveRequestForCorrection({
    kind: "volunteer",
    requestId: input.firstRequestId,
    staffUserId: input.staffUserId,
  });
  const reapproval = await approveRequest({
    kind: "volunteer",
    requestId: input.firstRequestId,
    staffUserId: input.staffUserId,
  });
  assert(
    reapproval.matchingVolunteerAlerts.some((alert) => alert.outcome === "already_claimed"),
    "reapproval cannot fan out a second matching alert",
  );
  assert((await matchingLogRows(input.firstRequestId)).length === 1, "reapproval leaves the original alert row alone");

  await withDbContext(SYSTEM, (client) =>
    client.query(`delete from volunteer_request_categories where volunteer_request_id = $1 and category_id = $2`, [
      input.firstRequestId,
      input.categoryA,
    ]),
  );
  await withDbContext(SYSTEM, (client) =>
    client.query(`update volunteer_requests set title = title || ' edited' where id = $1`, [input.firstRequestId]),
  );
  await dal.volunteerRequests.archive(SYSTEM, input.firstRequestId, "manual", input.staffUserId);
  await dal.volunteerRequests.reinstate(SYSTEM, input.firstRequestId, input.staffUserId);
  assert(
    (await matchingLogRows(input.firstRequestId)).length === 1,
    "ordinary edits, category changes, archive, and reinstatement do not re-alert",
  );

  const concurrentRequest = await createRequest("concurrent", [input.categoryA]);
  const concurrent = await Promise.allSettled([
    approveRequest({ kind: "volunteer", requestId: concurrentRequest, staffUserId: input.staffUserId }),
    approveRequest({ kind: "volunteer", requestId: concurrentRequest, staffUserId: input.staffUserId }),
  ]);
  assert(concurrent.filter((outcome) => outcome.status === "fulfilled").length === 1, "only one concurrent approval wins");
  assert((await matchingLogRows(concurrentRequest)).length === 1, "concurrent approvals create one alert row");

  await dal.emailTemplateOverrides.setEnabled(SYSTEM, "supporter_volunteer_match", {
    enabled: false,
    updatedByUserId: input.staffUserId,
  });
  const disabledTemplateRequest = await createRequest("template-disabled", [input.categoryA]);
  const disabledResult = await approveRequest({
    kind: "volunteer",
    requestId: disabledTemplateRequest,
    staffUserId: input.staffUserId,
  });
  assert(
    disabledResult.matchingVolunteerAlerts.some((alert) => alert.outcome === "skipped_disabled"),
    "disabled matching template creates an explicit skipped outcome",
  );
  const disabledRows = await matchingLogRows(disabledTemplateRequest);
  assert(disabledRows.length === 1 && disabledRows[0]?.status === "skipped", "disabled template skip is visible in Email log");
  await dal.emailTemplateOverrides.setEnabled(SYSTEM, "supporter_volunteer_match", {
    enabled: true,
    updatedByUserId: input.staffUserId,
  });
  await unapproveRequestForCorrection({
    kind: "volunteer",
    requestId: disabledTemplateRequest,
    staffUserId: input.staffUserId,
  });
  const retryAfterEnable = await approveRequest({
    kind: "volunteer",
    requestId: disabledTemplateRequest,
    staffUserId: input.staffUserId,
  });
  assert(
    retryAfterEnable.matchingVolunteerAlerts.some((alert) => alert.outcome === "already_claimed") &&
      (await matchingLogRows(disabledTemplateRequest)).length === 1,
    "a disabled first-approval alert remains once-only after the template is re-enabled",
  );

  const renderFailureSupporter = await createSupporter("blank-first-name");
  await setPreferences(renderFailureSupporter, [input.categoryA], true);
  await withDbContext(SYSTEM, (client) =>
    client.query(`update people set first_name = '' where id = $1`, [renderFailureSupporter.personId]),
  );
  const failureRequest = await createRequest("render-failure", [input.categoryA]);
  const failureResult = await approveRequest({
    kind: "volunteer",
    requestId: failureRequest,
    staffUserId: input.staffUserId,
  });
  assert(
    failureResult.matchingVolunteerAlerts.some(
      (alert) => alert.outcome === "blocked" && alert.toEmail === renderFailureSupporter.email,
    ),
    "an unrenderable matching alert is reported without undoing approval",
  );
  const failedRows = await matchingLogRows(failureRequest);
  assert(
    failedRows.some((row) => row.toEmail === renderFailureSupporter.email && row.status === "failed" && Boolean(row.error)),
    "render failure is visible with a readable Email log error",
  );
  const supporterFailure = failedRows.find(
    (row) => row.toEmail === renderFailureSupporter.email && row.status === "failed",
  );
  if (!supporterFailure) throw new Error("Expected matching-alert render failure row.");
  await withDbContext(SYSTEM, (client) =>
    client.query(`update people set first_name = 'Corrected' where id = $1`, [renderFailureSupporter.personId]),
  );
  await dal.emailTemplateOverrides.setEnabled(SYSTEM, "supporter_volunteer_match", {
    enabled: false,
    updatedByUserId: input.staffUserId,
  });
  const eligibleResend = await resendEmail(SYSTEM, supporterFailure.id);
  assert(
    eligibleResend.outcome === "failed" && eligibleResend.error.includes("disabled"),
    "failed alert resend rebuilds current eligible data before honoring the disabled template",
  );
  await dal.volunteerAlerts.saveSupporterPreferences(SYSTEM, {
    userId: renderFailureSupporter.userId,
    personId: renderFailureSupporter.personId,
    categoryIds: [input.categoryA],
    matchingAlertsEnabled: false,
  });
  let optedOutResendBlocked = false;
  try {
    await resendEmail(SYSTEM, supporterFailure.id);
  } catch (err) {
    optedOutResendBlocked = err instanceof ResendBlockedError && err.message.includes("no longer eligible");
  }
  assert(optedOutResendBlocked, "failed matching alert cannot be resent after the supporter opts out");
  await dal.emailTemplateOverrides.setEnabled(SYSTEM, "supporter_volunteer_match", {
    enabled: true,
    updatedByUserId: input.staffUserId,
  });
}

async function cleanup(): Promise<void> {
  try {
    await withDbContext(SYSTEM, async (client) => {
      if (fixtureRequestIds.length > 0) {
        await client.query(
          `delete from email_log
            where template_key = 'supporter_volunteer_match' and entity_id = any($1::uuid[])`,
          [fixtureRequestIds],
        );
        await client.query(
          `delete from approval_events
            where entity_type = 'volunteer_request' and entity_id = any($1::uuid[])`,
          [fixtureRequestIds],
        );
        await client.query(`delete from volunteer_requests where id = any($1::uuid[])`, [fixtureRequestIds]);
      }
      if (originalTemplateOverride) {
        await client.query(
          `insert into email_template_overrides
             (template_key, subject, heading, paragraphs, recipients, enabled, updated_by)
           values ('supporter_volunteer_match', $1, $2, $3, $4, $5, $6)
           on conflict (template_key) do update
             set subject = excluded.subject, heading = excluded.heading,
                 paragraphs = excluded.paragraphs, recipients = excluded.recipients,
                 enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`,
          [
            originalTemplateOverride.subject,
            originalTemplateOverride.heading,
            originalTemplateOverride.paragraphs,
            originalTemplateOverride.recipients,
            originalTemplateOverride.enabled,
            originalTemplateOverride.updatedBy,
          ],
        );
      } else {
        await client.query(
          `delete from email_template_overrides where template_key = 'supporter_volunteer_match'`,
        );
      }
      if (fixtureUserIds.length > 0) {
        await client.query(`delete from users where id = any($1::uuid[])`, [fixtureUserIds]);
      }
      if (fixturePersonIds.length > 0) {
        await client.query(`delete from people where id = any($1::uuid[])`, [fixturePersonIds]);
      }
      if (fixtureCategoryIds.length > 0) {
        await client.query(`delete from volunteer_categories where id = any($1::uuid[])`, [fixtureCategoryIds]);
      }
      if (fixtureOrgId || unapprovedOrgId) {
        await client.query(`delete from organizations where id = any($1::uuid[])`, [
          [fixtureOrgId, unapprovedOrgId].filter(Boolean),
        ]);
      }
    });
    await pool.query(
      `delete from "session"
        where "userId" in (
          select id from "user" where email like $1
        )`,
      [`zz.fixture.matching-alert.%${runId}@example.org`],
    );
    await pool.query(
      `delete from account
        where "userId" in (
          select id from "user" where email like $1
        )`,
      [`zz.fixture.matching-alert.%${runId}@example.org`],
    );
    await pool.query(`delete from "user" where email like $1`, [`zz.fixture.matching-alert.%${runId}@example.org`]);
  } catch (err) {
    console.error("Fixture cleanup failed:", err);
  }
}

async function main(): Promise<void> {
  console.log("Matching volunteer alert regression test");
  try {
    const setupData = await setup();
    await testConsentAndAdmin(setupData.categoryA);
    const matching = await testMatchingAndEligibility(setupData);
    await testOnceOnlyAndFailures({ ...setupData, ...matching });
    console.log("\nAll matching-volunteer alert checks passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFAIL:", err);
  process.exit(1);
});