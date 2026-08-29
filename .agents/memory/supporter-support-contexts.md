---
name: Supporter support contexts
description: Authorization and lifecycle rules for staff-admin “log in as supporter” sessions.
---

A supporter support context must retain the real staff admin’s provider session underneath a separate, signed application-context cookie backed by a durable context row. While active, application session resolution must expose only the supporter identity: no staff role, organization memberships, active organization, or organization context.

**Why:** Copying or mutating the authenticated staff identity makes restoration fragile and can leak staff authority into supporter routes. A separate durable context supports explicit exit, hard expiry, disable-time revocation, and reliable actor/target audit attribution.

**How to apply:** Admit only active supporter-kind users with no active organization membership. Close and audit stale contexts before creating another, including when the old browser cookie has expired. Disabling a target must revoke and audit every active context transactionally. Exit resolves the underlying admin independently of the application’s temporary identity.