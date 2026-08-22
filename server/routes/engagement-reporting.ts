import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { requireOrganization, requireStaffAdmin, orgContext, staffContext } from "../auth/guards";
import * as dal from "../dal";
import { SYSTEM, type DbContext } from "../db/client";
import {
  getEmailHeaderAttachment,
  EMAIL_HEADER_CID_URL,
  MAY_HAVE_SENT_MARKER,
  sendEmail,
} from "../email/send";
import { escapeHtml, finalizeHtml, para, shell } from "../email/render";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function defaultFrom(): string {
  const todayInLosAngeles = isoDate(new Date());
  const date = new Date(`${todayInLosAngeles}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 29);
  return date.toISOString().slice(0, 10);
}

type ParsedFilters =
  | { ok: true; filters: dal.requestEngagement.AnalyticsFilters }
  | { ok: false; message: string };

function parseFilters(req: Request, fixedOrgId: string | null): ParsedFilters {
  const from = typeof req.query.from === "string" && req.query.from !== "" ? req.query.from : defaultFrom();
  const to = typeof req.query.to === "string" && req.query.to !== "" ? req.query.to : isoDate(new Date());
  const kindRaw = typeof req.query.kind === "string" ? req.query.kind : "";
  const kind = kindRaw === "" ? null : kindRaw === "item" || kindRaw === "volunteer" ? kindRaw : "invalid";
  const requestedOrg = typeof req.query.orgId === "string" && req.query.orgId !== "" ? req.query.orgId : null;
  const orgId = fixedOrgId ?? requestedOrg;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return { ok: false, message: "Choose valid report dates." };
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (fromMs > toMs || toMs - fromMs > 366 * 86_400_000) {
    return { ok: false, message: "Choose a date range of one year or less." };
  }
  if (kind === "invalid") return { ok: false, message: "Choose a valid request type." };
  if (orgId !== null && !UUID_RE.test(orgId)) {
    return { ok: false, message: "Choose a valid organization." };
  }
  return { ok: true, filters: { from, to, kind, orgId } };
}

function staffDbContext(req: Request): DbContext {
  return { kind: "staff", userId: staffContext(req).userId };
}

type OutreachAction = "email" | "export";

type OutreachValue = {
  action: OutreachAction;
  requestKind: dal.requestEngagement.RequestKind;
  requestId: string;
  userIds: string[];
  subject?: string;
  message?: string;
};

type OutreachInput =
  | { ok: true; value: OutreachValue }
  | { ok: false; message: string };

function parseOutreachRecord(body: Record<string, unknown> | undefined, needsMessage: boolean): OutreachInput {
  const action = body?.action;
  const requestKind = body?.requestKind;
  const requestId = body?.requestId;
  const rawUserIds = body?.userIds;
  if (action !== "email" && action !== "export") return { ok: false, message: "Choose a valid outreach action." };
  if (requestKind !== "item" && requestKind !== "volunteer") return { ok: false, message: "Choose a valid request type." };
  if (typeof requestId !== "string" || !UUID_RE.test(requestId)) return { ok: false, message: "Choose a valid request." };
  if (
    !Array.isArray(rawUserIds) ||
    rawUserIds.length < 1 ||
    rawUserIds.length > 100 ||
    rawUserIds.some((id) => typeof id !== "string" || !UUID_RE.test(id))
  ) {
    return { ok: false, message: "Choose between one and 100 signed-in viewers." };
  }
  const userIds = [...new Set(rawUserIds)];
  const subject = typeof body?.subject === "string" ? body.subject.trim() : undefined;
  const message = typeof body?.message === "string" ? body.message.trim() : undefined;
  if (needsMessage && action === "email") {
    if (!subject || subject.length > 160) return { ok: false, message: "Enter an email subject of 160 characters or fewer." };
    if (!message || message.length > 5_000) return { ok: false, message: "Enter an email message of 5,000 characters or fewer." };
  }
  return { ok: true, value: { action, requestKind, requestId, userIds, subject, message } };
}

function parseOutreachInput(req: Request, needsMessage: boolean): OutreachInput {
  return parseOutreachRecord(req.body as Record<string, unknown> | undefined, needsMessage);
}

type ConfirmationClaims = OutreachValue & {
  version: 1;
  actorUserId: string;
  expiresAt: number;
};

function confirmationSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

function signConfirmation(value: OutreachValue, actorUserId: string): string {
  const claims: ConfirmationClaims = {
    ...value,
    version: 1,
    actorUserId,
    expiresAt: Date.now() + 10 * 60_000,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", confirmationSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyConfirmation(req: Request): OutreachInput {
  const token =
    typeof (req.body as Record<string, unknown> | undefined)?.confirmationToken === "string"
      ? String((req.body as Record<string, unknown>).confirmationToken)
      : "";
  const [payload, suppliedSignature, ...extra] = token.split(".");
  if (!payload || !suppliedSignature || extra.length > 0 || token.length > 20_000) {
    return { ok: false, message: "Review this outreach action again before confirming it." };
  }
  const expectedSignature = createHmac("sha256", confirmationSecret()).update(payload).digest("base64url");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, message: "Review this outreach action again before confirming it." };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, message: "Review this outreach action again before confirming it." };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, message: "Review this outreach action again before confirming it." };
  }
  const claims = raw as Record<string, unknown>;
  if (
    claims.version !== 1 ||
    claims.actorUserId !== staffContext(req).userId ||
    typeof claims.expiresAt !== "number" ||
    !Number.isInteger(claims.expiresAt) ||
    claims.expiresAt < Date.now()
  ) {
    return { ok: false, message: "This outreach preview expired or belongs to another staff member. Review it again." };
  }
  return parseOutreachRecord(claims, true);
}

function csvCell(value: string): string {
  const firstMeaningful = value.replace(/^[\p{White_Space}\p{Cc}\p{Cf}]*/u, "");
  const safe = /^[=+\-@]/.test(firstMeaningful) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function renderOutreachEmail(subject: string, message: string): { html: string; text: string } {
  const body = message
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => para(escapeHtml(paragraph).replaceAll("\n", "<br />")))
    .join("\n");
  return { html: finalizeHtml(shell(subject, body), EMAIL_HEADER_CID_URL), text: message };
}

export function registerEngagementReportingRoutes(app: Express): void {
  app.get("/api/admin/analytics", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const parsed = parseFilters(req, null);
      if (!parsed.ok) {
        res.status(400).json({ message: parsed.message });
        return;
      }
      const ctx = staffDbContext(req);
      const [report, organizations] = await Promise.all([
        dal.requestEngagement.getAnalyticsReport(ctx, parsed.filters),
        dal.requestEngagement.listReportingOrganizations(ctx),
      ]);
      res.json({ ...report, organizations, filters: parsed.filters });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/admin/analytics/audience", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const parsed = parseFilters(req, null);
      if (!parsed.ok) {
        res.status(400).json({ message: parsed.message });
        return;
      }
      const rawPage = typeof req.query.page === "string" ? Number(req.query.page) : 1;
      const rawPageSize = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : 25;
      if (
        !Number.isInteger(rawPage) ||
        rawPage < 1 ||
        !Number.isInteger(rawPageSize) ||
        rawPageSize < 1 ||
        rawPageSize > 100
      ) {
        res.status(400).json({ message: "Choose a valid page." });
        return;
      }
      const result = await dal.requestEngagement.listUnconvertedViewers(
        staffDbContext(req),
        parsed.filters,
        rawPage,
        rawPageSize,
      );
      res.json({
        ...result,
        page: rawPage,
        pageSize: rawPageSize,
        totalPages: Math.max(1, Math.ceil(result.total / rawPageSize)),
      });
    } catch (err) {
      next(err);
    }
  });

  // A preview is never authorization to act: the send/export routes resolve
  // eligibility again immediately before their mutation or download.
  app.post("/api/admin/analytics/outreach/preview", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const parsed = parseOutreachInput(req, true);
      if (!parsed.ok) {
        res.status(400).json({ message: parsed.message });
        return;
      }
      const eligibility = await dal.requestEngagement.listEligibleOutreachRecipients(staffDbContext(req), parsed.value);
      res.json({
        action: parsed.value.action,
        request: eligibility.request,
        recipients: eligibility.recipients.map(({ personId: _personId, ...recipient }) => recipient),
        requestedCount: parsed.value.userIds.length,
        eligibleCount: eligibility.recipients.length,
        ineligibleCount: parsed.value.userIds.length - eligibility.recipients.length,
        preferenceExcludedCount: eligibility.preferenceExcludedCount,
        confirmationToken: signConfirmation(parsed.value, staffContext(req).userId),
        ...(parsed.value.action === "email" ? { subject: parsed.value.subject, message: parsed.value.message } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/admin/analytics/outreach/send", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const parsed = verifyConfirmation(req);
      if (!parsed.ok || parsed.value.action !== "email" || !parsed.value.subject || !parsed.value.message) {
        res.status(400).json({ message: parsed.ok ? "Choose email outreach." : parsed.message });
        return;
      }
      const ctx = staffDbContext(req);
      const eligibility = await dal.requestEngagement.listEligibleOutreachRecipients(ctx, parsed.value);
      if (!eligibility.request || eligibility.recipients.length === 0) {
        res.status(409).json({ message: "None of the selected viewers are currently eligible. Nothing was sent." });
        return;
      }
      const rendered = renderOutreachEmail(parsed.value.subject, parsed.value.message);
      await dal.approvalEvents.insert(ctx, {
        entityType: parsed.value.requestKind === "item" ? "item_request" : "volunteer_request",
        entityId: parsed.value.requestId,
        toStatus: "outreach email",
        actorUserId: staffContext(req).userId,
        note: `Staff confirmed request-viewer outreach email for up to ${eligibility.recipients.length} eligible signed-in viewer(s). Recipient eligibility and preferences are rechecked immediately before each attempt.`,
      });
      let sent = 0;
      let alreadyAttempted = 0;
      let uncertain = 0;
      let becameIneligible = 0;
      let preferenceExcludedDuringSend = 0;
      let failed = 0;
      for (const recipient of eligibility.recipients) {
        try {
          const priorAttempts = await dal.emailLog.listWithFilters(ctx, {
            templateKey: "staff_request_viewer_follow_up",
            toPersonId: recipient.personId,
            entityType: parsed.value.requestKind === "item" ? "item_request" : "volunteer_request",
            entityId: parsed.value.requestId,
            limit: 100,
          });
          if (
            priorAttempts.some(
              (entry) =>
                entry.status === "failed" &&
                (entry.failureCategory === "provider_timeout" || entry.error?.includes(MAY_HAVE_SENT_MARKER)),
            )
          ) {
            uncertain += 1;
            continue;
          }
          const current = await dal.requestEngagement.listEligibleOutreachRecipients(ctx, {
            requestKind: parsed.value.requestKind,
            requestId: parsed.value.requestId,
            userIds: [recipient.userId],
          });
          const freshRecipient = current.recipients[0];
          if (!freshRecipient) {
            becameIneligible += 1;
            preferenceExcludedDuringSend += current.preferenceExcludedCount;
            continue;
          }
          const result = await sendEmail({
            templateKey: "staff_request_viewer_follow_up",
            toEmail: freshRecipient.email,
            toPersonId: freshRecipient.personId,
            entityType: parsed.value.requestKind === "item" ? "item_request" : "volunteer_request",
            entityId: parsed.value.requestId,
            payload: {
              audience: "signed_in_viewer_without_conversion",
              requestKind: parsed.value.requestKind,
              requestId: parsed.value.requestId,
              subject: parsed.value.subject,
              message: parsed.value.message,
            },
            subject: parsed.value.subject,
            html: rendered.html,
            text: rendered.text,
            attachments: [await getEmailHeaderAttachment()],
            oncePerPerson: true,
          });
          if (result.outcome === "sent") sent += 1;
          else alreadyAttempted += 1;
        } catch (err) {
          failed += 1;
          console.error(`[analytics] outreach email failed (${recipient.userId}):`, err);
        }
      }
      const summary = [
        `${sent} email${sent === 1 ? "" : "s"} sent`,
        alreadyAttempted > 0 ? `${alreadyAttempted} already attempted` : null,
        uncertain > 0 ? `${uncertain} not retried because a previous attempt may have sent` : null,
        becameIneligible > 0 ? `${becameIneligible} no longer eligible` : null,
        failed > 0 ? `${failed} failed` : null,
      ].filter((part): part is string => part !== null);
      res.json({
        message: `${summary.join("; ")}.${failed > 0 ? " Review Email logs for details." : ""}`,
        sent,
        alreadyAttempted,
        uncertain,
        becameIneligible,
        failed,
        eligibleCount: eligibility.recipients.length,
        ineligibleCount: parsed.value.userIds.length - eligibility.recipients.length + becameIneligible,
        preferenceExcludedCount: eligibility.preferenceExcludedCount + preferenceExcludedDuringSend,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/admin/analytics/outreach/export", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const parsed = verifyConfirmation(req);
      if (!parsed.ok || parsed.value.action !== "export") {
        res.status(400).json({ message: parsed.ok ? "Choose export outreach." : parsed.message });
        return;
      }
      const ctx = staffDbContext(req);
      const eligibility = await dal.requestEngagement.listEligibleOutreachRecipients(ctx, parsed.value);
      if (!eligibility.request || eligibility.recipients.length === 0) {
        res.status(409).json({ message: "None of the selected viewers are currently eligible. Nothing was exported." });
        return;
      }
      await dal.approvalEvents.insert(ctx, {
        entityType: parsed.value.requestKind === "item" ? "item_request" : "volunteer_request",
        entityId: parsed.value.requestId,
        toStatus: "outreach export",
        actorUserId: staffContext(req).userId,
        note: `Staff exported ${eligibility.recipients.length} eligible signed-in viewer(s) for outreach.`,
      });
      const lines = [
        "first_name,last_name,email,request,organization,last_viewed_at",
        ...eligibility.recipients.map((recipient) =>
          [
            recipient.firstName,
            recipient.lastName,
            recipient.email,
            recipient.requestTitle,
            recipient.orgName,
            recipient.lastViewedAt,
          ]
            .map(csvCell)
            .join(","),
        ),
      ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="eligible-request-viewers.csv"');
      res.send(`${lines.join("\n")}\n`);
    } catch (err) {
      next(err);
    }
  });
}
