# ADMIN-04 — People review queue

| | |
|---|---|
| **Route** | `/admin/people/review` |
| **Access** | Staff admin only |
| **Bound** | No. Build for clarity |
| **Screenshots** | None |
| **Depends on** | Migration (produces the rows), ADMIN-01 section 4 (shell) |
| **Spec status** | Closed-with-default on no-email handling; see section 5 |

---

## 1. Purpose

Where staff resolve people records that need human review: names the migration could not split confidently, records with no email, suspected duplicates from the phone-match signal on public claim and signup flows, and pairs of records that look like the same human.

The queue receives rows from two sources: the migration, and the phone-match duplicate signal on public claim and signup flows, which fires during normal operation. It does not empty permanently after cutover; it is a recurring operational task for the program director.

Clearing migration-sourced rows is in the definition of done for cutover. Ongoing rows from phone matches are expected during normal operation.

This is the only surface in the system that deletes a row, and it is restricted to staff admin for that reason.

## 2. Entry and exit

**Arrives from:** the admin navigation, and from ADMIN-03 when a pending member's record is flagged.
**Leaves to:** stays on the queue after each action.

## 3. Data

**Reads:** `people` where `needs_review = true`, with `review_note` and `source_note`. For each, the count of `item_pledges`, `volunteer_signups`, `org_memberships`, and organizations where the person is the primary contact. Also reads candidate duplicates: other `people` rows matching on similar name or phone.

**`source_note` and `review_note` have distinct jobs:**
- `source_note` holds the original value as it arrived, verbatim. Set by the migration.
- `review_note` holds why the record is flagged, in a sentence a non-technical operator can act on. Set by the migration and by the phone-match signal on public flows.

The detail panel shows both, labeled distinctly. A record flagged by phone match names the suspected duplicate and links to it, so the operator can merge from there without searching.

**Writes:**
- Name correction: `people.first_name`, `people.last_name`.
- Clear flag: `people.needs_review` to false, preserving `review_note` (D17).
- Merge: reassigns `item_pledges.person_id`, `volunteer_signups.person_id`, `users.person_id`, `digest_subscribers.person_id`, and `organizations.primary_contact_person_id` from the duplicate to the survivor, then deletes the duplicate `people` row.

**Functions called:** `merge_people()` database function (D16). Multi-table reassignment plus a delete in one transaction.

**Never touches:** any quantity column. Merging does not change what was pledged, only who is recorded as having pledged it.

## 4. Layout regions

Renders inside the shared admin shell.

1. **Queue list.** One row per flagged person: name as imported, email, why it was flagged, and counts of what is attached to them.
2. **Detail panel.** Editable first and last name, read-only email and phone, **Source note** (`source_note`, verbatim original), **Review reason** (`review_note`, why flagged), and the full list of attached records: every pledge, signup, membership, and primary-contact reference, each named rather than counted.
3. **Duplicate candidates.** Other people rows that may be the same human, each with its own attached-record summary.
4. **Action region:** Save names, Clear flag, Merge.

Region 2 listing attached records by name rather than by count is what makes the merge decision possible. "Three pledges" tells the operator nothing; "pledged 2 blankets to Acres of Hope in March" tells her whether this is the same person.

## 5. Fields

| # | Label | Control | Required | Binds to | Validation |
|---|---|---|---|---|---|
| 1 | First name | Text | Yes | `people.first_name` | Non-empty |
| 2 | Last name | Text | Yes | `people.last_name` | Non-empty |
| 3 | Email | Read-only | n/a | `people.email` | See below |
| 4 | Phone | Read-only | n/a | `people.phone` | |

**Email is not editable.** It is the unique identity key, case-insensitive, and changing it is how one person silently becomes another. A record with a wrong email is resolved by merging it into the correct person, not by retyping the address.

**Records with no email.** The current CMS export has zero rows without an email (`data-audit.md` TE8). If the contacts export ever produces one: reject the row into `migration-exceptions.csv` rather than synthesizing a fake address. Do not import a placeholder email that could collide with a real person later. Resolution at this surface is merge into a real person once staff have a correct email from the source.

## 6. Actions

**Save names**
- Enabled when: both name fields are non-empty and something changed.
- Does: updates the two columns. Does not clear the review flag; correcting a name and confirming a record are two decisions.
- On success: stated result.

**Clear flag**
- Enabled when: the record is flagged.
- Confirms: names the person and states that the record will leave the review queue.
- Does: sets `needs_review = false`, preserving `review_note`.
- On success: the row leaves the queue and the count decrements.

