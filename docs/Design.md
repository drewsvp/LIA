# Design.md

Source: computed-style audit of the live defendingthecause.org LIA pages, Aug 13 2026. Values below are confirmed — either matched by frequency against a known count, or captured directly from real rendered text. Not top-of-list guesses.

This is a reference file. Do not inline its contents into `replit.md` — point to it.

---

## Colors

| Token | Value |
|---|---|
| navy | `rgb(6, 54, 93)` |
| teal | `rgb(2, 146, 143)` |
| white | `rgb(255, 255, 255)` |
| placeholder-gray | `rgba(16, 16, 16, 0.3)` |

Use navy everywhere — headings, nav, body text. The original site carried two near-identical navies (`rgb(6, 54, 93)` general, `rgb(0, 48, 91)` on detail-page headings only). Confirmed as inconsistency, not intent — this was not built by a design team. Merged to one.

Do not reproduce: `rgb(0, 0, 238)` — browser-default unstyled link blue, present across every page. Style all links intentionally instead.

---

## Fonts

| Role | Font |
|---|---|
| Heading | Open Sans Extra Bold, all caps |
| Body | Open Sans (`open-sans-v2`) |
| Form placeholder | Helvetica (`helvetica-w01-light`) |

Weights: 400 and 700 only. Confirmed binary across the entire site — no 500/600 exists anywhere. Don't introduce a semibold.

Dropped: `futura-lt-w01-book`, seen exactly twice, only on one "Read more" link. Same pattern as the navy split — an inconsistency from ad hoc editing, not a deliberate second display font. Use Open Sans there instead.

---

## Type scale (px)

| Use | Size | Notes |
|---|---|---|
| Hero H1 | 60 | Home page only, not used elsewhere |
| Section header | 30 | |
| Detail page title | 26 | line-height 36.4px (1.4×) |
| Hub page header | 24 | |
| Sponsor thank-you line | 20 | |
| Card title | 16 | Confirmed on all 57 request cards, identical: white text, line-height 20.8px (1.3×) |
| Nav / body text | 15 | |
| Fine print | 13 | |

---

## Card

| Property | Value |
|---|---|
| box-shadow | `rgba(0, 0, 0, 0.5) 0px 0px 3px 0px` |
| border-radius | 5px |

Shadow confirmed exact — matched 45 times on the item browse page and 12 times on the volunteer browse page, precisely equal to the card counts on each. Not a guess.

---

## Radius

- **Default** (most elements): 0px
- **Cards and buttons:** 5px
- One-off values seen exactly once (8px, 15px, 3px, 100px) — decorative single elements, not system values. Check `page_dom/` before replicating any of these.

---

## Known bugs — do not reproduce

1. **Login modal submit button:** white text on white background, effectively invisible. Give it a real background (navy or teal).
2. **Unstyled default-blue links** (`rgb(0, 0, 238)`) scattered throughout. Style every link intentionally.

---

## What this file does NOT cover

Desktop and mobile computed styles came back identical — color, font, and spacing tokens don't change at these breakpoints on the live site. Layout behavior (column stacking, nav collapse on mobile) is not a token, it's structural, and lives only in `docs/screenshots/` and `page_dom/`. Don't infer responsive behavior from this file.
