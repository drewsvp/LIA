# DECISIONS.md

Captain's rulings on the open items. Each cites the reasoning so a builder can tell whether a later change contradicts it.

**Standing tiebreaker** (`Handbook.md` section 3): the member organization is the client, the public donor is the user whose friction costs a filled need, the family served is the beneficiary and never appears in the system. On the portal and admin, the organization and the operator win. On public flows, the donor wins. Where they conflict, ask which choice results in more needs actually met.

When a ruling below closes an item, the answer goes into the relevant spec and the item is struck from `OPEN-ITEMS.md`.

---

## 1. The deviations

**D1. Claimed and interested counts are display only on the edit surfaces.** (MP-09, MP-12)

Tiebreaker says the organization wins on the portal, and this ruling favors the organization. An editable claimed count desynchronizes the counter from the pledge lines behind it, which makes the organization's own remaining count wrong, makes the public count wrong, and makes it impossible to tell whether a donor's claim was recorded. Received and confirmed stay fully editable, because those are the organization's own record of what arrived and who served, and they are not counters.

The one thing lost: an organization can no longer correct a claimed count itself. That is rare, and it is a staff action. Note it for phase two rather than building a back door.

**D2. The status selector never offers `active` to a member.** (MP-09, MP-12)

Members may submit for approval, archive an active request, and reopen an archived one back into approval. Publishing stays with staff at ADMIN-02.

Not a tiebreaker call. Staff approval of every public request is a governance property The Alliance already operates and the rebuild is supposed to make real. A member who can publish their own request has bypassed it entirely. The current system permits this, which is a defect rather than a feature.

**D3. Public claim and signup forms collect first and last name as two inputs.** (PB-02, PB-04)

Tiebreaker says the donor wins on public flows, and two short adjacent fields cost a donor almost nothing. Against that: single-field name splitting produces the parsing failure in `Handbook.md` section 16, and it is what stops a returning supporter from resolving to one person. Sam Ortiz and Samuel Ortiz stay one human only if the fields are stored as entered.

If capture shows the fields are already split, this deviation disappears.

**Superseded by D41** and `Handbook.md` section 8.

**D4. The request contact name on MP-07 becomes two inputs if capture shows it is currently one.**

Same reasoning as D3, and the alternative is worse here: this is the form that feeds the contact record on every item request. Logged as deviation nine, conditional on capture.

**Superseded by D41** and `Handbook.md` section 8.

---

## 2. Portal behavior

**D5. Any active member may invite. Any active member may remove.** (MP-05, MP-06)

The existing system documentation states plainly that no organization member has more power than another. That is The Alliance's model and it is not ours to change during a parity rebuild. Staff approval at ADMIN-03 is the control that makes open invitation safe.

**D6. A member cannot remove themselves, and the last active member cannot be removed.** (MP-05)

Overrides D5's flatness in exactly one place. An organization that removes its last member locks itself out and staff repair it by hand. Counted as a defect fix, not a deviation.

**D7. Items and roles cannot be removed on the edit surfaces.** (MP-09, MP-12)

Deleting an item that has pledge lines against it destroys a donor's record of what they promised. If capture shows removal exists today, it becomes a tenth deviation with the same ruling.

**D8. Concurrent edits: last write wins.** (MP-09, MP-12)

Two members of the same organization editing the same request simultaneously is rare at this scale, and optimistic locking costs a day of build time and a conflict UI nobody has specced. Revisit if it ever bites.

**D9. Both MP-02 strings are written fresh and approved by the captain.**

The zero-membership pending message and the organization switcher label describe situations the current system cannot produce. Nothing to copy. Drafts in MP-02 section 8; approved as drafted Aug 16 2026.

**D10. Public write endpoints are rate limited by IP with a per-endpoint ceiling.** (MP-03, PB-02, PB-04, PB-05)

Four public write paths on a system whose backend endpoints were publicly callable until now. Any reasonable mechanism beats none. Builder picks the implementation; the requirement is not optional.

---

## 3. Admin behavior

**D11. Staff keep the image upload at ADMIN-02.**

