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
 *      through the product path; the auth magic link and staff-composed,
 *      explicitly confirmed request outreach use sendEmail directly.
 *   5. Every variable must resolve before a product send. An empty required
 *      value or a leftover literal placeholder blocks the send and records
 *      the row failed with the reason.
 *
 * Provider: Postmark. From-address and display name come from environment
 * variables (EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME) — never hardcoded. Links
 * are absolute, built from APP_BASE_URL (required in production; the Replit
 * dev domain is the workspace fallback).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { ServerClient } from "postmark";
import type { PoolClient } from "pg";
import { SYSTEM, type DbContext } from "../db/client";
import * as emailLog from "../dal/email-log";
import * as dal from "../dal";
import { PRODUCT_TEMPLATES, type ProductTemplateKey } from "./templates";
import { finalizeHtml, brandTokenVars, getBrand } from "./render";
import { effectiveCopy } from "./overrides";
import type { ProductEntityType } from "./templates/types";
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

/* ------------------------------------------------------------------ */
/* Header image — loaded once at startup, embedded in every send.      */
/* ------------------------------------------------------------------ */

/**
 * Load the LIA header banner from disk. Tries the production build path
 * first (dist/public/), falls back to the dev source (client/public/).
 * Throws loudly at startup if neither exists — a missing logo is a
 * misconfiguration, not a runtime option.
 */
