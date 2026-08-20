/**
 * Volunteer requests — mirrors item_requests for the time-and-talent branch.
 * Same lifecycle, same event discipline. Counters on child roles move only
 * through record_volunteer_signup(), and volunteer requests never auto-archive
 * on fulfillment (interest is not fulfillment).
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type {
  ArchivedReason,
  DeadlineType,
  ImageGenStatus,
  PublicOrganization,
  PublicVolunteerRequest,
  RequestStatus,
  VolunteerRequest,
} from "../../shared/types";
import { insertInTx } from "./approval-events";
import { ALLOWED_TRANSITIONS, type ImageGenSweepRow } from "./item-requests";

const COLS = `r.id, r.legacy_wix_id as "legacyWixId", r.org_id as "orgId", r.title, r.description,
  r.details, r.event_location as "eventLocation", r.image_url as "imageUrl",
  r.image_generated as "imageGenerated", r.image_gen_status as "imageGenStatus",
  r.image_gen_error as "imageGenError", r.image_gen_retries as "imageGenRetries",
  r.people_helped as "peopleHelped", r.deadline_type as "deadlineType", r.deadline_date as "deadlineDate",
  r.expires_on as "expiresOn", r.contact_person_id as "contactPersonId", r.status,
  r.submitted_at as "submittedAt", r.approved_at as "approvedAt", r.approved_by as "approvedBy",
  r.archived_at as "archivedAt", r.archived_reason as "archivedReason", r.created_by as "createdBy",
  r.created_at as "createdAt", r.updated_at as "updatedAt"`;

export type CreateVolunteerRequestInput = {
  title: string;
  description?: string | null;
  details?: string | null;
  eventLocation?: string | null;
  imageUrl?: string | null;
  peopleHelped?: number | null;
  deadlineType?: DeadlineType;
  /** ISO date (YYYY-MM-DD). */
  deadlineDate?: string | null;
  /** ISO date (YYYY-MM-DD). */
  expiresOn?: string | null;
  contactPersonId?: string | null;
  createdBy?: string | null;
};

export type UpdateVolunteerRequestPatch = Partial<{
  title: string;
  description: string | null;
  details: string | null;
  eventLocation: string | null;
  imageUrl: string | null;
  peopleHelped: number | null;
  deadlineType: DeadlineType;
  deadlineDate: string | null;
  expiresOn: string | null;
  contactPersonId: string | null;
  imageGenerated: boolean;
  imageGenStatus: ImageGenStatus | null;
  imageGenError: string | null;
}>;

const PATCH_COLUMNS: Record<keyof UpdateVolunteerRequestPatch, string> = {
  title: "title",
  description: "description",
  details: "details",
  eventLocation: "event_location",
  imageUrl: "image_url",
  peopleHelped: "people_helped",
  deadlineType: "deadline_type",
  deadlineDate: "deadline_date",
  expiresOn: "expires_on",
  contactPersonId: "contact_person_id",
  imageGenerated: "image_generated",
  imageGenStatus: "image_gen_status",
  imageGenError: "image_gen_error",
};

// ---------------------------------------------------------------------------
// Auto-sourced images. Twin of the item_requests block — the uploaded-photo-
// wins rule is enforced HERE, in SQL: an auto write only lands where image_url
// is still null (or where the current image is itself auto-sourced, for staff
// regenerate). Callers get null back when an uploaded photo won and must
// discard their stored object. Activity guards use volunteer_signups and the
// role counters, the volunteer twins of item_pledges / item quantities.
// ---------------------------------------------------------------------------

/** Mark an attempt in flight. Returns false when the request no longer qualifies. */
export async function markImageGenPending(ctx: DbContext, requestId: string): Promise<boolean> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<{ id: string }>(
      c,
      `update volunteer_requests set image_gen_status = 'pending', image_gen_error = null
       where id = $1
         and status in ('draft', 'pending')
         and approved_at is null
         and not exists(select 1 from volunteer_signups vs where vs.volunteer_request_id = volunteer_requests.id)
         and not exists(
           select 1 from volunteer_roles vr where vr.volunteer_request_id = volunteer_requests.id
             and (vr.quantity_interested > 0 or vr.quantity_confirmed > 0)
         )
       returning id`,
      [requestId],
    );
    return rows.length > 0;
  });
}

