/**
 * Digest subscribers — the weekly digest list (PB-05, ADMIN-08).
 * Unsubscribe is a status change keyed by the opaque token; rows are never
 * deleted. Sending the digest itself is out of scope (do-not-build list).
 */
import { q, withDbContext, type DbContext } from "../db/client";
import type { DigestSubscriber, SubscriberStatus } from "../../shared/types";

const COLS = `id, person_id as "personId", email, first_name as "firstName", last_name as "lastName",
  status, unsubscribe_token as "unsubscribeToken",
  subscribed_at as "subscribedAt", unsubscribed_at as "unsubscribedAt", legacy_source as "legacySource"`;

export type CreateSubscriberInput = {
  email: string;
  /** Stored exactly as entered, never concatenated (Handbook §8, D65). */
  firstName?: string | null;
  lastName?: string | null;
  personId?: string | null;
  legacySource?: string | null;
};

/** All subscribers, optionally by status, newest first (ADMIN-08). */
export async function list(ctx: DbContext, status?: SubscriberStatus): Promise<DigestSubscriber[]> {
  if (status) {
    return withDbContext(ctx, (c) =>
      q<DigestSubscriber>(c, `select ${COLS} from digest_subscribers where status = $1 order by subscribed_at desc`, [
        status,
      ]),
    );
  }
  return withDbContext(ctx, (c) =>
    q<DigestSubscriber>(c, `select ${COLS} from digest_subscribers order by subscribed_at desc`),
  );
}

export async function findByEmail(ctx: DbContext, email: string): Promise<DigestSubscriber | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<DigestSubscriber>(c, `select ${COLS} from digest_subscribers where lower(email) = lower($1)`, [email]),
  );
  return rows[0] ?? null;
}

/**
 * Subscribe an email (PB-05). Idempotent on lower(email): an existing row is
 * returned as-is (resubscribing a previously unsubscribed address flips it
 * back to subscribed).
 */
export async function create(ctx: DbContext, input: CreateSubscriberInput): Promise<DigestSubscriber> {
  return withDbContext(ctx, async (c) => {
    const existing = await q<DigestSubscriber>(
      c,
      `select ${COLS} from digest_subscribers where lower(email) = lower($1)`,
      [input.email],
    );
    const found = existing[0];
    if (found) {
      // Resubscribe: revive if needed and update the stored names to the
      // values just submitted — same freshness rule as the email itself
      // (D65). coalesce keeps existing names when a caller has none to give
      // (legacy import); PB-05 always provides both.
      const revived = await q<DigestSubscriber>(
        c,
        `update digest_subscribers
            set status = 'subscribed',
                unsubscribed_at = null,
                first_name = coalesce($2, first_name),
                last_name = coalesce($3, last_name)
          where id = $1 returning ${COLS}`,
        [found.id, input.firstName ?? null, input.lastName ?? null],
      );
      const row = revived[0];
      if (!row) throw new Error("digestSubscribers.create: revive failed");
      return row;
    }
    const rows = await q<DigestSubscriber>(
      c,
      `insert into digest_subscribers (email, first_name, last_name, person_id, legacy_source)
       values ($1, $2, $3, $4, $5) returning ${COLS}`,
      [input.email, input.firstName ?? null, input.lastName ?? null, input.personId ?? null, input.legacySource ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error("digestSubscribers.create returned no row");
    return row;
  });
}

/** Flip status by unsubscribe token (PB-05 unsubscribe link). Null if no such token. */
export async function updateStatusByToken(
  ctx: DbContext,
  token: string,
  status: SubscriberStatus,
): Promise<DigestSubscriber | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<DigestSubscriber>(
      c,
      `update digest_subscribers
          set status = $2,
              unsubscribed_at = case when $2 = 'unsubscribed' then now() else null end
        where unsubscribe_token = $1 returning ${COLS}`,
      [token, status],
    ),
  );
  return rows[0] ?? null;
}

/** Everything, for CSV export (ADMIN-08). Shaping is the surface's concern. */
export async function exportAll(ctx: DbContext): Promise<DigestSubscriber[]> {
  return withDbContext(ctx, (c) =>
    q<DigestSubscriber>(c, `select ${COLS} from digest_subscribers order by subscribed_at asc`),
  );
}

