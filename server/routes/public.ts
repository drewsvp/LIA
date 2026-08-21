/**
 * Public API for the PB surfaces.
 *
 * Serialization is ALLOW-LISTED (PB-01/PB-02 §11): payloads carry exactly
 * what the public page renders and nothing else — never a contact person,
 * email, phone, supporter data, a non-active request, or a non-approved
 * organization. The active/approved filter lives in the shared DAL helpers
 * and the PUBLIC RLS context; a non-active :id is indistinguishable from a
 * nonexistent one.
 *
 * Writes go exclusively through the 0001 SQL functions via the DAL
 * (record_item_pledge) — no code path here touches a quantity column.
 */
import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { PUBLIC, SYSTEM, queryInContext, isUniqueViolation } from "../db/client";
import * as dal from "../dal";
import * as usersDal from "../dal/users";
import { PledgeError } from "../dal/pledges";
import { SignupError } from "../dal/signups";
import { FixedWindowLimiter } from "../auth/rate-limit";
import { NOT_FOUND_BODY } from "../auth/guards";
import { queueProductEmail, dispatchQueuedEmails, absoluteUrl, type PendingDispatch } from "../email/send";
import { storeImage } from "../storage/object-storage";
import { submitOrganizationSignup, OrgNameTakenError } from "../services/org-signup";
import { resolveSessionInfo } from "../auth/session";
import type { Item, PublicItemRequest, PublicVolunteerRequest } from "../../shared/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public write ceilings (D10): per-IP, per-endpoint, fixed 15-minute window. */
const pledgeIpLimiter = new FixedWindowLimiter(10, 15 * 60_000);
const signupIpLimiter = new FixedWindowLimiter(10, 15 * 60_000);
const subscribeIpLimiter = new FixedWindowLimiter(10, 15 * 60_000);
const orgSignupIpLimiter = new FixedWindowLimiter(10, 15 * 60_000);
const engagementIpLimiter = new FixedWindowLimiter(120, 15 * 60_000);

const ENGAGEMENT_EVENT_TYPES = new Set<dal.requestEngagement.EngagementEventType>([
  "card_click",
  "detail_view",
  "product_link_click",
  "form_start",
  "item_selected",
  "role_selected",
]);
const ENGAGEMENT_BODY_KEYS = new Set(["eventId", "eventType", "requestKind", "requestId", "targetId"]);

/** MP-03 logo: one image, in memory, stored before the tx (upload failure is non-blocking, §12). */
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const DEADLINE_LABELS: Record<string, string> = {
  until_fulfilled: "Until Fulfilled",
  date_specific: "Date Specific",
  ongoing: "Ongoing",
};

export function humanizeDeadlineType(value: string): string {
  return DEADLINE_LABELS[value] ?? value;
}

export function formatDeadlineDate(iso: string | null): string | null {
  if (iso == null || iso === "") return null;
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------- supporter opt-ins

/**
 * Post-success opt-ins from the public claim/volunteer forms. Runs AFTER the
 * pledge/signup is committed; failures here are logged loudly and never
 * un-succeed the submission. Returns whether a supporter profile now exists
 * for this email so the response can say "log in with your email".
 */
async function processSupporterOptIns(opts: {
  email: string;
  firstName: string;
  lastName: string;
  createProfile: boolean;
  subscribeDigest: boolean;
  logTag: string;
}): Promise<{ profileReady: boolean }> {
  let profileReady = false;
  // The SQL function just upserted the person by email; resolve it for linking.
  let personId: string | null = null;
  try {
    const person = await dal.people.findByEmail(SYSTEM, opts.email);
    personId = person?.id ?? null;
  } catch (err) {
    console.error(`[public] ${opts.logTag}: person lookup for opt-ins failed:`, err);
  }

  if (opts.subscribeDigest) {
    try {
      // Idempotent by lower(email); revives unsubscribed rows and links the
      // person record when the row has none.
      await dal.digestSubscribers.create(SYSTEM, {
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        personId,
      });
    } catch (err) {
      console.error(`[public] ${opts.logTag}: digest opt-in failed (submission stands):`, err);
    }
  }

  if (opts.createProfile) {
    try {
      const existing = await usersDal.findByEmail(SYSTEM, opts.email);
      if (existing) {
        // Reuse: any non-disabled account can already log in via magic link.
        profileReady = existing.status !== "disabled";
      } else if (personId !== null) {
        await usersDal.create(SYSTEM, { personId, status: "active", kind: "supporter" });
        profileReady = true;
      } else {
        console.error(`[public] ${opts.logTag}: cannot create supporter profile — no person row found`);
      }
    } catch (err) {
      console.error(`[public] ${opts.logTag}: supporter profile creation failed (submission stands):`, err);
    }
  }
  return { profileReady };
}

// ---------------------------------------------------------------- payloads

/** Org fields the public browse cards render. slug builds the PB-08 link. */
export type PublicOrgCard = {
  name: string;
  slug: string;
  city: string | null;
  logoUrl: string | null;
};

export type PublicItemRequestListPayload = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  organization: PublicOrgCard;
};

/** Item fields PB-02 renders. Counters are display + courtesy validation only. */
export type PublicItemPayload = {
  id: string;
  name: string;
  description: string | null;
  condition: string | null;
  productUrl: string | null;
  quantityRequested: number;
  quantityClaimed: number;
  quantityRemaining: number;
};

