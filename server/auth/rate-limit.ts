/**
 * Fixed-window in-memory rate limiter for the magic-link endpoint.
 *
 * The login wrapper invokes Better Auth's API directly (to keep the uniform,
 * non-disclosing response), which bypasses Better Auth's own HTTP-layer rate
 * limiting — so the bound lives here, explicitly. In-memory is the right
 * scope: the app is a single process, and the budget protects against email
 * flooding and provider cost, not distributed attacks.
 *
 * Throttled callers still receive the identical success response; the
 * dispatch is simply skipped. A limiter that answered differently would leak
 * exactly what the uniform response exists to hide.
 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Consume one unit for `key`; false when the key is over budget in the current window. */
  consume(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= 10_000) this.sweep(now);
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.limit;
  }

  /**
   * Return one unit to `key`'s bucket, undoing a prior consume() call.
   *
   * Used by the magic-link dispatch path to refund a slot when the send fails
   * due to a server-side error (broken template, provider outage, etc.). Without
   * the refund, every failed attempt counts against the user's window even
   * though no email was ever delivered, which can lock a real user out for the
   * full 15-minute window during an incident.
   *
   * Safety: the count floor is 0 — unconsume() on a fresh or already-zero
   * bucket is a no-op. The resetAt timestamp is never modified; the window
   * still expires on its original schedule.
   */
  unconsume(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) return; // window already expired — no-op
    bucket.count = Math.max(0, bucket.count - 1);
  }

  /** Reset all buckets. Development/test use only. */
  resetAll(): void {
    this.buckets.clear();
  }

  /**
   * Reset the bucket for a specific key. Allows test teardown to reclaim quota
   * consumed during the run without waiting for the window to expire.
   * Development use only — never call from production paths.
   */
  resetKey(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

const WINDOW_MS = 15 * 60_000;

/** Max magic-link dispatches per normalized email per 15 minutes. */
export const magicLinkEmailLimiter = new FixedWindowLimiter(3, WINDOW_MS);

/** Max magic-link dispatches per source IP per 15 minutes. */
export const magicLinkIpLimiter = new FixedWindowLimiter(10, WINDOW_MS);

/**
 * Max quick-login attempts per source IP per 15 minutes.
 *
 * Quick-login is a dev/staging-only shortcut that never dispatches email, so
 * it must not share the email-dispatch budget (magicLinkIpLimiter). A separate
 * limiter prevents rapid test runs from exhausting the shared pool and causing
 * spurious 429s on the real magic-link path.
 */
export const quickLoginIpLimiter = new FixedWindowLimiter(20, WINDOW_MS);

/**
 * Max magic-link *confirmations* per source IP per 15 minutes. Separate from
 * the dispatch budget: confirming is the human clicking "Sign in" on the
 * confirmation page (D66), which is idempotent and can legitimately repeat
 * (double click, reload, second device). Spending dispatch budget on it would
 * lock a real member out of requesting another link.
 */
export const magicLinkVerifyIpLimiter = new FixedWindowLimiter(30, WINDOW_MS);
