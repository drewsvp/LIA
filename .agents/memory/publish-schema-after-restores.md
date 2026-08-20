---
name: Publish schema after restores
description: How checkpoint restores and publish-time dependency ordering can leave the development schema incompatible with production.
---

A code/checkpoint restore does not necessarily roll back the development database. Before publishing after a restore, compare the live development schema with the restored migration source; orphaned tables and constraints may still be included in the development-to-production diff.

**Why:** A restored workspace no longer contained an engagement feature, but its development table survived. Publish tried to recreate that orphaned schema in production. It also emitted composite foreign keys before newly added parent `UNIQUE` constraints, so PostgreSQL rejected the otherwise valid model during validation.

**How to apply:** After any restore that crossed schema work, inspect both schemas and recompute the publish diff. Restore the missing source if the feature should remain; otherwise get explicit approval before deleting orphaned development data. Do not assume changing a standalone unique index to a `UNIQUE` constraint will fix ordering—verify the generated SQL. Never bypass Publish with production DDL.