import type { Express, Request, Response } from "express";
import { requireOrganization, requireStaffAdmin, orgContext, staffContext } from "../auth/guards";
import * as dal from "../dal";
import { SYSTEM, type DbContext } from "../db/client";

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

export function registerEngagementReportingRoutes(app: Express): void {
  app.get("/api/dashboard/engagement", requireOrganization, async (req: Request, res: Response, next) => {
    try {
      const { orgId } = orgContext(req);
      const parsed = parseFilters(req, orgId);
      if (!parsed.ok) {
        res.status(400).json({ message: parsed.message });
        return;
      }
      // The organization guard fixes orgId from the active session, never from
      // caller input. Run the aggregate query in trusted context because the
      // event table intentionally exposes no row-level member reads.
      const report = await dal.requestEngagement.getAnalyticsReport(SYSTEM, parsed.filters);
      res.json({ ...report, filters: parsed.filters });
    } catch (err) {
      next(err);
    }
  });

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
}