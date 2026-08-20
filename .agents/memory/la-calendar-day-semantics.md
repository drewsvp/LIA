---
name: LA calendar-day semantics
description: All user-facing date comparisons (filters, expiry) must use the LA calendar date, not UTC ::date
---

Rule: any SQL that compares a timestamptz to a calendar date — list filters,
the nightly expiry selection — must cast via
`(col at time zone 'America/Los_Angeles')::date`, and "today/current date"
means the LA date (`(now() at time zone 'America/Los_Angeles')::date`).

**Why:** tables render LA dates, so a UTC `::date` compare mislabels evening
rows (UTC rolls over at 4–5 PM LA); two admin surfaces shipped briefly with
the bug before a retrofit. The expiry job runs at 00:15 Pacific so a request
expiring on a date stays live through that whole LA day — a UTC compare
would expire it up to 7–8 hours early when run later in the day.

**How to apply:** any new date filter or scheduled selection copies the
existing DAL pattern (email-log / approval-events / digest-subscribers DALs,
`expiredActiveIds` in the request DALs). All involved columns are
timestamptz, which makes the cast safe.
