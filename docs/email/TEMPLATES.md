# docs/email/TEMPLATES.md

Eleven of twelve templates are captured, subject and body. One remains: `org_member_approved`.

Read `Handbook.md` section 13 first. This file is the implementation detail, not the policy.

---

## 1. A defect in the dedup index, which blocks this lane

`email_log_once_idx` is unique on `(template_key, entity_type, entity_id)` where `entity_id is not null and status <> 'failed'`.

Five of the twelve templates send to more than one recipient for the same entity:

- The four staff notifications each go to two addresses, a primary staff contact and a general information address.
- `org_request_approved` goes to the organization's primary contact and to the request's creator.

Under the current index, the first row inserts and **the second is rejected by the database**. One recipient gets the email. The other silently gets nothing, and the failure looks like a constraint violation rather than a missing notification.

This is not an edge case. It affects every organization submission, every request submission, every member invitation, and every request approval, which is most of the traffic in the system.

**Recommended fix: add `to_email` to the index.**

```sql
drop index email_log_once_idx;

create unique index email_log_once_idx
  on email_log (template_key, entity_type, entity_id, lower(to_email))
  where entity_id is not null and status <> 'failed';
```

This preserves what the index is actually for, which is once per recipient per entity, and it keeps the idempotent-approval behavior in `Handbook.md` section 12 intact: approving twice still sends each person one email.

**Ratified as D32** and folded into `migrations/0001_initial_schema.sql`.

---

## 2. Shared behavior

**Dispatch.** Provider is Resend. Every send writes an `email_log` row at `queued` before dispatch and updates it to `sent` with the provider message id, or to `failed` with the error. Sends never block a user-facing response: queue inside the transaction, respond, dispatch after.

**Sender.** From address and display name in environment variables. Reply-to is set per template; see each entry. The sending domain needs SPF, DKIM, and DMARC verified before any real send, per `Handbook.md` section 18.

**Variable resolution.** Every variable resolves before send. A template that would render an empty name, an empty organization, or a literal placeholder **does not send**: log it `failed` with the reason and surface it at ADMIN-06. This rule is the direct fix for the blank-name failure in `Handbook.md` section 16 and it applies without exception. A missing optional value means the surrounding line is omitted, not that the line renders with a blank.

**Links.** Every link is an absolute URL on the app's own domain, built from an environment variable. No relative paths, no hardcoded hosts. Staff notification links go to the specific admin queue, not to a generic admin landing.

**Plain text.** Every template ships an HTML part and a plain-text part. The text part is written, not auto-stripped from the HTML.

**Styling.** Minimal. Navy and white from `Design.md`, system font stack rather than the web fonts, single column, no background images. Email clients are not browsers and the design tokens are a reference here rather than a specification.

**Recipients.** Staff addresses come from environment variables, never hardcoded. Everyone else resolves from the database.

**No unsubscribe footer on these twelve.** All are transactional. The digest, which needs one, is phase two.

**Item and role lists render as tables in email bodies** (`Item | Number Donated`, or a role list under its own heading), not the inline "3x Blankets, 2x Pillows" string MP-13 uses on screen. Both read the same computed data (`item_pledge_lines` / `volunteer_signup_roles`); the layout differs by context, the values never do. Ratified as D51.

---

## 3. Body copy — status

Eleven of twelve captured: the four staff notifications, `org_approved`, `org_request_received`, `org_request_approved`, `org_new_item_donation`, `org_new_volunteer`, `donor_item_confirmation`, `donor_volunteer_confirmation`. Sourced from Tiffany's Staff, Member Organization, and Community email exports, copied verbatim, Aug 16 2026.

**`org_member_approved` is not yet captured.** See section 5 and `OPEN-ITEMS.md`.

**Two small captures remain open**, both noted inline where they apply: the exact words `itemOrVolunteer` resolves to (`org_request_received`).

Tiffany flagged on the Aug 14 call that one of the 12 triggered emails (new-user-login approval) may be obsolete now that magic link is decided (D40, confirmed). `org_member_approved` is written into this spec as a magic-link email already, so the working assumption is that it's being kept, just reworded for the new login method, not dropped. Confirm this reading when the body is captured rather than assuming it.

