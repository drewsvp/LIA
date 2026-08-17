/**
 * MP-05 — organization settings save (docs/specs/MP-05.md §6).
 *
 * One transaction: organization fields, the population set, and the primary
 * contact's people row. Ordinary field edits are NOT approval events (§5) —
 * nothing here touches status, approved_at, or approved_by, so an approved
 * organization never re-enters the queue.
 */
import { SYSTEM, withDbContext } from "../db/client";
import * as organizations from "../dal/organizations";
import * as people from "../dal/people";
import * as populations from "../dal/populations";

export type UpdateOrganizationSettingsInput = {
  orgId: string;
  name: string;
  websiteUrl: string;
  city: string;
  phone: string;
  mission: string;
  populationIds: string[];
  populationsOther: string | null;
  /** Set only when a new logo was stored this request; absent = keep current. */
  logoUrl?: string;
  contact: { firstName: string; lastName: string; email: string; phone: string };
};

export async function updateOrganizationSettings(input: UpdateOrganizationSettingsInput): Promise<void> {
  // Validate populations against known rows: active ones are selectable, and
  // a row the organization already has stays legal even if deactivated since.
  const [allPopulations, currentSelection, org] = await Promise.all([
    populations.listAll(SYSTEM),
    populations.listByOrganization(SYSTEM, input.orgId),
    organizations.getById(SYSTEM, input.orgId),
  ]);
  if (org === null) throw new Error(`org-settings: organization not found: ${input.orgId}`);
  const currentIds = new Set(currentSelection.map((p) => p.id));
  const legal = new Map(allPopulations.filter((p) => p.isActive || currentIds.has(p.id)).map((p) => [p.id, p]));
  for (const id of input.populationIds) {
    if (!legal.has(id)) throw new Error(`org-settings: unknown population id: ${id}`);
  }
  const otherSelected = input.populationIds.some((id) => legal.get(id)?.slug === "other");

  await withDbContext(SYSTEM, async (c) => {
    // Resolve the contact person first so the organization patch can point at
    // them. Normal case: the org already has a primary contact and this
    // updates that person's row in place (§5 fields 9–11 bind to people.*).
    let contactPersonId = org.primaryContactPersonId;
    if (contactPersonId === null) {
      // A resolved person must already be visible to this org — this branch
      // follows the resolve with updateContactInTx, so without the gate an
      // org with no contact yet could both read AND overwrite a stranger's
      // people row from just their email (§11).
      const existing = await people.findByEmailInTx(c, input.contact.email);
      if (existing !== null && !(await people.isVisibleToOrgInTx(c, existing.id, input.orgId))) {
        throw new people.ContactNotVisibleError();
      }
      contactPersonId =
        existing?.id ??
        (
          await people.createInTx(c, {
            firstName: input.contact.firstName,
            lastName: input.contact.lastName,
            email: input.contact.email,
            phone: input.contact.phone,
            sourceNote: "organization settings (MP-05)",
          })
        ).id;
    }
    await people.updateContactInTx(c, contactPersonId, {
      firstName: input.contact.firstName,
      lastName: input.contact.lastName,
      email: input.contact.email,
      phone: input.contact.phone,
    });

    await organizations.updateDetailsInTx(c, input.orgId, {
      name: input.name,
      websiteUrl: input.websiteUrl,
      city: input.city,
      phone: input.phone,
      mission: input.mission,
      populationsOther: otherSelected ? input.populationsOther : null,
      primaryContactPersonId: contactPersonId,
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
    });
    await populations.setForOrganizationInTx(c, input.orgId, input.populationIds);
  });
}
