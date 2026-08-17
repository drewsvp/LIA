/**
 * ADMIN-06 read models: naming related entities for the log table, and the
 * per-entity contexts a RESEND needs to re-resolve template variables from
 * CURRENT data (§6 — resending a stored payload would just resend the
 * original defect). All SQL for the surface lives here.
 */
import { q, withDbContext, type DbContext } from "../db/client";

/* ------------------------------------------------------------------ */
/* Entity naming for the log table and detail link                     */
/* ------------------------------------------------------------------ */

export type EntityRef = { type: string; id: string };
export type ResolvedEntity = { name: string; path: string | null };

/**
 * Resolve entity refs to display names and in-app paths, batched per type.
 * A ref that no longer resolves is simply absent from the map — the caller
 * renders the raw type/id and no link.
 */
export async function resolveEntityRefs(ctx: DbContext, refs: EntityRef[]): Promise<Record<string, ResolvedEntity>> {
  const byType = new Map<string, string[]>();
  for (const ref of refs) {
    if (!ref.id) continue;
    const list = byType.get(ref.type) ?? [];
    if (!list.includes(ref.id)) list.push(ref.id);
    byType.set(ref.type, list);
  }
  const out: Record<string, ResolvedEntity> = {};
  await withDbContext(ctx, async (c) => {
    const orgIds = byType.get("organization");
    if (orgIds?.length) {
      const rows = await q<{ id: string; name: string }>(
        c,
        `select id, name from organizations where id = any($1::uuid[])`,
        [orgIds],
      );
      for (const r of rows) out[`organization:${r.id}`] = { name: r.name, path: "/admin/organizations" };
    }
    // ADMIN-07: person entities (merge events, D31). Merged duplicates are
    // deleted, so an unresolved person is expected and renders as
    // "No longer present" — never dropped.
    const personIds = byType.get("person");
    if (personIds?.length) {
      const rows = await q<{ id: string; name: string }>(
        c,
        `select id, trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) as name
           from people where id = any($1::uuid[])`,
        [personIds],
      );
      for (const r of rows) out[`person:${r.id}`] = { name: r.name, path: "/admin/people/review" };
    }
    const itemReqIds = byType.get("item_request");
    if (itemReqIds?.length) {
      const rows = await q<{ id: string; title: string; org: string }>(
        c,
        `select r.id, r.title, o.name as org from item_requests r join organizations o on o.id = r.org_id
          where r.id = any($1::uuid[])`,
        [itemReqIds],
      );
      for (const r of rows) out[`item_request:${r.id}`] = { name: `${r.title} — ${r.org}`, path: `/items/${r.id}` };
    }
    const volReqIds = byType.get("volunteer_request");
    if (volReqIds?.length) {
      const rows = await q<{ id: string; title: string; org: string }>(
        c,
        `select r.id, r.title, o.name as org from volunteer_requests r join organizations o on o.id = r.org_id
          where r.id = any($1::uuid[])`,
        [volReqIds],
      );
      for (const r of rows)
        out[`volunteer_request:${r.id}`] = { name: `${r.title} — ${r.org}`, path: `/volunteer/${r.id}` };
    }
    const membershipIds = byType.get("org_membership");
    if (membershipIds?.length) {
      const rows = await q<{ id: string; person: string; org: string }>(
        c,
        `select m.id, p.first_name || ' ' || p.last_name as person, o.name as org
           from org_memberships m
           join users u on u.id = m.user_id
           join people p on p.id = u.person_id
           join organizations o on o.id = m.org_id
          where m.id = any($1::uuid[])`,
        [membershipIds],
      );
      for (const r of rows) out[`org_membership:${r.id}`] = { name: `${r.person} at ${r.org}`, path: "/admin/members" };
    }
    const pledgeIds = byType.get("item_pledge");
    if (pledgeIds?.length) {
      const rows = await q<{ id: string; donor: string; title: string; requestId: string }>(
        c,
        `select ip.id, p.first_name || ' ' || p.last_name as donor, r.title, r.id as "requestId"
           from item_pledges ip
           join people p on p.id = ip.person_id
           join item_requests r on r.id = ip.item_request_id
          where ip.id = any($1::uuid[])`,
        [pledgeIds],
      );
      for (const r of rows)
        out[`item_pledge:${r.id}`] = { name: `Pledge by ${r.donor} — ${r.title}`, path: `/items/${r.requestId}` };
    }
    const signupIds = byType.get("volunteer_signup");
    if (signupIds?.length) {
      const rows = await q<{ id: string; supporter: string; title: string; requestId: string }>(
        c,
        `select vs.id, p.first_name || ' ' || p.last_name as supporter, r.title, r.id as "requestId"
           from volunteer_signups vs
           join people p on p.id = vs.person_id
           join volunteer_requests r on r.id = vs.volunteer_request_id
          where vs.id = any($1::uuid[])`,
        [signupIds],
      );
      for (const r of rows)
        out[`volunteer_signup:${r.id}`] = {
          name: `Signup by ${r.supporter} — ${r.title}`,
          path: `/volunteer/${r.requestId}`,
        };
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Resend contexts — current data, one query bundle per entity type    */
/* ------------------------------------------------------------------ */

export type PersonFields = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
};

export type OrgResendContext = {
  id: string;
  name: string;
  city: string | null;
  addressFormatted: string | null;
  phone: string | null;
  websiteUrl: string | null;
  mission: string | null;
  populationsOther: string | null;
  populationNames: string[];
  contact: PersonFields | null;
};

export async function orgResendContext(ctx: DbContext, orgId: string): Promise<OrgResendContext | null> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<Omit<OrgResendContext, "populationNames" | "contact"> & { contactId: string | null }>(
      c,
      `select o.id, o.name, o.city, o.address_formatted as "addressFormatted", o.phone,
              o.website_url as "websiteUrl", o.mission, o.populations_other as "populationsOther",
              o.primary_contact_person_id as "contactId"
         from organizations o where o.id = $1`,
      [orgId],
    );
    const org = rows[0];
    if (!org) return null;
    const populations = await q<{ name: string }>(
      c,
      `select p.name from populations p join organization_populations op on op.population_id = p.id
        where op.org_id = $1 order by p.sort_order asc`,
      [orgId],
    );
    const contact = org.contactId
      ? (
          await q<PersonFields>(
            c,
            `select id, first_name as "firstName", last_name as "lastName", email, phone from people where id = $1`,
            [org.contactId],
          )
        )[0] ?? null
      : null;
    return {
      id: org.id,
      name: org.name,
      city: org.city,
      addressFormatted: org.addressFormatted,
      phone: org.phone,
      websiteUrl: org.websiteUrl,
      mission: org.mission,
      populationsOther: org.populationsOther,
      populationNames: populations.map((p) => p.name),
      contact,
    };
  });
}

