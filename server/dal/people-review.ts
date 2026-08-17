/**
 * ADMIN-04 — People review queue reads (docs/specs/ADMIN-04.md §3).
 *
 * The queue lists people where needs_review = true. The detail's job is to
 * make the merge decision possible: attached records are listed BY NAME,
 * not summarized as counts (§4) — "pledged 2 blankets to Acres of Hope in
 * March" tells the operator whether two records are the same human;
 * "three pledges" tells her nothing.
 *
 * Duplicate candidates (§3): other people rows matching on phone digits or
 * exact case-insensitive full name, plus any person whose id the review
 * note names explicitly — the phone-match signal (migration 0002) writes
 * suspected-duplicate ids into review_note so the operator can merge
 * without searching.
 *
 * Writes for this surface live in people.ts (updateNames, clearReviewFlag)
 * and — once approved — the merge_people() database function.
 */
import type { Person } from "../../shared/types";
import type { DbContext } from "../db/client";
import { q, withDbContext } from "../db/client";

const PERSON_COLS = `p.id, p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone,
       p.needs_review as "needsReview", p.review_note as "reviewNote", p.source_note as "sourceNote",
       p.created_at as "createdAt", p.updated_at as "updatedAt"`;

export type ReviewQueueRow = Person & {
  pledgeCount: number;
  signupCount: number;
  membershipCount: number;
  primaryContactCount: number;
};

/** Flagged people, oldest first, with counts of what hangs off each. */
export async function listReviewQueue(ctx: DbContext): Promise<ReviewQueueRow[]> {
  return withDbContext(ctx, (c) =>
    q<ReviewQueueRow>(
      c,
      `select ${PERSON_COLS},
              (select count(*)::int from item_pledges ip where ip.person_id = p.id) as "pledgeCount",
              (select count(*)::int from volunteer_signups vs where vs.person_id = p.id) as "signupCount",
              (select count(*)::int from org_memberships m join users u on u.id = m.user_id
                where u.person_id = p.id) as "membershipCount",
              (select count(*)::int from organizations o where o.primary_contact_person_id = p.id) as "primaryContactCount"
         from people p
        where p.needs_review = true
        order by p.created_at asc`,
    ),
  );
}

export type AttachedPledge = {
  id: string;
  requestTitle: string;
  orgName: string;
  createdAt: string;
  lines: { itemName: string; quantity: number }[];
};

export type AttachedSignup = {
  id: string;
  requestTitle: string;
  orgName: string;
  createdAt: string;
  roles: { roleName: string }[];
};

export type AttachedMembership = { orgName: string; role: string; status: string };

export type AttachedRequestContact = { id: string; title: string; orgName: string; kind: "item" | "volunteer" };

export type AttachedRecords = {
  pledges: AttachedPledge[];
  signups: AttachedSignup[];
  memberships: AttachedMembership[];
  primaryContactOrgs: { id: string; name: string }[];
  requestContacts: AttachedRequestContact[];
  hasUser: boolean;
  digestSubscription: { email: string; status: string } | null;
  emailLogCount: number;
};

/** Everything attached to one person, each record named (§4 region 2). */
export async function getAttachedRecords(ctx: DbContext, personId: string): Promise<AttachedRecords> {
  return withDbContext(ctx, async (c) => {
    const pledges = await q<AttachedPledge>(
      c,
      `select ip.id, r.title as "requestTitle", o.name as "orgName", ip.created_at as "createdAt",
              coalesce(
                (select json_agg(json_build_object('itemName', i.name, 'quantity', l.quantity) order by i.sort_order)
                   from item_pledge_lines l join items i on i.id = l.item_id
                  where l.item_pledge_id = ip.id),
                '[]'::json) as lines
         from item_pledges ip
         join item_requests r on r.id = ip.item_request_id
         join organizations o on o.id = r.org_id
        where ip.person_id = $1
        order by ip.created_at asc`,
      [personId],
    );
    const signups = await q<AttachedSignup>(
      c,
      `select vs.id, r.title as "requestTitle", o.name as "orgName", vs.created_at as "createdAt",
              coalesce(
                (select json_agg(json_build_object('roleName', vr.name) order by vr.sort_order)
                   from volunteer_signup_roles sr join volunteer_roles vr on vr.id = sr.volunteer_role_id
                  where sr.volunteer_signup_id = vs.id),
                '[]'::json) as roles
         from volunteer_signups vs
         join volunteer_requests r on r.id = vs.volunteer_request_id
         join organizations o on o.id = r.org_id
        where vs.person_id = $1
        order by vs.created_at asc`,
      [personId],
    );
    const memberships = await q<AttachedMembership>(
      c,
      `select o.name as "orgName", m.role, m.status
         from org_memberships m
         join users u on u.id = m.user_id
         join organizations o on o.id = m.org_id
        where u.person_id = $1
        order by o.name asc`,
      [personId],
    );
    const primaryContactOrgs = await q<{ id: string; name: string }>(
      c,
      `select o.id, o.name from organizations o where o.primary_contact_person_id = $1 order by o.name asc`,
      [personId],
    );
    // Request-contact references also move on merge (FK audit): the
    // confirmation must be able to name them.
    const requestContacts = await q<AttachedRequestContact>(
      c,
      `select r.id, r.title, o.name as "orgName", 'item'::text as kind
         from item_requests r join organizations o on o.id = r.org_id
        where r.contact_person_id = $1
       union all
       select r.id, r.title, o.name as "orgName", 'volunteer'::text as kind
         from volunteer_requests r join organizations o on o.id = r.org_id
        where r.contact_person_id = $1
        order by 2`,
      [personId],
    );
    const userRows = await q<{ id: string }>(c, `select id from users where person_id = $1`, [personId]);
    const digestRows = await q<{ email: string; status: string }>(
      c,
      `select email, status from digest_subscribers where person_id = $1`,
      [personId],
    );
    const emailLogRows = await q<{ n: number }>(
      c,
      `select count(*)::int as n from email_log where to_person_id = $1`,
      [personId],
    );
    return {
      pledges,
      signups,
      memberships,
      primaryContactOrgs,
      requestContacts,
      hasUser: userRows.length > 0,
      digestSubscription: digestRows[0] ?? null,
      emailLogCount: emailLogRows[0]?.n ?? 0,
    };
  });
}

/**
 * Other people rows that may be the same human (§3): phone-digit match,
 * exact case-insensitive full-name match, or the flagged person's review
 * note naming their id (the 0002 phone-match signal writes ids there).
 */
export async function listDuplicateCandidates(ctx: DbContext, personId: string): Promise<Person[]> {
  return withDbContext(ctx, (c) =>
    q<Person>(
      c,
      `with flagged as (select * from people where id = $1)
       select ${PERSON_COLS}
         from people p, flagged f
        where p.id <> f.id
          and (
            (p.phone is not null and f.phone is not null
              and regexp_replace(p.phone, '\\D', '', 'g') <> ''
              and regexp_replace(p.phone, '\\D', '', 'g') = regexp_replace(f.phone, '\\D', '', 'g'))
            or lower(p.first_name || ' ' || p.last_name) = lower(f.first_name || ' ' || f.last_name)
            or position(p.id::text in coalesce(f.review_note, '')) > 0
          )
        order by p.created_at asc`,
      [personId],
    ),
  );
}
