---
name: Profile email changes
description: Security boundary for self-service changes to the email used for magic-link login.
---

An authenticated profile edit must not immediately move the account's login identity to a new email address. Keep the current address active until the new mailbox consumes a single-use, expiring confirmation.

**Why:** An authenticated user can mistype an otherwise unused address. Immediate transfer would let whoever owns that mailbox request a magic link and inherit the original account, including staff or organization permissions.

**How to apply:** Save non-identity contact fields immediately. Hold the requested email as pending, rate-limit confirmation dispatches, and make emailed GET links render only; a deliberate POST re-checks collisions and updates both identities in one locked transaction. Expired, superseded, conflicting, replayed, or non-unique tokens must not move the account.