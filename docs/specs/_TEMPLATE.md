# _TEMPLATE.md

*Copy this file to `docs/specs/{ID}.md` and fill it. Keep the section order. A section that does not apply says `None`, never gets deleted. Deleting a section makes it ambiguous whether it was considered and found empty or simply forgotten.*

*Rules for filling this out, which are the same rules that make the specs usable by an agent building one surface at a time:*

- *Present tense, declarative. Describe what the surface does, not what it used to do or why it changed. Rationale lives in `Handbook.md`.*
- *Verbatim copy is verbatim. Paste it. Do not tidy punctuation, capitalization, or spacing, and do not make wording consistent across surfaces.*
- *`[CAPTURE]` marks a value that is not yet known. Never invent a value to fill a gap. A spec with open captures is still buildable; a spec with invented copy is not correctable, because nobody can tell which values were real.*
- *If a behavior appears on more than three surfaces, it belongs in `Handbook.md` section 11 and this file references it rather than restating it.*

---

# {ID} — {Surface name}

| | |
|---|---|
| **Route** | |
| **Access** | Public / Authenticated member / Org owner / Staff approver / Staff admin |
| **Bound** | Yes, matches screenshots / No, build for clarity |
| **Screenshots** | `docs/screenshots/{ID}-desktop.png`, `docs/screenshots/{ID}-mobile.png` |
| **Depends on** | Surfaces or contracts that must exist first |
| **Spec status** | Complete / Open captures listed in section 15 |

---

## 1. Purpose

Two or three sentences. What this surface is for and who uses it.

## 2. Entry and exit

**Arrives from:** every path that reaches this surface.
**Leaves to:** every destination, and the action that sends the user there.

## 3. Data

**Reads:** tables and columns.
**Writes:** tables and columns, and by what mechanism.
**Functions called:** named database functions, or `None`.
**Never touches:** columns this surface must not write, where an invariant applies.

## 4. Layout regions

Named regions in visual order, top to bottom. One line each describing what the region contains. This is the skeleton the fields and copy hang off, and it is what makes the screenshot legible without opening it.

## 5. Fields

| # | Label (verbatim) | Control | Required | Binds to | Validation |
|---|---|---|---|---|---|

Order is visual order. Label is exactly the text on screen, including capitalization and any punctuation. Required means the surface blocks submission, not that the column is `not null`.

## 6. Actions

For each button or interactive control that causes a change:

**{Button label, verbatim}**
- Enabled when:
- Does:
- Transaction boundary:
- Emails queued:
- On success:
- On failure:

## 7. Conditional behavior

Each rule as trigger and result. Include anything that shows, hides, enables, or disables.

## 8. Copy

Every string on the surface that is not a field label or a button label. Verbatim.

| Context | Text |
|---|---|

Includes headings, instructional text, helper lines, success messages, error messages, and confirmations.

## 9. Empty states

What the surface renders when its lists have no rows, with verbatim text.

## 10. Mobile differences

Structural differences from desktop: stacking, collapsed navigation, hidden or reordered elements, controls that change type. Token values do not change between breakpoints; do not restate them.

## 11. Authorization

What is checked, server-side, before the query runs. Name the specific check. What happens when it fails.

## 12. Error paths

Failure modes a real user hits, and what the surface renders for each. Include concurrency failures, unresolvable references, and failed writes. A surface with no error path section is a surface that reports success for operations that did not happen.

## 13. Out of scope for this surface

Things a builder might reasonably add here and must not.

## 14. Acceptance

Binary checks. Someone other than the builder walks these against the screenshots and the live comparison.

## 15. Open captures

Every `[CAPTURE]` in this file, listed with what is needed and who can supply it. Empty list means the spec is complete.