The operator is the paramount user of that surface, and staff adding a themed image before approval is documented existing practice. The alternative adds a round trip to every request and changes how the program has run for years. It writes `image_url` and nothing else.

**D12. Staff do not edit organization details before approving.** (ADMIN-01)

Confirm with Christina, but the default holds: if a submission is wrong, contacting the organization is the fix. A staff-edit path on organization data is a separate surface and not this week's.

O2 remains open. The Aug 14 answer ("I can edit an org's details however I need") was to a general question, not the pending-approval moment. Default stands until the sharpened question is answered.

**D13. Disable serves as the rejection path for pending organizations.** (ADMIN-01)

One action, one meaning: this organization is not in the network. A separate Reject would need its own status, its own event, and its own email question.

**Extended by D44.** Disable is available from any status, not only pending.

**D14. Disabling an organization does not archive its requests.** (ADMIN-01)

Public queries already filter on organization status, so disabling hides everything immediately. Leaving request statuses alone means re-approving restores the prior state exactly.

**Extended by D44.** Disable from any status still does not archive requests, and does not clear `approved_at` or `approved_by`.

**D15. Rejecting a membership does not require a note.** (ADMIN-03)

Nobody is emailed and nothing is explained to the person, so a required note is friction with no reader. Optional, and it lands in the audit trail if written.

**D16. Merge is a database function.** (ADMIN-04)

Multi-table reassignment plus a delete has to be one transaction. Same reasoning as the counter functions.

**D17. Clearing a review flag preserves `review_note`.** (ADMIN-04)

The record of what was ambiguous is worth keeping after someone decides it was fine.

**D18. Population slugs are permanent once assigned.** (ADMIN-05)

Nothing consumes them yet. Phase-two per-organization pages will, and a slug that changes after something links to it is a broken link. Costs nothing to treat as permanent from the start.

**D19. The operator may edit a free-text value's name before promoting it.** (ADMIN-05)

Organizations type inconsistently. The value as typed is a starting point, not a decision.

**D20. Other values group automatically, case-insensitively and on trimmed whitespace.** (ADMIN-05)

**D21. No reassignment action on a promotion name collision.** (ADMIN-05)

State the collision, let the operator rename. Building the reassignment path is speculative.

**D22. The email failure count appears in the admin navigation.** (ADMIN-06)

A failed login email is more urgent than a pending approval, and it is invisible everywhere else in the system. Nobody opens an email log on a normal day, so the failure has to announce itself where the operator already goes.

**D23. Stuck-queue threshold is fifteen minutes.** (ADMIN-06)

**D24. A resend of an already-delivered email renders a readable message, not a constraint error.** (ADMIN-06)

**D25. No CSV export on the audit trail.** (ADMIN-07)

An exported audit trail lives outside the system's access controls. Nothing in the definition of done needs one.

**D26. Staff cannot add a digest subscriber by hand.** (ADMIN-08)

Adding an address someone did not enter themselves risks the sending domain's reputation, which the phase-two send job inherits.

**D44. Organization disable is not limited to the pending-approval decision; it already works from any status.** (ADMIN-01 — extends D13/D14)

`organizations.status` in `0001_initial_schema.sql` allows `'disabled'` from any prior state — the CHECK constraint isn't scoped to pending-only. D13/D14 were written against the pending-approval flow specifically, but the database already supports what Christina described on the Aug 14 call: an already-approved, active org that doesn't renew, which she currently flags by hand after hearing about it in a staff meeting.

**No schema change required.** Two things actually need checking:
1. Whichever admin spec covers managing already-approved organizations (not the ADMIN-01 pending queue) needs a disable control exposed on it, if it doesn't already have one. ADMIN-01's Approved tab already has Disable; the spec now states it is available from any status, not only pending.
2. `approved_at` and `approved_by` on a disabled organization must not be cleared when it's disabled — that's the historical record Christina needs preserved for reporting. Confirm no code path in the disable action nulls them.

**Phase-two note, not this sprint:** the public query helper correctly filters on `organizations.status = 'approved'` per D14. When the reporting dashboard gets built, it needs a separate query that does not apply that filter, or a disabled organization's historical needs-met count silently vanishes from annual reporting. Recorded on the reporting-dashboard item in `Handbook.md` section 17.

