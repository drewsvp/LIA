# ADMIN-03 — Member approval queue

| | |
|---|---|
| **Route** | `/admin/members` |
| **Access** | Staff approver or staff admin |
| **Bound** | No. Build for clarity |
| **Screenshots** | None |
| **Depends on** | MP-03 and MP-06 (produce the rows), ADMIN-01 section 4 (shell), email (Lane B) |
| **Spec status** | Complete |

---

## 1. Purpose

Where staff approve people who have been invited to join a member organization. Approval activates the membership and sends the person their login information. Until then the person has an account that cannot reach anything.

This queue replaces a process that ran by adding a label to a contact record. That mechanism worked but left no record of who approved whom or when, and it lived in a different system from everything else the operator does.

## 2. Entry and exit

**Arrives from:** the admin navigation, and a direct link in the `staff_new_user` email.
**Leaves to:** stays on the queue after each action.

## 3. Data

**Reads:** `org_memberships` at `status = 'pending'`, joined to `users`, `people` (first name, last name, email, phone), `organizations` (name, status), and `invited_by` resolved through `users` to a person.

**Writes on approve, in one transaction:** `org_memberships.status` to `active`, `approved_at`, `approved_by`, an `approval_events` row, and an `email_log` row for `org_member_approved`.

**Writes on reject:** `org_memberships.status` to `removed`, an `approval_events` row.

**Functions called:** None.

**Never touches:** `people`. Rejecting a membership never deletes the person or the user. The person may hold a valid membership elsewhere, may have donated last year, and may be invited again next month.

## 4. Layout regions

Renders inside the shared admin shell.

1. **Status tabs.** Pending, Active, Removed. Pending is the default.
2. **Queue list.** One row per membership: person name, email, organization, who invited them, invited date.
3. **Detail.** The person's full contact details, the organization, the inviter, and **the person's other memberships**, if any.
4. **Action region:** Approve, Reject.

Region 3's other-memberships line is the one piece of context that makes this queue safe. A person already active at another organization is a known quantity; a person appearing for the first time is not, and the approver should be able to tell the difference without leaving the page.

## 5. Fields

No editable fields. If a person's name arrived wrong, it is corrected at ADMIN-04, not here.

## 6. Actions

**Approve**
- Enabled when: the membership is `pending` and its organization is `approved`.
- Confirms: names the person and the organization and states that they will receive login information.
- Does: sets `status = 'active'`, `approved_at`, `approved_by`, writes one `approval_events` row.
- Emails queued: `org_member_approved` to the person, with their name, organization name, and a link to the portal.
- On success: the row leaves the pending queue, the count decrements, the result names the recipient.
- On failure: nothing written, stated error.

**Reject**
- Enabled when: the membership is `pending`.
- Confirms: names the person and the organization and states that no email is sent.
- Does: sets `status = 'removed'`, writes an `approval_events` row. A note is optional and lands in the audit trail if written (D15).
- Emails queued: none.
- On success: stated result.

**Reinstate**, from the Removed tab
- Enabled when: the membership is `removed`.
- Does: sets `status` back to `pending`, writes an `approval_events` row. Returns it to the queue rather than activating it directly, so the normal approval path and its email still run.

## 7. Conditional behavior

| Trigger | Result |
|---|---|
| The membership's organization is not `approved` | Approve is disabled with a stated reason. An active membership at an unapproved organization grants access to a dashboard for an organization that cannot post |
| The person holds active memberships elsewhere | Those organizations are listed in the detail |
| The person's `people` row has `needs_review = true` | The detail flags it and links to ADMIN-04. Approving is still allowed; the flag is information, not a block |
| The membership is an owner membership from MP-03 | It does not appear here. Owner memberships activate as part of organization approval at ADMIN-01, in the same transaction |

That last row prevents a real confusion: an organization approved at ADMIN-01 should not then show its owner sitting in this queue waiting for a second approval.

## 8. Copy

| Context | Text |
|---|---|
| Page heading | Members |
| Pending empty state | No members are waiting for approval. |
| Approve confirmation | Approve {name} at {organization}? They will receive login information at {email}. |
| Approve result | {name} approved. Login email queued to {email}. |
| Reject confirmation | Reject {name} at {organization}? They will not be notified. |
| Reject result | {name} rejected. No email was sent. |
| Approve blocked | {organization} is not approved yet, so this membership cannot be activated. |
| Other memberships line | Also active at: {organizations} |
| Review flag | This person's record is flagged for review. |
| Failure | That did not save. Nothing was changed. |

## 9. Empty states

An empty pending queue is the steady state.

## 10. Mobile differences

Desktop-first.

## 11. Authorization

Per ADMIN-01 section 4. `approved_by` comes from the session user.

Staff memberships in the `platform_owner` organization are not created through this queue. There is no self-service path to becoming staff, and none is built this week; staff memberships are inserted directly during setup. **O4:** how new staff are added after the sprint still needs an answer from Tiffany and Christina.

## 12. Error paths

| Failure | Rendered result |
|---|---|
| Approval transaction fails partway | Nothing written, stated error, membership stays pending |
| Membership already approved by another staff member | No-op success, row refreshes |
| Email dispatch fails after approval | The membership is active and the person can log in, but they do not know that. Logged as failed, visible at ADMIN-06 and resendable there. The result message states the failure explicitly rather than claiming the email sent |
| The person has no `users` row | A data defect that MP-06's transaction should make impossible. Block, state it, log it. Do not create the row here |

The third row is the most consequential email failure in the system. A member whose login email never arrives has no way to discover they were approved, and no error appears anywhere the organization can see. The result message and ADMIN-06 are the only signals.

## 13. Out of scope

- Editing a person's name or contact details. ADMIN-04.
- Changing a membership's role.
- Creating staff memberships.
- Inviting members. That is MP-06, done by the organization.
- Bulk approval.

## 14. Acceptance

- Pending memberships show the person, the organization, the inviter, and any other active memberships.
- Owner memberships created at MP-03 never appear in this queue.
- Approving sets status, timestamp, and approver, writes exactly one approval event, and queues one email.
- Approving twice sends one email.
- An approved member can log in and reaches the correct organization's dashboard.
- Approve is disabled when the organization is not approved.
- Rejecting sets the membership to `removed` and leaves `people` and `users` untouched.
- A rejected person can be invited again and reinstating returns them to `pending`, not straight to `active`.
- A failed login email is visible at ADMIN-06 and stated in the result.
- The pending count in the navigation matches the queue.

## 15. Open captures

| What is needed | Source |
|---|---|
| **O4: How staff memberships are created after the sprint** | Tiffany, Christina. Direct database write this week is not durable |