/**
 * Record a stored auto-sourced image. `overwriteGenerated` (staff regenerate)
 * may replace a previous auto image; it never replaces an uploaded photo.
 */
export async function recordGeneratedImage(
  ctx: DbContext,
  requestId: string,
  imageUrl: string,
  opts: { overwriteGenerated: boolean },
): Promise<VolunteerRequest | null> {
  return withDbContext(ctx, async (c) => {
    const guard = opts.overwriteGenerated ? "(r.image_url is null or r.image_generated)" : "r.image_url is null";
    const rows = await q<VolunteerRequest>(
      c,
      `update volunteer_requests r
       set image_url = $2, image_generated = true, image_gen_status = 'succeeded', image_gen_error = null
       where r.id = $1 and ${guard}
         and r.status in ('draft', 'pending')
         and r.approved_at is null
         and not exists(select 1 from volunteer_signups vs where vs.volunteer_request_id = r.id)
         and not exists(
           select 1 from volunteer_roles vr where vr.volunteer_request_id = r.id
             and (vr.quantity_interested > 0 or vr.quantity_confirmed > 0)
         )
       returning ${COLS.replaceAll("r.", "")}`,
      [requestId, imageUrl],
    );
    return rows[0] ?? null;
  });
}

/** Record a failed attempt — visible on the admin surface, never silent. */
export async function recordImageGenFailure(ctx: DbContext, requestId: string, message: string): Promise<void> {
  await withDbContext(ctx, (c) =>
    q(c, `update volunteer_requests set image_gen_status = 'failed', image_gen_error = $2
          where id = $1 and status in ('draft', 'pending') and approved_at is null`, [
      requestId,
      message.slice(0, 500),
    ]),
  );
}

/**
 * Find volunteer_requests that the image-sweep job should retry. Same two
 * eligible states as the item twin: recorded 'failed', or 'pending' stranded
 * by a process restart. Rows already retried `maxRetries` times are excluded —
 * they stay visible on the admin panel at image_gen_status = 'failed'.
 */
export async function listFailedOrStrandedImageGen(
  ctx: DbContext,
  afterMinutes: number,
  maxRetries: number,
): Promise<ImageGenSweepRow[]> {
  return withDbContext(ctx, (c) =>
    q<ImageGenSweepRow>(
      c,
      `select id, title, image_gen_status as "imageGenStatus", image_gen_retries as "imageGenRetries"
       from volunteer_requests
       where image_gen_retries < $2
         and (
           image_gen_status = 'failed'
           or (
             image_gen_status = 'pending'
             and updated_at < now() - ($1 || ' minutes')::interval
           )
         )`,
      [afterMinutes, maxRetries],
    ),
  );
}

/**
 * Atomically claim one volunteer_request for a sweep retry. See the item twin
 * for the concurrency reasoning: 'failed' rows are always claimable, 'pending'
 * rows only once old enough to be considered stranded, so a second concurrent
 * sweep cannot double-attempt a row this one just claimed.
 */
export async function claimImageGenForSweep(
  ctx: DbContext,
  requestId: string,
  maxRetries: number,
  strandedAfterMinutes: number,
): Promise<boolean> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<{ id: string }>(
      c,
      `update volunteer_requests
       set image_gen_status = 'pending',
           image_gen_retries = image_gen_retries + 1,
           image_gen_error   = null
       where id = $1
         and image_gen_retries < $2
         and (
           image_gen_status = 'failed'
           or (
             image_gen_status = 'pending'
             and updated_at < now() - ($3 || ' minutes')::interval
           )
         )
       returning id`,
      [requestId, maxRetries, strandedAfterMinutes],
    );
    return rows.length > 0;
  });
}