**No formal mobile capture for these 12 (B3).** Wix's triggered-email editor has no mobile preview for any of the 12 templates; formal mobile capture is waived for these 12 specifically. This does not answer B6/O7, which covers the 18 bound surfaces and remains open.

---

## 4. Staff notifications

Reply-to: the sending address. Recipients: both staff addresses, from environment variables.

### `staff_new_org`

| | |
|---|---|
| **Trigger** | Organization submitted at MP-03 |
| **Entity** | `organization` / the new organization's id |
| **Subject** | `Organization Pending Approval: {organizationName}` |
| **Variables** | `organizationName`, `organizationAddress`, `organizationPhone`, `organizationWebsite`, `primaryContactName`, `primaryContactEmail`, `primaryContactPhone`, `adminUrl` |

**Body:**

> **New Organization Pending Approval**
>
> The following organization has requested approval to use the Love in Action Database:
>
> **Organization Details**
> Name: {organizationName}
> Address: {organizationAddress}
> Phone Number: {organizationPhone}
> Website: {organizationWebsite}
>
> **Primary Contact**
> Name: {primaryContactName}
> Email: {primaryContactEmail}
> Phone: {primaryContactPhone}
>
> [Button: Review & Approve] → {adminUrl} (`/admin/organizations`, ADMIN-01)

Variable resolution: `organizationName`→`organizations.name`. `organizationAddress`→`organizations.address_formatted`. `organizationPhone`→`organizations.phone`. `organizationWebsite`→`organizations.website_url`. `primaryContactName/Email/Phone`→`people` via `organizations.primary_contact_person_id`. One approval link, not the two Wix sent (D55).

---

### `staff_new_item_request`

| | |
|---|---|
| **Trigger** | Item request submitted at MP-08, or moved to pending at MP-09 |
| **Entity** | `item_request` / the request id |
| **Subject** | `Item Request Pending Approval: {itemRequestName}` |
| **Variables** | `itemRequestName`, `organizationName`, `organizationPrimaryContact`, `organizationPrimaryContactEmail`, `adminUrl` |

**Body:**

> **Item Request Pending Approval**
>
> A new item request has been submitted. Here are the details for review & approval:
>
> **Item Request Details**
> Request Name: {itemRequestName}
> Organization: {organizationName}
> Primary Contact: {organizationPrimaryContact}
> Primary Contact's Email: {organizationPrimaryContactEmail}
>
> [Button: View/Approve Item Request] → {adminUrl} (`/admin/requests`, ADMIN-02, Items filter)

Variable resolution: `itemRequestName`→`item_requests.title`. `organizationName`→`organizations.name` via `item_requests.org_id`. Contact fields→`people` via `organizations.primary_contact_person_id`. States contact info, not an item count; captured source has no count.

---

### `staff_new_volunteer_request`

| | |
|---|---|
| **Trigger** | Volunteer request submitted at MP-11, or moved to pending at MP-12 |
| **Entity** | `volunteer_request` / the request id |
| **Subject** | `Volunteer Request Pending Approval: {volunteerRequestName}` |
| **Variables** | `volunteerRequestName`, `organizationName`, `organizationPrimaryContact`, `organizationPrimaryContactEmail`, `adminUrl` |

**Body:**

> **Volunteer Request Pending Approval**
>
> A new volunteer opportunity has been submitted. Here are the details for review & approval:
>
> **Volunteer Request Details**
> Volunteer Request: {volunteerRequestName}
> Organization: {organizationName}
> Primary Contact: {organizationPrimaryContact}
> Primary Contact's Email: {organizationPrimaryContactEmail}
>
> [Button: View/Approve Volunteer Request] → {adminUrl} (`/admin/requests`, ADMIN-02, Volunteer filter)

Variable resolution: same pattern as `staff_new_item_request`, sourced from `volunteer_requests`.

---

### `staff_new_user`

