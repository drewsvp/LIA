---
name: Publish and database routines
description: Functions and triggers can be absent from production even when tables match, so runtime calls to them fail after an otherwise clean publish.
---

A clean publish diff proves table and column parity, not routine parity. PL/pgSQL functions and their triggers can be missing in production while every table the feature touches is present, so the deploy looks healthy and then fails at runtime with `function <name>(...) does not exist` (SQLSTATE 42883) the first time a query calls one.

**Why:** Deadline-expiry SQL helpers lived only in a migration file. Development had them, `schema.sql` contained them, and production did not — public list and organization endpoints returned 500 while the app itself started normally and reported no error at boot. Some older routines were already in production, so their presence is not evidence that the newest ones shipped.

**How to apply:** After publishing anything whose queries call a function or rely on a trigger, compare `pg_proc` between development and production rather than trusting a clean diff, and request a public endpoint that exercises the routine. The repair is always another publish plus verification — never production DDL, deploy-build hooks, or startup-time `CREATE FUNCTION`. Treat a feature whose logic lives in database routines as unpublished until those routines are confirmed in production.
