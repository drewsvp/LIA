---
name: Supporter accounts
description: How supporter (donor/volunteer) accounts differ from member/staff accounts and how login routes them.
---

Supporter accounts are `users.kind = 'supporter'` with NO org_memberships row — membership count 0 is a valid, permanent state for them, not "pending approval".

**Why:** Public claim/volunteer opt-in creates these accounts; they must never see the member dashboard or the pending-approval message, and the magic-link gate keys off the `users` table (any non-disabled users row can log in), not memberships.

**How to apply:**
- Session exposes `isSupporter`; DashboardGate and LoginPage route supporters to `/profile` (SP-01), everything else falls through to member/staff logic.
- Provisioning happens AFTER the pledge/signup commits and must never roll it back — failures log loudly, the submission stands.
- Their history is queried by `users.person_id` (people are shared by email), so past submissions appear automatically.
