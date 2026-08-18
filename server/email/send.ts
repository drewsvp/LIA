/**
 * The single email send path. Discipline (replit.md rule 5, Handbook §13):
 *   1. Write the email_log row BEFORE dispatch.
 *   2. The once-only index turns entity-bound repeats into { duplicate } —
 *      a readable outcome, not a constraint error (D24).
 *   3. Failures are recorded on the row and surfaced loudly. No silent
 *      fallbacks: a missing key or provider error must be visible.
 *   4. Product emails never block a user-facing response: queue the row in
 *      the request's DB context (queueProductEmail), respond, then dispatch
 *      (dispatchQueuedEmails). Only the twelve TEMPLATES.md templates go
 *      through the product path; the auth magic link uses sendEmail directly.
 *   5. Every variable must resolve before a product send. An empty required
 *      value or a leftover literal placeholder blocks the send and records
 *      the row failed with the reason.
 *
 * Provider: Postmark. From-address and display name come from environment
 * variables (EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME) — never hardcoded. Links
 * are absolute, built from APP_BASE_URL (required in production; the Replit
 * dev domain is the workspace fallback).
 */
import { ServerClient } from "postmark";
import type { PoolClient } from "pg";
import { SYSTEM, type DbContext } from "../db/client";
import * as emailLog from "../dal/email-log";
import { PRODUCT_TEMPLATES, type ProductTemplateKey } from "./templates";
import { finalizeHtml } from "./render";
import type { ProductEntityType } from "./templates/types";
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

/** From-header built from env. Throws EmailConfigError when unset — loudly. */
function fromHeader(): string {
  const address = process.env.EMAIL_FROM_ADDRESS;
  const name = process.env.EMAIL_FROM_NAME;
  if (!address) throw new EmailConfigError("EMAIL_FROM_ADDRESS is not set");
  if (!name) throw new EmailConfigError("EMAIL_FROM_NAME is not set");
  return `${name} <${address}>`;
}

/**
 * Base URL for absolute links in email bodies. APP_BASE_URL wins when set;
 * production REQUIRES it (a link pointing at a dev domain in a real inbox is
 * worse than a loudly failed send). The workspace dev domain is the
 * development fallback, mirroring appBaseUrl in server/auth/auth.ts —
 * duplicated here because auth.ts imports this module.
 */
export function emailBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit && explicit.trim() !== "") return explicit.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new EmailConfigError("APP_BASE_URL is not set — email links cannot be built in production");
  }
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain && devDomain.trim() !== "") return `https://${devDomain.trim()}`;
  return "http://localhost:5000";
}

/**
 * The LIA email header banner, served from the app itself (client/public/ in
 * dev via Vite, the built dist/ in production). Email clients fetch it from
 * the same base URL every body link already uses.
 */
export const EMAIL_HEADER_PATH = "/email-header.png";

