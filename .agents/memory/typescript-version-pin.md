---
name: TypeScript "latest" is 7.x native preview
description: Pin typescript ~5.9 and avoid baseUrl in tsconfig
---

- `npm i -D typescript` (latest) now resolves to the 7.0 native-preview compiler, which rejects `baseUrl` and other 5.x tsconfig shapes. Pin `typescript@~5.9` explicitly.
- **Why:** `npm run check` broke with config errors that looked like tsconfig typos but were a major-version jump.
- **How to apply:** pin the dependency, and prefer baseUrl-free `paths` entries with `./` prefixes — that shape works on both 5.x and 7.x.

## tsx scripts are CJS — no top-level await

One-off `tsx` scripts in this repo compile as CJS: top-level `await` fails to parse. Wrap in `async function main()` + `main().catch(...)`.
