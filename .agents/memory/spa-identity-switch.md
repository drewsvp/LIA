---
name: SPA identity switch needs full reload
description: Why logout/quick-login use window.location.assign instead of SPA navigation + queryClient.clear()
---

Rule: after any session identity change (logout, quick-login user switch), do a full page load (`window.location.assign(...)`), never SPA navigation plus cache surgery.

**Why:** `queryClient.clear()` while queries are mounted proved unreliable — active components (NavBar user chip) kept rendering the removed session data even though the network refetch returned the new identity. Server logs showed correct responses; the UI stayed stale. Users saw "stuck on previous user" and a frozen "Logging out…" spinner.

**How to apply:** any new flow that changes the session cookie's identity must end in a full reload. Also: client fetches for auth actions carry `AbortSignal.timeout(10_000)` so a dead/restarting dev server yields a stated error, not an infinite spinner.