| | |
|---|---|
| **Trigger** | Member invited at MP-06 |
| **Entity** | `org_membership` / the new membership id |
| **Subject** | `New Member Pending Approval: {memberName}` |
| **Variables** | `memberName`, `memberEmail`, `memberPhone`, `organizationName`, `submitterName`, `submitterEmail`, `adminUrl` |

**Body:**

> **New Database User Pending Approval**
>
> An Alliance Member has requested a new teammate be given access to the Love in Action Database. Here is their information:
>
> **Requesting Member Details**
> Organization: {organizationName}
> Requesting Contact: {submitterName}
> Requesting Contact's Email: {submitterEmail}
>
> **New Member Details**
> Name: {memberName}
> Email: {memberEmail}
> Phone: {memberPhone}
>
> [Button: Review & Approve New Member] → {adminUrl} (`/admin/members`, ADMIN-03)

Variable resolution: `submitterName/Email`→the inviting user, from `org_memberships.invited_by`. `memberName/Email/Phone`→the invited person's `people` row. Links to ADMIN-03, not the old contacts-system record.

---

## 5. Organization notifications

Reply-to: the staff primary contact address, so a member replying reaches a person.

### `org_approved`

| | |
|---|---|
| **Trigger** | Organization approved at ADMIN-01 |
| **Recipient** | Primary contact |
| **Entity** | `organization` / the organization id |
| **Subject** | `Welcome to the Love in Action Database {organizationName}` |
| **Variables** | `organizationName`, `orgAddress`, `orgPhoneNumber`, `websiteUrl`, `missionStatement`, `primaryPopulationServed`, `organizationPrimaryContact`, `organizationPrimaryContactEmail`, `organizationPrimaryContactPhone`, `dashboardUrl` |

**Body:**

> **Your Organization Has Been Approved!**
>
> Hi {organizationName},
>
> You've been approved to start using The Alliance's Love in Action Database! We can't wait to help get your donation needs and volunteer opportunities met by community members.
>
> Within the next few minutes you will be receiving a second email with instructions on how to log in to your new dashboard.
>
> Please review the information in your organization's profile below and save this email for your records.
>
> [Button: Go to Your Dashboard] → {dashboardUrl} (`/login`)
>
> **Organization Details**
> Name: {organizationName}
> Address: {orgAddress}
> Phone: {orgPhoneNumber}
> Website: {websiteUrl}
> Mission Statement: {missionStatement}
> Population Served: {primaryPopulationServed}
>
> Primary Contact: {organizationPrimaryContact}
> Primary Contact's Email: {organizationPrimaryContactEmail}
> Primary Contact's Phone #: {organizationPrimaryContactPhone}
>
> If you have questions about using any of the features of this database, please email **Christina Moe**, our Love in Action Program Director, at christina@defendingthecause.org.

**This is the highest-consequence email in the system.** It is how an approved organization learns it can start posting. A silent failure leaves them waiting indefinitely with no signal anywhere they can see. ADMIN-01's result message states the failure explicitly for this reason.

**No logo block.** `organizations.logo_url` is null for every organization this sprint (D50). This template does not render an organization logo image, including the placeholder captured in the source.

**The "second email"** this body promises is `org_member_approved`, below. Not yet captured.

---

### `org_request_received`

| | |
|---|---|
| **Trigger** | Request submitted at MP-08 or MP-11 |
| **Recipient** | The submitting member |
| **Entity** | `item_request` or `volunteer_request` / the request id |
| **Subject** | `{itemOrVolunteer} Request Pending Approval: {requestName}` |
| **Variables** | `itemOrVolunteer`, `organizationName`, `requestName`, `requestDescription`, `requestContactName`, `requestContactEmail`, `requestContactPhone`, `requestId`, `itemsOrRoles` |

**Body:**

> **Request Pending Approval**
>
> Hi {organizationName},
>
> Thank you for submitting the following request through The Alliance's Love in Action Database. Our team will create a custom graphic with your logo and publish your need within 1–2 business days. Once your post goes live, you will receive a confirmation email with the information so you can share this need to your own community and social media platforms.
>
> **Request Details**
> Name: {requestName}
> Description: {requestDescription}
>
> Request Contact: {requestContactName}
> Contact's Email: {requestContactEmail}
> Contact's Phone: {requestContactPhone}
> Unique ID: {requestId}
>
> **{itemOrVolunteer}s Details**
> {itemsOrRoles}

