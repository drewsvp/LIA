/**
 * Session resolution: Better Auth cookie -> application user -> active
 * memberships -> active organization. The active org id NEVER comes from a
 * request param or body; it is the user's single active membership, or their
 * signed org-choice cookie validated against those memberships (MP-02).
 */
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";
import { SYSTEM } from "../db/client";
import * as usersDal from "../dal/users";
import * as membershipsDal from "../dal/memberships";
import * as organizationContextsDal from "../dal/admin-organization-contexts";
import * as supporterImpersonationDal from "../dal/supporter-impersonation";
import { normalizeEmail } from "../dal/people";
import type { SessionInfo, UserWithPerson } from "../../shared/types";

/** Cookie holding the chosen org id for users with multiple memberships (signed). */
export const ACTIVE_ORG_COOKIE = "lia_active_org";
export const ADMIN_ORG_CONTEXT_COOKIE = "lia_admin_org_context";
export const SUPPORTER_CONTEXT_COOKIE = "lia_supporter_context";

const ANONYMOUS: SessionInfo = {
  authenticated: false,
  user: null,
  memberships: [],
  activeOrgId: null,
  organizationContext: null,
  supporterContext: null,
  isStaff: false,
  isSupporter: false,
  staffRole: null,
};

/** The provider-backed application user before any temporary app context. */
export async function resolveBaseApplicationUser(req: Request): Promise<UserWithPerson | null> {
  const baSession = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!baSession) return null;
  const user = await usersDal.findByAuthSubject(SYSTEM, baSession.user.id);
  if (!user || user.status === "disabled") return null;
  if (normalizeEmail(user.email) !== normalizeEmail(baSession.user.email)) {
    console.error(`auth: denying mismatched provider/account email for subject ${baSession.user.id}`);
    return null;
  }
  return user;
}

/** Resolve the full session picture for a request. Anonymous on any miss. */
export async function resolveSessionInfo(req: Request): Promise<SessionInfo> {
  const baseUser = await resolveBaseApplicationUser(req);
  if (!baseUser) return ANONYMOUS;
  const user = baseUser;

  const memberships = await membershipsDal.listActiveByUser(SYSTEM, user.id);

  const staffMembership = memberships.find(
    (m) =>
      m.orgKind === "platform_owner" &&
      (m.role === "staff_admin" || m.role === "staff_approver"),
  );

  const cookies = (req as Request & { signedCookies?: Record<string, string> }).signedCookies;
  let organizationContext: SessionInfo["organizationContext"] = null;
  const contextId = cookies?.[ADMIN_ORG_CONTEXT_COOKIE];
  if (
    contextId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contextId) &&
    staffMembership?.role === "staff_admin"
  ) {
    const active = await organizationContextsDal.getActive(SYSTEM, contextId, user.id);
    if (active) {
      organizationContext = {
        id: active.id,
        organizationId: active.organizationId,
        organizationName: active.organizationName,
        startedAt: active.startedAt,
      };
    }
  }

  const supporterCookie = cookies?.[SUPPORTER_CONTEXT_COOKIE];
  if (
    supporterCookie &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supporterCookie) &&
    staffMembership?.role === "staff_admin" &&
    organizationContext === null
  ) {
    const supporterContext = await supporterImpersonationDal.getActive(
      { kind: "staff", userId: user.id },
      supporterCookie,
      user.id,
    );
    if (supporterContext) {
      const supporter = await usersDal.getWithPersonById(SYSTEM, supporterContext.supporterUserId);
      if (supporter && supporter.kind === "supporter" && supporter.status === "active") {
        return {
          authenticated: true,
          user: supporter,
          memberships: [],
          activeOrgId: null,
          organizationContext: null,
          supporterContext: {
            id: supporterContext.id,
            supporterUserId: supporterContext.supporterUserId,
            supporterName: supporterContext.supporterName,
            startedAt: supporterContext.startedAt,
            expiresAt: supporterContext.expiresAt,
          },
          isStaff: false,
          isSupporter: true,
          staffRole: null,
        };
      }
    }
  }

  let activeOrgId: string | null = null;
  if (organizationContext) {
    activeOrgId = organizationContext.organizationId;
  } else if (memberships.length === 1) {
    activeOrgId = memberships[0]?.orgId ?? null;
  } else if (memberships.length > 1) {
    const chosen = cookies?.[ACTIVE_ORG_COOKIE];
    if (chosen && memberships.some((m) => m.orgId === chosen)) activeOrgId = chosen;
  }

  return {
    authenticated: true,
    user,
    memberships,
    activeOrgId,
    organizationContext,
    supporterContext: null,
    isStaff: staffMembership !== undefined,
    isSupporter: user.kind === "supporter",
    staffRole:
      staffMembership?.role === "staff_admin" || staffMembership?.role === "staff_approver"
        ? staffMembership.role
        : null,
  };
}