/** Remove an auto-sourced image. No-op (returns null) when the image was uploaded. */
export async function clearGeneratedImage(ctx: DbContext, requestId: string): Promise<VolunteerRequest | null> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<VolunteerRequest>(
      c,
      `update volunteer_requests r
       set image_url = null, image_generated = false, image_gen_status = null, image_gen_error = null
       where r.id = $1 and r.image_generated
         and r.status in ('draft', 'pending')
         and r.approved_at is null
         and not exists(select 1 from volunteer_signups vs where vs.volunteer_request_id = r.id)
         and not exists(
           select 1 from volunteer_roles vr where vr.volunteer_request_id = r.id
             and (vr.quantity_interested > 0 or vr.quantity_confirmed > 0)
         )
       returning ${COLS.replaceAll("r.", "")}`,
      [requestId],
    );
    return rows[0] ?? null;
  });
}

export type VolunteerTransitionInput = {
  requestId: string;
  to: RequestStatus;
  actorUserId?: string | null;
  note?: string | null;
  archivedReason?: ArchivedReason;
};

/** Twin of itemRequests.expiredActiveIds — see that comment. */
export async function expiredActiveIds(ctx: DbContext, limit: number): Promise<string[]> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(
      c,
      `select id from volunteer_requests
        where status = 'active' and expires_on is not null
          and expires_on < (now() at time zone 'America/Los_Angeles')::date
        order by expires_on, id
        limit $1`,
      [limit],
    ),
  );
  return rows.map((r) => r.id);
}

export async function getById(ctx: DbContext, requestId: string): Promise<VolunteerRequest | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<VolunteerRequest>(c, `select ${COLS} from volunteer_requests r where r.id = $1`, [requestId]),
  );
  return rows[0] ?? null;
}

/** Lookup for legacy Wix 301 redirects. Never used as a foreign key. */
export async function getByLegacyWixId(ctx: DbContext, legacyWixId: string): Promise<VolunteerRequest | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<VolunteerRequest>(c, `select ${COLS} from volunteer_requests r where r.legacy_wix_id = $1`, [legacyWixId]),
  );
  return rows[0] ?? null;
}

export async function listByOrganization(ctx: DbContext, orgId: string): Promise<VolunteerRequest[]> {
  return withDbContext(ctx, (c) =>
    q<VolunteerRequest>(c, `select ${COLS} from volunteer_requests r where r.org_id = $1 order by r.created_at desc`, [
      orgId,
    ]),
  );
}

export async function listByStatus(ctx: DbContext, status: RequestStatus): Promise<VolunteerRequest[]> {
  return withDbContext(ctx, (c) =>
    q<VolunteerRequest>(c, `select ${COLS} from volunteer_requests r where r.status = $1 order by r.created_at desc`, [
      status,
    ]),
  );
}

/** Active volunteer requests of approved orgs with public org fields (PB-03). */
export async function listActivePublic(ctx: DbContext): Promise<PublicVolunteerRequest[]> {
  type Row = VolunteerRequest & {
    orgName: string;
    orgSlug: string;
    orgMission: string | null;
    orgWebsiteUrl: string | null;
    orgCity: string | null;
    orgLogoUrl: string | null;
  };
  const rows = await withDbContext(ctx, (c) =>
    q<Row>(
      c,
      `select ${COLS}, o.name as "orgName", o.slug as "orgSlug", o.mission as "orgMission",
              o.website_url as "orgWebsiteUrl", o.city as "orgCity", o.logo_url as "orgLogoUrl"
         from volunteer_requests r join organizations o on o.id = r.org_id
        where r.status = 'active' and o.status = 'approved' and o.kind = 'member_org'
        order by r.approved_at desc nulls last, r.created_at desc`,
    ),
  );
  return rows.map((row) => {
    const { orgName, orgSlug, orgMission, orgWebsiteUrl, orgCity, orgLogoUrl, ...request } = row;
    const organization: PublicOrganization = {
      id: request.orgId,
      name: orgName,
      slug: orgSlug,
      mission: orgMission,
      websiteUrl: orgWebsiteUrl,
      city: orgCity,
      logoUrl: orgLogoUrl,
    };
    return { ...request, organization };
  });
}

