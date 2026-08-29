---
name: Append-only directory paging
description: Stable and scalable pagination for operational history that only gains new records.
---

Offset pagination is acceptable for an append-only operational directory only when the first page establishes a server-time snapshot boundary and every later page and count reuses it. Order by a complete stable key and index that same key.

**Why:** A deterministic sort alone does not stop a new record from shifting offsets between page requests, causing duplicates or omissions. The snapshot excludes later inserts while preserving familiar numbered pagination; the matching composite index avoids full-history sorts.

**How to apply:** Return the snapshot timestamp with the first response, preserve it for Previous and Next within the current filter set, reset it when filters change, constrain both count and rows to the boundary, and use the unique ID as the timestamp tie-breaker.