**D45. Requests returned for changes: Christina contacts the organization herself, outside the system.** (ADMIN-02 — closes O1)

Closes O1. Christina's actual practice: minor fixes (spelling, splitting a bundled item into separate lines, trimming length) she makes herself without contacting anyone. Anything more substantive, she emails the organization's contact directly to ask before approving. The system doesn't need to notify anyone and there's no thirteenth email template. The return-to-draft screen needs only a reminder line telling her she still owns that outreach. That line is the existing `Return to draft prompt` in ADMIN-02 section 8.

---

## 4. Public and email

**D27. `digest_subscribers.person_id` is left null on both import and signup.** (PB-05, ADMIN-08, migration)

Backfilling a link later is easy. Untangling a wrong one is not.

**D28. Subscribing sends no confirmation email.** (PB-05)

There is no digest yet. An email confirming a list that sends nothing is confusing.

**D29. A previously bounced address that resubscribes is set to `subscribed`.** (PB-05)

A person actively re-entering their address beats a historical bounce.

**D30. `org_new_volunteer` keeps its captured subject line.** (TEMPLATES)

Several arriving at once are hard to tell apart, and adding the request title would improve that. It is also a bound artifact and the improvement is not worth the deviation. Phase two.

**D43. `approved_at` is left null on every migrated item and volunteer request. The eventual digest job filters on it being both non-null and within the lookback window.** (section 6, Migration)

`approved_at` already exists on both `item_requests` and `volunteer_requests` in `0001_initial_schema.sql`. Nothing populates it automatically; the migration script is the only thing that will ever touch it for a ported row. The prior system never reliably tracked approval timestamps (same finding D36 already made about `approval_events`), so setting `approved_at` to a fabricated historical date is dishonest, and setting it to the import timestamp would make every migrated request look newly approved the moment the real send job runs — which floods the first real digest with everything that migrated, exactly the outcome Tiffany is trying to avoid.

Leaving it null solves this without a new column. A request only becomes digest-eligible once a human actually approves it going forward, which is correct — that's the point at which it genuinely is new. How that timestamp gets set after the historical batch is D48.

Does not apply to `organizations.approved_at`, which still infers from `Updated Date`. That column isn't feeding a time-windowed filter. Revisit only if it (or a derived "member since") is ever displayed publicly or used to sort or filter a directory.

**No schema change required.** `docs/migration/field-map.md` is explicit: `approved_at` (and `submitted_at`, same reasoning) is not carried over from source and is left null on the one-time historical import, not derived from any Wix field. None of the 27 specs owns the digest send job — PB-05 is the subscribe form and ADMIN-08 is subscriber admin, not the send logic. Per the schema's own section 8 comment, the send job is phase two. Record the eligibility rule (`approved_at` is both non-null and within the lookback window) on that spec once it exists. Do not treat this as blocking the current sprint. The rule is parked on the digest-send item in `Handbook.md` section 17 until then.

**Extended by D48.** The null default is scoped to the one historical Wix migration batch. It is not a general import default, and it is not how live approvals work.

**D48. The null-`approved_at` rule in D43 applies only to the one-time historical Wix migration batch, not to any request that becomes active afterward.**

D43 solves the historical set. It doesn't by itself solve the handful of genuinely new posts D46 describes going in at real cutover — if those get loaded through the same path as the historical batch, they inherit the same null value and are just as digest-ineligible as everything else, which defeats the point of D46.

Two paths in, two rules:

- Anything that goes through the live product — an organization submits, staff approves at ADMIN-02 — gets a real `approved_at` the moment staff approves it. **Confirm as a build requirement, not an assumption:** ADMIN-02's approve action must write `approved_at = now()` and `approved_by`, distinct from the image-upload sub-action D11 already covers. If that write doesn't already happen, this is a gap to close before real cutover, not a documentation note.
- Anything loaded by any other means after the historical migration — a second scripted import, a manual batch load, whatever's fastest for cutover week — must set `approved_at` explicitly to a real, current timestamp as a required input. The null default is scoped to the one historical batch and nothing after it.

