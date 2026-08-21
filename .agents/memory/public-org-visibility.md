---
name: Public org visibility gate
description: Why the public organization profile gates on status alone while public request browsing also requires kind = 'member_org'.
---

# Public organization visibility

Public **request** listings and request detail endpoints require both
`organizations.status = 'approved'` **and** `organizations.kind = 'member_org'`.
The public **organization profile** endpoint gates on `status = 'approved'` only.

**Why:** the platform owner organization is `kind = platform_owner,
status = approved`. It is a real, publicly named organization with a slug that
the product deliberately exposes as a shareable profile. Adding the `kind`
filter there would 404 it. The kind filter exists on the request queries for a
different reason — the platform owner does not post needs, so its rows would
only ever be noise — not because its identity is private.

**How to apply:** when adding a new public organization-scoped surface, decide
which of the two rules applies. If the surface shows an organization's
*identity*, gate on status. If it lists an organization's *requests*, keep both
filters, and reuse the existing list query rather than writing new SQL — the
org-scoped variants take an optional org id so the profile page can never
surface a request the browse page hides.

Non-approved organizations (pending, disabled, rejected) and unknown slugs must
be indistinguishable from each other: same JSON 404 body, same not-found page.
The runtime DB role has BYPASSRLS, so this check only exists if the route
handler writes it explicitly.
