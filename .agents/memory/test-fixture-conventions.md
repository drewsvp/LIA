---
name: Test fixture conventions
description: How deliberate test/fixture rows are labeled in this project, so they aren't re-diagnosed as bugs.
---

# Fixture rows label themselves

Deliberate display fixtures carry a `zz_fixture` key in their JSON payload naming the decision/surface they exercise (e.g. the permanently-queued email_log row's payload is `{"zz_fixture": "D23 stuck-queued row (ADMIN-06 test)"}`). E2E-created rows use a `zz.` email prefix (e.g. `zz.e2e.names@example.com`).

**Why:** planted rows look identical to real failures (e.g. a permanently-queued email); the marker is the difference between a display fixture and a bug.

**How to apply:** before diagnosing an odd DB row as a bug, check its payload/email for `zz` markers. When planting fixtures, follow the same convention. Leave fixtures in place — they back admin-surface displays.
