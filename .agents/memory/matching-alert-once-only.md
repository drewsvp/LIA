---
name: Matching volunteer alert delivery
description: Once-only and response-observability rules for immediate supporter matching alerts.
---

The first approval claim remains durable even when the template is disabled, rendering fails, or provider delivery fails. Reapproval never creates another automatic alert; only an explicit staff resend of an eligible failed row may retry.

**Why:** Automatic retries after an uncertain provider outcome can duplicate a supporter email, while responding before dispatch finishes makes a queued row indistinguishable from a delivery failure to staff.

**How to apply:** Create the request/supporter claim and Email-log row in the approval transaction, dispatch only after commit, and await matching-alert dispatch before the approval response. Build staff-facing outcomes from the durable Email-log state, and never advertise resend when the provider may already have sent.