`itemOrVolunteer` renders as the word the subject line uses for each type. **`[CAPTURE]` the two exact words** — captured source shows the raw placeholder, not the resolved text, so this is still open. Getting it wrong is visible in every member's inbox.

Variable resolution: `organizationName`→`organizations.name` via the request's `org_id`. `requestName/Description`→the request's `title/description`. `requestContactName/Email/Phone`→the request's own contact fields, captured as two inputs at MP-07/MP-10 (D41), not the organization's `primary_contact_person_id`. `itemsOrRoles`→the items or roles on the request at submission.

---

### `org_request_approved`

| | |
|---|---|
| **Trigger** | Request approved at ADMIN-02 |
| **Recipients** | Organization's primary contact **and** the request's creator. One email each. If they are the same person, one email total |
| **Entity** | `item_request` or `volunteer_request` / the request id |
| **Subject** | `Your Love in Action Request was Approved!` |
| **Variables** | `organizationName`, `viewRequestUrl`, `requestName`, `requestDescription`, `requestContactName`, `requestContactEmail`, `requestContactPhone`, `itemOrVolunteer`, `itemsOrRoles` |

**Body:**

> **Your Request Has Been Approved!**
>
> Hi {organizationName},
>
> Your request was approved and published to the Love in Action Database!
>
> For your convenience, here is the URL to your published need and a photo so you can share this request with your community and post it on your social media sites.
>
> URL: {viewRequestUrl}
>
> **Request Details**
> Name: {requestName}
> Description: {requestDescription}
>
> **Request Contact**
> Request's Contact: {requestContactName}
> Contact's Email: {requestContactEmail}
> Contact's Phone: {requestContactPhone}
>
> **{itemOrVolunteer}s Details**
> {itemsOrRoles}
>
> Thank you,
> **The Alliance Love in Action Team**
>
> [Button: View Your Request] → {viewRequestUrl}

The public link is present, confirmed (`viewRequestUrl`). `viewRequestUrl`→`/items/{id}` or `/volunteer/{id}` per the URL architecture doc.

**Dedup:** depends on the index fix in section 1. Without it the second recipient gets nothing.

---

### `org_member_approved`

| | |
|---|---|
| **Trigger** | Membership approved at ADMIN-03 |
| **Recipient** | The new member |
| **Entity** | `org_membership` / the membership id |
| **Subject** | `Love in Action Database Login Info for {memberName}` |
| **Variables** | `memberName`, `organizationName`, `loginUrl`, `dashboardUrl` |

Body must contain: that they have been approved, which organization, how to log in, and a link. **`[CAPTURE]` body.** Not yet retrieved.

Second-highest consequence after `org_approved`, and it fails the same way: the person can log in but has no way to find out. ADMIN-03's result message states a failure explicitly.

Login wording describes requesting a link at `/login`, not entering a password (D40, confirmed Aug 14).

---

### `org_new_item_donation`

| | |
|---|---|
| **Trigger** | Item pledge recorded at PB-02 |
| **Recipient** | The request's contact person |
| **Reply-to** | The donor's email |
| **Entity** | `item_pledge` / the pledge id |
| **Subject** | `Item(s) have been donated for {requestName}` |
| **Variables** | `organizationName`, `requestName`, `requestDescription`, `requestUrl`, `items`, `donorName`, `donorEmail`, `donorPhone`, `supportersUrl` |

**Body:**

> **New Item(s) Have Been Donated!**
>
> Hi {organizationName},
>
> Congratulations, someone is interested in donating items to your organization! Their details and which item(s) they've claimed are included below. This donor has been instructed to reach out to you in the **next 2 weeks** to set up delivery of the item(s) but you may also contact them directly.
>
> **Request Details**
> Name: {requestName}
> Description: {requestDescription}
> Request Link: {requestUrl}
>
> **Item(s) Donated**
> Item | Number Donated
> {items}
>
> **Donor Information**
> Name: {donorName}
> Email: {donorEmail}
> Phone: {donorPhone}
>
> Thank you,
> **The Alliance Love in Action Team**
>
> [Button: View Donors] → {supportersUrl} (`/dashboard/supporters`, MP-13)

