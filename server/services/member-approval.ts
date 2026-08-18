/**
 * ADMIN-03 — membership approval, the one-transaction bundle (spec §3):
 *   org_memberships.status → active (+ approved_at / approved_by),
 *   one approval_events row, and the org_member_approved email_log row —
 *   all inside a single withDbContext transaction. Dispatch happens AFTER
 *   commit (the route calls dispatchQueuedEmails), so a provider failure can
 *   never roll back an approval; the result message states the failure
 *   instead of claiming the email sent (§12 — the most consequential email
 *   failure in the system: an approved member who doesn't know they can log
 *   in has no other signal).
 *
 * Deliberate edges:
 * - All reads go through getAdminDetail, whose predicate excludes owner
 *   memberships (§7 — they activate at ADMIN-01) and platform_owner rows
 *   (§11 — staff are not members). Ids outside that world surface as
 *   MembershipNotFoundError → byte-identical 404s at the route.
 * - Approve/reject act strictly on pending rows; reinstate returns removed
 *   rows to PENDING so the normal approval path (and its email) still runs.
 * - Rejecting never touches people or users (§3): the person may hold a
 *   membership elsewhere, may have donated last year, may be invited again.
 * - Email blocked by variable resolution (EmailConfigError): the approval
 *   still commits, with a failed email_log row written in the same tx,
 *   visible and resendable at ADMIN-06.
 */
import type { PoolClient } from "pg";
import * as dal from "../dal";
import type { AdminMemberDetail } from "../dal/memberships";
import type { DbContext } from "../db/client";
import { withDbContext } from "../db/client";
import { absoluteUrl, queueProductEmailInTx, EmailConfigError, type PendingDispatch } from "../email/send";
import type { OrgMembership } from "../../shared/types";

export class MembershipNotFoundError extends Error {
  constructor(membershipId: string) {
    super(`membership not found: ${membershipId}`);
    this.name = "MembershipNotFoundError";
  }
}

/** Another staff member won the race — §12 makes this a no-op success. */
export class MembershipAlreadyActiveError extends Error {
  constructor(public readonly membershipId: string) {
    super(`membership already active: ${membershipId}`);
    this.name = "MembershipAlreadyActiveError";
  }
}

/** Double-reject race — the route reports a no-op, nothing was written. */
export class MembershipAlreadyRemovedError extends Error {
  constructor(public readonly membershipId: string) {
    super(`membership already removed: ${membershipId}`);
    this.name = "MembershipAlreadyRemovedError";
  }
}

/** Double-reinstate race — the row is already back in the queue. */
export class MembershipAlreadyPendingError extends Error {
  constructor(public readonly membershipId: string) {
    super(`membership already pending: ${membershipId}`);
    this.name = "MembershipAlreadyPendingError";
  }
}

/** The row is in a state this action does not serve (e.g. approve a removed row). */
export class MembershipStateError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`membership in unexpected state: ${currentStatus}`);
    this.name = "MembershipStateError";
  }
}

/** §7: an active membership at an unapproved org would open a dead dashboard. */
export class MemberOrgNotApprovedError extends Error {
  constructor(public readonly orgName: string) {
    super(`organization not approved: ${orgName}`);
    this.name = "MemberOrgNotApprovedError";
  }
}

export type MemberEmailOutcome =
  | { outcome: "queued"; toEmail: string; dispatch: PendingDispatch }
  | { outcome: "skipped_disabled"; toEmail: string }
  | { outcome: "blocked"; toEmail: string; reason: string };

export type ApproveMembershipResult = {
  membership: OrgMembership;
  memberName: string;
  memberEmail: string;
  email: MemberEmailOutcome;
};

function memberName(detail: AdminMemberDetail): string {
  return `${detail.firstName} ${detail.lastName}`.trim();
}

