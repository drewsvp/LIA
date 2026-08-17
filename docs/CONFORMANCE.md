# CONFORMANCE — structural comparison of the built system against the corpus

Audit date: 2026-08-17 (America/Los_Angeles). Method: file reads, database
catalog queries, and text comparison only. No behavioral probing, no
cross-user access attempts, no timing measurements. No file other than this
one was created, modified, or deleted. Nothing was pushed.

---

## 1. Surface completeness

docs/build-log.md carries a line for **all 27 surface IDs**. None is missing.

| ID | Logged status | Acceptance |
|---|---|---|
| MP-01 | built | 5/5 |
| MP-02 | built | n/a (gate applying to all pages; spec declares no route of its own) |
| MP-03 | built | 8/8 |
| MP-04 | built | 8/8 |
| MP-05 | built | 9/9 |
| MP-06 | built | 9/9 |
| MP-07 | built | 10/10 |
| MP-08 | built | 10/10 |
| MP-09 | built | 11/11 |
| MP-10 | built | 9/9 |
| MP-11 | built | 9/9 |
| MP-12 | built | 11/11 |
| MP-13 | built | 8/8 |
| PB-00 | built | 1/2 |
| PB-01 | built | 9/10 |
| PB-02 | built | 16/16 |
| PB-03 | built | 9/9 |
| PB-04 | built | 11/11 |
| PB-05 | built | 5/6 |
| ADMIN-01 | built | 11/11 |
| ADMIN-02 | built | 14/14 |
| ADMIN-03 | built | 10/10 |
| ADMIN-04 | built | 10/10 |
| ADMIN-05 | built | 9/9 |
| ADMIN-06 | built | 10/10 (one acceptance test deferred — below) |
| ADMIN-07 | built | 8/8 |
| ADMIN-08 | built | 10/10 |

Acceptance lines that did not pass, per the specs:

- **PB-00 (1/2)** — docs/specs/PB-00.md:128 "Desktop and mobile match their
  screenshots." Qualified: hero + tile photo/script art not in the repo;
  typographic treatment used per PB-01 precedent; the TEDx URL is captured
  nowhere in the corpus, so the phrase renders bold and unlinked
  (docs/build-log.md:11).
- **PB-01 (9/10)** — docs/specs/PB-01.md:140 "Desktop and mobile match their
  screenshots." The captured script-over-collage hero art is not in the
  repo; rendered as an Open Sans caps heading per Design.md tokens
  (docs/build-log.md:6).
- **PB-05 (5/6)** — docs/specs/PB-05.md:131 "First name, last name, and
  email are collected and stored." Names are collected and validated but
  only email is persisted: digest_subscribers has no name columns and
  people is off-limits for this flow (D27/§13) (docs/build-log.md:10).
- **ADMIN-06 (10/10, one test deferred)** — docs/specs/ADMIN-06.md:146: the
  deliberate-failure send test (one of the five in Handbook §16) was
  deferred to the V-phase battery; the failure mechanism itself is proven
  by a wild unresolved-variable row plus a live resend failure
  (docs/build-log.md:31).
- **ADMIN-07 note** — build-log line 32 says acceptance line 2 "re-verifies
  once the nightly expiry job exists"; the expiry job now exists and the
  re-verification is logged (docs/build-log.md:36): two automated expiry
  events render as "Automated / Archived automatically after expiry."

---

## 2. Schema conformance

**migrations/ in filename order** (sha256 of file on disk):

| file | sha256 (disk) |
|---|---|
| 0001_initial_schema.sql | 73328ab6c9a74d922e5c652cf67b31557305070eb6e8d81dc82446b2deab890a |
| 0002_phone_match_names_all_duplicates.sql | e0d0e301eac443c1df83cb2b7a154dc08b0cba230dbbf0a5759781b80b6a6e25 |
| 0003_merge_people_function.sql | 262e6a6beeb36598f12324d84f535dfe8c9f2b3a1e68929f7f0ea18ceb844ee7 |

**schema_migrations** records all three as applied — 0001 and 0002 at
2026-08-17 13:32:34+00, 0003 at 2026-08-17 17:59:01+00 — and every recorded
sha256 **matches the file on disk byte-for-byte** (same three digests).

**Live database vs migration files:**

Present in the database and absent from any migration file:

