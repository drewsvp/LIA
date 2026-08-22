/**
 * The data-access layer. ALL SQL in this application lives under server/dal/
 * (plus the SQL files under server/db/ and the auth provider's own queries in
 * auth-provider.ts). Route handlers, components, and scripts import from here
 * and never touch the database directly.
 *
 * Conventions — see docs/data-access.md for the full contract:
 * - Every function takes a DbContext first: who the operation runs as.
 * - Org-scoped operations take the org id RESOLVED FROM THE SESSION by the
 *   org guard — never from request params or bodies.
 * - Counter columns move only through pledges.recordItemPledge and
 *   signups.recordVolunteerSignup, which call the SQL functions.
 * - Status transitions write approval_events in the same transaction.
 */
export * as people from "./people";
export * as users from "./users";
export * as authProvider from "./auth-provider";
export * as organizations from "./organizations";
export * as memberships from "./memberships";
export * as populations from "./populations";
export * as itemRequests from "./item-requests";
export * as items from "./items";
export * as volunteerRequests from "./volunteer-requests";
export * as volunteerRoles from "./volunteer-roles";
export * as pledges from "./pledges";
export * as signups from "./signups";
export * as approvalEvents from "./approval-events";
export * as emailLog from "./email-log";
export * as emailBrandSettings from "./email-brand-settings";
export * as emailTemplateOverrides from "./email-template-overrides";
export * as emailSchedules from "./email-schedules";
export * as emailResendData from "./email-resend-data";
export * as digestSubscribers from "./digest-subscribers";
export * as digestRuns from "./digest-runs";
export * as legacyStaff from "./legacy-staff";
export * as validation from "./validation";
export * as adminCounts from "./admin-counts";
export * as adminRequests from "./admin-requests";
export * as peopleReview from "./people-review";
export * as volunteerInterests from "./volunteer-interests";
export * as volunteerAlerts from "./volunteer-alerts";
export * as requestEngagement from "./request-engagement";
export * as requestRevisions from "./request-revisions";

export { SYSTEM, PUBLIC, type DbContext } from "../db/client";
