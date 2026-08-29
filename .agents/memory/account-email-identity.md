---
name: Account email identity
description: Durable identity rules for people, application users, provider subjects, contact edits, and merges.
---

Treat normalized email as the identity key for account provisioning. Names and phone numbers are display/contact data only and must never cause account reuse.

**Why:** The same person email may legitimately hold memberships in several organizations, while different people may share a name. Silently changing the person email behind a login or trusting a provider subject whose email has drifted can grant the wrong identity's access.

**How to apply:** Reuse an account only on an exact normalized email match. Once a person has a login, contact maintenance and merge operations must not change that email implicitly. Session authorization must require the linked provider and person emails to agree. Report historical mismatches for explicit review rather than auto-repairing either side.