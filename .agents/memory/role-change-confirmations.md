---
name: Role change confirmations
description: Why role/status selections must be verified after an administrator confirms them.
---

Role/status selectors represent a proposed change, not the saved membership. Treat no-op responses and conflicting concurrent edits as failures to change the proposed value; restore the saved value from a fresh list. A successful response alone is not enough to show success until the returned membership and refreshed list agree.

**Why:** The API can legitimately reject protected transitions, return no-op success for an already-matching row, or encounter a concurrent edit. Displaying a provisional selection after any of those makes the change appear to have stuck when it did not.

**How to apply:** When adding membership mutations or changing their response shape, keep old-value preconditions and explicit no-op handling in sync with the confirmation UI. Check permissions on a new authenticated request, not by assuming an existing client session snapshot has updated.