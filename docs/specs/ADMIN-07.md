# ADMIN-07 — Audit trail

| | |
|---|---|
| **Route** | `/admin/activity` |
| **Access** | Staff admin or staff approver |
| **Bound** | No. Build for clarity |
| **Screenshots** | None |
| **Depends on** | Every surface that writes an approval event, ADMIN-01 section 4 (shell) |
| **Spec status** | Complete |

---

## 1. Purpose

Every status transition in the system, in reverse chronological order, with who did it and when. Role-based approval is only meaningful if approvals are recorded, and this surface is where the record is legible.

It answers three questions the operator actually asks: who approved this, when did this request go public, and why did this disappear.

## 2. Entry and exit

**Arrives from:** the admin navigation, and from any entity's detail on ADMIN-01 through ADMIN-04 filtered to that entity.
**Leaves to:** each row links to its entity.

## 3. Data

**Reads:** `approval_events`, joined to `actor_user_id` through `users` to `people` for the actor's name, and resolving `(entity_type, entity_id)` to the named entity.

**Writes:** Nothing. This surface is read-only and must stay that way. An editable audit trail is not one.

**Functions called:** None.

## 4. Layout regions

Renders inside the shared admin shell.

1. **Filters.** Entity type, actor, date range.
2. **Event list.** Timestamp, entity type, entity name, transition, actor, note.

No detail panel. Each row carries everything, and the entity link goes to the entity itself.

## 5. Fields

Filters only.

| # | Label | Control | Required | Binds to | Validation |
|---|---|---|---|---|---|
| 1 | Type | Select | No | `approval_events.entity_type` | The entity types, shown by readable name |
| 2 | Actor | Select | No | `approval_events.actor_user_id` | Staff who have recorded events, plus an Automated option matching a null actor |
| 3 | From / To | Date range | No | `approval_events.created_at` | |

Default view: last thirty days, all types, most recent first.

**The Automated option matters.** The nightly expiry job writes events with a null actor, and an operator wondering why forty requests archived overnight needs to be able to see that a job did it rather than a person. Render a null actor as `Automated`, never as blank.

**Transition rendering.** Show `from_status → to_status` as readable text rather than raw column values. `pending → active` reads as "Approved and published." Keep the mapping in one place, shared with the other admin surfaces' result messages.

## 6. Actions

None. Read-only. No CSV export (D25).

## 7. Conditional behavior

| Trigger | Result |
|---|---|
| `actor_user_id` is null | Actor renders as `Automated` |
| The event carries a note | The note renders in the row. Return-to-draft notes from ADMIN-02 are the main case and they are the substance of that event |
| The entity no longer resolves | Render the event with the entity type and id, marked as no longer present. Never drop the event. An audit trail that hides events about deleted things is not an audit trail |
| Filtered to a single entity | The list reads as that entity's full history, oldest at the bottom |
| `entity_type = 'person'` | Merge events from ADMIN-04 appear here (D31) |

## 8. Copy

| Context | Text |
|---|---|
| Page heading | Activity |
| Empty state, no activity yet | No activity recorded yet. |
| Empty state, filters applied | No activity matches your filters. |
| Automated actor | Automated |
| Missing entity marker | No longer present |
| Transition labels | A shared readable mapping. For example: Submitted for approval, Approved and published, Returned to draft, Archived, Archived automatically after expiry, Reinstated, Organization approved, Organization disabled, Member approved, Member removed |

## 9. Empty states

Two distinct empty states:

- **Nothing has ever been recorded.** "No activity recorded yet." On a live system after go-live, an empty trail means transitions are not writing events, which is a defect in whatever surface performed them, not in this one.
- **Filters applied, zero results.** "No activity matches your filters." Different message, different meaning.

## 10. Mobile differences

Desktop-first.

## 11. Authorization

Staff admin or staff approver, per ADMIN-01 section 4.

## 12. Error paths

| Failure | Rendered result |
|---|---|
| Query fails | A stated error. Never an empty list, which reads as no activity |
| An entity id does not resolve | Rendered per section 7, not hidden |
| An actor's person record was merged at ADMIN-04 | The event still resolves, through the surviving person. Verify this after any merge; it is one of the references the merge reassigns |

## 13. Out of scope

- Editing or deleting any event.
- Creating events by hand.
- Export.
- Any metric, count, or chart built on this data. It is a log, not a reporting surface, and reporting is phase two.

## 14. Acceptance

- Every status transition performed anywhere in the system appears here, including automated ones.
- The nightly expiry job's events appear with `Automated` as the actor.
- Filtering by type, actor, and date works independently and together.
- Return-to-draft notes are visible in their rows.
- Filtering to one entity shows its full history in order.
- An event whose entity no longer resolves still renders.
- No action on this surface writes anything.
- Approving an organization produces two events, one for the organization and one for its owner membership, and both are visible.

## 15. Open captures

None.
