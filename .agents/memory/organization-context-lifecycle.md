---
name: Organization-context lifecycle
description: Security invariants for temporary staff-admin organization contexts.
---

Temporary organization contexts must have a server-enforced expiry and a terminal database state. When an organization leaves its eligible approved-member state, all active contexts for it must end in the same transaction as the status change. Request-time validation and cookie clearing remain defense in depth, not the primary revocation mechanism.

**Why:** Lazy invalidation allows disable-then-reapprove to revive an unobserved context, while browser-only expiry can strand an active database row and block future contexts.

**How to apply:** Any new eligibility rule or organization lifecycle transition must revoke affected contexts atomically and record why. Context creation must retire stale rows before enforcing the one-active-context rule.