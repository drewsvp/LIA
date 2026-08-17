---
name: Legacy NULL required fields
description: Seeded/legacy volunteer requests hold NULL in now-required fields; edit surfaces refuse to save them until filled — intended behavior.
---

# Seeded rows predate required-field rules

Some seeded volunteer requests (e.g. "Move-In Day Volunteers", "Fall Soccer League Coaches") carry `details = NULL`, but the member edit surface requires Details non-empty — so a round-tripped edit payload 400s until the member writes something.

**Why:** The form spec makes Details required; legacy data predates it. Backfilling placeholder text would violate the project's never-invent-content rule, so the friction is the intended data-completion path.

**How to apply:**
- In E2E, a 400 on a "no-op" edit save of an old row is probably this, not a regression — check the row's nullable columns before debugging the endpoint.
- Requests created through the current forms always have the field; only seed-vintage rows are affected.
- Do not backfill; do not relax the validation.