`organizationName` added to the variable list (D56) — required by the greeting, missing from the original table. `items` is `item_pledge_lines` for this pledge, one table row per item (D51). `donorName/Email/Phone`→the pledging `people` row.

`entity_type` is `item_pledge`, not in the `approval_events` check constraint and doesn't need to be; `email_log.entity_type` is unconstrained text. Dedup here prevents a double-send on retry, not legitimate repeats.

---

### `org_new_volunteer`

| | |
|---|---|
| **Trigger** | Volunteer signup recorded at PB-04 |
| **Recipient** | The request's contact person, and both staff addresses (D53) |
| **Entity** | `volunteer_signup` / the signup id |
| **Subject** | `A Volunteer has Expressed Interest in Serving` |
| **Variables** | `organizationName`, `requestName`, `requestDescription`, `requestDetails`, `requestUrl`, `roles`, `donorName`, `donorEmail`, `donorPhone`, `donorNotes`, `supportersUrl` |

**Body:**

> **A New Volunteer Has Expressed Interest!**
>
> Hi {organizationName},
>
> Congratulations, someone is interested in volunteering with your organization! Their details and which role(s) they are interested in are included below. Please reach out to this person in the **next 1–3 business days** to confirm the requirements for this volunteer opportunity and provide any additional details they need for participating.
>
> **Request Details**
> Name: {requestName}
> Description: {requestDescription}
> Details: {requestDetails}
> Request Link: {requestUrl}
>
> **Role Details**
> {roles}
>
> **Volunteer Information**
> Name: {donorName}
> Email: {donorEmail}
> Phone: {donorPhone}
> Notes: {donorNotes}
>
> Thank you,
> **The Alliance Love in Action Team**
>
> [Button: View Volunteers] → {supportersUrl} (`/dashboard/supporters`, MP-13)

`organizationName` added (D56), same as `org_new_item_donation`. Both staff addresses are recipients alongside the org contact (D53), matching captured behavior. `donorNotes` is the free-text field from PB-04, shown in full, never truncated — this is the email the organization acts on and the accommodation is the part they most need to read before making contact.

Subject line stays as captured (D30). Confirmed matching the captured source exactly.

---

## 6. Supporter confirmations

Reply-to: the requesting organization's contact email, so a donor replying reaches the organization directly rather than staff.

### `donor_item_confirmation`

| | |
|---|---|
| **Trigger** | Item pledge recorded at PB-02 |
| **Recipient** | The person who pledged |
| **Entity** | `item_pledge` / the pledge id |
| **Subject** | `Thank you for donating item(s) to {organizationName}` |
| **Variables** | `donorName`, `organizationName`, `requestContactName`, `requestContactEmail`, `requestContactPhone`, `requestName`, `requestDescription`, `requestDeadlineType`, `dropoffLocation`, `requestUrl`, `items` |

**Body:**

> **Thank You for Meeting a Need!**
>
> Hi {donorName},
>
> Thank you so much for signing up to meet a need through {organizationName}! Please collect or purchase the item(s) within the **next 2 weeks** and reach out to {requestContactName} at ({requestContactEmail}) to coordinate delivery. You are welcome to mail the item(s) or set up a time to drop off. If you have questions regarding this donation, please feel free to reach out directly to {requestContactName}.
>
> By participating in The Alliance's **Love in Action Program**, you are making a difference for local kids and families!
>
> Here are the details of the need you are meeting:
>
> **Contact**
> Name: {requestContactName}
> Email: {requestContactEmail}
> Phone #: {requestContactPhone}
>
> **Request Details**
> Name: {requestName}
> Description: {requestDescription}
> Deadline Type: {requestDeadlineType}
> {dropoffLocation — omitted when null, per section 2}
> Website Link: {requestUrl}
>
> **Item(s) Donated**
> Item | Number Donated
> {items}
>
> Thank you,
> **The Alliance Love in Action Team**
>
> If you have any questions or you email the contact and do not hear back from them within 1 week, please email **Christina Moe**, our Love in Action Program Director, at christina@defendingthecause.org.

