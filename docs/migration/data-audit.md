# docs/migration/data-audit.md

Findings from the full CMS export, pulled 2026-08-14. This file replaces every
`[CAPTURE]` and every "expected, not confirmed" value in `field-map.md`.

Nothing here is inference. Every number is counted from the export.

**Export freeze point: 2026-08-14, roughly 20:30 UTC.** The live system moved
between two exports taken the same afternoon: request `83c41e41` was `Active` at
17:00 and `Archived` at 20:21. Re-pull before the production run and re-run this
audit. Do not migrate from these files after Monday.

---

## 1. Actual volumes

The 676-row baseline in `Handbook.md` section 14 and `field-map.md` section 1 is
stale by about 16%. Corrected:

| Collection | Baseline | Actual | Feeds |
|---|---|---|---|
| Organizations | 48 | **49** | `organizations`, `people`, `populations` |
| Needs Requests | 100 | **120** | `item_requests`, `people` |
| Items | 336 | **403** | `items` |
| Volunteer Requests | 23 | **24** | `volunteer_requests`, `people` |
| Volunteer Roles | 58 | **58** | `volunteer_roles` |
| Donors | 111 | **127** | pledges, signups, lines, `people` |
| **Total** | 676 | **781** | |

Imported counts after exclusions: organizations 49 (+1 platform owner),
item_requests 116, items 395, volunteer_requests 24, volunteer_roles 54,
item_pledges 83, volunteer_signups 38, item_pledge_lines 173, people 160.

Update `Handbook.md` section 14 and `field-map.md` section 18 to these numbers.
The section 18 validation table asserts exact counts and will fail on all six.

---

## 2. Status distribution

Christina's first export was filtered to `Active` and covered 44 of 120 item
requests. The full export:

| Status | Item Requests | Volunteer Requests |
|---|---|---|
| Active | 43 | 12 |
| Archived | 69 | 11 |
| Pending | 6 | 1 |
| null | 2 | 0 |

**Six pending item requests and one pending volunteer request exist.** These are
the only real test fixtures for ADMIN-02's approval queue. Do not drop them.

Organizations: 48 `APPROVED`, 1 `PENDING` (Purple Paws For Peace, created
2026-07-22). One real pending row for ADMIN-01.

---

## 3. The four at-risk field types (TE1–TE4), all resolved

### TE1 — Per-item quantity arrays: **structure preserved**

`Item to Quantity Array` exports as parseable JSON:

```json
[{"donatedQuantity":1,"itemId":"ab4bdbb8-...","itemName":"Sensory swing"}]
```

89 donor rows carry it. **170 pledge lines total. Zero parse failures. Zero
orphan `itemId` values.** Every referenced item exists in the Items collection.

This was the highest-flagged migration risk in the corpus. It is clean.

### TE2 — Multi-reference fields: **JSON arrays of record ids**

`Items`, `Volunteer Roles`, and `Donors` all export as JSON string arrays of
UUIDs, not display names, not delimited text:

```json
["337d8eb1-c3cd-4880-90ea-3adf41bc9819","f99703cd-46c6-48a7-9c19-5bc464a39eda"]
```

Parse with a JSON parser. No delimiter guessing.

Note: the *parent-side* multi-reference columns are all empty and useless.
`Item Requests.Items`, `Volunteer Requests.Roles`,
`Items.AreaNeeds-NeedsRequests_items`, and
`Volunteer Roles.AreaNeeds-VolunteerRequests_roles` are null across every row.
Child rows carry the parent reference; that is the only usable direction.

### TE3 — Structured addresses: **mixed, five distinct shapes**

| Shape | Orgs |
|---|---|
| Full: city, country, formatted, location, postalCode, streetAddress, subdivision, subdivisions | 18 |
| Full plus `countryFullname` | 7 |
| Full minus `postalCode` | 8 |
| Full minus `postalCode`, plus `countryFullname` | 5 |
| **`formatted` only** | 10 |
| Null entirely | 1 |