Preferred approach, not a hard requirement: run the cutover-week new items through the live submit-and-approve flow rather than a second scripted import. Same items either way, and the rule enforces itself instead of depending on someone remembering it under time pressure.

One more thing this settles rather than leaves open: there's no path today for staff to deliberately re-surface an already-active migrated item in a future digest. `MP-09`/`MP-12` edits don't touch `approved_at`, and `ADMIN-02`'s approval only fires on the pending-to-active transition, which a migrated row never goes through again. That's correct, not a gap — recirculating old content should be a deliberate action if it's ever wanted, not a side effect of an unrelated edit. Not building that action now; stating it so it isn't mistaken for an oversight later.

**D46. The Thursday demo digest does not send to the live subscriber list. Real cutover is the following week.** (PB-05, ADMIN-08)

Worth stating explicitly because "MVP by Thursday" has been read as "production system live by Thursday," which it was never scoped to be — `0001_initial_schema.sql` section 8 already limits this sprint's digest scope to the subscriber table and the import, and calls the send job itself phase two. Building an accelerated digest-eligibility fix under sprint-week pressure for an audience that isn't going to receive anything would be solving the wrong problem on the wrong deadline.

The hackathon demo shows the digest working. It does not activate it. Real cutover, with a real send to the current ~370 subscribers, happens the following week, once D43's eligibility logic and everything else is confirmed dialed in. That week is also when a small number of genuinely new posts get imported alongside the migrated set, so the real first digest reads the way any normal weekly digest does — a handful of new items, not sixty. Those new posts are not covered by D43's null default; they need a real `approved_at` per D48.

If the send job isn't built out for Thursday's demo, the digest gets shown manually. That is an acceptable outcome and not a fallback to apologize for.

---

**D51. Item and role lists in email bodies render as tables, not the MP-13 inline string.** (`org_new_item_donation`, `org_new_volunteer`, `donor_item_confirmation`, `donor_volunteer_confirmation`)

Captured source renders `Item | Number Donated` as a table and role lists under their own heading, matching what's live today, not the "3x Blankets, 2x Pillows" inline format MP-13 uses on screen. Both read the same computed data (`item_pledge_lines` / `volunteer_signup_roles`); the "email and screen never disagree" requirement is read as applying to the values, not the string format. Presentation differs by context.

**Correction, Aug 16 2026:** this decision's own contrast was written
against `Handbook.md`'s `3x Blankets, 2x Pillows` example for MP-13,
which turned out not to describe MP-13 either. MP-13 renders one item
per line, not that comma string. D51 itself is unaffected, email still
uses tables, this just corrects what it was being contrasted against.

**D52. `donor_volunteer_confirmation` states an explicit follow-up window: "within 1-3 business days."**

Captured source said only "soon," no number. The organization is committed to responding in 1-3 business days (`org_new_volunteer`), and Christina confirmed a 48-hour target is being hit in practice (O3). Decided to state it explicitly rather than leave it vague. PB-04's on-screen instructional copy now uses the same 1-3 business days window, closing the conflict with this decision rather than documenting it.

**D53. `org_new_volunteer` sends to both staff addresses in addition to the request's contact person.**

Captured source lists "the request's contact person & Alliance Admin" as recipients, where the original spec listed only the contact person. Built to match captured behavior. Low cost, reversible: if Christina says she doesn't want a staff copy of every volunteer-interest notification after go-live, this is a one-line change.

**D54. `staff_new_org`'s variable list expands from the original minimum (name, primary contact name/email, city) to the full captured set:** organization address, phone, and website, plus the primary contact's phone.

Captured source includes all of these. The original spec table was a placeholder minimum ("body must contain" language, not an exhaustive list); superseded by real content, not a deviation from it.

**D55. `staff_new_org` and `staff_new_user` each route to a single admin queue link, not the two separate CMS record links Wix sent.**

Wix sent a button to approve the organization record and a separate button to approve the contact record on `staff_new_org`. ADMIN-01 approves both, the organization and its owner membership, in one transaction, so one link replaces both. Same logic on `staff_new_user`: the captured button links to the person's record in the old contacts system; the replacement links to ADMIN-03, where the approval actually happens now.

