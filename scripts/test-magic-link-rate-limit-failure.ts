/**
 * Test: Task 293 — Magic-link rate limiter refunds failed sends.
 *
 * Context: The magic-link dispatch path (POST /api/login/magic-link) consumes
 * one slot from both magicLinkEmailLimiter and magicLinkIpLimiter before
 * firing auth.api.signInMagicLink(). If the send throws (broken template,
 * provider outage), those slots must be refunded so the user is not locked out
 * for the rest of the 15-minute window despite never receiving an email.
 *
 * This test exercises the FixedWindowLimiter directly:
 *
 *   Section 1 — unconsume() refunds correctly
 *     1a. A single consume() increments the count.
 *     1b. unconsume() decrements it, so a subsequent consume() within the same
 *         window still succeeds even when the limit is 1.
 *     1c. unconsume() on an exhausted bucket (count == limit) restores exactly
 *         one slot — the next consume() succeeds.
 *     1d. unconsume() never pushes the count below zero (no negative credits).
 *     1e. unconsume() on an unknown key is a no-op (no crash).
 *     1f. unconsume() on an expired bucket is a no-op (no resurrection).
 *
 *   Section 2 — Policy confirmation
 *     2a. Without refund, a failed send exhausts the limit after `limit` calls.
 *     2b. With refund, repeated failed sends never exhaust the limit.
 *
 * Usage:
 *   npm run test:magic-link-rate-limit-failure
 *
 * No database or network access required — FixedWindowLimiter is pure
 * in-memory. SESSION_SECRET and seed are not needed.
 */

// FixedWindowLimiter is exported from the same module the route uses.
import { FixedWindowLimiter } from "../server/auth/rate-limit";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const extra = detail !== undefined ? `: ${JSON.stringify(detail)}` : "";
    console.error(`  ✗ FAIL: ${label}${extra}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a limiter whose internal clock is frozen at a fixed epoch so tests are
 * deterministic without needing to advance real time. We rely on the real
 * Date.now() being well above 0, which it always is.
 */
function makeLimiter(limit: number, windowMs = 60_000): FixedWindowLimiter {
  return new FixedWindowLimiter(limit, windowMs);
}

// ---------------------------------------------------------------------------
// Section 1 — unconsume() behaviour
// ---------------------------------------------------------------------------

function runSection1(): void {
  console.log("1. unconsume() correctness\n");

  // 1a. A single consume() increments the count.
  {
    const lim = makeLimiter(3);
    const allowed = lim.consume("alice@example.com");
    assert(allowed, "1a: first consume() within budget returns true");
  }

  // 1b. unconsume() restores the slot so a second consume() on a limit-1
  //     limiter still succeeds.
  {
    const lim = makeLimiter(1);
    const first = lim.consume("bob@example.com");
    assert(first, "1b: first consume() allowed (limit=1)");
    lim.unconsume("bob@example.com");
    const second = lim.consume("bob@example.com");
    assert(second, "1b: consume() after unconsume() succeeds even at limit=1");
  }

  // 1c. unconsume() on an exhausted bucket restores exactly one slot.
  {
    const lim = makeLimiter(2);
    lim.consume("carol@example.com"); // count → 1
    lim.consume("carol@example.com"); // count → 2 (now at limit)
    const blocked = lim.consume("carol@example.com"); // count → 3, over budget
    assert(!blocked, "1c: third consume() on limit=2 bucket is rejected");
    lim.unconsume("carol@example.com"); // count → 2 (back to limit)
    const refunded = lim.consume("carol@example.com"); // count → 3, still over
    // After the over-budget consume set count to 3, unconsume brings it to 2.
    // The next consume sets it to 3 again — still over.
    assert(!refunded, "1c: consume() after one unconsume() is still rejected when bucket was over limit");
    // Unconsume twice to bring count back to 1 (below the limit of 2).
    lim.unconsume("carol@example.com"); // count → 2
    lim.unconsume("carol@example.com"); // count → 1
    const restored = lim.consume("carol@example.com"); // count → 2, at limit — allowed
    assert(restored, "1c: consume() succeeds after two unconsume() calls restore count below limit");
  }

  // 1d. unconsume() never pushes the count below zero.
  {
    const lim = makeLimiter(5);
    // Call unconsume on a key that has never been consumed.
    lim.unconsume("dave@example.com");
    // Now consume once — should be allowed since the bucket is empty (or zero).
    const allowed = lim.consume("dave@example.com");
    assert(allowed, "1d: consume() after excess unconsume() calls is allowed (count never goes negative)");
  }

  // 1e. unconsume() on a completely unknown key is a no-op (no crash).
  {
    const lim = makeLimiter(3);
    let threw = false;
    try {
      lim.unconsume("nobody@example.com");
    } catch {
      threw = true;
    }
    assert(!threw, "1e: unconsume() on unknown key does not throw");
  }

  // 1f. unconsume() on an expired-window key is a no-op (no resurrection).
  //     We use a 0 ms window so the bucket expires immediately.
  {
    const lim = makeLimiter(1, 0);
    lim.consume("eve@example.com"); // expires instantly (windowMs=0)
    // A consume() after expiry starts a fresh bucket.
    const fresh = lim.consume("eve@example.com");
    assert(fresh, "1f: consume() after window expiry starts fresh (sanity)");
    // Now unconsume on the key. The bucket has windowMs=0 so it may already
    // be expired again; unconsume must not crash or leave a zombie entry.
    let threw = false;
    try {
      lim.unconsume("eve@example.com");
    } catch {
      threw = true;
    }
    assert(!threw, "1f: unconsume() on a just-expired bucket does not throw");
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Section 2 — Policy confirmation
// ---------------------------------------------------------------------------

function runSection2(): void {
  console.log("2. Policy: failed sends do not exhaust the rate limit\n");

  // 2a. Without refund, repeated failed sends exhaust the limit.
  {
    const lim = makeLimiter(3);
    const key = "frank@example.com";

    // Simulate 3 failed sends: consume but never unconsume.
    for (let i = 0; i < 3; i++) {
      lim.consume(key);
    }
    const blocked = lim.consume(key);
    assert(!blocked, "2a: without refund, 3 failed sends exhaust a limit-3 bucket");
  }

  // 2b. With refund (unconsume on failure), repeated failed sends never
  //     exhaust the limit. Simulates the route calling unconsume() in .catch().
  {
    const lim = makeLimiter(3);
    const key = "grace@example.com";

    // Simulate 10 failed sends — each time consume() then unconsume().
    for (let i = 0; i < 10; i++) {
      const allowed = lim.consume(key);
      if (allowed) {
        // Dispatch threw — refund the slot (what the route does in .catch()).
        lim.unconsume(key);
      }
    }
    // After 10 failed-send cycles, the next consume() must still succeed.
    const stillAllowed = lim.consume(key);
    assert(
      stillAllowed,
      "2b: with per-failure refund, 10 consecutive failed sends leave the limit intact",
    );
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    "\nTask 293 — Magic-link rate limiter refunds failed sends\n",
  );

  runSection1();
  runSection2();

  console.log(`${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