export type PublicItemRequestDetailPayload = {
  request: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    dropoffLocation: string | null;
    deadlineType: string;
    deadlineDate: string | null;
  };
  organization: {
    name: string;
    slug: string;
    websiteUrl: string | null;
    mission: string | null;
    populations: string[];
  };
  items: PublicItemPayload[];
};

/** PB-08 — the organization's own public identity block. */
export type PublicOrganizationProfilePayload = {
  organization: {
    name: string;
    slug: string;
    mission: string | null;
    websiteUrl: string | null;
    city: string | null;
    logoUrl: string | null;
  };
  itemRequests: PublicItemRequestListPayload[];
  volunteerRequests: PublicVolunteerRequestListPayload[];
};
export type PublicVolunteerRequestListPayload = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  /** Free-text per-request field — the card's location value (PB-03 §5). */
  eventLocation: string | null;
  organization: PublicOrgCard;
};

function toVolunteerListPayload(r: PublicVolunteerRequest): PublicVolunteerRequestListPayload {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    imageUrl: r.imageUrl,
    eventLocation: r.eventLocation,
    organization: {
      name: r.organization.name,
      slug: r.organization.slug,
      city: r.organization.city,
      logoUrl: r.organization.logoUrl,
    },
  };
}

/**
 * Role fields PB-04 renders. quantity_confirmed is the organization's
 * PRIVATE record (PB-04 §3) — it must never appear here.
 */
export type PublicVolunteerRolePayload = {
  id: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  quantityInterested: number;
  quantityRemaining: number;
};

export type PublicVolunteerRequestDetailPayload = {
  request: {
    id: string;
    title: string;
    description: string | null;
    details: string | null;
    imageUrl: string | null;
    eventLocation: string | null;
    deadlineType: string;
    deadlineDate: string | null;
  };
  organization: {
    name: string;
    slug: string;
    websiteUrl: string | null;
    mission: string | null;
    populations: string[];
  };
  roles: PublicVolunteerRolePayload[];
};

async function loadPublicRoles(requestId: string): Promise<PublicVolunteerRolePayload[]> {
  const roles = await dal.volunteerRoles.listByRequest(PUBLIC, requestId);
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    quantityNeeded: r.quantityNeeded,
    quantityInterested: r.quantityInterested,
    quantityRemaining: r.quantityRemaining,
  }));
}

function toItemListPayload(r: PublicItemRequest): PublicItemRequestListPayload {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    imageUrl: r.imageUrl,
    organization: {
      name: r.organization.name,
      slug: r.organization.slug,
      city: r.organization.city,
      logoUrl: r.organization.logoUrl,
    },
  };
}

function toPublicItem(item: Item): PublicItemPayload {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    condition: item.condition,
    productUrl: item.productUrl,
    quantityRequested: item.quantityRequested,
    quantityClaimed: item.quantityClaimed,
    quantityRemaining: item.quantityRemaining,
  };
}

async function loadPublicItems(requestId: string): Promise<PublicItemPayload[]> {
  const items = await dal.items.listByRequest(PUBLIC, requestId);
  return items.map(toPublicItem);
}

// ---------------------------------------------------------------- routes