**D56. `organizationName` is added to the variable lists for `org_new_item_donation` and `org_new_volunteer`.**

Both original spec tables omitted it despite the greeting line ("Hi {organizationName}") requiring it in every captured body. Spec completeness fix, not a design decision.

**D57. `org_approved`, `org_request_received`, and `org_request_approved` greet by organization name, not a contact's first name.**

Captured source consistently opens "Hi {organizationName}," across all three. Supersedes the placeholder `contactFirstName` / `submitterFirstName` / `recipientFirstName` variables in the original spec tables.

---

## 5. Schema decisions, ratified

**D31.** `approval_events.entity_type` accepts `person`, so the duplicate merge is auditable.

**D32.** The email dedup index includes `to_email`, so multi-recipient templates do not silently drop their second recipient.

**D33.** Volunteer requests do not auto-archive when every role fills. Interest is not commitment. Item requests still do.

**D34.** The auto-archive inside `record_item_pledge()` writes its own `approval_events` row. Invariant 4 has no exceptions.

All four are already in `migrations/0001_initial_schema.sql`.

---

## 6. Migration

**D35. `owner` role is inferred from the organization's primary contact email.** The source has no role concept. Anything else requires a human to assign 49 owners by hand.

**D36. No `approval_events` backfill.** The source records neither actor nor timestamp for approvals. An empty audit trail with a known start date is honest; a fabricated one is not.

**D37. `email_log` is seeded as `sent` for organizations whose approval email already went out.** Otherwise a staff member touching an approved record can re-welcome an organization that joined two years ago.

**D38. Images are rehosted on the app's own storage.** Source-hosted URLs are outside our control and break whenever the source site changes.

**D42. All active LIA requests migrate as-is; no pre-migration outreach or cleanup pass.**

Tiffany proposed confirming with organizations whether older unmet requests are still live before porting them over. Reasonable instinct, but sprint week doesn't leave room for a campaign whose answers could still be arriving after the import target has moved. An org replying "cancel that" on Wednesday is a data problem discovered late rather than one avoided.

Everything active in the source migrates. The staleness Tiffany is worried about gets handled after real cutover instead — see D43 and D46 for why "after cutover" doesn't mean "next Thursday."

Migrated item and volunteer requests leave `approved_at` and `submitted_at` null on the historical batch only; see D43 and D48.

---

## 7. Where images are hosted

**D39. Replit object storage for the sprint, with the storage adapter behind one interface.**

It is available immediately, needs no account setup on Monday morning, and costs nothing during the build. The risk is the platform lock-in we are otherwise avoiding, which is why every read and write goes through a single adapter module. Moving to S3-compatible storage after the sprint is then one file plus a copy job over roughly 60 images.

If a bucket already exists on an account The Alliance controls, use that instead and skip the migration later. Ask during the kickoff; do not wait on it.

---

## 8. Login method

**D40. Magic link, unless Tiffany objects.**

This one is close and worth showing the reasoning.

The keep-it-the-same constraint argues for passwords, since that is what members do today. Against that: member organizations have staff turnover, forgotten passwords are the most common support request any portal generates, and every one of them currently lands on Christina or Tiffany. Magic link removes password reset from the system entirely, and it is native to the auth and email stack we already chose.

Tiebreaker says the organization wins on the portal. The organization's interest is getting into the system reliably, not preserving a specific credential ritual, and a member who has not logged in since March is more likely to succeed with a link than with a password they will have to reset.

This is the most visible change to the login experience, so it goes to Tiffany as a notification with the reasoning, not as an open question. If she says passwords, we build passwords; the auth library supports both and the cost of switching is under a day if decided before Wednesday.

**Confirmed.** Tiffany reviewed this reasoning on the Aug 14 call and did not object. Closes B5.

---

## 9. Person identity and name policy

**D41. Person identity and name policy, app-wide.** (Adopted August 13, 2026)

