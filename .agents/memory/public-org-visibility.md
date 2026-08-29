---
name: Public org and request visibility gates
description: Public organization identity is status-gated; request eligibility is kind-specific, with platform-owner volunteers public but its items excluded.
---

# Public organization visibility

Public **organization identity** and population assignments gate on
`organizations.status = 'approved'` only. Public request eligibility is
kind-specific:

- Item requests require an approved `member_org`.
- Volunteer requests allow an approved `member_org` or `platform_owner`.

**Why:** The Alliance is a public organization and may publish volunteer
opportunities through the normal approval workflow, but its item-donation
requests remain intentionally private. Parent-table RLS must expose approved
platform-owner identity or child volunteer policies that join organizations
silently filter the opportunities back out.

**How to apply:** use the shared volunteer organization predicate for every
volunteer browse, detail, action, notification, digest, engagement, and outreach
path. Keep item predicates explicitly member-org-only. For RLS changes, verify
with a genuinely non-bypassing role; inspecting policy text under the runtime
superuser does not prove joined parent policies work.

Non-approved organizations (pending, disabled, rejected) and unknown slugs must
be indistinguishable from each other: same JSON 404 body, same not-found page.
The runtime DB role has BYPASSRLS, so this check only exists if the route
handler writes it explicitly.
