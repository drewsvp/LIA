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
import type { SessionInfo } from "../../shared/types";

/** Cookie holding the chosen org id for users with multiple memberships (signed). */
export const ACTIVE_ORG_COOKIE = "lia_active_org";

const ANONYMOUS: SessionInfo = {
  authenticated: false,
  user: null,
  memberships: [],
  activeOrgId: null,
  isStaff: false,
  isSupporter: false,
  staffRole: null,
};

/** Resolve the full session picture for a request. Anonymous on any miss. */
export async function resolveSessionInfo(req: Request): Promise<SessionInfo> {
  const baSession = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!baSession) return ANONYMOUS;

  const user = await usersDal.findByAuthSubject(SYSTEM, baSession.user.id);
  if (!user || user.status === "disabled") return ANONYMOUS;

  const memberships = await membershipsDal.listActiveByUser(SYSTEM, user.id);

  const staffMembership = memberships.find(
    (m) =>
      m.orgKind === "platform_owner" &&
      (m.role === "staff_admin" || m.role === "staff_approver"),
  );

  let activeOrgId: string | null = null;
  if (memberships.length === 1) {
    activeOrgId = memberships[0]?.orgId ?? null;
  } else if (memberships.length > 1) {
    const cookies = (req as Request & { signedCookies?: Record<string, string> }).signedCookies;
    const chosen = cookies?.[ACTIVE_ORG_COOKIE];
    if (chosen && memberships.some((m) => m.orgId === chosen)) activeOrgId = chosen;
  }

  return {
    authenticated: true,
    user,
    memberships,
    activeOrgId,
    isStaff: staffMembership !== undefined,
    isSupporter: user.kind === "supporter",
    staffRole:
      staffMembership?.role === "staff_admin" || staffMembership?.role === "staff_approver"
        ? staffMembership.role
        : null,
  };
}