**Policy:** `Handbook.md` section 8. Email identifies a person; names are display data stored in two columns exactly as entered; public flows update names in place on email match; phone-match creates a review flag without blocking the supporter; migration preserves ambiguous originals in `source_note` and flags with `review_note`.

**Also settles:**
- The `source_note` versus `review_note` split in migration and ADMIN-04.
- ADMIN-04 is an ongoing operational surface, not only a migration artifact.
- Deviation eight in `Handbook.md` section 4.2 is policy, not a pending sign-off.
- **Supersedes D3 and D4.** The two-input rule now applies app-wide rather than surface by surface.

---

## 10. Brand assets

**D49. Alliance logos and page graphics are in `assets/`.** (closes B9)

Two logo variants (`alliance-logo-blue.png`, `alliance-logo-gradient.png`), page headers under `assets/headers/`, and member-dashboard graphics under `assets/member_dashboard_graphics/`. No further ask of the executive director. `Design.md` covers color and type tokens; this folder covers raster brand assets.

**D50. Member-organization logos are out of scope for this sprint.**

They are not in the LIA CMS. They live on the public Alliance site's non-profits page, which is part of the main site and is not being retired alongside LIA. `organizations.logo_url` stays in the schema and stays null on every migrated row; no surface renders it this week.

It gets populated when the per-organization shareable page is built in phase two — that page is the reason the column exists. Harvesting the 62 logos is a small Playwright job at that point, not now.

Closes the open item in `docs/migration/field-map.md` section 20.

---

## 10a. Build requirements stated inside decisions

Two rulings above contain build requirements rather than documentation notes. Both are Lane C verification items and are listed in `OPEN-ITEMS.md` section V so they have an owner.

**From D48:** ADMIN-02's approve action must write `approved_at = now()` and `approved_by` in the same transaction as the status change. If it does not, every request approved during cutover week is invisible to the first real digest.

**From D44:** the organization disable action must not clear `approved_at` or `approved_by`. That is the historical record Christina needs for annual reporting.

---

## 11. Still genuinely open

O1 closed as D45. O3 is answered and kept here for the record. Remaining unanswered Alliance questions are O2 and O4; remaining outstanding sends are O5, O6, O7, and O8.

### Needs The Alliance to answer

| # | Question | Who | How to ask it |
|---|---|---|---|
| O2 | You mentioned you can edit an org's details in the backend — is that something you do as part of approving new organizations, or is it separate ongoing maintenance you do any time? If it's separate, does phase one need to replicate it, or can that wait? | Christina | The Aug 14 answer was to a general question, not specifically about the pending-approval moment. D12's default stands until this is answered |
| O3 | Volunteers are told the organization will follow up within a stated window. Is that number still right, and do organizations hit it? | Christina | **Answered.** Christina confirmed on the Aug 14 call: 48-hour target is being hit in practice; extends only when there's genuine back-and-forth with the org, which is expected. No change to the stated window. Literal copy capture for the confirmation screen is still open — see capture walkthrough, section C |
| O4 | After the sprint, how does a new Alliance staff member get access? | Tiffany, Christina | This week the answer is a database write, which is not durable. Needs a real answer before handover, not before Monday |

### Needs confirmation before Friday demo

None. O12 and O13 closed Aug 16 2026 (PB-04 follow-up window harmonized to D52; PB-05 digest-only scope confirmed with phase-two path in `LIA_Phase_Two_Backlog.md` item 9).

### Needs The Alliance to send something

| # | Ask | Who |
|---|---|---|
| O5 | Staff list with roles: who approves, who administers | Tiffany |
| O6 | From address, display name, and the two staff notification addresses | Tiffany |
| O7 | Confirmation that the screenshot folder includes mobile, or that it does not | Tiffany |
| O8 | DNS access for the `lia` subdomain | Tiffany |

### Blocked on an artifact, not on a decision

| # | Question | Unblocked by |
|---|---|---|
| O10 | Everything in `OPEN-ITEMS.md` section C | The capture walkthrough. Not questions, just work |
| O11 | Everything in `OPEN-ITEMS.md` section TE | The test export |

O9 closed as D61 (Christina, Aug 16 2026). Do not reopen.

