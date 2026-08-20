# Data access — the published contract

Signatures, routes, and helpers here are **final** (foundation work order). The three
parallel surface tasks import them as-is; rename nothing.

All SQL lives in `server/dal/`. No other file may contain SQL — not routes, not
scripts, not the client. The one sanctioned exception is `server/dal/auth-provider.ts`,
the single place that reads a Better Auth table.

Server code imports with **relative paths** (`import * as dal from "../dal/index"`);
`@/` and `@shared/` aliases are for client code via Vite.

```ts
import * as dal from "../dal/index";           // dal.people, dal.itemRequests, …
import { SYSTEM, PUBLIC } from "../db/client"; // DbContext values
```

## 1. Database contexts (RLS)

Every DAL call takes a `DbContext` as its first argument. `withDbContext` opens a
transaction and sets two GUCs (`app.context`, `app.user_id`) that the row-level-security
policies in `server/db/rls-policies.sql` read. Policies exist and RLS is enabled and
forced on all 17 application tables, and the runtime connection role holds BYPASSRLS,
so policies do not filter at runtime. Visibility is enforced by route guards and
data-access predicates.

| Context | Constructor | Sees | Use for |
|---|---|---|---|
| `SYSTEM` | const | everything | seeds, auth linking, public writes through narrow DAL fns |
| `PUBLIC` | const | approved orgs; active+archived requests; active populations | PB-01…PB-06 reads |
| member | `{ kind: "member", userId }` | own orgs' rows via `org_memberships` | MP surfaces (userId from the guard) |
| staff | `{ kind: "staff", userId }` | everything | ADMIN surfaces (userId from the guard) |

Trust model: contexts are asserted by the server **after** a guard verified the session.
RLS is defense in depth against a buggy or missing WHERE clause, not against a
compromised process. Never construct a member/staff context from client input — only
from `req.liaOrg` / `req.liaStaff`.

`memberships.listByOrganization` runs correctly only under `SYSTEM`/staff context
(the org_memberships self-policy is own-rows-only); call it after the org guard, with
`SYSTEM`, scoped by the guard's `orgId`.

## 2. Guards and session

```ts
import { requireOrganization, requireStaff, orgContext, staffContext } from "../auth/guards";

app.get("/api/dashboard/…", requireOrganization, (req, res) => {
  const { userId, orgId, session } = orgContext(req);   // orgId is THE org id. Never read one from the request.
});
app.get("/api/admin/…", requireStaff, (req, res) => {
  const { userId, staffRole, session } = staffContext(req); // "staff_admin" | "staff_approver"
});
```

Guard responses (final):

| Guard | Condition | Response |
|---|---|---|
| requireOrganization | not signed in | `401 { message: "Authentication required" }` |
| requireOrganization | no active membership | `403 { message: "No active organization membership" }` |
| requireOrganization | >1 org, none chosen | `409 { message: …, code: "ORG_SELECTION_REQUIRED" }` |
| requireStaff | anything short of active staff membership | `404 { message: "Not found" }` — byte-identical to an unknown /api route |

Session plumbing (final):

- `GET /api/session` → `SessionInfo` (`shared/types.ts`): `{ authenticated, user, memberships, activeOrgId, isStaff, staffRole }`. Client hook: `useSession()` in `client/src/hooks/useSession.ts`.
- `POST /api/session/active-org` `{ orgId }` → sets the signed `lia_active_org` cookie after validating the org is one of the caller's active memberships. The 409 above means "send the user through this."
- Client admin shell: `AdminGate` in `client/src/App.tsx` renders NotFound for non-staff; the server-side 404 is the real boundary.

## 3. Auth (Better Auth, magic link only)

- `POST /api/login/magic-link` `{ email }` → **uniform** `200 { ok: true, message }` whether or not the email is registered (400 only for malformed shape). Never reveal registration status; the gate lives inside the send callback. Dispatch is rate-limited (3 per email, 10 per source IP, per 15 min — `server/auth/rate-limit.ts`); throttled requests get the same 200 and simply do not send.
- Better Auth handles `/api/auth/*` (mounted before body parsers). Verification URL is emailed; on success the user lands on `/dashboard` with a session cookie.
- On session create the app links `users.auth_subject` and stamps `users.last_login_at` (verified end-to-end).
- Disabled users (`users.status = 'disabled'`) get no link and resolve to anonymous sessions.
- `dal.authProvider.getAuthUserEmail(authUserId)` — the only Better Auth table read; takes no ctx.

