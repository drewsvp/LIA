/**
 * Member-portal API routes (/api/dashboard/*), all behind requireOrganization.
 *
 * Scoping rule (Handbook §6): every read and write is filtered by the
 * session-resolved organization id from the guard — never an org id from the
 * request. Entity ids that miss, or belong to another organization, answer
 * through sendNotFound: byte-identical to a route that does not exist.
 */
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { SYSTEM, isUniqueViolation, withDbContext, q } from "../db/client";
import * as dal from "../dal";
import type { DeadlineType, ItemCondition } from "../../shared/types";
import { parseProductUrl } from "../../shared/item-product-url";
import { requireOrganization, orgContext, sendNotFound } from "../auth/guards";
import { storeImage } from "../storage/object-storage";
import { updateOrganizationSettings } from "../services/org-settings";
import { submitMemberInvite, DuplicateMembershipError } from "../services/member-invite";
import { submitItemRequest, NoItemsError } from "../services/item-submit";
import { sourceNeedImageInBackground } from "../services/need-image";
import { saveRequestEdits, IllegalStatusMoveError } from "../services/item-request-edit";
import { submitVolunteerRequest, NoRolesError } from "../services/volunteer-submit";
import { saveVolunteerRequestEdits, RoleOverInterestError } from "../services/volunteer-request-edit";
import { dispatchQueuedEmails } from "../email/send";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** §8 written voice: the one failure message every save path on MP-05 uses. */
const SAVE_FAILURE = "That didn't save. Please check the form and try again.";

/** MP-07 §8: this form's own written failure voice. */
const ITEM_SAVE_FAILURE = "Something went wrong and your request wasn't saved. Please try again.";

const DEADLINE_TYPES: readonly DeadlineType[] = ["ongoing", "until_fulfilled", "date_specific"];

const ITEM_CONDITIONS: readonly string[] = ["new", "gently_used", "any"];

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

