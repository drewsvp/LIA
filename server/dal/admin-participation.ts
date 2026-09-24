/**
 * Staff-wide participation directory.
 *
 * These queries intentionally start at the authoritative item_pledges and
 * volunteer_signups relationships rather than deriving participation from
 * request counters. The staff context is still required by the caller, and
 * this DAL uses the staff DB context so it can see every organization.
 */
import { q, withDbContext, type DbContext } from "../db/client";
import type {
  AdminDonationRow,
  AdminParticipationPage,
  AdminVolunteerRow,
} from "../../shared/types";

export type ParticipationFilters = {
  page: number;
  pageSize: number;
  search?: string;
  supporter?: string;
  organization?: string;
  request?: string;
  organizationId?: string;
  requestId?: string;
  from?: string;
  to?: string;
  snapshotAt?: string;
  participationId?: string;
  sort?: "supporter" | "notes" | "organization" | "request" | "date" | "details" | "status";
  direction?: "asc" | "desc";
};

export type AdminParticipationResult =
  | AdminParticipationPage<AdminDonationRow>
  | AdminParticipationPage<AdminVolunteerRow>;

function filterSql(
  filters: ParticipationFilters,
  tableAlias: "ip" | "vs",
  requestAlias: "r",
  params: unknown[],
): string {
  const clauses: string[] = [];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const supporterText = filters.supporter?.trim();
  const organizationText = filters.organization?.trim();
  const requestText = filters.request?.trim();
  const search = filters.search?.trim();

  if (search) {
    const p = add(`%${search}%`);
    clauses.push(`(
      lower(concat_ws(' ', p.first_name, p.last_name)) like lower(${p})
      or lower(p.email) like lower(${p})
      or coalesce(p.phone, '') like ${p}
      or lower(o.name) like lower(${p})
      or lower(${requestAlias}.title) like lower(${p})
      or lower(coalesce(${tableAlias}.notes, '')) like lower(${p})
      or lower(coalesce(${tableAlias}.status, '')) like lower(${p})
      or lower(coalesce(${tableAlias}.cancellation_reason, '')) like lower(${p})
      or to_char(${tableAlias}.created_at, 'Mon DD, YYYY') ilike ${p}
      or ${tableAlias === "ip"
        ? `exists (select 1 from item_pledge_lines sl join items si on si.id = sl.item_id where sl.item_pledge_id = ${tableAlias}.id and lower(si.name) like lower(${p}))`
        : `exists (select 1 from volunteer_signup_roles sr join volunteer_roles sv on sv.id = sr.volunteer_role_id where sr.volunteer_signup_id = ${tableAlias}.id and lower(sv.name) like lower(${p}))`}
    )`);
  }
  if (supporterText) {
    const p = add(`%${supporterText}%`);
    clauses.push(`(
      lower(concat_ws(' ', p.first_name, p.last_name)) like lower(${p})
      or lower(p.email) like lower(${p})
      or coalesce(p.phone, '') like ${p}
    )`);
  }
  if (organizationText) {
    clauses.push(`lower(o.name) like lower(${add(`%${organizationText}%`)})`);
  }
  if (requestText) {
    clauses.push(`lower(${requestAlias}.title) like lower(${add(`%${requestText}%`)})`);
  }
  if (filters.organizationId) clauses.push(`o.id = ${add(filters.organizationId)}`);
  if (filters.requestId) clauses.push(`${requestAlias}.id = ${add(filters.requestId)}`);
  if (filters.participationId) clauses.push(`${tableAlias}.id = ${add(filters.participationId)}`);
  if (filters.from) {
    clauses.push(`(${tableAlias}.created_at at time zone 'America/Los_Angeles')::date >= ${add(filters.from)}::date`);
  }
  if (filters.to) {
    clauses.push(`(${tableAlias}.created_at at time zone 'America/Los_Angeles')::date <= ${add(filters.to)}::date`);
  }
  if (filters.snapshotAt) clauses.push(`${tableAlias}.created_at <= ${add(filters.snapshotAt)}::timestamptz`);
  return clauses.length > 0 ? `and ${clauses.join("\n          and ")}` : "";
}

