---
name: Policy migrations vs bootstrap order
description: Why migrations that touch RLS policies must use conditional drops, and what amending an applied migration requires.
---

# Policy-touching migrations and the bootstrap order

**Rule:** Any migration that drops/recreates an RLS policy must use `drop policy if exists`, and `server/db/rls-policies.sql` must carry the same policy definition verbatim (lockstep comment both sides).

**Why:** The documented fresh-DB order is apply-migrations → apply-auth-schema → apply-rls → seed. `0001` creates NO policies — they exist only after `db:apply-rls`. An unconditional `drop policy` in a migration therefore aborts fresh provisioning with 42704 (hit in practice; completion review rejected twice over it). And because `db:apply-rls` is re-runnable, any policy changed only in a migration gets silently reverted on the next RLS reapply unless rls-policies.sql mirrors it.

**How to apply:** When writing/reviewing a migration touching policies: conditional drops in the migration, identical `create policy` in rls-policies.sql, then validate the full documented sequence one-pass on a scratch DB (`createdb` works; run each npm script with `DATABASE_URL=<scratch>`).

**Amending an applied migration:** the runner fails loudly if a recorded file's sha256 changes. With explicit user authorization only: edit the file, then `update schema_migrations set sha256='<new sha>' where filename='<file>'` on every DB that recorded it, and confirm the runner no-ops afterward.
