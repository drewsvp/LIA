---
name: Production quick logins
description: Production must not expose the seeded quick-login roles.
---

Production quick login is disabled. The seeded roles may remain for development
and migration compatibility, but production must not set
`QUICK_LOGIN_ENABLED=true`.

**Why:** The owner explicitly ended pre-go-live production testing and requested
that Quick Logins be removed from production.

**How to apply:** Keep the production environment override absent. Do not delete
development fixtures or historical migrations. Restore production quick login
only after new explicit approval.