---

## 12. Infrastructure

**D58. The database runs on Replit's managed Postgres (Helium),
development and production, and may stay there permanently. Portability
is preserved through driver choice, not through migrating.**

Replit's own hosting is a legitimate long-term home for this system, not
a stopgap. Tiffany running LIA entirely within a platform she already
pays for is a real convenience, not a compromise, and nothing about the
architecture requires leaving it. This decision does not schedule a
migration, does not require verifying one, and does not treat staying on
Replit as something to correct later.

What it does require: **the application never imports
`@neondatabase/serverless` or any Neon-specific query client.** Every
database call, including Better Auth's own connection, goes through
standard `pg` (node-postgres) over a normal TCP connection string. That
one rule is what keeps the door open. It costs nothing to follow whether
or not the door is ever used, and it means that if a future maintainer
ever does want to move this to Neon, Supabase, or anywhere else, the
change is one environment variable, not a rewrite. Same shape as D39's
approach to image storage: pick the convenient default, keep one clean
interface, no deadline attached to leaving it.

Closes the open item "verify Replit actual DB connection details" in
`OPEN-ITEMS.md`. There is nothing left to verify; Helium is the answer, and
it's a fine one.

---

## 13. Capture-inferred scope

**D59. MP-05 combines organization detail editing and member management on one surface.** (closes C4)

MP-04's dashboard has exactly one tile for organization-level changes,
"Edit My Organization," distinct from "Add Another User," which is
create-only and maps to MP-06. No third tile exists for removing or
managing members. Since D5/D6 already establishes that any active member
can remove another, that function has to live somewhere, and "Edit My
Organization" is the only candidate the dashboard offers.

Inferred from MP-04-desktop.png, Aug 16 2026, not from a direct capture
of the surface itself. If a screenshot of "Edit My Organization" surfaces
before build and shows otherwise, this ruling reverses without ceremony,
it was never load-bearing on anything except this one surface's shape.

---

## 14. Layout and populations

**D60. Mobile layout is a single-column stack of the same elements, same order, same labels as desktop, unless a spec explicitly captures a specific deviation.**

Confirmed against MP-01 and MP-04's mobile captures, both stack cleanly with nothing restructured or dropped. Build mobile using standard responsive conventions, full-width fields and buttons, one-column grids, collapsed nav, rather than waiting on a mobile screenshot for every surface. This closes "mobile differences" as an open item across every remaining spec that doesn't already have mobile-specific evidence contradicting it.

**D61. Population checklist is unified across the app, using the exact ten values on MP-03's signup form, confirmed directly by Christina.** (closes O9)

Superseded reasoning: this was previously going to seed from the 24 distinct historical values in `data-audit.md` section 4. That's wrong; those 24 are years of drift across a checklist that's changed shape multiple times, not a taxonomy anyone signed off on. Christina confirmed Aug 16 that the current MP-03 screen is the correct list to standardize on. Use it as written: At-Risk Kids/Teens, Youth in Foster Care, Transitional Age Youth/Young Adults, Unhoused Teens/Families, Foster/Adoptive Families, Refugee Families, Single Parents, Women Facing Unplanned Pregnancies, Families/Young Adults in Crisis, Youth with Disabilities/Health Issues, plus **Other**, which the schema already requires as a permanent seeded row (D19/D20).

**Near-duplicate merges on migration:** Foster Youth → Youth in Foster Care; Transitional Age Youth/Aged-Out Youth → Transitional Age Youth/Young Adults; Single Moms → Single Parents.

**Migration:** the eleven remaining historical values with no home in the ten (Children or Families in Need, Low-income Communities, Hunger & Homelessness, Women, Pregnancy Support, Faith-Based Service, Social Workers, Birth Parents Reunifying with Kids, Immigrants, Local Agencies/Nonprofits, Other) are not seeded as `populations` rows and are not silently dropped either. Preserve them per organization in `populations_other` as free text, comma-separated if an org selected more than one. Real data, real orgs, kept, just not promoted to checkboxes nobody confirmed.