export function registerPublicRoutes(app: Express): void {
  // Privacy-safe engagement ingestion. The only optional attribution is the
  // current valid application session; anonymous requests gain no cookie or
  // stable identifier. Unknown fields are refused so form contents can never
  // accidentally enter this event boundary.
  app.post("/api/public/engagement", async (req: Request, res: Response, next) => {
    try {
      if (!engagementIpLimiter.consume(req.ip ?? "unknown")) {
        res.status(429).json({ message: "Too many engagement events." });
        return;
      }
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        res.status(400).json({ message: "Invalid engagement event." });
        return;
      }
      const raw = body as Record<string, unknown>;
      if (Object.keys(raw).some((key) => !ENGAGEMENT_BODY_KEYS.has(key))) {
        res.status(400).json({ message: "Invalid engagement event." });
        return;
      }
      const eventId = typeof raw.eventId === "string" ? raw.eventId : "";
      const eventType = typeof raw.eventType === "string" ? raw.eventType : "";
      const requestKind = raw.requestKind;
      const requestId = typeof raw.requestId === "string" ? raw.requestId : "";
      const targetId = raw.targetId === undefined || raw.targetId === null ? null : raw.targetId;
      const childEvent =
        eventType === "product_link_click" || eventType === "item_selected" || eventType === "role_selected";
      if (
        !UUID_RE.test(eventId) ||
        !ENGAGEMENT_EVENT_TYPES.has(eventType as dal.requestEngagement.EngagementEventType) ||
        (requestKind !== "item" && requestKind !== "volunteer") ||
        !UUID_RE.test(requestId) ||
        (childEvent ? typeof targetId !== "string" || !UUID_RE.test(targetId) : targetId !== null) ||
        (requestKind === "item" && eventType === "role_selected") ||
        (requestKind === "volunteer" &&
          (eventType === "product_link_click" || eventType === "item_selected"))
      ) {
        res.status(400).json({ message: "Invalid engagement event." });
        return;
      }

      const session = await resolveSessionInfo(req);
      const result = await dal.requestEngagement.recordPublicEvent(SYSTEM, {
        clientEventId: eventId,
        eventType: eventType as dal.requestEngagement.EngagementEventType,
        requestKind,
        requestId,
        targetId: targetId as string | null,
        userId: session.authenticated && session.user ? session.user.id : null,
      });
      if (result === "not_public") {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      if (result === "invalid_target") {
        res.status(400).json({ message: "Invalid engagement target." });
        return;
      }
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- PB-01: browse active item requests of approved member orgs.
  app.get("/api/public/item-requests", async (_req: Request, res: Response, next) => {
    try {
      const rows = await dal.itemRequests.listActivePublic(PUBLIC);
      const requests: PublicItemRequestListPayload[] = [];
      for (const row of rows) {
        // Join guarantees resolution; this is the stated belt-and-suspenders
        // rule (PB-01 §12): exclude and log, never render a broken card.
        if (!row.organization || row.organization.name.trim() === "") {
          console.error(`[public] item request ${row.id} excluded: organization did not resolve`);
          continue;
        }
        requests.push(toItemListPayload(row));
      }
      res.json({ requests });
    } catch (err) {
      next(err);
    }
  });

  // ---- PB-03: browse active volunteer requests of approved member orgs.
  app.get("/api/public/volunteer-requests", async (_req: Request, res: Response, next) => {
    try {
      const rows = await dal.volunteerRequests.listActivePublic(PUBLIC);
      const requests: PublicVolunteerRequestListPayload[] = [];
      for (const row of rows) {
        if (!row.organization || row.organization.name.trim() === "") {
          console.error(`[public] volunteer request ${row.id} excluded: organization did not resolve`);
          continue;
        }
        requests.push(toVolunteerListPayload(row));
      }
      res.json({ requests });
    } catch (err) {
      next(err);
    }
  });

  // ---- PB-08: public organization profile by slug. A non-approved org is
  // indistinguishable from a slug that does not exist — same JSON 404 body as
  // every other public detail endpoint.
  app.get("/api/public/organizations/:slug", async (req: Request, res: Response, next) => {
    try {
      const slug = (req.params.slug ?? "").trim().toLowerCase();
      if (slug === "" || slug.length > 200) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const org = await dal.organizations.getBySlug(PUBLIC, slug);
      // Explicit status check — the runtime DB role has BYPASSRLS, so the
      // PUBLIC context filters nothing. Pending, disabled, and rejected orgs
      // all fall through to the 404 above. The platform owner keeps a profile:
      // it is an approved organization and its identity is already public.
      if (!org || org.status !== "approved") {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const [itemRows, volunteerRows] = await Promise.all([
        dal.itemRequests.listActivePublic(PUBLIC, org.id),
        dal.volunteerRequests.listActivePublic(PUBLIC, org.id),
      ]);
      const payload: PublicOrganizationProfilePayload = {
        organization: {
          name: org.name,
          slug: org.slug,
          mission: org.mission,
          websiteUrl: org.websiteUrl,
          city: org.city,
          logoUrl: org.logoUrl,
        },
        itemRequests: itemRows.map(toItemListPayload),
        volunteerRequests: volunteerRows.map(toVolunteerListPayload),
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  // ---- PB-02: item request detail. Non-active === nonexistent.
  app.get("/api/public/item-requests/:id", async (req: Request, res: Response, next) => {
    try {
      const id = req.params.id ?? "";
      if (!UUID_RE.test(id)) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const request = await dal.itemRequests.getActiveAvailableById(PUBLIC, id);
      if (!request) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const [org, items, populations] = await Promise.all([
        dal.organizations.getById(PUBLIC, request.orgId),
        loadPublicItems(id),
        dal.populations.listByOrganization(PUBLIC, request.orgId),
      ]);
      if (!org || org.status !== "approved" || org.kind !== "member_org") {
        // Explicit check — the runtime DB role has BYPASSRLS, so the PUBLIC
        // context does NOT filter rows. Never trust the fetch alone.
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const payload: PublicItemRequestDetailPayload = {
        request: {
          id: request.id,
          title: request.title,
          description: request.description,
          imageUrl: request.imageUrl,
          dropoffLocation: request.dropoffLocation,
          deadlineType: request.deadlineType,
          deadlineDate: request.deadlineDate,
        },
        organization: {
          name: org.name,
          slug: org.slug,
          websiteUrl: org.websiteUrl,
          mission: org.mission,
          populations: populations.map((p) => p.name),
        },
        items,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  // ---- PB-02: record a pledge. The ONLY write is record_item_pledge().
  app.post("/api/public/item-requests/:id/pledges", async (req: Request, res: Response, next) => {
    try {
      const requestId = req.params.id ?? "";
      if (!UUID_RE.test(requestId)) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      if (!pledgeIpLimiter.consume(req.ip ?? "unknown")) {
        res.status(429).json({
          message: "Too many submissions from this connection. Please wait a few minutes and try again.",
        });
        return;
      }

      // Review fix: record_item_pledge runs SYSTEM-side and checks only
      // request.status — not whether the parent org is still publicly
      // visible. Gate the POST on the same PUBLIC-context visibility the
      // GETs use, so a request under a since-unapproved org is
      // indistinguishable from a nonexistent one. A non-active request
      // under a still-approved org keeps its 410 contract. Residual race
      // (org unapproved between this check and the function call) needs the
      // SQL function to join the org — out of this work order's lane.
      // Visibility = active request (PUBLIC RLS) AND approved org — the
      // same pair the GET uses. Request-only was not enough: the request
      // policy doesn't look at the org.
      // Review fix: record_item_pledge checks only request.status, and the
      // runtime DB role has BYPASSRLS — no RLS policy filters anything at
      // runtime. Every visibility rule must therefore be explicit here:
      // request active AND org approved member_org (same rule as the GET
      // and the browse SQL). Non-active under a public org keeps its 410
      // contract; everything else is indistinguishable from nonexistent.
      const gateRequest = await dal.itemRequests.getById(PUBLIC, requestId);
      const gateOrg = gateRequest === null ? null : await dal.organizations.getById(PUBLIC, gateRequest.orgId);
      const orgIsPublic = gateOrg !== null && gateOrg.status === "approved" && gateOrg.kind === "member_org";
      if (gateRequest === null || !orgIsPublic) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      if (gateRequest.status !== "active") {
        res.status(410).json({ code: "request_not_active" });
        return;
      }
      // An active request can still be closed before the nightly archive pass
      // when its date-specific deadline (or legacy archive date) has passed.
      // The SQL pledge trigger repeats this check under the write transaction
      // so a midnight race cannot record a late donation.
      if (!(await dal.itemRequests.getActiveAvailableById(PUBLIC, requestId))) {
        res.status(410).json({ code: "request_not_active" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
      const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const rawLines = Array.isArray(body.lines) ? (body.lines as unknown[]) : [];
      const agree = body.agree === true;
      const createProfile = body.createProfile === true;
      const subscribeDigest = body.subscribeDigest === true;

      if (firstName === "" || lastName === "" || firstName.length > 120 || lastName.length > 120) {
        res.status(400).json({ message: "Please provide your first and last name." });
        return;
      }
      if (!agree) {
        // Server-side enforcement of the fulfillment agreement (was client-only).
        res.status(400).json({ message: "Please agree to fulfill this request within the next 2 weeks." });
        return;
      }
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ message: "Please enter a valid email." });
        return;
      }
      if (phone === "" || phone.length > 40) {
        res.status(400).json({ message: "Please provide a phone number." });
        return;
      }
      const lines: { itemId: string; quantity: number }[] = [];
      for (const raw of rawLines) {
        if (typeof raw !== "object" || raw === null) continue;
        const itemId = (raw as { itemId?: unknown }).itemId;
        const quantity = (raw as { quantity?: unknown }).quantity;
        if (typeof itemId !== "string" || !UUID_RE.test(itemId)) continue;
        if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0 || quantity > 9999) continue;
        lines.push({ itemId, quantity });
      }
      if (lines.length === 0 || lines.length > 40) {
        res.status(400).json({ message: "Please claim at least one item." });
        return;
      }

      let pledgeId: string;
      try {
        ({ pledgeId } = await dal.pledges.recordItemPledge(PUBLIC, {
          firstName,
          lastName,
          email,
          phone,
          requestId,
          lines,
        }));
      } catch (err) {
        if (err instanceof PledgeError) {
          switch (err.code) {
            case "insufficient_quantity": {
              // The collision path (PB-02 §12 row 1): nothing was recorded.
              // Return refreshed availability and name what changed.
              const refreshed = await loadPublicItems(requestId);
              const byId = new Map(refreshed.map((i) => [i.id, i]));
              const offenders = lines
                .map((l) => ({ line: l, item: byId.get(l.itemId) }))
                .filter((x) => x.item !== undefined && x.line.quantity > x.item.quantityRemaining)
                .map((x) => ({
                  itemId: x.item!.id,
                  name: x.item!.name,
                  quantityRemaining: x.item!.quantityRemaining,
                }));
              const parts = offenders.map((o) =>
                o.quantityRemaining === 0
                  ? `"${o.name}" has just been fully claimed by another donor`
                  : `"${o.name}" now has only ${o.quantityRemaining} still needed`,
              );
              res.status(409).json({
                code: "insufficient_quantity",
                message:
                  parts.length > 0
                    ? `Your donation was not recorded: ${parts.join("; ")}. The quantities below have been refreshed — please adjust and submit again.`
                    : "Your donation was not recorded because another donor claimed some of these items first. The quantities below have been refreshed — please adjust and submit again.",
                offenders,
                items: refreshed,
              });
              return;
            }
            case "request_not_active":
              res.status(410).json({ code: "request_not_active" });
              return;
            case "request_not_found":
              res.status(404).json(NOT_FOUND_BODY);
              return;
            default:
              // Tampered or stale payload (item_not_in_request etc.): generic, logged.
              console.error(`[public] pledge rejected (${err.code}) on request ${requestId}: ${err.message}`);
              res.status(400).json({
                code: "invalid_submission",
                message: "Something went wrong with your submission. Please refresh the page and try again.",
              });
              return;
          }
        }
        throw err;
      }

      // ---- Pledge stands. Queue both emails, respond, then dispatch —
      // an email failure never un-succeeds a pledge (§12).
      const pending: PendingDispatch[] = [];
      try {
        const rows = await queryInContext<{
          title: string;
          description: string | null;
          dropoffLocation: string | null;
          deadlineType: string;
          deadlineDate: string | null;
          orgName: string;
          contactName: string | null;
          contactEmail: string | null;
          contactPhone: string | null;
          donorPersonId: string;
        }>(
          SYSTEM,
          `select r.title, r.description, r.dropoff_location as "dropoffLocation",
                  r.deadline_type as "deadlineType", r.deadline_date as "deadlineDate",
                  o.name as "orgName",
                  cp.first_name || ' ' || cp.last_name as "contactName",
                  cp.email as "contactEmail", cp.phone as "contactPhone",
                  ip.person_id as "donorPersonId"
             from item_requests r
             join organizations o on o.id = r.org_id
             left join people cp on cp.id = r.contact_person_id
             join item_pledges ip on ip.item_request_id = r.id
            where r.id = $1 and ip.id = $2`,
          [requestId, pledgeId],
        );
        const info = rows[0];
        const lineRows = await queryInContext<{ name: string; quantity: number }>(
          SYSTEM,
          `select i.name, l.quantity from item_pledge_lines l join items i on i.id = l.item_id
            where l.item_pledge_id = $1 order by i.sort_order asc`,
          [pledgeId],
        );
        if (info) {
          const donorName = `${firstName} ${lastName}`;
          const requestUrl = absoluteUrl(`/items/${requestId}`);
          if (info.contactName && info.contactEmail) {
            const donor = await queueProductEmail(SYSTEM, {
              key: "donor_item_confirmation",
              entityId: pledgeId,
              toEmail: email,
              toPersonId: info.donorPersonId,
              replyTo: info.contactEmail,
              vars: {
                donorName,
                organizationName: info.orgName,
                requestContactName: info.contactName,
                requestContactEmail: info.contactEmail,
                requestContactPhone: info.contactPhone,
                requestName: info.title,
                requestDescription: info.description,
                requestDeadlineType: humanizeDeadlineType(info.deadlineType),
                requestDeadlineDate: info.deadlineType === "date_specific" ? formatDeadlineDate(info.deadlineDate) : null,
                dropoffLocation: info.dropoffLocation,
                requestUrl,
                items: lineRows,
              },
            });
            if (donor.outcome === "queued") pending.push(donor.dispatch);
            const org = await queueProductEmail(SYSTEM, {
              key: "org_new_item_donation",
              entityId: pledgeId,
              toEmail: info.contactEmail,
              replyTo: email,
              vars: {
                organizationName: info.orgName,
                requestName: info.title,
                requestDescription: info.description,
                requestUrl,
                items: lineRows,
                donorName,
                donorEmail: email,
                donorPhone: phone,
                supportersUrl: absoluteUrl("/dashboard/supporters"),
              },
            });
            if (org.outcome === "queued") pending.push(org.dispatch);
          } else {
            // No resolvable request contact: donor cannot be told whom to
            // reach and the org has no inbox to notify. Loud, never silent.
            console.error(
              `[public] pledge ${pledgeId} recorded but request ${requestId} has no resolvable contact person — confirmation emails not queued`,
            );
          }
        } else {
          console.error(`[public] pledge ${pledgeId} recorded but email context query returned nothing`);
        }
      } catch (err) {
        console.error(`[public] pledge ${pledgeId} recorded but email queueing failed:`, err);
      }

      // ---- Opt-ins run after the pledge is committed and never undo it.
      const { profileReady } = await processSupporterOptIns({
        email,
        firstName,
        lastName,
        createProfile,
        subscribeDigest,
        logTag: `pledge ${pledgeId}`,
      });

      res.status(201).json({
        ok: true,
        profileCreated: profileReady,
        message: "Thank you for your donation! Check your email for a confirmation with details on how to deliver your items.",
      });
      if (pending.length > 0) void dispatchQueuedEmails(pending);
    } catch (err) {
      next(err);
    }
  });

  // ---- PB-04: volunteer request detail. Non-active === nonexistent.
  app.get("/api/public/volunteer-requests/:id", async (req: Request, res: Response, next) => {
    try {
      const id = req.params.id ?? "";
      if (!UUID_RE.test(id)) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const request = await dal.volunteerRequests.getById(PUBLIC, id);
      if (!request || request.status !== "active") {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const [org, roles, populations] = await Promise.all([
        dal.organizations.getById(PUBLIC, request.orgId),
        loadPublicRoles(id),
        dal.populations.listByOrganization(PUBLIC, request.orgId),
      ]);
      if (!org || org.status !== "approved" || org.kind !== "member_org") {
        // Explicit check — BYPASSRLS role; see the item detail handler.
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const payload: PublicVolunteerRequestDetailPayload = {
        request: {
          id: request.id,
          title: request.title,
          description: request.description,
          details: request.details,
          imageUrl: request.imageUrl,
          eventLocation: request.eventLocation,
          deadlineType: request.deadlineType,
          deadlineDate: request.deadlineDate,
        },
        organization: {
          name: org.name,
          slug: org.slug,
          websiteUrl: org.websiteUrl,
          mission: org.mission,
          populations: populations.map((p) => p.name),
        },
        roles,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  // ---- PB-04: record interest. The ONLY write is record_volunteer_signup().
  app.post("/api/public/volunteer-requests/:id/signups", async (req: Request, res: Response, next) => {
    try {
      const requestId = req.params.id ?? "";
      if (!UUID_RE.test(requestId)) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      if (!signupIpLimiter.consume(req.ip ?? "unknown")) {
        res.status(429).json({
          message: "Too many submissions from this connection. Please wait a few minutes and try again.",
        });
        return;
      }

      // Review fix: same PUBLIC-visibility gate as the pledge POST —
      // record_volunteer_signup checks only request.status, not the parent
      // org's public visibility. See the pledge handler for the rationale
      // and the residual-race note.
      // Review fix: explicit visibility gate (BYPASSRLS role — RLS filters
      // nothing at runtime). See the pledge handler for the full rationale.
      const gateRequest = await dal.volunteerRequests.getById(PUBLIC, requestId);
      const gateOrg = gateRequest === null ? null : await dal.organizations.getById(PUBLIC, gateRequest.orgId);
      const orgIsPublic = gateOrg !== null && gateOrg.status === "approved" && gateOrg.kind === "member_org";
      if (gateRequest === null || !orgIsPublic) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      if (gateRequest.status !== "active") {
        res.status(410).json({ code: "request_not_active" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
      const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const notesRaw = typeof body.notes === "string" ? body.notes.trim() : "";
      const notes = notesRaw === "" ? null : notesRaw;
      const rawRoleIds = Array.isArray(body.roleIds) ? (body.roleIds as unknown[]) : [];
      const createProfile = body.createProfile === true;
      const subscribeDigest = body.subscribeDigest === true;

      if (firstName === "" || lastName === "" || firstName.length > 120 || lastName.length > 120) {
        res.status(400).json({ message: "Please provide your first and last name." });
        return;
      }
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ message: "Please enter a valid email." });
        return;
      }
      if (phone === "" || phone.length > 40) {
        res.status(400).json({ message: "Please provide a phone number." });
        return;
      }
      if (notes !== null && notes.length > 2000) {
        res.status(400).json({ message: "Notes must be 2000 characters or fewer." });
        return;
      }
      const roleIds = [...new Set(rawRoleIds.filter((r): r is string => typeof r === "string" && UUID_RE.test(r)))];
      if (roleIds.length === 0 || roleIds.length > 20) {
        res.status(400).json({ message: "Please select at least one role." });
        return;
      }

      let signupId: string;
      try {
        ({ signupId } = await dal.signups.recordVolunteerSignup(PUBLIC, {
          firstName,
          lastName,
          email,
          phone,
          requestId,
          notes,
          roleIds,
        }));
      } catch (err) {
        if (err instanceof SignupError) {
          switch (err.code) {
            case "role_full": {
              // Rolled back (PB-04 §12): refresh availability, name the filled
              // role(s), and let the client keep every entered value.
              const refreshed = await loadPublicRoles(requestId);
              const byId = new Map(refreshed.map((r) => [r.id, r]));
              const offenders = roleIds
                .map((id) => byId.get(id))
                .filter((r): r is PublicVolunteerRolePayload => r !== undefined && r.quantityRemaining <= 0)
                .map((r) => ({ roleId: r.id, name: r.name }));
              const names = offenders.map((o) => `"${o.name}"`).join(", ");
              res.status(409).json({
                code: "role_full",
                message:
                  offenders.length > 0
                    ? `Your interest was not recorded: ${names} just reached the number of volunteers needed. The roles below have been refreshed — please adjust your selection and submit again.`
                    : "Your interest was not recorded because one of the selected roles just filled. The roles below have been refreshed — please adjust your selection and submit again.",
                offenders,
                roles: refreshed,
              });
              return;
            }
            case "duplicate_role":
              res.status(409).json({
                code: "duplicate_role",
                message:
                  "Our records show you've already expressed interest in one of these roles. The organization will be reaching out to you — no need to sign up again!",
              });
              return;
            case "request_not_active":
              res.status(410).json({ code: "request_not_active" });
              return;
            case "request_not_found":
              res.status(404).json(NOT_FOUND_BODY);
              return;
            case "no_roles":
              res.status(400).json({ message: "Please select at least one role." });
              return;
            default:
              // role_not_in_request: tampered or stale payload. Generic, logged.
              console.error(`[public] signup rejected (${err.code}) on request ${requestId}: ${err.message}`);
              res.status(400).json({
                code: "invalid_submission",
                message: "Something went wrong with your submission. Please refresh the page and try again.",
              });
              return;
          }
        }
        throw err;
      }

      // ---- Signup stands. Queue emails, respond, dispatch after (§12).
      const pending: PendingDispatch[] = [];
      try {
        const rows = await queryInContext<{
          title: string;
          description: string | null;
          details: string | null;
          deadlineType: string;
          orgName: string;
          contactName: string | null;
          contactEmail: string | null;
          contactPhone: string | null;
          volunteerPersonId: string;
        }>(
          SYSTEM,
          `select r.title, r.description, r.details, r.deadline_type as "deadlineType",
                  o.name as "orgName",
                  cp.first_name || ' ' || cp.last_name as "contactName",
                  cp.email as "contactEmail", cp.phone as "contactPhone",
                  vs.person_id as "volunteerPersonId"
             from volunteer_requests r
             join organizations o on o.id = r.org_id
             left join people cp on cp.id = r.contact_person_id
             join volunteer_signups vs on vs.volunteer_request_id = r.id
            where r.id = $1 and vs.id = $2`,
          [requestId, signupId],
        );
        const info = rows[0];
        const roleRows = await queryInContext<{ name: string }>(
          SYSTEM,
          `select name from volunteer_roles where id = any($1::uuid[]) order by sort_order asc`,
          [roleIds],
        );
        const roleNames = roleRows.map((r) => r.name);
        if (info) {
          const donorName = `${firstName} ${lastName}`;
          const requestUrl = absoluteUrl(`/volunteer/${requestId}`);
          const supportersUrl = absoluteUrl("/dashboard/supporters");
          const staffPrimary = (process.env.STAFF_NOTIFY_PRIMARY ?? "").trim();
          const staffSecondary = (process.env.STAFF_NOTIFY_SECONDARY ?? "").trim();
          if (info.contactName && info.contactEmail) {
            const donor = await queueProductEmail(SYSTEM, {
              key: "donor_volunteer_confirmation",
              entityId: signupId,
              toEmail: email,
              toPersonId: info.volunteerPersonId,
              replyTo: info.contactEmail,
              vars: {
                donorName,
                organizationName: info.orgName,
                requestContactName: info.contactName,
                requestContactEmail: info.contactEmail,
                requestContactPhone: info.contactPhone,
                requestName: info.title,
                requestDescription: info.description,
                requestDeadlineType: humanizeDeadlineType(info.deadlineType),
                requestDetails: info.details,
                requestUrl,
                roles: roleNames,
                followUpWindow: "1-3 business days",
              },
            });
            if (donor.outcome === "queued") pending.push(donor.dispatch);
            // org_new_volunteer goes to the request contact AND both staff
            // addresses (D53) — distinct recipients queue their own rows.
            const orgRecipients = [info.contactEmail, staffPrimary, staffSecondary].filter((e) => e !== "");
            if (staffPrimary === "" || staffSecondary === "") {
              console.error(
                `[public] signup ${signupId}: STAFF_NOTIFY_PRIMARY/SECONDARY not fully configured — org_new_volunteer staff copies incomplete`,
              );
            }
            for (const recipient of orgRecipients) {
              const orgMail = await queueProductEmail(SYSTEM, {
                key: "org_new_volunteer",
                entityId: signupId,
                toEmail: recipient,
                replyTo: staffPrimary !== "" ? staffPrimary : undefined,
                vars: {
                  organizationName: info.orgName,
                  requestName: info.title,
                  requestDescription: info.description,
                  requestDetails: info.details,
                  requestUrl,
                  roles: roleNames,
                  donorName,
                  donorEmail: email,
                  donorPhone: phone,
                  donorNotes: notes,
                  supportersUrl,
                },
              });
              if (orgMail.outcome === "queued") pending.push(orgMail.dispatch);
            }
          } else {
            console.error(
              `[public] signup ${signupId} recorded but request ${requestId} has no resolvable contact person — confirmation emails not queued`,
            );
          }
        } else {
          console.error(`[public] signup ${signupId} recorded but email context query returned nothing`);
        }
      } catch (err) {
        console.error(`[public] signup ${signupId} recorded but email queueing failed:`, err);
      }

      // ---- Opt-ins run after the signup is committed and never undo it.
      const { profileReady } = await processSupporterOptIns({
        email,
        firstName,
        lastName,
        createProfile,
        subscribeDigest,
        logTag: `signup ${signupId}`,
      });

      res.status(201).json({
        ok: true,
        profileCreated: profileReady,
        message:
          "Thank you for expressing interest! Check your email for a confirmation — a representative from the requesting organization will reach out to you within 1-3 business days.",
      });
      if (pending.length > 0) void dispatchQueuedEmails(pending);
    } catch (err) {
      next(err);
    }
  });

  // ---- MP-03: population options for the signup checklist (D61).
  app.get("/api/public/populations", async (_req: Request, res: Response, next) => {
    try {
      const all = await dal.populations.listAll(PUBLIC);
      res.json(all.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name, slug: p.slug })));
    } catch (err) {
      next(err);
    }
  });

  // ---- MP-03: organization self-registration. One transaction; §12 error paths.
  app.post("/api/public/organization-signups", (req: Request, res: Response, next: NextFunction) => {
    logoUpload.single("logo")(req, res, (err: unknown) => {
      if (err) {
        // Multer aborts multipart parsing on failure (size cap, malformed
        // stream), so the field values are unusable — loud 400; the client
        // retains every entered value. The §12 "upload failure still
        // submits" path is the storage-layer failure below, which the
        // client-side size/type gate makes the realistic one.
        console.error("[signup] logo upload rejected before parse:", err);
        res.status(400).json({
          message: "That image could not be uploaded. Please choose an image under 5 MB and try again.",
        });
        return;
      }
      void handleOrganizationSignup(req, res, next);
    });
  });

  async function handleOrganizationSignup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!orgSignupIpLimiter.consume(req.ip ?? "unknown")) {
        res.status(429).json({
          message: "Too many submissions from this connection. Please wait a few minutes and try again.",
        });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const text = (key: string, max: number): string => {
        const v = body[key];
        return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
      };

      const name = text("name", 200);
      const websiteRaw = text("websiteUrl", 300);
      const city = text("city", 120);
      const phone = text("phone", 40);
      const mission = text("mission", 5000);
      const populationsOtherRaw = text("populationsOther", 300);
      const firstName = text("firstName", 120);
      const lastName = text("lastName", 120);
      const email = text("email", 254).toLowerCase();
      const contactPhone = text("contactPhone", 40);

      const rawPop = body.populationIds;
      const popList = Array.isArray(rawPop) ? rawPop : typeof rawPop === "string" ? [rawPop] : [];
      const populationIds = [...new Set(popList.filter((p): p is string => typeof p === "string" && UUID_RE.test(p)))];

      if (name === "") {
        res.status(400).json({ message: "Please provide your organization's name." });
        return;
      }
      let websiteUrl = "";
      if (websiteRaw !== "") {
        const candidate = /^https?:\/\//i.test(websiteRaw) ? websiteRaw : `https://${websiteRaw}`;
        try {
          const parsed = new URL(candidate);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") websiteUrl = parsed.toString();
        } catch {
          /* handled below */
        }
      }
      if (websiteUrl === "") {
        res.status(400).json({ message: "Please enter a valid website URL." });
        return;
      }
      if (city === "" || phone === "" || mission === "") {
        res.status(400).json({ message: "Please fill in every required organization field." });
        return;
      }
      if (populationIds.length < 1 || populationIds.length > 2) {
        res.status(400).json({ message: "Please select 1-2 populations served." });
        return;
      }
      if (firstName === "" || lastName === "") {
        res.status(400).json({ message: "Please provide the primary contact's first and last name." });
        return;
      }
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ message: "Please enter a valid email." });
        return;
      }
      if (contactPhone === "") {
        res.status(400).json({ message: "Please provide the primary contact's phone number." });
        return;
      }

      // Logo: stored BEFORE the transaction; a storage failure is loud in the
      // logs but never blocks the submission (§12 resilience rule).
      let logoUrl: string | null = null;
      if (req.file) {
        try {
          const stored = await storeImage({ data: req.file.buffer, filename: req.file.originalname });
          logoUrl = stored.url;
        } catch (err) {
          console.error("[signup] logo storage failed — proceeding without a logo (§12):", err);
        }
      }

      try {
        const { orgId, dispatches } = await submitOrganizationSignup({
          name,
          websiteUrl,
          city,
          phone,
          mission,
          populationIds,
          populationsOther: populationsOtherRaw === "" ? null : populationsOtherRaw,
          logoUrl,
          contact: { firstName, lastName, email, phone: contactPhone },
        });
        res.status(201).json({ ok: true, orgId });
        if (dispatches.length > 0) void dispatchQueuedEmails(dispatches);
      } catch (err) {
        // The pre-check inside the tx catches almost every collision; the
        // unique constraint is the race-proof backstop (§7: block, never suffix).
        if (err instanceof OrgNameTakenError || isUniqueViolation(err, "organizations_name_key")) {
          res.status(409).json({
            code: "organization_exists",
            message:
              "It looks like your organization may already be registered. Please contact us at info@defendingthecause.org if you need help accessing your account.",
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }

  // ---- PB-05: digest subscribe. Single write, no emails queued (D28).
  app.post("/api/public/digest-subscriptions", async (req: Request, res: Response, next) => {
    try {
      if (!subscribeIpLimiter.consume(req.ip ?? "unknown")) {
        res.status(429).json({
          message: "Too many submissions from this connection. Please wait a few minutes and try again.",
        });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
      const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const subscribe = body.subscribe === true;
      if (!subscribe) {
        res.status(400).json({ message: "Please check the digest box to subscribe." });
        return;
      }
      // Names are REQUIRED by the spec (§5), validated here, and stored on
      // the digest_subscribers row itself (0004, D65): two columns, exactly
      // as entered, never concatenated. No people row is created (D27, §13).
      if (firstName === "" || lastName === "" || firstName.length > 120 || lastName.length > 120) {
        res.status(400).json({ message: "Please provide your first and last name." });
        return;
      }
      if (!EMAIL_RE.test(email.toLowerCase())) {
        res.status(400).json({ message: "Please enter a valid email." });
        return;
      }
      // Idempotent by lower(email); revives unsubscribed AND bounced rows
      // (D29) and refreshes the stored names to the values just submitted
      // (D65). Existing membership is never disclosed — same success either
      // way (§12). person_id stays null (D27).
      await dal.digestSubscribers.create(SYSTEM, { email, firstName, lastName });
      res.status(201).json({
        ok: true,
        message: "You're subscribed! Watch your inbox on Thursdays for new needs.",
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- PB-05: unsubscribe by token. Plain message either way, never a 404.
  app.post("/api/public/digest-subscriptions/unsubscribe", async (req: Request, res: Response, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!UUID_RE.test(token)) {
        res.json({ ok: false });
        return;
      }
      const row = await dal.digestSubscribers.updateStatusByToken(SYSTEM, token, "unsubscribed");
      res.json({ ok: row !== null });
    } catch (err) {
      next(err);
    }
  });

  // Matching-alert links are opaque, one-way capabilities: they can only turn
  // future alerts off. Replay is harmless and no account details are exposed.
  app.post("/api/public/volunteer-alerts/unsubscribe", async (req: Request, res: Response, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!UUID_RE.test(token)) {
        res.json({ ok: false });
        return;
      }
      const disabled = await dal.volunteerAlerts.disableByToken(SYSTEM, token);
      res.json({ ok: disabled });
    } catch (err) {
      next(err);
    }
  });
}
