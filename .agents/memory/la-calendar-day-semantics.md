---
name: LA calendar-day semantics
description: All user-facing date comparisons (filters, expiry) must use the LA calendar date, not UTC ::date
---

Rule: any SQL that compares a timestamptz to a calendar date must cast via
`(col at time zone 'America/Los_Angeles')::date`, and "today/current date"
means the LA date. A deadline date stays live for that full LA calendar day.
Write guards that can cross midnight must use wall-clock time rather than
transaction-start time, and batch transitions must recheck eligibility after
locking the row.

**Why:** tables render LA dates, so a UTC `::date` compare mislabels evening
rows (UTC rolls over at 4–5 PM LA); two admin surfaces shipped briefly with
the bug before a retrofit. The expiry job runs at 00:15 Pacific so a request
expiring on a date stays live through that whole LA day — a UTC compare
would expire it up to 7–8 hours early when run later in the day. PostgreSQL
`now()` is frozen at transaction start, and an unlocked batch selection can
become stale before its transition, so neither is sufficient at a write gate.

**How to apply:** timestamp-backed filters copy the existing LA conversion
pattern. Date-backed deadline checks compare to the shared LA date and use a
strict `<` comparison. For writes, evaluate the wall clock under the row lock;
for batch jobs, recheck the rule after acquiring that lock before transitioning.