- Tables `user`, `session`, `account`, `verification` plus their indexes
  (user_email_key, session_token_key, session_userId_idx,
  account_userId_idx, verification_identifier_idx, and four pkeys) — the
  Better Auth schema, created by server/auth/auth-schema.sql via
  `npm run db:apply-auth-schema`, deliberately outside migrations/.
- Table `schema_migrations` — the migration runner's own bookkeeping,
  created by server/db/apply-migrations.ts.
- 41 row-level-security policies, with RLS enabled and forced on all 17
  application tables — applied from server/db/rls-policies.sql via
  `npm run db:apply-rls`, not from a migration file.

Present in a migration file and absent from the database: **nothing.**
Verified live: all 17 application tables of 0001; the `counter_drift` view;
all four functions (set_updated_at, record_item_pledge — as replaced by
0002 — record_volunteer_signup — as replaced by 0002 — and merge_people
from 0003); all 10 set_updated_at triggers; all 24 explicitly created
indexes (checked by name against pg_indexes — all present). The pgcrypto
extension functions visible in the catalog come from 0001's
`create extension if not exists pgcrypto` (line 28).

**schema.sql is STALE.** It was generated 2026-08-17 13:32 (immediately
after 0001+0002 were applied) and last committed in the migration-runner
commit; migration 0003 was applied 17:59, after it. Diff against a fresh
schema-only dump of the live database (written to /tmp, not the workspace):
stale by **exactly one object** — `function merge_people(uuid, uuid)` is
missing from schema.sql. (The only other diff lines are pg_dump version
banners: \restrict/\unrestrict.) The counter_drift view and everything
else in schema.sql match live.

**select * from counter_drift;**

```
 kind | id | stored | actual
------+----+--------+--------
(0 rows)
```

Row count: **0**.

---

## 3. Route conformance

