# SPRINT.md

**Love in Action rebuild, SVP AI for Good Hackathon, August 17–21, 2026**

This file coordinates the week. It is for people, not agents. Nothing here is a build instruction; the build contract is `Handbook.md`.

---

## Before Monday

Ordered by what they block, not by effort.

### Critical path

| Ask | From | Blocks | Status |
|---|---|---|---|
| **Test export**, sample from all six CMS collections | Site owner | The entire migration lane. Answers the four questions in section "Test the export" below | Open |
| **Contacts export**, including labels and marketing subscriptions | Site owner | Member approval state and the subscriber list. Not in the CMS and not reconstructable any other way | Open |
| **Email body copy**, all twelve templates from the sending platform's editor | Site owner, likely needs owner-level access | Lane B's copy. Subjects are known; bodies have never been read by anyone on this team. On arrival, check whether the new-user-login approval template is obsolete under magic link (D40, B3). Formal mobile capture of the 12 is waived (B3); that does not answer screenshot-folder mobile coverage | Open |
| **Staff list and roles** for the platform-owner organization | Executive director | All admin testing. Nobody can log into `/admin` until these memberships exist | Open |
| **Image hosting decision** | Captain | Lane C, plus MP-03, MP-07, MP-10 | Open |
| **Login method**, magic link or password | Executive director | MP-01, the auth lane, and two email templates | **Confirmed.** Magic link (D40). Tiffany reviewed on Aug 14 and did not object |

### Also needed

| Ask | From | Blocks | Status |
|---|---|---|---|
| Screenshot folder, confirm desktop and mobile coverage | Executive director | Every bound surface | Open |
| DNS access for the `lia` subdomain | The Alliance | Deployment | Open |
| Brand assets: logo files | Executive director | Nothing. `Design.md` covers the tokens | **Decided.** Logos and related graphics in `assets/` (D49) |
| Feature list | Executive director | Nothing. Triaged to phase two by default | Requested, not received |
| Builder skill check: Replit experience, prior AI-assisted building | Team | Lane assignment | Open |

If the contacts export cannot be produced, say so Monday morning rather than Thursday. The fallback is staff re-approving the current member list by hand at ADMIN-03, which costs someone most of a day and needs scheduling, not discovering.

---

## Test the export

The single highest-value pre-Monday task. Four questions, one sample export, roughly an hour.

1. **Per-item quantity arrays.** Does the export preserve the array structure, or flatten it to text?
2. **Multi-reference fields.** What delimiter, and do they hold record ids or display names?
3. **Structured addresses.** Structured sub-parts, or a flattened display string? `city` is required on every approved organization and it renders as the location on both public browse surfaces.
4. **Image references.** Internal references or resolvable URLs, and do they match the harvest manifest?

While the export is open, run `select distinct` on four fields and send the results: Deadline Type, Item Condition, Need Status, and Primary Population Served. Ten minutes, and it is the difference between a clean import and three hundred exception rows.

Also count, from the Donors collection: rows with no quantity array, rows carrying both an item and a volunteer request reference, rows carrying neither, and rows with no email. Those four counts size the review queue and predict where the migrated numbers will be wrong.

Also count, from contacts joined to Organizations: rows whose first_name exactly matches an organization name (TE10). Report the count; do not auto-correct. It sizes a manual scrub of the contacts CSV, not an automated cleanup step.

---

## Schedule

| When | What |
|---|---|
| Monday 9a–12p | Kickoff, in person, required |
| Monday, first two hours after kickoff | Surface capture walkthrough, in parallel with Lane 0 |
| Monday EOD | PRD milestone. Lane 0 contracts published: migrations applied, data-access signatures, route table, seed data |
| Tue–Thu 10a–12p | Optional in-person build at Frequency Coworking |
| Daily AM and PM | 15-minute stand-up, Zoom |
| Wednesday | Side-by-side testing begins |
| Thursday AM | Testing milestone. Christina's walkthrough |
| Thursday PM | Presentation ready. Demo digest does not send to the live subscriber list (D46) |
| Friday 11a–1p | Final presentations, in person, required |
| After | Rollout roadmap session, then real cutover the following week (D46) |

SVP's expectation is 10 to 12 hours per person across the week, and 2 to 4 hours per week afterward for whoever owns rollout.

---

## The surface capture walkthrough

Monday morning, before anyone writes UI code, one person walks every bound surface on the live site. Roughly two hours, and it unblocks four days of work.

A meaningful share of the current system's behavior is configured in the visual editor and appears in no readable file: dataset filters, sort order, page size, required-field markers, element bindings, repeater layout, all static instructional copy, and the entire mobile layout, which is a separate layout rather than a breakpoint.

**The specs are the checklist.** Every `docs/specs/{ID}.md` ends with an open-captures table listing exactly what that surface needs. Work through them file by file rather than taking freeform notes.

For each of the nineteen bound surfaces:

