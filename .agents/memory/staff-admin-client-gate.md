---
name: Staff-admin client gate lockstep
description: Admin surfaces gated requireStaffAdmin server-side must also join STAFF_ADMIN_ONLY_SURFACES in shared/routes.ts
---

Rule: when an admin surface's routes are gated `requireStaffAdmin`, its
surface id must be added to `STAFF_ADMIN_ONLY_SURFACES` in
`shared/routes.ts` in the same change. The client AdminGate and the
AdminShell nav both read that set to render the byte-identical NotFound and
hide the nav row for mere approvers.

**Why:** an architect review caught three admin-only surfaces whose pages
were loadable (empty, all APIs 404) by staff approvers because the client
gate only checked `isStaff` — the project's authorization contract is
undiscoverable-not-forbidden, so the page shell itself is a violation. The
server guard and the client set drift silently if not changed in lockstep.

**How to apply:** grep `requireStaffAdmin` in `server/routes/admin.ts` and
compare against the set whenever adding or re-gating an admin surface.
`SessionInfo.staffRole` is already on the wire for the client check.
