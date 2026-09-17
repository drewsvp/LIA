---
name: Production testing logins
description: Production boundary for seeded quick-login roles.
---

Production quick login must remain disabled. Seeded role login is available only
when the server runs with `NODE_ENV=development`; environment overrides must not
enable it in production.

**Why:** The owner explicitly reversed the earlier production testing exception
so production users must use the normal authentication flow.

**How to apply:** Keep the status, login, rate-limit reset, and startup seed check
behind the same development-only gate. Keep seeded accounts and Quick Login in
development for local and automated checks.