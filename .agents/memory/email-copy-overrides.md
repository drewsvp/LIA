---
name: Automated email copy overrides
description: Durable rules for the staff-editable email copy system — editability boundary, all-or-nothing overrides, and the disabled→skipped contract.
---

# Automated email copy overrides

- Only free-text copy (subject, heading, paragraphs with `{placeholder}` tokens) is staff-editable; structural pieces (data tables, key-value rows, buttons) stay in code so edits cannot break them.
- Copy overrides are all-or-nothing with the hardcoded default as fallback. **Why:** partial overrides would silently mix stale and new copy; one atomic block keeps "restore built-in copy" trivially correct.
- Disabling an email must never drop sends silently — a visible `skipped` log row is written instead.
- `skipped` rows count as non-deliveries everywhere: every dedup/"already sent" predicate and the once-per-entity unique index must exclude both `failed` and `skipped`, or re-enabling a template wrongly reports the email as already sent. **Why:** a completion review caught exactly this mismatch between the index and the delivery-check queries.
- **How to apply:** when adding a status that means "no email actually went out", update every `status`-based delivery predicate in lockstep with the partial unique index; a regression script exercises disable → skip → re-enable → real send.
