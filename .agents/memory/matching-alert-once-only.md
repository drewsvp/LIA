---
name: Matching-alert once-only rule
description: Why volunteer match alert claims survive failed and disabled first-approval sends.
---

An approval-triggered volunteer match claim is permanent for that request and supporter, even when rendering fails, provider delivery fails, or staff disabled the template.

**Why:** Matching alerts are defined as a first-approval event with no retrospective or reapproval fan-out. Deleting a claim after a skip or failure would let category edits, correction reapproval, or concurrent retries generate an unwanted second alert. A disabled template should leave a visible skipped row, not create a backlog that sends later without another supporter action.

**How to apply:** Never release or recreate these claims from ordinary approval, edit, archive, reinstate, or template-enable paths. Staff may explicitly resend a failed email row, but only after re-resolving current consent and eligibility.