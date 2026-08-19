---
name: Magic-link POST confirmation
description: Why magic-link verification is split GET-renders / POST-verifies, and the two traps (JS timestamp truncation, provider GET consumption) that bite anyone who touches it.
---

# Magic-link verification is POST-confirmed

The emailed sign-in link must never complete authentication on GET. A GET only
renders a confirmation surface; a POST performs verification and creates the
session.

**Why:** the auth provider's own magic-link endpoint consumes the verification
row the moment it is fetched. Mail-security scanners and link prefetchers
follow every URL in an inbound message before the recipient sees it, so real
members were landing on "that login link is no longer valid" within a minute of
delivery, without having clicked anything. Scanners do not issue POSTs.

**How to apply:** the interception must be registered ahead of the provider's
`/api/auth/*` catch-all, or the provider handles the GET first and the split
silently does nothing. Verify this after any change to route registration
order. The interceptor must stay free of side effects — no session, no
consumption, no logging that mutates state.

## Tokens are replayable inside their window

The row is restored after each successful confirmation, so a double click, a
reload, or a second device returns a session instead of an error. Only expiry
and supersession (a newer still-valid link for the same email) refuse a token.

**Why:** a single-use token fails for ordinary human behavior, and the error is
indistinguishable to the user from the scanner bug it replaced.

## The provider's consume deletes every row for the identifier

Not just the matched row — the whole identifier is cleared inside the
provider's own transaction. Two consequences, both learned the hard way:

- Pre-inserting a spare copy of the row to survive the consume **does not
  work**; the spare is deleted along with the original.
- The token is therefore genuinely absent between the consume and the restore.
  Confirmations of the same token must be serialized (an in-process chain keyed
  by token is enough for a single-process server) or a second click landing in
  that gap is told a valid link is invalid.

Check this behavior again after any provider upgrade — it is internal and can
change between versions.

## Never compare verification timestamps in JavaScript

The provider's `verification` table stores `timestamp without time zone` at
microsecond precision. A JS `Date` truncates to milliseconds, so a row read
into Node and passed back as a parameter compares as *strictly newer than
itself* — which made a freshly issued token report as superseded on its first
use. Do expiry and ordering comparisons in SQL against the stored row (join by
id), and carry the stamps as text if a row needs restoring byte-for-byte.

**How to apply:** this trap applies to any read-modify-write against provider
tables, not just magic links.

## Redirect targets come from the account

The interceptor deliberately drops the provider's `callbackURL`. The POST
resolves the destination from the signed-in account, so no caller-supplied
redirect target reaches the browser.
