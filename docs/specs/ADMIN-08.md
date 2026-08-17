# ADMIN-08 — Digest subscribers

| | |
|---|---|
| **Route** | `/admin/subscribers` |
| **Access** | Staff admin only |
| **Bound** | No. Build for clarity |
| **Screenshots** | None |
| **Depends on** | PB-05, subscriber import (Lane C), ADMIN-01 section 4 (shell) |
| **Spec status** | Complete |

---

## 1. Purpose

The weekly digest list: who is on it, who has left it, and a way to remove someone by hand when they ask a staff member directly rather than clicking the link.

The list is in scope this week and the send is not. This surface exists so the list is visible and manageable from the moment it is imported, rather than sitting in a table nobody can see until the send job ships in phase two. The Thursday demo does not send to this list (D46).

## 2. Entry and exit

**Arrives from:** the admin navigation.
**Leaves to:** stays on the surface.

## 3. Data

**Reads:** `digest_subscribers`, joined to `people` where `person_id` is set.

**Writes:** `digest_subscribers.status` and `unsubscribed_at`, on manual unsubscribe.

**Functions called:** None.

**Never touches:** `people`. Removing someone from the digest has nothing to do with their identity record, their pledges, or their memberships.

## 4. Layout regions

Renders inside the shared admin shell.

1. **Counts.** Subscribed, unsubscribed, bounced.
2. **Filters.** Status, email substring, subscribed-date range.
3. **List.** Email, status, subscribed date, unsubscribed date, source.
4. **Actions:** Unsubscribe on a row, Export.

Region 1 exists because the count is the only thing anyone will actually ask about this surface before the send job exists. "How many people are on the list" is the question, and it should be answerable without scrolling.

## 5. Fields

Filters only.

| # | Label | Control | Required | Binds to | Validation |
|---|---|---|---|---|---|
| 1 | Status | Select | No | `digest_subscribers.status` | subscribed, unsubscribed, bounced |
| 2 | Email | Text | No | `digest_subscribers.email` | Case-insensitive substring |
| 3 | From / To | Date range | No | `digest_subscribers.subscribed_at` | |

Default view: subscribed only, most recently subscribed first.

**Source column.** `legacy_source` distinguishes imported subscribers from those who signed up through PB-05 after cutover. Render it readably: `Imported` or `Signed up`. It matters for the first real digest after cutover (D46), because an imported subscriber has not seen anything from this system before and the send job in phase two may want to treat them differently. The Thursday demo does not send to this list.

## 6. Actions

**Unsubscribe**
- Enabled when: the row's status is `subscribed`.
- Confirms: names the email.
- Does: sets `status = 'unsubscribed'` and `unsubscribed_at`. Does not delete the row.
- Emails queued: none. A person who asked a staff member to remove them does not need an email confirming it.
- On success: the row moves to unsubscribed and the counts update.

**Export**
- Does: downloads the current filtered view as CSV. Columns: email, status, subscribed date, unsubscribed date, source.
- **This is the one export in the admin.** It exists because the send job does not, and until it ships the only way to run a digest is to export the list and send it through whatever The Alliance already uses. Without this the list is captured but unusable for months.
- The export contains email addresses. Confirming the action states that.

Staff cannot add a subscriber by hand (D26). Adding an address someone did not enter themselves risks the sending domain's reputation, which the phase-two send job inherits.

**Resubscribe** is not an action here. A person who wants back on the list uses PB-05, which is one field and no login.

## 7. Conditional behavior

| Trigger | Result |
|---|---|
| Row status is `unsubscribed` or `bounced` | Unsubscribe is not available |
| `person_id` is set | The person's name renders alongside the email. When it is null, the email renders alone, which is normal and not a defect |
| Filter is applied | Export reflects the filter, and the confirmation states how many rows it will contain |

## 8. Copy

| Context | Text |
|---|---|
| Page heading | Subscribers |
| Counts line | {n} subscribed · {n} unsubscribed · {n} bounced |
| Empty state | No subscribers match these filters. |
| Empty list, no import yet | No subscribers have been imported or signed up yet. |
| Unsubscribe confirmation | Unsubscribe {email}? They will not be notified. |
| Unsubscribe result | {email} unsubscribed. |
| Export confirmation | Export {count} rows? The file contains email addresses. |
| Source values | Imported / Signed up |
| Send-not-built note, shown once on the surface | The weekly digest send is not built yet. This list is being collected now so it is ready when it is. |

The last row is worth including. Without it an operator reasonably assumes a list this visible is being emailed, and discovers otherwise when a subscriber asks why they never hear anything. The Thursday demo does not send to this list (D46).

## 9. Empty states

Two: no rows at all, which before the import means the import has not run, and filtered to nothing. Different messages.

## 10. Mobile differences

Desktop-first.

## 11. Authorization

Staff admin only. A staff approver reaching this route gets the same response as a nonexistent route.

The list is entirely email addresses belonging to members of the public. It is visible only to staff admin, the export is the only way it leaves the system, and every export is an operator action that names what it contains.

## 12. Error paths

| Failure | Rendered result |
|---|---|
| Unsubscribe write fails | Stated error, nothing changed |
| The row was unsubscribed by the person themselves in the meantime | No-op success. The intent is satisfied |
| Export fails | Stated error. Do not download a partial file |
| An imported row has an email that also exists at a different case | Cannot occur; the unique index is on `lower(email)`. If the import produces a collision it fails at import, not here, and that is the correct place for it to fail |

## 13. Out of scope

- Sending the digest, previewing it, or building its template. Phase two, per `Handbook.md` section 17. Eligibility when that spec is written: `approved_at` both non-null and within the lookback window (D43). Historical migrated rows are left null; anything that becomes active afterward must get a real timestamp (D48). Thursday demo does not send to this list (D46).
- Adding subscribers by hand, unless the captain overrides.
- Editing an email address. A wrong address is unsubscribed, and the person resubscribes at PB-05.
- Deleting a row. Unsubscribed rows stay, because the record that someone opted out is the thing that keeps them from being re-added by a future import.
- Segmenting, tagging, or preferences.

## 14. Acceptance

- Every imported subscriber appears with source `Imported`.
- Every PB-05 signup appears with source `Signed up`.
- Counts match the underlying rows.
- Filters work independently and together.
- Manual unsubscribe sets status and timestamp and does not delete the row.
- Unsubscribed rows cannot be unsubscribed again.
- Export reflects the current filter and states its row count before downloading.
- A subscriber with no `person_id` renders normally.
- A staff approver cannot reach this route.
- The note stating that the send is not yet built is visible on the surface.

## 15. Open captures

| What is needed | Source |
|---|---|
| **Confirm the contacts export includes the subscriber list**, without which this surface has nothing to show | Pre-Monday ask, `SPRINT.md` |
