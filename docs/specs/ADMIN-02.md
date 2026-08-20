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

**Reads:** `item_requests` and `volunteer_requests` at `status IN ('pending','active','archived','draft')` (draft rows surfaced via the Returned tab), each joined to `organizations` (name, city) and to the contact person in `people`, plus all `items` or `volunteer_roles` on the request, and `created_by` resolved to a person. The detail endpoint also returns `latestReturn` (latest return-to-draft note and its timestamp) and `editability` ({editable: boolean, reason: string|null}).

**Writes on approve, in one transaction:** the request's `status` to `active`, `approved_at = now()`, `approved_by` from the session user, an `approval_events` row (D48), and any approval `email_log` rows not suppressed by prior successful delivery. Image upload is a separate action that writes `image_url` and nothing else (D11, D48).

**Writes on unapprove for correction (POST /api/admin/requests/:type/:id/unapprove), in one transaction:** an eligible active request's `status` to `pending`, `approved_at = NULL`, `approved_by = NULL`, and an `approval_events` row with the acting staff user and `active → pending`. The request leaves public queries immediately. No email row is written.

**Writes on return to draft:** `status` to `draft`, an `approval_events` row carrying the staff note.

**Writes on archive:** `status` to `archived`, `archived_at`, `archived_reason = 'manual'`, an `approval_events` row.

**Writes on edit (POST /api/admin/requests/:type/:id/edit):** any combination of: `title`, `description`, `details` (volunteer only), `deadline_type`, `deadline_date`, `people_helped`, `dropoff_location` (item) or `event_location` (volunteer), request contact fields, and the full ordered list of items or roles including add/edit/reorder/remove. Status is preserved — edit does not change status.

**Writes on move-to-pending (POST /api/admin/requests/:type/:id/move-to-pending):** `status` to `pending` for a returned draft, allowing it to re-enter the approval queue without re-submission.

**Functions called:** None.

**Never touches:** any activity quantity column (claimed, received, interested, confirmed) on either request type. Staff do not adjust claimed or interested counts here or anywhere.

## 4. Layout regions

Renders inside the shared admin shell, ADMIN-01 section 4.

1. **Type filter.** All, Items, Volunteer. All is the default.
2. **Status tabs.** Pending, Active, Archived, Returned for changes. Pending is the default. The Returned for changes tab shows requests that staff returned to draft status (status = 'draft' with a return history).
3. **Queue list.** One row per request: type, title, organization, submitted date (or returned date on the Returned tab), expiration, and the count of items or roles. Queue rows include `deadline_type`, `deadline_date`, and legacy `expires_on` for every status tab. Expiration shows the earliest applicable dated cutoff (legacy `expires_on` and date-specific `deadline_date` are both cutoffs) as a calendar date, otherwise `Until fulfilled` or `Ongoing`.
4. **Detail panel.** The full request as a member submitted it, plus every item or role with quantities. Also shows the latest return note and date when present.
5. **Action region:** Approve, Return to draft, Archive, Edit Request, Unapprove (active only), Move to Pending (returned drafts only), Reinstate (archived only).

The detail panel must show the request the way the public will see it, including the image, so the approver is reviewing the actual output rather than a field list. Staff may add a themed image before approving; see section 6.

## 5. Fields

### Image upload

Staff may add or correct a themed image before approval or while a request is active. **Image upload on the detail panel**, staff-only, writes the image fields and does not change request lifecycle or participation data (D11). Upload and auto-image controls are accessible both in view mode and during the edit flow whenever `editability.editable` is true. An uploaded photo always takes precedence over an auto-generated image, including when the two operations race.

### Full request edit

When `editability.editable` is true, staff may edit the following fields:

**Request fields:** title, description, details (volunteer only), deadline type, deadline date, people helped. Both item and volunteer editors represent all three stored deadline types: Date specific, Until fulfilled, and Ongoing. Opening and saving the form preserves the stored deadline type unless staff deliberately changes it.

