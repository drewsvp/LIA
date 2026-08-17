# ADMIN-06 — Email log

| | |
|---|---|
| **Route** | `/admin/email` |
| **Access** | Staff admin or staff approver |
| **Bound** | No. Build for clarity |
| **Screenshots** | None |
| **Depends on** | Email dispatch (Lane B), ADMIN-01 section 4 (shell) |
| **Spec status** | Complete |

---

## 1. Purpose

Every send attempt the system has made, with its outcome. This is the answer to "did they get the email," which is the most common operational question in a system whose entire approval workflow runs on notifications.

It is also the only place a failed send becomes visible. Nothing else in the system surfaces one: a failed approval email leaves an organization waiting silently, and a failed login email leaves an approved member unable to discover they were approved. If nobody looks at this surface, those failures are invisible.

## 2. Entry and exit

**Arrives from:** the admin navigation, and from the result messages on ADMIN-01, ADMIN-02, and ADMIN-03 when a send fails.
**Leaves to:** stays on the surface. Each row links to its related entity where one exists.

## 3. Data

**Reads:** `email_log`, joined to `people` where `to_person_id` is set, and resolving `entity_type` and `entity_id` to the named entity.

**Writes on resend:** a new `email_log` row. See section 6.

**Functions called:** None.

**Never touches:** any entity the email refers to. Resending an approval email does not re-run the approval.

## 4. Layout regions

Renders inside the shared admin shell.

1. **Failure banner.** Count of failed sends in the last seven days, with a one-click filter to them. Rendered only when the count is above zero.
2. **Filters.** Template, status, recipient, date range.
3. **Log table.** Timestamp, template, recipient, related entity, status.
4. **Detail.** Full payload, provider message id, error text, and the related entity link.
5. **Action:** Resend, on failed rows.

Region 1 is the difference between a log and a monitor. The failure count also appears in the shared admin navigation alongside the pending counts (D22). A failed login email is more urgent than a pending approval.

## 5. Fields

Filters only.

| # | Label | Control | Required | Binds to | Validation |
|---|---|---|---|---|---|
| 1 | Template | Select | No | `email_log.template_key` | The twelve template keys, shown by readable name rather than key |
| 2 | Status | Select | No | `email_log.status` | queued, sent, failed |
| 3 | Recipient | Text | No | `email_log.to_email` | Case-insensitive substring |
| 4 | From / To | Date range | No | `email_log.created_at` | |

Default view: last seven days, all statuses, most recent first.

## 6. Actions

**Resend**
- Enabled when: the row's status is `failed`.
- Confirms: names the template and the recipient.
- Does: re-resolves the payload from current data, then dispatches.
- **Writes a new `email_log` row.** It does not update the failed one. The failed row is the record that a send failed and it stays.
- On success: the new row appears as `sent` and the result states it.
- On failure: the new row appears as `failed` with its error, and the result states that too.

**The dedup index problem.** `email_log_once_idx` is unique on `(template_key, entity_type, entity_id)` where `entity_id is not null and status <> 'failed'`. A resend that succeeds inserts a row that satisfies the index, so if a prior successful row exists for that template and entity, the insert is rejected.

That is correct behavior: it means the email already went out and the operator is looking at a stale failure. **Handle it before the insert** (D24), with a message saying the email was already sent successfully and when, rather than surfacing a constraint violation.

**Resending re-resolves the payload.** If a name was blank at first send and has since been corrected at ADMIN-04, the resend carries the corrected name. Resending a stored payload would just resend the original defect.

## 7. Conditional behavior

| Trigger | Result |
|---|---|
| Status is `failed` | Resend available, error text shown in the detail |
| Status is `queued` and older than fifteen minutes | Flagged as stuck (D23). A row stuck at `queued` means dispatch never ran, which is a different problem from a rejected send and needs to look different |
| `entity_id` resolves to an entity | The detail links to it |
| Failure count in the last seven days is above zero | The banner in region 1 renders |

## 8. Copy

| Context | Text |
|---|---|
| Page heading | Email |
| Empty state, no sends yet | No emails have been sent yet. |
| Empty state, filters applied | No emails match your filters. |
| Failure banner | {count} emails failed in the last 7 days. |
| Resend confirmation | Resend {template name} to {email}? |
| Resend result, sent | Sent to {email}. |
| Resend result, failed | Still failing. {error}. |
| Resend blocked, already sent | This email was already delivered on {date}. No new email was sent. |
| Stuck marker | Queued but not dispatched. |

Template names in the interface are readable, not keys. `org_member_approved` reads as "Member approved, login information." Keep a single mapping in one place so the queue result messages on the other admin surfaces use the same names.

## 9. Empty states

Two distinct empty states:

- **Nothing has ever been sent.** "No emails have been sent yet." On a live system after go-live, this means dispatch has never run and is itself the problem.
- **Filters applied, zero results.** "No emails match your filters." Different message, different meaning.

## 10. Mobile differences

Desktop-first.

## 11. Authorization

Staff admin or staff approver, per ADMIN-01 section 4.

**The payload contains personal information:** names, email addresses, and organization contact details. It is visible only to staff and it is never rendered on any surface outside `/admin`. It is not exported and there is no share link.

## 12. Error paths

| Failure | Rendered result |
|---|---|
| Resend rejected by the dedup index | The already-sent message in section 8, not a constraint error |
| Resend dispatch fails again | New failed row, error shown, resend still available |
| Payload cannot be re-resolved because the entity was deleted | Blocked with a stated reason. Do not send a partially resolved email |
| A variable is unresolved at resend time | The same rule as any send: it does not go out, it logs as failed with the reason. `Handbook.md` section 13 |

## 13. Out of scope

- Composing or sending an arbitrary email.
- Editing template content. Templates live in `docs/email/` and change through the repo.
- Bulk resend.
- Any digest send. Phase two.
- Exporting the log.

## 14. Acceptance

- Every send attempt in the system appears, including automated ones.
- Filters work independently and together.
- A failed send shows its error text.
- The failure banner appears when failures exist and links to the filtered view.
- Resending writes a new row and leaves the failed row in place.
- A resend of an already-delivered email is blocked with a readable message, not a constraint error.
- A resend re-resolves the payload from current data.
- Rows stuck at `queued` are visually distinct from failed rows.
- No email payload is reachable outside `/admin`.
- Deliberately failing a send, for example by approving an organization whose contact name is empty, produces a failed row here with a readable reason. This is one of the five tests in `Handbook.md` section 16.

## 15. Open captures

None.