/** Absolute URL for an app path ("/admin/requests" → "https://…/admin/requests"). */
export function absoluteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${emailBaseUrl()}${normalized}`;
}

/* ------------------------------------------------------------------ */
/* Provider dispatch — the ONE Postmark call site.                     */
/* ------------------------------------------------------------------ */

/**
 * Marker embedded in the error text of rows whose provider outcome is
 * unknown (mid-send crash or provider timeout). The admin resend path
 * refuses rows carrying it — resending could duplicate a delivered email.
 */
export const MAY_HAVE_SENT_MARKER = "the provider MAY have sent this email";

/**
 * Bound on the provider call, deliberately far below the stranded-sweep
 * threshold (5 minutes): no live dispatch can still be in flight when the
 * sweep classifies its row as stranded, so a stale 'sending' row genuinely
 * means the process died mid-send.
 */
const PROVIDER_TIMEOUT_MS = 60_000;

export type PendingDispatch = {
  emailLogId: string;
  toEmail: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type DispatchOutcome =
  | { emailLogId: string; outcome: "sent"; providerMessageId: string }
  | { emailLogId: string; outcome: "failed"; kind: "config" | "provider"; error: string }
  /** Row was not 'queued' anymore — another dispatcher claimed it. Not an error; never a provider call. */
  | { emailLogId: string; outcome: "skipped"; reason: string };

/**
 * Dispatch one already-queued row. Never throws: the outcome is recorded on
 * the email_log row (sent + provider id, or failed + reason) and returned.
 * Runs AFTER the caller's response/commit — uses the SYSTEM context.
 */
export async function dispatchQueuedEmail(d: PendingDispatch): Promise<DispatchOutcome> {
  let from: string;
  const serverToken = process.env.POSTMARK_SERVER_TOKEN;
  try {
    from = fromHeader();
    if (!serverToken) throw new EmailConfigError("POSTMARK_SERVER_TOKEN is not set");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emailLog.markFailed(SYSTEM, d.emailLogId, message);
    return { emailLogId: d.emailLogId, outcome: "failed", kind: "config", error: message };
  }

  // Dispatch claim (task: no email silently lost on a mid-send crash).
  // Atomically move queued → sending BEFORE the provider call. If the claim
  // fails the row is not ours (already claimed/sent/failed) — skip, never
  // double-send. A row later found stranded in 'sending' means the process
  // stopped after this point: the startup sweep marks it failed loudly
  // instead of retrying, because the provider may already have sent.
  const claimed = await emailLog.claimForDispatch(SYSTEM, d.emailLogId);
  if (!claimed) {
    const reason = "row is no longer 'queued' — already claimed, sent, or failed elsewhere";
    console.warn(`[email] dispatch skipped (${d.emailLogId} → ${d.toEmail}): ${reason}`);
    return { emailLogId: d.emailLogId, outcome: "skipped", reason };
  }

  // Review fix: a thrown send (network/SDK failure, as opposed to an error
  // RESPONSE) previously escaped to the batch double-fault handler without
  // marking the row, leaving it 'queued' forever. Catch it here so every
  // outcome lands on the email_log row.
  try {
    const postmarkClient = new ServerClient(serverToken);
    const sendPromise = postmarkClient.sendEmail({
      From: from,
      To: d.toEmail,
      Subject: d.subject,
      HtmlBody: d.html,
      ...(d.text ? { TextBody: d.text } : {}),
      ...(d.replyTo ? { ReplyTo: d.replyTo } : {}),
    });

    // Bounded provider call: past PROVIDER_TIMEOUT_MS the outcome is treated
    // as unknown. The row is failed (guarded) with the may-have-sent marker,
    // which blocks admin resend; if the call later resolves successfully the
    // late-completion handler below records the truth on the row.
    let timer: NodeJS.Timeout | undefined;
    const timedOut = Symbol("timeout");
    const raced = await Promise.race([
      sendPromise,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), PROVIDER_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (raced === timedOut) {
      const message = `provider call exceeded ${PROVIDER_TIMEOUT_MS / 1000}s with no response; outcome unknown — ${MAY_HAVE_SENT_MARKER}. Verify with the provider before resending.`;
      await emailLog.markFailedIfStatus(SYSTEM, d.emailLogId, message, "sending");
      console.error(`[email] provider timeout (${d.emailLogId} → ${d.toEmail}): ${message}`);
      // Late-completion handler: if the original call eventually confirms a
      // send, record it loudly — the row flips to sent with the provider id,
      // making the delivered email visible and un-resendable.
      void sendPromise
        .then(async (response) => {
          const updated = await emailLog.recordLateProviderSent(SYSTEM, d.emailLogId, response.MessageID);
          console.error(
            `[email] LATE provider completion (${d.emailLogId} → ${d.toEmail}): provider confirmed send ${response.MessageID}${updated ? "; row updated to sent" : "; row was no longer failed — NOT overwritten, investigate"}`,
          );
        })
        .catch((err) => {
          console.error(`[email] late provider completion (${d.emailLogId} → ${d.toEmail}): call ultimately failed:`, err);
        });
      return { emailLogId: d.emailLogId, outcome: "failed", kind: "provider", error: message };
    }

    // Guarded completion: only while this dispatch still owns the claim.
    const marked = await emailLog.markSentIfSending(SYSTEM, d.emailLogId, raced.MessageID);
    if (!marked) {
      // The row was resolved concurrently (should be impossible with the
      // 60s bound vs the 5m sweep threshold). The provider DID send: record
      // it as a late completion rather than overwriting blindly.
      const late = await emailLog.recordLateProviderSent(SYSTEM, d.emailLogId, raced.MessageID);
      console.error(
        `[email] completion raced (${d.emailLogId} → ${d.toEmail}): row was not 'sending' at completion; ${late ? "late-recorded as sent" : "row not failed either — NOT overwritten, investigate"}`,
      );
    }
    return { emailLogId: d.emailLogId, outcome: "sent", providerMessageId: raced.MessageID };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emailLog.markFailedIfStatus(SYSTEM, d.emailLogId, message, "sending");
    return { emailLogId: d.emailLogId, outcome: "failed", kind: "provider", error: message };
  }
}

/**
 * Dispatch a batch after the response has gone out. Never throws and never
 * blocks the caller; every failure is recorded on its row and logged to the
 * console so it is visible in workflow logs as well as ADMIN-06.
 */
export async function dispatchQueuedEmails(pending: PendingDispatch[]): Promise<DispatchOutcome[]> {
  const outcomes: DispatchOutcome[] = [];
  for (const d of pending) {
    try {
      const outcome = await dispatchQueuedEmail(d);
      if (outcome.outcome === "failed") {
        console.error(`[email] dispatch failed (${d.emailLogId} → ${d.toEmail}): ${outcome.error}`);
      }
      outcomes.push(outcome);
    } catch (err) {
      // Double fault (e.g. the markFailed update itself failed). Loud, never silent.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[email] dispatch double-fault (${d.emailLogId} → ${d.toEmail}): ${message}`);
      outcomes.push({ emailLogId: d.emailLogId, outcome: "failed", kind: "provider", error: message });
    }
  }
  return outcomes;
}

