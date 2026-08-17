# ADMIN-01 — Organization approval queue

| | |
|---|---|
| **Route** | `/admin/organizations` |
| **Access** | Staff approver or staff admin |
| **Bound** | No. Build for clarity |
| **Screenshots** | None |
| **Depends on** | MP-03 (produces the rows), email (Lane B). **Defines the shared admin shell in section 4** |
| **Spec status** | Complete |

---

## 1. Purpose

Where staff review organizations that have registered and decide whether to admit them to the network. Approval is what makes an organization visible publicly and able to post needs, so this queue is the front door to the entire system.

The operator is a non-technical program director doing this alongside her other work. The surface optimizes for one thing: seeing everything needed to make the decision without leaving the page.

## 2. Entry and exit

**Arrives from:** the admin navigation, and a direct link in the `staff_new_org` email.
**Leaves to:** stays on the queue after each action. Approving does not navigate away, because staff work through several at a sitting.

## 3. Data

**Reads:** `organizations` with `status = 'pending'`, joined to `primary_contact_person_id` in `people`, and `organization_populations` joined to `populations`. Also reads approved and disabled organizations for the other tabs.

**Writes, in one transaction on approve:** `organizations.status` to `approved`, `approved_at`, `approved_by`. The owner `org_memberships` row for this organization to `status = 'active'`, with its own `approved_at` and `approved_by`. An `approval_events` row for the organization. An `approval_events` row for the membership. An `email_log` row for `org_approved`.

**Writes on disable:** `organizations.status` to `disabled`, plus an `approval_events` row. Does not clear `approved_at` or `approved_by` (D44).

**Functions called:** None.

**Never touches:** any request, item, or supporter data. On disable, does not null `approved_at` or `approved_by` (D44).

## 4. The shared admin shell

Defined here, used by all eight admin surfaces. Build once.

**Layout.** A persistent left navigation listing the eight surfaces by name, with the current one marked. Content fills the remainder. No decoration, no dashboard landing page, no hero region.

**Pending counts.** The navigation shows a count beside each of the three approval queues: organizations, requests, and members. A zero count renders as no badge rather than a zero. These counts are the closest thing to a task list the operator has and they are the reason the shell is worth building rather than eight standalone pages.

**Email failure count.** The navigation also shows a count of failed email sends in the last seven days (D22), linking to ADMIN-06 filtered to failures. Rendered only when the count is above zero. A failed login email is more urgent than a pending approval.

**Density.** Tables, not cards. Default to showing more rows rather than more whitespace. Use the `Design.md` tokens for color and type so admin reads as the same product, but ignore the card shadow and radius; those are public-surface styling.

**Confirmation.** Every action that changes a status or sends an email confirms first, naming the entity and the action. Approvals are not undoable by the person who made them without a second transition, and the operator is moving quickly.

**Result feedback.** Every action states its outcome in place, including which emails were queued. An operator who cannot tell whether an email went out will send it again by hand.

**Access.** Every admin route verifies the session user holds an active membership in the `platform_owner` organization with role `staff_admin` or `staff_approver`, server-side, before any query. A member org user reaching any `/admin` path gets the same response as a route that does not exist.

## 5. Layout regions

1. **Tabs or filter.** Pending, Approved, Disabled. Pending is the default view.
2. **Queue list.** One row per organization, showing name, city, primary contact name, submission date.
3. **Detail panel or expanded row.** Everything submitted at MP-03: name, website, mission, populations including any free-text other value, logo, full address, phone, and the primary contact's name, email, and phone.
4. **Action region** within the detail: Approve, Disable.

The detail must show every submitted field. An approver who has to open another system to see what an organization does cannot make the decision here.

## 6. Fields

No editable fields. Staff do not correct an organization's submission on this surface (D12); if something is wrong, the fix is to contact them. **O2, sharpened after the Aug 14 call:** Christina said she can edit an org's details in the backend "however I need," but that was a general answer, not specifically about the pending-approval moment. The open question is whether that edit is part of approving new organizations, or separate ongoing maintenance she does any time — and if separate, whether phase one needs to replicate it. Until she answers, build per D12.

## 7. Actions