MP-05's edit checklist changes from its current fifteen values to the same ten plus Other, matching MP-03 exactly, per Christina's own framing that this is "the list we need to standardize across the app," not a list specific to signup. Both forms read from the same `populations` table. MP-03 signup keeps the 1-2 selection cap; MP-05 edit has no stated maximum.

---

## 15. Recorded during the build (Aug 17 2026)

**D62. Numbered migrations with a tracked runner supersede the single-file rule. `0001` is immutable once applied.**

Migrations apply in filename order via `server/db/apply-migrations.ts` (`npm run db:apply-migrations`), which records a sha256 checksum per applied file and never reapplies or edits one. Current files: 0001–0004.

**D63. Row-level security is inert under the current runtime role. Authorization is enforced in route code and the data-access layer.**

The runtime connection role holds BYPASSRLS: policies exist and RLS is enabled and forced on all 17 application tables, but they filter nothing at runtime. Any future change to the database role must be verified against this assumption rather than presumed to strengthen it.

**D64. `merge_people()` is created in 0003, not 0001.**

**D66. Magic-link verification is POST-confirmed. A GET on the emailed link consumes nothing.**

Testers were getting "that login link is no longer valid" within a minute of delivery, without having clicked anything. Better Auth's `GET /api/auth/magic-link/verify` consumes the `verification` row on sight, and mail-security scanners and link prefetchers follow every URL in an inbound message before the human sees it. The scanner spent the link; the member got the error.

Verification is now two steps. The GET is intercepted ahead of the Better Auth catch-all and only redirects to MP-01C (`/login/verify`), carrying the token and nothing else — no session, no consumption, no state change of any kind. `POST /api/login/magic-link/verify` does the real work, and scanners do not issue POSTs.

Within its 15-minute window the token is replayable: the row is restored after each successful confirmation, so a double click, a reload, or a second device returns a session rather than an error. Only two things refuse a token — expiry, and supersession by a newer still-valid link for the same email. Requesting a new link remains the way to retire an old one.

Four constraints worth keeping:

- **Every timestamp comparison happens in SQL.** `verification` stores `timestamp without time zone` at microsecond precision; a JS `Date` truncates to milliseconds, which made a token compare as newer than itself and report as superseded on its very first use. The row's stamps are carried as text solely so it can be restored byte-for-byte.
- **Supersession is decided entirely in SQL, including the email match.** Matching the email in Node over a capped page of candidate rows would let a newer token fall outside the page and quietly revive a link that should have been retired.
- **Confirmations of the same token are serialized in the process.** Better Auth's consume deletes *every* row sharing the identifier, so the token is genuinely absent between the provider call and the restore. Without the per-token chain, a second click landing in that gap is told a perfectly good link is invalid. Writing a spare row up front does not work — the provider's delete takes it too.
- **The interceptor drops `callbackURL`.** The POST resolves the destination from the account (supporters to `/profile`, everyone else to `/dashboard`), so no caller-supplied redirect target reaches the browser.

Quick login is unaffected: it calls `auth.api.magicLinkVerify` directly and never travels the HTTP GET path.

**D65. `digest_subscribers` stores first and last name. PB-05 persists both. No people row is created on subscribe.**

Two nullable text columns (0004), stored exactly as entered, never concatenated (§8 rule). A resubscribe updates the stored names to the values just submitted, matching how the email address behaves. D27 stands.

---

## How to run O2 with Christina

O1 closed as D45 (she contacts the organization herself). O3's 48-hour window is confirmed; literal confirmation-screen copy is still a capture item, not a question for her.

The remaining question is O2, sharpened after the Aug 14 call. She said she can edit an organization's details in the backend "however I need," but that was a general answer, not about the pending-approval moment:

- You mentioned you can edit an org's details in the backend — is that something you do as part of approving new organizations, or is it separate ongoing maintenance you do any time? If it's separate, does phase one need to replicate it, or can that wait?

D12's default stands until she answers: staff do not edit organization details before approving.

Every answer maps to a decision above without her ever seeing a decision. That is the right shape for this: she is the domain expert on the workflow, not a reviewer of our design choices, and asking her to rule on a schema question would be asking her to do our job.
