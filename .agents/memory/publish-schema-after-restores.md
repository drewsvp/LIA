---
name: Publish schema after restores
description: How checkpoint restores and publish-time dependency ordering can leave the development schema incompatible with production.
---

A code/checkpoint restore does not necessarily roll back the development database. Before publishing after a restore, compare the live development schema with the restored migration source; orphaned tables and constraints may still be included in the development-to-production diff. Also verify table-level RLS flags independently of policy definitions: policies can remain present while `relrowsecurity` and `relforcerowsecurity` are both false.

**Why:** Restores have left development schema objects out of sync with migration source, and policy definitions can survive independently of table-level enforcement flags. A policy-text check alone therefore cannot prove RLS is active.

**How to apply:** After any restore that crossed schema work, inspect both schemas and recompute the publish diff. Check `pg_class.relrowsecurity` and `relforcerowsecurity` for protected tables, and test with a role that lacks BYPASSRLS. Restore missing source if the feature should remain; otherwise get explicit approval before deleting orphaned development data. Do not assume changing a standalone unique index to a `UNIQUE` constraint will fix ordering—verify the generated SQL. Never bypass Publish with production DDL.