**Merge**
- Enabled when: a duplicate candidate is selected and it is not the same row as the survivor.
- Confirms: **names both records and lists exactly what will move**, then requires the operator to confirm a second time. This is the only irreversible action in the system.
- Does: the reassignment and delete in section 3, as one transaction. Also writes an approval_events row with entity_type = 'person', from_status = 'duplicate', to_status = 'merged', carrying the deleted row's id and a summary in the note (D31). The approval_events `person` entity_type is in 0001; `merge_people()` is created in migrations/0003_merge_people_function.sql.
- Direction: the operator chooses which record survives. Default the survivor to the record with the most attached rows, but let her override, since the better email or the better name may sit on the smaller record.
- On success: the duplicate is gone, the survivor holds everything, and the result states what moved.
- On failure: nothing written, stated error.
## 7. Conditional behavior

| Trigger | Result |
|---|---|
| The person is a primary contact for an organization | The detail says so prominently. Merging moves that reference, and getting it wrong changes who an organization's contact is |
| The person has a `users` row | The detail says so. Merging moves it, and the unique constraint on `users.person_id` means the survivor must not already have one. See section 12 |
| Both records in a proposed merge have `users` rows | Merge is blocked with a stated reason. See section 12 |
| No duplicate candidates found | The region states that none were found rather than rendering empty |

## 8. Copy

| Context | Text |
|---|---|
| Page heading | People review |
| Empty state | No records need review. |
| Save names result | Name updated. This record is still flagged for review. |
| Clear flag confirmation | Clear the review flag on {name}? |
| Clear flag result | {name} cleared. |
| Merge confirmation, first | Merge {duplicate name} into {survivor name}? {list of what moves}. The {duplicate name} record will be deleted. This cannot be undone. |
| Merge confirmation, second | Type MERGE to confirm. |
| Merge result | Merged. {survivor name} now holds {summary}. |
| Merge blocked, two users | Both records have login accounts. Remove or reassign one before merging. |
| Primary contact warning | {name} is the primary contact for {organization}. |
| No candidates | No possible duplicates found. |
| Failure | That did not save. Nothing was changed. |

## 9. Empty states

An empty queue is the goal and is part of the definition of done.

## 10. Mobile differences

Desktop-first. This surface in particular is not usable in a hurry on a phone and should not be.

## 11. Authorization

Staff admin only, not staff approver. Verified server-side per ADMIN-01 section 4. A staff approver reaching this route gets the same response as a route that does not exist.

## 12. Error paths

| Failure | Rendered result |
|---|---|
| Merge where both records have `users` rows | Blocked before the transaction, with the message in section 8. The unique constraint on `users.person_id` would reject it anyway; handle it first so the operator gets a readable reason |
| Merge where both are primary contacts of different organizations | Allowed, and both references move to the survivor. State this explicitly in the confirmation, since it changes two organizations' contacts at once |
| Merge transaction fails partway | Nothing written. Both records intact. Stated error |
| Duplicate email on the survivor after merge | Cannot occur; the duplicate row is deleted, freeing its email. Confirm the delete and the reassignment are in the same transaction |
| Save names with an empty field | Blocked |

## 13. Out of scope

- Editing email addresses.
- Deleting a person outside of a merge.
- Creating people records.
- Editing pledges, signups, or memberships. Merge reassigns them; it does not change their content.

## 14. Acceptance

- Every `people` row with `needs_review = true` appears, with its review note and source note.
- Attached records are listed by name, not summarized as counts.
- Editing names writes only those two columns and leaves the flag set.
- Clearing the flag removes the row from the queue and preserves the review note.
- Merge moves pledges, signups, memberships, subscriber rows, and primary-contact references, then deletes the duplicate, in one transaction.
- After a merge, no row anywhere references the deleted person id.
- Merge is blocked when both records have login accounts.
- Merge requires two confirmations and the second requires typing.
- A staff approver cannot reach this route.
- The queue empties of migration-sourced rows, which is a definition-of-done item for cutover. Ongoing phone-match rows are expected during normal operation.

## 15. Open captures

| What is needed | Source | Status |
|---|---|---|
| **What the migration writes for records that arrive with no email** | Migration lane | **Closed-with-default, Aug 16 2026.** TE8 confirms zero in current export. Default: reject to `migration-exceptions.csv`, do not synthesize. See section 5 |
