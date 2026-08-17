/**
 * The two server-side guards (foundation contract — final).
 *
 * requireOrganization — wraps every member-portal API route. Verifies an
 * active membership BEFORE any data access and attaches the resolved org id
 * to the request. Handlers MUST use req.lia.orgId and never an org id from
 * the request. Responses: 401 not signed in, 403 no active membership,
 * 409 { code: "ORG_SELECTION_REQUIRED" } when a multi-org user has not chosen.
 *
 * requireStaff — wraps every /api/admin route. Verifies an active
 * staff_admin/staff_approver membership in the platform_owner organization.
 * Non-staff get 404 { message: "Not found" } — byte-identical to an
 * unknown API route, so admin surfaces do not exist for them.
 */
import type { NextFunction, Request, Response } from "express";
import { resolveSessionInfo } from "./session";
import type { SessionInfo } from "../../shared/types";

export type OrgRequestContext = {
  session: SessionInfo;
  /** Application users.id of the signed-in user. */
  userId: string;
  /** The session-resolved organization id. The ONLY org id handlers may use. */
  orgId: string;
};

export type StaffRequestContext = {
  session: SessionInfo;
  userId: string;
  staffRole: "staff_admin" | "staff_approver";
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      liaOrg?: OrgRequestContext;
      liaStaff?: StaffRequestContext;
    }
  }
}

/** The exact body an unknown /api route returns; staff-guard failures reuse it. */
export const NOT_FOUND_BODY = { message: "Not found" } as const;

/**
 * The ONLY way a member-portal handler may 404. Byte-identical to the
 * unknown-route catch-all, so a foreign organization's entity id and a
 * nonexistent route are indistinguishable — existence itself is scoped
 * (Handbook §6). Every MP-08/09/11/12-style id lookup miss goes through here.
 */
export function sendNotFound(res: Response): void {
  res.status(404).json(NOT_FOUND_BODY);
}

export async function requireOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await resolveSessionInfo(req);
    if (!session.authenticated || session.user === null) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    if (session.memberships.length === 0) {
      res.status(403).json({ message: "No active organization membership" });
      return;
    }
    if (session.activeOrgId === null) {
      res.status(409).json({ message: "Select an organization to continue", code: "ORG_SELECTION_REQUIRED" });
      return;
    }
    req.liaOrg = { session, userId: session.user.id, orgId: session.activeOrgId };
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await resolveSessionInfo(req);
    if (!session.isStaff || session.user === null || session.staffRole === null) {
      // Same response as a nonexistent route: admin does not exist for non-staff.
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }
    req.liaStaff = { session, userId: session.user.id, staffRole: session.staffRole };
    next();
  } catch (err) {
    next(err);
  }
}

/** Typed accessor for handlers behind requireOrganization. Throws if misused. */
export function orgContext(req: Request): OrgRequestContext {
  if (!req.liaOrg) throw new Error("orgContext used on a route without requireOrganization");
  return req.liaOrg;
}

/** Typed accessor for handlers behind requireStaff. Throws if misused. */
export function staffContext(req: Request): StaffRequestContext {
  if (!req.liaStaff) throw new Error("staffContext used on a route without requireStaff");
  return req.liaStaff;
}

/**
 * ADMIN-04 §11: staff admin only, not staff approver. A staff approver gets
 * the same response as a route that does not exist — the same 404 body every
 * other boundary sends, so the surface is undiscoverable rather than
 * forbidden.
 */
export async function requireStaffAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await resolveSessionInfo(req);
    if (!session.isStaff || session.user === null || session.staffRole !== "staff_admin") {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }
    req.liaStaff = { session, userId: session.user.id, staffRole: session.staffRole };
    next();
  } catch (err) {
    next(err);
  }
}
