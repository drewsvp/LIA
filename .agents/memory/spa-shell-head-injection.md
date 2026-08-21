---
name: SPA shell head injection
description: Why anything injected into the SPA shell's <head> must go through both serving paths, and why preview tags are replaced rather than appended.
---

The SPA shell is served two different ways — the dev server transforms
`client/index.html` per request, the production server answers from the build
output. Any server-side change to `<head>` (share previews, per-page titles,
analytics tags) must be applied on both paths.

**Why:** a change made on only one path works perfectly in the workspace and is
invisible on the deployed site, and the failure mode — a crawler card, not a
page — never shows up in normal browsing or in review.

**How to apply:** put the transform in one module and call it from both shell
handlers; verify with a raw `curl` against a `NODE_ENV=production` run, not just
dev. Browser devtools shows the post-mount DOM and will happily display tags
React set client-side, hiding the very bug being checked.

Related rules for meta tags specifically:

- Replace the shell's default tags, never append. Duplicate `og:*` keys make
  crawler behaviour non-deterministic.
- `og:image:width` / `height` / `type` describe one specific file. Emit them
  only alongside the fixed fallback image; a per-record image of unknown size
  with stale hints gets mis-cropped by Facebook.
- The share image fallback must be a stable file in the client public
  directory. Assets imported through Vite get content-hashed filenames that
  change every build, so a server-side reference to one rots silently.