async function list(
  ctx: DbContext,
  filters: ParticipationFilters,
  kind: "item" | "volunteer",
): Promise<AdminParticipationResult> {
  const tableAlias = kind === "item" ? "ip" : "vs";
  const childJson =
    kind === "item"
      ? `(select coalesce(json_agg(json_build_object(
            'id', l.item_id, 'name', i.name, 'quantity', l.quantity)
            order by i.sort_order, i.id), '[]'::json)
           from item_pledge_lines l join items i on i.id = l.item_id
          where l.item_pledge_id = ip.id)`
      : `(select coalesce(json_agg(json_build_object(
            'id', sr.volunteer_role_id, 'name', vr.name)
            order by vr.sort_order, vr.id), '[]'::json)
           from volunteer_signup_roles sr join volunteer_roles vr on vr.id = sr.volunteer_role_id
          where sr.volunteer_signup_id = vs.id)`;

  const baseFrom =
    kind === "item"
      ? `from item_pledges ip
         join people p on p.id = ip.person_id
         join item_requests r on r.id = ip.item_request_id
         join organizations o on o.id = r.org_id`
      : `from volunteer_signups vs
         join people p on p.id = vs.person_id
         join volunteer_requests r on r.id = vs.volunteer_request_id
         join organizations o on o.id = r.org_id`;
  return withDbContext(ctx, async (c) => {
    const snapshotRows = filters.snapshotAt
      ? [{ snapshotAt: filters.snapshotAt }]
      : await q<{ snapshotAt: string }>(c, `select now() as "snapshotAt"`);
    const snapshotAt = snapshotRows[0]?.snapshotAt;
    if (!snapshotAt) throw new Error("admin participation snapshot query returned no row");
    const effectiveFilters = { ...filters, snapshotAt };
    const sortColumns = kind === "item"
      ? {
          supporter: "lower(concat_ws(' ', p.last_name, p.first_name))",
          notes: "lower(coalesce(ip.notes, ''))",
          organization: "lower(o.name)",
          request: "lower(r.title)",
          date: "ip.created_at",
          details: "(select min(lower(i2.name)) from item_pledge_lines l2 join items i2 on i2.id = l2.item_id where l2.item_pledge_id = ip.id)",
          status: "ip.status",
        }
      : {
          supporter: "lower(concat_ws(' ', p.last_name, p.first_name))",
          notes: "lower(coalesce(vs.notes, ''))",
          organization: "lower(o.name)",
          request: "lower(r.title)",
          date: "vs.created_at",
          details: "(select min(lower(vr2.name)) from volunteer_signup_roles sr2 join volunteer_roles vr2 on vr2.id = sr2.volunteer_role_id where sr2.volunteer_signup_id = vs.id)",
          status: "vs.status",
        };
    const sort = sortColumns[filters.sort ?? "date"] ?? sortColumns.date;
    const direction = filters.direction === "asc" ? "asc" : "desc";
    const countParams: unknown[] = [];
    const where = filterSql(effectiveFilters, tableAlias, "r", countParams);
    const countRows = await q<{ total: number }>(
      c,
      `select count(*)::int as total ${baseFrom} where true ${where}`,
      countParams,
    );
    const total = countRows[0]?.total ?? 0;
    const page = filters.page;
    const pageSize = filters.pageSize;
    const offset = (page - 1) * pageSize;
    const rowParams: unknown[] = [];
    const rowWhere = filterSql(effectiveFilters, tableAlias, "r", rowParams);
    rowParams.push(pageSize, offset);
    const rows =
      kind === "item"
        ? await q<AdminDonationRow>(
            c,
            `select ip.id, ip.person_id as "personId", p.needs_review as "personNeedsReview",
                    p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone, ip.notes,
                    ip.status, ip.cancelled_at as "cancelledAt", ip.cancelled_by as "cancelledBy",
                    ip.cancellation_reason as "cancellationReason",
                    nullif(trim(concat_ws(' ', cp.first_name, cp.last_name)), '') as "cancelledByName",
                    o.id as "organizationId", o.name as "organizationName",
                    r.id as "requestId", r.title as "requestTitle", ip.created_at as "createdAt",
                    ip.updated_at as "updatedAt", ip.participation_version::int as "participationVersion",
                    ${childJson} as lines
               ${baseFrom}
              left join users cu on cu.id = ip.cancelled_by
              left join people cp on cp.id = cu.person_id
              where true ${rowWhere}
              order by ${sort} ${direction} nulls last, ip.id desc
              limit $${rowParams.length - 1} offset $${rowParams.length}`,
            rowParams,
          )
        : await q<AdminVolunteerRow>(
            c,
            `select vs.id, vs.person_id as "personId", p.needs_review as "personNeedsReview",
                    p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone, vs.notes,
                    vs.status, vs.cancelled_at as "cancelledAt", vs.cancelled_by as "cancelledBy",
                    vs.cancellation_reason as "cancellationReason",
                    nullif(trim(concat_ws(' ', cp.first_name, cp.last_name)), '') as "cancelledByName",
                    o.id as "organizationId", o.name as "organizationName",
                    r.id as "requestId", r.title as "requestTitle", vs.created_at as "createdAt",
                    vs.updated_at as "updatedAt", vs.participation_version::int as "participationVersion",
                    ${childJson} as roles
               ${baseFrom}
              left join users cu on cu.id = vs.cancelled_by
              left join people cp on cp.id = cu.person_id
              where true ${rowWhere}
              order by ${sort} ${direction} nulls last, vs.id desc
              limit $${rowParams.length - 1} offset $${rowParams.length}`,
            rowParams,
          );

    const normalizedRows = rows.map((row) => {
      const raw = row as unknown as Record<string, unknown>;
      const normalized = {
        ...row,
        organization: { id: raw.organizationId as string, name: raw.organizationName as string },
        request: {
          id: raw.requestId as string,
          type: kind,
          title: raw.requestTitle as string,
        },
      };
      const flat = normalized as unknown as Record<string, unknown>;
      delete flat.organizationId;
      delete flat.organizationName;
      delete flat.requestId;
      delete flat.requestTitle;
      return normalized;
    }) as unknown as AdminDonationRow[] | AdminVolunteerRow[];
    return {
      rows: normalizedRows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      snapshotAt,
    } as AdminParticipationResult;
  });
}

export function listDonations(ctx: DbContext, filters: ParticipationFilters): Promise<AdminParticipationResult> {
  return list(ctx, filters, "item");
}

export function listVolunteers(ctx: DbContext, filters: ParticipationFilters): Promise<AdminParticipationResult> {
  return list(ctx, filters, "volunteer");
}

export async function getDonation(ctx: DbContext, id: string): Promise<AdminDonationRow | null> {
  const result = await list(ctx, { page: 1, pageSize: 1, participationId: id }, "item");
  return (result.rows[0] as AdminDonationRow | undefined) ?? null;
}

export async function getVolunteer(ctx: DbContext, id: string): Promise<AdminVolunteerRow | null> {
  const result = await list(ctx, { page: 1, pageSize: 1, participationId: id }, "volunteer");
  return (result.rows[0] as AdminVolunteerRow | undefined) ?? null;
}