export type RequestResendContext = {
  id: string;
  kind: "item" | "volunteer";
  title: string;
  description: string | null;
  details: string | null;
  dropoffLocation: string | null;
  deadlineType: string;
  deadlineDate: string | null;
  orgName: string;
  orgPrimaryContact: PersonFields | null;
  requestContact: PersonFields | null;
  children: { name: string; quantity: number }[];
};

export async function requestResendContext(
  ctx: DbContext,
  kind: "item" | "volunteer",
  requestId: string,
): Promise<RequestResendContext | null> {
  const table = kind === "item" ? "item_requests" : "volunteer_requests";
  const detailsCol = kind === "item" ? "null" : "r.details";
  const dropoffCol = kind === "item" ? "r.dropoff_location" : "null";
  return withDbContext(ctx, async (c) => {
    const rows = await q<{
      id: string;
      title: string;
      description: string | null;
      details: string | null;
      dropoffLocation: string | null;
      deadlineType: string;
      deadlineDate: string | null;
      orgName: string;
      orgContactId: string | null;
      requestContactId: string | null;
    }>(
      c,
      `select r.id, r.title, r.description, ${detailsCol} as details, ${dropoffCol} as "dropoffLocation",
              r.deadline_type as "deadlineType", r.deadline_date::text as "deadlineDate",
              o.name as "orgName", o.primary_contact_person_id as "orgContactId",
              r.contact_person_id as "requestContactId"
         from ${table} r join organizations o on o.id = r.org_id
        where r.id = $1`,
      [requestId],
    );
    const request = rows[0];
    if (!request) return null;
    const children =
      kind === "item"
        ? await q<{ name: string; quantity: number }>(
            c,
            `select name, quantity_requested as quantity from items where item_request_id = $1 order by sort_order asc`,
            [requestId],
          )
        : await q<{ name: string; quantity: number }>(
            c,
            `select name, quantity_needed as quantity from volunteer_roles where volunteer_request_id = $1 order by sort_order asc`,
            [requestId],
          );
    const person = async (id: string | null): Promise<PersonFields | null> =>
      id
        ? (
            await q<PersonFields>(
              c,
              `select id, first_name as "firstName", last_name as "lastName", email, phone from people where id = $1`,
              [id],
            )
          )[0] ?? null
        : null;
    return {
      id: request.id,
      kind,
      title: request.title,
      description: request.description,
      details: request.details,
      dropoffLocation: request.dropoffLocation,
      deadlineType: request.deadlineType,
      deadlineDate: request.deadlineDate,
      orgName: request.orgName,
      orgPrimaryContact: await person(request.orgContactId),
      requestContact: await person(request.requestContactId),
      children,
    };
  });
}

export type MembershipResendContext = {
  id: string;
  orgName: string;
  member: PersonFields;
  inviter: PersonFields | null;
};

