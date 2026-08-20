---
name: Responsive preview isolation
description: Exact-width responsive checks in the fixed-size app preview, including authentication-state isolation
---

Rule: to exercise a precise responsive breakpoint when the app-preview
screenshot is fixed at 1280px, temporarily serve a same-origin harness whose
iframe has the target width. The iframe is a real nested viewport, so its media
queries and layout measurements use that width.

Run screenshots that change authentication state sequentially. Parallel preview
captures can share a cookie jar, allowing one quick-login request to contaminate
a capture intended to be signed out.

**Why:** breakpoint verification required exact 719px and 721px layouts, and
parallel signed-out/staff captures produced misleading mixed-session results
despite their harness labels.

**How to apply:** use the harness only for verification, report
`scrollWidth/clientWidth`, logo/control intersection, visible conditional
links, and external-link target, then remove the harness and any temporary
database fixture. Capture signed-out first and authenticated states afterward.