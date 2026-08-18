/**
 * Email log — every send writes a row BEFORE dispatch (replit.md rule 5).
 * The partial unique index email_log_once_idx (template_key, entity_type,
 * entity_id, lower(to_email)) makes entity-bound sends once-only; a duplicate
 * comes back as { duplicate: true }, a readable outcome instead of a
 * constraint error (D24).
 */
import type { PoolClient } from "pg";
import { isUniqueViolation, q, withDbContext, type DbContext } from "../db/client";
import type { EmailLogEntry, EmailStatus } from "../../shared/types";

const COLS = `id, template_key as "templateKey", to_email as "toEmail", to_person_id as "toPersonId",
  entity_type as "entityType", entity_id as "entityId", payload, status,
  provider_message_id as "providerMessageId", error, sent_at as "sentAt", created_at as "createdAt"`;

export type InsertQueuedEmailInput = {
  templateKey: string;
  toEmail: string;
  toPersonId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
};

export type InsertQueuedResult =
  | { duplicate: false; entry: EmailLogEntry }
  | { duplicate: true; entry: null };

/**
 * Insert the pre-dispatch row. Returns { duplicate: true } when the once-only
 * index says this template/entity/recipient combination was already sent.
 */
export async function insertQueued(ctx: DbContext, input: InsertQueuedEmailInput): Promise<InsertQueuedResult> {
  try {
    const rows = await withDbContext(ctx, (c) =>
      q<EmailLogEntry>(
        c,
        `insert into email_log (template_key, to_email, to_person_id, entity_type, entity_id, payload, status)
         values ($1, $2, $3, $4, $5, $6::jsonb, 'queued') returning ${COLS}`,
        [
          input.templateKey,
          input.toEmail,
          input.toPersonId ?? null,
          input.entityType ?? null,
          input.entityId ?? null,
          JSON.stringify(input.payload ?? {}),
        ],
      ),
    );
    const entry = rows[0];
    if (!entry) throw new Error("emailLog.insertQueued returned no row");
    return { duplicate: false, entry };
  } catch (err) {
    if (isUniqueViolation(err, "email_log_once_idx")) return { duplicate: true, entry: null };
    throw err;
  }
}

/**
 * Transaction-composable insert (MP-03 one-tx signup). No duplicate handling:
 * inside a composed transaction a unique violation would abort the tx anyway
 * (correct — the signup path always binds to a freshly created entity, so a
 * duplicate means a code bug, not a business outcome).
 */
export async function insertQueuedInTx(c: PoolClient, input: InsertQueuedEmailInput): Promise<EmailLogEntry> {
  const rows = await q<EmailLogEntry>(
    c,
    `insert into email_log (template_key, to_email, to_person_id, entity_type, entity_id, payload, status)
     values ($1, $2, $3, $4, $5, $6::jsonb, 'queued') returning ${COLS}`,
    [
      input.templateKey,
      input.toEmail,
      input.toPersonId ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  const entry = rows[0];
  if (!entry) throw new Error("emailLog.insertQueuedInTx returned no row");
  return entry;
}

/**
 * A send suppressed because staff disabled the template (ADMIN-10): a
 * visible "skipped (disabled)" row, never a silent drop. Skipped rows are
 * excluded from the once-only index, so re-enabling lets the email go out.
 */
export const SKIPPED_DISABLED_REASON = "skipped (disabled): template disabled by a staff admin";

export async function insertSkipped(ctx: DbContext, input: InsertQueuedEmailInput): Promise<EmailLogEntry> {
  const rows = await withDbContext(ctx, (c) => insertSkippedQuery(c, input));
  const entry = rows[0];
  if (!entry) throw new Error("emailLog.insertSkipped returned no row");
  return entry;
}

export async function insertSkippedInTx(c: PoolClient, input: InsertQueuedEmailInput): Promise<EmailLogEntry> {
  const rows = await insertSkippedQuery(c, input);
  const entry = rows[0];
  if (!entry) throw new Error("emailLog.insertSkippedInTx returned no row");
  return entry;
}

function insertSkippedQuery(c: PoolClient, input: InsertQueuedEmailInput): Promise<EmailLogEntry[]> {
  return q<EmailLogEntry>(
    c,
    `insert into email_log (template_key, to_email, to_person_id, entity_type, entity_id, payload, status, error)
     values ($1, $2, $3, $4, $5, $6::jsonb, 'skipped', $7) returning ${COLS}`,
    [
      input.templateKey,
      input.toEmail,
      input.toPersonId ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      JSON.stringify(input.payload ?? {}),
      SKIPPED_DISABLED_REASON,
    ],
  );
}

/**
 * Tx-composable duplicate probe (ADMIN-01 re-approval after a disable): the
 * once-only index would abort a composed transaction on insert, so callers
 * that legitimately might repeat an entity-bound send check first. Matches
 * the email_log_once_idx key exactly.
 */
export async function existsForRecipientInTx(
  c: PoolClient,
  input: { templateKey: string; entityType: string; entityId: string; toEmail: string },
): Promise<boolean> {
  const rows = await q<{ id: string }>(
    c,
    `select id from email_log
      where template_key = $1 and entity_type = $2 and entity_id = $3
        and lower(to_email) = lower($4) and status not in ('failed', 'skipped')
      limit 1`,
    [input.templateKey, input.entityType, input.entityId, input.toEmail],
  );
  return rows.length > 0;
}

/**
 * Tx-composable failure mark (ADMIN-01: a welcome email blocked by variable
 * resolution still leaves its failed row inside the approval transaction).
 */
export async function markFailedInTx(c: PoolClient, emailLogId: string, error: string): Promise<EmailLogEntry> {
  const rows = await q<EmailLogEntry>(
    c,
    `update email_log set status = 'failed', error = $2 where id = $1 returning ${COLS}`,
    [emailLogId, error],
  );
  const entry = rows[0];
  if (!entry) throw new Error(`emailLog.markFailedInTx: entry not found: ${emailLogId}`);
  return entry;
}

/**
 * Atomic dispatch claim: queued → sending, set BEFORE the provider call.
 * Returns false when the row is no longer 'queued' (already claimed, sent,
 * or failed) — the caller must then NOT call the provider. This is the
 * no-double-send guarantee: a row stranded in 'sending' means the process
 * stopped after (or during) the provider call, so it is never auto-retried.
 */
export async function claimForDispatch(ctx: DbContext, emailLogId: string): Promise<boolean> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(
      c,
      `update email_log set status = 'sending' where id = $1 and status = 'queued' returning id`,
      [emailLogId],
    ),
  );
  return rows.length > 0;
}

