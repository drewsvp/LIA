---
name: Email dispatch claim + stranded sweep
description: No-double-send discipline for email_log dispatch and the startup sweep semantics.
---

# Email dispatch claim + stranded sweep

Rule: every provider send must be preceded by an atomic claim (`queued` → `sending` with a `where status='queued'` guard). The startup/periodic sweep then splits stranded rows by which side of the provider call the crash occurred:

- stranded `queued` → provider never called → safe to re-render from `payload.vars` and re-dispatch.
- stranded `sending` → provider MAY have sent → never auto-retry; mark failed with a "verify with provider before resending" message.

**Why:** a crash between the request-transaction commit and post-response dispatch used to strand rows at `queued` forever (silent loss); retrying a row that may already have sent risks a double email — both are worse than a loud failure.

Additional protocol pieces (added after review of live-dispatch races): the provider call is bounded (60s, far below the 5m sweep threshold) so no live dispatch can be classified as stranded; completion is status-guarded (`sending → sent` only), a late provider confirmation is recorded via a `failed → sent` guarded update that preserves the failure note; admin resend refuses rows with a recorded provider_message_id or the shared MAY_HAVE_SENT marker in error.

**How to apply:** any new dispatch path must go through `dispatchQueuedEmail` (which owns the claim), and any new sweep/retry logic must respect the queued-vs-sending distinction. Sweep excludes `payload ? 'zz_fixture'` rows (deliberate display fixtures). Non-product templates (auth magic link) are time-sensitive and never re-dispatched — mark failed instead.
