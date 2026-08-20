/**
 * Item requests — the material-needs workflow entity.
 * draft -> pending -> active -> archived; every transition writes an
 * approval event in the same transaction. Archive is the end state; there is
 * no DELETE (replit.md rule 7). Counters on child items move only through
 * record_item_pledge().
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type {
  ArchivedReason,
  DeadlineType,
  ImageGenStatus,
  ItemRequest,
  PublicItemRequest,
  PublicOrganization,
  RequestStatus,
} from "../../shared/types";
import { insertInTx } from "./approval-events";

const COLS = `r.id, r.legacy_wix_id as "legacyWixId", r.org_id as "orgId", r.title, r.description,
  r.image_url as "imageUrl", r.image_generated as "imageGenerated", r.image_gen_status as "imageGenStatus",
  r.image_gen_error as "imageGenError", r.image_gen_retries as "imageGenRetries",
  r.dropoff_location as "dropoffLocation", r.people_helped as "peopleHelped",
  r.deadline_type as "deadlineType", r.deadline_date as "deadlineDate", r.expires_on as "expiresOn",
  r.contact_person_id as "contactPersonId", r.status, r.submitted_at as "submittedAt",
  r.approved_at as "approvedAt", r.approved_by as "approvedBy", r.archived_at as "archivedAt",
  r.archived_reason as "archivedReason", r.created_by as "createdBy",
  r.created_at as "createdAt", r.updated_at as "updatedAt"`;

export type CreateItemRequestInput = {
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  dropoffLocation?: string | null;
  peopleHelped?: number | null;
  deadlineType?: DeadlineType;
  /** ISO date (YYYY-MM-DD). */
  deadlineDate?: string | null;
  /** ISO date (YYYY-MM-DD). */
  expiresOn?: string | null;
  contactPersonId?: string | null;
  createdBy?: string | null;
};

export type UpdateItemRequestPatch = Partial<{
  title: string;
  description: string | null;
  imageUrl: string | null;
  dropoffLocation: string | null;
  peopleHelped: number | null;
  deadlineType: DeadlineType;
  deadlineDate: string | null;
  expiresOn: string | null;
  contactPersonId: string | null;
  imageGenerated: boolean;
  imageGenStatus: ImageGenStatus | null;
  imageGenError: string | null;
}>;

