---
name: Composed rate-limit reservations
description: Correct rollback semantics when one action reserves several fixed-window limiter buckets.
---

When an action reserves several limiter buckets, a rejected `consume()` must be reversed on the bucket that rejected it as well as on every bucket reserved earlier in the sequence. Provider or downstream failures must then refund the successful full reservation separately.

**Why:** The fixed-window limiter increments a bucket before returning `false`. Rolling back only earlier buckets leaves the rejecting bucket over-counted, so a later failure refund cannot return the action to its original state and legitimate retries remain blocked.

**How to apply:** Any composed reservation helper must treat the operation transactionally: undo the failed consume and all prior consumes on rejection; refund all buckets after a successful reservation if the protected operation fails before completing.