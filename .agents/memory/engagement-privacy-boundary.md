---
name: Engagement privacy boundary
description: Privacy and source-of-truth rules for request engagement analytics
---

Anonymous engagement must remain aggregate-only: do not add an anonymous cookie, session/visitor identifier, fingerprint, IP, referrer, form contents, or later login association. A fresh event identifier may make one interaction retry-safe, but it must not correlate separate interactions. Signed-in activity may use the existing application user identity.

Completed item donations and volunteer signups must always be derived from their authoritative pledge/signup records, never copied into engagement events.

**Why:** The reporting feature is intended to measure public request performance without building an anonymous identity trail or allowing analytics data to drift from completed actions.

**How to apply:** Preserve this boundary when extending analytics, audiences, exports, or outreach. Re-check conversions against live pledge/signup data at read/action time, and expose viewer identity only through staff-admin authorization.