## 4. Module reference

Types come from `shared/types.ts`. Temporal contract: `date` columns are `YYYY-MM-DD`
strings; `timestamptz` columns are ISO-8601 UTC strings (normalized in `server/db/client.ts`).
Render in America/Los_Angeles at the edge. All lists return `[]`, lookups return `null`
when missing; mutations throw on missing rows.

### dal.people
- `findByEmail(ctx, email): Person | null` — lower(email) match.
- `getById(ctx, personId): Person | null`
- `create(ctx, { firstName, lastName, email, phone?, sourceNote? }): Person`
- `updateNames(ctx, personId, firstName, lastName): Person` — in place; never split/concat elsewhere.
- `flagForReview(ctx, personId, note): Person` / `clearReviewFlag(ctx, personId): Person`
- `listNeedingReview(ctx): Person[]` (ADMIN-07)

### dal.users
- `findByAuthSubject(ctx, authSubject): UserWithPerson | null`
- `findByEmail(ctx, email): UserWithPerson | null` — joins people for name/email.
- `findByPersonId(ctx, personId): User | null`
- `create(ctx, { personId, status? }): User` — default status `invited`.
- `linkAuthSubject(ctx, userId, authSubject): User`
- `setLastLoginAt(ctx, userId): User`

### dal.organizations
- `getById(ctx, orgId)` / `getBySlug(ctx, slug)` / `getPlatformOwner(ctx)`: `Organization | null`
- `listByStatus(ctx, status): Organization[]` / `listAll(ctx): Organization[]`
- `listApprovedForPublic(ctx): PublicOrganization[]` — safe public shape.
- `create(ctx, CreateOrganizationInput): Organization` — always `pending`.
- `approve(ctx, orgId, approvedByUserId): Organization` — FOR UPDATE + approval event same-tx.
  Sources: `pending` (first approval) or `disabled` (deliberate re-enable); throws if already approved.
- `disable(ctx, orgId, actorUserId, note?): Organization` — + event.
- `updateDetails(ctx, orgId, UpdateOrganizationPatch): Organization` — allowlisted columns only.

### dal.memberships
- `listActiveByUser(ctx, userId): MembershipWithOrganization[]` — what the guards use.
- `listByOrganization(ctx, orgId): MembershipWithPerson[]` — SYSTEM/staff ctx (see §1).
- `getById(ctx, membershipId)` / `findByOrgAndUser(ctx, orgId, userId): OrgMembership | null`
- `create(ctx, { orgId, userId, role?, invitedBy? }): OrgMembership` — always `pending`; default role `member`.
- `activate(ctx, membershipId, approvedByUserId): OrgMembership` — + event. Sources: `pending`
  (approval) or `removed` (re-add — unique(org_id, user_id) makes this the only way back in).
- `removeByStatus(ctx, membershipId, actorUserId, note?): OrgMembership` — sets status `removed` + event. **Never DELETE.**
- `countActiveForOrganization(ctx, orgId): number`

### dal.populations
- `listAll(ctx): Population[]` — active first, sort_order.
- `findBySlug(ctx, slug): Population | null`
- `listByOrganization(ctx, orgId): Population[]`
- `setForOrganization(ctx, orgId, populationIds): void` — diff-syncs the join table (link table, not a workflow — sanctioned deletes).
- `create(ctx, { name, slug, sortOrder?, isActive? }): Population` / `rename(ctx, id, name)` / `deactivate(ctx, id)`

### dal.itemRequests / dal.volunteerRequests (mirrored)
- `getById(ctx, id)` / `getByLegacyWixId(ctx, legacyWixId)`: `…Request | null`
- `listByOrganization(ctx, orgId)` / `listByStatus(ctx, status)`: `…Request[]`
- `listActivePublic(ctx): Public…Request[]` — org-joined public shape.
- `createDraft(ctx, orgId, Create…RequestInput): …Request` — always `draft`.
- `update(ctx, orgId, requestId, Update…RequestPatch): …Request` — org-scoped patch.
- `transitionStatus(ctx, { requestId, to, actorUserId?, note?, archivedReason? }): …Request`
  — FOR UPDATE; stamps submitted/approved/archived timestamps; **approval event same-tx**.
  Legal edges only (`ALLOWED_TRANSITIONS`): `draft → pending` (submit), `pending → draft`
  (return for edits), `pending → active` (approve), `draft|pending|active → archived`
  (`archivedReason` **required**). Archived staff reinstatement uses its dedicated DAL function rather
  than this generic map.
  Same-status and every other edge throw.