**Approve**
- Enabled when: the organization is `pending`.
- Confirms: names the organization and states that approving publishes it and emails the primary contact.
- Does: the full write in section 3.
- Transaction boundary: organization status, membership activation, both approval events, and the email log row, all together.
- Emails queued: `org_approved` to the primary contact.
- On success: the row leaves the pending queue, the pending count decrements, and the result states that the organization is approved and the welcome email was queued.
- On failure: nothing written, stated error.

**Disable**
- Enabled when: the organization is `pending` or `approved` (D13, D44). Not limited to the pending-approval decision; this is also how Christina flags an already-approved org that does not renew.
- Confirms: names the organization and states that its active requests will stop appearing publicly.
- Does: sets `status = 'disabled'`, writes an approval event. Does not clear `approved_at` or `approved_by` (D44).
- Emails queued: none.
- On success: stated result.

Disabling an organization removes its requests from public view, because every public query filters on organization status. It does not archive those requests or change their own status (D14). Re-approving restores the previous state exactly. The approval timestamps stay; they are the historical record used for reporting.

## 8. Conditional behavior

| Trigger | Result |
|---|---|
| Organization is `pending` | Approve and Disable both available. Disable serves as the rejection path for pending organizations (D13) |
| Organization is `approved` | Disable available, Approve not. This is the control for an already-approved org that does not renew (D44) |
| Organization is `disabled` | Approve available, restoring it |
| Organization has a `populations_other` value | It renders alongside the selected populations, labeled as free text so the approver can see it and consider promoting it at ADMIN-05 |
| Organization has no logo | The field is marked as not provided rather than rendering an empty image |

## 9. Copy

Written fresh. Plain and specific.

| Context | Text |
|---|---|
| Page heading | Organizations |
| Pending empty state | No organizations are waiting for approval. |
| Approve confirmation | Approve {name}? This publishes the organization and emails {contact name} at {contact email}. |
| Approve result | {name} approved. Welcome email queued to {contact email}. |
| Disable confirmation | Disable {name}? Their active requests will stop appearing publicly. No email is sent. |
| Disable result | {name} disabled. |
| Failure | That did not save. Nothing was changed. |
| Not-provided field marker | Not provided |

## 10. Empty states

An empty pending queue is the normal steady state and should read as such rather than as an error or a blank region.

## 11. Mobile differences

Desktop-first. The surface remains usable at narrow widths, with the detail panel stacking below the list, but it is not optimized and does not need a separate layout.

## 12. Authorization

Per section 4. Additionally: `approved_by` is set from the session user, never from a form field.

## 13. Error paths

| Failure | Rendered result |
|---|---|
| Approval transaction fails partway | Nothing written. Stated error. The organization stays pending and no email is queued |
| Organization already approved by another staff member | Treat as a no-op success. Refresh the row. Approval is idempotent per `Handbook.md` section 12 |
| The owner membership row is missing | This is a data defect from a partial MP-03 submission that should be impossible given its transaction boundary. Block the approval, state that the organization has no owner membership, and log it. Do not create the membership here |
| Email dispatch fails after approval | The approval stands. Logged as failed, visible at ADMIN-06, resendable there. The result message says the email failed rather than claiming it was sent |

The last row matters more here than anywhere: the welcome email is how an organization learns it can log in. A silent failure means an approved organization sits waiting indefinitely.

## 14. Out of scope

- Editing organization details.
- Approving requests or members. Separate queues.
- Deleting an organization.
- Bulk approval. Volume does not justify it and it removes the read-the-submission step that is the point of the queue.

## 15. Acceptance

- Pending organizations show every field submitted at MP-03.
- Approving sets organization status, activates the owner membership, writes two approval events, and queues one email, all in one transaction.
- Approving twice sends one email.
- An approved organization appears on public browse; a disabled one does not.
- Disabling does not change its requests' own status.
- Disabling does not clear `approved_at` or `approved_by`.
- Disable is available from pending and from approved (D13, D44).
- The pending count in the navigation matches the queue.
- A member org user cannot reach any `/admin` route.
- `approved_by` reflects the session user.
- A failed email is visible at ADMIN-06 and stated in the result message.

## 16. Open captures

| What is needed | Source |
|---|---|
| **O2: You mentioned you can edit an org's details in the backend — is that something you do as part of approving new organizations, or is it separate ongoing maintenance you do any time? If it's separate, does phase one need to replicate it, or can that wait?** | Christina. Default until answered: D12 stands; staff contact the organization instead. The Aug 14 answer was to a general question, not the pending-approval moment |
