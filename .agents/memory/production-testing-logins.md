---
name: Production testing logins
description: Current owner decision for seeded quick-login roles in production.
---

Production quick login is intentionally enabled for the seeded testing roles.
Keep `QUICK_LOGIN_ENABLED=true` in the production environment.

**Why:** After briefly removing the production override, the owner explicitly
requested that the Quick Login buttons be restored in production.

**How to apply:** Preserve the production override. Restore missing production
test identities through a narrow, idempotent migration; never copy the entire
development database or run the full demo seed over live data. Remove production
quick login only after another explicit owner instruction.