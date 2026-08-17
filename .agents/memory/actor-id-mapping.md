---
name: Actor id mapping (Better Auth text vs uuid columns)
description: Session user.id is TEXT; approval_events.actor_user_id and item_requests.approved_by are uuid — routes pass a mapped uuid, fixture scripts must too.
---
Better Auth `user.id` is a 32-char TEXT id, but ledger columns
(`approval_events.actor_user_id`, `item_requests.approved_by`) are `uuid`.

**Why:** route handlers never pass the raw session id — `orgContext(req)`
resolves the session user to the org-scoped uuid (membership/person) before
any DAL call, so route-driven transitions insert events fine. A standalone
fixture script that feeds `select id from "user"` straight into
`transitionStatus` fails with `invalid input syntax for type uuid`.

**How to apply:** in E2E/fixture scripts that call DAL functions directly,
source the actor id the same way the routes do (the uuid `orgContext`
yields), never `"user".id`. When an admin lane needs `approved_by`, the same
mapping applies.