// ---------------------------------------------------------------------
// ADMIN-08 reads and the one write (manual unsubscribe).

export type SubscriberFilters = {
  status?: SubscriberStatus;
  /** Case-insensitive literal substring — position(), not LIKE, so no wildcards. */
  emailContains?: string;
  /** Inclusive YYYY-MM-DD bounds on subscribed_at. */
  subscribedFrom?: string;
  subscribedTo?: string;
};

export type SubscriberListRow = Omit<DigestSubscriber, "unsubscribeToken"> & { personName: string | null };

/**
 * Filtered list, people-joined for display names, newest first. The
 * unsubscribe token is deliberately NOT selected — the admin surface and
 * its CSV never need the capability URL.
 */
export async function listWithFilters(ctx: DbContext, f: SubscriberFilters = {}): Promise<SubscriberListRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status !== undefined) {
    params.push(f.status);
    where.push(`s.status = $${params.length}`);
  }
  if (f.emailContains !== undefined) {
    params.push(f.emailContains.toLowerCase());
    where.push(`position($${params.length} in lower(s.email)) > 0`);
  }
  if (f.subscribedFrom !== undefined) {
    params.push(f.subscribedFrom);
    where.push(`(s.subscribed_at at time zone 'America/Los_Angeles')::date >= $${params.length}::date`);
  }
  if (f.subscribedTo !== undefined) {
    params.push(f.subscribedTo);
    where.push(`(s.subscribed_at at time zone 'America/Los_Angeles')::date <= $${params.length}::date`);
  }
  const sql = `select s.id, s.person_id as "personId", s.email,
      s.first_name as "firstName", s.last_name as "lastName", s.status,
      s.subscribed_at as "subscribedAt", s.unsubscribed_at as "unsubscribedAt", s.legacy_source as "legacySource",
      case when p.id is null then null
           else nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') end as "personName"
    from digest_subscribers s
    left join people p on p.id = s.person_id
    ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
    order by s.subscribed_at desc`;
  return withDbContext(ctx, (c) => q<SubscriberListRow>(c, sql, params));
}

/** The counts region — the one question this surface answers before the send job exists. */
export async function counts(
  ctx: DbContext,
): Promise<{ subscribed: number; unsubscribed: number; bounced: number }> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ subscribed: string; unsubscribed: string; bounced: string }>(
      c,
      `select count(*) filter (where status = 'subscribed') as subscribed,
              count(*) filter (where status = 'unsubscribed') as unsubscribed,
              count(*) filter (where status = 'bounced') as bounced
         from digest_subscribers`,
    ),
  );
  const r = rows[0];
  return {
    subscribed: Number(r?.subscribed ?? 0),
    unsubscribed: Number(r?.unsubscribed ?? 0),
    bounced: Number(r?.bounced ?? 0),
  };
}

export type ManualUnsubscribeResult =
  | { outcome: "done"; email: string }
  | { outcome: "already"; email: string }
  | { outcome: "bounced"; email: string }
  | { outcome: "missing" };

/**
 * Manual unsubscribe (ADMIN-08 §6). Race-safe: only a subscribed row is
 * updated. A row the person already unsubscribed themselves is a no-op
 * success (§12 — the intent is satisfied). Never deletes, never touches
 * people.
 */
export async function unsubscribeById(ctx: DbContext, id: string): Promise<ManualUnsubscribeResult> {
  return withDbContext(ctx, async (c) => {
    const updated = await q<{ email: string }>(
      c,
      `update digest_subscribers set status = 'unsubscribed', unsubscribed_at = now()
        where id = $1 and status = 'subscribed' returning email`,
      [id],
    );
    const done = updated[0];
    if (done) return { outcome: "done", email: done.email };
    const existing = await q<{ email: string; status: string }>(
      c,
      `select email, status from digest_subscribers where id = $1`,
      [id],
    );
    const row = existing[0];
    if (!row) return { outcome: "missing" };
    if (row.status === "bounced") return { outcome: "bounced", email: row.email };
    return { outcome: "already", email: row.email };
  });
}