**Location:** drop-off location (item requests) or event location (volunteer requests).

**Contact:** contact first name, last name, email, phone.

Changing the name or phone for the request's currently attached, same-email contact updates that canonical person record atomically. Entering a different email attaches that existing visible person as-is, or creates a new person if the email is new; it never overwrites a different person's identity from request-form text.

**Children (items or roles):** add new, edit existing (all fields), reorder (move up/move down), remove. Each item has: name, description, condition (new / gently_used / any), product URL, quantity requested. Each role has: name, description, quantity needed. While active, a child with pledge, receipt, signup, interest, or confirmation history cannot be removed. Requested/needed quantity cannot be lower than the greater of that child's participation counters, and an active request must retain at least one child. Children without activity may still be removed.

Client-side validation mirrors the organization editors: title and description are required; every contact field is required and email must be valid; deadline date is required for date-specific requests; volunteer details and event location are required; people helped, if provided, must be a non-negative whole number; each request needs at least one child; every child needs a name, description, and whole-number quantity of at least 1; product URLs, if provided, must be valid HTTP(S) URLs. For activity-bearing active children, the editor displays and enforces the participation floor and disables Remove. Server checks remain authoritative: rejection messages name the invalid field or child row and state that nothing changed; the generic save failure is reserved for unexpected failures.

Save preserves the request's current status. For an active request it also preserves `approved_at`, `approved_by`, public visibility, every activity row and counter, and once-only approval/matching-notification state. The edit endpoint does not write a lifecycle event or queue any notification.

## 6. Actions

**Approve**
- Enabled when: the request is `pending` and has at least one item or role.
- Confirms: names the request and states that approving publishes it and emails the organization.
- Does: sets status to `active`, `approved_at = now()`, `approved_by` from the session user, writes one `approval_events` row (D48). Image upload is a separate action and must not be the path that stamps approval.
- Emails queued: `org_request_approved` to the organization's primary contact and to the request's creator. **If they are the same person, send once.** The dedup index on `(template_key, entity_type, entity_id)` enforces this at the database, but resolve it before the send rather than relying on a rejected insert.
- Re-approval: writes a fresh approval stamp and event. Before queueing each recipient, check the once-only key. A prior non-failed/non-skipped approval notification suppresses a duplicate; a prior failed or disabled/skipped attempt remains eligible to queue. The result tells staff which copies sent, failed, were disabled, or were already sent.
- On success: the row leaves the pending queue, the count decrements, the result names both recipients or states that they are the same person.
- On failure: nothing written, stated error.

**Return to draft**
- Enabled when: the request is `pending`.
- Requires: a note. This is the only formal channel through which staff record what needs to change; an empty note is not accepted.
- Does: sets status to `draft`, writes an `approval_events` row with the note.
- Emails queued: **none (D45).** Christina contacts the organization herself, outside the system. There is no thirteenth template.
- The note is a historical record only. It does not invoke any AI processing, send any email, or make any other change to the request. Staff must contact the organization directly.
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

**Edit Request**
- Enabled when: `editability.editable` is true (available for pending requests, staff-returned drafts, and active requests, including active requests with activity; archived and ordinary organization drafts remain unavailable).
- Does: opens the inline edit form. Staff may edit all request, contact, deadline, location, category, image, and copy fields, and safely reconcile child items or roles. Saving calls POST `/api/admin/requests/:type/:id/edit` with the full updated payload. Status, approval stamp, activity, and notification claims are not changed by this action.
- Cancel discards all unsaved changes.

**Unapprove**, from the Active tab
- Enabled when: the request is `active` and the server-derived activity check finds no item pledge, volunteer signup, claim, receipt, interest, or confirmation activity.
- Confirms: names the request and states that it immediately leaves public view, returns to Pending, and sends no email. Editing is already available and remains available after unapproval.
- Does: under a request-row lock, rechecks active state and activity, sets status to `pending`, clears the current `approved_at` and `approved_by`, and writes one `active → pending` approval event with the acting staff user. All writes commit or roll back together.
- Emails queued: none.
- If any activity exists, the action is disabled and the server-derived reason explains that the request cannot be unapproved. Edit Request remains available and explicitly preserves that activity. Staff cannot change or reset activity from this surface.

