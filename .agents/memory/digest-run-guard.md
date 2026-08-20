---
name: Digest run guard
description: Restart-safety pattern for non-idempotent scheduled email jobs (weekly digest).
---

# Scheduled email jobs must be durably restart-safe

Rule: the in-memory once-per-LA-date scheduler guard is only acceptable for idempotent passes (like nightly expiry). Any scheduled job that SENDS email needs, in the database:
1. a durable per-occurrence claim (unique key), not merely a calendar-date key, so separately scheduled sends on one date remain distinct while exact collisions can coalesce;
2. resume — not re-create — of a run interrupted mid-fan-out, on ANY later day, and older unfinished runs must finish before a newer date is claimed (otherwise the next week's watermark re-covers the same window → double send);
3. a write-once content snapshot taken before any recipient is enqueued, reused verbatim on resume (re-querying can change or empty the content between crash and restart);
4. per-recipient enqueue bound to the run entity so the email-log once-only index makes re-enqueue a visible duplicate;
5. database-backed serialization across application processes, held across recovery, claim, snapshot, and fan-out; process-local flags do not protect rolling restarts;
6. catch-up of the latest missed active occurrence after an outage, with API/UI next-send data derived from the same durable occurrence state. Do not retroactively catch up occurrences predating the current schedule settings.

**Why:** email is not idempotent; a restart must not double-send, lose a separately scheduled same-day send, strand remaining recipients, overlap watermark windows across processes, or show staff a next-send time that disagrees with boot catch-up.

**How to apply:** follow the weekly digest job's run-ledger pattern for any new scheduled send. Zero-content weeks write a visible skipped row surfaced in the admin — never a silent skip.
