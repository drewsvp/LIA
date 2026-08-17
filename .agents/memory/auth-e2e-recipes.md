---
name: Authed E2E session recipe
description: How to mint and keep member session cookie jars for curl-based E2E against auth-protected routes.
---

# Minting a session jar without a mail provider

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"email":"<seeded-user-email>"}' http://localhost:5000/api/auth/sign-in/magic-link
TOKEN=$(psql "$DATABASE_URL" -X -A -t -c \
  "select identifier from verification order by \"createdAt\" desc limit 1")
curl -s -c /tmp/<name>.jar "http://localhost:5000/api/auth/magic-link/verify?token=$TOKEN"
```

**Why:** Resend test mode can only deliver to the account owner's address, so the magic-link POST returns 500 (EmailSendError) for every other user — but the `verification` row is written BEFORE the send, so the token is valid and verify still succeeds. The 500 is loud-but-expected; do not "fix" it.

**How to apply:**
- Works for any seeded user with an org membership; the session's `activeOrgId` auto-selects their sole membership.
- Jars authenticate against `localhost` regardless of the preview domain, but they die when the dev domain rotates or the session table is churned — re-mint rather than debugging stale-cookie 401s.
- `/api/session` shape: `{ user, memberships: [{ orgId, orgName, ... }], activeOrgId }` — org name lives on the membership row, not a top-level `org` key.