Parse defensively. Every key is optional.

**`streetAddress` is a nested object** — `{"number":"","name":"","apt":""}` — and
in the sampled rows all three sub-values are empty strings. Do not expect a
usable street line. `address_line1` will be null for most organizations. That is
fine; nothing renders it.

**11 organizations have no resolvable `city`.** Since `field-map.md` section 8
makes a null `city` on an approved organization a blocking validation failure,
these 11 must be filled by hand before the production run:

Acres of Hope, Heart Behind The Badge-Sac County, Roseville Police Activities
Leauge, Dignity Health Medical Foundation, Lost But Not Forgotten, MISI, Kingdom
Roar Ministries, Traveling Handyman Inc., Embrace Grace/PHCM, Redemption Youth
Ranch, Placer Justice Foundation.

Ten of these have a `formatted` string that can be parsed for city. Roseville PAL
has no address object at all. **Assign this to Christina as a 15-minute task.**

### TE4 — Image references: **internal `wix:image://` references**

Format:

```
wix:image://v1/b770af_f2e9d78071d24dc3a2ca4015e9037ebd~mv2.png/Casa%20grandma.png#originWidth=...
```

Extract the media id between `wix:image://v1/` and the next `/`. All 49
organization logos match the `~mv2` genuine-upload pattern; zero template
graphics to exclude.

**Manifest coverage, verified against the manifest's `legacy_wix_id` column:**

The manifest keys on the item-request and volunteer-request UUID. Confirmed
against both collections; every one of its 56 rows resolves.

| | Active | Have image ref | In manifest |
|---|---|---|---|
| Item requests | 43 | 43 | **42** |
| Volunteer requests | 12 | 12 | **12** |

**One gap:** active item request `c95239e9-54a5-4385-9fc5-d5f4bec50ed4` has a
Wix image reference but was not harvested. Re-run the harvest for that single
record.

Two manifest entries have since gone `Archived` (`60f95140`, `83c41e41`). Keep
the files; they still attach to real rows.

Across the whole corpus: 96 of 120 item requests and 21 of 24 volunteer requests
carry an image reference. The 27 without are historical and get a null
`image_url`, as already accepted in `field-map.md` section 10.

---

## 4. Distinct-value scans, confirmed

### Deadline Type

| Source value | Item Requests | Volunteer Requests | Target |
|---|---|---|---|
| `Until Fufilled` *(sic)* | 78 | 0 | `until_fulfilled` |
| `Ongoing` | 27 | 17 | `ongoing` |
| `Date Specific` | 14 | 7 | `date_specific` |
| null | 1 | 0 | default per side |

**The source misspells "Fulfilled" as "Fufilled" on 78 rows.** Match the typo
exactly in the mapping and do not carry it into the database.

### Item Condition — 12 variants, all casing and phrasing noise

| Source value | Rows | Target |
|---|---|---|
| `New` | 243 | `new` |
| `New or Like New` | 119 | `new` |
| `Gently Used` | 16 | `gently_used` |
| `Used - Functional` | 5 | `gently_used` |
| `NEW` | 4 | `new` |
| `New ` *(trailing space)* | 3 | `new` |
| `New or like-new` | 3 | `new` |
| `New or like new` | 2 | `new` |
| `New/Gently Used` | 2 | `any` |
| `Used - Like New` | 2 | `gently_used` |
| `New or like New` | 1 | `new` |
| `new` | 1 | `new` |
| null | 2 | `any` |

The schema constrains `condition` to `new`, `gently_used`, `any`. Trim and
lowercase before matching, or the trailing-space and casing variants fall
through to the default and generate 11 needless exception rows.

`New/Gently Used` maps to `any` because it explicitly accepts both. The captain
should sanity-check the `New or Like New` → `new` collapse; it is 119 rows and
it is the only mapping decision here that loses information.

### Need Status