1. **Desktop screenshot**, full page.
2. **Mobile screenshot**, separately.
3. **Field list in visual order**, with exact label text and which are required.
4. **Verbatim microcopy.** Every success message, error message, empty state, button label, and helper line. Copy and paste. "Your request has been submitted for approval" and "Request submitted!" are not the same product.
5. **Conditional behavior.** What appears, disappears, enables, or disables, and on what trigger.
6. **Empty states**, captured independently where a surface has more than one.
7. **Sort order and page size** on any list or repeater.

Files to `docs/screenshots/{ID}-desktop.png` and `-mobile.png`, notes into the spec's open-captures table.

### The highest-risk captures

Everything matters, but these break testing if missed:

- **MP-13's item summary format.** The exact separator and spacing in `3x Blankets, 2x Pillows`. It is now computed rather than stored, it also appears in an email, and any difference is instantly visible.
- **MP-04's dropdown option format.** Members scan those lists by date; the separator and date format both need capturing.
- **MP-07's contact name.** One input or two. If one, it is a captain decision, not a build decision.
- **MP-05's scope.** Whether it edits organization details or only members. Changes the shape of the surface.
- **PB-02's agreement checkbox.** Whether it exists, its verbatim text, and whether it blocks submission.
- **PB-03's location value.** Whether the card shows event location, organization city, or both. They are not interchangeable.
- **Search debounce** on PB-01 and PB-03. Time it if a number cannot be read.

---

## Testing

**The side-by-side.** Live site on one screen, rebuild on the other, walked surface by surface. Field order, labels, copy, conditional behavior, empty states, desktop and mobile. Green before Christina sits down, so her time goes to feel rather than to finding missing fields.

**Christina's walkthrough.** She runs this program daily and knows what normal feels like better than any checklist. Full member journey, unassisted: sign up, create an item request, add items, submit, edit, view supporters. Any moment she hesitates is a defect, whether or not the surface matches its screenshot.

**The five failure tests** in `Handbook.md` section 16. Run them, record the results in a table. Quality gate and presentation material both.

**Two concurrency tests that need deliberate setup:** two simultaneous claims on the last remaining item at PB-02, and two simultaneous signups for the last spot at PB-04. Each should produce one success and one handled failure, with `counter_drift` still returning zero rows. These will not happen by accident during testing and they will happen in production.

---

## The judging package

SVP judges credible impact with real users, not how much got built. Gather the evidence during the week, not Thursday night.

**Credible ROI.** The strongest numbers available: one to two production faults per month going to zero on a version-controlled stack; staff time on manual member approval going to a single action; duplicate supporter records collapsing to one person, where the migration's final `people` count against 111 donor rows is the headline number. Capture the current-state figures early from Christina and Tiffany while there is time for a follow-up question.

**Easy use and setup.** Setup under a minute, first value within five. Christina's unassisted walkthrough is the proof. Record it.

**Aligned rollout plan.** Named people, milestones, deadlines, working backward from cutover. The sequence is written: deploy on the subdomain, run and validate the migration, confirm deliverability, import redirects, repoint the nav links, dual-run with a few friendly member orgs, cut over. Christina is the long-term maintainer with Tiffany as functional backup, and both are on the build so they learn the system by building it rather than inheriting it cold.

**Presentation.** Five minutes, live demo, real end user on stage.

The bonus round on multi-org reusability requires showing leadership that core scope is fully delivered first. Treat it as out of reach unless the core lands early, and do not let it pull scope.

---

## Roles

| Role | Person |
|---|---|
| Team captain | Scott |
| Nonprofit contacts | Tiffany, Christina |
| Builders | Mihran, Rachael, Drew |
| Long-term maintainer | Christina |
| Functional backup | Tiffany |
| Acceptance walkthrough | Christina |

Lane assignments in `Handbook.md` section 15, confirmed Monday after the builder skill check.

---

## Decisions the captain owes the team

`Handbook.md` section 19 is the full list. The ones that stop work if unanswered Monday: image hosting, the staff roster, and sign-off on deviations six and seven. Login method is confirmed: magic link (D40).

The rest can be answered as they come up, but the three deviations are worth settling in the kickoff, because they touch four surfaces and two of them narrow what a member can do.

---

## Working agreements

Post in team channels rather than direct messages so anyone can help. Keep real client data and credentials out of the chat platform entirely; the exports carry contact details for roughly a hundred members of the public.

Surface IDs go in branch names, commit messages, stand-up updates, and screenshot filenames.

`[CAPTURE]` in a spec means the value is unknown. Nobody invents one, including humans filling in specs. An empty marker is correctable; invented copy is not, because afterward nobody can tell which values were real.

New features do not get added mid-week. SVP's own rule is that features come only after core scope is delivered, a mini-rollout has happened with real users, and leadership has signed off. Ours is stricter: parity, security, migration, and stability under a named owner come first.
