/**
 * MP-03 — organization self-registration.
 *
 * ONE transaction (spec §3): organization (pending) + primary-contact person
 * (find-or-create by email, §12 — one human, one row) + user (invited) +
 * owner membership (pending) + population links + approval event (null
 * actor) + the staff_new_org email_log rows. Every write succeeds or none
 * do; a half-created organization is the exact failure this shape prevents.
 *
 * Dispatch happens AFTER commit via dispatchQueuedEmails — the log rows are
 * part of the transaction, the provider call never is.
 */
import { SYSTEM, withDbContext, q } from "../db/client";
import * as organizations from "../dal/organizations";
import * as people from "../dal/people";
import * as users from "../dal/users";
import * as memberships from "../dal/memberships";
import * as populations from "../dal/populations";
import { insertInTx as insertApprovalEventInTx } from "../dal/approval-events";
import { queueProductEmailInTx, absoluteUrl, type PendingDispatch } from "../email/send";

/** §7: a colliding organization name is blocked, never suffixed. */
export class OrgNameTakenError extends Error {
  constructor() {
    super("organization name already registered");
    this.name = "OrgNameTakenError";
  }
}

export type OrgSignupInput = {
  name: string;
  websiteUrl: string;
  city: string;
  phone: string;
  mission: string;
  /** 1-2 population ids, validated against active rows inside the tx. */
  populationIds: string[];
  /** Stored only when the Other population is among the selections (§7). */
  populationsOther: string | null;
  /** Already stored (or null after a non-blocking upload failure, §12). */
  logoUrl: string | null;
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
};

export type OrgSignupResult = { orgId: string; dispatches: PendingDispatch[] };

/** Seed convention ("Hearts & Hands…" → "hearts-hands-family-services"). */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base === "" ? "organization" : base;
}

export async function submitOrganizationSignup(input: OrgSignupInput): Promise<OrgSignupResult> {
  return withDbContext(SYSTEM, async (c) => {
    // §7: name collision is blocked with the §8 message, never suffixed.
    const nameHit = await q<{ x: number }>(c, `select 1 as x from organizations where lower(name) = lower($1)`, [
      input.name,
    ]);
    if (nameHit.length > 0) throw new OrgNameTakenError();

    // Slug is generated, permanent once assigned (§5). Distinct names may
    // still collide on slug — suffix the SLUG only, never the name.
    const base = slugify(input.name);
    let slug = base;
    for (let i = 2; ; i++) {
      const slugHit = await q<{ x: number }>(c, `select 1 as x from organizations where slug = $1`, [slug]);
      if (slugHit.length === 0) break;
      if (i > 50) throw new Error(`could not derive a unique slug from ${JSON.stringify(input.name)}`);
      slug = `${base}-${i}`;
    }

    // Selections must be real, active populations (D61).
    const popRows = await q<{ id: string; slug: string }>(
      c,
      `select id, slug from populations where id = any($1::uuid[]) and is_active = true`,
      [input.populationIds],
    );
    if (popRows.length !== input.populationIds.length) {
      throw new Error("one or more selected populations are unknown or inactive");
    }
    const otherSelected = popRows.some((p) => p.slug === "other");

    // §12: an existing email attaches the existing person — names on that row
    // are canon and are not overwritten here.
    const existingPerson = await people.findByEmailInTx(c, input.contact.email);
    const person =
      existingPerson ??
      (await people.createInTx(c, {
        firstName: input.contact.firstName,
        lastName: input.contact.lastName,
        email: input.contact.email,
        phone: input.contact.phone,
        sourceNote: "organization signup (MP-03)",
      }));

    const existingUser = await users.findByPersonIdInTx(c, person.id);
    const user = existingUser ?? (await users.createInTx(c, { personId: person.id }));

    const org = await organizations.createInTx(c, {
      name: input.name,
      slug,
      websiteUrl: input.websiteUrl,
      mission: input.mission,
      phone: input.phone,
      city: input.city,
      populationsOther: otherSelected ? input.populationsOther : null,
      primaryContactPersonId: person.id,
      logoUrl: input.logoUrl,
    });

    await memberships.createInTx(c, { orgId: org.id, userId: user.id, role: "owner", invitedBy: null });
    await populations.setForOrganizationInTx(c, org.id, input.populationIds);
    await insertApprovalEventInTx(c, {
      entityType: "organization",
      entityId: org.id,
      fromStatus: null,
      toStatus: "pending",
      actorUserId: null,
      note: "Self-registered at /signup",
    });

    // Staff notification rows land in THIS transaction (§3); dispatch after
    // commit. Both staff addresses (D53 pattern); a missing env is loud.
    const staffPrimary = (process.env.STAFF_NOTIFY_PRIMARY ?? "").trim();
    const staffSecondary = (process.env.STAFF_NOTIFY_SECONDARY ?? "").trim();
    const recipients = [...new Set([staffPrimary, staffSecondary].filter((e) => e !== ""))];
    if (staffPrimary === "" || staffSecondary === "") {
      console.error(
        `[signup] org ${org.id}: STAFF_NOTIFY_PRIMARY/SECONDARY not fully configured — staff_new_org copies incomplete`,
      );
    }
    const dispatches: PendingDispatch[] = [];
    for (const toEmail of recipients) {
      dispatches.push(
        await queueProductEmailInTx(c, {
          key: "staff_new_org",
          entityId: org.id,
          toEmail,
          vars: {
            organizationName: org.name,
            organizationAddress: input.city,
            organizationPhone: input.phone,
            organizationWebsite: input.websiteUrl,
            primaryContactName: `${person.firstName} ${person.lastName}`,
            primaryContactEmail: person.email,
            primaryContactPhone: person.phone,
            adminUrl: absoluteUrl("/admin/organizations"),
          },
        }),
      );
    }

    return { orgId: org.id, dispatches };
  });
}