- `unapproveForCorrectionInTx(client, requestId, actorUserId): …Request` — ADMIN-02-only
  `active → pending` correction transition. It is deliberately absent from `ALLOWED_TRANSITIONS`
  so member flows cannot call it. The staff service locks the request, rechecks all activity through
  `dal.items.assertNoItemActivityInTx` / `dal.volunteerRoles.assertNoVolunteerActivityInTx`, then this
  function clears `approved_at`/`approved_by` and writes the acting user's approval event atomically.
- Member receipt and confirmation saves use the same request-first, child-second lock order. A
  `quantity_received` or `quantity_confirmed` change rechecks `status = 'active'` while holding the
  request lock. Therefore either the activity write commits first and blocks unapproval, or
  unapproval commits first and the stale activity write is rejected; activity cannot land on Pending.
- `archive(ctx, requestId, reason, actorUserId?, note?): …Request` — convenience for the above.

### dal.items / dal.volunteerRoles (mirrored)
- `listByRequest(ctx, requestId): Item[] | VolunteerRole[]` — sort order.
- `getById(ctx, id)`
- `create(ctx, orgId, requestId, input): Item | VolunteerRole` — verifies the request belongs to the org; auto sort_order.
- `update(ctx, orgId, id, patch)` — patch types **cannot** express claimed/interested/remaining counters.
- `countOnRequest(ctx, requestId): number`
- `quantityRemaining` is generated by the database. Read it; never write it.

### dal.pledges / dal.signups
- `recordItemPledge(ctx, { firstName, lastName, email, phone?, requestId, notes?, lines: [{ itemId, quantity }] }): { pledgeId }`
- `recordVolunteerSignup(ctx, { firstName, lastName, email, phone?, requestId, notes?, roleIds }): { signupId }`
  — the ONLY way pledges/signups/counters/persons-from-public come into existence
  (they call the 0002 SQL functions, which also find-or-create the person, flag
  needs_review on name mismatch, and auto-archive a fully claimed item request with
  an approval event). Always run as SYSTEM internally.
  `phone` is safe to pass; a phone-only match never merges — see §7.
- Failures throw `PledgeError` / `SignupError` with `.code`:
  - pledges: `request_not_found | request_not_active | no_lines | invalid_quantity | item_not_in_request | insufficient_quantity`
  - signups: `request_not_found | request_not_active | no_roles | role_not_in_request | role_full | duplicate_role`
  Map codes to friendly copy in the surface; an insufficient_quantity/role_full response
  means "refresh the remaining counts you're showing."
- `findByPersonAndRequest(ctx, personId, requestId): ItemPledge | VolunteerSignup | null`
- `listByOrganization(ctx, orgId): PledgeWithSupporter[] | SignupWithSupporter[]`
- `listByRequest(ctx, orgId, requestId)` — supporter-joined, lines/roles aggregated.
- `resolveLinesForRequest(ctx, orgId, requestId)` / `resolveRolesForRequest(ctx, orgId, requestId)` — flat per-line/per-role rows for MP-09/MP-12 tables.

### dal.approvalEvents
- `insert(ctx, { entityType, entityId, fromStatus, toStatus, actorUserId?, note? }): ApprovalEvent`
- `insertInTx(client, input)` — same-transaction variant used inside DAL transitions.
- `listByEntity(ctx, entityType, entityId): ApprovalEvent[]` / `listRecent(ctx, limit=100)`
- You rarely call these: every DAL transition already writes its event. Never change a
  status without one.

### dal.emailLog
- `insertQueued(ctx, { templateKey, toEmail, toPersonId?, entityType?, entityId?, payload? })` →
  `{ duplicate: false, entry } | { duplicate: true }` — the once-only index
  (`email_log_once_idx`) makes repeat entity-bound sends a readable outcome, not an error.
- `markSent(ctx, emailLogId, providerMessageId)` / `markFailed(ctx, emailLogId, error)`
- `existsForRecipientInTx(client, { templateKey, entityType, entityId, toEmail }): boolean` — matches
  the once-only index inside a composed approval transaction. Non-failed/non-skipped rows suppress a
  duplicate; failed and disabled/skipped attempts remain eligible for a later approval send.
- `listWithFilters(ctx, { status?, templateKey?, toEmail?, limit? }): EmailLogEntry[]` (ADMIN-09)
- `countFailuresLastSevenDays(ctx): number`
- Surfaces should not call these directly — use `sendEmail()` (§5), which owns the discipline.

