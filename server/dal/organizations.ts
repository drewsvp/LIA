/**
 * Organizations — member orgs and the single platform_owner (The Alliance).
 * Status transitions write approval_events in the same transaction.
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { Organization, OrganizationKind, OrganizationStatus, PublicOrganization } from "../../shared/types";
import { insertInTx } from "./approval-events";

const COLS = `id, legacy_wix_id as "legacyWixId", kind, name, slug, website_url as "websiteUrl",
  mission, phone, logo_url as "logoUrl", populations_other as "populationsOther",
  address_line1 as "addressLine1", address_line2 as "addressLine2", city, state,
  postal_code as "postalCode", address_formatted as "addressFormatted",
  primary_contact_person_id as "primaryContactPersonId", status, approved_at as "approvedAt",
  approved_by as "approvedBy", created_at as "createdAt", updated_at as "updatedAt"`;

export type CreateOrganizationInput = {
  name: string;
  slug: string;
  kind?: OrganizationKind;
  websiteUrl?: string | null;
  mission?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressFormatted?: string | null;
  populationsOther?: string | null;
  primaryContactPersonId?: string | null;
  logoUrl?: string | null;
};

export type UpdateOrganizationPatch = Partial<{
  name: string;
  websiteUrl: string | null;
  mission: string | null;
  phone: string | null;
  logoUrl: string | null;
  populationsOther: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  addressFormatted: string | null;
  primaryContactPersonId: string | null;
}>;

const PATCH_COLUMNS: Record<keyof UpdateOrganizationPatch, string> = {
  name: "name",
  websiteUrl: "website_url",
  mission: "mission",
  phone: "phone",
  logoUrl: "logo_url",
  populationsOther: "populations_other",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  addressFormatted: "address_formatted",
  primaryContactPersonId: "primary_contact_person_id",
};

export async function getById(ctx: DbContext, orgId: string): Promise<Organization | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<Organization>(c, `select ${COLS} from organizations where id = $1`, [orgId]),
  );
  return rows[0] ?? null;
}

export async function getBySlug(ctx: DbContext, slug: string): Promise<Organization | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<Organization>(c, `select ${COLS} from organizations where slug = $1`, [slug]),
  );
  return rows[0] ?? null;
}

/** The one platform_owner organization (The Alliance). */
export async function getPlatformOwner(ctx: DbContext): Promise<Organization | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<Organization>(c, `select ${COLS} from organizations where kind = 'platform_owner'`),
  );
  return rows[0] ?? null;
}

/** Organizations by status, name order (ADMIN-01 groups by status). */
export async function listByStatus(ctx: DbContext, status: OrganizationStatus): Promise<Organization[]> {
  return withDbContext(ctx, (c) =>
    q<Organization>(c, `select ${COLS} from organizations where status = $1 order by name asc`, [status]),
  );
}

export async function listAll(ctx: DbContext): Promise<Organization[]> {
  return withDbContext(ctx, (c) => q<Organization>(c, `select ${COLS} from organizations order by name asc`));
}

/** Public display fields of approved member organizations. */
export async function listApprovedForPublic(ctx: DbContext): Promise<PublicOrganization[]> {
  return withDbContext(ctx, (c) =>
    q<PublicOrganization>(
      c,
      `select id, name, slug, mission, website_url as "websiteUrl", city, logo_url as "logoUrl"
         from organizations where kind = 'member_org' and status = 'approved' order by name asc`,
    ),
  );
}

/** Create an organization; starts pending (MP-03). No approval event yet — approval writes it. */
export async function create(ctx: DbContext, input: CreateOrganizationInput): Promise<Organization> {
  return withDbContext(ctx, (c) => createInTx(c, input));
}

/** Transaction-composable variant (MP-03 one-tx signup). */
export async function createInTx(c: PoolClient, input: CreateOrganizationInput): Promise<Organization> {
  const rows = await q<Organization>(
    c,
    `insert into organizations (kind, name, slug, website_url, mission, phone, city, state,
       postal_code, address_line1, address_line2, address_formatted, populations_other,
       primary_contact_person_id, logo_url, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending')
     returning ${COLS}`,
    [
      input.kind ?? "member_org",
      input.name,
      input.slug,
      input.websiteUrl ?? null,
      input.mission ?? null,
      input.phone ?? null,
      input.city ?? null,
      input.state ?? null,
      input.postalCode ?? null,
      input.addressLine1 ?? null,
      input.addressLine2 ?? null,
      input.addressFormatted ?? null,
      input.populationsOther ?? null,
      input.primaryContactPersonId ?? null,
      input.logoUrl ?? null,
    ],
  );
  const org = rows[0];
  if (!org) throw new Error("organizations.create returned no row");
  return org;
}

/**
 * Approve an organization; writes the approval event in the same transaction.
 * Sources: pending (first approval) and disabled (deliberate re-enable — the
 * only recovery path from a mistaken disable; the event trail records it).
 */
export async function approve(ctx: DbContext, orgId: string, approvedByUserId: string): Promise<Organization> {
  return withDbContext(ctx, (c) => approveInTx(c, orgId, approvedByUserId));
}

/**
 * Tx-composable variant (ADMIN-01: org approval, owner-membership activation,
 * both events, and the welcome email_log row share one transaction).
 * V1-style stamp: approved_at = now(), approved_by = the acting staff user,
 * in the same statement as the status change.
 */