`Active` → `active`, `Archived` → `archived`, `Pending` → `pending`. Two item
requests have a null status; both are abandoned drafts and are excluded
(section 6).

### Primary Population Served — 24 distinct values

| Value | Orgs | | Value | Orgs |
|---|---|---|---|---|
| Foster/Adoptive Families | 22 | | Transitional Age Youth/Aged-Out Youth | 4 |
| At-Risk Kids/Teens | 21 | | Hunger & Homelessness | 4 |
| Families/Young Adults in Crisis | 16 | | Single Moms | 4 |
| Youth in Foster Care | 15 | | Women | 4 |
| Single Parents | 11 | | Women Facing Unplanned Pregnancies | 3 |
| Unhoused Teens/Families | 10 | | Other | 2 |
| Transitional Age Youth/Young Adults | 9 | | Pregnancy Support | 2 |
| Children or Families in Need | 8 | | Faith-Based Service | 2 |
| Low-income Communities | 8 | | Social Workers | 2 |
| Foster Youth | 6 | | Birth Parents Reunifying with Kids | 2 |
| Refugee Families | 6 | | Immigrants | 1 |
| Youth with Disabilities/Health Issues | 6 | | Local Agencies/Nonprofits | 1 |

`Other` already exists as a source value on two organizations. Under **D61**, the canonical checklist seeds **Other** as a permanent row (D19/D20); historical source tags that do not map to the ten canonical values are preserved in `populations_other` per organization — see section 7 / `field-map.md` section 7.

**Near-duplicate merges, closed as D61 (Christina, Aug 16 2026):**

- Foster Youth (6) → **Youth in Foster Care**
- Transitional Age Youth/Aged-Out Youth (4) → **Transitional Age Youth/Young Adults**
- Single Moms (4) → **Single Parents**

**Eleven historical values with no home in the ten** are not seeded as `populations` rows: Children or Families in Need, Low-income Communities, Hunger & Homelessness, Women, Pregnancy Support, Faith-Based Service, Social Workers, Birth Parents Reunifying with Kids, Immigrants, Local Agencies/Nonprofits, Other (when present as a non-canonical source tag). Written to `organizations.populations_other` per org, comma-separated if multiple. Not silently dropped.

**Seed eleven `populations` rows total:** the ten canonical MP-03 checkbox values plus Other. O9 closed; do not default to seeding all 24.

---

## 5. Donor collection counts (TE5–TE8)

| # | Question | Answer |
|---|---|---|
| **TE5** | Item-donor rows with no quantity array | **10** |
| **TE6** | Rows with both an item and a volunteer reference | **0** |
| **TE7** | Rows with neither reference | **6** |
| **TE8** | Rows with no email | **0** |

**TE5 is 10, not zero.** An earlier pass counted the literal string `[]` as a
present array. Ten donor rows carry an empty quantity array, referencing **19
items with no recorded quantity anywhere** — `Donated Item Quantities` is empty
on those rows too, so nothing is recoverable from the source. Each of those 19
pledge lines defaults to quantity 1, which understates the claimed total. This
is the largest predicted data-quality risk in the corpus and it is real, not
cleared. The ten donors: Michael Vanderburg, Tiffany Loeffler, Julie Love (x2),
Josie and Don Shrieve, Cindy Biando, Rose Skolnick, Jenelle Burdick, Jamie
Perell (7 items), Patty Anderson. Ask the program director whether any are
recent enough to reconstruct.

TE6 at zero means the prose rule the old database could not enforce was in fact
never violated.

**TE7's six rows** are junk with no request and no organization:

| Name | Email | Created |
|---|---|---|
| Julie L Love | atj3@aol.com | 2025-11-21T06:02:29Z |
| Julie L Love | atj3@aol.com | 2025-11-21T06:04:21Z |
| Julie L Love | atj3@aol.com | 2025-11-21T06:05:21Z |
| Rose Skolnick | rocklinrosie@gmail.com | 2025-12-04T03:02:55Z |
| Kyley Skaggs | kyley.skaggs@redwoodglen.net | 2025-11-04T19:34:05Z |
| Sara Corp | sara.corp@baldwin.com | 2025-08-21T15:20:53Z |

