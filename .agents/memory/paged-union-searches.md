---
name: Paged union searches
description: PostgreSQL type inference pitfalls when adding full-row search to unified paged admin lists.
---

When adding search to a UNION of multiple entity types, explicitly type any projection that can be NULL in every branch, especially timestamps subsequently formatted with `AT TIME ZONE`. Cast UUID values to text before applying text functions or concatenating with empty-string fallbacks.

**Why:** PostgreSQL resolves an all-unknown UNION column to text, so a later timezone expression fails at runtime even though TypeScript checks pass. `coalesce(uuid_column, '')` tries to parse an empty UUID and also fails at runtime. Tests against a running database caught both.

**How to apply:** In server-paged collection SQL that unifies rows or searches all displayed fields, exercise both matching and non-matching searches through the authenticated endpoint, including the zero-row case.