export async function membershipResendContext(
  ctx: DbContext,
  membershipId: string,
): Promise<MembershipResendContext | null> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<{
      id: string;
      orgName: string;
      memberId: string;
      memberFirst: string;
      memberLast: string;
      memberEmail: string;
      memberPhone: string | null;
      inviterId: string | null;
      inviterFirst: string | null;
      inviterLast: string | null;
      inviterEmail: string | null;
      inviterPhone: string | null;
    }>(
      c,
      `select m.id, o.name as "orgName",
              p.id as "memberId", p.first_name as "memberFirst", p.last_name as "memberLast",
              p.email as "memberEmail", p.phone as "memberPhone",
              ip.id as "inviterId", ip.first_name as "inviterFirst", ip.last_name as "inviterLast",
              ip.email as "inviterEmail", ip.phone as "inviterPhone"
         from org_memberships m
         join organizations o on o.id = m.org_id
         join users u on u.id = m.user_id
         join people p on p.id = u.person_id
         left join users iu on iu.id = m.invited_by
         left join people ip on ip.id = iu.person_id
        where m.id = $1`,
      [membershipId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      orgName: row.orgName,
      member: {
        id: row.memberId,
        firstName: row.memberFirst,
        lastName: row.memberLast,
        email: row.memberEmail,
        phone: row.memberPhone,
      },
      inviter:
        row.inviterId && row.inviterFirst !== null
          ? {
              id: row.inviterId,
              firstName: row.inviterFirst,
              lastName: row.inviterLast ?? "",
              email: row.inviterEmail ?? "",
              phone: row.inviterPhone,
            }
          : null,
    };
  });
}

export type PledgeResendContext = {
  id: string;
  donor: PersonFields;
  notes: string | null;
  lines: { name: string; quantity: number }[];
  request: RequestResendContext;
};

export async function pledgeResendContext(ctx: DbContext, pledgeId: string): Promise<PledgeResendContext | null> {
  const base = await withDbContext(ctx, async (c) => {
    const rows = await q<{
      id: string;
      requestId: string;
      notes: string | null;
      donorId: string;
      donorFirst: string;
      donorLast: string;
      donorEmail: string;
      donorPhone: string | null;
    }>(
      c,
      `select ip.id, ip.item_request_id as "requestId", ip.notes,
              p.id as "donorId", p.first_name as "donorFirst", p.last_name as "donorLast",
              p.email as "donorEmail", p.phone as "donorPhone"
         from item_pledges ip join people p on p.id = ip.person_id
        where ip.id = $1`,
      [pledgeId],
    );
    const row = rows[0];
    if (!row) return null;
    const lines = await q<{ name: string; quantity: number }>(
      c,
      `select i.name, l.quantity from item_pledge_lines l join items i on i.id = l.item_id
        where l.item_pledge_id = $1 order by i.sort_order asc`,
      [pledgeId],
    );
    return { row, lines };
  });
  if (!base) return null;
  const request = await requestResendContext(ctx, "item", base.row.requestId);
  if (!request) return null;
  return {
    id: base.row.id,
    donor: {
      id: base.row.donorId,
      firstName: base.row.donorFirst,
      lastName: base.row.donorLast,
      email: base.row.donorEmail,
      phone: base.row.donorPhone,
    },
    notes: base.row.notes,
    lines: base.lines,
    request,
  };
}

export type SignupResendContext = {
  id: string;
  supporter: PersonFields;
  notes: string | null;
  roleNames: string[];
  request: RequestResendContext;
};

export async function signupResendContext(ctx: DbContext, signupId: string): Promise<SignupResendContext | null> {
  const base = await withDbContext(ctx, async (c) => {
    const rows = await q<{
      id: string;
      requestId: string;
      notes: string | null;
      supporterId: string;
      supporterFirst: string;
      supporterLast: string;
      supporterEmail: string;
      supporterPhone: string | null;
    }>(
      c,
      `select vs.id, vs.volunteer_request_id as "requestId", vs.notes,
              p.id as "supporterId", p.first_name as "supporterFirst", p.last_name as "supporterLast",
              p.email as "supporterEmail", p.phone as "supporterPhone"
         from volunteer_signups vs join people p on p.id = vs.person_id
        where vs.id = $1`,
      [signupId],
    );
    const row = rows[0];
    if (!row) return null;
    const roles = await q<{ name: string }>(
      c,
      `select vr.name from volunteer_signup_roles sr join volunteer_roles vr on vr.id = sr.volunteer_role_id
        where sr.volunteer_signup_id = $1 order by vr.sort_order asc`,
      [signupId],
    );
    return { row, roleNames: roles.map((r) => r.name) };
  });
  if (!base) return null;
  const request = await requestResendContext(ctx, "volunteer", base.row.requestId);
  if (!request) return null;
  return {
    id: base.row.id,
    supporter: {
      id: base.row.supporterId,
      firstName: base.row.supporterFirst,
      lastName: base.row.supporterLast,
      email: base.row.supporterEmail,
      phone: base.row.supporterPhone,
    },
    notes: base.row.notes,
    roleNames: base.roleNames,
    request,
  };
}