const PATCH_COLUMNS: Record<keyof UpdateItemRequestPatch, string> = {
  title: "title",
  description: "description",
  imageUrl: "image_url",
  dropoffLocation: "dropoff_location",
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
// Auto-sourced images. The uploaded-photo-wins rule is enforced HERE, in SQL:
// an auto write only lands where image_url is still null (or where the
// current image is itself auto-sourced, for staff regenerate). Callers get
// null back when an uploaded photo won and must discard their stored object.
// ---------------------------------------------------------------------------

/** Mark an attempt in flight. Returns false when the request no longer qualifies. */
export async function markImageGenPending(ctx: DbContext, requestId: string): Promise<boolean> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<{ id: string }>(
      c,
      `update item_requests set image_gen_status = 'pending', image_gen_error = null
       where id = $1
          and status in ('draft', 'pending', 'active')
           and (image_url is null or image_generated)
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
): Promise<ItemRequest | null> {
  return withDbContext(ctx, async (c) => {
    const guard = opts.overwriteGenerated ? "(r.image_url is null or r.image_generated)" : "r.image_url is null";
    const rows = await q<ItemRequest>(
      c,
      `update item_requests r
       set image_url = $2, image_generated = true, image_gen_status = 'succeeded', image_gen_error = null
        where r.id = $1 and ${guard}
          and r.status in ('draft', 'pending', 'active')
       returning ${COLS.replaceAll("r.", "")}`,
      [requestId, imageUrl],
    );
    return rows[0] ?? null;
  });
}

/** Record a failed attempt — visible on the admin surface, never silent. */
export async function recordImageGenFailure(ctx: DbContext, requestId: string, message: string): Promise<void> {
  await withDbContext(ctx, (c) =>
    q(c, `update item_requests set image_gen_status = 'failed', image_gen_error = $2
           where id = $1 and status in ('draft', 'pending', 'active')
             and (image_url is null or image_generated)`, [
      requestId,
      message.slice(0, 500),
    ]),
  );
}

export type ImageGenSweepRow = { id: string; title: string; imageGenStatus: string; imageGenRetries: number };

/**
 * Find item_requests that the image-sweep job should retry:
 *   - image_gen_status = 'failed'  (a previous attempt recorded a failure)
 *   - image_gen_status = 'pending' older than `afterMinutes` (stranded by a
 *     process restart before the result could be recorded)
 * Rows that have already been retried `maxRetries` times are excluded —
 * repeated failures remain visible on the admin panel via image_gen_status.
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
       from item_requests
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
 * Atomically claim one item_request for a sweep retry.  Increments
 * image_gen_retries and sets status to 'pending' so concurrent sweeps
 * don't double-attempt the same row.  Returns false when the row was
 * already claimed, succeeded, or hit the retry cap since selection.
 *
 * Concurrency safety: the WHERE clause distinguishes the two eligible states:
 *   - 'failed' rows are always claimable (no age guard needed).
 *   - 'pending' rows are only claimable when updated_at is old enough —
 *     i.e. stranded by a crash.  After the first sweep claims a 'failed' row
 *     (flipping it to 'pending' with a fresh updated_at), a concurrent second
 *     sweep sees a recent-updated_at pending row and returns false.
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
      `update item_requests
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
export async function clearGeneratedImage(ctx: DbContext, requestId: string): Promise<ItemRequest | null> {
  return withDbContext(ctx, async (c) => {
    const rows = await q<ItemRequest>(
      c,
      `update item_requests r
       set image_url = null, image_generated = false, image_gen_status = null, image_gen_error = null
        where r.id = $1 and r.image_generated
          and r.status in ('draft', 'pending', 'active')
       returning ${COLS.replaceAll("r.", "")}`,
      [requestId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Legal lifecycle edges. draft -> pending (submit), pending -> draft (return
 * for edits), pending -> active (approve), and any pre-archive status ->
 * archived (with an explicit reason). Archived reopens only to pending
 * (MP-09 D2): a reopened request returns through approval rather than
 * straight to public, so approval history stays honest.
 */
export const ALLOWED_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["pending", "archived"],
  pending: ["draft", "active", "archived"],
  active: ["archived"],
  archived: ["pending"],
};

export type TransitionInput = {
  requestId: string;
  to: RequestStatus;
  actorUserId?: string | null;
  note?: string | null;
  /** Required when to = 'archived'. */
  archivedReason?: ArchivedReason;
};

/**
 * The database function is the single expiry rule for item requests. It
 * includes the legacy archive date and date-specific member deadlines, while
 * keeping a request live through its full LA calendar day.
 */
const ITEM_REQUEST_EXPIRED = `item_request_expired_on(
  r.deadline_type,
  r.deadline_date,
  r.expires_on,
  item_request_current_la_date()
)`;

/**
 * Nightly expiry job: active requests whose date-specific deadline or legacy
 * expires_on date has passed. The database predicate intentionally matches
 * public visibility and the pledge-write guard.
 */
export async function expiredActiveIds(ctx: DbContext, limit: number): Promise<string[]> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(
      c,
      `select r.id from item_requests r
        where r.status = 'active' and ${ITEM_REQUEST_EXPIRED}
        order by least(
          coalesce(r.expires_on, 'infinity'::date),
          coalesce(case when r.deadline_type = 'date_specific' then r.deadline_date end, 'infinity'::date)
        ), r.id
        limit $1`,
      [limit],
    ),
  );
  return rows.map((r) => r.id);
}

/**
 * Archive one selected item request only if it is still active and expired
 * after its row lock is acquired. This closes the selection-to-transition race:
 * a member deadline extension that commits first wins and the job skips the row.
 */
export async function archiveExpiredIfEligibleInTx(c: PoolClient, requestId: string): Promise<boolean> {
  const locked = await q<{ status: RequestStatus }>(
    c,
    `select status from item_requests where id = $1 for update`,
    [requestId],
  );
  if (locked[0]?.status !== "active") return false;

  const eligibility = await q<{ expired: boolean }>(
    c,
    `select ${ITEM_REQUEST_EXPIRED} as expired from item_requests r where r.id = $1`,
    [requestId],
  );
  if (eligibility[0]?.expired !== true) return false;

  await transitionStatusInTx(c, {
    requestId,
    to: "archived",
    actorUserId: null,
    note: "expired",
    archivedReason: "expired",
  });
  return true;
}

/** Active item request that is still available under the shared expiry rule. */
export async function getActiveAvailableById(ctx: DbContext, requestId: string): Promise<ItemRequest | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<ItemRequest>(
      c,
      `select ${COLS} from item_requests r
        where r.id = $1 and r.status = 'active' and not (${ITEM_REQUEST_EXPIRED})`,
      [requestId],
    ),
  );
  return rows[0] ?? null;
}

export async function getById(ctx: DbContext, requestId: string): Promise<ItemRequest | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<ItemRequest>(c, `select ${COLS} from item_requests r where r.id = $1`, [requestId]),
  );
  return rows[0] ?? null;
}