### dal.digestSubscribers
- `list(ctx, status?): DigestSubscriber[]` / `findByEmail(ctx, email)`
- `create(ctx, { email, personId?, legacySource? }): DigestSubscriber` — idempotent on lower(email); revives an unsubscribed row.
- `updateStatusByToken(ctx, token, status): DigestSubscriber | null` — unsubscribe links.
- `exportAll(ctx): DigestSubscriber[]` (ADMIN-08 CSV)

### dal.validation
- `counterDrift(ctx): { kind, id, stored, actual }[]` — healthy = `[]`.

## 5. Email

```ts
import { sendEmail } from "../email/send";
const result = await sendEmail({ templateKey, toEmail, toPersonId?, entityType?, entityId?, payload?, subject, html, text? });
// → { outcome: "sent", emailLogId, providerMessageId } | { outcome: "duplicate" }
```

- Log row is written **before** dispatch; provider failures mark the row failed and **throw**.
- Bind `entityType`/`entityId` for once-only sends (approvals, confirmations). Leave them
  null for repeatable sends (login links).
- Template modules live in `server/email/templates/` (see `auth-magic-link.ts` for the pattern).
- Env: `POSTMARK_SERVER_TOKEN` (secret), `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`. Missing config
  throws after logging a failed row — no silent skips.

## 6. Storage

```ts
import * as storage from "../storage/object-storage";
const { url } = await storage.storeImage({ data, filename }); // → "/storage/images/<uuid>.<ext>" — store THIS in *_url columns
await storage.readImage(url);   // → { data, contentType } (the GET /storage/* route serves these)
await storage.deleteImage(url); // missing object is not an error
await storage.isAvailable();    // bucket reachability probe
```

The adapter is the only object-storage path. Never store provider URLs or external
image URLs; `storeImage` is the only source of image URLs. Read/delete accept **only**
the exact generated form `/storage/images/<uuid>.<known-ext>` — anything else throws,
so the public `/storage/*` route cannot reach other objects in the bucket. A missing bucket fails
loudly with instructions (create one in the App Storage tool).

## 7. Pledge/signup `phone` — resolved by `0002` (Aug 17 2026, captain-ordered)

`migrations/0002_phone_match_names_all_duplicates.sql` replaced the phone-match
block in `record_item_pledge()` / `record_volunteer_signup()` (the 0001 versions
crashed on any non-empty phone: `min(id)` over `uuid`). Current behavior:

- Email match still wins: the same email updates the existing person in place.
- A phone-only match **always creates a new person** with `needs_review = true`
  and a `review_note` naming EVERY matched person —
  `… matches existing person Alex Rivera <alex@…> (id)`, or
  `… matches 2 existing people: Alex …; Blake …` (ordered by `created_at, id`).
- Nothing is ever merged automatically; resolution belongs to ADMIN-04.
- Matching compares full digit strings, so `+1`-prefixed input does not match a
  bare 10-digit number (tracked as a follow-up task).

PB-03/PB-04 may pass `phone` freely.

## 8. Routes, scripts, environment

- Page routes: `SURFACE_ROUTES` in `shared/routes.ts` (final; placeholders render per
  surface until each task lands). Legacy Wix paths 301 on a `legacy_wix_id` match, else
  302 to the browse page. Unknown `/api/*` → `404 { message: "Not found" }`.
- Scripts: `npm run dev` (port 5000) · `check` (strict tsc) · `db:apply-migrations`
  (applies pending `/migrations` files in order, tracked in `schema_migrations`;
  safe to re-run on any database) · `db:seed` (idempotent; prints staff logins) ·
  `db:apply-rls` · `db:apply-auth-schema` · `db:dump-schema` (regenerates
  `schema.sql` — never hand-edit it) · `build` / `start` (production).
- Env: `DATABASE_URL` (managed), `SESSION_SECRET` (set), `EMAIL_FROM_ADDRESS` /
  `EMAIL_FROM_NAME` (set), `POSTMARK_SERVER_TOKEN` (secret), `APP_BASE_URL`
  (production only — dev falls back to the live `REPLIT_DEV_DOMAIN`).
- Seeded staff logins: `tiffany@defendingthecause.org` (staff_admin),
  `christina@defendingthecause.org` (staff_admin), `approver@thealliance.example.org`
  (staff_approver — synthetic, cannot receive mail). Org owners:
  `dana@heartsandhands.example.org`, `samuel@newhorizons.example.org`,
  `grace@safeharbor.example.org`.
