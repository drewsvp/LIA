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