Three identical Julie L Love submissions inside 172 seconds is a form failing and
a person retrying. Per `field-map.md` section 15, the person is still created,
the pledge is not. All four humans have other, valid rows, so no person is lost.

### The duplicate-collapse number

**127 donor rows, 81 distinct emails (case-insensitive).**

A naive import creates 46 duplicate people. This is the headline number
`SPRINT.md` asks for in the judging package. Top repeats: Christina 12, an
Alliance info address 5, `atj3@aol.com` 5, one supporter 4, five supporters 3
each.

One record, `PERELLMFT@GMAIL.COM`, has a null `Name` and is an all-caps duplicate
of `perellmft@gmail.com`. **Lowercase before deduping** or it survives as a
second person with no name.

---

## 6. Records excluded from import

Eleven dangling references, from Wix soft-deletes leaving foreign keys behind.
Full list with reasons in `exclusions.csv`. Every one is logged to
`migration-exceptions.csv` at run time.

| Kind | Count | Detail |
|---|---|---|
| Item requests → deleted org | 2 | `34699d06` (Archived), `bc00a9d0` (**Active**, Roseville PAL appliances) |
| Item requests, no org and no status | 2 | `edc1ffbc`, `fc7c70b1` (also no title) |
| Items → deleted item request | 3 | Double Stroller, toys, Backpacks and school supplies |
| Items whose parent request was excluded | 5 | Cascade from the four excluded item requests |
| Volunteer roles → deleted volunteer request | 4 | 2 soccer coach roles, 2 Thrift Shop Organizer |
| Donor rows, neither reference | 6 | Section 5 |

**Net item count: 403 source, 8 excluded, 395 imported.** An earlier draft said
400; it counted only the three direct orphans and missed the cascade.

**`bc00a9d0` needs a human decision, not a rule.** It is a live Active request
that would disappear from the public site on cutover. The organization
`Roseville Police Activities Leauge` exists in the export under a *different* id;
the request points at a deleted duplicate org record. Repointing it is one line
in a fix-up file. **Ask Christina Monday. Default if unanswered: exclude and
report, since inventing a foreign key is worse than a missing request.**

### Test data left in production

Not excluded automatically. Confirm with Christina, then add to the exclusion
list:

Volunteer roles: `Kerbal Space Guy` (qty 333), `Rocket to Space`, `The CanadARM`,
`Metal Detector Holder` (qty 222), `Rock Taster`.
Items: `Meteorite` (qty 555), `2026 Rock`, `Magenta` (qty 66).

These inflate any count shown in a demo.

---

## 7. Counter drift, measured

**61 of 403 items** have a stored `Claimed Quantity` that disagrees with the sum
of actual donor pledge lines. **11 of 58 volunteer roles** have a stored
`Interested Quantity` that disagrees with actual signup links.

Drift runs both directions. Examples:

| Item | Requested | Stored claimed | Actual |
|---|---|---|---|
| Toilet Paper | 4 | 4 | 0 |
| Body Wash, Travel Size | 12 | 11 | 13 |
| Stroller | 1 | 1 | 2 |
| Kitchenware | 50 | 20 | 15 |

Five items show claimed exceeding requested, which the new schema forbids by
construction.

This is the documented fault, now with a number attached. It confirms
`field-map.md` section 16: **never import stored counters.** It also means the
section 16 instruction to flag a large gap as a migration defect needs a
correction — a gap is expected here and is a *source* defect. The recomputed
value is right. Record the comparison; do not treat it as a failure signal.

---

## 8. Name splitting load (TE9)

Per `Handbook.md` section 8, anything that does not split into exactly two clean
tokens imports best-effort with `needs_review = true`.