**Move to Pending** (Returned tab only)
- Enabled when: the request has `status = 'draft'` (returned draft).
- Does: calls POST `/api/admin/requests/:type/:id/move-to-pending`, which atomically sets status to `pending` and writes the status transition to approval history. The request enters the pending queue and can be approved normally.
- Emails queued: none.

## 7. Conditional behavior

| Trigger | Result |
|---|---|
| Type filter set | List narrows to one request type. Detail panel adapts: items with quantities, or roles with counts |
| Request has zero items or roles | Approve is disabled, with a stated reason. This should be unreachable given the submit gates at MP-08 and MP-11, so if it appears, something upstream is wrong |
| Item request with `deadline_type = 'date_specific'` | Deadline date shown |
| Queue row has an applicable legacy `expires_on` | Its calendar date is shown, including for ongoing or until-fulfilled requests; when both stored dates apply, the earlier cutoff is shown |
| Request's organization is not `approved` | Approve is disabled, with a stated reason. Approving a request from an unapproved organization would publish nothing, since public queries filter on organization status |
| Primary contact and creator are the same person | Result message says so, and one email is queued |
| `editability.editable` is false | Edit button not shown; image upload not shown; `editability.reason` displayed as a note |
| Active request has no activity | Unapprove and Edit Request are both enabled; the actions are independent |
| Active request has a pledge, receipt, signup, interest, or confirmation | Unapprove is disabled and its activity-blocking reason is shown; Edit Request remains enabled |
| Active edit removes an activity-bearing child or lowers its quantity below participation | Save is rejected with a child-specific explanation; all request, contact, category, and child changes roll back |
| Request has a latest return note | Return note and date shown at top of detail panel, with a disclaimer that it is history only |
| Returned tab selected | Column header shows "Returned" date; rows sorted by return date; Move to Pending action available |

## 8. Copy

| Context | Text |
|---|---|
| Page heading | Requests |
| Pending empty state | No requests are waiting for approval. |
| Returned for changes empty state | No returned drafts. |
| Approve confirmation | Approve {title}? This publishes the request and sends any approval email not already delivered to {recipients}. |
| Approve result, two recipients | {title} is now public. Approval email queued to {contact email} and {creator email}. |
| Approve result, same person | {title} is now public. Approval email queued to {email}. |
| Return to draft prompt | What needs to change? This note is saved to the request history as a record only — it does not trigger any AI processing, send any email, or make any other change to the request. The organization is not emailed; staff must contact the organization directly. |
| Return to draft result | {title} returned to draft. The note was saved as history only; no changes were made and no email was sent. Contact the organization directly. |
| Unapprove confirmation | Unapprove {title}? It will leave public view immediately and return to Pending. Editing is available either way. No email is sent. |
| Unapprove result | {title} moved to Pending and is no longer public. It can now be edited and re-approved. No email was sent. |
| Unapprove blocked by activity | This request has donor or volunteer activity and cannot be unapproved. Editing remains available and does not change public status. |
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
| Request already unapproved by another staff member | Conflict names the current status; no second event is written |
| Activity races unapproval | Receipt/confirmation writes and unapproval lock parent then children. Exactly one wins: committed activity rejects unapproval, while committed unapproval rejects the stale activity save. A Pending request never gains activity from the race |
| Pledge/signup races an active edit | Both paths lock request first and children second. If activity commits first, the edit re-evaluates the now-current history and quantity floor; it either safely preserves it or rejects the unsafe change with no partial write. If the edit safely removes an unused child first, stale public activity for that child is rejected |
| Email dispatch fails after approval | The approval stands, the request is public, the failure is logged and visible at ADMIN-06. The result message says the email failed rather than claiming it sent |
| Re-approval recipient already has a successful approval notification | Request is published with a fresh stamp/event; no duplicate email row or provider call is made, and the result says it was already sent |
| Return to draft with an empty note | Blocked |
| Edit save fails | Nothing written, stated error |
| Client validation fails on edit | Error shown inline, save not attempted |