function mapDalError(err: unknown, membershipId: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("not found")) return new MembershipNotFoundError(membershipId);
  if (message.includes("already active")) return new MembershipAlreadyActiveError(membershipId);
  if (message.includes("already removed")) return new MembershipAlreadyRemovedError(membershipId);
  if (message.includes("already pending")) return new MembershipAlreadyPendingError(membershipId);
  const state = message.match(/not (?:pending|removed): (\w+)/);
  if (state?.[1]) return new MembershipStateError(state[1]);
  return err instanceof Error ? err : new Error(message);
}

export async function approveMembership(input: {
  membershipId: string;
  staffUserId: string;
}): Promise<ApproveMembershipResult> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };

  const detail = await dal.memberships.getAdminDetail(staff, input.membershipId);
  if (!detail) throw new MembershipNotFoundError(input.membershipId);
  if (detail.status === "active") throw new MembershipAlreadyActiveError(input.membershipId);
  if (detail.orgStatus !== "approved") throw new MemberOrgNotApprovedError(detail.orgName);

  const name = memberName(detail);
  const vars = {
    memberName: name,
    organizationName: detail.orgName,
    loginUrl: absoluteUrl("/login"),
    dashboardUrl: absoluteUrl("/dashboard"),
  };

  try {
    return await withDbContext(staff, async (c: PoolClient) => {
      const membership = await dal.memberships.approvePendingInTx(c, input.membershipId, input.staffUserId);

      let email: MemberEmailOutcome;
      try {
        const dispatch = await queueProductEmailInTx(c, {
          key: "org_member_approved",
          entityId: membership.id,
          toEmail: detail.email,
          vars,
        });
        email = dispatch
          ? { outcome: "queued", toEmail: detail.email, dispatch }
          : { outcome: "skipped_disabled", toEmail: detail.email };
      } catch (err) {
        if (!(err instanceof EmailConfigError)) throw err;
        // Variable resolution blocked the send. The approval stands; the
        // failed row is written in this same tx so ADMIN-06 shows it.
        const row = await dal.emailLog.insertQueuedInTx(c, {
          templateKey: "org_member_approved",
          toEmail: detail.email,
          toPersonId: detail.personId,
          entityType: "org_membership",
          entityId: membership.id,
          payload: { vars },
        });
        await dal.emailLog.markFailedInTx(c, row.id, err.message, "render");
        console.error(`[admin] membership ${membership.id} approved but org_member_approved blocked: ${err.message}`);
        email = { outcome: "blocked", toEmail: detail.email, reason: err.message };
      }

      return { membership, memberName: name, memberEmail: detail.email, email };
    });
  } catch (err) {
    throw mapDalError(err, input.membershipId);
  }
}

export async function rejectMembership(input: {
  membershipId: string;
  staffUserId: string;
  note?: string;
}): Promise<{ membership: OrgMembership; memberName: string }> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  const detail = await dal.memberships.getAdminDetail(staff, input.membershipId);
  if (!detail) throw new MembershipNotFoundError(input.membershipId);
  try {
    const membership = await withDbContext(staff, (c: PoolClient) =>
      dal.memberships.rejectPendingInTx(c, input.membershipId, input.staffUserId, input.note),
    );
    return { membership, memberName: memberName(detail) };
  } catch (err) {
    throw mapDalError(err, input.membershipId);
  }
}

export async function reinstateMembership(input: {
  membershipId: string;
  staffUserId: string;
}): Promise<{ membership: OrgMembership; memberName: string }> {
  const staff: DbContext = { kind: "staff", userId: input.staffUserId };
  const detail = await dal.memberships.getAdminDetail(staff, input.membershipId);
  if (!detail) throw new MembershipNotFoundError(input.membershipId);
  try {
    const membership = await withDbContext(staff, (c: PoolClient) =>
      dal.memberships.reinstateToPendingInTx(c, input.membershipId, input.staffUserId),
    );
    return { membership, memberName: memberName(detail) };
  } catch (err) {
    throw mapDalError(err, input.membershipId);
  }
}
