---
name: Better Auth on Replit
description: Version/firewall constraints and how to E2E-test magic links without an email provider
---

- Install `better-auth@^1.6` explicitly. `@better-auth/cli` pins 1.4.21 whose tarball the workspace firewall blocks (CVE); the CLI is unusable — hand-write the four auth tables (user/session/account/verification, camelCase quoted columns) as idempotent SQL instead of `cli generate`.
- **Why:** npm installs of 1.4.x fail opaquely at the firewall, and the CLI hard-pins that range.
- **How to apply:** any project adding Better Auth here — write/apply the schema SQL yourself and mount the handler before body parsers.
- Magic-link flows are fully testable with no email provider: the `verification` table's `identifier` column IS the token; `GET /api/auth/magic-link/verify?token=<identifier>&callbackURL=/x` completes a real login (cookie + session hooks fire).