export function registerMemberRoutes(app: Express): void {
  // ---- MP-04: dashboard overview. Org identity + both request lists, all
  // statuses, newest first. Scoped ONLY by the session-resolved org id; no
  // route shape on this surface accepts an organization identifier (§11).
  app.get("/api/dashboard/overview", requireOrganization, async (req: Request, res: Response, next) => {
    try {
      const { orgId } = orgContext(req);
      const [org, itemRequests, volunteerRequests] = await Promise.all([
        dal.organizations.getById(SYSTEM, orgId),
        dal.itemRequests.listByOrganization(SYSTEM, orgId),
        dal.volunteerRequests.listByOrganization(SYSTEM, orgId),
      ]);
      if (org === null) {
        sendNotFound(res);
        return;
      }
      res.json({
        org: { name: org.name, logoUrl: org.logoUrl },
        itemRequests: itemRequests.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, status: r.status })),
        volunteerRequests: volunteerRequests.map((r) => ({
          id: r.id,
          title: r.title,
          createdAt: r.createdAt,
          status: r.status,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- MP-05: organization settings — current values for the edit form.
  app.get("/api/dashboard/organization", requireOrganization, async (req: Request, res: Response, next) => {
    try {
      const { orgId, userId } = orgContext(req);
      const [org, selected, memberRows, allPopulations] = await Promise.all([
        dal.organizations.getById(SYSTEM, orgId),
        dal.populations.listByOrganization(SYSTEM, orgId),
        dal.memberships.listByOrganization(SYSTEM, orgId),
        dal.populations.listAll(SYSTEM),
      ]);
      if (org === null) {
        sendNotFound(res);
        return;
      }
      const contact = org.primaryContactPersonId
        ? await dal.people.getById(SYSTEM, org.primaryContactPersonId)
        : null;
      const selectedIds = new Set(selected.map((p) => p.id));
      res.json({
        org: {
          name: org.name,
          websiteUrl: org.websiteUrl,
          city: org.city,
          phone: org.phone,
          mission: org.mission,
          populationsOther: org.populationsOther,
          logoUrl: org.logoUrl,
        },
        populationIds: [...selectedIds],
        // Active rows plus anything this org already selected (a deactivated
        // population the org holds must not silently drop on the next save).
        populationOptions: allPopulations
          .filter((p) => p.isActive || selectedIds.has(p.id))
          .map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
        contact: contact
          ? { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone }
          : null,
        members: memberRows
          .filter((m) => m.status === "active")
          .map((m) => ({
            membershipId: m.id,
            firstName: m.firstName,
            lastName: m.lastName,
            email: m.email,
            isSelf: m.userId === userId,
          })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- MP-05: settings save. One transaction; never touches approval state.
  app.put("/api/dashboard/organization", requireOrganization, (req: Request, res: Response, next: NextFunction) => {
    logoUpload.single("logo")(req, res, (err: unknown) => {
      if (err) {
        console.error("[org-settings] logo upload rejected before parse:", err);
        res.status(400).json({ message: SAVE_FAILURE });
        return;
      }
      void handleOrganizationUpdate(req, res, next);
    });
  });

  async function handleOrganizationUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orgId } = orgContext(req);
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

      if (
        name === "" ||
        websiteUrl === "" ||
        city === "" ||
        phone === "" ||
        mission === "" ||
        populationIds.length < 1 ||
        firstName === "" ||
        lastName === "" ||
        !EMAIL_RE.test(email) ||
        contactPhone === ""
      ) {
        res.status(400).json({ message: SAVE_FAILURE });
        return;
      }

      // "Image will update on submit" (§8): a failed store fails the save
      // loudly — silently keeping the old logo would be a silent failure.
      let logoUrl: string | undefined;
      if (req.file) {
        try {
          const stored = await storeImage({ data: req.file.buffer, filename: req.file.originalname });
          logoUrl = stored.url;
        } catch (err) {
          console.error("[org-settings] logo storage failed — save rejected:", err);
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
      }

      try {
        await updateOrganizationSettings({
          orgId,
          name,
          websiteUrl,
          city,
          phone,
          mission,
          populationIds,
          populationsOther: populationsOtherRaw === "" ? null : populationsOtherRaw,
          ...(logoUrl !== undefined ? { logoUrl } : {}),
          contact: { firstName, lastName, email, phone: contactPhone },
        });
        res.json({ ok: true });
      } catch (err) {
        // Name or contact-email collision: §8 has one failure voice here.
        if (isUniqueViolation(err, "organizations_name_key") || isUniqueViolation(err, "people_email_key")) {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }

  // ---- MP-07: item request, step one. Draft + contact person in ONE
  // transaction; org_id comes from the session only — the read-only
  // Organization field is never trusted (§11). No approval_events row and no
  // email: a fresh draft has not transitioned from anything (§3); its first
  // event is written at MP-08 on submit.
  app.post("/api/dashboard/items", requireOrganization, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId } = orgContext(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const text = (key: string, max: number): string => {
        const v = body[key];
        return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
      };
      const contactFirstName = text("contactFirstName", 120);
      const contactLastName = text("contactLastName", 120);
      const contactEmail = text("contactEmail", 254).toLowerCase();
      const contactPhone = text("contactPhone", 40);
      const title = text("title", 200);
      const description = text("description", 4000);
      const deadlineTypeRaw = text("deadlineType", 20);
      const deadlineType = (DEADLINE_TYPES as readonly string[]).includes(deadlineTypeRaw)
        ? (deadlineTypeRaw as DeadlineType)
        : null;
      // §7: any non-date_specific type stores NULL — a submitted date is discarded.
      const deadlineDateRaw = text("deadlineDate", 10);
      const deadlineDate =
        deadlineType === "date_specific" && /^\d{4}-\d{2}-\d{2}$/.test(deadlineDateRaw) ? deadlineDateRaw : null;
      const peopleHelpedRaw = body.peopleHelped;
      const peopleHelped =
        typeof peopleHelpedRaw === "number" && Number.isInteger(peopleHelpedRaw) && peopleHelpedRaw >= 0
          ? peopleHelpedRaw
          : null;
      if (
        contactFirstName === "" ||
        contactLastName === "" ||
        !EMAIL_RE.test(contactEmail) ||
        contactPhone === "" ||
        title === "" ||
        description === "" ||
        deadlineType === null ||
        peopleHelped === null ||
        (deadlineType === "date_specific" && deadlineDate === null)
      ) {
        res.status(400).json({ message: ITEM_SAVE_FAILURE });
        return;
      }
      const request = await withDbContext(SYSTEM, async (c) => {
        // One human, one row (§12): resolve by lower(email), attach as
        // stored, never overwrite an existing person's fields. A resolved
        // person must already be visible to this org (§11 — see
        // people.isVisibleToOrgInTx); otherwise reject before attaching.
        const existingPerson = await dal.people.findByEmailInTx(c, contactEmail);
        if (existingPerson !== null && !(await dal.people.isVisibleToOrgInTx(c, existingPerson.id, orgId))) {
          throw new dal.people.ContactNotVisibleError();
        }
        const person =
          existingPerson ??
          (await dal.people.createInTx(c, {
            firstName: contactFirstName,
            lastName: contactLastName,
            email: contactEmail,
            phone: contactPhone,
            sourceNote: "item request contact (MP-07)",
          }));
        return dal.itemRequests.createDraftInTx(c, orgId, {
          title,
          description,
          peopleHelped,
          deadlineType,
          deadlineDate,
          contactPersonId: person.id,
          createdBy: userId,
        });
      });
      res.json({ id: request.id });
    } catch (err) {
      if (err instanceof dal.people.ContactNotVisibleError) {
        res.status(400).json({ message: ITEM_SAVE_FAILURE });
        return;
      }
      next(err);
    }
  });

  // ---- MP-10: create a volunteer request draft. Same shape as MP-07 —
  // one transaction for the contact person and the request together (§6),
  // no approval_events row, no email (§3). Volunteer deadline types are two
  // (§5): ongoing and date_specific; until_fulfilled is item-side only.
  app.post(
    "/api/dashboard/volunteers",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { orgId, userId } = orgContext(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const text = (key: string, max: number): string => {
          const v = body[key];
          return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
        };
        const contactFirstName = text("contactFirstName", 120);
        const contactLastName = text("contactLastName", 120);
        const contactEmail = text("contactEmail", 254).toLowerCase();
        const contactPhone = text("contactPhone", 40);
        const title = text("title", 200);
        const description = text("description", 4000);
        const details = text("details", 4000);
        const eventLocation = text("eventLocation", 300);
        const deadlineTypeRaw = text("deadlineType", 20);
        const deadlineType =
          deadlineTypeRaw === "ongoing" || deadlineTypeRaw === "date_specific"
            ? (deadlineTypeRaw as DeadlineType)
            : null;
        // §7: ongoing stores NULL — a submitted date is discarded.
        const deadlineDateRaw = text("deadlineDate", 10);
        const deadlineDate =
          deadlineType === "date_specific" && /^\d{4}-\d{2}-\d{2}$/.test(deadlineDateRaw) ? deadlineDateRaw : null;
        const peopleHelpedRaw = body.peopleHelped;
        const peopleHelped =
          typeof peopleHelpedRaw === "number" && Number.isInteger(peopleHelpedRaw) && peopleHelpedRaw >= 0
            ? peopleHelpedRaw
            : null;
        if (
          contactFirstName === "" ||
          contactLastName === "" ||
          !EMAIL_RE.test(contactEmail) ||
          contactPhone === "" ||
          title === "" ||
          description === "" ||
          details === "" ||
          eventLocation === "" ||
          deadlineType === null ||
          peopleHelped === null ||
          (deadlineType === "date_specific" && deadlineDate === null)
        ) {
          res.status(400).json({ message: ITEM_SAVE_FAILURE });
          return;
        }
        const request = await withDbContext(SYSTEM, async (c) => {
          // One human, one row (§12): resolve by lower(email), attach as
          // stored, never overwrite an existing person's fields. A resolved
          // person must already be visible to this org (§11 — see
          // people.isVisibleToOrgInTx); otherwise reject before attaching.
          const existingPerson = await dal.people.findByEmailInTx(c, contactEmail);
          if (existingPerson !== null && !(await dal.people.isVisibleToOrgInTx(c, existingPerson.id, orgId))) {
            throw new dal.people.ContactNotVisibleError();
          }
          const person =
            existingPerson ??
            (await dal.people.createInTx(c, {
              firstName: contactFirstName,
              lastName: contactLastName,
              email: contactEmail,
              phone: contactPhone,
              sourceNote: "volunteer request contact (MP-10)",
            }));
          return dal.volunteerRequests.createDraftInTx(c, orgId, {
            title,
            description,
            details,
            eventLocation,
            peopleHelped,
            deadlineType,
            deadlineDate,
            contactPersonId: person.id,
            createdBy: userId,
          });
        });
        res.json({ id: request.id });
      } catch (err) {
        if (err instanceof dal.people.ContactNotVisibleError) {
          res.status(400).json({ message: ITEM_SAVE_FAILURE });
          return;
        }
        next(err);
      }
    },
  );

  // ---- MP-11: add volunteer roles + submit. Parallel to MP-08 (§1). The
  // request's own org_id is checked against the session (§11); a foreign or
  // missing id answers byte-identically to an unknown route.
  const loadOwnedVolunteerRequest = async (req: Request, res: Response) => {
    const { orgId } = orgContext(req);
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return null;
    }
    const request = await dal.volunteerRequests.getById(SYSTEM, id);
    if (!request || request.orgId !== orgId) {
      sendNotFound(res);
      return null;
    }
    return request;
  };

  app.get(
    "/api/dashboard/volunteers/:id",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedVolunteerRequest(req, res);
        if (!request) return;
        const roles = await dal.volunteerRoles.listByRequest(SYSTEM, request.id);
        res.json({
          request: {
            id: request.id,
            title: request.title,
            description: request.description,
            details: request.details,
            eventLocation: request.eventLocation,
            imageUrl: request.imageUrl,
            deadlineType: request.deadlineType,
            deadlineDate: request.deadlineDate,
            status: request.status,
          },
          roles: roles.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            quantityNeeded: r.quantityNeeded,
            sortOrder: r.sortOrder,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/volunteers/:id/roles",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedVolunteerRequest(req, res);
        if (!request) return;
        // §11: non-draft loads read-only — adds are writes, so they are refused.
        if (request.status !== "draft") {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const text = (key: string, max: number): string => {
          const v = body[key];
          return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
        };
        const name = text("name", 200);
        const description = text("description", 2000);
        const qtyRaw = body.quantityNeeded;
        const quantityNeeded = typeof qtyRaw === "number" && Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : null;
        if (name === "" || description === "" || quantityNeeded === null) {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        const { orgId } = orgContext(req);
        // §5: sort_order is the next integer — the DAL assigns max+1 itself.
        const role = await dal.volunteerRoles.create(SYSTEM, orgId, request.id, {
          name,
          description,
          quantityNeeded,
        });
        res.json({
          role: {
            id: role.id,
            name: role.name,
            description: role.description,
            quantityNeeded: role.quantityNeeded,
            sortOrder: role.sortOrder,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/volunteers/:id/submit",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedVolunteerRequest(req, res);
        if (!request) return;
        const { userId, session } = orgContext(req);
        const actorEmail = session.user?.email ?? "";
        if (actorEmail === "") throw new Error("volunteer-submit: session carries no user email");
        try {
          const result = await submitVolunteerRequest({ request, actorUserId: userId, actorEmail });
          await dispatchQueuedEmails(result.dispatches);
          res.json({ ok: true });
        } catch (err) {
          // Zero roles, or a request no longer at draft (illegal transition):
          // the request is untouched — surface the form's failure voice.
          if (err instanceof NoRolesError || (err instanceof Error && /not a legal edge|already/.test(err.message))) {
            res.status(400).json({ message: ITEM_SAVE_FAILURE });
            return;
          }
          throw err;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- MP-12: edit a volunteer request. Three independently-submitted
  // forms (§1): request info with an optional status move, every role in
  // one transaction, and an inline add-role form. Adds here are NOT
  // draft-gated — this is the edit surface for any owned request (§6);
  // MP-11's add stays draft-only per its own §11.
  app.get(
    "/api/dashboard/volunteers/:id/edit",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedVolunteerRequest(req, res);
        if (!request) return;
        const [contact, roles] = await Promise.all([
          request.contactPersonId ? dal.people.getById(SYSTEM, request.contactPersonId) : Promise.resolve(null),
          dal.volunteerRoles.listByRequest(SYSTEM, request.id),
        ]);
        res.json({
          request: {
            id: request.id,
            title: request.title,
            description: request.description,
            details: request.details,
            eventLocation: request.eventLocation,
            peopleHelped: request.peopleHelped,
            deadlineType: request.deadlineType,
            deadlineDate: request.deadlineDate,
            status: request.status,
          },
          contact: contact
            ? { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone }
            : null,
          roles: roles.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            quantityNeeded: r.quantityNeeded,
            quantityInterested: r.quantityInterested,
            quantityConfirmed: r.quantityConfirmed,
            sortOrder: r.sortOrder,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/volunteers/:id/edit/request",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedVolunteerRequest(req, res);
        if (!request) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const text = (key: string, max: number): string => {
          const v = body[key];
          return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
        };
        const contactFirstName = text("contactFirstName", 100);
        const contactLastName = text("contactLastName", 100);
        const contactEmail = text("contactEmail", 320);
        const contactPhone = text("contactPhone", 40);
        const title = text("title", 200);
        const description = text("description", 5000);
        const details = text("details", 2000);
        const eventLocation = text("eventLocation", 2000);
        // Volunteer requests offer two deadline types (MP-10 §5) — never
        // until_fulfilled, which is the item side's third option.
        const deadlineType =
          body.deadlineType === "ongoing" || body.deadlineType === "date_specific" ? body.deadlineType : null;
        const dateRaw = typeof body.deadlineDate === "string" ? body.deadlineDate.trim() : "";
        const deadlineDate = deadlineType === "date_specific" && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
        const phRaw = body.peopleHelped;
        const peopleHelped =
          phRaw === null || phRaw === undefined
            ? null
            : typeof phRaw === "number" && Number.isInteger(phRaw) && phRaw >= 0
              ? phRaw
              : NaN;
        const statusTo = body.statusTo === "pending" || body.statusTo === "archived" ? body.statusTo : null;
        if (
          contactFirstName === "" ||
          contactLastName === "" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) ||
          contactPhone === "" ||
          title === "" ||
          description === "" ||
          details === "" ||
          eventLocation === "" ||
          deadlineType === null ||
          (deadlineType === "date_specific" && deadlineDate === null) ||
          Number.isNaN(peopleHelped) ||
          (body.statusTo !== null && body.statusTo !== undefined && statusTo === null)
        ) {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        const { orgId, userId, session } = orgContext(req);
        const actorEmail = session.user?.email ?? "";
        if (actorEmail === "") throw new Error("volunteer-edit: session carries no user email");
        try {
          const result = await saveVolunteerRequestEdits({
            request,
            orgId,
            userId,
            actorEmail,
            statusTo,
            fields: {
              title,
              description,
              details,
              eventLocation,
              peopleHelped: peopleHelped as number | null,
              deadlineType,
              deadlineDate,
              contactFirstName,
              contactLastName,
              contactEmail,
              contactPhone,
            },
          });
          await dispatchQueuedEmails(result.dispatches);
          const u = result.request;
          res.json({
            request: {
              id: u.id,
              title: u.title,
              description: u.description,
              details: u.details,
              eventLocation: u.eventLocation,
              peopleHelped: u.peopleHelped,
              deadlineType: u.deadlineType,
              deadlineDate: u.deadlineDate,
              status: u.status,
            },
          });
        } catch (err) {
          if (
            err instanceof NoRolesError ||
            err instanceof IllegalStatusMoveError ||
            err instanceof dal.people.ContactNotVisibleError ||
            (err instanceof Error && /not a legal edge|already/.test(err.message))
          ) {
            res.status(400).json({ message: SAVE_FAILURE });
            return;
          }
          throw err;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/volunteers/:id/edit/roles",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedVolunteerRequest(req, res);
        if (!request) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const list = Array.isArray(body.roles) ? (body.roles as Record<string, unknown>[]) : null;
        if (!list || list.length === 0 || list.length > 200) {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        type RoleEdit = {
          id: string;
          name: string;
          description: string;
          quantityNeeded: number;
          quantityConfirmed: number;
        };
        const edits: RoleEdit[] = [];
        for (const raw of list) {
          const id = typeof raw.id === "string" ? raw.id : "";
          const name = typeof raw.name === "string" && raw.name.trim().length <= 200 ? raw.name.trim() : "";
          const description =
            typeof raw.description === "string" && raw.description.trim().length <= 2000
              ? raw.description.trim()
              : typeof raw.description === "string"
                ? null
                : "";
          const qn = raw.quantityNeeded;
          const qc = raw.quantityConfirmed;
          const quantityNeeded = typeof qn === "number" && Number.isInteger(qn) && qn > 0 ? qn : null;
          const quantityConfirmed = typeof qc === "number" && Number.isInteger(qc) && qc >= 0 ? qc : null;
          // A malformed role id is an identifier failure, not a validation
          // failure — byte-identical 404, same as a foreign or missing id
          // (§11 binding rule).
          if (!UUID_RE.test(id)) {
            sendNotFound(res);
            return;
          }
          // §14: a tampered quantityInterested in the payload is never read.
          if (name === "" || description === null || quantityNeeded === null || quantityConfirmed === null) {
            res.status(400).json({ message: SAVE_FAILURE });
            return;
          }
          edits.push({ id, name, description, quantityNeeded, quantityConfirmed });
        }
        const { orgId } = orgContext(req);
        try {
          // §6: all role changes succeed together or none do.
          const updated = await withDbContext(SYSTEM, async (c) => {
            const out = [];
            for (const e of edits) {
              const cur = await c.query(
                `select name, quantity_interested from volunteer_roles where id = $1 and volunteer_request_id = $2 for update`,
                [e.id, request.id],
              );
              const row = cur.rows[0] as { name: string; quantity_interested: number } | undefined;
              if (!row) throw new Error(`volunteer-edit: role ${e.id} not on request ${request.id}`);
              if (e.quantityNeeded < row.quantity_interested) {
                throw new RoleOverInterestError(row.name, row.quantity_interested);
              }
              out.push(
                await dal.volunteerRoles.updateInTx(c, orgId, e.id, {
                  name: e.name,
                  description: e.description === "" ? null : e.description,
                  quantityNeeded: e.quantityNeeded,
                  quantityConfirmed: e.quantityConfirmed,
                }),
              );
            }
            return out;
          });
          updated.sort((a, b) => a.sortOrder - b.sortOrder);
          res.json({
            roles: updated.map((r) => ({
              id: r.id,
              name: r.name,
              description: r.description,
              quantityNeeded: r.quantityNeeded,
              quantityInterested: r.quantityInterested,
              quantityConfirmed: r.quantityConfirmed,
              sortOrder: r.sortOrder,
            })),
          });
        } catch (err) {
          if (err instanceof RoleOverInterestError) {
            res.status(400).json({ message: err.message });
            return;
          }
          // Missing/foreign role ids — including a role hanging off another
          // org's request — are identifier failures: byte-identical 404, not
          // a 400 (§11 binding rule).
          if (err instanceof Error && /not on request|not found in organization/.test(err.message)) {
            sendNotFound(res);
            return;
          }
          throw err;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/volunteers/:id/edit/add-role",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedVolunteerRequest(req, res);
        if (!request) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const text = (key: string, max: number): string => {
          const v = body[key];
          return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
        };
        const name = text("name", 200);
        const description = text("description", 2000);
        const qtyRaw = body.quantityNeeded;
        const quantityNeeded = typeof qtyRaw === "number" && Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : null;
        if (name === "" || description === "" || quantityNeeded === null) {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        const { orgId } = orgContext(req);
        const role = await dal.volunteerRoles.create(SYSTEM, orgId, request.id, {
          name,
          description,
          quantityNeeded,
        });
        res.json({
          role: {
            id: role.id,
            name: role.name,
            description: role.description,
            quantityNeeded: role.quantityNeeded,
            quantityInterested: role.quantityInterested,
            quantityConfirmed: role.quantityConfirmed,
            sortOrder: role.sortOrder,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- MP-13: view donors and volunteers. Read-only — the only member
  // surface that shows another person's contact info, so every query is
  // org-scoped server-side (§11). Two endpoints so each table loads and
  // fails independently: a failed query must render a stated error, never
  // an empty table (§12).
  app.get(
    "/api/dashboard/supporters/donors",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { orgId } = orgContext(req);
        const [org, pledges] = await Promise.all([
          dal.organizations.getById(SYSTEM, orgId),
          dal.pledges.listByOrganization(SYSTEM, orgId),
        ]);
        if (!org) throw new Error(`supporters: organization ${orgId} missing`);
        res.json({
          orgName: org.name,
          donors: pledges.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            email: p.email,
            phone: p.phone,
            requestTitle: p.requestTitle,
            lines: p.lines.map((l) => ({ itemName: l.itemName, quantity: l.quantity })),
            createdAt: p.createdAt,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  app.get(
    "/api/dashboard/supporters/volunteers",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { orgId } = orgContext(req);
        const [org, signups] = await Promise.all([
          dal.organizations.getById(SYSTEM, orgId),
          dal.signups.listByOrganization(SYSTEM, orgId),
        ]);
        if (!org) throw new Error(`supporters: organization ${orgId} missing`);
        res.json({
          orgName: org.name,
          volunteers: signups.map((s) => ({
            id: s.id,
            firstName: s.firstName,
            lastName: s.lastName,
            email: s.email,
            phone: s.phone,
            notes: s.notes,
            requestTitle: s.requestTitle,
            roles: s.roles.map((r) => ({ roleName: r.roleName })),
            createdAt: s.createdAt,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- MP-08: add items + submit. :id identifies the request; the
  // request's own org_id is checked against the session (§11). A foreign or
  // missing id answers byte-identically to an unknown route.
  const loadOwnedRequest = async (req: Request, res: Response) => {
    const { orgId } = orgContext(req);
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return null;
    }
    const request = await dal.itemRequests.getById(SYSTEM, id);
    if (!request || request.orgId !== orgId) {
      sendNotFound(res);
      return null;
    }
    return request;
  };

  app.get("/api/dashboard/items/:id", requireOrganization, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const request = await loadOwnedRequest(req, res);
      if (!request) return;
      const requestItems = await dal.items.listByRequest(SYSTEM, request.id);
      res.json({
        request: {
          id: request.id,
          title: request.title,
          description: request.description,
          imageUrl: request.imageUrl,
          deadlineType: request.deadlineType,
          deadlineDate: request.deadlineDate,
          status: request.status,
        },
        items: requestItems.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          productUrl: i.productUrl,
          quantityRequested: i.quantityRequested,
          quantityClaimed: i.quantityClaimed,
          condition: i.condition,
          sortOrder: i.sortOrder,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    "/api/dashboard/items/:id/items",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedRequest(req, res);
        if (!request) return;
        // §11: non-draft loads read-only — adds are writes, so they are refused.
        if (request.status !== "draft") {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const text = (key: string, max: number): string => {
          const v = body[key];
          return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
        };
        const name = text("name", 200);
        const description = text("description", 2000);
        const productUrl = parseProductUrl(body.productUrl);
        const conditionRaw = text("condition", 20);
        const condition = ITEM_CONDITIONS.includes(conditionRaw as ItemCondition)
          ? (conditionRaw as ItemCondition)
          : null;
        const qtyRaw = body.quantityRequested;
        const quantityRequested =
          typeof qtyRaw === "number" && Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : null;
        if (
          name === "" ||
          description === "" ||
          condition === null ||
          quantityRequested === null ||
          !productUrl.ok
        ) {
          res.status(400).json({ message: productUrl.ok ? SAVE_FAILURE : productUrl.message });
          return;
        }
        const { orgId } = orgContext(req);
        const item = await dal.items.create(SYSTEM, orgId, request.id, {
          name,
          description,
          condition,
          productUrl: productUrl.value,
          quantityRequested,
        });
        res.json({
          item: {
            id: item.id,
            name: item.name,
            description: item.description,
            productUrl: item.productUrl,
            quantityRequested: item.quantityRequested,
            quantityClaimed: item.quantityClaimed,
            condition: item.condition,
            sortOrder: item.sortOrder,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/items/:id/submit",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedRequest(req, res);
        if (!request) return;
        const { userId, session } = orgContext(req);
        const actorEmail = session.user?.email ?? "";
        if (actorEmail === "") throw new Error("item-submit: session carries no user email");
        try {
          const result = await submitItemRequest({ request, actorUserId: userId, actorEmail });
          // Auto-source a listing image in the background when no photo was
          // provided — the submission never waits on or fails because of it.
          sourceNeedImageInBackground(request);
          await dispatchQueuedEmails(result.dispatches);
          res.json({ ok: true });
        } catch (err) {
          // Zero items, or a request no longer at draft (illegal transition):
          // the request is untouched — surface the form's failure voice.
          if (err instanceof NoItemsError || (err instanceof Error && /not a legal edge|already/.test(err.message))) {
            res.status(400).json({ message: ITEM_SAVE_FAILURE });
            return;
          }
          throw err;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- MP-09: edit an item request. Three independently-submitted forms
  // (§1): request info (one tx via saveRequestEdits, optional status move
  // per D2), bulk item edits (one tx, all-or-nothing), and an inline add
  // (single insert, no status gate — this surface edits any owned request).
  app.get(
    "/api/dashboard/items/:id/edit",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedRequest(req, res);
        if (!request) return;
        const [contact, requestItems] = await Promise.all([
          request.contactPersonId ? dal.people.getById(SYSTEM, request.contactPersonId) : Promise.resolve(null),
          dal.items.listByRequest(SYSTEM, request.id),
        ]);
        res.json({
          request: {
            id: request.id,
            title: request.title,
            description: request.description,
            dropoffLocation: request.dropoffLocation,
            peopleHelped: request.peopleHelped,
            deadlineType: request.deadlineType,
            deadlineDate: request.deadlineDate,
            status: request.status,
            imageUrl: request.imageUrl,
          },
          contact: contact
            ? { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone }
            : null,
          items: requestItems.map((i) => ({
            id: i.id,
            name: i.name,
            description: i.description,
            productUrl: i.productUrl,
            condition: i.condition,
            quantityRequested: i.quantityRequested,
            quantityClaimed: i.quantityClaimed,
            quantityReceived: i.quantityReceived,
            sortOrder: i.sortOrder,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/items/:id/edit/request",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedRequest(req, res);
        if (!request) return;
        const { orgId, userId, session } = orgContext(req);
        const actorEmail = session.user?.email ?? "";
        if (actorEmail === "") throw new Error("item-request-edit: session carries no user email");
        const body = (req.body ?? {}) as Record<string, unknown>;
        const text = (key: string, max: number): string => {
          const v = body[key];
          return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
        };
        const contactFirstName = text("contactFirstName", 120);
        const contactLastName = text("contactLastName", 120);
        const contactEmail = text("contactEmail", 254).toLowerCase();
        const contactPhone = text("contactPhone", 40);
        const title = text("title", 200);
        const description = text("description", 4000);
        const dropoffLocationRaw = text("dropoffLocation", 300);
        const deadlineTypeRaw = text("deadlineType", 20);
        const deadlineType = (DEADLINE_TYPES as readonly string[]).includes(deadlineTypeRaw)
          ? (deadlineTypeRaw as DeadlineType)
          : null;
        // §7 (MP-07 rule carried over): non-date_specific stores NULL.
        const deadlineDateRaw = text("deadlineDate", 10);
        const deadlineDate =
          deadlineType === "date_specific" && /^\d{4}-\d{2}-\d{2}$/.test(deadlineDateRaw) ? deadlineDateRaw : null;
        // §5: optional here, unlike MP-07 — empty means null.
        const peopleHelpedRaw = body.peopleHelped;
        const peopleHelped =
          peopleHelpedRaw === null || peopleHelpedRaw === undefined || peopleHelpedRaw === ""
            ? null
            : typeof peopleHelpedRaw === "number" && Number.isInteger(peopleHelpedRaw) && peopleHelpedRaw >= 0
              ? peopleHelpedRaw
              : undefined;
        const statusToRaw = body.statusTo;
        const statusTo =
          statusToRaw === null || statusToRaw === undefined || statusToRaw === ""
            ? null
            : statusToRaw === "pending" || statusToRaw === "archived"
              ? statusToRaw
              : undefined;
        if (
          contactFirstName === "" ||
          contactLastName === "" ||
          !EMAIL_RE.test(contactEmail) ||
          contactPhone === "" ||
          title === "" ||
          description === "" ||
          deadlineType === null ||
          peopleHelped === undefined ||
          statusTo === undefined ||
          (deadlineType === "date_specific" && deadlineDate === null)
        ) {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        try {
          const result = await saveRequestEdits({
            request,
            orgId,
            userId,
            actorEmail,
            statusTo,
            fields: {
              title,
              description,
              dropoffLocation: dropoffLocationRaw === "" ? null : dropoffLocationRaw,
              peopleHelped,
              deadlineType,
              deadlineDate,
              contactFirstName,
              contactLastName,
              contactEmail,
              contactPhone,
            },
          });
          await dispatchQueuedEmails(result.dispatches);
          res.json({
            request: {
              id: result.request.id,
              title: result.request.title,
              description: result.request.description,
              dropoffLocation: result.request.dropoffLocation,
              peopleHelped: result.request.peopleHelped,
              deadlineType: result.request.deadlineType,
              deadlineDate: result.request.deadlineDate,
              status: result.request.status,
              imageUrl: result.request.imageUrl,
            },
          });
        } catch (err) {
          if (
            err instanceof NoItemsError ||
            err instanceof IllegalStatusMoveError ||
            err instanceof dal.people.ContactNotVisibleError ||
            (err instanceof Error && /not a legal edge|already/.test(err.message))
          ) {
            res.status(400).json({ message: SAVE_FAILURE });
            return;
          }
          throw err;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/items/:id/edit/items",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedRequest(req, res);
        if (!request) return;
        const { orgId } = orgContext(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const rowsRaw = Array.isArray(body.items) ? (body.items as unknown[]) : null;
        if (rowsRaw === null || rowsRaw.length === 0) {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        type EditRow = {
          id: string;
          name: string;
          description: string | null;
          productUrl: string | null;
          condition: ItemCondition | null;
          quantityRequested: number;
          quantityReceived: number;
        };
        const rows: EditRow[] = [];
        for (const raw of rowsRaw) {
          const r = (raw ?? {}) as Record<string, unknown>;
          const rowText = (key: string, max: number): string => {
            const v = r[key];
            return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
          };
          const rowId = rowText("id", 40);
          const name = rowText("name", 200);
          const desc = rowText("description", 2000);
          const productUrl = parseProductUrl(r.productUrl);
          const conditionRaw = rowText("condition", 20);
          const qReq = r.quantityRequested;
          const qRec = r.quantityReceived;
          const quantityRequested =
            typeof qReq === "number" && Number.isInteger(qReq) && qReq > 0 ? qReq : null;
          const quantityReceived =
            typeof qRec === "number" && Number.isInteger(qRec) && qRec >= 0 ? qRec : null;
          const condition =
            conditionRaw === ""
              ? null
              : ITEM_CONDITIONS.includes(conditionRaw as ItemCondition)
                ? (conditionRaw as ItemCondition)
                : undefined;
          // A malformed item id is an identifier failure, not a validation
          // failure — byte-identical 404, same as a foreign or missing id
          // (§11 binding rule).
          if (!UUID_RE.test(rowId)) {
            sendNotFound(res);
            return;
          }
          if (!productUrl.ok) {
            res.status(400).json({ message: productUrl.message });
            return;
          }
          if (
            name === "" ||
            quantityRequested === null ||
            quantityReceived === null ||
            condition === undefined
          ) {
            res.status(400).json({ message: SAVE_FAILURE });
            return;
          }
          rows.push({
            id: rowId,
            name,
            description: desc === "" ? null : desc,
            productUrl: productUrl.value,
            condition,
            quantityRequested,
            quantityReceived,
          });
        }
        // One transaction: every row saves or none does (§6). quantity_claimed
        // is never read from the payload — it has no column in the patch type.
        const outcome = await withDbContext(SYSTEM, async (c) => {
          const current = await q<{ id: string; name: string; quantity_claimed: number }>(
            c,
            `select id, name, quantity_claimed from items where item_request_id = $1 for update`,
            [request.id],
          );
          const byId = new Map(current.map((row) => [row.id, row]));
          for (const row of rows) {
            const existing = byId.get(row.id);
            if (!existing) return { kind: "unknown-item" as const };
            if (row.quantityRequested < existing.quantity_claimed) {
              return { kind: "over-claim" as const, name: existing.name, claimed: existing.quantity_claimed };
            }
          }
          const saved = [];
          for (const row of rows) {
            saved.push(
              await dal.items.updateInTx(c, orgId, row.id, {
                name: row.name,
                description: row.description,
                productUrl: row.productUrl,
                condition: row.condition,
                quantityRequested: row.quantityRequested,
                quantityReceived: row.quantityReceived,
              }),
            );
          }
          return { kind: "saved" as const, saved };
        });
        if (outcome.kind === "unknown-item") {
          // Missing/foreign item ids are identifier failures: byte-identical
          // 404, not a 400 (§11 binding rule).
          sendNotFound(res);
          return;
        }
        if (outcome.kind === "over-claim") {
          res.status(400).json({
            message: `"${outcome.name}" has ${outcome.claimed} claimed — # Requested can't go below ${outcome.claimed}.`,
          });
          return;
        }
        res.json({
          items: outcome.saved.map((i) => ({
            id: i.id,
            name: i.name,
            description: i.description,
            productUrl: i.productUrl,
            condition: i.condition,
            quantityRequested: i.quantityRequested,
            quantityClaimed: i.quantityClaimed,
            quantityReceived: i.quantityReceived,
            sortOrder: i.sortOrder,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/api/dashboard/items/:id/edit/add-item",
    requireOrganization,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const request = await loadOwnedRequest(req, res);
        if (!request) return;
        const { orgId } = orgContext(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const text = (key: string, max: number): string => {
          const v = body[key];
          return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
        };
        const name = text("name", 200);
        const description = text("description", 2000);
        const productUrl = parseProductUrl(body.productUrl);
        const conditionRaw = text("condition", 20);
        const condition = ITEM_CONDITIONS.includes(conditionRaw as ItemCondition)
          ? (conditionRaw as ItemCondition)
          : null;
        const qtyRaw = body.quantityRequested;
        const quantityRequested =
          typeof qtyRaw === "number" && Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : null;
        if (
          name === "" ||
          description === "" ||
          condition === null ||
          quantityRequested === null ||
          !productUrl.ok
        ) {
          res.status(400).json({ message: productUrl.ok ? SAVE_FAILURE : productUrl.message });
          return;
        }
        const item = await dal.items.create(SYSTEM, orgId, request.id, {
          name,
          description,
          condition,
          productUrl: productUrl.value,
          quantityRequested,
        });
        res.json({
          item: {
            id: item.id,
            name: item.name,
            description: item.description,
            productUrl: item.productUrl,
            condition: item.condition,
            quantityRequested: item.quantityRequested,
            quantityClaimed: item.quantityClaimed,
            quantityReceived: item.quantityReceived,
            sortOrder: item.sortOrder,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- MP-06: invite a teammate. The membership's organization comes from
  // the session only — any organization field in the body is ignored (§5,
  // §11). Person/user/membership/email rows land in ONE transaction.
  app.post("/api/dashboard/members", requireOrganization, async (req: Request, res: Response, next) => {
    try {
      const { orgId, userId, session } = orgContext(req);
      const actorEmail = session.user?.email ?? "";
      if (actorEmail === "") throw new Error("member-invite: session carries no user email");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const text = (key: string, max: number): string => {
        const v = body[key];
        return typeof v === "string" && v.trim().length <= max ? v.trim() : "";
      };
      const firstName = text("firstName", 120);
      const lastName = text("lastName", 120);
      const email = text("email", 254).toLowerCase();
      const phone = text("phone", 40);
      if (firstName === "" || lastName === "" || !EMAIL_RE.test(email) || phone === "") {
        res.status(400).json({ message: SAVE_FAILURE });
        return;
      }
      try {
        const result = await submitMemberInvite({
          orgId,
          actorUserId: userId,
          actorEmail,
          firstName,
          lastName,
          email,
          phone,
        });
        // Post-commit: send failures are logged on the email_log row and
        // surfaced at ADMIN-06 — the invitation stands either way (§12).
        await dispatchQueuedEmails(result.dispatches);
        res.json({ ok: true });
      } catch (err) {
        if (
          err instanceof DuplicateMembershipError ||
          isUniqueViolation(err, "org_memberships_org_id_user_id_key")
        ) {
          res.status(409).json({ message: "This person is already a member of your organization." });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  // ---- MP-05: remove a team member. Single status update via the owning
  // DAL function (writes the approval_events row in the same transaction).
  app.post(
    "/api/dashboard/organization/remove-member",
    requireOrganization,
    async (req: Request, res: Response, next) => {
      try {
        const { orgId, userId } = orgContext(req);
        const membershipId: unknown = (req.body as Record<string, unknown> | undefined)?.membershipId;
        if (typeof membershipId !== "string" || !UUID_RE.test(membershipId)) {
          sendNotFound(res);
          return;
        }
        const membership = await dal.memberships.getById(SYSTEM, membershipId);
        if (membership === null || membership.orgId !== orgId) {
          // Foreign or nonexistent: indistinguishable (byte-identical 404).
          sendNotFound(res);
          return;
        }
        if (membership.status === "removed") {
          // Already removed by someone else: the intent is satisfied (§12).
          res.json({ ok: true, removed: false });
          return;
        }
        if (membership.status !== "active") {
          res.status(400).json({ message: SAVE_FAILURE });
          return;
        }
        if (membership.userId === userId) {
          res.status(400).json({ message: "You can't remove yourself from your organization." });
          return;
        }
        const activeCount = await dal.memberships.countActiveForOrganization(SYSTEM, orgId);
        if (activeCount <= 1) {
          res.status(400).json({
            message: "This is your organization's only active member, so they can't be removed.",
          });
          return;
        }
        try {
          await dal.memberships.removeByStatus(SYSTEM, membershipId, userId, "Removed via MP-05 team management");
        } catch (err) {
          // Lost the race to another remover: same no-op success as above.
          if (err instanceof Error && err.message.includes("already removed")) {
            res.json({ ok: true, removed: false });
            return;
          }
          throw err;
        }
        res.json({ ok: true, removed: true });
      } catch (err) {
        next(err);
      }
    },
  );
}
