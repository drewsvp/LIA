/**
 * Shared organization profile update contract.
 *
 * Member settings and direct staff-admin editing use the same validation,
 * identity rules, population checks, and transaction. Approval state is never
 * changed by this service.
 */
import { SYSTEM, withDbContext, type DbContext } from "../db/client";
import type { Organization } from "../../shared/types";
import * as organizations from "../dal/organizations";
import * as people from "../dal/people";
import * as populations from "../dal/populations";
import * as organizationRevisions from "../dal/organization-revisions";

export type OrganizationProfileFields = {
  name: string;
  websiteUrl: string;
  city: string;
  phone: string;
  mission: string;
  populationIds: string[];
  populationsOther: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  state?: string | null;
  postalCode?: string | null;
  /** New callers should omit this; it is derived from the address fields. */
  addressFormatted?: string | null;
  /** Set only when a new logo was stored this request; absent = keep current. */
  logoUrl?: string;
  contact: { firstName: string; lastName: string; email: string; phone: string };
};

export type UpdateOrganizationSettingsInput = {
  orgId: string;
  fields: OrganizationProfileFields;
  /** Present only for a direct staff-admin edit. */
  auditActorUserId?: string;
  /** SYSTEM preserves the existing member route's trusted server context. */
  dbContext?: DbContext;
};

export type OrganizationSettingsUpdateResult = {
  organization: Organization;
  previousLogoUrl: string | null;
};

export class OrganizationProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationProfileValidationError";
  }
}

export class OrganizationNotFoundError extends Error {
  constructor() {
    super("organization not found");
    this.name = "OrganizationNotFoundError";
  }
}

export class OrganizationNotEditableError extends Error {
  constructor() {
    super("only member organizations may be edited");
    this.name = "OrganizationNotEditableError";
  }
}

