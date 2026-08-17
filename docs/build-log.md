# Build log

| ID | Status | Acceptance |
|---|---|---|
| org_member_approved | built, body is lorem ipsum pending capture | n/a |
| PB-01 | built | 9/10 — hero art: captured script-over-collage art assets not in repo; rendered as Open Sans caps heading per Design.md tokens |
| PB-02 | built | 16/16 — items rendered as one list (screenshot shows a paginator; spec §4/§13 silent, item counts small); mobile via breakpoint review |
| PB-03 | built | 9/9 — mobile via breakpoint review |
| PB-04 | built | 11/11 — role paginator skipped (same call as PB-02); success copy uncaptured, drafted from §8 expectations; repeat-interest fn behavior reported |
| PB-05 | built | 6/6 — first/last name persisted on digest_subscribers (0004, D65), resubscribe refreshes them to the submitted values; no people row (D27) |
| PB-00 | built | 1/2 — all four nav destinations wired and verified; screenshot-match line qualified: hero + tile photo/script art not in repo, typographic treatment per PB-01 precedent; TEDx URL captured nowhere in docs, phrase rendered bold unlinked; mobile via breakpoint review |
| review | hardened | architect review (1 severe, 3 moderate) fixed: POSTs+GET details now explicitly gate on org approved+member_org and request active — runtime role has BYPASSRLS so RLS filters nothing (Lane 0 finding, bears on proposed Task 7); thrown Resend sends now mark email_log failed instead of sticking queued; 5xx responses no longer echo internal error text; 409 refresh clears sold-out/full stale selections client-side |
| MP-01 | built | 5/5 |
| MP-02 | built | n/a |
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
| ADMIN-01 | built | 11/11 |
| ADMIN-02 | built | 14/14 |
| ADMIN-03 | built | 10/10 |
| ADMIN-04 | built | 10/10 |
| ADMIN-05 | built | 9/9 |
| ADMIN-06 | built | 10/10 (§16 trigger deferred to V-phase battery; mechanism proven by wild unresolved-var row + live resend failure) |
| ADMIN-07 | built | 8/8 (line 2 re-verifies once the nightly expiry job exists; §2 arrival links from 01–04 details not retrofitted — deep-link params supported) |
| ADMIN-08 | built | 10/10 (date-range filters compare LA days — fixed here, retrofitted to ADMIN-06/07) |
| Expiry job | built | boot pass archived 1 wild vol + 1 ZZ item fixture; re-run 0/0/0/0 idempotent; ADMIN-07 line 2 (expiry events appear as Automated) now verified |
| Architect review | run | 1 severe: staff-admin-only surfaces (04/05/08) loadable as empty shells by approvers client-side — APIs already 404'd byte-identically; fixed 3119610 (STAFF_ADMIN_ONLY_SURFACES gate + nav filter) |
| V1–V3 | verified | V1: all 9 stamped-approved requests have approved_at==approve-event created_at and approved_by==actor (tx-frozen now() ⇒ same tx); V2: live ZZ org round-trip — stamps survive the disable action; V3: Disable rendered for approved orgs + wild approved→disabled event exists |
| Migration Part 4 | blocked on inputs | data/legacy-export/ intentionally untracked and absent; contacts export never received (blocks users/org_memberships/digest_subscribers + §15); validation.sql deliberately NOT run against seed data; counter_drift=0 rows now |
