# ADMIN-05 — Populations management

| | |
|---|---|
| **Route** | `/admin/populations` |
| **Access** | Staff admin only |
| **Bound** | No. Build for clarity |
| **Screenshots** | None |
| **Depends on** | Migration (seeds the list), ADMIN-01 section 4 (shell) |
| **Spec status** | Complete |

---

## 1. Purpose

Where staff manage the list of populations that organizations select from when describing who they serve. The list is seeded per D61 (ten canonical values plus Other), and this surface is how it evolves afterward without a developer.

Its second job matters more than its first: surfacing what organizations typed into the free-text Other field, so a value that keeps recurring becomes a real option instead of accumulating as unsearchable text.

## 2. Entry and exit

**Arrives from:** the admin navigation, and from ADMIN-01 when a pending organization submitted an Other value.
**Leaves to:** stays on the surface.

## 3. Data

**Reads:** `populations` with a count of `organization_populations` rows per population. Distinct `organizations.populations_other` values with their counts and the organizations holding each.

**Writes:** `populations` inserts, name and slug updates, `sort_order`, `is_active`. On promotion: a new `populations` row, `organization_populations` rows for each organization that held the free-text value, and clears `organizations.populations_other` for those organizations.

**Functions called:** None.

**Never touches:** organization status or any other organization field.

## 4. Layout regions

Renders inside the shared admin shell.

1. **Population list.** One row per population: name, slug, how many organizations hold it, active state, and reorder controls.
2. **Add population form.**
3. **Other values region.** Each distinct `populations_other` value, its count, the organizations that submitted it, and a promote action.

Region 3 is not a secondary feature. It is the reason this surface exists rather than the list being a static seed.

## 5. Fields

| # | Label | Control | Required | Binds to | Validation |
|---|---|---|---|---|---|
| 1 | Name | Text | Yes | `populations.name` | Non-empty, unique |
| 2 | Slug | Text | Yes | `populations.slug` | Non-empty, unique, lowercase and hyphenated. Generated from the name, editable before first save |
| 3 | Active | Toggle | n/a | `populations.is_active` | |

`sort_order` is set by the reorder control, not typed.

**Slug is not editable after creation (D18).** Nothing consumes population slugs today, but phase-two per-organization public pages likely will, and a slug that changes after something links to it is a broken link.

## 6. Actions

**Add population**
- Enabled when: name and slug validate and neither collides.
- Does: inserts a `populations` row, active, at the end of the sort order.

**Rename**
- Enabled when: the new name is non-empty and unique.
- Does: updates `populations.name` only. The slug does not follow.
- Note in the interface: renaming changes the label everywhere it appears, including on live public request pages.

**Reorder**
- Does: updates `sort_order` across affected rows. The order here is the order organizations see when selecting at MP-03.

**Deactivate**
- Enabled when: the population is active.
- Confirms: names the population and states how many organizations hold it.
- Does: sets `is_active = false`. **Existing `organization_populations` rows are untouched.** Deactivating removes the option from new selections; it does not strip the population from organizations that already serve it.
- The Other row is seeded permanent infrastructure (schema comment), not an ordinary staff-managed value. **Deactivate is blocked** for Other, with the stated reason in section 8. Removing it would leave organizations no way to describe anything unlisted.

**Promote an Other value**
- Enabled when: at least one organization holds the value.
- Confirms: names the value, states how many organizations will be reassigned, and lists them.
- Does, in one transaction: creates a `populations` row from the value (operator may edit the name first, D19), inserts an `organization_populations` row for each organization that submitted it, and clears `populations_other` on those organizations.
- On success: the value leaves the Other region and appears in the population list with its count.
- On failure: nothing written, stated error.

The operator may edit a free-text value's name before promoting (D19). The value as typed is a starting point, not a decision.

## 7. Conditional behavior

| Trigger | Result |
|---|---|
| A population is held by zero organizations | The row says so. It is a candidate for deactivation and the operator should be able to see that at a glance |
| Two Other values differ only by case or spacing | Group them case-insensitively on trimmed whitespace and promote together, automatically (D20) |
| A population is inactive | It renders in the list, marked, and does not appear in selection at MP-03 |

## 8. Copy

| Context | Text |
|---|---|
| Page heading | Populations |
| Population list empty state | No populations yet. |
| Other values empty state | No organizations have entered a custom population. |
| Zero-organization marker | Not used by any organization |
| Rename note | Renaming changes this label everywhere it appears, including on live request pages. |
| Deactivate confirmation | Deactivate {name}? {count} organizations already using it keep it. New organizations will not see it as an option. |
| Deactivate blocked, Other | Other cannot be deactivated. Organizations need a way to describe populations that are not listed. |
| Promote confirmation | Add "{value}" as a population and assign it to {count} organizations? {list}. |
| Promote result | {name} added and assigned to {count} organizations. |
| Failure | That did not save. Nothing was changed. |

## 9. Empty states

The Other region empty is the healthy state and reads as such.

## 10. Mobile differences

Desktop-first.

## 11. Authorization

Staff admin only. A staff approver reaching this route gets the same response as a nonexistent route.

## 12. Error paths

| Failure | Rendered result |
|---|---|
| Name or slug collides | Blocked with a stated reason before the database rejects it |
| Promotion transaction fails partway | Nothing written. The value stays in the Other region |
| Promoting a value whose name collides with an existing population | Blocked, with a suggestion to rename. No reassignment action on collision (D21) |
| An organization is deleted or disabled mid-promotion | Promotion proceeds for the rest. Disabled organizations keep their population assignments |

## 13. Out of scope

- Deleting a population. Deactivation is the mechanism. A population with historical assignments is not removable without changing what organizations said about themselves.
- Editing which populations a specific organization holds. That is the organization's own field, and there is no staff surface for it this week.
- Population-based filtering on public browse. Not this week.

## 14. Acceptance

- The seeded list matches the distinct values present in the migrated data, with no invented entries.
- Counts per population are accurate.
- Adding, renaming, reordering, and deactivating all work and take effect at MP-03.
- Deactivating leaves existing assignments intact.
- Other cannot be deactivated.
- Every distinct free-text value appears in the Other region with its count and organizations.
- Case and whitespace variants group together.
- Promoting creates the population, assigns every listed organization, and clears their free-text values, in one transaction.
- A staff approver cannot reach this route.

## 15. Open captures

None.