/** Create a draft (MP-10). Org id comes from the session via the org guard. */
/** Transaction-scoped create so MP-10 writes person + request atomically. */
export async function createDraftInTx(
  c: PoolClient,
  orgId: string,
  input: CreateVolunteerRequestInput,
): Promise<VolunteerRequest> {
  const rows = await q<VolunteerRequest>(
    c,
    `insert into volunteer_requests (org_id, title, description, details, event_location, image_url,
       people_helped, deadline_type, deadline_date, expires_on, contact_person_id, status, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12)
     returning ${COLS.replaceAll("r.", "")}`,
    [
      orgId,
      input.title,
      input.description ?? null,
      input.details ?? null,
      input.eventLocation ?? null,
      input.imageUrl ?? null,
      input.peopleHelped ?? null,
      input.deadlineType ?? "until_fulfilled",
      input.deadlineDate ?? null,
      input.expiresOn ?? null,
      input.contactPersonId ?? null,
      input.createdBy ?? null,
    ],
  );
  const request = rows[0];
  if (!request) throw new Error("volunteerRequests.createDraft returned no row");
  return request;
}

export async function createDraft(
  ctx: DbContext,
  orgId: string,
  input: CreateVolunteerRequestInput,
): Promise<VolunteerRequest> {
  return withDbContext(ctx, (c) => createDraftInTx(c, orgId, input));
}

/** Update request fields (MP-12). Scoped to the session organization. */
export async function updateInTx(
  c: PoolClient,
  orgId: string,
  requestId: string,
  patch: UpdateVolunteerRequestPatch,
): Promise<VolunteerRequest> {
  const keys = Object.keys(patch) as (keyof UpdateVolunteerRequestPatch)[];
  if (keys.length === 0) throw new Error(`volunteerRequests.updateInTx: empty patch for ${requestId}`);
  const sets: string[] = [];
  const params: unknown[] = [requestId, orgId];
  for (const key of keys) {
    params.push(patch[key] ?? null);
    sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
  }
  const rows = await q<VolunteerRequest>(
    c,
    `update volunteer_requests r set ${sets.join(", ")}
      where r.id = $1 and r.org_id = $2 returning ${COLS.replaceAll("r.", "")}`,
    params,
  );
  const request = rows[0];
  if (!request) throw new Error(`volunteerRequests.updateInTx: not found in org: ${requestId}`);
  return request;
}

export async function update(
  ctx: DbContext,
  orgId: string,
  requestId: string,
  patch: UpdateVolunteerRequestPatch,
): Promise<VolunteerRequest> {
  const keys = Object.keys(patch) as (keyof UpdateVolunteerRequestPatch)[];
  if (keys.length === 0) {
    const existing = await getById(ctx, requestId);
    if (!existing || existing.orgId !== orgId)
      throw new Error(`volunteerRequests.update: not found in org: ${requestId}`);
    return existing;
  }
  return withDbContext(ctx, (c) => updateInTx(c, orgId, requestId, patch));
}

/**
 * Same transition semantics as item requests; see that module's doc comment.
 * Transaction-scoped so MP-11's submit can pair the move with queued emails.
 */
export async function transitionStatusInTx(c: PoolClient, input: VolunteerTransitionInput): Promise<VolunteerRequest> {
  const current = await q<{ status: RequestStatus }>(
    c,
    `select status from volunteer_requests where id = $1 for update`,
    [input.requestId],
  );
  const from = current[0]?.status;
  if (!from) throw new Error(`volunteerRequests.transitionStatusInTx: request not found: ${input.requestId}`);
  if (from === input.to) throw new Error(`volunteerRequests.transitionStatusInTx: already ${input.to}`);
  if (!ALLOWED_TRANSITIONS[from].includes(input.to)) {
    throw new Error(`volunteerRequests.transitionStatusInTx: ${from} -> ${input.to} is not a legal edge`);
  }

  let sql: string;
  const params: unknown[] = [input.requestId];
  if (input.to === "pending") {
    sql = `update volunteer_requests set status = 'pending', submitted_at = now() where id = $1`;
  } else if (input.to === "active") {
    params.push(input.actorUserId ?? null);
    sql = `update volunteer_requests set status = 'active', approved_at = now(), approved_by = $2 where id = $1`;
  } else if (input.to === "archived") {
    if (!input.archivedReason) {
      throw new Error(`volunteerRequests.transitionStatusInTx: archivedReason is required when archiving`);
    }
    params.push(input.archivedReason);
    sql = `update volunteer_requests set status = 'archived', archived_at = now(), archived_reason = $2 where id = $1`;
  } else {
    sql = `update volunteer_requests set status = 'draft' where id = $1`;
  }
  await c.query(sql, params);
  await insertInTx(c, {
    entityType: "volunteer_request",
    entityId: input.requestId,
    fromStatus: from,
    toStatus: input.to,
    actorUserId: input.actorUserId ?? null,
    note: input.note ?? null,
  });
  const rows = await q<VolunteerRequest>(c, `select ${COLS} from volunteer_requests r where r.id = $1`, [
    input.requestId,
  ]);
  const request = rows[0];
  if (!request) throw new Error(`volunteerRequests.transitionStatusInTx: reload failed: ${input.requestId}`);
  return request;
}

