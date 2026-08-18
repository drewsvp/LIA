/**
 * Stranded-email sweep (task: a queued email must never be silently lost if
 * the app stops mid-send).
 *
 * Product emails are committed at status 'queued' inside the request
 * transaction and dispatched AFTER the response. If the process exits in
 * that window the row is stranded. This sweep runs at startup and then
 * periodically, finding rows still 'queued' or 'sending' older than a small
 * threshold and resolving each one LOUDLY:
 *
 *   * stranded 'queued'  — the dispatch claim was never taken, so the
 *     provider was never called. Product-template rows are re-rendered from
 *     the payload vars snapshot and re-dispatched (the claim inside
 *     dispatchQueuedEmail makes this race-safe). Rows that cannot be
 *     re-rendered (unknown template, missing vars — e.g. the time-sensitive
 *     auth magic link) are marked failed with the reason.
 *   * stranded 'sending' — the process stopped after the claim, i.e. during
 *     or after the provider call. The provider MAY have sent, so the sweep
 *     NEVER retries these: it marks them failed with an explicit
 *     "verify with provider before resending" message. No double send.
 *
 * Fixture rows (payload zz_fixture key) are excluded in the DAL query —
 * they are deliberate ADMIN-06 display fixtures, not stranded sends.
 * email_log stays append-honest: every outcome is recorded, nothing deleted.
 */
import * as emailLog from "../dal/email-log";
import { SYSTEM } from "../db/client";
import {
  dispatchQueuedEmail,
  MAY_HAVE_SENT_MARKER,
  EMAIL_HEADER_CID_URL,
  EMAIL_HEADER_ATTACHMENT,
  type PendingDispatch,
} from "../email/send";
import { finalizeHtml } from "../email/render";
import { PRODUCT_TEMPLATES, type ProductTemplateKey } from "../email/templates";

/** A row must be at least this old before the sweep touches it — a fresh
 *  queued row is normally dispatched within seconds of its commit. */
const STRANDED_AFTER_MINUTES = 5;
/** Periodic re-sweep. Startup covers crash recovery; this covers a dispatch
 *  that dies without a restart (e.g. an unawaited rejection). */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export type SweepSummary = { redispatched: number; failed: number; total: number };

function rebuildDispatch(entry: {
  id: string;
  templateKey: string;
  toEmail: string;
  payload: unknown;
}): PendingDispatch | { error: string } {
  const template = (PRODUCT_TEMPLATES as Record<string, (typeof PRODUCT_TEMPLATES)[ProductTemplateKey] | undefined>)[
    entry.templateKey
  ];
  if (!template) {
    return { error: `not a product template ('${entry.templateKey}') — cannot re-render for re-dispatch` };
  }
  const payload = (entry.payload ?? {}) as { vars?: Record<string, unknown>; replyTo?: string };
  if (!payload.vars || typeof payload.vars !== "object") {
    return { error: "payload has no vars snapshot — cannot re-render for re-dispatch" };
  }
  try {
    const rendered = template.render(payload.vars as never);
    // Inject the header banner via CID so the logo doesn't depend on the app
    // being publicly reachable — same approach as normal product sends.
    const html = finalizeHtml(rendered.html, EMAIL_HEADER_CID_URL);
    return {
      emailLogId: entry.id,
      toEmail: entry.toEmail,
      subject: rendered.subject,
      html,
      text: rendered.text,
      attachments: [EMAIL_HEADER_ATTACHMENT],
      ...(typeof payload.replyTo === "string" && payload.replyTo ? { replyTo: payload.replyTo } : {}),
    };
  } catch (err) {
    return { error: `re-render failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** One sweep pass. Never throws; every row it touches ends sent or failed, never silently dropped. */
export async function sweepStrandedEmails(): Promise<SweepSummary> {
  const summary: SweepSummary = { redispatched: 0, failed: 0, total: 0 };
  let stranded;
  try {
    stranded = await emailLog.listStranded(SYSTEM, STRANDED_AFTER_MINUTES);
  } catch (err) {
    console.error("[email-sweep] could not query stranded rows:", err);
    return summary;
  }
  if (stranded.length === 0) return summary;
  summary.total = stranded.length;
  console.warn(`[email-sweep] found ${stranded.length} stranded email_log row(s) older than ${STRANDED_AFTER_MINUTES}m`);

  for (const entry of stranded) {
    try {
      if (entry.status === "sending") {
        // Claim was taken, then the process stopped: the provider may have
        // sent. Never auto-retry — record loudly instead.
        const message = `dispatch interrupted after the provider claim (process stopped mid-send); ${MAY_HAVE_SENT_MARKER}. Not retried automatically to avoid a double send — verify with the provider before resending.`;
        // Guarded transition: only while still 'sending'. A slow in-flight
        // dispatch may have recorded 'sent' since selection — never overwrite.
        const marked = await emailLog.markFailedIfStatus(SYSTEM, entry.id, message, "sending");
        if (!marked) {
          console.warn(`[email-sweep] skip (${entry.id} → ${entry.toEmail}): resolved concurrently since selection`);
          continue;
        }
        console.error(`[email-sweep] marked failed, possible mid-send crash (${entry.id} → ${entry.toEmail}): ${message}`);
        summary.failed += 1;
        continue;
      }

      // status === 'queued': provider never called — safe to re-dispatch.
      const rebuilt = rebuildDispatch(entry);
      if ("error" in rebuilt) {
        const message = `stranded at 'queued' (dispatch never ran, likely a process stop after commit); ${rebuilt.error}`;
        // Guarded: only while still 'queued' — a concurrent dispatch may have claimed/resolved it.
        const marked = await emailLog.markFailedIfStatus(SYSTEM, entry.id, message, "queued");
        if (!marked) {
          console.warn(`[email-sweep] skip (${entry.id} → ${entry.toEmail}): resolved concurrently since selection`);
          continue;
        }
        console.error(`[email-sweep] marked failed, cannot re-dispatch (${entry.id} → ${entry.toEmail}): ${message}`);
        summary.failed += 1;
        continue;
      }
      const outcome = await dispatchQueuedEmail(rebuilt);
      if (outcome.outcome === "sent") {
        console.warn(`[email-sweep] re-dispatched stranded email (${entry.id} → ${entry.toEmail}): sent`);
        summary.redispatched += 1;
      } else if (outcome.outcome === "failed") {
        console.error(`[email-sweep] re-dispatch failed (${entry.id} → ${entry.toEmail}): ${outcome.error}`);
        summary.failed += 1;
      } else {
        console.warn(`[email-sweep] re-dispatch skipped (${entry.id} → ${entry.toEmail}): ${outcome.reason}`);
      }
    } catch (err) {
      // Double fault (e.g. markFailed itself failed). Loud, never silent.
      console.error(`[email-sweep] double-fault on row ${entry.id}:`, err);
    }
  }
  console.warn(
    `[email-sweep] pass complete: ${summary.redispatched} re-dispatched, ${summary.failed} marked failed, of ${summary.total} stranded`,
  );
  return summary;
}

/** Startup sweep plus a periodic re-sweep. Mirrors startExpiryScheduler: in-memory state, unref'd timer. */
export function startEmailSweep(): void {
  void sweepStrandedEmails();
  const timer = setInterval(() => void sweepStrandedEmails(), SWEEP_INTERVAL_MS);
  timer.unref();
}