/* ------------------------------------------------------------------ */
/* Direct send — auth magic link only (repeatable, no entity binding). */
/* ------------------------------------------------------------------ */

export type SendEmailInput = {
  /** Template key recorded in email_log (docs/email/TEMPLATES.md registry). */
  templateKey: string;
  toEmail: string;
  toPersonId?: string | null;
  /** Entity binding for once-only sends; null entity = repeatable (e.g. login links). */
  entityType?: string | null;
  entityId?: string | null;
  /** Variables snapshot recorded in the log row. */
  payload?: Record<string, unknown>;
  subject: string;
  html: string;
  text?: string;
};

export type SendEmailResult =
  | { outcome: "sent"; emailLogId: string; providerMessageId: string }
  | { outcome: "duplicate" };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // 1. Log row first — before any dispatch attempt.
  const queued = await emailLog.insertQueued(SYSTEM, {
    templateKey: input.templateKey,
    toEmail: input.toEmail,
    toPersonId: input.toPersonId ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    payload: input.payload ?? {},
  });
  if (queued.duplicate) return { outcome: "duplicate" };
  const entry = queued.entry;

  // 2. Dispatch through the shared provider path; preserve throwing behavior.
  const outcome = await dispatchQueuedEmail({
    emailLogId: entry.id,
    toEmail: input.toEmail,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (outcome.outcome === "failed") {
    if (outcome.kind === "config") throw new EmailConfigError(outcome.error);
    throw new EmailSendError(outcome.error);
  }
  if (outcome.outcome === "skipped") {
    // Impossible for a row inserted in this same call — loud, not silent.
    throw new EmailSendError(`dispatch claim failed on a fresh row: ${outcome.reason}`);
  }
  return { outcome: "sent", emailLogId: entry.id, providerMessageId: outcome.providerMessageId };
}

/* ------------------------------------------------------------------ */
/* Product emails — the twelve TEMPLATES.md templates.                 */
/* ------------------------------------------------------------------ */

export type QueueProductEmailInput = {
  key: ProductTemplateKey;
  /** Entity the once-only index binds to (the pledge, the request, the org…). */
  entityId: string;
  /**
   * Override for the two templates shared by item and volunteer requests
   * (org_request_received / org_request_approved).
   */
  entityType?: ProductEntityType;
  toEmail: string;
  toPersonId?: string | null;
  replyTo?: string;
  vars: Record<string, unknown>;
};

export type QueueProductEmailResult =
  | { outcome: "queued"; dispatch: PendingDispatch }
  | { outcome: "duplicate" }
  | { outcome: "blocked"; emailLogId: string; reason: string };

/** A required variable is unresolved when null/empty (string, array, or list object). */
function unresolvedVariables(required: readonly string[], vars: Record<string, unknown>): string[] {
  const bad: string[] = [];
  for (const name of required) {
    const value = vars[name];
    if (value == null) {
      bad.push(name);
    } else if (typeof value === "string") {
      if (value.trim() === "") bad.push(name);
    } else if (Array.isArray(value)) {
      if (value.length === 0) bad.push(name);
    } else if (typeof value === "object") {
      const rows = (value as { rows?: unknown }).rows;
      if (!Array.isArray(rows) || rows.length === 0) bad.push(name);
    }
  }
  return bad;
}

/** Leftover literal placeholders ({varName}) in rendered output block the send. */
function leftoverPlaceholders(vars: Record<string, unknown>, rendered: { subject: string; html: string; text: string }): string[] {
  const found: string[] = [];
  for (const name of Object.keys(vars)) {
    const token = `{${name}}`;
    if (rendered.subject.includes(token) || rendered.html.includes(token) || rendered.text.includes(token)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Queue one product email inside the caller's DB context: the email_log row
 * is written at 'queued' BEFORE the response goes out; the caller dispatches
 * the returned PendingDispatch after responding (dispatchQueuedEmails).
 *
 * Variable resolution happens here, before anything can go out: a missing
 * required value, a render error, or a leftover literal placeholder marks
 * the row failed with the reason and returns { outcome: "blocked" }.
 */
/**
 * Transaction-composable product-email queue (MP-03 §3: the staff email_log
 * rows belong inside the signup transaction). Render-FIRST: an unresolved
 * required variable, a render error, or a leftover literal placeholder throws
 * and aborts the caller's transaction — for signup, a committed organization
 * with no staff notification row would be exactly the silent failure this
 * system refuses to allow. Returns the PendingDispatch to send after commit
 * (dispatchQueuedEmails). No duplicate handling: the caller binds to an
 * entity it created in this same transaction.
 */
export async function queueProductEmailInTx(c: PoolClient, input: QueueProductEmailInput): Promise<PendingDispatch> {
  const template = PRODUCT_TEMPLATES[input.key];
  const entityType = input.entityType ?? template.entityType;

  const missing = unresolvedVariables(template.required, input.vars);
  if (missing.length > 0) {
    throw new EmailConfigError(`${template.key}: unresolved variable(s): ${missing.join(", ")}`);
  }
  const rendered = template.render(input.vars as never);
  const leftovers = leftoverPlaceholders(input.vars, rendered);
  if (leftovers.length > 0) {
    throw new EmailConfigError(`${template.key}: literal placeholder(s) left in rendered output: ${leftovers.join(", ")}`);
  }
  // LIA header banner: swap the shell() slot for the absolute image URL.
  // Throws (aborting the caller's transaction) if the slot is missing.
  const html = finalizeHtml(rendered.html, absoluteUrl(EMAIL_HEADER_PATH));

  const entry = await emailLog.insertQueuedInTx(c, {
    templateKey: template.key,
    toEmail: input.toEmail,
    toPersonId: input.toPersonId ?? null,
    entityType,
    entityId: input.entityId,
    payload: { vars: input.vars, ...(input.replyTo ? { replyTo: input.replyTo } : {}) },
  });
  return {
    emailLogId: entry.id,
    toEmail: input.toEmail,
    subject: rendered.subject,
    html,
    text: rendered.text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}

export async function queueProductEmail(ctx: DbContext, input: QueueProductEmailInput): Promise<QueueProductEmailResult> {
  const template = PRODUCT_TEMPLATES[input.key];
  const entityType = input.entityType ?? template.entityType;

  const queued = await emailLog.insertQueued(ctx, {
    templateKey: template.key,
    toEmail: input.toEmail,
    toPersonId: input.toPersonId ?? null,
    entityType,
    entityId: input.entityId,
    payload: { vars: input.vars, ...(input.replyTo ? { replyTo: input.replyTo } : {}) },
  });
  if (queued.duplicate) return { outcome: "duplicate" };
  const entry = queued.entry;

  const block = async (reason: string): Promise<QueueProductEmailResult> => {
    await emailLog.markFailed(ctx, entry.id, reason);
    console.error(`[email] send blocked (${template.key} → ${input.toEmail}): ${reason}`);
    return { outcome: "blocked", emailLogId: entry.id, reason };
  };

  const missing = unresolvedVariables(template.required, input.vars);
  if (missing.length > 0) {
    return block(`unresolved variable(s): ${missing.join(", ")}`);
  }

  let rendered: { subject: string; html: string; text: string };
  try {
    rendered = template.render(input.vars as never);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return block(`template render failed: ${message}`);
  }

  const leftovers = leftoverPlaceholders(input.vars, rendered);
  if (leftovers.length > 0) {
    return block(`literal placeholder(s) left in rendered output: ${leftovers.join(", ")}`);
  }

  // LIA header banner: swap the shell() slot for the absolute image URL.
  let html: string;
  try {
    html = finalizeHtml(rendered.html, absoluteUrl(EMAIL_HEADER_PATH));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return block(`header image injection failed: ${message}`);
  }

  return {
    outcome: "queued",
    dispatch: {
      emailLogId: entry.id,
      toEmail: input.toEmail,
      subject: rendered.subject,
      html,
      text: rendered.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    },
  };
}
