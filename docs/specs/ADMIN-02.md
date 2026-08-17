# ADMIN-02 — Request approval queue

| | |
|---|---|
| **Route** | `/admin/requests` |
| **Access** | Staff approver or staff admin |
| **Bound** | No. Build for clarity |
| **Screenshots** | None |
| **Depends on** | MP-08 and MP-11 (produce the rows), ADMIN-01 section 4 (shell), email (Lane B) |
| **Spec status** | Complete |

---

## 1. Purpose

Where staff review submitted item and volunteer requests and publish them. Both request types share one queue, because the operator's job is the same for both and splitting them doubles the number of places she has to check.

This is the highest-volume queue in the system and the one that gates whether a need reaches the public at all.

## 2. Entry and exit

**Arrives from:** the admin navigation, and direct links in the `staff_new_item_request` and `staff_new_volunteer_request` emails.
**Leaves to:** stays on the queue after each action.

## 3. Data

**Reads:** `item_requests` and `volunteer_requests` at `status = 'pending'`, each joined to `organizations` (name, city) and to the contact person in `people`, plus all `items` or `volunteer_roles` on the request, and `created_by` resolved to a person.

**Writes on approve, in one transaction:** the request's `status` to `active`, `approved_at = now()`, `approved_by` from the session user, an `approval_events` row, and `email_log` rows. Distinct from the image-upload sub-action, which writes `image_url` and nothing else (D11, D48).

**Writes on return to draft:** `status` to `draft`, an `approval_events` row carrying the staff note.

**Writes on archive:** `status` to `archived`, `archived_at`, `archived_reason = 'manual'`, an `approval_events` row.

**Functions called:** None.

**Never touches:** any quantity column, on either request type. Staff do not adjust claimed or interested counts, here or anywhere.

## 4. Layout regions

Renders inside the shared admin shell, ADMIN-01 section 4.

1. **Type filter.** All, Items, Volunteer. All is the default.
2. **Status tabs.** Pending, Active, Archived. Pending is the default.
3. **Queue list.** One row per request: type, title, organization, submitted date, and the count of items or roles.
4. **Detail panel.** The full request as a member submitted it, plus every item or role with its quantities.
5. **Action region:** Approve, Return to draft, Archive.

The detail panel must show the request the way the public will see it, including the image, so the approver is reviewing the actual output rather than a field list. Staff routinely add a themed image before approving; see section 6.

## 5. Fields

### Image upload

Staff routinely add a themed image before approving. **Image upload on the detail panel**, staff-only, writing `image_url` and nothing else (D11). This is the single exception to this surface being read-only.

No other field is editable here.

## 6. Actions

**Approve**
- Enabled when: the request is `pending` and has at least one item or role.
- Confirms: names the request and states that approving publishes it and emails the organization.
- Does: sets status to `active`, `approved_at = now()`, `approved_by` from the session user, writes one `approval_events` row (D48). Image upload is a separate action and must not be the path that stamps approval.
- Emails queued: `org_request_approved` to the organization's primary contact and to the request's creator. **If they are the same person, send once.** The dedup index on `(template_key, entity_type, entity_id)` enforces this at the database, but resolve it before the send rather than relying on a rejected insert.
- On success: the row leaves the pending queue, the count decrements, the result names both recipients or states that they are the same person.
- On failure: nothing written, stated error.

**Return to draft**
- Enabled when: the request is `pending`.
- Requires: a note. This is the only channel through which staff tell an organization what to fix, so an empty note is not accepted.
- Does: sets status to `draft`, writes an `approval_events` row with the note.
- Emails queued: **none (D45).** Christina contacts the organization herself, outside the system. There is no thirteenth template.
- On success: the row leaves the pending queue and the result states that no email was sent and the organization must be contacted directly.

**Archive**
- Enabled when: the request is `pending` or `active`.
- Confirms: names the request and states it will stop appearing publicly.
- Does: sets status to `archived`, `archived_at`, `archived_reason = 'manual'`, writes an `approval_events` row.
- Emails queued: none.

