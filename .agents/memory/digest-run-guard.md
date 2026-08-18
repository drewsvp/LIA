---
name: Digest run guard
description: Restart-safety pattern for non-idempotent scheduled email jobs (weekly digest).
---

# Scheduled email jobs must be durably restart-safe

Rule: the in-memory once-per-LA-date scheduler guard is only acceptable for idempotent passes (like nightly expiry). Any scheduled job that SENDS email needs, in the database:
1. a durable per-date run claim (unique key) so a completed run is never re-run after restart;
2. resume — not re-create — of a run interrupted mid-fan-out, on ANY later day, and older unfinished runs must finish before a newer date is claimed (otherwise the next week's watermark re-covers the same window → double send);
3. a write-once content snapshot taken before any recipient is enqueued, reused verbatim on resume (re-querying can change or empty the content between crash and restart);
4. per-recipient enqueue bound to the run entity so the email-log once-only index makes re-enqueue a visible duplicate.

**Why:** email is not idempotent; a Thursday restart must not double-send, a crash mid-fan-out must not strand remaining recipients or change their content.

**How to apply:** follow the weekly digest job's run-ledger pattern for any new scheduled send. Zero-content weeks write a visible skipped row surfaced in the admin — never a silent skip.