function loadHeaderImage(): { base64: string; dataUri: string } {
  const candidates = [
    join(process.cwd(), "dist", "public", "email-header.png"),
    join(process.cwd(), "client", "public", "email-header.png"),
  ];
  for (const p of candidates) {
    try {
      const buf = readFileSync(p);
      const base64 = buf.toString("base64");
      return { base64, dataUri: `data:image/png;base64,${base64}` };
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `email-header.png not found at ${candidates.join(" or ")} — check build output`,
  );
}

const _headerImage = loadHeaderImage();

// Warm up brand settings from DB at startup so the first send uses saved
// values. Safe to fail: render.ts _brand defaults match the DB defaults.
void dal.emailBrandSettings.refreshBrandCache(SYSTEM).catch((err) =>
  console.warn("[email] brand settings warmup failed (using defaults):", err),
);

/**
 * CID src value used in outbound email HTML when the header is sent as an
 * inline attachment. Mail clients fetch the image from the message itself,
 * so the app never needs to be publicly reachable for the logo to render.
 */
export const EMAIL_HEADER_CID_URL = "cid:lia-email-header";

/**
 * Base64 data URI for use in browser-rendered admin previews. Browsers
 * handle data URIs fine; mail clients do not, so real sends use CID instead.
 * When a brand header_image_url is configured, returns that URL directly so
 * the preview renders the new logo without a round-trip encode.
 */
export function headerImageDataUri(): string {
  const url = getBrand().headerImageUrl;
  return url && url.trim() !== "" ? url : _headerImage.dataUri;
}

/**
 * Postmark inline-attachment descriptor that pairs with EMAIL_HEADER_CID_URL.
 * Include this in every real send so the logo is embedded in the message.
 * When brand.headerImageUrl is set, fetches and encodes that URL; falls back
 * to the disk PNG if the fetch fails.
 */
export const EMAIL_HEADER_ATTACHMENT = {
  Name: "email-header.png",
  Content: _headerImage.base64,
  ContentType: "image/png",
  ContentID: EMAIL_HEADER_CID_URL,
} as const;

/** In-process cache for the brand-configured header image URL. */
let _urlHeaderCache: { url: string; base64: string } | null = null;

const MAX_HEADER_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
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
 * App-relative path for the LIA header banner (used only for routing, not for
 * email image embedding — real sends use EMAIL_HEADER_CID_URL + EMAIL_HEADER_ATTACHMENT;
 * previews use headerImageDataUri()).
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
 * Re-exported from email-log so callers do not need to import from both modules.
 */
export const MAY_HAVE_SENT_MARKER = emailLog.MAY_HAVE_SENT_MARKER;

/**
 * Bound on the provider call, deliberately far below the stranded-sweep
 * threshold (5 minutes): no live dispatch can still be in flight when the
 * sweep classifies its row as stranded, so a stale 'sending' row genuinely
 * means the process died mid-send.
 */
const PROVIDER_TIMEOUT_MS = 60_000;

export type EmailInlineAttachment = {
  Name: string;
  Content: string;
  ContentType: string;
  ContentID: string;
};

export type PendingDispatch = {
  emailLogId: string;
  toEmail: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** CID-referenced inline attachments (e.g. header logo). */
  attachments?: readonly EmailInlineAttachment[];
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
    await emailLog.markFailed(SYSTEM, d.emailLogId, message, "config");
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
      // CID-referenced inline attachments (header logo and any others). Postmark
      // embeds them inside the message so mail clients never need to fetch from the app.
      ...(d.attachments?.length ? { Attachments: d.attachments as EmailInlineAttachment[] } : {}),
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
      await emailLog.markFailedIfStatus(SYSTEM, d.emailLogId, message, "sending", "provider_timeout");
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
    await emailLog.markFailedIfStatus(SYSTEM, d.emailLogId, message, "sending", "provider");
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
/* Direct send — auth magic link or confirmed staff-composed outreach. */
/* Auth is repeatable; outreach binds request + recipient for once-only use. */
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
  /** CID-referenced inline attachments forwarded to the provider. */
  attachments?: readonly EmailInlineAttachment[];
  /** Request outreach uses stable person identity, not mutable email, as its once-only boundary. */
  oncePerPerson?: boolean;
};

export type SendEmailResult =
  | { outcome: "sent"; emailLogId: string; providerMessageId: string }
  | { outcome: "duplicate" };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // 1. Log row first — before any dispatch attempt.
  const insertQueued = input.oncePerPerson
    ? emailLog.insertQueuedOnceByPerson
    : emailLog.insertQueued;
  const queued = await insertQueued(SYSTEM, {
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
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
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
  /** When this is a resend attempt, the id of the original failed row — links the chain. */
  resendOfId?: string | null;
};

export type QueueProductEmailResult =
  | { outcome: "queued"; dispatch: PendingDispatch }
  | { outcome: "duplicate" }
  | { outcome: "blocked"; emailLogId: string; reason: string }
  /** Template disabled by a staff admin (ADMIN-10): a visible skipped row, never a silent drop. */
  | { outcome: "skipped_disabled"; emailLogId: string };

/**
 * A required variable is unresolved when null/empty (string, array, or list
 * object). Exported so the preview endpoint can apply the same gate before
 * re-rendering a stored vars snapshot.
 */
export function unresolvedVariables(required: readonly string[], vars: Record<string, unknown>): string[] {
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

/**
 * Leftover literal placeholders ({varName}) in rendered output block the send.
 * Exported so the preview endpoint can apply the same gate after rendering.
 */
export function leftoverPlaceholders(vars: Record<string, unknown>, rendered: { subject: string; html: string; text: string }): string[] {
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
 * Transaction-composable product-email queue (MP-03 §3: the staff email_log
 * rows belong inside the signup transaction). Render-FIRST: an unresolved
 * required variable, a render error, or a leftover literal placeholder throws
 * and aborts the caller's transaction — for signup, a committed organization
 * with no staff notification row would be exactly the silent failure this
 * system refuses to allow. Returns the PendingDispatch to send after commit
 * (dispatchQueuedEmails). No duplicate handling: the caller binds to an
 * entity it created in this same transaction.
 */
export async function queueProductEmailInTx(c: PoolClient, input: QueueProductEmailInput): Promise<PendingDispatch | null> {
  const template = PRODUCT_TEMPLATES[input.key];
  const entityType = input.entityType ?? template.entityType;

  // ADMIN-10 override: disabled templates write a visible skipped row and
  // send nothing; a copy override replaces the hardcoded copy for this render.
  const override = await dal.emailTemplateOverrides.getOverrideInTx(c, input.key);
  if (override && !override.enabled) {
    const entry = await emailLog.insertSkippedInTx(c, {
      templateKey: template.key,
      toEmail: input.toEmail,
      toPersonId: input.toPersonId ?? null,
      entityType,
      entityId: input.entityId,
      payload: { vars: input.vars },
      resendOfId: input.resendOfId ?? null,
    });
    console.warn(`[email] send skipped (${template.key} → ${input.toEmail}): template disabled by staff (row ${entry.id})`);
    return null;
  }

  const missing = unresolvedVariables(template.required, input.vars);
  if (missing.length > 0) {
    throw new EmailConfigError(`${template.key}: unresolved variable(s): ${missing.join(", ")}`);
  }
  // Inject brand tokens ({orgName}, {programName}, etc.) before rendering.
  // Template-specific vars take priority over brand tokens if names collide.
  const allVars = { ...brandTokenVars(), ...input.vars } as Record<string, unknown>;
  let rendered: ReturnType<typeof template.render>;
  try {
    rendered = template.render(allVars as never, effectiveCopy(input.key, override));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EmailConfigError(`${template.key}: render failed: ${msg}`);
  }
  const leftovers = leftoverPlaceholders(allVars, rendered);
  if (leftovers.length > 0) {
    throw new EmailConfigError(`${template.key}: literal placeholder(s) left in rendered output: ${leftovers.join(", ")}`);
  }
  // LIA header banner: embed via CID so mail clients never need to fetch
  // from the app's origin. Throws (aborting the caller's transaction) if
  // the shell() slot marker is missing from the rendered HTML.
  const html = finalizeHtml(rendered.html, EMAIL_HEADER_CID_URL);

  const entry = await emailLog.insertQueuedInTx(c, {
    templateKey: template.key,
    toEmail: input.toEmail,
    toPersonId: input.toPersonId ?? null,
    entityType,
    entityId: input.entityId,
    payload: { vars: input.vars, ...(input.replyTo ? { replyTo: input.replyTo } : {}) },
  });
  const headerAttachment = await getEmailHeaderAttachment();
  return {
    emailLogId: entry.id,
    toEmail: input.toEmail,
    subject: rendered.subject,
    html,
    text: rendered.text,
    attachments: [headerAttachment],
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}

/** Collect a queueProductEmailInTx result, dropping the null of a skipped (disabled) send. */
export function pushDispatch(list: PendingDispatch[], d: PendingDispatch | null): void {
  if (d) list.push(d);
}

export async function queueProductEmail(ctx: DbContext, input: QueueProductEmailInput): Promise<QueueProductEmailResult> {
  const template = PRODUCT_TEMPLATES[input.key];
  const entityType = input.entityType ?? template.entityType;

  // ADMIN-10 override: disabled templates write a visible skipped row.
  const override = await dal.emailTemplateOverrides.getOverride(ctx, input.key);
  if (override && !override.enabled) {
    const entry = await emailLog.insertSkipped(ctx, {
      templateKey: template.key,
      toEmail: input.toEmail,
      toPersonId: input.toPersonId ?? null,
      entityType,
      entityId: input.entityId,
      payload: { vars: input.vars },
      resendOfId: input.resendOfId ?? null,
    });
    console.warn(`[email] send skipped (${template.key} → ${input.toEmail}): template disabled by staff (row ${entry.id})`);
    return { outcome: "skipped_disabled", emailLogId: entry.id };
  }

  const queued = await emailLog.insertQueued(ctx, {
    templateKey: template.key,
    toEmail: input.toEmail,
    toPersonId: input.toPersonId ?? null,
    entityType,
    entityId: input.entityId,
    payload: { vars: input.vars, ...(input.replyTo ? { replyTo: input.replyTo } : {}) },
    resendOfId: input.resendOfId ?? null,
  });
  if (queued.duplicate) return { outcome: "duplicate" };
  const entry = queued.entry;

  const block = async (reason: string, category: "config" | "render" = "render"): Promise<QueueProductEmailResult> => {
    await emailLog.markFailed(ctx, entry.id, reason, category);
    console.error(`[email] send blocked (${template.key} → ${input.toEmail}): ${reason}`);
    return { outcome: "blocked", emailLogId: entry.id, reason };
  };

  const missing = unresolvedVariables(template.required, input.vars);
  if (missing.length > 0) {
    return block(`unresolved variable(s): ${missing.join(", ")}`);
  }

  // Inject brand tokens before rendering; template vars take priority.
  const allVars = { ...brandTokenVars(), ...input.vars } as Record<string, unknown>;

  let rendered: { subject: string; html: string; text: string };
  try {
    rendered = template.render(allVars as never, effectiveCopy(input.key, override));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return block(`template render failed: ${message}`);
  }

  const leftovers = leftoverPlaceholders(allVars, rendered);
  if (leftovers.length > 0) {
    return block(`literal placeholder(s) left in rendered output: ${leftovers.join(", ")}`);
  }

  // LIA header banner: embed via CID so mail clients never need to fetch
  // from the app's origin.
  let html: string;
  try {
    html = finalizeHtml(rendered.html, EMAIL_HEADER_CID_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return block(`header image injection failed: ${message}`);
  }

  const headerAttachment = await getEmailHeaderAttachment();
  return {
    outcome: "queued",
    dispatch: {
      emailLogId: entry.id,
      toEmail: input.toEmail,
      subject: rendered.subject,
      html,
      text: rendered.text,
      attachments: [headerAttachment],
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    },
  };
}

/**
 * Resolve the CID attachment to use for a real send. If brand.headerImageUrl
 * is set, fetches (with SSRF-safe validation and cache) and encodes it;
 * falls back to the disk PNG when no URL is configured or the fetch fails.
 * Exported so every send path (product queue, magic-link, sweep, outreach)
 * picks up the brand logo without duplicating logic.
 */
export async function getEmailHeaderAttachment(): Promise<EmailInlineAttachment> {
  const brandUrl = getBrand().headerImageUrl;
  if (!brandUrl || brandUrl.trim() === "") {
    return { Name: "email-header.png", Content: _headerImage.base64, ContentType: "image/png", ContentID: EMAIL_HEADER_CID_URL };
  }
  if (_urlHeaderCache?.url === brandUrl) {
    return { Name: "email-header.png", Content: _urlHeaderCache.base64, ContentType: "image/png", ContentID: EMAIL_HEADER_CID_URL };
  }
  try {
    const base64 = await fetchSafeHeaderImage(brandUrl);
    _urlHeaderCache = { url: brandUrl, base64 };
    return { Name: "email-header.png", Content: base64, ContentType: "image/png", ContentID: EMAIL_HEADER_CID_URL };
  } catch (err) {
    console.warn(`[email] brand header image fetch failed (${brandUrl}), falling back to disk PNG:`, err);
    return { Name: "email-header.png", Content: _headerImage.base64, ContentType: "image/png", ContentID: EMAIL_HEADER_CID_URL };
  }
}

/**
 * Returns true when the IP address (IPv4 dotted-quad or IPv6 string) belongs
 * to a private, loopback, link-local, or otherwise reserved range that must
 * not be reachable from the server. Used to prevent SSRF via brand image URLs.
 */
function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    // IPv6
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7)); // IPv4-mapped
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;         // 0.x, 10.x, loopback
  if (a === 169 && b === 254) return true;                    // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;          // RFC 1918
  if (a === 192 && b === 168) return true;                    // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true;         // RFC 6598 shared
  if (a >= 224) return true;                                  // multicast + reserved
  if (a === 192 && b === 0 && c === 2) return true;          // TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return true;        // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;         // TEST-NET-3
  return false;
}

/**
 * Validates that a brand header image URL is safe to fetch server-side.
 * Enforces HTTPS, blocks private/loopback/reserved IPs via DNS pre-resolution,
 * and rejects literal-IP addresses in the private ranges.
 * Throws a user-facing Error when the URL is unsafe.
 */
async function assertSafeImageUrl(urlStr: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(urlStr); } catch {
    throw new Error("Header image URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Header image URL must use HTTPS (not ${parsed.protocol}).`);
  }
  const hostname = parsed.hostname;
  // Reject bare IP literal addresses in private ranges.
  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^\[.+\]$/.test(hostname);
  if (isIpLiteral) {
    const raw = hostname.replace(/^\[|\]$/g, "");
    if (isPrivateIp(raw)) throw new Error("Header image URL must not point to a private or reserved IP address.");
  }
  // Resolve hostname and block any returned private IP.
  const { resolve4, resolve6 } = await import("node:dns/promises");
  const ips: string[] = [];
  await Promise.allSettled([
    resolve4(hostname).then((r) => ips.push(...r)),
    resolve6(hostname).then((r) => ips.push(...r)),
  ]);
  if (ips.length === 0) throw new Error(`Header image URL hostname "${hostname}" could not be resolved.`);
  for (const ip of ips) {
    if (isPrivateIp(ip)) throw new Error(`Header image URL resolves to a private/reserved IP address (${ip}).`);
  }
}

/**
 * Fetches a brand header image URL safely: HTTPS-only, no private IPs,
 * redirect destination must also be HTTPS, content-type must be image/*,
 * and response body is capped at MAX_HEADER_IMAGE_BYTES.
 * Returns base64-encoded image data. Throws on any violation.
 */
async function fetchSafeHeaderImage(url: string): Promise<string> {
  // Follow redirects manually so every hop is validated for SSRF safety.
  let currentUrl = url;
  let hopCount = 0;
  const MAX_REDIRECTS = 5;
  let response: Response;
  await assertSafeImageUrl(currentUrl);
  for (;;) {
    response = await fetch(currentUrl, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      if (++hopCount > MAX_REDIRECTS) throw new Error("Header image URL exceeded the maximum redirect depth (5).");
      const location = response.headers.get("location");
      if (!location) throw new Error("Header image URL redirect had no Location header.");
      const nextUrl = new URL(location, currentUrl).href;
      await assertSafeImageUrl(nextUrl); // full HTTPS + DNS/IP validation on every hop
      currentUrl = nextUrl;
      continue;
    }
    break;
  }
  if (!response.ok) throw new Error(`Header image URL returned HTTP ${response.status}.`);
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/")) {
    throw new Error(`Header image URL returned non-image content (${ct || "unknown type"}).`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Header image URL returned an empty body.");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.length;
    if (totalBytes > MAX_HEADER_IMAGE_BYTES) {
      void reader.cancel();
      throw new Error("Header image is too large (max 2 MB).");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return Buffer.from(merged).toString("base64");
}