**Reinstate**, from the Archived tab
- Enabled when: the request is `archived`.
- Does: sets status back to `active`, clears `archived_at` and `archived_reason`, writes an `approval_events` row. Does not write `approved_at` (D48). Approval stamps the pending-to-active transition only; reinstating an archived request is not that transition.
- Emails queued: none. The organization was already told it was approved.

## 7. Conditional behavior

| Trigger | Result |
|---|---|
| Type filter set | List narrows to one request type. Detail panel adapts: items with quantities, or roles with counts |
| Request has zero items or roles | Approve is disabled, with a stated reason. This should be unreachable given the submit gates at MP-08 and MP-11, so if it appears, something upstream is wrong |
| Item request with `deadline_type = 'date_specific'` | Deadline date shown |
| Request's organization is not `approved` | Approve is disabled, with a stated reason. Approving a request from an unapproved organization would publish nothing, since public queries filter on organization status |
| Primary contact and creator are the same person | Result message says so, and one email is queued |

## 8. Copy

| Context | Text |
|---|---|
| Page heading | Requests |
| Pending empty state | No requests are waiting for approval. |
| Approve confirmation | Approve {title}? This publishes the request and emails {recipients}. |
| Approve result, two recipients | {title} is now public. Approval email queued to {contact email} and {creator email}. |
| Approve result, same person | {title} is now public. Approval email queued to {email}. |
| Return to draft prompt | What needs to change? This note is saved to the request history. The organization is not emailed, so contact them directly. |
| Return to draft result | {title} returned to draft. No email was sent. |
| Archive confirmation | Archive {title}? It will stop appearing publicly. No email is sent. |
| Archive result | {title} archived. |
| Reinstate result | {title} is public again. |
| Approve blocked, no items | This request has no items and cannot be approved. |
| Approve blocked, org not approved | {organization} is not approved yet, so this request cannot be published. |
| Failure | That did not save. Nothing was changed. |

The return-to-draft prompt is the reminder that Christina still owns outreach (D45). Do not add a thirteenth template.

## 9. Empty states

An empty pending queue is the goal state.

## 10. Mobile differences

Desktop-first, per ADMIN-01 section 4.

## 11. Authorization

Per ADMIN-01 section 4. `approved_by` comes from the session user.

## 12. Error paths

| Failure | Rendered result |
|---|---|
| Approval transaction fails partway | Nothing written, stated error, request stays pending |
| Request already approved by another staff member | No-op success, row refreshes. Approval is idempotent |
| Email dispatch fails after approval | The approval stands, the request is public, the failure is logged and visible at ADMIN-06. The result message says the email failed rather than claiming it sent |
| Return to draft with an empty note | Blocked |

**There is no email template for a returned request (D45).** Christina contacts the organization herself, outside the system. Minor fixes she makes herself without contacting anyone; anything more substantive, she emails the organization's contact directly before approving. The return-to-draft prompt in section 8 is the reminder that she still owns that outreach. A returned request can sit indefinitely if she does not follow through; that is accepted operational practice, not a missing template.

## 13. Out of scope

- Editing any request field other than the image.
- Adjusting any quantity.
- Approving organizations or members. Separate queues.
- Deleting a request.
- Bulk approval.

## 14. Acceptance

- Both request types appear in one queue and the type filter narrows correctly.
- The detail panel shows every item or role with its quantities.
- Approving sets status, `approved_at = now()`, and approver, writes exactly one approval event, and queues the approval email.
- When the primary contact and creator are the same person, exactly one email is queued.
- Approving twice sends one email.
- An approved request appears immediately on the correct public browse surface.
- Approve is disabled for a request whose organization is not approved.
- Return to draft requires a note and stores it on the approval event.
- Return to draft queues no email (D45). The prompt reminds the operator to contact the organization directly.
- Archive sets `archived_reason = 'manual'`.
- Reinstating an archived request returns it to public view.
- The staff image upload writes `image_url` and nothing else.
- No path on this surface writes a quantity column.
- The pending count in the navigation matches the queue.

## 15. Open captures

None. O1 closed as D45.
