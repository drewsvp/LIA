/**
 * Staff admin API (ADMIN-01 + the shared shell's nav counts).
 *
 * Every route sits behind requireStaff: non-staff get the byte-identical 404
 * an unknown /api route returns (spec §4 — admin does not exist for them).
 * Identifier failures (malformed or unknown ids) use sendNotFound for the
 * same byte-identical body.
 *
 * Approve dispatches the welcome email AFTER the transaction commits and
 * reports the real outcome: the spec's result copy only when the send went
 * out, an explicit failure sentence otherwise (§13 — an operator who cannot
 * tell whether an email went out will send it again by hand).
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { requireStaff, requireStaffAdmin, staffContext, sendNotFound } from "../auth/guards";
import {
  mergePeople as mergePeopleService,
  MergeBothHaveUsersError,
  MergePersonNotFoundError,
} from "../services/person-merge";
import {
  resendEmail,
  AlreadyDeliveredError,
  EmailRowNotFoundError,
  ResendBlockedError,
  RESENDABLE_TEMPLATE_KEYS,
} from "../services/email-resend";
import { MAY_HAVE_SENT_MARKER } from "../email/send";
import { ENTITY_TYPE_NAMES } from "../../shared/transitions";
import { parseProductUrl } from "../../shared/item-product-url";

/** ADMIN-05 §5: lowercase, hyphenated. Shared by add (validation) and promote (generation). */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Deterministic slug from a name — mirror of the client-side generator. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
import * as dal from "../dal";
import { withDbContext, type DbContext } from "../db/client";
import type { DeadlineType, MembershipRole } from "../../shared/types";
import { dispatchQueuedEmails, type PendingDispatch } from "../email/send";
import { storeImage, deleteImage } from "../storage/object-storage";
import { sourceNeedImage, NeedImageError } from "../services/need-image";
import {
  approveOrganization,
  disableOrganization,
  AlreadyApprovedError,
  AlreadyDisabledError,
  NoOwnerMembershipError,
  OrgNotFoundError,
} from "../services/org-approval";
import {
  approveRequest,
  archiveRequest,
  returnRequestToDraft,
  reinstateRequest,
  AlreadyActiveError,
  IllegalStateError,
  NoChildrenError,
  OrgNotApprovedError,
  RequestNotFoundError,
  type RequestKind,
  type AdminRequest,
} from "../services/request-approval";
import {
  moveReturnedRequestToPending,
  saveStaffRequestEdits,
  saveStaffRequestImage,
  StaffRequestEditConflictError,
  type StaffRequestEditInput,
} from "../services/staff-request-edit";
import {
  approveMembership,
  rejectMembership,
  reinstateMembership,
  MembershipNotFoundError,
  MembershipAlreadyActiveError,
  MembershipAlreadyRemovedError,
  MembershipAlreadyPendingError,
  MembershipStateError,
  MemberOrgNotApprovedError,
} from "../services/member-approval";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORG_STATUSES = new Set(["pending", "approved", "disabled"]);
/** ADMIN-02 §4: ordinary lifecycle tabs plus the history-backed returned view. */
const REQUEST_STATUSES = new Set(["pending", "returned", "active", "archived"]);
/** ADMIN-01/ADMIN-02 §8 failure copy, verbatim. */
const SAVE_FAILURE = "That did not save. Nothing was changed.";

/** ADMIN-09: the full membership-role enum and its display names. */
const ROLE_VALUES: ReadonlySet<string> = new Set(["owner", "member", "staff_admin", "staff_approver"]);
const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "an owner",
  member: "a member",
  staff_admin: "a staff admin",
  staff_approver: "a staff approver",
};

/** ADMIN-02 §5: staff request image, same limits as the MP-05 logo. */
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

function parseKind(raw: string | undefined): RequestKind | null {
  return raw === "item" || raw === "volunteer" ? raw : null;
}

function staffCtx(req: Request): DbContext {
  return { kind: "staff", userId: staffContext(req).userId };
}

function parseStaffRequestEdit(
  kind: RequestKind,
  requestId: string,
  staffUserId: string,
  rawBody: unknown,
): StaffRequestEditInput | null {
  if (!rawBody || typeof rawBody !== "object") return null;
  const body = rawBody as Record<string, unknown>;
  const text = (key: string, max: number): string | null => {
    const value = body[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length <= max ? trimmed : null;
  };
  const title = text("title", 200);
  const description = text("description", 4000);
  const contactFirstName = text("contactFirstName", 120);
  const contactLastName = text("contactLastName", 120);
  const contactEmail = text("contactEmail", 254)?.toLowerCase() ?? null;
  const contactPhone = text("contactPhone", 40);
  const deadlineTypeRaw = text("deadlineType", 20);
  const deadlineDateRaw = text("deadlineDate", 10);
  const deadlineType: DeadlineType | null =
    deadlineTypeRaw === "date_specific" || deadlineTypeRaw === "until_fulfilled" || deadlineTypeRaw === "ongoing"
      ? deadlineTypeRaw
      : null;
  const deadlineDate =
    deadlineType === "date_specific" && deadlineDateRaw !== null && /^\d{4}-\d{2}-\d{2}$/.test(deadlineDateRaw)
      ? deadlineDateRaw
      : null;
  const peopleRaw = body.peopleHelped;
  const peopleHelped =
    peopleRaw === null || peopleRaw === ""
      ? null
      : typeof peopleRaw === "number" && Number.isInteger(peopleRaw) && peopleRaw >= 0
        ? peopleRaw
        : undefined;
  const childrenRaw = Array.isArray(body.children) && body.children.length <= 200 ? body.children : null;
  if (
    !title ||
    !description ||
    !contactFirstName ||
    !contactLastName ||
    !contactEmail ||
    !EMAIL_RE.test(contactEmail) ||
    !contactPhone ||
    !deadlineType ||
    peopleHelped === undefined ||
    (deadlineType === "date_specific" && deadlineDate === null) ||
    childrenRaw === null
  ) {
    return null;
  }

  const common = {
    title,
    description,
    peopleHelped,
    deadlineType,
    deadlineDate,
    contact: {
      firstName: contactFirstName,
      lastName: contactLastName,
      email: contactEmail,
      phone: contactPhone,
    },
  };

  if (kind === "item") {
    const dropoffRaw = body.dropoffLocation;
    const dropoffLocation =
      dropoffRaw === null || dropoffRaw === undefined
        ? null
        : typeof dropoffRaw === "string" && dropoffRaw.trim().length <= 300
          ? dropoffRaw.trim() || null
          : undefined;
    if (dropoffLocation === undefined) return null;
    const children: StaffRequestEditInput & { kind: "item" } extends { children: infer C } ? C : never = [];
    for (const raw of childrenRaw) {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const rowText = (key: string, max: number): string | null => {
        const value = row[key];
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed.length <= max ? trimmed : null;
      };
      const idRaw = row.id;
      const id = idRaw === null || idRaw === undefined || idRaw === "" ? undefined : idRaw;
      const name = rowText("name", 200);
      const childDescription = rowText("description", 2000);
      const condition = rowText("condition", 20);
      const productUrl = parseProductUrl(row.productUrl);
      const quantityRequested = row.quantityRequested;
      if (
        (id !== undefined && (typeof id !== "string" || !UUID_RE.test(id))) ||
        !name ||
        !childDescription ||
        (condition !== "new" && condition !== "gently_used" && condition !== "any") ||
        !productUrl.ok ||
        typeof quantityRequested !== "number" ||
        !Number.isInteger(quantityRequested) ||
        quantityRequested < 1
      ) {
        return null;
      }
      children.push({
        ...(id !== undefined ? { id } : {}),
        name,
        description: childDescription,
        condition,
        productUrl: productUrl.value,
        quantityRequested,
      });
    }
    return {
      kind,
      requestId,
      staffUserId,
      fields: { ...common, dropoffLocation },
      children,
    };
  }

  const details = text("details", 4000);
  const eventLocation = text("eventLocation", 300);
  if (!details || !eventLocation || (deadlineType !== "ongoing" && deadlineType !== "date_specific")) return null;
  const children: StaffRequestEditInput & { kind: "volunteer" } extends { children: infer C } ? C : never = [];
  for (const raw of childrenRaw) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const idRaw = row.id;
    const id = idRaw === null || idRaw === undefined || idRaw === "" ? undefined : idRaw;
    const name = typeof row.name === "string" && row.name.trim().length <= 200 ? row.name.trim() : "";
    const childDescription =
      typeof row.description === "string" && row.description.trim().length <= 2000 ? row.description.trim() : "";
    const quantityNeeded = row.quantityNeeded;
    if (
      (id !== undefined && (typeof id !== "string" || !UUID_RE.test(id))) ||
      !name ||
      !childDescription ||
      typeof quantityNeeded !== "number" ||
      !Number.isInteger(quantityNeeded) ||
      quantityNeeded < 1
    ) {
      return null;
    }
    children.push({
      ...(id !== undefined ? { id } : {}),
      name,
      description: childDescription,
      quantityNeeded,
    });
  }
  return {
    kind,
    requestId,
    staffUserId,
    fields: { ...common, details, eventLocation },
    children,
  };
}

