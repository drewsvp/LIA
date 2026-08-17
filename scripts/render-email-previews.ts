/**
 * Render all twelve product templates (docs/email/TEMPLATES.md) to
 * docs/email/previews/{key}.html + .txt using REAL seeded data, so the
 * bodies can be read and checked before any live delivery exists.
 *
 * Render-only: no email_log rows, no dispatch. Loud on missing seed data.
 *
 *   npx tsx scripts/render-email-previews.ts
 */
import fs from "node:fs";
import path from "node:path";
import { pool, queryInContext, SYSTEM } from "../server/db/client";
import { absoluteUrl } from "../server/email/send";
import { staffNewOrg } from "../server/email/templates/staff-new-org";
import { staffNewItemRequest } from "../server/email/templates/staff-new-item-request";
import { staffNewVolunteerRequest } from "../server/email/templates/staff-new-volunteer-request";
import { staffNewUser } from "../server/email/templates/staff-new-user";
import { orgApproved } from "../server/email/templates/org-approved";
import { orgRequestReceived } from "../server/email/templates/org-request-received";
import { orgRequestApproved } from "../server/email/templates/org-request-approved";
import { orgMemberApproved } from "../server/email/templates/org-member-approved";
import { orgNewItemDonation } from "../server/email/templates/org-new-item-donation";
import { orgNewVolunteer } from "../server/email/templates/org-new-volunteer";
import { donorItemConfirmation } from "../server/email/templates/donor-item-confirmation";
import { donorVolunteerConfirmation } from "../server/email/templates/donor-volunteer-confirmation";
import type { Rendered } from "../server/email/render";

const OUT_DIR = path.join("docs", "email", "previews");

function deadlineLabel(t: string): string {
  switch (t) {
    case "until_fulfilled":
      return "Until Fulfilled";
    case "date_specific":
      return "Date Specific";
    case "ongoing":
      return "Ongoing";
    default:
      throw new Error(`unknown deadline_type: ${t}`);
  }
}

function need<T>(value: T | undefined | null, what: string): T {
  if (value == null) throw new Error(`preview needs seeded data: ${what}`);
  return value;
}

