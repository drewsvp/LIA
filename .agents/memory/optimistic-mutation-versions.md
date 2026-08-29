---
name: Optimistic mutation versions
description: Why concurrency-sensitive admin mutations use monotonic versions rather than updated-at timestamps.
---

Concurrency-sensitive mutation APIs must compare a monotonic row version while holding the row lock. Do not use an `updated_at` timestamp as the optimistic token, even if it is rounded to JavaScript precision.

**Why:** PostgreSQL timestamps can carry microseconds that disappear in a JSON/JavaScript round trip, causing false stale conflicts. Rounding to milliseconds avoids that mismatch but permits two serialized updates in the same millisecond to share a token and lets the second overwrite the first.

**How to apply:** Return an opaque numeric version in edit/detail reads. In the same transaction as the write, lock the row, compare the submitted version, reject a mismatch, and increment the version on every update.