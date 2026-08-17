---
name: Git push from a shallow/broken clone
description: What to do when pushes fail because a shallow boundary references a missing parent object
---

# Git push from a shallow or history-broken clone

**Rule:** If a workspace is a shallow clone whose boundary commit references a parent object that no longer exists anywhere (e.g. the original remote was deleted), do not fight the history — prefer a clean break: `rm -rf .git`, `git init`, single fresh commit, force-push. History rewriting (filter-branch) produces new SHAs that diverge from Replit's task-merge system, which keeps recreating commits on the old history and re-breaking parity after every task merge.

**Why:** The task-merge system maintains its own base refs and overwrites `refs/heads/main` at merge time; local resets, ledger-ref updates, and rewrites are all undone by the next merge. Only a history the merge system itself builds on stays stable.

**How to apply:** When `git push` fails with `did not receive expected object <sha>` and that object is unrecoverable, confirm with the user that history can be discarded, then reinit + force-push. Also: agent sessions cannot obtain GitHub OAuth tokens from the local credential service — for pushes, add a temporary SSH deploy key via the GitHub connector API and remove it afterward.
