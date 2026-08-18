/**
 * ADMIN-01 — organization approval, the one-transaction bundle (spec §3):
 *   organizations.status → approved (+ approved_at/approved_by, V1-style),
 *   the owner org_memberships row → active (+ its own stamps),
 *   one approval_events row for each, and the org_approved email_log row —
 *   all inside a single withDbContext transaction. Dispatch happens AFTER
 *   commit (routes call dispatchQueuedEmails) so provider latency never sits
 *   inside the tx and a provider failure can never roll back an approval
 *   (spec §13: the approval stands; the result message states the failure).
 *
 * Deliberate edges:
 * - Already approved (another staff member won the race): AlreadyApprovedError;
 *   the route treats it as a no-op success and refreshes the row (§13). No
 *   second email can result — the once-only index and the pre-queue probe
 *   both guard it.
 * - Missing owner membership: NoOwnerMembershipError thrown INSIDE the tx, so
 *   the org status change rolls back too — "block the approval" means nothing
 *   is written (§13). Never creates the membership here.
 * - Owner membership already active (re-approval after disable): skipped, no
 *   event — disable never touched it. A removed owner membership is NOT
 *   resurrected by re-approval; re-adding a person is ADMIN-03/MP-06 work.
 * - Welcome email blocked by variable resolution: the approval still commits,
 *   with a failed email_log row written in the same tx (visible at ADMIN-06,
 *   resendable there) — Handbook §13 blocks the SEND, not the approval.
 */
import type { Organization, Person } from "../../shared/types";
import * as dal from "../dal";
import type { DbContext } from "../db/client";
import { withDbContext } from "../db/client";
import { absoluteUrl, queueProductEmailInTx, EmailConfigError, type PendingDispatch } from "../email/send";

export class OrgNotFoundError extends Error {
  constructor(orgId: string) {
    super(`organization not found: ${orgId}`);
    this.name = "OrgNotFoundError";
  }
}

export class AlreadyApprovedError extends Error {
  constructor(public readonly orgId: string) {
    super("organization already approved");
    this.name = "AlreadyApprovedError";
  }
}

export class AlreadyDisabledError extends Error {
  constructor(public readonly orgId: string) {
    super("organization already disabled");
    this.name = "AlreadyDisabledError";
  }
}

export class NoOwnerMembershipError extends Error {
  constructor(public readonly orgName: string) {
    super(`organization has no owner membership: ${orgName}`);
    this.name = "NoOwnerMembershipError";
  }
}

export type ApprovalEmailOutcome =
  | { outcome: "queued"; toEmail: string; dispatch: PendingDispatch }
  | { outcome: "skipped_disabled"; toEmail: string }
  | { outcome: "already_sent"; toEmail: string }
  | { outcome: "blocked"; toEmail: string; reason: string }
  | { outcome: "no_contact" };

export type ApproveOrganizationResult = {
  organization: Organization;
  ownerMembershipActivated: boolean;
  email: ApprovalEmailOutcome;
};

/** Display-only name join for the email body (storage keeps two columns; rule 11). */
function contactDisplayName(person: Person): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

export async function approveOrganization(staffUserId: string, orgId: string): Promise<ApproveOrganizationResult> {
  const staff: DbContext = { kind: "staff", userId: staffUserId };

  // Email display var only — read outside the tx to keep it lean.
  const populations = await dal.populations.listByOrganization(staff, orgId);

  try {
    return await withDbContext(staff, async (c) => {
      const organization = await dal.organizations.approveInTx(c, orgId, staffUserId);

      const owner = await dal.memberships.findOwnerByOrgInTx(c, orgId);
      if (!owner) {
        // Thrown inside the tx: the approval above rolls back with it (§13).
        throw new NoOwnerMembershipError(organization.name);
      }
      let ownerMembershipActivated = false;
      if (owner.status === "pending") {
        await dal.memberships.activateInTx(c, owner.id, staffUserId);
        ownerMembershipActivated = true;
      }
      // 'active' (re-approval after disable) needs nothing; 'removed' stays
      // removed — deliberate, see module comment.

      let email: ApprovalEmailOutcome;
      const person = organization.primaryContactPersonId
        ? await dal.people.getByIdInTx(c, organization.primaryContactPersonId)
        : null;
      if (!person) {
        email = { outcome: "no_contact" };
      } else {
        const alreadySent = await dal.emailLog.existsForRecipientInTx(c, {
          templateKey: "org_approved",
          entityType: "organization",
          entityId: organization.id,
          toEmail: person.email,
        });
        if (alreadySent) {
          email = { outcome: "already_sent", toEmail: person.email };
        } else {
          const populationNames = populations.map((p) => p.name);
          if (organization.populationsOther) populationNames.push(organization.populationsOther);
          const vars = {
            organizationName: organization.name,
            orgAddress: organization.addressFormatted ?? organization.city,
            orgPhoneNumber: organization.phone,
            websiteUrl: organization.websiteUrl,
            missionStatement: organization.mission,
            primaryPopulationServed: populationNames.length > 0 ? populationNames.join(", ") : null,
            organizationPrimaryContact: contactDisplayName(person),
            organizationPrimaryContactEmail: person.email,
            organizationPrimaryContactPhone: person.phone,
            dashboardUrl: absoluteUrl("/dashboard"),
          };
          try {
            const dispatch = await queueProductEmailInTx(c, {
              key: "org_approved",
              entityId: organization.id,
              toEmail: person.email,
              toPersonId: person.id,
              vars,
            });
            email = dispatch
              ? { outcome: "queued", toEmail: person.email, dispatch }
              : { outcome: "skipped_disabled", toEmail: person.email };
          } catch (err) {
            if (!(err instanceof EmailConfigError)) throw err;
            // Variable resolution blocked the send. The approval stands; the
            // failed row is written in this same tx so ADMIN-06 shows it.
            const row = await dal.emailLog.insertQueuedInTx(c, {
              templateKey: "org_approved",
              toEmail: person.email,
              toPersonId: person.id,
              entityType: "organization",
              entityId: organization.id,
              payload: { vars },
            });
            await dal.emailLog.markFailedInTx(c, row.id, err.message);
            console.error(`[admin] org ${organization.id} approved but org_approved blocked: ${err.message}`);
            email = { outcome: "blocked", toEmail: person.email, reason: err.message };
          }
        }
      }

      return { organization, ownerMembershipActivated, email };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("organization not found")) throw new OrgNotFoundError(orgId);
    if (message.includes("already approved")) throw new AlreadyApprovedError(orgId);
    throw err;
  }
}

export async function disableOrganization(staffUserId: string, orgId: string): Promise<Organization> {
  const staff: DbContext = { kind: "staff", userId: staffUserId };
  try {
    // dal.organizations.disable: FOR UPDATE, status only (approved_at and
    // approved_by survive — D44/V2), approval event in the same tx.
    return await dal.organizations.disable(staff, orgId, staffUserId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("organization not found")) throw new OrgNotFoundError(orgId);
    if (message.includes("already disabled")) throw new AlreadyDisabledError(orgId);
    throw err;
  }
}