| Source | Not two clean tokens | Total |
|---|---|---|
| Organization primary contacts | 2 | 49 |
| Request primary contacts | 18 | 143 |
| Donor names | 23 | 126 |

Distinct problem strings, deduplicated across sources:

**Particles:** `Efren Del Rio` (also appears as `Efren  Del Rio ` with a double
space and trailing whitespace).
**Middle names or initials:** Iocebeth G Olson, Jenna M Schreader, Teresa Ann
Cunningham, Farzaneh J Sahrai, Julie L Love, Julie M Stark, Rachel Diane Scalise,
Sean S Khodai.
**Two humans in one field:** David & Lisa Eichinger, David and Lisa Eichinger,
Don & Patty Anderson, Don and Patty Anderson, Jeff and Danise Rapetti, Josie and
Don Shrieve. *(Note the `&` and `and` variants are the same couples submitting
twice.)*
**Single token:** Breanna, Gia, Michelle, Robin.
**All caps:** JULIE S RODRIGUEZ.
**Null:** one donor row.

Because people deduplicate on email first, the review queue is smaller than the
raw counts suggest. **Estimate: 25 to 30 `people` rows flagged, not 43.** A
one-sitting job for Christina at ADMIN-04, not a two-hour one.

**TE10 is not answerable from this export.** The org-name-in-first-name
corruption lives in the contacts system, which is still outstanding (B2).

---

## 9. Source fields that do not exist

Three things `field-map.md` maps that the export does not contain.

**`Item Requests.Title` is null on all 120 rows.** Only `Request Title` is
populated, on 119. The "two fields, one target, capture which is used" question
is answered: use `Request Title`, drop `Title`, and delete the fallback logic.
No row has both.

**`Volunteer Roles` has no `Manual Sort` column.** Section 13 maps one. The
column does not exist. Assign `sort_order` by source row order within the
parent, same as items.

**No source field maps to `item_requests.dropoff_location`.** The schema has the
column and PB-02 may render it, but the CMS collection has no equivalent. Every
migrated row gets null. Confirm at capture whether the live surface shows a
dropoff location at all; if it does, it is coming from somewhere outside this
collection.

---

## 10. Other confirmed facts

**Volunteer roles carry no claim data, corpus-wide.** `Claimed Quantity` and
`Remaining Quantity` are null on all 58 rows. `Received Quantity` is 0 on 41 and
null on 17 — never a positive value. The interest-not-commitment model is
confirmed against the full dataset, not just the active slice.

**Two volunteer roles have a null `Quantity`**, and 12 items have a null or zero
`Quantity`. Both columns are `not null check (> 0)` in the schema. Default to 1
and log, per `field-map.md`.

**`Donors.Title` and `Donors.Multi Reference as String` are null on all 127
rows.** Both were already slated to drop. No information lost.

**Donor organization references never disagree with the request's
organization** — checked across all 83 item pledges, zero mismatches. Section
15's decision not to store the organization on the pledge is safe.

**`Approved Email Sent`** is `True` on 47 organizations and null on 2. Seed 47
`email_log` rows per section 9.

**Organization names are unique** across all 49. No slug collision from a name
collision; ordinary slug generation is enough.

---

## 11. What is still outstanding

| # | Item | From | Note |
|---|---|---|---|
| B2 | Contacts export | Site owner | **Still the critical blocker.** No membership, no approval state, no subscriber list without it. TE10 unanswerable until it arrives |
| — | City for 11 organizations | Christina | 15 minutes. Blocking validation |
| — | Keep or drop `bc00a9d0` | Christina | One live Active request |
| — | Confirm test-data rows | Christina | Section 6 |
| ~~O9~~ | ~~Population merges~~ | ~~Captain / Christina~~ | **Closed as D61, Aug 16 2026.** Seed 10 + Other; see `field-map.md` section 7 |
| — | `New or Like New` → `new` | Captain | 119 rows |
| — | Re-harvest one image | Captain | `c95239e9` |
| B4 | Staff roster | Executive director | Unchanged |