export async function approveInTx(c: PoolClient, orgId: string, approvedByUserId: string): Promise<Organization> {
  const current = await q<{ status: string }>(c, `select status from organizations where id = $1 for update`, [orgId]);
  const from = current[0]?.status;
  if (!from) throw new Error(`organizations.approve: organization not found: ${orgId}`);
  if (from === "approved") throw new Error("organizations.approve: already approved");
  const rows = await q<Organization>(
    c,
    `update organizations set status = 'approved', approved_at = now(), approved_by = $2
      where id = $1 returning ${COLS}`,
    [orgId, approvedByUserId],
  );
  const org = rows[0];
  if (!org) throw new Error(`organizations.approve: update failed: ${orgId}`);
  await insertInTx(c, {
    entityType: "organization",
    entityId: orgId,
    fromStatus: from,
    toStatus: "approved",
    actorUserId: approvedByUserId,
  });
  return org;
}

/** Row shape for the ADMIN-01 queue list: org columns plus contact display fields. */
export type OrganizationWithContact = Organization & {
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

/**
 * ADMIN-01 queue rows: member organizations by status, joined to the primary
 * contact's display fields. The platform owner is deliberately excluded — the
 * approval queue manages member organizations; disabling the platform owner
 * from its own admin would sever staff access.
 */
export async function listByStatusWithContact(
  ctx: DbContext,
  status: OrganizationStatus,
): Promise<OrganizationWithContact[]> {
  // COLS is unqualified (single-table queries); this join needs o.-prefixed
  // columns or `id` is ambiguous against people.
  const oCols = `o.id, o.legacy_wix_id as "legacyWixId", o.kind, o.name, o.slug, o.website_url as "websiteUrl",
    o.mission, o.phone, o.logo_url as "logoUrl", o.populations_other as "populationsOther",
    o.address_line1 as "addressLine1", o.address_line2 as "addressLine2", o.city, o.state,
    o.postal_code as "postalCode", o.address_formatted as "addressFormatted",
    o.primary_contact_person_id as "primaryContactPersonId", o.status, o.approved_at as "approvedAt",
    o.approved_by as "approvedBy", o.created_at as "createdAt", o.updated_at as "updatedAt"`;
  return withDbContext(ctx, (c) =>
    q<OrganizationWithContact>(
      c,
      `select ${oCols}, p.first_name as "contactFirstName", p.last_name as "contactLastName",
              p.email as "contactEmail", p.phone as "contactPhone"
         from organizations o
         left join people p on p.id = o.primary_contact_person_id
        where o.status = $1 and o.kind = 'member_org'
        order by o.created_at asc, o.name asc`,
      [status],
    ),
  );
}

/** Disable an organization; writes the event in the same transaction. */
export async function disable(
  ctx: DbContext,
  orgId: string,
  actorUserId: string,
  note?: string,
): Promise<Organization> {
  return withDbContext(ctx, async (c) => {
    const current = await q<{ status: string }>(c, `select status from organizations where id = $1 for update`, [orgId]);
    const from = current[0]?.status;
    if (!from) throw new Error(`organizations.disable: organization not found: ${orgId}`);
    if (from === "disabled") throw new Error("organizations.disable: already disabled");
    const rows = await q<Organization>(
      c,
      `update organizations set status = 'disabled' where id = $1 returning ${COLS}`,
      [orgId],
    );
    const org = rows[0];
    if (!org) throw new Error(`organizations.disable: update failed: ${orgId}`);
    await insertInTx(c, {
      entityType: "organization",
      entityId: orgId,
      fromStatus: from,
      toStatus: "disabled",
      actorUserId,
      note: note ?? null,
    });
    return org;
  });
}

/** Update organization details. Org-scoped: orgId comes from the session, never the caller. */
export async function updateDetails(
  ctx: DbContext,
  orgId: string,
  patch: UpdateOrganizationPatch,
): Promise<Organization> {
  return withDbContext(ctx, (c) => updateDetailsInTx(c, orgId, patch));
}

/** Tx-composable variant (MP-05 settings save updates several tables at once). */
export async function updateDetailsInTx(
  c: PoolClient,
  orgId: string,
  patch: UpdateOrganizationPatch,
): Promise<Organization> {
  const keys = Object.keys(patch) as (keyof UpdateOrganizationPatch)[];
  if (keys.length === 0) {
    const existing = await q<Organization>(c, `select ${COLS} from organizations o where o.id = $1`, [orgId]);
    if (!existing[0]) throw new Error(`organizations.updateDetails: not found: ${orgId}`);
    return existing[0];
  }
  const sets: string[] = [];
  const params: unknown[] = [orgId];
  for (const key of keys) {
    params.push(patch[key] ?? null);
    sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
  }
  const rows = await q<Organization>(
    c,
    `update organizations set ${sets.join(", ")} where id = $1 returning ${COLS}`,
    params,
  );
  const org = rows[0];
  if (!org) throw new Error(`organizations.updateDetails: not found: ${orgId}`);
  return org;
}

/**
 * Re-point organization approved_by references from one user to another.
 * Seed-migration support (legacy synthetic staff_admin removal). Returns how
 * many rows changed.
 */
export async function reassignApprover(ctx: DbContext, fromUserId: string, toUserId: string): Promise<number> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `update organizations set approved_by = $2 where approved_by = $1 returning id`, [
      fromUserId,
      toUserId,
    ]),
  );
  return rows.length;
}

/** Set an organization's primary contact person. */
export async function setPrimaryContact(ctx: DbContext, orgId: string, personId: string): Promise<Organization> {
  const rows = await withDbContext(ctx, (c) =>
    q<Organization>(c, `update organizations set primary_contact_person_id = $2 where id = $1 returning ${COLS}`, [
      orgId,
      personId,
    ]),
  );
  const org = rows[0];
  if (!org) throw new Error(`organizations.setPrimaryContact: not found: ${orgId}`);
  return org;
}
