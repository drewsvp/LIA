---
name: Post-commit asset cleanup
description: How to keep replacement-image cleanup failures from corrupting an already committed save.
---

Once a database save commits a newly stored asset URL, cleanup of the previous asset is post-commit maintenance, not part of failed-save rollback. Track the commit boundary explicitly and never let a cleanup error cause the new, referenced asset to be deleted.

**Why:** A shared outer catch handled both transaction failure and old-object cleanup failure. If deletion and queue insertion both failed after commit, the catch could delete the newly committed image and return an error even though relational data had changed.

**How to apply:** Before commit, delete or durably queue newly uploaded artifacts when the relational save fails. After commit, delete or durably queue only the replaced artifact; isolate that path from rollback and retry queued cleanup without a silent terminal cutoff.