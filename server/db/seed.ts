/**
 * Idempotent seed — run with `npm run db:seed` (safe to re-run).
 *
 * Everything goes through the DAL; pledges and signups go ONLY through
 * record_item_pledge() / record_volunteer_signup() via their DAL wrappers, so
 * counters are never touched by hand and counter_drift must stay empty.
 *
 * Staff admin logins are real inboxes (defendingthecause.org) so magic-link
 * login can work end-to-end; the staff_approver and org-owner logins remain
 * synthetic @…example.org addresses that cannot receive mail. All logins are
 * printed at the end of every run.
 */
import { pool, SYSTEM } from "./client";
import * as dal from "../dal/index";
import type {
  Organization,
  OrgMembership,
  ItemRequest,
  VolunteerRequest,
  Person,
  User,
  RequestStatus,
} from "../../shared/types";

const ctx = SYSTEM;

/** Yesterday as a YYYY-MM-DD date in America/Los_Angeles (expiry test rows). */
function laYesterday(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const noonUtc = new Date(`${today}T12:00:00Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() - 1);
  const iso = noonUtc.toISOString().slice(0, 10);
  return iso;
}

function fail(message: string): never {
  throw new Error(`SEED VERIFICATION FAILED: ${message}`);
}

// ---------------------------------------------------------------------------
// Ensure-helpers: find by natural key, create when missing.
// ---------------------------------------------------------------------------

async function ensurePerson(input: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
}): Promise<Person> {
  const existing = await dal.people.findByEmail(ctx, input.email);
  if (existing) return existing;
  return dal.people.create(ctx, { ...input, sourceNote: "seed" });
}

async function ensureUser(
  personId: string,
  status: "invited" | "active",
  kind?: "member" | "supporter",
): Promise<User> {
  const existing = await dal.users.findByPersonId(ctx, personId);
  if (existing) return existing;
  return dal.users.create(ctx, { personId, status, ...(kind ? { kind } : {}) });
}

async function ensureMembership(input: {
  orgId: string;
  userId: string;
  role: "owner" | "member" | "staff_admin" | "staff_approver";
  activate: boolean;
  approvedByUserId: string;
}): Promise<OrgMembership> {
  let membership = await dal.memberships.findByOrgAndUser(ctx, input.orgId, input.userId);
  if (!membership) {
    membership = await dal.memberships.create(ctx, { orgId: input.orgId, userId: input.userId, role: input.role });
  }
  if (input.activate && membership.status === "pending") {
    membership = await dal.memberships.activate(ctx, membership.id, input.approvedByUserId);
  }
  return membership;
}

type RequestKind = "item" | "volunteer";

/**
 * Walk a request from its current status to the target along
 * draft -> pending -> active. Approval events come from transitionStatus.
 */
async function walkStatus(
  kind: RequestKind,
  requestId: string,
  current: RequestStatus,
  target: RequestStatus,
  submitActorUserId: string,
  approveActorUserId: string,
): Promise<void> {
  const ladder: RequestStatus[] = ["draft", "pending", "active"];
  const from = ladder.indexOf(current);
  const to = ladder.indexOf(target);
  if (from === -1 || to === -1 || from >= to) return; // already there or archived
  for (let i = from; i < to; i++) {
    const next = ladder[i + 1];
    if (!next) break;
    const actorUserId = next === "pending" ? submitActorUserId : approveActorUserId;
    if (kind === "item") {
      await dal.itemRequests.transitionStatus(ctx, { requestId, to: next, actorUserId });
    } else {
      await dal.volunteerRequests.transitionStatus(ctx, { requestId, to: next, actorUserId });
    }
  }
}

async function main(): Promise<void> {
  console.log("Seeding Love in Action …");

  // -------------------------------------------------------------------------
  // 1. Volunteer categories — reviewed initial vocabulary, alphabetical.
  // Once staff has configured the list, rerunning seed must not undo it.
  // -------------------------------------------------------------------------
  const VOLUNTEER_CATEGORIES = [
    "Administrative Support",
    "Child Care & Family Support",
    "Event & Outreach Support",
    "Foster Care & Respite",
    "Hands-On Projects & General Help",
    "Kids' Camp Counselor / Help",
    "Mentoring & Relationship Building",
    "Ranch Help",
    "Skilled & Professional Services",
    "Sorting, Organizing & Distribution",
    "Technology & Digital Support",
    "Transportation & Delivery",
  ] as const;
  const volunteerCategories = await dal.volunteerInterests.seedInitial(ctx, VOLUNTEER_CATEGORIES);
  if (volunteerCategories.length === 0) fail("expected volunteer categories to be initialized");

  // -------------------------------------------------------------------------
  // 2. Populations — the exact eleven from the work order.
  // -------------------------------------------------------------------------
  const POPULATIONS: { name: string; slug: string }[] = [
    { name: "At-Risk Kids/Teens", slug: "at-risk-kids-teens" },
    { name: "Youth in Foster Care", slug: "youth-in-foster-care" },
    { name: "Transitional Age Youth/Young Adults", slug: "transitional-age-youth-young-adults" },
    { name: "Unhoused Teens/Families", slug: "unhoused-teens-families" },
    { name: "Foster/Adoptive Families", slug: "foster-adoptive-families" },
    { name: "Refugee Families", slug: "refugee-families" },
    { name: "Single Parents", slug: "single-parents" },
    { name: "Women Facing Unplanned Pregnancies", slug: "women-facing-unplanned-pregnancies" },
    { name: "Families/Young Adults in Crisis", slug: "families-young-adults-in-crisis" },
    { name: "Youth with Disabilities/Health Issues", slug: "youth-with-disabilities-health-issues" },
    { name: "Other", slug: "other" },
  ];
  const popIds = new Map<string, string>();
  for (const [index, p] of POPULATIONS.entries()) {
    const existing = await dal.populations.findBySlug(ctx, p.slug);
    const row = existing ?? (await dal.populations.create(ctx, { name: p.name, slug: p.slug, sortOrder: index + 1 }));
    popIds.set(p.slug, row.id);
  }
  const allPops = await dal.populations.listAll(ctx);
  if (allPops.length !== 11) fail(`expected exactly 11 populations, found ${allPops.length}`);

  // -------------------------------------------------------------------------
  // 2. Staff people + users (needed before any approval can be recorded).
  // -------------------------------------------------------------------------
  const tiffanyP = await ensurePerson({ firstName: "Tiffany", lastName: "Loeffler", email: "tiffany@defendingthecause.org" });
  const christinaP = await ensurePerson({ firstName: "Christina", lastName: "Moe", email: "christina@defendingthecause.org" });
  const rileyP = await ensurePerson({ firstName: "Riley", lastName: "Chen", email: "approver@thealliance.example.org" });
  const tiffany = await ensureUser(tiffanyP.id, "active");
  const christina = await ensureUser(christinaP.id, "active");
  const riley = await ensureUser(rileyP.id, "active");

  // Supporter account — no org membership, kind='supporter'.
  const alexP = await ensurePerson({ firstName: "Alex", lastName: "Rivera", email: "supporter@example.org" });
  await ensureUser(alexP.id, "active", "supporter");

  // -------------------------------------------------------------------------
  // 3. Organizations. The Alliance approves itself at bootstrap (there is no
  //    earlier authority); member orgs are approved by the staff_admin.
  // -------------------------------------------------------------------------
  async function ensureOrg(
    slug: string,
    create: () => Promise<Organization>,
    approve: boolean,
  ): Promise<Organization> {
    let org = await dal.organizations.getBySlug(ctx, slug);
    if (!org) org = await create();
    if (approve && org.status === "pending") org = await dal.organizations.approve(ctx, org.id, tiffany.id);
    return org;
  }

  const alliance = await ensureOrg(
    "the-alliance",
    () =>
      dal.organizations.create(ctx, {
        name: "The Alliance",
        slug: "the-alliance",
        kind: "platform_owner",
        city: "Roseville",
        state: "CA",
        websiteUrl: "https://thealliance.example.org",
        mission: "A network of local organizations caring for kids and families in crisis across South Placer County.",
        primaryContactPersonId: christinaP.id,
      }),
    true,
  );

  const danaP = await ensurePerson({ firstName: "Dana", lastName: "Whitfield", email: "dana@heartsandhands.example.org" });
  const samuelP = await ensurePerson({ firstName: "Samuel", lastName: "Okafor", email: "samuel@newhorizons.example.org" });
  const graceP = await ensurePerson({ firstName: "Grace", lastName: "Lin", email: "grace@safeharbor.example.org" });
  const monicaP = await ensurePerson({ firstName: "Monica", lastName: "Reyes", email: "monica@bridgeofhope.example.org" });
  const dana = await ensureUser(danaP.id, "active");
  const samuel = await ensureUser(samuelP.id, "active");
  const grace = await ensureUser(graceP.id, "active");
  const monica = await ensureUser(monicaP.id, "invited");

  const hearts = await ensureOrg(
    "hearts-hands-family-services",
    () =>
      dal.organizations.create(ctx, {
        name: "Hearts & Hands Family Services",
        slug: "hearts-hands-family-services",
        city: "Roseville",
        state: "CA",
        websiteUrl: "https://heartsandhands.example.org",
        mission: "Wrapping foster and adoptive families in practical, hands-on support from placement day forward.",
        primaryContactPersonId: danaP.id,
      }),
    true,
  );
  const horizons = await ensureOrg(
    "new-horizons-refugee-support",
    () =>
      dal.organizations.create(ctx, {
        name: "New Horizons Refugee Support",
        slug: "new-horizons-refugee-support",
        city: "Citrus Heights",
        state: "CA",
        websiteUrl: "https://newhorizons.example.org",
        mission: "Helping newly arrived refugee families set up homes, learn English, and find their footing.",
        primaryContactPersonId: samuelP.id,
      }),
    true,
  );
  const harbor = await ensureOrg(
    "safe-harbor-youth-alliance",
    () =>
      dal.organizations.create(ctx, {
        name: "Safe Harbor Youth Alliance",
        slug: "safe-harbor-youth-alliance",
        city: "Rocklin",
        state: "CA",
        websiteUrl: "https://safeharbor.example.org",
        mission: "A drop-in center and mentoring community for unhoused and at-risk teens in South Placer.",
        primaryContactPersonId: graceP.id,
      }),
    true,
  );
  const bridge = await ensureOrg(
    "bridge-of-hope-single-parents",
    () =>
      dal.organizations.create(ctx, {
        name: "Bridge of Hope Single Parents Network",
        slug: "bridge-of-hope-single-parents",
        city: "Lincoln",
        state: "CA",
        websiteUrl: "https://bridgeofhope.example.org",
        mission: "Community, coaching, and material help for single parents rebuilding stability.",
        primaryContactPersonId: monicaP.id,
      }),
    false, // stays pending — the ADMIN-02 approval queue needs a live row
  );

  function pop(slug: string): string {
    const id = popIds.get(slug);
    if (!id) fail(`population slug missing: ${slug}`);
    return id;
  }
  await dal.populations.setForOrganization(ctx, hearts.id, [pop("foster-adoptive-families"), pop("youth-in-foster-care")]);
  await dal.populations.setForOrganization(ctx, horizons.id, [
    pop("refugee-families"),
    pop("families-young-adults-in-crisis"),
  ]);
  await dal.populations.setForOrganization(ctx, harbor.id, [
    pop("unhoused-teens-families"),
    pop("at-risk-kids-teens"),
    pop("transitional-age-youth-young-adults"),
  ]);
  await dal.populations.setForOrganization(ctx, bridge.id, [
    pop("single-parents"),
    pop("women-facing-unplanned-pregnancies"),
  ]);

  // -------------------------------------------------------------------------
  // 4. Memberships. Tiffany's staff_admin membership is the bootstrap row and
  //    self-activates; everything after has a real approver.
  // -------------------------------------------------------------------------
  await ensureMembership({ orgId: alliance.id, userId: tiffany.id, role: "staff_admin", activate: true, approvedByUserId: tiffany.id });
  await ensureMembership({ orgId: alliance.id, userId: christina.id, role: "staff_admin", activate: true, approvedByUserId: tiffany.id });
  await ensureMembership({ orgId: alliance.id, userId: riley.id, role: "staff_approver", activate: true, approvedByUserId: tiffany.id });
  await ensureMembership({ orgId: hearts.id, userId: dana.id, role: "owner", activate: true, approvedByUserId: tiffany.id });
  await ensureMembership({ orgId: horizons.id, userId: samuel.id, role: "owner", activate: true, approvedByUserId: tiffany.id });
  await ensureMembership({ orgId: harbor.id, userId: grace.id, role: "owner", activate: true, approvedByUserId: tiffany.id });
  await ensureMembership({ orgId: bridge.id, userId: monica.id, role: "owner", activate: false, approvedByUserId: tiffany.id });

  // -------------------------------------------------------------------------
  // 4b. Legacy synthetic staff_admin removal. Databases seeded before the
  //     real staff admins existed have "Jordan Avery" as the bootstrap
  //     staff_admin. dal.legacyStaff.removeLegacyStaffAdmin re-points every
  //     attribution row to Tiffany (the current bootstrap), moves any
  //     platform-owner primary contact to Christina, detaches email-log rows,
  //     then deletes membership, user, and person — all in ONE transaction.
  //     It aborts loudly, writing nothing, if the synthetic account somehow
  //     saw real use (pledges, signups, digest subscriptions, request
  //     contacts, or member-org rows). Fresh databases never create him, so
  //     this is a no-op there — and on every rerun after the first.
  // -------------------------------------------------------------------------
  const legacyRemoval = await dal.legacyStaff.removeLegacyStaffAdmin(ctx, {
    email: "admin@thealliance.example.org",
    reassignAttributionToUserId: tiffany.id,
    replacementPrimaryContactPersonId: christinaP.id,
  });
  if (legacyRemoval.removed) {
    const { counts } = legacyRemoval;
    const repointed =
      Object.values(counts).reduce((sum, n) => sum + n, 0) - counts.membershipsDeleted;
    console.log(
      `  removed legacy synthetic staff_admin (re-pointed/detached ${repointed} referencing rows; deleted ${counts.membershipsDeleted} membership row(s))`,
    );
  }

  // -------------------------------------------------------------------------
  // 5. Item requests + items.
  // -------------------------------------------------------------------------
  type ItemSpec = { name: string; quantityRequested: number; description?: string };
  async function ensureItemRequest(input: {
    org: Organization;
    ownerUserId: string;
    title: string;
    description: string;
    dropoffLocation: string;
    peopleHelped: number;
    target: RequestStatus;
    items: ItemSpec[];
  }): Promise<{ request: ItemRequest; itemIds: Map<string, string> }> {
    const all = await dal.itemRequests.listByOrganization(ctx, input.org.id);
    let request = all.find((r) => r.title === input.title) ?? null;
    if (!request) {
      request = await dal.itemRequests.createDraft(ctx, input.org.id, {
        title: input.title,
        description: input.description,
        dropoffLocation: input.dropoffLocation,
        peopleHelped: input.peopleHelped,
        contactPersonId: input.org.primaryContactPersonId,
        createdBy: input.ownerUserId,
      });
    }
    const itemIds = new Map<string, string>();
    const existingItems = await dal.items.listByRequest(ctx, request.id);
    for (const spec of input.items) {
      const found = existingItems.find((i) => i.name === spec.name);
      const item =
        found ??
        (await dal.items.create(ctx, input.org.id, request.id, {
          name: spec.name,
          description: spec.description ?? null,
          quantityRequested: spec.quantityRequested,
        }));
      itemIds.set(spec.name, item.id);
    }
    await walkStatus("item", request.id, request.status, input.target, input.ownerUserId, riley.id);
    const fresh = await dal.itemRequests.getById(ctx, request.id);
    if (!fresh) fail(`item request vanished: ${input.title}`);
    return { request: fresh, itemIds };
  }

  const carSeats = await ensureItemRequest({
    org: hearts,
    ownerUserId: dana.id,
    title: "Car Seats for Foster Placements",
    description: "New placements often arrive with nothing. These seats let families say yes to emergency calls.",
    dropoffLocation: "Hearts & Hands office, 210 Vernon St, Roseville",
    peopleHelped: 6,
    target: "active",
    items: [
      { name: "Infant car seat (rear-facing)", quantityRequested: 4, description: "New in box — safety regulations require unused seats." },
      { name: "Convertible car seat", quantityRequested: 2 },
    ],
  });
  const welcomeBoxes = await ensureItemRequest({
    org: hearts,
    ownerUserId: dana.id,
    title: "Welcome Boxes for New Placements",
    description: "A first-night box for kids arriving in care: bedding, pajamas, and a book of their own.",
    dropoffLocation: "Hearts & Hands office, 210 Vernon St, Roseville",
    peopleHelped: 12,
    target: "active",
    items: [
      { name: "Twin mattress protector", quantityRequested: 6 },
      { name: "Pajama sets (kids 4-10)", quantityRequested: 12 },
      { name: "Board books", quantityRequested: 10 },
    ],
  });
  const aptSetup = await ensureItemRequest({
    org: horizons,
    ownerUserId: samuel.id,
    title: "Apartment Setup for Arriving Family",
    description: "A family of five arrives this month to an empty apartment. Help us make it a home.",
    dropoffLocation: "New Horizons warehouse, 7811 Auburn Blvd, Citrus Heights",
    peopleHelped: 5,
    target: "active",
    items: [
      { name: "Kitchen starter kit", quantityRequested: 3, description: "Pots, pans, utensils, and dishes for four." },
      { name: "Bath towels (new)", quantityRequested: 8 },
    ],
  });
  const hygieneKits = await ensureItemRequest({
    org: harbor,
    ownerUserId: grace.id,
    title: "Hygiene Kits for Drop-In Center",
    description: "Teens at the drop-in center rely on these kits weekly. Full-size products last longest.",
    dropoffLocation: "Safe Harbor drop-in center, 5000 Rocklin Rd, Rocklin",
    peopleHelped: 40,
    target: "active",
    items: [
      { name: "Full-size shampoo", quantityRequested: 24 },
      { name: "Deodorant", quantityRequested: 30 },
    ],
  });
  await ensureItemRequest({
    org: horizons,
    ownerUserId: samuel.id,
    title: "Winter Coat Closet Restock",
    description: "Draft — sizing list still being confirmed with case workers.",
    dropoffLocation: "New Horizons warehouse, 7811 Auburn Blvd, Citrus Heights",
    peopleHelped: 20,
    target: "draft",
    items: [{ name: "Winter coats (teen sizes)", quantityRequested: 20 }],
  });
  await ensureItemRequest({
    org: harbor,
    ownerUserId: grace.id,
    title: "Bus Passes for Job Interviews",
    description: "Monthly transit passes so teens can reliably get to interviews and first shifts.",
    dropoffLocation: "Safe Harbor drop-in center, 5000 Rocklin Rd, Rocklin",
    peopleHelped: 10,
    target: "pending",
    items: [{ name: "Monthly transit pass", quantityRequested: 10 }],
  });

  // -------------------------------------------------------------------------
  // 6. Volunteer requests + roles.
  // -------------------------------------------------------------------------
  type RoleSpec = { name: string; quantityNeeded: number; description?: string };
  async function ensureVolunteerRequest(input: {
    org: Organization;
    ownerUserId: string;
    title: string;
    description: string;
    eventLocation: string;
    peopleHelped: number;
    target: RequestStatus;
    roles: RoleSpec[];
  }): Promise<{ request: VolunteerRequest; roleIds: Map<string, string> }> {
    const all = await dal.volunteerRequests.listByOrganization(ctx, input.org.id);
    let request = all.find((r) => r.title === input.title) ?? null;
    if (!request) {
      request = await dal.volunteerRequests.createDraft(ctx, input.org.id, {
        title: input.title,
        description: input.description,
        eventLocation: input.eventLocation,
        peopleHelped: input.peopleHelped,
        contactPersonId: input.org.primaryContactPersonId,
        createdBy: input.ownerUserId,
      });
    }
    const roleIds = new Map<string, string>();
    const existingRoles = await dal.volunteerRoles.listByRequest(ctx, request.id);
    for (const spec of input.roles) {
      const found = existingRoles.find((r) => r.name === spec.name);
      const role =
        found ??
        (await dal.volunteerRoles.create(ctx, input.org.id, request.id, {
          name: spec.name,
          description: spec.description ?? null,
          quantityNeeded: spec.quantityNeeded,
        }));
      roleIds.set(spec.name, role.id);
    }
    await walkStatus("volunteer", request.id, request.status, input.target, input.ownerUserId, riley.id);
    const fresh = await dal.volunteerRequests.getById(ctx, request.id);
    if (!fresh) fail(`volunteer request vanished: ${input.title}`);
    return { request: fresh, roleIds };
  }

  const soccer = await ensureVolunteerRequest({
    org: harbor,
    ownerUserId: grace.id,
    title: "Fall Soccer League Coaches",
    description: "Coach a team of drop-in center teens for the eight-week fall league.",
    eventLocation: "Maidu Regional Park, Roseville",
    peopleHelped: 30,
    target: "active",
    roles: [
      { name: "Head Coach", quantityNeeded: 2, description: "Runs two practices a week plus Saturday games." },
      { name: "Assistant Coach", quantityNeeded: 4 },
    ],
  });
  const moveIn = await ensureVolunteerRequest({
    org: hearts,
    ownerUserId: dana.id,
    title: "Move-In Day Volunteers",
    description: "Help a newly licensed foster family set up bedrooms before a sibling set arrives.",
    eventLocation: "Roseville (address shared after signup)",
    peopleHelped: 4,
    target: "active",
    roles: [
      { name: "Furniture mover", quantityNeeded: 6 },
      { name: "Meal train cook", quantityNeeded: 3 },
    ],
  });
  const esl = await ensureVolunteerRequest({
    org: horizons,
    ownerUserId: samuel.id,
    title: "ESL Conversation Partners",
    description: "One hour a week of friendly English conversation with newly arrived adults.",
    eventLocation: "New Horizons community room, Citrus Heights",
    peopleHelped: 15,
    target: "active",
    roles: [{ name: "Conversation partner", quantityNeeded: 5 }],
  });
  await ensureVolunteerRequest({
    org: hearts,
    ownerUserId: dana.id,
    title: "Respite Night Childcare",
    description: "Draft — background-check requirements being confirmed before this goes live.",
    eventLocation: "Hearts & Hands office, Roseville",
    peopleHelped: 20,
    target: "draft",
    roles: [{ name: "Childcare volunteer", quantityNeeded: 8 }],
  });
  await ensureVolunteerRequest({
    org: horizons,
    ownerUserId: samuel.id,
    title: "Airport Welcome Team",
    description: "Be the first friendly faces a family sees on arrival night.",
    eventLocation: "Sacramento International Airport",
    peopleHelped: 5,
    target: "pending",
    roles: [{ name: "Greeter", quantityNeeded: 4 }],
  });

  // -------------------------------------------------------------------------
  // 7. Pledges — ONLY via record_item_pledge(). The second car-seat pledge
  //    brings every item to zero and must auto-archive the request.
  // -------------------------------------------------------------------------
  async function ensurePledge(input: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    requestId: string;
    notes?: string;
    lines: { itemId: string; quantity: number }[];
  }): Promise<void> {
    const person = await dal.people.findByEmail(ctx, input.email);
    if (person) {
      const existing = await dal.pledges.findByPersonAndRequest(ctx, person.id, input.requestId);
      if (existing) return;
    }
    await dal.pledges.recordItemPledge(ctx, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? null,
      requestId: input.requestId,
      notes: input.notes ?? null,
      lines: input.lines,
    });
  }

  function itemId(map: Map<string, string>, name: string): string {
    const id = map.get(name);
    if (!id) fail(`seed item missing: ${name}`);
    return id;
  }

  await ensurePledge({
    firstName: "Maria",
    lastName: "Lopez",
    email: "maria.lopez@example.org",
    requestId: carSeats.request.id,
    notes: "Can drop off Saturday morning.",
    lines: [
      { itemId: itemId(carSeats.itemIds, "Infant car seat (rear-facing)"), quantity: 2 },
      { itemId: itemId(carSeats.itemIds, "Convertible car seat"), quantity: 1 },
    ],
  });
  await ensurePledge({
    firstName: "David",
    lastName: "Kim",
    email: "david.kim@example.org",
    requestId: carSeats.request.id,
    lines: [
      { itemId: itemId(carSeats.itemIds, "Infant car seat (rear-facing)"), quantity: 2 },
      { itemId: itemId(carSeats.itemIds, "Convertible car seat"), quantity: 1 },
    ],
  });
  await ensurePledge({
    firstName: "Maria",
    lastName: "Lopez",
    email: "maria.lopez@example.org",
    requestId: welcomeBoxes.request.id,
    lines: [{ itemId: itemId(welcomeBoxes.itemIds, "Twin mattress protector"), quantity: 6 }],
  });
  await ensurePledge({
    firstName: "David",
    lastName: "Kim",
    email: "david.kim@example.org",
    requestId: welcomeBoxes.request.id,
    lines: [{ itemId: itemId(welcomeBoxes.itemIds, "Pajama sets (kids 4-10)"), quantity: 5 }],
  });
  await ensurePledge({
    firstName: "Aisha",
    lastName: "Bello",
    email: "aisha.bello@example.org",
    requestId: aptSetup.request.id,
    lines: [
      { itemId: itemId(aptSetup.itemIds, "Kitchen starter kit"), quantity: 1 },
      { itemId: itemId(aptSetup.itemIds, "Bath towels (new)"), quantity: 3 },
    ],
  });
  await ensurePledge({
    firstName: "Tom",
    lastName: "Nguyen",
    email: "tom.nguyen@example.org",
    requestId: hygieneKits.request.id,
    lines: [{ itemId: itemId(hygieneKits.itemIds, "Full-size shampoo"), quantity: 6 }],
  });
  await ensurePledge({
    firstName: "Pat",
    lastName: "Nguyen",
    email: "pat.nguyen@example.org",
    requestId: hygieneKits.request.id,
    lines: [{ itemId: itemId(hygieneKits.itemIds, "Deodorant"), quantity: 3 }],
  });

  // -------------------------------------------------------------------------
  // 8. Signups — ONLY via record_volunteer_signup(). Two Head Coach signups
  //    fill that role to zero remaining. "Patrick" (same email as Pat) has a
  //    different first name, which the function flags as needs_review.
  // -------------------------------------------------------------------------
  async function ensureSignup(input: {
    firstName: string;
    lastName: string;
    email: string;
    requestId: string;
    roleIds: string[];
  }): Promise<void> {
    const person = await dal.people.findByEmail(ctx, input.email);
    if (person) {
      const existing = await dal.signups.findByPersonAndRequest(ctx, person.id, input.requestId);
      if (existing) return;
    }
    await dal.signups.recordVolunteerSignup(ctx, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      requestId: input.requestId,
      roleIds: input.roleIds,
    });
  }

  function roleId(map: Map<string, string>, name: string): string {
    const id = map.get(name);
    if (!id) fail(`seed role missing: ${name}`);
    return id;
  }

  await ensureSignup({
    firstName: "Maria",
    lastName: "Lopez",
    email: "maria.lopez@example.org",
    requestId: soccer.request.id,
    roleIds: [roleId(soccer.roleIds, "Head Coach")],
  });
  await ensureSignup({
    firstName: "Kevin",
    lastName: "Park",
    email: "kevin.park@example.org",
    requestId: soccer.request.id,
    roleIds: [roleId(soccer.roleIds, "Head Coach")],
  });
  await ensureSignup({
    firstName: "Priya",
    lastName: "Sharma",
    email: "priya.sharma@example.org",
    requestId: soccer.request.id,
    roleIds: [roleId(soccer.roleIds, "Assistant Coach")],
  });
  await ensureSignup({
    firstName: "David",
    lastName: "Kim",
    email: "david.kim@example.org",
    requestId: moveIn.request.id,
    roleIds: [roleId(moveIn.roleIds, "Furniture mover")],
  });
  await ensureSignup({
    firstName: "Lena",
    lastName: "Fischer",
    email: "lena.fischer@example.org",
    requestId: moveIn.request.id,
    roleIds: [roleId(moveIn.roleIds, "Furniture mover"), roleId(moveIn.roleIds, "Meal train cook")],
  });
  await ensureSignup({
    firstName: "Aisha",
    lastName: "Bello",
    email: "aisha.bello@example.org",
    requestId: esl.request.id,
    roleIds: [roleId(esl.roleIds, "Conversation partner")],
  });
  await ensureSignup({
    firstName: "Patrick",
    lastName: "Nguyen",
    email: "pat.nguyen@example.org",
    requestId: esl.request.id,
    roleIds: [roleId(esl.roleIds, "Conversation partner")],
  });

  // Guarantee the needs_review person even if the mismatch heuristic changes.
  const pat = await dal.people.findByEmail(ctx, "pat.nguyen@example.org");
  if (!pat) fail("Pat Nguyen person row missing");
  if (!pat.needsReview) {
    await dal.people.flagForReview(ctx, pat.id, "Signed up as 'Patrick' but pledged as 'Pat' — confirm one person.");
    console.log("  note: needs_review set via DAL (function did not flag the name mismatch)");
  }

  // -------------------------------------------------------------------------
  // 9. Expiry test rows: set expires_on to LA-yesterday AFTER the pledges and
  //    signups above so recording never raced an expiry check.
  // -------------------------------------------------------------------------
  const yesterday = laYesterday();
  if ((await dal.itemRequests.getById(ctx, hygieneKits.request.id))?.expiresOn !== yesterday) {
    await dal.itemRequests.update(ctx, harbor.id, hygieneKits.request.id, { expiresOn: yesterday });
  }
  if ((await dal.volunteerRequests.getById(ctx, esl.request.id))?.expiresOn !== yesterday) {
    await dal.volunteerRequests.update(ctx, horizons.id, esl.request.id, { expiresOn: yesterday });
  }

  // -------------------------------------------------------------------------
  // 10. Digest subscribers.
  // -------------------------------------------------------------------------
  const maria = await dal.people.findByEmail(ctx, "maria.lopez@example.org");
  const subscribers: { email: string; personId?: string | null; legacySource?: string | null }[] = [
    { email: "carol.d@example.org", legacySource: "wix_import" },
    { email: "frank.m@example.org", legacySource: "wix_import" },
    { email: "maria.lopez@example.org", personId: maria?.id ?? null },
    { email: "newsletter.fan@example.org" },
  ];
  for (const s of subscribers) {
    const existing = await dal.digestSubscribers.findByEmail(ctx, s.email);
    if (!existing) await dal.digestSubscribers.create(ctx, s);
  }
  const unsub = await dal.digestSubscribers.findByEmail(ctx, "newsletter.fan@example.org");
  if (unsub && unsub.status === "subscribed") {
    await dal.digestSubscribers.updateStatusByToken(ctx, unsub.unsubscribeToken, "unsubscribed");
  }

  // -------------------------------------------------------------------------
  // 11. Verification — loud failure on any miss.
  // -------------------------------------------------------------------------
  const drift = await dal.validation.counterDrift(ctx);
  if (drift.length !== 0) fail(`counter_drift returned ${drift.length} rows: ${JSON.stringify(drift)}`);

  const archived = await dal.itemRequests.getById(ctx, carSeats.request.id);
  if (archived?.status !== "archived" || archived.archivedReason !== "fulfilled") {
    fail(`car-seat request should be auto-archived/fulfilled, got ${archived?.status}/${archived?.archivedReason}`);
  }
  const carSeatEvents = await dal.approvalEvents.listByEntity(ctx, "item_request", carSeats.request.id);
  if (carSeatEvents.length < 3) fail(`expected ≥3 approval events on car-seat request, got ${carSeatEvents.length}`);

  const wbItems = await dal.items.listByRequest(ctx, welcomeBoxes.request.id);
  const mattress = wbItems.find((i) => i.name === "Twin mattress protector");
  if (mattress?.quantityRemaining !== 0) fail(`mattress protector should be 0 remaining, got ${mattress?.quantityRemaining}`);
  const wbStatus = (await dal.itemRequests.getById(ctx, welcomeBoxes.request.id))?.status;
  if (wbStatus !== "active") fail(`welcome boxes should still be active, got ${wbStatus}`);

  const soccerRoles = await dal.volunteerRoles.listByRequest(ctx, soccer.request.id);
  const headCoach = soccerRoles.find((r) => r.name === "Head Coach");
  if (headCoach?.quantityRemaining !== 0) fail(`Head Coach should be 0 remaining, got ${headCoach?.quantityRemaining}`);

  const expiredItem = await dal.itemRequests.getById(ctx, hygieneKits.request.id);
  if (expiredItem?.status !== "active" || expiredItem.expiresOn !== yesterday) {
    fail(`hygiene kits should be active with expires_on=${yesterday}, got ${expiredItem?.status}/${expiredItem?.expiresOn}`);
  }
  const expiredVol = await dal.volunteerRequests.getById(ctx, esl.request.id);
  if (expiredVol?.status !== "active" || expiredVol.expiresOn !== yesterday) {
    fail(`ESL should be active with expires_on=${yesterday}, got ${expiredVol?.status}/${expiredVol?.expiresOn}`);
  }

  const patCheck = await dal.people.findByEmail(ctx, "pat.nguyen@example.org");
  if (!patCheck?.needsReview || !patCheck.reviewNote) fail("needs_review person missing or note empty");

  const bridgeCheck = await dal.organizations.getBySlug(ctx, "bridge-of-hope-single-parents");
  if (bridgeCheck?.status !== "pending") fail(`Bridge of Hope should be pending, got ${bridgeCheck?.status}`);

  const alexCheck = await dal.users.findByEmail(SYSTEM, "supporter@example.org");
  if (!alexCheck || alexCheck.status !== "active") fail("supporter account (supporter@example.org) missing or not active");
  if (alexCheck.kind !== "supporter") fail(`supporter account should have kind='supporter', got '${alexCheck.kind}'`);

  const allianceStaff = await dal.memberships.listByOrganization(ctx, alliance.id);
  const staffRoles = allianceStaff.map((m) => m.role).sort();
  if (staffRoles.join(",") !== "staff_admin,staff_admin,staff_approver") {
    fail(`Alliance staff should be exactly 2 staff_admin + 1 staff_approver, got [${staffRoles.join(", ")}]`);
  }
  if (await dal.people.findByEmail(ctx, "admin@thealliance.example.org")) {
    fail("legacy synthetic staff_admin (admin@thealliance.example.org) still present");
  }

  console.log("");
  console.log("Seed complete and verified:");
  console.log("  populations: 11  |  counter_drift: 0 rows");
  console.log("  orgs: The Alliance (platform owner) + 3 approved + 1 pending");
  console.log("  item requests: 2 active, 1 auto-archived (fulfilled), 1 draft, 1 pending, 1 expired-but-active");
  console.log("  volunteer requests: 2 active, 1 draft, 1 pending, 1 expired-but-active");
  console.log("  zero-remaining: 'Twin mattress protector' item, 'Head Coach' role");
  console.log("  needs_review person: pat.nguyen@example.org");
  console.log("");
  console.log("  STAFF LOGINS:");
  console.log("    staff_admin:    tiffany@defendingthecause.org  (Tiffany Loeffler)");
  console.log("    staff_admin:    christina@defendingthecause.org  (Christina Moe)");
  console.log("    staff_approver: approver@thealliance.example.org  (Riley Chen — synthetic, cannot receive mail)");
  console.log("  Org owner logins: dana@heartsandhands.example.org, samuel@newhorizons.example.org, grace@safeharbor.example.org");
  console.log("  Supporter login:  supporter@example.org  (Alex Rivera — synthetic, cannot receive mail)");
}
main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