**There is no email template for a returned request (D45).** Christina contacts the organization herself, outside the system. Minor fixes she makes herself without contacting anyone; anything more substantive, she emails the organization's contact directly before approving. The return-to-draft prompt in section 8 is the reminder that she still owns that outreach. A returned request can sit indefinitely if she does not follow through; that is accepted operational practice, not a missing template.

## 13. Out of scope

- Adjusting activity quantity columns (claimed, received, interested, confirmed).
- Approving organizations or members. Separate queues.
- Deleting a request.
- Bulk approval.

## 14. Acceptance

- Both request types appear in one queue and the type filter narrows correctly.
- The Expiration column remains in Pending, Active, Archived, and Returned for changes when filtering by All, Items, or Volunteer.
- Date-specific and applicable legacy cutoffs display as calendar dates without timezone shifts; requests with no dated cutoff display `Until fulfilled` or `Ongoing`.
- The Returned tab shows returned drafts (status = 'draft' with return history), with a column showing the return date.
- The detail panel shows every item or role with its quantities.
- The detail panel shows the latest return note and date when one exists, with a disclaimer that the note is history only and does not trigger AI, email, or any other action.
- Approving sets status, `approved_at = now()`, and approver, writes exactly one approval event, and queues the approval email.
- When the primary contact and creator are the same person, exactly one email is queued.
- Approving twice sends one email.
- An active request with no activity can be unapproved to Pending; it immediately leaves both public browse and detail surfaces, clears the current approval stamp, and becomes editable.
- Unapproval is refused for any item pledge/claim/receipt or volunteer signup/interest/confirmation activity, with no partial status, stamp, or history write.
- Active requests remain editable with activity; successful edits preserve active/public status, approval stamp, activity rows/counters, and approval/matching notification claims.
- Active edits can add and reorder children and remove children without activity. They atomically reject removal of an activity-bearing child, quantity below participation, or an empty child list.
- Unapproval and subsequent re-approval each write a distinct approval event with the acting staff user; re-approval records a fresh `approved_at` and `approved_by`.
- Re-approval does not create or send a duplicate approval notification for a recipient already notified successfully, while failed and disabled/skipped attempts remain retryable.
- An approved request appears immediately on the correct public browse surface.
- Approve is disabled for a request whose organization is not approved.
- Return to draft requires a note and stores it on the approval event.
- Return to draft queues no email (D45). The prompt reminds the operator to contact the organization directly and states that the note triggers no AI processing.
- Archive sets `archived_reason = 'manual'`.
- Reinstating an archived request returns it to public view.
- Staff image upload and auto-image controls work for editable active requests without changing lifecycle or participation data; uploaded-photo precedence and storage cleanup remain enforced.
- No path on this surface writes a quantity column (claimed, received, interested, confirmed).
- The pending count in the navigation matches the queue.
- Edit Request is shown when `editability.editable` is true and hidden otherwise.
- Saving an edit preserves the request status.
- Editing children supports add, edit (all fields including quantities), reorder, and remove.
- Client validation matches the member request editors and blocks missing required copy/contact/location fields, invalid deadline/email/URL values, non-whole-number people-helped values, or invalid child rows.
- Both item and volunteer edits can preserve and save `deadline_type = 'until_fulfilled'`; rejected saves identify the field or condition to fix.
- Image upload remains accessible while in the edit form (when editable).
- Returned drafts can be moved back to pending via Move to Pending without re-submission.
- Dashboard selector option labels visibly include status, so Draft requests are distinguishable from Pending review and Active requests.

## 15. Open captures

None. O1 closed as D45.
