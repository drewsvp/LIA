---
name: Email test sends
description: Operating boundary for staff-admin test deliveries of automated email templates.
---

Explicit test sends use the same renderer, brand settings, CID header attachment, provider dispatch, and email log as a real delivery. They may render unsaved draft copy and may test disabled or authentication templates.

**Why:** Staff need to verify the exact message before enabling or bulk-sending it, without accidentally resolving a production audience, starting a scheduler, changing template status, or consuming an entity-bound once-only claim.

**How to apply:** Keep every recipient as an independent, repeatable entity-null log row marked as a test. Test-send code must accept only explicit staff-entered addresses, remain staff-admin-only, and return per-recipient outcomes.