**Client surface routes.** shared/routes.ts declares 27 route entries (26
surface IDs with one path each, PB-05 with two paths; MP-02 has no route —
its spec, docs/specs/MP-02.md:5, declares "Applies to all pages. No route
of its own"). Every declared path was compared character-by-character
against the Route line of its spec (docs/specs/<ID>.md:5, plus
PB-05.md:28 for the second PB-05 path):

- MP-01 /login · MP-03 /signup · MP-04 /dashboard · MP-05
  /dashboard/organization · MP-06 /dashboard/members/new · MP-07
  /dashboard/items/new · MP-08 /dashboard/items/:id/add · MP-09
  /dashboard/items/:id/edit · MP-10 /dashboard/volunteer/new · MP-11
  /dashboard/volunteer/:id/add · MP-12 /dashboard/volunteer/:id/edit ·
  MP-13 /dashboard/supporters · PB-00 / · PB-01 /items · PB-02 /items/:id ·
  PB-03 /volunteer · PB-04 /volunteer/:id · PB-05 /subscribe and
  /unsubscribe/:token · ADMIN-01 /admin/organizations · ADMIN-02
  /admin/requests · ADMIN-03 /admin/members · ADMIN-04 /admin/people/review
  · ADMIN-05 /admin/populations · ADMIN-06 /admin/email · ADMIN-07
  /admin/activity · ADMIN-08 /admin/subscribers

**Match: exact, all 27. No specified route is missing, and no path differs
from its specified form by any character.** All 27 entries are bound to
real pages in client/src/App.tsx (no placeholder fallback is reachable).

**Legacy redirect paths.** Handbook.md:307 specifies
`/area-needs-request/:legacyId` and `/area-needs-volunteer-request/:legacyId`
(also referenced by docs/specs/PB-02.md:22 and PB-04.md:24). Both are
registered, character-exact, in server/routes/index.ts:132 and :145.

**Registered server routes** (method + path; source lines in
server/routes/):

- Infra: ALL /api/auth/* (auth handler mount) · POST /api/login/magic-link
  · GET /api/session · POST /api/session/active-org · GET /api/admin/ping ·
  GET /storage/* · GET /area-needs-request/:legacyId · GET
  /area-needs-volunteer-request/:legacyId · /api 404 fallback · SPA
  catch-all (server/vite.ts).
- Member API (23 routes): GET /api/dashboard/overview · GET+PUT
  /api/dashboard/organization · POST /api/dashboard/items · GET
  /api/dashboard/items/:id · POST /api/dashboard/items/:id/items · POST
  /api/dashboard/items/:id/submit · GET /api/dashboard/items/:id/edit ·
  POST /api/dashboard/items/:id/edit/request · POST
  /api/dashboard/items/:id/edit/items · POST
  /api/dashboard/items/:id/edit/add-item · POST /api/dashboard/volunteers ·
  GET /api/dashboard/volunteers/:id · POST
  /api/dashboard/volunteers/:id/roles · POST
  /api/dashboard/volunteers/:id/submit · GET
  /api/dashboard/volunteers/:id/edit · POST
  /api/dashboard/volunteers/:id/edit/request · POST
  /api/dashboard/volunteers/:id/edit/roles · POST
  /api/dashboard/volunteers/:id/edit/add-role · GET
  /api/dashboard/supporters/donors · GET
  /api/dashboard/supporters/volunteers · POST /api/dashboard/members · POST
  /api/dashboard/organization/remove-member.
- Public API (10 routes): GET /api/public/item-requests · GET
  /api/public/volunteer-requests · GET /api/public/item-requests/:id · POST
  /api/public/item-requests/:id/pledges · GET
  /api/public/volunteer-requests/:id · POST
  /api/public/volunteer-requests/:id/signups · GET /api/public/populations
  · POST /api/public/organization-signups · POST
  /api/public/digest-subscriptions · POST
  /api/public/digest-subscriptions/unsubscribe.
- Admin API (34 routes): GET /api/admin/nav-counts · GET
  /api/admin/organizations · GET /api/admin/organizations/:id · POST
  /api/admin/organizations/:id/approve · POST
  /api/admin/organizations/:id/disable · GET /api/admin/requests · GET
  /api/admin/requests/:type/:id · POST
  /api/admin/requests/:type/:id/approve · POST
  /api/admin/requests/:type/:id/return-to-draft · POST
  /api/admin/requests/:type/:id/archive · POST
  /api/admin/requests/:type/:id/reinstate · POST
  /api/admin/requests/:type/:id/image · GET /api/admin/members · GET
  /api/admin/members/:id · POST /api/admin/members/:id/approve · POST
  /api/admin/members/:id/reject · POST /api/admin/members/:id/reinstate ·
  GET /api/admin/people/review · GET /api/admin/people/review/:id · POST
  /api/admin/people/review/:id/names · POST
  /api/admin/people/review/:id/clear-flag · POST
  /api/admin/people/review/:id/merge · GET /api/admin/populations · POST
  /api/admin/populations · POST /api/admin/populations/reorder · POST
  /api/admin/populations/:id/rename · POST
  /api/admin/populations/:id/deactivate · POST
  /api/admin/populations/promote · GET /api/admin/email · GET
  /api/admin/email/:id · POST /api/admin/email/:id/resend · GET
  /api/admin/activity · GET /api/admin/subscribers · GET
  /api/admin/subscribers/export.csv · POST
  /api/admin/subscribers/:id/unsubscribe.

Routes present that are not among the 27 surface routes + 2 legacy paths:
the /api/* namespace above (the application's data API, documented in
docs/data-access.md rather than the surface specs), GET /storage/*, and the
SPA catch-all. No surface-path variant or near-duplicate exists.

---

## 4. Email conformance

**Templates in the codebase** (registry: server/email/templates/index.ts, 12
keys) vs the twelve keys in docs/email/TEMPLATES.md: **the sets are
identical, and all twelve subject lines match the captured subjects
verbatim** (template-literal variables correspond 1:1 to the doc's
{placeholder} forms):

| key | subject (code ≡ captured) |
|---|---|
| staff_new_org | Organization Pending Approval: {organizationName} |
| staff_new_item_request | Item Request Pending Approval: {itemRequestName} |
| staff_new_volunteer_request | Volunteer Request Pending Approval: {volunteerRequestName} |
| staff_new_user | New Member Pending Approval: {memberName} |
| org_approved | Welcome to the Love in Action Database {organizationName} |
| org_request_received | {itemOrVolunteer} Request Pending Approval: {requestName} |
| org_request_approved | Your Love in Action Request was Approved! |
| org_member_approved | Love in Action Database Login Info for {memberName} |
| org_new_item_donation | Item(s) have been donated for {requestName} |
| org_new_volunteer | A Volunteer has Expressed Interest in Serving |
| donor_item_confirmation | Thank you for donating item(s) to {organizationName} |
| donor_volunteer_confirmation | Thank you for expressing interest in volunteering! |

Missing templates: none. Template present beyond the twelve: the magic-link
sign-in email (server/email/templates/auth-magic-link.ts, subject "Your
sign-in link for Love in Action"), deliberately excluded from the product
registry and logged under key `auth_magic_link` — new-system auth copy
with no captured counterpart.

**Placeholder body copy:** `org_member_approved` only. Subject and
variables are real; the body prose is lorem ipsum
(server/email/templates/org-member-approved.ts) because TEMPLATES.md:3-4
records that this body was never captured (eleven of twelve captured).

**email_log by status:**

```
 status | count
--------+-------
 failed |    99
 queued |     1
 sent   |     1
```

(101 rows total. Resend runs in test mode without a verified sending
domain; live sends fail by design in this environment.)

---

## 5. Migration status

**The historical data migration has NOT been run.** The database holds seed
data plus test fixtures only. What exists instead of the expected legacy
volumes:

| entity | expected after migration | in database now |
|---|---|---|
| organizations | 49 + 1 platform owner | 9 (5 approved, 3 disabled, 1 pending) |
| item requests | 116 | 13 |
| items | 395 | 18 |
| volunteer requests | 24 | 9 |
| volunteer roles | 54 | 14 |
| item pledges | 83 | 9 |
| item pledge lines | 173 | 12 |
| volunteer signups | 38 | 13 |
| people | 160 | 27 |

(Also present: 13 users, 8 digest_subscribers — seeded/fixture rows.)

The inputs are absent: data/legacy-export/ does not exist (intentionally
untracked; PII), data/load/ is an empty directory, and the contacts export
has never been received. docs/migration/validation.sql exists but was
deliberately not run against seed data.

**Requested files:** `dropped-fields.csv` **exists**
(docs/migration/dropped-fields.csv). `redirects.csv` **does not exist**.
`migration-exceptions.csv` **does not exist**. (Both are transform.py
outputs; the transform has never run for lack of inputs.)

---

## 6. Corpus drift — statements now factually wrong

1. **Handbook.md:18** — "There is no `0002` and none is planned."
   migrations/ contains 0002_phone_match_names_all_duplicates.sql and
   0003_merge_people_function.sql.
2. **Handbook.md:149** — "…the only file in /migrations. There is no
   `0002` and none is planned. Nothing has shipped, so schema changes are
   made by editing 0001 directly…" Contradicted by the tracked migration
   runner (server/db/apply-migrations.ts) and 0003's own header, which
   states it exists because 0001 was already applied and immutable.
3. **Handbook.md:199** — "Both are folded into
   migrations/0001_initial_schema.sql rather than added later…" —
   merge_people() is created in 0003 (line 41), not 0001.
4. **docs/specs/ADMIN-04.md:88** — "Folded into
   migrations/0001_initial_schema.sql already, no schema change needed
   here." Same fact: merge_people() lives in 0003.
5. **docs/data-access.md:22-24** — "RLS is ENABLEd and FORCEd on all 17
   application tables — a query outside a context sees nothing,
   deliberately and loudly." Policies exist (41) and RLS is enabled and
   forced, but the runtime connection role has BYPASSRLS, so at runtime
   policies filter nothing; visibility is enforced by route guards and DAL
   predicates instead.
6. **Handbook.md:138** — "Permission checks enforced with row-level
   security." Same fact: RLS is inert for the runtime role; enforcement is
   in server/auth/guards.ts and the DALs.
7. **Handbook.md:366** — "…the 19 bound UI surfaces." client/src/App.tsx
   binds real pages for 26 surface IDs (12 MP + 6 PB + 8 ADMIN; MP-02 is
   the route-less gate), covering all 27 route entries with no placeholder
   reachable.
8. **OPEN-ITEMS.md:26** — "Staff roster — … Nobody can log into /admin
   until these memberships exist." The memberships exist and are seeded and
   verified by server/db/seed.ts (Tiffany Loeffler and Christina Moe as
   staff_admin, the synthetic approver as staff_approver).
9. **README.md (repo tree, ~lines 35-44)** — lists
   "migrations/ 0001_initial_schema.sql — Complete initial schema (17
   tables)" as the sole migration file; there are three.
10. **docs/data-access.md:153** — describes the pledge/signup DALs as
    calling "the 0001 SQL functions"; 0002 replaced both
    record_item_pledge and record_volunteer_signup.

Checked and found accurate (not drift): the seeded staff logins as listed
in replit.md:133-135 and docs/data-access.md:253-255 match
server/db/seed.ts. Per instruction, none of the above was corrected.

---

## 7. Assets

Served asset path is client/src/assets/ (bundled by Vite). Every file and
the surface(s) rendering it:

| asset | rendered by |
|---|---|
| alliance-logo-blue.png | all surfaces (NavBar) |
| dashboard/hero.png | MP-04 dashboard; MP-06 members/new |
| dashboard/tile-item.png | MP-04 |
| dashboard/tile-volunteer.png | MP-04 |
| dashboard/tile-org.png | MP-04 |
| dashboard/tile-users.png | MP-04 |
| dashboard/tile-donors.png | MP-04 |
| dashboard/tile-community.png | MP-04 |
| headers/LIA-Main-Page-Header.png | PB-00 home |
| headers/Provide-an-Item-Header.png | PB-00; PB-01 items browse |
| headers/Volunteer-your-Time-Header.png | PB-00; PB-03 volunteer browse |
| requests/item-hero.png | MP-07 items/new |
| requests/volunteer-hero.png | MP-10 volunteer/new |

Surfaces referencing art with no matching file: **none** (every import
resolves; the client build would fail otherwise). Served asset files no
surface renders: **none**.

Outside the served path: the repo-root assets/ directory holds 13 files
(alliance-logo-blue.png, alliance-logo-gradient.png — whose content is now
the Love in Action email-header graphic — five files under headers/, six
member-dashboard reference screenshots under member_dashboard_graphics/).
Nothing in client/ or server/ references any of them; it is a staging
directory, not a served path. attached_assets/ is the upload inbox, also
unserved.

---

## 8. Close

**Matches specification**
- Surface coverage: all 27 IDs built and logged, one build-log line each.
- Client routes: all 27 spec paths bound character-exact; MP-02 route-less per spec.
- Legacy redirects: both Wix paths registered exactly as Handbook.md:307 specifies.
- Migrations: all three applied once, recorded checksums byte-identical to disk.
- Schema objects from migrations: every table, view, function, trigger, and explicit index present live; nothing from a migration file is missing.
- Counters: counter_drift returns zero rows.
- Email registry: exactly the twelve captured keys; all twelve subjects verbatim.
- Served assets: every file rendered by a surface, every reference resolves.
- Seeded staff logins: docs match seed.ts.

**Differs from specification**
- schema.sql stale by one object — missing merge_people() from 0003; carried by schema.sql.
- org_member_approved body is lorem ipsum (subject/variables real) — carried by server/email/templates/org-member-approved.ts, acknowledged by docs/email/TEMPLATES.md:3-4.
- PB-00 screenshot-match acceptance unpassable — hero/tile art and TEDx URL absent from the corpus; carried by docs/specs/PB-00.md:128 vs docs/build-log.md:11.
- PB-01 screenshot-match acceptance unpassable — captured hero art absent; carried by docs/specs/PB-01.md:140 vs docs/build-log.md:6.
- PB-05 stores email only, not first/last name — carried by docs/specs/PB-05.md:131 vs the digest_subscribers schema (0001).
- ADMIN-06 §16 deliberate-failure test deferred — carried by docs/specs/ADMIN-06.md:146 vs docs/build-log.md:31.
- Historical data migration not run; database is seed-scale, all nine expected legacy counts unmet; redirects.csv and migration-exceptions.csv absent — carried by data/ (inputs missing).
- Corpus drift: the ten wrong statements in §6 — carried by Handbook.md (18, 138, 149, 199, 366), docs/specs/ADMIN-04.md:88, docs/data-access.md (22-24, 153), OPEN-ITEMS.md:26, README.md (repo tree).
- Auth tables, schema_migrations, and the 41 RLS policies exist in the database but in no migration file (defined in server/auth/auth-schema.sql, server/db/apply-migrations.ts, server/db/rls-policies.sql respectively) — a documented layering choice, listed here because §2 asks for anything database-present and migration-absent.

**Cannot determine from reading alone**
- Whether live-inbox delivery works: needs a verified sending domain and a real send (behavioral; excluded from this audit).
- Whether the legacy redirects return 301 and fall back to browse pages exactly per Handbook.md:307: registration is confirmed; response behavior is excluded from this audit.
- Whether the eleven captured subjects/bodies still match the live Wix system today: the corpus captures are the only reference available here.
- Whether the Wix contacts export includes the digest subscriber list (ADMIN-08 §15): needs the export itself.
- Whether staff-admin-only surfaces are indistinguishable from nonexistent routes for approvers in live responses: the code renders the identical NotFound component and the API guards share one sendNotFound helper (code-identity), but byte-level response equality is behavioral verification, excluded here.