async function main(): Promise<void> {
  /* ---------- seed entities ---------- */

  const orgs = await queryInContext<{
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
    mission: string | null;
    populationsOther: string | null;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
  }>(
    SYSTEM,
    `select o.id, o.name,
            coalesce(o.address_formatted,
                     nullif(concat_ws(', ', o.address_line1, o.city, o.state, o.postal_code), '')) as address,
            o.phone, o.website_url as website, o.mission, o.populations_other as "populationsOther",
            p.first_name || ' ' || p.last_name as "contactName", p.email as "contactEmail", p.phone as "contactPhone"
       from organizations o
       join people p on p.id = o.primary_contact_person_id
      where o.status = 'approved' and o.kind = 'member_org'
      order by o.name limit 1`,
  );
  const org = need(orgs[0], "an approved member org with a primary contact");

  const itemRequests = await queryInContext<{
    id: string;
    title: string;
    description: string | null;
    dropoffLocation: string | null;
    deadlineType: string;
    deadlineDate: string | null;
    orgName: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
  }>(
    SYSTEM,
    `select ir.id, ir.title, ir.description, ir.dropoff_location as "dropoffLocation",
            ir.deadline_type as "deadlineType", ir.deadline_date::text as "deadlineDate",
            o.name as "orgName",
            cp.first_name || ' ' || cp.last_name as "contactName", cp.email as "contactEmail", cp.phone as "contactPhone"
       from item_requests ir
       join organizations o on o.id = ir.org_id
       join people cp on cp.id = ir.contact_person_id
      where ir.status = 'active'
      order by (select count(*) from items i where i.item_request_id = ir.id) desc
      limit 1`,
  );
  const itemReq = need(itemRequests[0], "an active item request with a contact person");

  const items = await queryInContext<{ name: string; quantity: number }>(
    SYSTEM,
    `select i.name, i.quantity_requested as quantity from items i
      where i.item_request_id = $1 order by i.sort_order`,
    [itemReq.id],
  );
  if (items.length === 0) throw new Error("preview needs items on the item request");

  const volRequests = await queryInContext<{
    id: string;
    title: string;
    description: string | null;
    details: string | null;
    deadlineType: string;
    orgName: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
  }>(
    SYSTEM,
    `select vr.id, vr.title, vr.description, vr.details, vr.deadline_type as "deadlineType",
            o.name as "orgName",
            cp.first_name || ' ' || cp.last_name as "contactName", cp.email as "contactEmail", cp.phone as "contactPhone"
       from volunteer_requests vr
       join organizations o on o.id = vr.org_id
       join people cp on cp.id = vr.contact_person_id
      where vr.status = 'active'
      order by (select count(*) from volunteer_roles r where r.volunteer_request_id = vr.id) desc
      limit 1`,
  );
  const volReq = need(volRequests[0], "an active volunteer request with a contact person");

  const volRoles = await queryInContext<{ name: string; quantity: number }>(
    SYSTEM,
    `select r.name, r.quantity_needed as quantity from volunteer_roles r
      where r.volunteer_request_id = $1 order by r.sort_order`,
    [volReq.id],
  );
  if (volRoles.length === 0) throw new Error("preview needs roles on the volunteer request");

  const memberships = await queryInContext<{
    memberName: string;
    memberEmail: string;
    memberPhone: string | null;
    orgName: string;
  }>(
    SYSTEM,
    `select p.first_name || ' ' || p.last_name as "memberName", p.email as "memberEmail",
            p.phone as "memberPhone", o.name as "orgName"
       from org_memberships m
       join users u on u.id = m.user_id
       join people p on p.id = u.person_id
       join organizations o on o.id = m.org_id
      where o.kind = 'member_org'
      order by m.created_at limit 1`,
  );
  const membership = need(memberships[0], "an org membership joined to a person");

  const pledges = await queryInContext<{
    id: string;
    donorName: string;
    donorEmail: string;
    donorPhone: string | null;
    requestId: string;
    requestTitle: string;
    requestDescription: string | null;
    dropoffLocation: string | null;
    deadlineType: string;
    deadlineDate: string | null;
    orgName: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
  }>(
    SYSTEM,
    `select ip.id, p.first_name || ' ' || p.last_name as "donorName", p.email as "donorEmail", p.phone as "donorPhone",
            r.id as "requestId", r.title as "requestTitle", r.description as "requestDescription",
            r.dropoff_location as "dropoffLocation", r.deadline_type as "deadlineType", r.deadline_date::text as "deadlineDate",
            o.name as "orgName",
            cp.first_name || ' ' || cp.last_name as "contactName", cp.email as "contactEmail", cp.phone as "contactPhone"
       from item_pledges ip
       join people p on p.id = ip.person_id
       join item_requests r on r.id = ip.item_request_id
       join organizations o on o.id = r.org_id
       join people cp on cp.id = r.contact_person_id
      order by (select count(*) from item_pledge_lines l where l.item_pledge_id = ip.id) desc
      limit 1`,
  );
  const pledge = need(pledges[0], "an item pledge with request contact");

  const pledgeLines = await queryInContext<{ name: string; quantity: number }>(
    SYSTEM,
    `select i.name, l.quantity from item_pledge_lines l join items i on i.id = l.item_id
      where l.item_pledge_id = $1 order by i.sort_order`,
    [pledge.id],
  );
  if (pledgeLines.length === 0) throw new Error("preview needs pledge lines");

  const signups = await queryInContext<{
    id: string;
    donorName: string;
    donorEmail: string;
    donorPhone: string | null;
    notes: string | null;
    requestId: string;
    requestTitle: string;
    requestDescription: string | null;
    requestDetails: string | null;
    deadlineType: string;
    orgName: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
  }>(
    SYSTEM,
    `select vs.id, p.first_name || ' ' || p.last_name as "donorName", p.email as "donorEmail", p.phone as "donorPhone",
            vs.notes,
            r.id as "requestId", r.title as "requestTitle", r.description as "requestDescription",
            r.details as "requestDetails", r.deadline_type as "deadlineType",
            o.name as "orgName",
            cp.first_name || ' ' || cp.last_name as "contactName", cp.email as "contactEmail", cp.phone as "contactPhone"
       from volunteer_signups vs
       join people p on p.id = vs.person_id
       join volunteer_requests r on r.id = vs.volunteer_request_id
       join organizations o on o.id = r.org_id
       join people cp on cp.id = r.contact_person_id
      order by (select count(*) from volunteer_signup_roles sr where sr.volunteer_signup_id = vs.id) desc
      limit 1`,
  );
  const signup = need(signups[0], "a volunteer signup with request contact");

  const signupRoles = await queryInContext<{ name: string }>(
    SYSTEM,
    `select r.name from volunteer_signup_roles sr join volunteer_roles r on r.id = sr.volunteer_role_id
      where sr.volunteer_signup_id = $1 order by r.sort_order`,
    [signup.id],
  );
  if (signupRoles.length === 0) throw new Error("preview needs signup roles");

  /* ---------- render all twelve ---------- */

  const rendered: Record<string, Rendered> = {
    staff_new_org: staffNewOrg.render({
      organizationName: org.name,
      organizationAddress: org.address,
      organizationPhone: org.phone,
      organizationWebsite: org.website,
      primaryContactName: org.contactName,
      primaryContactEmail: org.contactEmail,
      primaryContactPhone: org.contactPhone,
      adminUrl: absoluteUrl("/admin/organizations"),
    }),
    staff_new_item_request: staffNewItemRequest.render({
      itemRequestName: itemReq.title,
      organizationName: itemReq.orgName,
      organizationPrimaryContact: org.contactName,
      organizationPrimaryContactEmail: org.contactEmail,
      adminUrl: absoluteUrl("/admin/requests"),
    }),
    staff_new_volunteer_request: staffNewVolunteerRequest.render({
      volunteerRequestName: volReq.title,
      organizationName: volReq.orgName,
      organizationPrimaryContact: org.contactName,
      organizationPrimaryContactEmail: org.contactEmail,
      adminUrl: absoluteUrl("/admin/requests"),
    }),
    staff_new_user: staffNewUser.render({
      memberName: membership.memberName,
      memberEmail: membership.memberEmail,
      memberPhone: membership.memberPhone,
      organizationName: membership.orgName,
      submitterName: org.contactName,
      submitterEmail: org.contactEmail,
      adminUrl: absoluteUrl("/admin/members"),
    }),
    org_approved: orgApproved.render({
      organizationName: org.name,
      orgAddress: org.address,
      orgPhoneNumber: org.phone,
      websiteUrl: org.website,
      missionStatement: org.mission,
      primaryPopulationServed: org.populationsOther,
      organizationPrimaryContact: org.contactName,
      organizationPrimaryContactEmail: org.contactEmail,
      organizationPrimaryContactPhone: org.contactPhone,
      dashboardUrl: absoluteUrl("/dashboard"),
    }),
    // Item flavor here; volunteer flavor is exercised by org_request_approved below.
    org_request_received: orgRequestReceived.render({
      itemOrVolunteer: "Item",
      organizationName: itemReq.orgName,
      requestName: itemReq.title,
      requestDescription: itemReq.description,
      requestContactName: itemReq.contactName,
      requestContactEmail: itemReq.contactEmail,
      requestContactPhone: itemReq.contactPhone,
      requestId: itemReq.id,
      itemsOrRoles: { kind: "item", rows: items },
    }),
    org_request_approved: orgRequestApproved.render({
      organizationName: volReq.orgName,
      viewRequestUrl: absoluteUrl(`/volunteer/${volReq.id}`),
      requestName: volReq.title,
      requestDescription: volReq.description,
      requestContactName: volReq.contactName,
      requestContactEmail: volReq.contactEmail,
      requestContactPhone: volReq.contactPhone,
      itemOrVolunteer: "Volunteer",
      itemsOrRoles: { kind: "volunteer", rows: volRoles },
    }),
    org_member_approved: orgMemberApproved.render({
      memberName: membership.memberName,
      organizationName: membership.orgName,
      loginUrl: absoluteUrl("/login"),
      dashboardUrl: absoluteUrl("/dashboard"),
    }),
    org_new_item_donation: orgNewItemDonation.render({
      organizationName: pledge.orgName,
      requestName: pledge.requestTitle,
      requestDescription: pledge.requestDescription,
      requestUrl: absoluteUrl(`/items/${pledge.requestId}`),
      items: pledgeLines,
      donorName: pledge.donorName,
      donorEmail: pledge.donorEmail,
      donorPhone: pledge.donorPhone,
      supportersUrl: absoluteUrl("/dashboard/supporters"),
    }),
    org_new_volunteer: orgNewVolunteer.render({
      organizationName: signup.orgName,
      requestName: signup.requestTitle,
      requestDescription: signup.requestDescription,
      requestDetails: signup.requestDetails,
      requestUrl: absoluteUrl(`/volunteer/${signup.requestId}`),
      roles: signupRoles.map((r) => r.name),
      donorName: signup.donorName,
      donorEmail: signup.donorEmail,
      donorPhone: signup.donorPhone,
      donorNotes: signup.notes,
      supportersUrl: absoluteUrl("/dashboard/supporters"),
    }),
    donor_item_confirmation: donorItemConfirmation.render({
      donorName: pledge.donorName,
      organizationName: pledge.orgName,
      requestContactName: pledge.contactName,
      requestContactEmail: pledge.contactEmail,
      requestContactPhone: pledge.contactPhone,
      requestName: pledge.requestTitle,
      requestDescription: pledge.requestDescription,
      requestDeadlineType: deadlineLabel(pledge.deadlineType),
      requestDeadlineDate: pledge.deadlineType === "date_specific" ? pledge.deadlineDate : null,
      dropoffLocation: pledge.dropoffLocation,
      requestUrl: absoluteUrl(`/items/${pledge.requestId}`),
      items: pledgeLines,
    }),
    donor_volunteer_confirmation: donorVolunteerConfirmation.render({
      donorName: signup.donorName,
      organizationName: signup.orgName,
      requestContactName: signup.contactName,
      requestContactEmail: signup.contactEmail,
      requestContactPhone: signup.contactPhone,
      requestName: signup.requestTitle,
      requestDescription: signup.requestDescription,
      requestDeadlineType: deadlineLabel(signup.deadlineType),
      requestDetails: signup.requestDetails,
      requestUrl: absoluteUrl(`/volunteer/${signup.requestId}`),
      roles: signupRoles.map((r) => r.name),
      followUpWindow: "1-3 business days",
    }),
  };

  /* ---------- write files ---------- */

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary: { template: string; subject: string }[] = [];
  for (const [key, r] of Object.entries(rendered)) {
    fs.writeFileSync(path.join(OUT_DIR, `${key}.html`), r.html);
    fs.writeFileSync(path.join(OUT_DIR, `${key}.txt`), `Subject: ${r.subject}\n\n${r.text}\n`);
    summary.push({ template: key, subject: r.subject });
  }
  console.table(summary);
  console.log(`${summary.length} templates rendered to ${OUT_DIR}`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    return pool.end().then(() => process.exit(1));
  });