/** Lookup for legacy Wix 301 redirects. Never used as a foreign key. */
export async function getByLegacyWixId(ctx: DbContext, legacyWixId: string): Promise<ItemRequest | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<ItemRequest>(c, `select ${COLS} from item_requests r where r.legacy_wix_id = $1`, [legacyWixId]),
  );
  return rows[0] ?? null;
}

/** An organization's requests, newest first (MP-04 cards). */
export async function listByOrganization(ctx: DbContext, orgId: string): Promise<ItemRequest[]> {
  return withDbContext(ctx, (c) =>
    q<ItemRequest>(c, `select ${COLS} from item_requests r where r.org_id = $1 order by r.created_at desc`, [orgId]),
  );
}

/** Requests by status across all organizations (ADMIN-02). */
export async function listByStatus(ctx: DbContext, status: RequestStatus): Promise<ItemRequest[]> {
  return withDbContext(ctx, (c) =>
    q<ItemRequest>(c, `select ${COLS} from item_requests r where r.status = $1 order by r.created_at desc`, [status]),
  );
}

/** Active, unexpired requests of approved orgs with public org fields (PB-01). */
export async function listActivePublic(ctx: DbContext): Promise<PublicItemRequest[]> {
  type Row = ItemRequest & {
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
         from item_requests r join organizations o on o.id = r.org_id
         where r.status = 'active' and not (${ITEM_REQUEST_EXPIRED})
           and o.status = 'approved' and o.kind = 'member_org'
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

/** Create a draft (MP-07). Org id comes from the session via the org guard. */
/** Tx-composable draft insert (MP-07: request + contact person in one tx). */
export async function createDraftInTx(c: PoolClient, orgId: string, input: CreateItemRequestInput): Promise<ItemRequest> {
  const rows = await q<ItemRequest>(
    c,
    `insert into item_requests (org_id, title, description, image_url, dropoff_location, people_helped,
       deadline_type, deadline_date, expires_on, contact_person_id, status, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11)
     returning ${COLS.replaceAll("r.", "")}`,
    [
      orgId,
      input.title,
      input.description ?? null,
      input.imageUrl ?? null,
      input.dropoffLocation ?? null,
      input.peopleHelped ?? null,
      input.deadlineType ?? "until_fulfilled",
      input.deadlineDate ?? null,
      input.expiresOn ?? null,
      input.contactPersonId ?? null,
      input.createdBy ?? null,
    ],
  );
  const request = rows[0];
  if (!request) throw new Error("itemRequests.createDraft returned no row");
  return request;
}

export async function createDraft(ctx: DbContext, orgId: string, input: CreateItemRequestInput): Promise<ItemRequest> {
  return withDbContext(ctx, (c) => createDraftInTx(c, orgId, input));
}

/** Update request fields (MP-09). Scoped to the session organization. */
export async function updateInTx(
  c: PoolClient,
  orgId: string,
  requestId: string,
  patch: UpdateItemRequestPatch,
): Promise<ItemRequest> {
  const keys = Object.keys(patch) as (keyof UpdateItemRequestPatch)[];
  if (keys.length === 0) throw new Error(`itemRequests.updateInTx: empty patch for ${requestId}`);
  const sets: string[] = [];
  const params: unknown[] = [requestId, orgId];
  for (const key of keys) {
    params.push(patch[key] ?? null);
    sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
  }
  const rows = await q<ItemRequest>(
    c,
    `update item_requests r set ${sets.join(", ")} where r.id = $1 and r.org_id = $2 returning ${COLS.replaceAll("r.", "")}`,
    params,
  );
  const request = rows[0];
  if (!request) throw new Error(`itemRequests.updateInTx: not found in org: ${requestId}`);
  return request;
}

export async function update(
  ctx: DbContext,
  orgId: string,
  requestId: string,
  patch: UpdateItemRequestPatch,
): Promise<ItemRequest> {
  const keys = Object.keys(patch) as (keyof UpdateItemRequestPatch)[];
  if (keys.length === 0) {
    const existing = await getById(ctx, requestId);
    if (!existing || existing.orgId !== orgId) throw new Error(`itemRequests.update: not found in org: ${requestId}`);
    return existing;
  }
  return withDbContext(ctx, (c) => updateInTx(c, orgId, requestId, patch));
}

/**
 * Move a request to a new status, writing timestamps and the approval event
 * in one transaction. draft->pending sets submitted_at; ->active sets
 * approved_at/approved_by (a live approval, D48); ->archived sets archived_at
 * and archived_reason.
 */
export async function transitionStatusInTx(c: PoolClient, input: TransitionInput): Promise<ItemRequest> {
  {
    const current = await q<{ status: RequestStatus }>(
      c,
      `select status from item_requests where id = $1 for update`,
      [input.requestId],
    );
    const from = current[0]?.status;
    if (!from) throw new Error(`itemRequests.transitionStatus: request not found: ${input.requestId}`);
    if (from === input.to) throw new Error(`itemRequests.transitionStatus: already ${input.to}`);
    if (!ALLOWED_TRANSITIONS[from].includes(input.to)) {
      throw new Error(
        `itemRequests.transitionStatus: ${from} -> ${input.to} is not a legal edge (archived reopens only to pending; active only archives)`,
      );
    }

    let sql: string;
    const params: unknown[] = [input.requestId];
    if (input.to === "pending") {
      sql = `update item_requests set status = 'pending', submitted_at = now() where id = $1`;
    } else if (input.to === "active") {
      params.push(input.actorUserId ?? null);
      sql = `update item_requests set status = 'active', approved_at = now(), approved_by = $2 where id = $1`;
    } else if (input.to === "archived") {
      if (!input.archivedReason) {
        throw new Error(`itemRequests.transitionStatus: archivedReason is required when archiving`);
      }
      params.push(input.archivedReason);
      sql = `update item_requests set status = 'archived', archived_at = now(), archived_reason = $2 where id = $1`;
    } else {
      sql = `update item_requests set status = 'draft' where id = $1`;
    }
    await c.query(sql, params);
    await insertInTx(c, {
      entityType: "item_request",
      entityId: input.requestId,
      fromStatus: from,
      toStatus: input.to,
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? null,
    });
    const rows = await q<ItemRequest>(c, `select ${COLS} from item_requests r where r.id = $1`, [input.requestId]);
    const request = rows[0];
    if (!request) throw new Error(`itemRequests.transitionStatus: reload failed: ${input.requestId}`);
    return request;
  }
}

export async function transitionStatus(ctx: DbContext, input: TransitionInput): Promise<ItemRequest> {
  return withDbContext(ctx, (c) => transitionStatusInTx(c, input));
}

/**
 * ADMIN-02 correction-only transition. Kept out of ALLOWED_TRANSITIONS so
 * member workflows cannot move a public request back to review. The caller
 * must hold the request lock and verify there is no activity before invoking
 * this function; the status is rechecked here and the current approval stamp
 * is cleared in the same transaction as the audit event.
 */
export async function unapproveForCorrectionInTx(
  c: PoolClient,
  requestId: string,
  actorUserId: string,
): Promise<ItemRequest> {
  const current = await q<{ status: RequestStatus }>(
    c,
    `select status from item_requests where id = $1 for update`,
    [requestId],
  );
  const from = current[0]?.status;
  if (!from) throw new Error(`itemRequests.unapproveForCorrection: request not found: ${requestId}`);
  if (from !== "active") {
    throw new Error(`itemRequests.unapproveForCorrection: only active requests can be unapproved (status: ${from})`);
  }
  await c.query(
    `update item_requests
        set status = 'pending', approved_at = null, approved_by = null
      where id = $1`,
    [requestId],
  );
  await insertInTx(c, {
    entityType: "item_request",
    entityId: requestId,
    fromStatus: "active",
    toStatus: "pending",
    actorUserId,
    note: "staff correction",
  });
  const rows = await q<ItemRequest>(c, `select ${COLS} from item_requests r where r.id = $1`, [requestId]);
  const request = rows[0];
  if (!request) throw new Error(`itemRequests.unapproveForCorrection: reload failed: ${requestId}`);
  return request;
}

/**
 * ADMIN-02 Reinstate: archived -> active, staff-only. Deliberately NOT an
 * edge in ALLOWED_TRANSITIONS — the generic map keeps the member lane honest
 * (archived reopens only to pending, MP-09 D2). Reinstating is not a
 * re-approval: approved_at/approved_by are untouched (D48 — approval stamps
 * the pending-to-active transition only); the archive fields clear so the
 * row reads as plainly active again.
 */
export async function reinstateInTx(c: PoolClient, requestId: string, actorUserId: string | null): Promise<ItemRequest> {
  const current = await q<{ status: RequestStatus }>(
    c,
    `select status from item_requests where id = $1 for update`,
    [requestId],
  );
  const from = current[0]?.status;
  if (!from) throw new Error(`itemRequests.reinstate: request not found: ${requestId}`);
  if (from === "active") throw new Error(`itemRequests.reinstate: already active`);
  if (from !== "archived") {
    throw new Error(`itemRequests.reinstate: only archived requests can be reinstated (status: ${from})`);
  }
  await c.query(
    `update item_requests set status = 'active', archived_at = null, archived_reason = null where id = $1`,
    [requestId],
  );
  await insertInTx(c, {
    entityType: "item_request",
    entityId: requestId,
    fromStatus: from,
    toStatus: "active",
    actorUserId: actorUserId ?? null,
    note: null,
  });
  const rows = await q<ItemRequest>(c, `select ${COLS} from item_requests r where r.id = $1`, [requestId]);
  const request = rows[0];
  if (!request) throw new Error(`itemRequests.reinstate: reload failed: ${requestId}`);
  return request;
}

export async function reinstate(ctx: DbContext, requestId: string, actorUserId: string | null): Promise<ItemRequest> {
  return withDbContext(ctx, (c) => reinstateInTx(c, requestId, actorUserId));
}

/** Archive with a reason — convenience over transitionStatus. */
export async function archive(
  ctx: DbContext,
  requestId: string,
  reason: ArchivedReason,
  actorUserId?: string | null,
  note?: string | null,
): Promise<ItemRequest> {
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
    q<{ id: string }>(c, `update item_requests set created_by = $2 where created_by = $1 returning id`, [
      fromUserId,
      toUserId,
    ]),
  );
  const approved = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `update item_requests set approved_by = $2 where approved_by = $1 returning id`, [
      fromUserId,
      toUserId,
    ]),
  );
  return created.length + approved.length;
}