The fulfillment window ("next 2 weeks") is kept exactly as captured, matching the PB-02 agreement checkbox. `donorName` is the full name, not first-name-only, matching captured source. `dropoffLocation`→`item_requests.dropoff_location`, nullable; omitted when null, never rendered as "N/a." Deadline-date line omitted unless `deadline_type = 'date_specific'`.

This email is the only channel a donor has to ask a question, change a quantity, or cancel, since there is no path in the app to modify a pledge — the organization's contact details are required content, never optional.

---

### `donor_volunteer_confirmation`

| | |
|---|---|
| **Trigger** | Volunteer signup recorded at PB-04 |
| **Recipient** | The person who expressed interest |
| **Entity** | `volunteer_signup` / the signup id |
| **Subject** | `Thank you for expressing interest in volunteering!` |
| **Variables** | `donorName`, `organizationName`, `requestContactName`, `requestContactEmail`, `requestContactPhone`, `requestName`, `requestDescription`, `requestDeadlineType`, `requestDetails`, `requestUrl`, `roles`, `followUpWindow` |

**Body:**

> **Thank You for Expressing Interest!**
>
> Hi {donorName},
>
> Thank you so much for signing up to volunteer with {organizationName}! {requestContactName} from their team will be reaching out to you **within {followUpWindow}** with more details. If you have any questions or want to reach out directly, you can email them at ({requestContactEmail}).
>
> By participating in The Alliance's Love in Action Program, you are making a difference for local kids and families!
>
> Here are the details of this volunteer role:
>
> **{organizationName} Contact**
> Name: {requestContactName}
> Email: {requestContactEmail}
> Phone #: {requestContactPhone}
>
> **Request Details**
> Name: {requestName}
> Description: {requestDescription}
> Volunteer Type: {requestDeadlineType}
> Details: {requestDetails}
> Website Link: {requestUrl}
>
> **Role Details**
> {roles}
>
> Thank you,
> **The Alliance Love in Action Team**
>
> If you have any questions or do not hear from the {organizationName} contact within 1 week, please email **Christina Moe**, our Love in Action Program Director, at christina@defendingthecause.org.

**`followUpWindow` = "1-3 business days," added per D52.** Captured source said only "soon," with no number — the spec requires a stated window matching PB-04's on-screen text and `org_new_volunteer`'s commitment to the org (1-3 business days) and Christina's confirmed 48-hour operational target. Decided to state it explicitly rather than leave it vague. PB-04's instructional copy now uses the same wording, closing the conflict with this decision.

---

## 7. Testing

Verified against a live inbox before the build is done, per `Handbook.md` section 18. For each of the twelve:

- Renders in HTML and in plain text
- Every variable resolves, with no placeholder text and no blank name
- Every link resolves to the right entity on the right host
- Arrives in a real inbox, not spam, from the verified domain
- Writes exactly one `email_log` row per recipient, at `sent`

Then the negative tests:

- A send with an unresolvable variable does not go out and logs `failed` with a readable reason at ADMIN-06. This is one of the five tests in `Handbook.md` section 16.
- Approving the same entity twice produces one email per recipient, not two.
- A multi-recipient template produces one row per recipient. **This is the test that catches the index defect in section 1 if the fix has not been applied.**

---

## 8. Open captures

| What is needed | Source |
|---|---|
| **`org_member_approved` body, verbatim** | The sending platform's triggered-email editor. Owner-level access. On arrival, confirm it's being kept (reworded for magic link) rather than dropped — see section 3 |
| **The two words `itemOrVolunteer` renders as**, exact capitalization | Same source, `org_request_received` and `org_request_approved` subjects |
| Formal mobile capture of the 12 templates | **Waived** per B3. Does not answer B6/O7 |
| From address, display name, and staff recipient addresses | Executive director |
