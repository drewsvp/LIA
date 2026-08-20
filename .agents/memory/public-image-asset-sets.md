---
name: Public image asset sets
description: Why near-identical photo graphics live in separate files, and the two size conventions they follow.
---

# Image asset sets

The same source photograph is deliberately used for several *different* graphics, each
with its own baked-in wording and crop. Do not deduplicate them into one file.

The teddy-bear photo backs three separate assets:
- a dashboard tile reading "Item Request"
- a public page header reading "Provide an Item"
- a member request-page hero reading "Item Request" at a wider crop

The stacked-hands photo splits the same way ("Volunteer Request" tile, "Volunteer your
Time" header, "Volunteer Request" hero).

**Why:** the wording and crop differ per surface even though the photo does not. Treating
them as duplicates puts the wrong words on a page, or stretches a tile-sized export across
a full-width hero.

**How to apply:** when swapping in new artwork, match by *the words baked into the image*
plus the surface it renders on — never by the photo alone or by filename similarity. Ask
before reusing one export across surfaces at different widths.

## Size conventions

- Dashboard tiles: 800x450 (16:9), rendered in a 3-column grid at `width:100%; height:auto`.
- Full-width page headers/heroes: 1500x450, also `width:100%; height:auto`.

Nothing crops except the home page tiles, which use `aspect-ratio: 8/3` with
`background-size: cover` — a 1500x450 header loses about 10% off each side there, which
clears the centered text. Anything with wording nearer the edges needs a visual check.