/**
 * Rows stranded mid-pipeline: status queued/sending and older than the
 * threshold. Excludes deliberate display fixtures (payload zz_fixture key —
 * see test-fixture-conventions). Oldest first; capped for a bounded pass.
 */
export async function listStranded(ctx: DbContext, olderThanMinutes: number, limit = 100): Promise<EmailLogEntry[]> {
  return withDbContext(ctx, (c) =>
    q<EmailLogEntry>(
      c,
      `select ${COLS} from email_log
        where status in ('queued','sending')
          and created_at < now() - make_interval(mins => $1)
          and not (payload ? 'zz_fixture')
        order by created_at asc limit $2`,
      [olderThanMinutes, limit],
    ),
  );
}

/**
 * Guarded completion: sending → sent, ONLY while the dispatch still owns the
 * claim. Returns null when the row was concurrently resolved (e.g. the
 * stranded-sweep already marked it failed) — the caller must then record the
 * late completion via recordLateProviderSent instead of blindly overwriting.
 */
export async function markSentIfSending(
  ctx: DbContext,
  emailLogId: string,
  providerMessageId: string,
): Promise<EmailLogEntry | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailLogEntry>(
      c,
      `update email_log set status = 'sent', provider_message_id = $2, sent_at = now()
        where id = $1 and status = 'sending' returning ${COLS}`,
      [emailLogId, providerMessageId],
    ),
  );
  return rows[0] ?? null;
}

/**
 * Late provider completion: the provider confirmed a send AFTER the row was
 * already marked failed (timeout or sweep). Truth wins — the email went out,
 * so the row becomes sent — but the prior failure text is preserved in error
 * (append-honest), and recording provider_message_id blocks admin resend of
 * an already-delivered email. Guarded on status='failed'; null when the row
 * is not failed anymore.
 */
export async function recordLateProviderSent(
  ctx: DbContext,
  emailLogId: string,
  providerMessageId: string,
): Promise<EmailLogEntry | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailLogEntry>(
      c,
      `update email_log
          set status = 'sent', provider_message_id = $2, sent_at = now(),
              error = coalesce(error, '') || ' [resolved: provider confirmed this send after the row was marked failed]'
        where id = $1 and status = 'failed' returning ${COLS}`,
      [emailLogId, providerMessageId],
    ),
  );
  return rows[0] ?? null;
}

/** Mark sent with the provider's message id. */
export async function markSent(ctx: DbContext, emailLogId: string, providerMessageId: string): Promise<EmailLogEntry> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailLogEntry>(
      c,
      `update email_log set status = 'sent', provider_message_id = $2, sent_at = now()
        where id = $1 returning ${COLS}`,
      [emailLogId, providerMessageId],
    ),
  );
  const entry = rows[0];
  if (!entry) throw new Error(`emailLog.markSent: entry not found: ${emailLogId}`);
  return entry;
}

/** Mark failed with the provider or configuration error. */
export async function markFailed(ctx: DbContext, emailLogId: string, error: string): Promise<EmailLogEntry> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailLogEntry>(
      c,
      `update email_log set status = 'failed', error = $2 where id = $1 returning ${COLS}`,
      [emailLogId, error],
    ),
  );
  const entry = rows[0];
  if (!entry) throw new Error(`emailLog.markFailed: entry not found: ${emailLogId}`);
  return entry;
}

