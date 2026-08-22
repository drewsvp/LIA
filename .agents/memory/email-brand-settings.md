---
name: Email brand settings
description: Durable design constraints for the email_brand_settings singleton, SSRF-safe URL fetch, and brand token injection across all send/render paths.
---

# Email brand settings — durable constraints

## updated_by FK must be uuid, not text
`users.id` is PostgreSQL `uuid`. Any audit column that references it must also be `uuid`; using `text` fails `ATAddForeignKeyConstraint` at migration time.

## schema.sql must mirror ALL migration constraints
When adding a new table, schema.sql needs PRIMARY KEY, FOREIGN KEY, and CHECK constraints — not just the CHECK. A schema missing PK/FK will break `ON CONFLICT (id)` in the DAL and allow duplicate singleton rows on a fresh restore.

## Every send and render path must merge brandTokenVars()
Brand tokens (`{orgName}`, `{signature}`, etc.) are injected by merging `brandTokenVars()` before `template.render()` — template-specific vars win on collision. This must happen in: product queue (both paths in send.ts), magic-link (auth.ts), sweep re-render (email-sweep.ts), engagement outreach (engagement-reporting.ts), and the historical email preview (admin.ts).

**Why:** The sweep and historical preview paths previously re-rendered with only the stored payload vars, leaving literal brand tokens in recovered emails.

## Brand header image fetch: every redirect hop must be SSRF-validated
Use `redirect: "manual"` and call `assertSafeImageUrl()` on every `Location` header before following it. `redirect: "follow"` with a final-URL check is bypassable: a public HTTPS endpoint can redirect to an HTTPS loopback URL, bypassing the initial DNS/IP check.