export async function transitionStatus(ctx: DbContext, input: VolunteerTransitionInput): Promise<VolunteerRequest> {
  return withDbContext(ctx, (c) => transitionStatusInTx(c, input));
}

/**
 * ADMIN-02 Reinstate: archived -> active, staff-only. Deliberately NOT an
 * edge in ALLOWED_TRANSITIONS — the generic map keeps the member lane honest
 * (archived reopens only to pending, MP-09 D2). Reinstating is not a
 * re-approval: approved_at/approved_by are untouched (D48 — approval stamps
 * the pending-to-active transition only); the archive fields clear so the
 * row reads as plainly active again.
 */
export async function reinstateInTx(
  c: PoolClient,
  requestId: string,
  actorUserId: string | null,
): Promise<VolunteerRequest> {
  const current = await q<{ status: RequestStatus }>(
    c,
    `select status from volunteer_requests where id = $1 for update`,
    [requestId],
  );
  const from = current[0]?.status;
  if (!from) throw new Error(`volunteerRequests.reinstate: request not found: ${requestId}`);
  if (from === "active") throw new Error(`volunteerRequests.reinstate: already active`);
  if (from !== "archived") {
    throw new Error(`volunteerRequests.reinstate: only archived requests can be reinstated (status: ${from})`);
  }
  await c.query(
    `update volunteer_requests set status = 'active', archived_at = null, archived_reason = null where id = $1`,
    [requestId],
  );
  await insertInTx(c, {
    entityType: "volunteer_request",
    entityId: requestId,
    fromStatus: from,
    toStatus: "active",
    actorUserId: actorUserId ?? null,
    note: null,
  });
  const rows = await q<VolunteerRequest>(c, `select ${COLS} from volunteer_requests r where r.id = $1`, [requestId]);
  const request = rows[0];
  if (!request) throw new Error(`volunteerRequests.reinstate: reload failed: ${requestId}`);
  return request;
}

export async function reinstate(ctx: DbContext, requestId: string, actorUserId: string | null): Promise<VolunteerRequest> {
  return withDbContext(ctx, (c) => reinstateInTx(c, requestId, actorUserId));
}

/** Archive with a reason — convenience over transitionStatus. */
export async function archive(
  ctx: DbContext,
  requestId: string,
  reason: ArchivedReason,
  actorUserId?: string | null,
  note?: string | null,
): Promise<VolunteerRequest> {
  return transitionStatus(ctx, {
    requestId,
    to: "archived",
    archivedReason: reason,
    actorUserId: actorUserId ?? null,
    note: note ?? null,
  });
}

/**
 * Re-point created_by / approved_by references from one user to another.
 * Seed-migration support (legacy synthetic staff_admin removal). Returns how
 * many rows changed.
 */
export async function reassignUserRefs(ctx: DbContext, fromUserId: string, toUserId: string): Promise<number> {
  const created = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `update volunteer_requests set created_by = $2 where created_by = $1 returning id`, [
      fromUserId,
      toUserId,
    ]),
  );
  const approved = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `update volunteer_requests set approved_by = $2 where approved_by = $1 returning id`, [
      fromUserId,
      toUserId,
    ]),
  );
  return created.length + approved.length;
}