/**
 * Guarded failure mark for the stranded-email sweep: sets failed ONLY while
 * the row is still in the expected pre-terminal status. Returns null (no rows
 * affected) when the row was concurrently resolved — e.g. an in-flight
 * dispatch recorded 'sent' between the sweep's selection and this update.
 * Without the guard the sweep could overwrite a completed delivery as failed
 * and enable a manual resend of an already-delivered email.
 */
export async function markFailedIfStatus(
  ctx: DbContext,
  emailLogId: string,
  error: string,
  expectedStatus: "queued" | "sending",
): Promise<EmailLogEntry | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailLogEntry>(
      c,
      `update email_log set status = 'failed', error = $2 where id = $1 and status = $3 returning ${COLS}`,
      [emailLogId, error, expectedStatus],
    ),
  );
  return rows[0] ?? null;
}

export type EmailLogFilters = {
  status?: EmailStatus;
  templateKey?: string;
  toEmail?: string;
  /** ADMIN-06 §5: case-insensitive substring on the recipient. */
  toEmailContains?: string;
  /** Inclusive date bounds on created_at (UTC dates). */
  createdFrom?: string;
  createdTo?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
};

/** Filterable log listing, newest first (ADMIN-06). */
export async function listWithFilters(ctx: DbContext, filters: EmailLogFilters = {}): Promise<EmailLogEntry[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.templateKey) {
    params.push(filters.templateKey);
    where.push(`template_key = $${params.length}`);
  }
  if (filters.toEmail) {
    params.push(filters.toEmail);
    where.push(`lower(to_email) = lower($${params.length})`);
  }
  if (filters.toEmailContains) {
    // position() rather than ilike: the operator's text is a literal, not a
    // pattern — % and _ in it must not act as wildcards.
    params.push(filters.toEmailContains);
    where.push(`position(lower($${params.length}) in lower(to_email)) > 0`);
  }
  if (filters.createdFrom) {
    params.push(filters.createdFrom);
    where.push(`(created_at at time zone 'America/Los_Angeles')::date >= $${params.length}::date`);
  }
  if (filters.createdTo) {
    params.push(filters.createdTo);
    where.push(`(created_at at time zone 'America/Los_Angeles')::date <= $${params.length}::date`);
  }
  if (filters.entityType) {
    params.push(filters.entityType);
    where.push(`entity_type = $${params.length}`);
  }
  if (filters.entityId) {
    params.push(filters.entityId);
    where.push(`entity_id = $${params.length}`);
  }
  params.push(Math.min(filters.limit ?? 100, 500));
  const limitParam = `$${params.length}`;
  params.push(filters.offset ?? 0);
  const offsetParam = `$${params.length}`;
  const whereSql = where.length > 0 ? `where ${where.join(" and ")}` : "";
  return withDbContext(ctx, (c) =>
    q<EmailLogEntry>(
      c,
      `select ${COLS} from email_log ${whereSql} order by created_at desc limit ${limitParam} offset ${offsetParam}`,
      params,
    ),
  );
}

/** One entry by id (ADMIN-06 detail). */
export async function getById(ctx: DbContext, emailLogId: string): Promise<EmailLogEntry | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailLogEntry>(c, `select ${COLS} from email_log where id = $1`, [emailLogId]),
  );
  return rows[0] ?? null;
}

/**
 * The prior non-failed row the once-only index would collide with (D24):
 * checked BEFORE a resend insert so the operator reads "already delivered
 * on {date}" instead of a constraint violation. Matches email_log_once_idx
 * exactly, including lower(to_email).
 */
export async function findDelivered(
  ctx: DbContext,
  input: { templateKey: string; entityType: string; entityId: string; toEmail: string },
): Promise<EmailLogEntry | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailLogEntry>(
      c,
      `select ${COLS} from email_log
        where template_key = $1 and entity_type = $2 and entity_id = $3
          and lower(to_email) = lower($4) and status not in ('failed', 'skipped')
        order by created_at desc limit 1`,
      [input.templateKey, input.entityType, input.entityId, input.toEmail],
    ),
  );
  return rows[0] ?? null;
}

/** Failure count over the trailing 7 days (ADMIN-06 health strip). */
export async function countFailuresLastSevenDays(ctx: DbContext): Promise<number> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ count: string }>(
      c,
      `select count(*)::text as count from email_log where status = 'failed' and created_at > now() - interval '7 days'`,
    ),
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Null out to_person_id for a person about to be deleted, keeping the log
 * rows themselves (they are send history, not person data). Seed-migration
 * support (legacy synthetic staff_admin removal). Returns rows changed.
 */
export async function detachPerson(ctx: DbContext, personId: string): Promise<number> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `update email_log set to_person_id = null where to_person_id = $1 returning id`, [personId]),
  );
  return rows.length;
}
