/**
 * End-to-end privacy, revalidation, preference, export, and audit regression
 * coverage for staff request-viewer outreach.
 *
 * Requires the development workflow and seeded quick-login staff accounts.
 */
import { randomUUID } from "node:crypto";
import { pool, SYSTEM } from "../server/db/client";
import * as dal from "../server/dal";
import { MAY_HAVE_SENT_MARKER } from "../server/email/send";

const BASE = "http://127.0.0.1:5000";
const marker = `zz_fixture_outreach_${process.pid}`;
const testStartedAt = new Date().toISOString();
const eventIds: string[] = [];
const approvalEventIds: string[] = [];
const emailLogIds: string[] = [];
let personId: string | null = null;
let userId: string | null = null;
let pledgeId: string | null = null;
let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`, detail ?? "");
  }
}

function responseCookies(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function quickLogin(role: "staff_admin" | "staff_approver"): Promise<string> {
  const response = await fetch(`${BASE}/api/login/quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error(`quick login ${role} failed: ${response.status} ${await response.text()}`);
  return responseCookies(response);
}

type OutreachBody = {
  action: "email" | "export";
  requestKind: "item" | "volunteer";
  requestId: string;
  userIds: string[];
  subject?: string;
  message?: string;
};

async function post(path: string, cookie: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

async function createView(requestKind: "item" | "volunteer", requestId: string, attributedUserId: string | null): Promise<void> {
  const clientEventId = randomUUID();
  eventIds.push(clientEventId);
  const result = await dal.requestEngagement.recordPublicEvent(SYSTEM, {
    clientEventId,
    eventType: "detail_view",
    requestKind,
    requestId,
    targetId: null,
    userId: attributedUserId,
  });
  assert(result === "recorded", `${attributedUserId ? "signed-in" : "anonymous"} ${requestKind} view fixture records`, result);
}

async function main(): Promise<void> {
  const [adminCookie, approverCookie] = await Promise.all([
    quickLogin("staff_admin"),
    quickLogin("staff_approver"),
  ]);
  const adminSessionResponse = await fetch(`${BASE}/api/session`, { headers: { Cookie: adminCookie } });
  const adminSession = (await adminSessionResponse.json()) as { user: { id: string } };

  const person = await dal.people.create(SYSTEM, {
    firstName: "\t=1+1",
    lastName: "Supporter",
    email: `${marker}@example.test`,
    sourceNote: marker,
  });
  personId = person.id;
  const user = await dal.users.create(SYSTEM, { personId: person.id, status: "active", kind: "supporter" });
  userId = user.id;

  const itemRows = await pool.query<{ id: string }>(
    `select r.id
       from item_requests r
       join organizations o on o.id = r.org_id
      where r.status = 'active'
        and o.kind = 'member_org'
        and o.status = 'approved'
        and not item_request_expired_on(
          r.deadline_type, r.deadline_date, r.expires_on,
          item_request_current_la_date()
        )
      order by r.created_at
      limit 2`,
  );
  const volunteerRows = await pool.query<{ id: string }>(
    `select r.id
       from volunteer_requests r
       join organizations o on o.id = r.org_id
      where r.status = 'active'
        and o.kind = 'member_org'
        and o.status = 'approved'
        and not (
          (r.expires_on is not null and r.expires_on < item_request_current_la_date())
          or (
            r.deadline_type = 'date_specific'
            and r.deadline_date is not null
            and r.deadline_date < item_request_current_la_date()
          )
        )
      order by r.created_at
      limit 1`,
  );
  const itemRequestId = itemRows.rows[0]?.id;
  const secondItemRequestId = itemRows.rows[1]?.id;
  const volunteerRequestId = volunteerRows.rows[0]?.id;
  if (!itemRequestId || !secondItemRequestId || !volunteerRequestId) {
    throw new Error("test needs two active public item requests and one active public volunteer request");
  }

  await createView("item", itemRequestId, user.id);
  await createView("item", itemRequestId, null);
  const audienceResponse = await fetch(`${BASE}/api/admin/analytics/audience?pageSize=100`, {
    headers: { Cookie: adminCookie },
  });
  const audience = (await audienceResponse.json()) as {
    rows: Array<{ userId: string; requestId: string }>;
  };
  assert(
    audienceResponse.status === 200 &&
      audience.rows.some((row) => row.userId === user.id && row.requestId === itemRequestId),
    "active supporter appears in the selectable audience",
    audience,
  );
  const itemBody: OutreachBody = {
    action: "export",
    requestKind: "item",
    requestId: itemRequestId,
    userIds: [user.id, randomUUID()],
  };

  const forbidden = await post("/api/admin/analytics/outreach/preview", approverCookie, itemBody);
  assert(forbidden.status === 404, "staff approvers cannot discover outreach controls", forbidden.status);

  const previewResponse = await post("/api/admin/analytics/outreach/preview", adminCookie, itemBody);
  const preview = (await previewResponse.json()) as {
    eligibleCount: number;
    ineligibleCount: number;
    recipients: Array<Record<string, unknown>>;
    confirmationToken: string;
  };
  assert(previewResponse.status === 200, "staff admin can preview an export", previewResponse.status);
  assert(
    preview.eligibleCount === 1 && preview.ineligibleCount === 1 && preview.recipients.length === 1,
    "only the selected attributed supporter view is eligible",
    preview,
  );
  assert(
    !("personId" in (preview.recipients[0] ?? {})),
    "preview omits internal person ids",
    preview.recipients[0],
  );
  assert(typeof preview.confirmationToken === "string", "preview returns a signed confirmation");
  const emailPreviewResponse = await post("/api/admin/analytics/outreach/preview", adminCookie, {
    ...itemBody,
    action: "email",
    userIds: [user.id],
    subject: "Request follow-up",
    message: "This must not dispatch after conversion.",
  });
  const emailPreview = (await emailPreviewResponse.json()) as {
    confirmationToken: string;
    eligibleCount: number;
  };
  assert(
    emailPreviewResponse.status === 200 &&
      emailPreview.eligibleCount === 1 &&
      typeof emailPreview.confirmationToken === "string",
    "email preview returns its own immutable confirmation",
    emailPreview,
  );
  const tamperedToken = `${emailPreview.confirmationToken.slice(0, -1)}${
    emailPreview.confirmationToken.endsWith("a") ? "b" : "a"
  }`;
  const tampered = await post("/api/admin/analytics/outreach/send", adminCookie, {
    confirmationToken: tamperedToken,
  });
  assert(tampered.status === 400, "a modified preview confirmation cannot trigger outreach", tampered.status);

  const pledge = await pool.query<{ id: string }>(
    `insert into item_pledges (legacy_wix_id, person_id, item_request_id, notes)
     values ($1, $2, $3, 'request outreach regression fixture')
     returning id`,
    [marker, person.id, itemRequestId],
  );
  pledgeId = pledge.rows[0]!.id;
  const staleExport = await post("/api/admin/analytics/outreach/export", adminCookie, {
    confirmationToken: preview.confirmationToken,
  });
  const staleBody = (await staleExport.json()) as { message?: string };
  assert(
    staleExport.status === 409 && staleBody.message?.includes("Nothing was exported"),
    "export rechecks conversion after preview and refuses stale eligibility",
    { status: staleExport.status, body: staleBody },
  );
  const staleSend = await post("/api/admin/analytics/outreach/send", adminCookie, {
    confirmationToken: emailPreview.confirmationToken,
  });
  const staleSendBody = (await staleSend.json()) as { message?: string };
  assert(
    staleSend.status === 409 && staleSendBody.message?.includes("Nothing was sent"),
    "send rechecks conversion immediately before dispatch",
    { status: staleSend.status, body: staleSendBody },
  );
  await pool.query(`delete from item_pledges where id = $1`, [pledgeId]);
  pledgeId = null;

  const exportResponse = await post("/api/admin/analytics/outreach/export", adminCookie, {
    confirmationToken: preview.confirmationToken,
    // These untrusted extras are ignored; the signed preview is authoritative.
    userIds: [randomUUID()],
  });
  const csv = await exportResponse.text();
  assert(
    exportResponse.status === 200 &&
      exportResponse.headers.get("content-type")?.startsWith("text/csv") &&
      csv.includes(person.email) &&
      csv.includes("\"'\t=1+1\"") &&
      !csv.includes("anonymous"),
    "confirmed export returns only the eligible supporter and neutralizes CSV formulas",
    { status: exportResponse.status, csv },
  );
  const auditRows = await pool.query<{ id: string; actor_user_id: string; note: string }>(
    `select id, actor_user_id, note
       from approval_events
      where entity_type = 'item_request'
        and entity_id = $1
        and actor_user_id = $2
        and note = 'Staff exported 1 eligible signed-in viewer(s) for outreach.'
      order by created_at desc
      limit 1`,
    [itemRequestId, adminSession.user.id],
  );
  if (auditRows.rows[0]) approvalEventIds.push(auditRows.rows[0].id);
  assert(
    auditRows.rows[0]?.actor_user_id === adminSession.user.id,
    "export audit records the acting staff user",
    auditRows.rows[0],
  );

  const prior = await dal.emailLog.insertQueued(SYSTEM, {
    templateKey: "staff_request_viewer_follow_up",
    toEmail: person.email,
    toPersonId: person.id,
    entityType: "item_request",
    entityId: itemRequestId,
    payload: { zz_fixture: marker },
  });
  if (prior.duplicate) throw new Error("outreach test unexpectedly collided with an existing email attempt");
  emailLogIds.push(prior.entry.id);
  await dal.emailLog.markFailed(
    SYSTEM,
    prior.entry.id,
    `fixture timeout; ${MAY_HAVE_SENT_MARKER}`,
    "provider_timeout",
  );
  await pool.query(`update people set email = $2 where id = $1`, [
    person.id,
    `${marker}.changed@example.test`,
  ]);
  const uncertainResponse = await post("/api/admin/analytics/outreach/send", adminCookie, {
    confirmationToken: emailPreview.confirmationToken,
  });
  const uncertainBody = (await uncertainResponse.json()) as { sent: number; uncertain: number; message?: string };
  assert(
    uncertainResponse.status === 200 &&
      uncertainBody.sent === 0 &&
      uncertainBody.uncertain === 1 &&
      uncertainBody.message?.includes("may have sent"),
    "an unknown prior provider outcome is never retried",
    uncertainBody,
  );
  await dal.emailLog.markSent(SYSTEM, prior.entry.id, `zz_fixture_provider_${process.pid}`);
  await pool.query(`update people set email = $2 where id = $1`, [
    person.id,
    `${marker}.changed-again@example.test`,
  ]);
  const changedEmailResponse = await post("/api/admin/analytics/outreach/send", adminCookie, {
    confirmationToken: emailPreview.confirmationToken,
  });
  const changedEmailBody = (await changedEmailResponse.json()) as {
    sent: number;
    alreadyAttempted: number;
  };
  assert(
    changedEmailResponse.status === 200 &&
      changedEmailBody.sent === 0 &&
      changedEmailBody.alreadyAttempted === 1,
    "a prior request follow-up remains once-only after the supporter email changes",
    changedEmailBody,
  );
  await createView("item", secondItemRequestId, user.id);
  const providerFailurePreviewResponse = await post("/api/admin/analytics/outreach/preview", adminCookie, {
    action: "email",
    requestKind: "item",
    requestId: secondItemRequestId,
    userIds: [user.id],
    subject: "Second request follow-up",
    message: "A provider-phase failure must consume the once-only slot.",
  });
  const providerFailurePreview = (await providerFailurePreviewResponse.json()) as {
    confirmationToken: string;
    eligibleCount: number;
  };
  assert(
    providerFailurePreviewResponse.status === 200 &&
      providerFailurePreview.eligibleCount === 1 &&
      typeof providerFailurePreview.confirmationToken === "string",
    "a second request can be reviewed independently",
    providerFailurePreview,
  );
  const providerFailed = await dal.emailLog.insertQueued(SYSTEM, {
    templateKey: "staff_request_viewer_follow_up",
    toEmail: `${marker}.old-provider-address@example.test`,
    toPersonId: person.id,
    entityType: "item_request",
    entityId: secondItemRequestId,
    payload: { zz_fixture: marker },
  });
  if (providerFailed.duplicate) throw new Error("provider-failure fixture unexpectedly collided");
  emailLogIds.push(providerFailed.entry.id);
  await dal.emailLog.markFailed(
    SYSTEM,
    providerFailed.entry.id,
    "fixture provider exception after dispatch began",
    "provider",
  );
  const providerFailureSend = await post("/api/admin/analytics/outreach/send", adminCookie, {
    confirmationToken: providerFailurePreview.confirmationToken,
  });
  const providerFailureBody = (await providerFailureSend.json()) as {
    sent: number;
    alreadyAttempted: number;
  };
  assert(
    providerFailureSend.status === 200 &&
      providerFailureBody.sent === 0 &&
      providerFailureBody.alreadyAttempted === 1,
    "a non-timeout provider failure cannot trigger a second dispatch",
    providerFailureBody,
  );
  const sendAuditRows = await pool.query<{ id: string; actor_user_id: string }>(
    `select id, actor_user_id
       from approval_events
      where entity_type = 'item_request'
        and entity_id = $1
        and actor_user_id = $2
        and note like 'Staff confirmed request-viewer outreach email%'
        and created_at >= $3
      order by created_at desc`,
    [itemRequestId, adminSession.user.id, testStartedAt],
  );
  approvalEventIds.push(...sendAuditRows.rows.map((row) => row.id));
  assert(
    sendAuditRows.rows[0]?.actor_user_id === adminSession.user.id,
    "email confirmation is audited before provider dispatch",
    sendAuditRows.rows[0],
  );
  const secondSendAuditRows = await pool.query<{ id: string }>(
    `select id
       from approval_events
      where entity_type = 'item_request'
        and entity_id = $1
        and actor_user_id = $2
        and note like 'Staff confirmed request-viewer outreach email%'
        and created_at >= $3`,
    [secondItemRequestId, adminSession.user.id, testStartedAt],
  );
  approvalEventIds.push(...secondSendAuditRows.rows.map((row) => row.id));

  await createView("volunteer", volunteerRequestId, user.id);
  const volunteerBody: OutreachBody = {
    action: "email",
    requestKind: "volunteer",
    requestId: volunteerRequestId,
    userIds: [user.id],
    subject: "Volunteer opportunity follow-up",
    message: "A staff-composed preview message.",
  };
  const optedOutResponse = await post("/api/admin/analytics/outreach/preview", adminCookie, volunteerBody);
  const optedOut = (await optedOutResponse.json()) as {
    eligibleCount: number;
    preferenceExcludedCount: number;
  };
  assert(
    optedOut.eligibleCount === 0 && optedOut.preferenceExcludedCount === 1,
    "volunteer outreach excludes supporters without matching-alert consent",
    optedOut,
  );
  await dal.volunteerAlerts.saveSupporterPreferences(
    { kind: "member", userId: user.id },
    {
      userId: user.id,
      personId: person.id,
      categoryIds: [],
      matchingAlertsEnabled: true,
    },
  );
  const optedInResponse = await post("/api/admin/analytics/outreach/preview", adminCookie, volunteerBody);
  const optedIn = (await optedInResponse.json()) as { eligibleCount: number; preferenceExcludedCount: number };
  assert(
    optedIn.eligibleCount === 1 && optedIn.preferenceExcludedCount === 0,
    "volunteer outreach includes an explicitly opted-in supporter",
    optedIn,
  );
}

async function cleanup(): Promise<void> {
  if (pledgeId) await pool.query(`delete from item_pledges where id = $1`, [pledgeId]);
  if (approvalEventIds.length > 0) {
    await pool.query(`delete from approval_events where id = any($1::uuid[])`, [approvalEventIds]);
  }
  if (emailLogIds.length > 0) {
    await pool.query(`delete from email_log where id = any($1::uuid[])`, [emailLogIds]);
  }
  if (personId) {
    await pool.query(
      `delete from email_log
        where to_person_id = $1
          and template_key = 'staff_request_viewer_follow_up'`,
      [personId],
    );
  }
  if (eventIds.length > 0) {
    await pool.query(`delete from request_engagement_events where client_event_id = any($1::uuid[])`, [eventIds]);
  }
  if (userId) await pool.query(`delete from users where id = $1`, [userId]);
  if (personId) await pool.query(`delete from people where id = $1`, [personId]);
}

main()
  .catch((err) => {
    failed += 1;
    console.error(err);
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (err) {
      failed += 1;
      console.error("fixture cleanup failed", err);
    }
    await pool.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  });