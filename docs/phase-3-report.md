# Phase 3 report — admin surfaces, expiry job, migration status, V1–V3

Date: 2026-08-17. Scope: the Phase 3 work order (ADMIN-01 through ADMIN-08 in
order, nightly expiry job, migration + validation, V1–V3 verification, this
report). Handbook.md was the tiebreaker throughout. All work is committed
locally on `main`; GitHub remains the frozen reference at `c1ac163` and was
never contacted.

## Definition of done, line by line

**Shared admin shell built once, used by all eight surfaces.** Done
(ADMIN-01, `71d9cc6`): persistent nav with pending badges on the three
queues, failed-email (7-day) alert linking to the email log filtered to
failures.

**All eight surfaces pass their acceptance sections.** Done, E2E-verified
per surface with SQL cross-checks and byte-identical-404 batteries:
ADMIN-01 11/11 (`71d9cc6`), ADMIN-02 14/14 (`e24ff81`), ADMIN-03 10/10
(`49d1596`), ADMIN-04 10/10 (`7359321`), ADMIN-05 9/9 (`f862a14`),
ADMIN-06 10/10 (`282368e`), ADMIN-07 8/8 (`a75d9c2`), ADMIN-08 10/10
(`4f9bc66`). Per-surface detail lives in `docs/build-log.md`.

**Nightly expiry job scheduled, covering both request types, verified
idempotent.** Done (`83a356f`, `server/jobs/expiry.ts`).
- Scheduled at 12:15 AM Pacific: a 60-second tick reads the LA wall clock,
  fires once per LA date, and runs a catch-up pass at boot (idempotent by
  design, so a deploy spanning midnight cannot lose a night).
- Selects `status='active' and expires_on < current LA date` — a request
  expiring on a date stays live through that entire LA day no matter when a
  pass runs. Batches of 50, re-selecting until exhausted.
- Each archive is one transaction through the existing
  `transitionStatusInTx`: row lock, legal-edge check,
  `archived_reason='expired'`, exactly one `approval_events` row with a null
  actor and note `expired`. Counters untouched. Fulfillment archiving
  remains inside `record_item_pledge()`, not here.
- Verified: the first pass archived the one legitimately expired wild
  volunteer request (`0d74450f` "ESL Conversation Partners", expired
  2026-08-16) plus a ZZ item fixture; the second pass reported
  0 archived / 0 skipped / 0 failed. ADMIN-07's deferred acceptance line 2
  now passes: both events render as "Automated" with "Archived automatically
  after expiry".

**Migration run, validation report written, counter_drift returning zero
rows.** BLOCKED ON INPUTS — not run, and I did not fake it.
- `data/legacy-export/` is intentionally untracked (it holds names, emails,
  phone numbers). The six Wix CSVs are not in the repl and only you can
  export them: Wix dashboard → Content Manager → each collection → Export to
  CSV, filenames exactly as `data/README.md` lists (rename `+` to `_`).
- `transform.py` is present and fails loudly and correctly without them
  (verified: names the missing file and the six expected names, exit 1).
- Separately, per `transform.py`'s own header: the **contacts export has
  never been received**. It is the sole source for `users`,
  `org_memberships`, and `digest_subscribers` — without it, nobody from the
  legacy system can log in, and the ADMIN-08 §15 question (does the contacts
  export include the digest subscriber list?) stays open.
- `docs/migration/validation.sql` is ready but was NOT run against seed
  data: its expected counts describe the post-import state, and running it
  now would produce a report for a migration that did not happen.
- `counter_drift` returns zero rows against the current database (checked
  2026-08-17).
- Once the exports land in `data/legacy-export/`:
  `python3 transform.py --source data/legacy-export --out data/load`,
  human-review the CSVs, `psql "$DATABASE_URL" -f load.sql`, then
  `psql "$DATABASE_URL" -f docs/migration/validation.sql >
  migration-validation-report.txt`, and re-check `counter_drift`.

**V1, V2, V3 confirmed.**
- **V1 — approve stamps `approved_at = now()` and `approved_by` in the same
  transaction as the status change.** Confirmed forensically on wild data:
  all 9 stamped-approved requests (5 item, 4 volunteer) have `approved_at`
  exactly equal to their pending→active approval event's `created_at` AND
  `approved_by` equal to the event's actor. Postgres freezes `now()` per
  transaction, so timestamp equality across the two tables proves one
  transaction. The code agrees: `approveInTx` sets the stamps in the same
  UPDATE as the status change.
