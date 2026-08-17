/**
 * Admin shell nav badges (ADMIN-01 §4): pending counts for the three queue
 * surfaces plus the trailing-7-day email failure count. One round trip, four
 * scalars; staff-only callers.
 *
 * The members count mirrors the ADMIN-03 queue definition: pending
 * NON-owner memberships of member organizations. Owner memberships never
 * appear there — they activate with the organization at ADMIN-01.
 */
import { q, withDbContext, type DbContext } from "../db/client";

export type AdminNavCounts = {
  pendingOrganizations: number;
  pendingRequests: number;
  pendingMembers: number;
  failedEmailsLastSevenDays: number;
};

export async function navCounts(ctx: DbContext): Promise<AdminNavCounts> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<{
      pendingOrganizations: string;
      pendingRequests: string;
      pendingMembers: string;
      failedEmails: string;
    }>(
      c,
      `select
         (select count(*) from organizations where status = 'pending' and kind = 'member_org')::text as "pendingOrganizations",
         ((select count(*) from item_requests where status = 'pending')
          + (select count(*) from volunteer_requests where status = 'pending'))::text as "pendingRequests",
         (select count(*) from org_memberships m
            join organizations o on o.id = m.org_id
           where m.status = 'pending' and m.role <> 'owner' and o.kind = 'member_org')::text as "pendingMembers",
         (select count(*) from email_log
           where status = 'failed' and created_at > now() - interval '7 days')::text as "failedEmails"`,
    );
    const row = rows[0];
    if (!row) throw new Error("adminCounts.navCounts returned no row");
    return {
      pendingOrganizations: Number(row.pendingOrganizations),
      pendingRequests: Number(row.pendingRequests),
      pendingMembers: Number(row.pendingMembers),
      failedEmailsLastSevenDays: Number(row.failedEmails),
    };
  });
}
