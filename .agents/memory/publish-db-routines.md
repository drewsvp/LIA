---
name: Publish and database routines
description: Functions and triggers can be absent from production even when tables match, so runtime calls to them fail after an otherwise clean publish, and the migration ledger drifts out of step with the schema.
---

A clean publish diff proves table and column parity, not routine parity. PL/pgSQL functions and their triggers can be missing in production while every table the feature touches is present, so the deploy looks healthy and then fails at runtime with `function <name>(...) does not exist` (SQLSTATE 42883) the first time a query calls one.

**Why:** Deadline-expiry SQL helpers lived only in a migration file. Development had them, `schema.sql` contained them, and production did not — public list and organization endpoints returned 500 while the app itself started normally and reported no error at boot. Some older routines were already in production, so their presence is not evidence that the newest ones shipped.

**How to apply:** After publishing anything whose queries call a function or rely on a trigger, compare `pg_proc` between development and production rather than trusting a clean diff, and request a public endpoint that exercises the routine. Treat a feature whose logic lives in database routines as unpublished until those routines are confirmed in production.

## The migration ledger drifts, and the deploy build is the wrong place to fix it

Because publish syncs the schema directly, production's `schema_migrations` ledger stops wherever it was last written while the tables keep advancing. The two then disagree permanently: the ledger says a migration is pending, the objects it creates already exist.

Wiring the migration runner into the deployment build command turns that disagreement into a total publish outage — the first unrecorded file dies on `already exists` (42P07) before the frontend build runs, so nobody can publish at all, and the log looks like an unexplained build failure rather than a database problem.

**Why:** Editing old migrations to be idempotent is not available as an escape: the runner enforces immutability by sha, and development has already recorded them.

**How to apply:** When the ledger and the schema disagree, audit production against development by catalog query — columns, constraints, indexes, `relrowsecurity`/`relforcerowsecurity`, `pg_policy`, plus any top-level seed or backfill statements — before recording anything as applied. A duplicate-object error alone is not proof a file ran: the transaction rolls back, so everything after the failing statement is skipped forever. Baseline only an explicit, closed list of audited filenames, and close the real gap with a new idempotent repair migration rather than by skipping.