export function registerAdminRoutes(app: Express): void {
  // ---- Shell nav counts (ADMIN-01 §4).
  app.get("/api/admin/nav-counts", requireStaff, async (req: Request, res: Response, next) => {
    try {
      res.json(await dal.adminCounts.navCounts(staffCtx(req)));
    } catch (err) {
      next(err);
    }
  });

  // ---- ADMIN-01 queue tabs.
  app.get("/api/admin/organizations", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "pending";
      if (!ORG_STATUSES.has(status)) {
        res.status(400).json({ message: "Unknown status filter." });
        return;
      }
      const organizations = await dal.organizations.listByStatusWithContact(
        staffCtx(req),
        status as "pending" | "approved" | "disabled",
      );
      res.json({ organizations });
    } catch (err) {
      next(err);
    }
  });

  // ---- ADMIN-01 detail: every MP-03 field plus contact and populations.
  app.get("/api/admin/organizations/:id", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const orgId = req.params.id ?? "";
      if (!UUID_RE.test(orgId)) {
        sendNotFound(res);
        return;
      }
      const ctx = staffCtx(req);
      const organization = await dal.organizations.getById(ctx, orgId);
      if (!organization || organization.kind !== "member_org") {
        sendNotFound(res);
        return;
      }
      const [contact, populations] = await Promise.all([
        organization.primaryContactPersonId
          ? dal.people.getById(ctx, organization.primaryContactPersonId)
          : Promise.resolve(null),
        dal.populations.listByOrganization(ctx, orgId),
      ]);
      res.json({
        organization,
        contact: contact
          ? { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone }
          : null,
        populations: populations.map((p) => ({ id: p.id, name: p.name })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- Approve (ADMIN-01 §7): the one-transaction bundle, then dispatch.
  app.post("/api/admin/organizations/:id/approve", requireStaff, async (req: Request, res: Response) => {
    const orgId = req.params.id ?? "";
    if (!UUID_RE.test(orgId)) {
      sendNotFound(res);
      return;
    }
    const userId = staffContext(req).userId;
    try {
      const result = await approveOrganization(userId, orgId);
      const name = result.organization.name;

      let message: string;
      switch (result.email.outcome) {
        case "queued": {
          const { toEmail, dispatch } = result.email;
          const [outcome] = await dispatchQueuedEmails([dispatch]);
          message =
            outcome && outcome.outcome === "sent"
              ? `${name} approved. Welcome email queued to ${toEmail}.`
              : `${name} approved. The welcome email failed to send — it is logged in the Email log and can be resent there.`;
          break;
        }
        case "already_sent":
          message = `${name} approved. The welcome email was already sent previously, so none was queued.`;
          break;
        case "blocked":
          message = `${name} approved. The welcome email failed to send — it is logged in the Email log and can be resent there.`;
          break;
        case "skipped_disabled":
          message = `${name} approved. The welcome email is disabled under Automated emails, so it was skipped (logged in the Email log).`;
          break;
        case "no_contact":
          message = `${name} approved. No primary contact is on file, so no welcome email was queued.`;
          break;
      }
      res.json({ organization: result.organization, message });
    } catch (err) {
      if (err instanceof OrgNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof AlreadyApprovedError) {
        // §13: another staff member approved it first — no-op success, fresh row.
        const organization = await dal.organizations.getById({ kind: "staff", userId }, orgId);
        res.json({
          organization,
          message: organization ? `${organization.name} was already approved. Nothing changed.` : "Already approved.",
          noop: true,
        });
        return;
      }
      if (err instanceof NoOwnerMembershipError) {
        // §13: data defect — blocked, logged, nothing written.
        console.error(`[admin] approval blocked, no owner membership: org ${orgId} (${err.orgName})`);
        res.status(409).json({
          message: `${err.orgName} has no owner membership, so approval is blocked. Nothing was changed.`,
        });
        return;
      }
      console.error(`[admin] approve failed for org ${orgId}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- Disable (ADMIN-01 §7): status + event; approved_at/approved_by survive (D44).
  app.post("/api/admin/organizations/:id/disable", requireStaff, async (req: Request, res: Response) => {
    const orgId = req.params.id ?? "";
    if (!UUID_RE.test(orgId)) {
      sendNotFound(res);
      return;
    }
    const userId = staffContext(req).userId;
    try {
      const organization = await disableOrganization(userId, orgId);
      res.json({ organization, message: `${organization.name} disabled.` });
    } catch (err) {
      if (err instanceof OrgNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof AlreadyDisabledError) {
        const organization = await dal.organizations.getById({ kind: "staff", userId }, orgId);
        res.json({
          organization,
          message: organization ? `${organization.name} was already disabled. Nothing changed.` : "Already disabled.",
          noop: true,
        });
        return;
      }
      console.error(`[admin] disable failed for org ${orgId}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // --------------------------------------------------------------------------
  // ADMIN-02 — request approval queue (docs/specs/ADMIN-02.md)
  // --------------------------------------------------------------------------

  // ---- §4: one queue, both types, per status tab.
  app.get("/api/admin/requests", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "pending";
      if (!REQUEST_STATUSES.has(status)) {
        res.status(400).json({ message: "Unknown status filter." });
        return;
      }
      const requests =
        status === "returned"
          ? await dal.adminRequests.listReturnedDrafts(staffCtx(req))
          : await dal.adminRequests.listByStatus(staffCtx(req), status as "pending" | "active" | "archived");
      res.json({ requests });
    } catch (err) {
      next(err);
    }
  });

  // ---- §4: detail — the request as the public will see it, plus children.
  app.get("/api/admin/requests/:type/:id", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const kind = parseKind(req.params.type);
      const id = req.params.id ?? "";
      if (!kind || !UUID_RE.test(id)) {
        sendNotFound(res);
        return;
      }
      const ctx = staffCtx(req);
      const request =
        kind === "item" ? await dal.itemRequests.getById(ctx, id) : await dal.volunteerRequests.getById(ctx, id);
      if (!request) {
        sendNotFound(res);
        return;
      }
      const organization = await dal.organizations.getById(ctx, request.orgId);
      if (!organization) {
        sendNotFound(res);
        return;
      }
      const [children, latestReturn, editability] = await Promise.all([
        kind === "item" ? dal.items.listByRequest(ctx, id) : dal.volunteerRoles.listByRequest(ctx, id),
        dal.adminRequests.latestReturn(ctx, kind, id),
        dal.adminRequests.preApprovalEditability(ctx, kind, id),
      ]);
      const orgContactPerson = organization.primaryContactPersonId
        ? await dal.people.getById(ctx, organization.primaryContactPersonId)
        : null;
      let creatorPerson = null;
      if (request.createdBy) {
        const creatorUser = await dal.users.getById(ctx, request.createdBy);
        creatorPerson = creatorUser ? await dal.people.getById(ctx, creatorUser.personId) : null;
      }
      const requestContactPerson = request.contactPersonId
        ? await dal.people.getById(ctx, request.contactPersonId)
        : null;
      res.json({
        type: kind,
        request,
        organization: {
          id: organization.id,
          name: organization.name,
          city: organization.city,
          status: organization.status,
        },
        orgContact: orgContactPerson
          ? { name: `${orgContactPerson.firstName} ${orgContactPerson.lastName}`.trim(), email: orgContactPerson.email }
          : null,
        creator: creatorPerson
          ? { name: `${creatorPerson.firstName} ${creatorPerson.lastName}`.trim(), email: creatorPerson.email }
          : null,
        requestContact: requestContactPerson
          ? {
              firstName: requestContactPerson.firstName,
              lastName: requestContactPerson.lastName,
              email: requestContactPerson.email,
              phone: requestContactPerson.phone,
            }
          : null,
        children,
        latestReturn,
        editability,
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- Complete pre-approval correction. Status is deliberately preserved;
  // return and recovery are explicit, separately recorded actions.
  app.post("/api/admin/requests/:type/:id/edit", requireStaff, async (req: Request, res: Response) => {
    const kind = parseKind(req.params.type);
    const id = req.params.id ?? "";
    if (!kind || !UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const parsed = parseStaffRequestEdit(kind, id, staffContext(req).userId, req.body);
    if (!parsed) {
      res.status(400).json({ message: "Check every field and child row, then try again. Nothing was changed." });
      return;
    }
    try {
      const result = await saveStaffRequestEdits(parsed);
      res.json({ request: result.request, message: "Request corrections saved. Its review status did not change." });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof StaffRequestEditConflictError) {
        res.status(409).json({ message: err.reason });
        return;
      }
      if (err instanceof dal.people.ContactNotVisibleError) {
        res.status(400).json({ message: "That contact cannot be attached to this organization. Nothing was changed." });
        return;
      }
      console.error(`[admin] staff edit failed for ${kind} request ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- Returned draft -> Pending. No approval stamp and no email.
  app.post("/api/admin/requests/:type/:id/move-to-pending", requireStaff, async (req: Request, res: Response) => {
    const kind = parseKind(req.params.type);
    const id = req.params.id ?? "";
    if (!kind || !UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    try {
      const request = await moveReturnedRequestToPending({
        kind,
        requestId: id,
        staffUserId: staffContext(req).userId,
      });
      res.json({ request, message: `${request.title} moved back to Pending. No email was sent.` });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof StaffRequestEditConflictError) {
        res.status(409).json({ message: err.reason });
        return;
      }
      console.error(`[admin] move-to-pending failed for ${kind} request ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Approve: one-tx bundle (status + stamps + one event + email rows),
  // dispatch after commit, result message never claims a send that failed.
  app.post("/api/admin/requests/:type/:id/approve", requireStaff, async (req: Request, res: Response) => {
    const kind = parseKind(req.params.type);
    const id = req.params.id ?? "";
    if (!kind || !UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const userId = staffContext(req).userId;
    try {
      const result = await approveRequest({ kind, requestId: id, staffUserId: userId });
      const title = result.request.title;

      let message: string;
      if (result.noRecipients) {
        message = `${title} is now public. No contact is on file, so no approval email was queued.`;
      } else {
        const queued: { toEmail: string; dispatch: PendingDispatch }[] = [];
        const failedEmails: string[] = [];
        const skippedEmails: string[] = [];
        for (const email of result.emails) {
          if (email.outcome === "queued") queued.push({ toEmail: email.toEmail, dispatch: email.dispatch });
          else if (email.outcome === "skipped_disabled") skippedEmails.push(email.toEmail);
          else failedEmails.push(email.toEmail);
        }
        const outcomes = await dispatchQueuedEmails(queued.map((entry) => entry.dispatch));
        const sentEmails: string[] = [];
        queued.forEach((entry, i) => {
          const outcome = outcomes[i];
          if (outcome && outcome.outcome === "sent") sentEmails.push(entry.toEmail);
          else failedEmails.push(entry.toEmail);
        });
        if (failedEmails.length === 0 && sentEmails.length === 0) {
          message = `${title} is now public.`;
        } else if (failedEmails.length === 0) {
          // §8 verbatim: two recipients vs. same person (or only one on file).
          message =
            sentEmails.length === 2
              ? `${title} is now public. Approval email queued to ${sentEmails[0]} and ${sentEmails[1]}.`
              : `${title} is now public. Approval email queued to ${sentEmails[0]}.`;
        } else if (sentEmails.length > 0) {
          message = `${title} is now public. Approval email queued to ${sentEmails.join(" and ")}. The email to ${failedEmails.join(" and ")} failed to send — it is logged in the Email log and can be resent there.`;
        } else {
          message = `${title} is now public. The approval email failed to send — it is logged in the Email log and can be resent there.`;
        }
        if (skippedEmails.length > 0) {
          message += ` The approval email is disabled under Automated emails, so the copy to ${skippedEmails.join(" and ")} was skipped (logged in the Email log).`;
        }
      }
      res.json({ request: result.request, message });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof AlreadyActiveError) {
        // §12: another staff member approved it first — no-op success.
        const ctx: DbContext = { kind: "staff", userId };
        const request =
          kind === "item" ? await dal.itemRequests.getById(ctx, id) : await dal.volunteerRequests.getById(ctx, id);
        res.json({
          request,
          message: request ? `${request.title} was already approved. Nothing changed.` : "Already approved.",
          noop: true,
        });
        return;
      }
      if (err instanceof OrgNotApprovedError) {
        // §8 verbatim.
        res.status(409).json({ message: `${err.orgName} is not approved yet, so this request cannot be published.` });
        return;
      }
      if (err instanceof NoChildrenError) {
        // §8 verbatim for items; the volunteer sentence mirrors it (unbound spec).
        res.status(409).json({
          message:
            kind === "item"
              ? "This request has no items and cannot be approved."
              : "This request has no roles and cannot be approved.",
        });
        return;
      }
      if (err instanceof IllegalStateError) {
        res.status(409).json({ message: `Only a pending request can be approved. This one is ${err.currentStatus}.` });
        return;
      }
      console.error(`[admin] approve failed for ${kind} request ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Return to draft: note is history/instruction only, NO AI/edit/email.
  app.post("/api/admin/requests/:type/:id/return-to-draft", requireStaff, async (req: Request, res: Response) => {
    const kind = parseKind(req.params.type);
    const id = req.params.id ?? "";
    if (!kind || !UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (note === "") {
      // §6: the note is the only channel telling the org what to fix.
       res.status(400).json({ message: "A note is required — it is saved as history but does not make changes or notify the organization." });
      return;
    }
    const userId = staffContext(req).userId;
    try {
      const request = await returnRequestToDraft({ kind, requestId: id, staffUserId: userId, note });
      // §8 verbatim.
      res.json({
        request,
        message: `${request.title} returned to draft. The note was saved as history only; no changes were made and no email was sent. Contact the organization directly.`,
      });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof AlreadyActiveError || err instanceof IllegalStateError) {
        const status = err instanceof IllegalStateError ? err.currentStatus : "active";
        res.status(409).json({ message: `Only a pending request can be returned to draft. This one is ${status}.` });
        return;
      }
      console.error(`[admin] return-to-draft failed for ${kind} request ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Archive: pending or active only, always reason 'manual', no email.
  app.post("/api/admin/requests/:type/:id/archive", requireStaff, async (req: Request, res: Response) => {
    const kind = parseKind(req.params.type);
    const id = req.params.id ?? "";
    if (!kind || !UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const userId = staffContext(req).userId;
    const ctx: DbContext = { kind: "staff", userId };
    try {
      // §6 enablement guard: the dal would also allow draft -> archived, which
      // this surface must not offer.
      const existing =
        kind === "item" ? await dal.itemRequests.getById(ctx, id) : await dal.volunteerRequests.getById(ctx, id);
      if (!existing) {
        sendNotFound(res);
        return;
      }
      if (existing.status !== "pending" && existing.status !== "active") {
        res
          .status(409)
          .json({ message: `Only a pending or active request can be archived. This one is ${existing.status}.` });
        return;
      }
      const request = await archiveRequest({ kind, requestId: id, staffUserId: userId });
      // §8 verbatim.
      res.json({ request, message: `${request.title} archived.` });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof IllegalStateError) {
        res
          .status(409)
          .json({ message: `Only a pending or active request can be archived. This one is ${err.currentStatus}.` });
        return;
      }
      console.error(`[admin] archive failed for ${kind} request ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Reinstate: archived -> active, no approval re-stamp, no email.
  app.post("/api/admin/requests/:type/:id/reinstate", requireStaff, async (req: Request, res: Response) => {
    const kind = parseKind(req.params.type);
    const id = req.params.id ?? "";
    if (!kind || !UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const userId = staffContext(req).userId;
    try {
      const request = await reinstateRequest({ kind, requestId: id, staffUserId: userId });
      // §8 verbatim.
      res.json({ request, message: `${request.title} is public again.` });
    } catch (err) {
      if (err instanceof RequestNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof AlreadyActiveError) {
        const ctx: DbContext = { kind: "staff", userId };
        const request =
          kind === "item" ? await dal.itemRequests.getById(ctx, id) : await dal.volunteerRequests.getById(ctx, id);
        res.json({
          request,
          message: request ? `${request.title} is public again.` : "Already public.",
          noop: true,
        });
        return;
      }
      if (err instanceof IllegalStateError) {
        res
          .status(409)
          .json({ message: `Only an archived request can be reinstated. This one is ${err.currentStatus}.` });
        return;
      }
      console.error(`[admin] reinstate failed for ${kind} request ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §5: the one editable thing here — the image. Writes image_url and
  // nothing else (D11); never the path that stamps approval.
  app.post("/api/admin/requests/:type/:id/image", requireStaff, (req: Request, res: Response) => {
    imageUpload.single("image")(req, res, (err: unknown) => {
      if (err) {
        console.error("[admin] request image upload rejected before parse:", err);
        res.status(400).json({ message: SAVE_FAILURE });
        return;
      }
      void handleRequestImageUpload(req, res);
    });
  });

  async function handleRequestImageUpload(req: Request, res: Response): Promise<void> {
    const kind = parseKind(req.params.type);
    const id = req.params.id ?? "";
    if (!kind || !UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const ctx = staffCtx(req);
    try {
      const request =
        kind === "item" ? await dal.itemRequests.getById(ctx, id) : await dal.volunteerRequests.getById(ctx, id);
      if (!request) {
        sendNotFound(res);
        return;
      }
      const editability = await dal.adminRequests.preApprovalEditability(ctx, kind, id);
      if (!editability.editable) {
        res.status(409).json({ message: editability.reason ?? "This request cannot be edited." });
        return;
      }
      if (!req.file) {
        res.status(400).json({ message: "Choose an image file first." });
        return;
      }
      const stored = await storeImage({ data: req.file.buffer, filename: req.file.originalname });
      let updated: AdminRequest;
      try {
        updated = await saveStaffRequestImage({
          kind,
          requestId: id,
          staffUserId: staffContext(req).userId,
          imageUrl: stored.url,
        });
      } catch (err) {
        await deleteImage(stored.url).catch(() => undefined);
        throw err;
      }
      res.json({ request: updated, message: "Image saved." });
    } catch (err) {
      if (err instanceof StaffRequestEditConflictError) {
        res.status(409).json({ message: err.reason });
        return;
      }
      console.error(`[admin] request image upload failed for ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  }

  // ---- Auto-sourced images (item requests only). Regenerate finds a stock
  // photo (or AI-generates one) on demand; it never replaces an uploaded
  // photo. Runs synchronously so staff see the result or the exact error.
  app.post("/api/admin/requests/item/:id/generate-image", requireStaff, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const ctx = staffCtx(req);
    try {
      const request = await dal.itemRequests.getById(ctx, id);
      if (!request) {
        sendNotFound(res);
        return;
      }
      const [editability, latestReturn] = await Promise.all([
        dal.adminRequests.preApprovalEditability(ctx, "item", id),
        request.status === "draft" ? dal.adminRequests.latestReturn(ctx, "item", id) : Promise.resolve(null),
      ]);
      if (!editability.editable || (request.status === "draft" && latestReturn === null)) {
        res.status(409).json({
          message:
            editability.reason ??
            "Only pending requests and drafts previously returned by staff can have their image changed.",
        });
        return;
      }
      if (request.imageUrl !== null && !request.imageGenerated) {
        res.status(409).json({ message: "This request has an uploaded photo. Remove or replace it instead." });
        return;
      }
      const result = await sourceNeedImage(id, { overwriteGenerated: true });
      res.json({
        request: result.request,
        message: result.source === "stock" ? "Stock photo found and saved." : "AI image generated and saved.",
      });
    } catch (err) {
      if (err instanceof NeedImageError) {
        res.status(502).json({ message: `Image could not be sourced: ${err.message}` });
        return;
      }
      console.error(`[admin] generate image failed for item request ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  app.post("/api/admin/requests/item/:id/remove-generated-image", requireStaff, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const ctx = staffCtx(req);
    try {
      const request = await dal.itemRequests.getById(ctx, id);
      if (!request) {
        sendNotFound(res);
        return;
      }
      if (!request.imageGenerated || request.imageUrl === null) {
        res.status(409).json({ message: "This request has no auto-sourced image to remove." });
        return;
      }
      const [editability, latestReturn] = await Promise.all([
        dal.adminRequests.preApprovalEditability(ctx, "item", id),
        request.status === "draft" ? dal.adminRequests.latestReturn(ctx, "item", id) : Promise.resolve(null),
      ]);
      if (!editability.editable || (request.status === "draft" && latestReturn === null)) {
        res.status(409).json({
          message:
            editability.reason ??
            "Only pending requests and drafts previously returned by staff can have their image changed.",
        });
        return;
      }
      const previousUrl = request.imageUrl;
      const updated = await dal.itemRequests.clearGeneratedImage(ctx, id);
      if (updated === null) {
        res.status(409).json({ message: "This request has no auto-sourced image to remove." });
        return;
      }
      await deleteImage(previousUrl).catch((err) => {
        console.error(`[admin] orphaned storage object ${previousUrl} after remove:`, err);
      });
      res.json({ request: updated, message: "Auto-sourced image removed." });
    } catch (err) {
      console.error(`[admin] remove generated image failed for item request ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // --------------------------------------------------------------------------
  // ADMIN-03 — member approval queue (docs/specs/ADMIN-03.md)
  // --------------------------------------------------------------------------

  // ---- §4: one row per membership, per status tab. Owner memberships and
  // platform_owner rows never appear (§7/§11 — enforced in the DAL predicate).
  app.get("/api/admin/members", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "pending";
      if (status !== "pending" && status !== "active" && status !== "removed") {
        res.status(400).json({ message: "Unknown status filter." });
        return;
      }
      const members = await dal.memberships.listForAdminQueue(staffCtx(req), status);
      res.json({ members });
    } catch (err) {
      next(err);
    }
  });

  // ---- §4: detail — contact, org, inviter, and the person's other active
  // memberships (the context that makes this queue safe, §4).
  app.get("/api/admin/members/:id", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const id = req.params.id ?? "";
      if (!UUID_RE.test(id)) {
        sendNotFound(res);
        return;
      }
      const ctx = staffCtx(req);
      const detail = await dal.memberships.getAdminDetail(ctx, id);
      if (!detail) {
        sendNotFound(res);
        return;
      }
      const activeMemberships = await dal.memberships.listActiveByUser(ctx, detail.userId);
      const otherMemberships = activeMemberships
        .filter((m) => m.id !== detail.id)
        .map((m) => ({ orgName: m.orgName, role: m.role }));
      res.json({
        membership: {
          id: detail.id,
          orgId: detail.orgId,
          userId: detail.userId,
          role: detail.role,
          status: detail.status,
          invitedAt: detail.createdAt,
          approvedAt: detail.approvedAt,
        },
        person: {
          firstName: detail.firstName,
          lastName: detail.lastName,
          email: detail.email,
          phone: detail.phone,
          needsReview: detail.needsReview,
        },
        organization: { id: detail.orgId, name: detail.orgName, status: detail.orgStatus },
        inviter:
          detail.inviterFirstName !== null || detail.inviterLastName !== null
            ? { name: `${detail.inviterFirstName ?? ""} ${detail.inviterLastName ?? ""}`.trim() }
            : null,
        otherMemberships,
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- §6 Approve: one-tx bundle (status + stamps + one event + email row),
  // dispatch after commit; the result never claims a send that failed (§12).
  app.post("/api/admin/members/:id/approve", requireStaff, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const userId = staffContext(req).userId;
    try {
      const result = await approveMembership({ membershipId: id, staffUserId: userId });
      let message: string;
      if (result.email.outcome === "queued") {
        const outcomes = await dispatchQueuedEmails([result.email.dispatch]);
        const sent = outcomes[0] && outcomes[0].outcome === "sent";
        message = sent
          ? // §8 verbatim.
            `${result.memberName} approved. Login email queued to ${result.memberEmail}.`
          : `${result.memberName} approved. The login email to ${result.memberEmail} failed to send — it is logged in the Email log and can be resent there.`;
      } else if (result.email.outcome === "skipped_disabled") {
        message = `${result.memberName} approved. The login email is disabled under Automated emails, so it was skipped (logged in the Email log).`;
      } else {
        message = `${result.memberName} approved. The login email to ${result.memberEmail} failed to send — it is logged in the Email log and can be resent there.`;
      }
      res.json({ membership: result.membership, message });
    } catch (err) {
      if (err instanceof MembershipNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof MembershipAlreadyActiveError) {
        // §12: another staff member approved first — no-op success, row refreshes.
        const detail = await dal.memberships.getAdminDetail({ kind: "staff", userId }, id);
        const name = detail ? `${detail.firstName} ${detail.lastName}`.trim() : "This member";
        res.json({ message: `${name} was already approved. Nothing changed.`, noop: true });
        return;
      }
      if (err instanceof MemberOrgNotApprovedError) {
        // §8 verbatim.
        res
          .status(409)
          .json({ message: `${err.orgName} is not approved yet, so this membership cannot be activated.` });
        return;
      }
      if (err instanceof MembershipStateError) {
        res
          .status(409)
          .json({ message: `Only a pending membership can be approved. This one is ${err.currentStatus}.` });
        return;
      }
      console.error(`[admin] membership approve failed for ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Reject: pending → removed, optional note on the event (D15),
  // no email, and people/users rows untouched (§3).
  app.post("/api/admin/members/:id/reject", requireStaff, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const rawNote = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const userId = staffContext(req).userId;
    try {
      const result = await rejectMembership({
        membershipId: id,
        staffUserId: userId,
        note: rawNote === "" ? undefined : rawNote,
      });
      // §8 verbatim.
      res.json({ membership: result.membership, message: `${result.memberName} rejected. No email was sent.` });
    } catch (err) {
      if (err instanceof MembershipNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof MembershipAlreadyRemovedError) {
        const detail = await dal.memberships.getAdminDetail({ kind: "staff", userId }, id);
        const name = detail ? `${detail.firstName} ${detail.lastName}`.trim() : "This member";
        res.json({ message: `${name} was already rejected. Nothing changed.`, noop: true });
        return;
      }
      if (err instanceof MembershipStateError) {
        res
          .status(409)
          .json({ message: `Only a pending membership can be rejected. This one is ${err.currentStatus}.` });
        return;
      }
      console.error(`[admin] membership reject failed for ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // --------------------------------------------------------------------------
  // ADMIN-04 — People review queue (docs/specs/ADMIN-04.md). Staff ADMIN
  // only (§11): a staff approver gets the same 404 as a nonexistent route.
  // --------------------------------------------------------------------------

  // ---- §4 region 1: flagged people with counts of what hangs off them.
  app.get("/api/admin/people/review", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const people = await dal.peopleReview.listReviewQueue(staffCtx(req));
      res.json({ people });
    } catch (err) {
      next(err);
    }
  });

  // ---- §4 regions 2–3: named attached records + duplicate candidates,
  // each candidate carrying its own attached-record summary.
  app.get("/api/admin/people/review/:id", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const id = req.params.id ?? "";
      if (!UUID_RE.test(id)) {
        sendNotFound(res);
        return;
      }
      const ctx = staffCtx(req);
      const person = await dal.people.getById(ctx, id);
      if (!person || !person.needsReview) {
        // The detail serves the queue; an unflagged id is not part of it.
        sendNotFound(res);
        return;
      }
      const attached = await dal.peopleReview.getAttachedRecords(ctx, id);
      const candidateRows = await dal.peopleReview.listDuplicateCandidates(ctx, id);
      const candidates = [];
      for (const candidate of candidateRows) {
        candidates.push({ person: candidate, attached: await dal.peopleReview.getAttachedRecords(ctx, candidate.id) });
      }
      res.json({ person, attached, candidates });
    } catch (err) {
      next(err);
    }
  });

  // ---- §6 Save names: writes the two name columns and nothing else.
  // Correcting a name and confirming a record are two decisions — the
  // flag stays set.
  app.post("/api/admin/people/review/:id/names", requireStaffAdmin, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
    const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
    if (firstName === "" || lastName === "") {
      // §12: blocked, not defaulted.
      res.status(400).json({ message: "Both name fields are required." });
      return;
    }
    try {
      const ctx = staffCtx(req);
      const person = await dal.people.getById(ctx, id);
      if (!person || !person.needsReview) {
        sendNotFound(res);
        return;
      }
      const updated = await dal.people.updateNames(ctx, id, firstName, lastName);
      // §8 verbatim.
      res.json({ person: updated, message: "Name updated. This record is still flagged for review." });
    } catch (err) {
      console.error(`[admin] people-review name save failed for ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Clear flag: needs_review → false, review_note PRESERVED (D17).
  app.post("/api/admin/people/review/:id/clear-flag", requireStaffAdmin, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    try {
      const ctx = staffCtx(req);
      const person = await dal.people.getById(ctx, id);
      if (!person || !person.needsReview) {
        sendNotFound(res);
        return;
      }
      const cleared = await dal.people.clearReviewFlag(ctx, id);
      const name = `${cleared.firstName} ${cleared.lastName}`.trim();
      // §8 verbatim.
      res.json({ person: cleared, message: `${name} cleared.` });
    } catch (err) {
      console.error(`[admin] people-review clear-flag failed for ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Merge: the one irreversible action. merge_people() + its event
  // row in one tx (person-merge service). The typed confirmation is
  // enforced HERE, not just in the UI — a request without confirm:"MERGE"
  // never reaches the transaction.
  app.post("/api/admin/people/review/:id/merge", requireStaffAdmin, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const duplicateId = typeof req.body?.duplicateId === "string" ? req.body.duplicateId : "";
    const survivorId = typeof req.body?.survivorId === "string" ? req.body.survivorId : "";
    const confirm = typeof req.body?.confirm === "string" ? req.body.confirm : "";
    if (!UUID_RE.test(duplicateId) || !UUID_RE.test(survivorId)) {
      res.status(400).json({ message: SAVE_FAILURE });
      return;
    }
    // The merge is initiated from a flagged person's detail; that person
    // must be one side of it, and the two sides must differ (§6).
    if (duplicateId === survivorId || (id !== duplicateId && id !== survivorId)) {
      res.status(400).json({ message: SAVE_FAILURE });
      return;
    }
    if (confirm !== "MERGE") {
      res.status(400).json({ message: SAVE_FAILURE });
      return;
    }
    try {
      const ctx = staffCtx(req);
      const flagged = await dal.people.getById(ctx, id);
      if (!flagged || !flagged.needsReview) {
        sendNotFound(res);
        return;
      }
      const result = await mergePeopleService(ctx, {
        duplicateId,
        survivorId,
        actorUserId: staffContext(req).userId,
      });
      const survivorName = `${result.survivor.firstName} ${result.survivor.lastName}`.trim();
      // §8 verbatim.
      res.json({
        message: `Merged. ${survivorName} now holds ${result.summary}.`,
        survivor: result.survivor,
        moved: result.moved,
      });
    } catch (err) {
      if (err instanceof MergeBothHaveUsersError) {
        // §8 verbatim blocked line, §12: readable reason before the tx.
        res.status(409).json({ message: "Both records have login accounts. Remove or reassign one before merging." });
        return;
      }
      if (err instanceof MergePersonNotFoundError) {
        sendNotFound(res);
        return;
      }
      console.error(`[admin] people-review merge failed (${duplicateId} -> ${survivorId}):`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // --------------------------------------------------------------------------
  // ADMIN-05 — Populations management (docs/specs/ADMIN-05.md). Staff
  // ADMIN only (§11). Region 3 (Other values) is the reason this surface
  // exists: free text that keeps recurring should become a real option.
  // --------------------------------------------------------------------------

  app.get("/api/admin/populations", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const ctx = staffCtx(req);
      const [populations, otherValues] = await Promise.all([
        dal.populations.listWithCounts(ctx),
        dal.populations.listOtherValues(ctx),
      ]);
      res.json({ populations, otherValues });
    } catch (err) {
      next(err);
    }
  });

  // ---- §6 Add: name + slug validated and collision-checked BEFORE the
  // database rejects them (§12). Lands at the end of the sort order, active.
  app.post("/api/admin/populations", requireStaffAdmin, async (req: Request, res: Response) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const slug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    if (name === "" || slug === "") {
      res.status(400).json({ message: "Name and slug are both required." });
      return;
    }
    if (!SLUG_RE.test(slug)) {
      res.status(400).json({ message: "Slug must be lowercase letters and numbers separated by hyphens." });
      return;
    }
    try {
      const ctx = staffCtx(req);
      const existing = await dal.populations.listAll(ctx);
      if (existing.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
        res.status(409).json({ message: `A population named "${name}" already exists.` });
        return;
      }
      if (existing.some((p) => p.slug === slug)) {
        res.status(409).json({ message: `The slug "${slug}" is already in use.` });
        return;
      }
      const population = await dal.populations.create(ctx, { name, slug });
      res.json({ population });
    } catch (err) {
      console.error(`[admin] population add failed (${name}):`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Reorder: the order here is the order organizations see at
  // MP-03. The payload must be exactly the current id set.
  app.post("/api/admin/populations/reorder", requireStaffAdmin, async (req: Request, res: Response) => {
    const orderedIds: unknown = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string" || !UUID_RE.test(id))) {
      res.status(400).json({ message: SAVE_FAILURE });
      return;
    }
    try {
      const ctx = staffCtx(req);
      const current = await dal.populations.listAll(ctx);
      const currentIds = new Set(current.map((p) => p.id));
      const proposed = new Set(orderedIds as string[]);
      if (currentIds.size !== proposed.size || ![...currentIds].every((id) => proposed.has(id))) {
        res.status(400).json({ message: SAVE_FAILURE });
        return;
      }
      await dal.populations.updateSortOrders(ctx, orderedIds as string[]);
      res.json({ ok: true });
    } catch (err) {
      console.error("[admin] population reorder failed:", err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Rename: the label changes everywhere, the slug never does (D18).
  app.post("/api/admin/populations/:id/rename", requireStaffAdmin, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (name === "") {
      res.status(400).json({ message: "Name is required." });
      return;
    }
    try {
      const ctx = staffCtx(req);
      const existing = await dal.populations.listAll(ctx);
      if (!existing.some((p) => p.id === id)) {
        sendNotFound(res);
        return;
      }
      if (existing.some((p) => p.id !== id && p.name.trim().toLowerCase() === name.toLowerCase())) {
        res.status(409).json({ message: `A population named "${name}" already exists.` });
        return;
      }
      const population = await dal.populations.rename(ctx, id, name);
      res.json({ population });
    } catch (err) {
      console.error(`[admin] population rename failed (${id}):`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Deactivate: existing assignments untouched; Other is permanent
  // infrastructure and cannot be deactivated.
  app.post("/api/admin/populations/:id/deactivate", requireStaffAdmin, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    try {
      const ctx = staffCtx(req);
      const existing = await dal.populations.listAll(ctx);
      const row = existing.find((p) => p.id === id);
      if (!row) {
        sendNotFound(res);
        return;
      }
      if (row.slug === "other") {
        // §8 verbatim.
        res
          .status(409)
          .json({ message: "Other cannot be deactivated. Organizations need a way to describe populations that are not listed." });
        return;
      }
      if (!row.isActive) {
        // Race with another staff session — the state is already what was
        // asked for (§12 pattern from prior surfaces).
        res.json({ population: row });
        return;
      }
      const population = await dal.populations.deactivate(ctx, id);
      res.json({ population });
    } catch (err) {
      console.error(`[admin] population deactivate failed (${id}):`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // ---- §6 Promote: free text becomes a real option, one transaction.
  // Name collision blocks with a rename suggestion — no reassignment on
  // collision (D21).
  app.post("/api/admin/populations/promote", requireStaffAdmin, async (req: Request, res: Response) => {
    const value = typeof req.body?.value === "string" ? req.body.value : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const groupKey = value.trim().toLowerCase();
    if (groupKey === "" || name === "") {
      res.status(400).json({ message: "A value and a name are both required." });
      return;
    }
    const slug = slugify(name);
    if (slug === "") {
      res.status(400).json({ message: "That name does not produce a usable slug. Rename before promoting." });
      return;
    }
    try {
      const ctx = staffCtx(req);
      const existing = await dal.populations.listAll(ctx);
      if (existing.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
        // D21 verbatim-adjacent: blocked with the rename suggestion.
        res.status(409).json({ message: `A population named "${name}" already exists. Rename before promoting.` });
        return;
      }
      if (existing.some((p) => p.slug === slug)) {
        res.status(409).json({ message: `The slug "${slug}" is already in use. Rename before promoting.` });
        return;
      }
      const result = await dal.populations.promoteOther(ctx, { groupKey, name, slug });
      // §8 verbatim.
      res.json({
        message: `${result.population.name} added and assigned to ${result.orgs.length} organizations.`,
        population: result.population,
        assignedOrgs: result.orgs,
      });
    } catch (err) {
      if (err instanceof dal.populations.PromoteNoOrganizationsError) {
        // The value vanished between render and click (promoted elsewhere,
        // or the org edited its field). Nothing was written.
        res.status(409).json({ message: SAVE_FAILURE });
        return;
      }
      console.error(`[admin] population promote failed (${groupKey}):`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // --------------------------------------------------------------------------
  // ADMIN-06 — Email log (docs/specs/ADMIN-06.md). Staff admin AND staff
  // approver read it (§11: requireStaff, unlike 04/05) — payloads are
  // reachable only behind this gate.

  app.get("/api/admin/email", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const ctx = staffCtx(req);
      const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
      const status = str(req.query.status);
      if (
        status !== undefined &&
        status !== "queued" &&
        status !== "sending" &&
        status !== "sent" &&
        status !== "failed" &&
        status !== "skipped"
      ) {
        res.status(400).json({ message: "Unknown status filter." });
        return;
      }
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const from = str(req.query.from);
      const to = str(req.query.to);
      if ((from !== undefined && !DATE_RE.test(from)) || (to !== undefined && !DATE_RE.test(to))) {
        res.status(400).json({ message: "Dates must be YYYY-MM-DD." });
        return;
      }
      const rows = await dal.emailLog.listWithFilters(ctx, {
        status,
        templateKey: str(req.query.template),
        toEmailContains: str(req.query.recipient),
        createdFrom: from,
        createdTo: to,
        limit: 200,
      });
      const refs = rows
        .filter((r) => r.entityType && r.entityId)
        .map((r) => ({ type: r.entityType as string, id: r.entityId as string }));
      const entities = await dal.emailResendData.resolveEntityRefs(ctx, refs);
      const failureCount = await dal.emailLog.countFailuresLastSevenDays(ctx);
      const anyExist = rows.length > 0 || (await dal.emailLog.listWithFilters(ctx, { limit: 1 })).length > 0;
      res.json({
        failureCount,
        anyExist,
        rows: rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          sentAt: r.sentAt,
          templateKey: r.templateKey,
          toEmail: r.toEmail,
          status: r.status,
          error: r.error,
          failureCategory: r.failureCategory,
          resendOfId: r.resendOfId,
          entityType: r.entityType,
          entityId: r.entityId,
          entity: r.entityType && r.entityId ? (entities[`${r.entityType}:${r.entityId}`] ?? null) : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/admin/email/:id", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const id = req.params.id ?? "";
      if (!UUID_RE.test(id)) {
        sendNotFound(res);
        return;
      }
      const ctx = staffCtx(req);
      const row = await dal.emailLog.getById(ctx, id);
      if (!row) {
        sendNotFound(res);
        return;
      }
      const [entities, resendAttempt] = await Promise.all([
        row.entityType && row.entityId
          ? dal.emailResendData.resolveEntityRefs(ctx, [{ type: row.entityType, id: row.entityId }])
          : Promise.resolve({} as Record<string, { name: string; path: string | null }>),
        dal.emailLog.findResendAttempt(ctx, id),
      ]);

      // Compute resend eligibility without hitting the DB for the rebuilder check.
      type ResendEligibility = { allowed: true } | { allowed: false; reason: string };
      let resendEligibility: ResendEligibility;
      if (row.status !== "failed") {
        resendEligibility = { allowed: false, reason: "Only failed emails can be resent." };
      } else if (row.providerMessageId) {
        resendEligibility = {
          allowed: false,
          reason:
            "The provider already accepted this email (a provider message id is recorded), so resending would deliver a duplicate.",
        };
      } else if (row.error && row.error.includes(MAY_HAVE_SENT_MARKER)) {
        resendEligibility = {
          allowed: false,
          reason:
            "This send was interrupted and the provider may already have delivered it. Verify in the provider dashboard before resending to avoid a duplicate.",
        };
      } else if (row.failureCategory === "sweep" && row.error && row.error.includes("verify with the provider")) {
        resendEligibility = {
          allowed: false,
          reason:
            "This email was stranded mid-send and the provider outcome is unknown. Verify in the provider dashboard before resending.",
        };
      } else if (row.templateKey === "auth_magic_link") {
        resendEligibility = {
          allowed: false,
          reason: "Login link emails cannot be resent. The member can request a new link from the sign-in page.",
        };
      } else if (!RESENDABLE_TEMPLATE_KEYS.has(row.templateKey)) {
        resendEligibility = {
          allowed: false,
          reason: `No resend procedure exists for the "${row.templateKey}" template.`,
        };
      } else {
        resendEligibility = { allowed: true };
      }

      res.json({
        ...row,
        entity: row.entityType && row.entityId ? (entities[`${row.entityType}:${row.entityId}`] ?? null) : null,
        resendEligibility,
        resendAttempt: resendAttempt
          ? {
              id: resendAttempt.id,
              createdAt: resendAttempt.createdAt,
              status: resendAttempt.status,
              toEmail: resendAttempt.toEmail,
              error: resendAttempt.error,
              sentAt: resendAttempt.sentAt,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  });

  // §6 Resend: failed rows only; payload re-resolved from CURRENT data; a
  // new row records the outcome and the failed row stays. D24 duplicates
  // are refused with the delivery date, never a constraint violation.
  app.post("/api/admin/email/:id/resend", requireStaff, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    try {
      const result = await resendEmail(staffCtx(req), id);
      if (result.outcome === "sent") {
        res.json({ message: `Sent to ${result.toEmail}.` });
      } else {
        res.json({ message: `Still failing. ${result.error.replace(/\.+$/, "")}.` });
      }
    } catch (err) {
      if (err instanceof EmailRowNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof AlreadyDeliveredError || err instanceof ResendBlockedError) {
        res.status(409).json({ message: err.message });
        return;
      }
      console.error(`[admin] email ${id} resend failed:`, err);
      res.status(500).json({ message: "That did not save. Nothing was changed." });
    }
  });

  // --------------------------------------------------------------------------
  // ADMIN-07 — Audit trail (docs/specs/ADMIN-07.md). Read-only: this one
  // route is the whole surface and it writes nothing.

  app.get("/api/admin/activity", requireStaff, async (req: Request, res: Response, next) => {
    try {
      const ctx = staffCtx(req);
      const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
      const type = str(req.query.type);
      if (type !== undefined && ENTITY_TYPE_NAMES[type] === undefined) {
        res.status(400).json({ message: "Unknown type filter." });
        return;
      }
      const actor = str(req.query.actor);
      if (actor !== undefined && actor !== "automated" && !UUID_RE.test(actor)) {
        res.status(400).json({ message: "Unknown actor filter." });
        return;
      }
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const from = str(req.query.from);
      const to = str(req.query.to);
      if ((from !== undefined && !DATE_RE.test(from)) || (to !== undefined && !DATE_RE.test(to))) {
        res.status(400).json({ message: "Dates must be YYYY-MM-DD." });
        return;
      }
      // Entity deep link (?entityType=&entityId=) shows one entity's full
      // history (§7) — both halves or neither.
      const entityType = str(req.query.entityType);
      const entityId = str(req.query.entityId);
      if ((entityType === undefined) !== (entityId === undefined)) {
        res.status(400).json({ message: "Entity filter needs both type and id." });
        return;
      }
      if (entityType !== undefined && ENTITY_TYPE_NAMES[entityType] === undefined) {
        res.status(400).json({ message: "Unknown type filter." });
        return;
      }
      if (entityId !== undefined && !UUID_RE.test(entityId)) {
        sendNotFound(res);
        return;
      }
      const rows = await dal.approvalEvents.listWithFilters(ctx, {
        entityType: entityType ?? type,
        automated: actor === "automated",
        actorUserId: actor !== undefined && actor !== "automated" ? actor : undefined,
        entityId,
        createdFrom: from,
        createdTo: to,
        limit: 300,
      });
      const refs = rows.map((r) => ({ type: r.entityType, id: r.entityId }));
      const entities = await dal.emailResendData.resolveEntityRefs(ctx, refs);
      const { actors, hasAutomated } = await dal.approvalEvents.listActors(ctx);
      const anyExist =
        rows.length > 0 || (await dal.approvalEvents.listWithFilters(ctx, { limit: 1 })).length > 0;
      res.json({
        anyExist,
        actors,
        hasAutomated,
        rows: rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          entityType: r.entityType,
          entityId: r.entityId,
          fromStatus: r.fromStatus,
          toStatus: r.toStatus,
          actorUserId: r.actorUserId,
          actorName: r.actorName,
          note: r.note,
          entity: entities[`${r.entityType}:${r.entityId}`] ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // --------------------------------------------------------------------------
  // ADMIN-08 — Digest subscribers (docs/specs/ADMIN-08.md). Staff ADMIN
  // only (§11): an approver gets the byte-identical unknown-route 404. The
  // list is public email addresses; the CSV export is the one export in
  // the admin, and every export is a named operator action.

  const parseSubscriberFilters = (
    req: Request,
  ):
    | { ok: true; f: import("../dal/digest-subscribers").SubscriberFilters }
    | { ok: false; message: string } => {
    const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
    const status = str(req.query.status);
    if (status !== undefined && status !== "subscribed" && status !== "unsubscribed" && status !== "bounced") {
      return { ok: false, message: "Unknown status filter." };
    }
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const from = str(req.query.from);
    const to = str(req.query.to);
    if ((from !== undefined && !DATE_RE.test(from)) || (to !== undefined && !DATE_RE.test(to))) {
      return { ok: false, message: "Dates must be YYYY-MM-DD." };
    }
    return {
      ok: true,
      f: { status, emailContains: str(req.query.email), subscribedFrom: from, subscribedTo: to },
    };
  };

  app.get("/api/admin/subscribers", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const ctx = staffCtx(req);
      const parsed = parseSubscriberFilters(req);
      if (!parsed.ok) {
        res.status(400).json({ message: parsed.message });
        return;
      }
      const [rows, counts, lastRun] = await Promise.all([
        dal.digestSubscribers.listWithFilters(ctx, parsed.f),
        dal.digestSubscribers.counts(ctx),
        dal.digestRuns.latest(ctx),
      ]);
      const anyExist = counts.subscribed + counts.unsubscribed + counts.bounced > 0;
      // lastRun makes the digest job's last decision visible here — including
      // the skipped_empty weeks, which send nothing but are never silent.
      res.json({ rows, counts, anyExist, lastRun });
    } catch (err) {
      next(err);
    }
  });

  // The export reflects the caller's filters exactly. The CSV is built in
  // full before anything is sent — a failed query is a JSON error, never a
  // partial file (§12).
  app.get("/api/admin/subscribers/export.csv", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const ctx = staffCtx(req);
      const parsed = parseSubscriberFilters(req);
      if (!parsed.ok) {
        res.status(400).json({ message: parsed.message });
        return;
      }
      const rows = await dal.digestSubscribers.listWithFilters(ctx, parsed.f);
      const laDay = (v: string | Date | null): string =>
        v === null ? "" : new Date(v).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      // CSV-quote AND neutralize spreadsheet formula injection: a leading
      // = + - @ or tab/CR would execute in Excel/Sheets when staff open the
      // export, and email/name cells are public user input. The apostrophe
      // prefix makes the cell literal; quoting alone does not.
      const esc = (v: string): string => {
        const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
        return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const lines = ["email,first_name,last_name,status,subscribed,unsubscribed,source"];
      for (const r of rows) {
        lines.push(
          [
            esc(r.email),
            esc(r.firstName ?? ""),
            esc(r.lastName ?? ""),
            r.status,
            laDay(r.subscribedAt),
            laDay(r.unsubscribedAt),
            r.legacySource === null ? "Signed up" : "Imported",
          ].join(","),
        );
      }
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="subscribers-${today}.csv"`);
      res.send(lines.join("\n") + "\n");
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/admin/subscribers/:id/unsubscribe", requireStaffAdmin, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    try {
      const result = await dal.digestSubscribers.unsubscribeById(staffCtx(req), id);
      if (result.outcome === "missing") {
        sendNotFound(res);
        return;
      }
      if (result.outcome === "bounced") {
        res.status(409).json({ message: "That address bounced and is not subscribed." });
        return;
      }
      // "done" and "already" both land here: a row the person unsubscribed
      // themselves in the meantime is a no-op success (§12).
      res.json({ message: `${result.email} unsubscribed.` });
    } catch (err) {
      console.error(`[admin] subscriber ${id} unsubscribe failed:`, err);
      res.status(500).json({ message: "That did not save. Nothing was changed." });
    }
  });

  // ---- §ADMIN-08 digest upcoming-needs preview and per-need exclusions.
  //
  // GET  /api/admin/digest/upcoming        — upcoming window + all needs with exclusion status
  // POST /api/admin/digest/upcoming/:type/:id/exclude   — exclude a need (idempotent)
  // DELETE /api/admin/digest/upcoming/:type/:id/exclude — re-include a need (idempotent)
  //
  // All three are requireStaffAdmin: same gate as the rest of ADMIN-08.

  app.get("/api/admin/digest/upcoming", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const result = await dal.digestRuns.upcomingNeeds(staffCtx(req));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  const NEED_TYPE_SET = new Set(["item", "volunteer"]);

  app.post(
    "/api/admin/digest/upcoming/:needType/:needId/exclude",
    requireStaffAdmin,
    async (req: Request, res: Response, next) => {
      const needType = req.params.needType ?? "";
      const needId = req.params.needId ?? "";
      if (!NEED_TYPE_SET.has(needType) || !UUID_RE.test(needId)) {
        sendNotFound(res);
        return;
      }
      try {
        // window_start is computed server-side and stored for auditability.
        // Filtering uses excluded_at, not window_start, so no drift problem.
        const win = await dal.digestRuns.upcomingWindow(staffCtx(req));
        const userId = staffContext(req).userId;
        await dal.digestRuns.excludeNeed(
          staffCtx(req),
          needType as "item" | "volunteer",
          needId,
          win.windowStart,
          userId,
        );
        res.json({ excluded: true });
      } catch (err) {
        next(err);
      }
    },
  );

  app.delete(
    "/api/admin/digest/upcoming/:needType/:needId/exclude",
    requireStaffAdmin,
    async (req: Request, res: Response, next) => {
      const needType = req.params.needType ?? "";
      const needId = req.params.needId ?? "";
      if (!NEED_TYPE_SET.has(needType) || !UUID_RE.test(needId)) {
        sendNotFound(res);
        return;
      }
      try {
        await dal.digestRuns.includeNeed(staffCtx(req), needType as "item" | "volunteer", needId);
        res.json({ excluded: false });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- §6 Reinstate: removed → PENDING, so the normal approval path and its
  // login email still run. Never straight to active.
  app.post("/api/admin/members/:id/reinstate", requireStaff, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const userId = staffContext(req).userId;
    try {
      const result = await reinstateMembership({ membershipId: id, staffUserId: userId });
      res.json({
        membership: result.membership,
        message: `${result.memberName} returned to the pending queue.`,
      });
    } catch (err) {
      if (err instanceof MembershipNotFoundError) {
        sendNotFound(res);
        return;
      }
      if (err instanceof MembershipAlreadyPendingError) {
        const detail = await dal.memberships.getAdminDetail({ kind: "staff", userId }, id);
        const name = detail ? `${detail.firstName} ${detail.lastName}`.trim() : "This member";
        res.json({ message: `${name} is already in the pending queue. Nothing changed.`, noop: true });
        return;
      }
      if (err instanceof MembershipStateError) {
        res
          .status(409)
          .json({ message: `Only a removed membership can be reinstated. This one is ${err.currentStatus}.` });
        return;
      }
      console.error(`[admin] membership reinstate failed for ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });

  // --------------------------------------------------------------------------
  // ADMIN-09 — role management (staff admin only)
  // --------------------------------------------------------------------------

  // ---- Every membership across every org, with person and org context.
  app.get("/api/admin/roles", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const memberships = await dal.memberships.listForRoleAdmin(staffCtx(req));
      res.json({ memberships });
    } catch (err) {
      next(err);
    }
  });

  // ---- Change one membership's role. Staff roles live only in the
  // platform_owner org, owner/member only in member orgs, and the last
  // active staff_admin can never be demoted — all checked under the row lock.
  app.post("/api/admin/roles/:id", requireStaffAdmin, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    if (!UUID_RE.test(id)) {
      sendNotFound(res);
      return;
    }
    const role = typeof req.body?.role === "string" ? req.body.role : "";
    if (!ROLE_VALUES.has(role)) {
      res.status(400).json({ message: "Unknown role." });
      return;
    }
    const newRole = role as MembershipRole;
    const userId = staffContext(req).userId;
    try {
      const result = await withDbContext({ kind: "staff", userId }, async (c) => {
        const row = await dal.memberships.getRoleAdminRowInTx(c, id);
        if (!row) return { kind: "not_found" as const };
        if (row.role === newRole) return { kind: "noop" as const, row };
        const isStaffRole = newRole === "staff_admin" || newRole === "staff_approver";
        if (isStaffRole && row.orgKind !== "platform_owner") {
          return { kind: "wrong_org" as const, message: "Staff roles can only be held in the platform owner organization." };
        }
        if (!isStaffRole && row.orgKind === "platform_owner") {
          return { kind: "wrong_org" as const, message: "Platform owner memberships can only hold staff roles." };
        }
        if (row.userId === userId && row.role === "staff_admin" && newRole !== "staff_admin") {
          return { kind: "self_demotion" as const };
        }
        if (
          row.orgKind === "platform_owner" &&
          row.role === "staff_admin" &&
          row.status === "active" &&
          (await dal.memberships.countActiveStaffAdminsLockedInTx(c)) <= 1
        ) {
          return { kind: "last_admin" as const };
        }
        const membership = await dal.memberships.changeRoleInTx(c, id, row.role, newRole, userId);
        return { kind: "changed" as const, row, membership };
      });

      switch (result.kind) {
        case "not_found":
          sendNotFound(res);
          return;
        case "noop": {
          const name = `${result.row.firstName} ${result.row.lastName}`.trim();
          res.json({ membership: result.row, message: `${name} already has that role. Nothing changed.`, noop: true });
          return;
        }
        case "wrong_org":
          res.status(409).json({ message: result.message });
          return;
        case "self_demotion":
          res.status(409).json({
            message: "You cannot demote your own staff admin role. Nothing was changed.",
          });
          return;
        case "last_admin":
          res.status(409).json({
            message: "This is the last active staff admin, so this role cannot be changed. Nothing was changed.",
          });
          return;
        case "changed": {
          const name = `${result.row.firstName} ${result.row.lastName}`.trim();
          res.json({
            membership: result.membership,
            message: `${name} is now ${ROLE_LABELS[newRole]} at ${result.row.orgName}. The change applies the next time their session is resolved.`,
          });
          return;
        }
      }
    } catch (err) {
      console.error(`[admin] role change failed for membership ${id}:`, err);
      res.status(500).json({ message: SAVE_FAILURE });
    }
  });
}
