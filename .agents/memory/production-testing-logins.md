---
name: Production testing logins
description: Go-live decision for the four seeded quick-login roles in production.
---

Production quick login is intentionally enabled for pre-go-live testing of all four seeded roles: staff admin, staff approver, org owner, and supporter.

**Why:** The owner explicitly wants the testing logins present and working in production as the final step before full go-live; do not propose disabling them or frame their presence as a gap.

**How to apply:** Preserve `QUICK_LOGIN_ENABLED = "true"` in the production environment and keep migration `0046_seed_quick_login_supporter.sql` intact unless the owner changes this decision.