function required(value: string, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OrganizationProfileValidationError(`${label} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new OrganizationProfileValidationError(`${label} must be ${max.toLocaleString("en-US")} characters or fewer.`);
  }
  return trimmed;
}

function optional(value: string | null | undefined, label: string, max: number): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new OrganizationProfileValidationError(`${label} must be ${max.toLocaleString("en-US")} characters or fewer.`);
  }
  return trimmed;
}

function normalizeWebsite(value: string): string {
  const raw = required(value, "Website", 300);
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new OrganizationProfileValidationError("Website must be a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OrganizationProfileValidationError("Website must be a valid URL.");
  }
  return parsed.toString();
}

/** Shared server-side validation for both member and staff-admin callers. */
export function validateOrganizationProfileFields(input: OrganizationProfileFields): OrganizationProfileFields {
  const populationIds = [...new Set(input.populationIds)];
  if (populationIds.length < 1) {
    throw new OrganizationProfileValidationError("Select at least one population.");
  }
  if (populationIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new OrganizationProfileValidationError("Selected populations are invalid.");
  }
  const fields: OrganizationProfileFields = {
    name: required(input.name, "Organization name", 200),
    websiteUrl: normalizeWebsite(input.websiteUrl),
    city: required(input.city, "City", 120),
    phone: required(input.phone, "Main phone", 40),
    mission: required(input.mission, "Mission statement", 5000),
    populationIds,
    populationsOther: optional(input.populationsOther, "Other population details", 300),
    ...(input.addressLine1 !== undefined
      ? { addressLine1: optional(input.addressLine1, "Address line 1", 200) }
      : {}),
    ...(input.addressLine2 !== undefined
      ? { addressLine2: optional(input.addressLine2, "Address line 2", 200) }
      : {}),
    ...(input.state !== undefined ? { state: optional(input.state, "State", 80) } : {}),
    ...(input.postalCode !== undefined
      ? { postalCode: optional(input.postalCode, "Postal code", 30) }
      : {}),
    contact: {
      firstName: required(input.contact.firstName, "Contact first name", 120),
      lastName: required(input.contact.lastName, "Contact last name", 120),
      email: required(input.contact.email, "Contact email", 254).toLowerCase(),
      phone: required(input.contact.phone, "Contact phone", 40),
    },
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.contact.email)) {
    throw new OrganizationProfileValidationError("Contact email is not valid.");
  }
  return fields;
}

function formattedAddress(fields: OrganizationProfileFields): string | null {
  const cityLine = [fields.city, fields.state].filter(Boolean).join(", ");
  const parts = [fields.addressLine1, fields.addressLine2, [cityLine, fields.postalCode].filter(Boolean).join(" ")]
    .filter((part): part is string => Boolean(part))
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

type AuditValue = string | string[] | null;
type AuditFields = organizationRevisions.OrganizationChangedFields;

function changedFields(
  before: Record<string, AuditValue>,
  after: Record<string, AuditValue>,
): AuditFields {
  const result: AuditFields = {};
  for (const key of Object.keys(after)) {
    const oldValue = before[key];
    const newValue = after[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      result[key] = { before: oldValue ?? null, after: newValue ?? null };
    }
  }
  return result;
}

export async function updateOrganizationSettings(
  input: UpdateOrganizationSettingsInput,
): Promise<OrganizationSettingsUpdateResult> {
  const fields = validateOrganizationProfileFields(input.fields);
  const context = input.dbContext ?? SYSTEM;
  return withDbContext(context, async (c) => {
    const org = await organizations.getByIdInTx(c, input.orgId);
    if (org === null) throw new OrganizationNotFoundError();
    if (org.kind !== "member_org") throw new OrganizationNotEditableError();

    const [allPopulations, currentSelection] = await Promise.all([
      populations.listAllInTx(c),
      populations.listByOrganizationInTx(c, input.orgId),
    ]);
    const currentIds = new Set(currentSelection.map((population) => population.id));
    const legal = new Map(
      allPopulations
        .filter((population) => population.isActive || currentIds.has(population.id))
        .map((population) => [population.id, population]),
    );
    for (const id of fields.populationIds) {
      if (!legal.has(id)) throw new OrganizationProfileValidationError("One selected population is no longer available.");
    }
    const otherSelected = fields.populationIds.some((id) => legal.get(id)?.slug === "other");
    const editsStructuredAddress =
      fields.addressLine1 !== undefined ||
      fields.addressLine2 !== undefined ||
      fields.state !== undefined ||
      fields.postalCode !== undefined;
    const addressFields: OrganizationProfileFields = {
      ...fields,
      addressLine1: fields.addressLine1 === undefined ? org.addressLine1 : fields.addressLine1,
      addressLine2: fields.addressLine2 === undefined ? org.addressLine2 : fields.addressLine2,
      state: fields.state === undefined ? org.state : fields.state,
      postalCode: fields.postalCode === undefined ? org.postalCode : fields.postalCode,
    };
    const nextAddressFormatted = editsStructuredAddress ? formattedAddress(addressFields) : org.addressFormatted;
    const contactBefore = org.primaryContactPersonId
      ? await people.getByIdInTx(c, org.primaryContactPersonId)
      : null;

    let contactPersonId = org.primaryContactPersonId;
    if (contactPersonId === null) {
      const existing = await people.findByEmailInTx(c, fields.contact.email);
      if (existing !== null && !(await people.isVisibleToOrgInTx(c, existing.id, input.orgId))) {
        throw new people.ContactNotVisibleError();
      }
      contactPersonId =
        existing?.id ??
        (
          await people.createInTx(c, {
            firstName: fields.contact.firstName,
            lastName: fields.contact.lastName,
            email: fields.contact.email,
            phone: fields.contact.phone,
            sourceNote: "organization settings (MP-05)",
          })
        ).id;
    }
    await people.updateContactInTx(c, contactPersonId, fields.contact);

    const updated = await organizations.updateDetailsInTx(c, input.orgId, {
      name: fields.name,
      websiteUrl: fields.websiteUrl,
      city: fields.city,
      phone: fields.phone,
      mission: fields.mission,
      populationsOther: otherSelected ? fields.populationsOther : null,
      addressLine1: addressFields.addressLine1 ?? null,
      addressLine2: addressFields.addressLine2 ?? null,
      state: addressFields.state ?? null,
      postalCode: addressFields.postalCode ?? null,
      addressFormatted: nextAddressFormatted,
      primaryContactPersonId: contactPersonId,
      ...(fields.logoUrl !== undefined ? { logoUrl: fields.logoUrl } : {}),
    });
    await populations.setForOrganizationInTx(c, input.orgId, fields.populationIds);

    if (input.auditActorUserId) {
      const before: Record<string, AuditValue> = {
        name: org.name,
        websiteUrl: org.websiteUrl,
        mission: org.mission,
        phone: org.phone,
        addressLine1: org.addressLine1,
        addressLine2: org.addressLine2,
        city: org.city,
        state: org.state,
        postalCode: org.postalCode,
        addressFormatted: org.addressFormatted,
        logoUrl: org.logoUrl,
        populationsOther: org.populationsOther,
        populations: currentSelection.map((population) => population.name),
        "contact.firstName": contactBefore?.firstName ?? null,
        "contact.lastName": contactBefore?.lastName ?? null,
        "contact.email": contactBefore?.email ?? null,
        "contact.phone": contactBefore?.phone ?? null,
      };
      const after: Record<string, AuditValue> = {
        name: updated.name,
        websiteUrl: updated.websiteUrl,
        mission: updated.mission,
        phone: updated.phone,
        addressLine1: updated.addressLine1,
        addressLine2: updated.addressLine2,
        city: updated.city,
        state: updated.state,
        postalCode: updated.postalCode,
        addressFormatted: updated.addressFormatted,
        logoUrl: updated.logoUrl,
        populationsOther: updated.populationsOther,
        populations: fields.populationIds.map((id) => legal.get(id)!.name),
        "contact.firstName": fields.contact.firstName,
        "contact.lastName": fields.contact.lastName,
        "contact.email": fields.contact.email,
        "contact.phone": fields.contact.phone,
      };
      await organizationRevisions.insertInTx(c, {
        organizationId: input.orgId,
        actorUserId: input.auditActorUserId,
        changedFields: changedFields(before, after),
      });
    }
    return { organization: updated, previousLogoUrl: org.logoUrl };
  });
}