---
name: RLS is bypassed at runtime
description: The app's DB role has BYPASSRLS, so no RLS policy (even FORCE) filters anything — visibility must be explicit in route/SQL code.
---

**Rule:** Never rely on RLS policies (or the DAL's PUBLIC/MEMBER context) to hide rows in this project. Every visibility rule — org approved + kind='member_org', request status — must be an explicit check in route code or a WHERE clause in the DAL SQL.

**Why:** The runtime role is `postgres` with `rolbypassrls = true`. All tables have `FORCE ROW LEVEL SECURITY` and well-written policies (`pg_policies` looks correct), but the role attribute bypasses them entirely — verified empirically: with `set_config('app.context','public')`, a pending org and its requests were still returned. This produced a real vulnerability: public POST/GET endpoints served requests belonging to unapproved orgs until explicit gates were added.

**How to apply:** When adding any public or member endpoint, mirror the browse-SQL rule (`r.status='active' and o.status='approved' and o.kind='member_org'`) as explicit checks. When testing visibility, don't probe via psql either — the same role bypasses RLS there, so `set_config + select` proves nothing. Test through the HTTP API. Any future RLS hardening task must either switch the app to a non-BYPASSRLS role or accept that policies are documentation only.

**Nuance:** BYPASSRLS defeats *policies*, not *triggers*. Counter-write and member request-transition rules are enforced by triggers gated on the transaction-local `app.*` GUCs, so they hold for every connection — psql probes that set the GUCs ARE meaningful for trigger-enforced rules; only policy-only visibility remains unprovable via psql. The counter SQL functions manage their own context escalation and restore the caller's context themselves: never add a second layer forcing SYSTEM around a call to them — double-managed context is how a transaction stays elevated after the function returns.