- **V2 — organization disable does not clear `approved_at` / `approved_by`.**
  Confirmed live: ZZ Promo Org One was approved (stamps set), then disabled
  through the real API action; afterward `status='disabled'` with both
  stamps intact. The disable SQL writes only `status`, so the stamps cannot
  be cleared by construction. (The wild round-trip org, Hearts & Hands,
  masks this evidence because re-approve re-stamps — hence the fixture
  round-trip.)
- **V3 — disable is exposed on the surface that manages already-approved
  organizations.** Confirmed: the organizations page renders Disable for
  `approved` (and pending) orgs on the approved tab, and a wild
  approved→disabled event exists from the ADMIN-03-era E2E, proving the
  action was exercised from the approved state.

## Acceptance lines that could not be made to pass

- **ADMIN-06, live-inbox delivery:** outstanding, not passing. Resend runs
  in test mode pending DNS and a verified sending domain; sends to real
  inboxes 500 as expected. Reported as outstanding per the work order, not
  as passing.
- **org_member_approved body copy:** the template is complete in structure,
  variables, dispatch, and logging, but the body prose is deliberately lorem
  ipsum pending capture from the source system (phase 2 rule; still true).
- Everything else passed; deviations below are behavior notes, not failures.

## Code review round

An architect review of this session's changes found one severe issue: the
client admin gate admitted every staff session to every admin surface, so a
staff approver could load the ADMIN-04/05/08 page shells (every API call
already 404'd byte-identically — no data was reachable). Fixed in `3119610`:
`STAFF_ADMIN_ONLY_SURFACES` in `shared/routes.ts` (kept in lockstep with the
routes gated `requireStaffAdmin`), the gate renders the identical NotFound
the router catch-all uses, and the nav hides those rows from approvers.

## Deviations and invented copy (running register)

- **LA calendar-day date filters** (`8ff9244`): ADMIN-06/07 briefly shipped
  comparing UTC dates while tables render LA dates; all three date-filtered
  DALs (email log, activity, subscribers) now compare
  `(col at time zone 'America/Los_Angeles')::date`. The expiry job uses the
  same semantics.
- ADMIN-06: `auth_magic_link` template-key mapping deviation; resend
  re-resolves recipients at resend time; `formatDeadlineDate` exported from
  a page module (smell, noted).
- ADMIN-07: actor dropdown lists every historical actor, including
  non-staff members who submitted requests (clarity deviation); the shared
  transition-label mapping was not retrofitted into older surfaces' local
  copy; no arrival links from ADMIN-01–04 into the activity page (specs
  never required them).
- ADMIN-08: an "All statuses" filter option was added beyond spec (default
  remains subscribed); the bounced-unsubscribe 409 copy is invented ("That
  address bounced and is not subscribed."); export uses fetch+blob so a
  failed export can never save a partial file.
- ADMIN-02/05: the real member-entered Other value "Families exiting
  temporary shelter programs" was deliberately left unpromoted — it is wild
  data, promotion is Christina's call.
- Expiry job: "the current date" is read as the LA calendar date (the job
  runs at 00:15 Pacific precisely so a request stays live through its entire
  expiry day); the boot catch-up means each server restart runs one extra
  no-op pass.

## ZZ / fixture residue (all in place, none deleted)

People/users: ZZ-A person (unflagged, holds ZZ-B's login+email rows), ZZ-C
and ZZ-D people+users, ZZ-F person with digest row. Populations:
`zz-probe-group`, `zz-shelter-alumni-families` (inactive). Organizations
(verified against the database 2026-08-17 — these two are the only ZZ
orgs): ZZ Promo Org One (`758d2072`, disabled — now carries approval stamps
and two org events from the V2 proof), ZZ Promo Org Two (`91ccdbf6`,
disabled). Requests: ZZ expiry item probe (`24b91038`, archived/expired
under ZZ Promo Org One). Email log fixtures, verified ids: `0fccd9af`
org_approved **sent** (the D24 evidence row), `007c9606` staff_new_org
stuck **queued** (`zz.fixture.stuck@example.invalid`), `2f50bb2b`
org_approved **failed** (produced by the ADMIN-06 resend test). Approval
events: the ADMIN-07 unresolved-entity fixture (random uuid item_request),
two expiry events (wild vol + ZZ item), two V2 org events. Digest
subscribers, three zz rows: `zz.fixture.sub@example.invalid` (unsubscribed
via the API test), `zz.fixture.bounced@example.invalid` (bounced), and
`zz.merge.a@example.org` (subscribed — ADMIN-04 merge-test residue).

## To unblock the migration (the one thing needed from you)

1. Export the six Wix collection CSVs into `data/legacy-export/` (exact
   filenames in `data/README.md`).
2. Chase down the contacts export — it has never been received, it is the
   only source for logins and (probably) the digest subscriber list.

Everything else in the work order is done and verified.
