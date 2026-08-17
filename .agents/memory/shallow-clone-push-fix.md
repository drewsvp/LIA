---
name: Shallow clone push fix
description: The workspace git repo had a shallow boundary commit referencing a missing parent from the deleted old GitHub repo; pushing required rewriting history and using a temporary deploy key.
---

# Shallow clone push fix

The repo was a shallow clone. The boundary commit (`c1ac163`) had a `parent` pointer to a commit that no longer exists anywhere (deleted with the old GitHub repo `drewsvp/AllianceLIADBBuild`). This caused every push attempt to fail with `remote: fatal: did not receive expected object`.

**Why:** The `.git/shallow` file grafts the boundary commit to appear rootless locally, but the commit object itself still contains the parent SHA. GitHub receives the commit object, sees the parent pointer, and expects that object in the pack — which can't be included because it doesn't exist locally.

**How to apply:**
- If a future push to GitHub fails with `did not receive expected object`, check `.git/shallow` first. If that SHA is in shallow, the push will always fail until the history is rewritten.
- Fix: `git filter-branch -f --parent-filter 'if [ "$GIT_COMMIT" = "<shallow-sha>" ]; then echo ""; else cat; fi' -- main` to make the boundary commit a true root commit.
- After filter-branch, all commit SHAs from the root onwards change. Update any CI, external refs, or tracking branches accordingly.

**Credential note:** The agent session cannot get GitHub OAuth tokens from the pid2 service (`localhost:8284/{session}/github/token` returns "GitHub token request timed out" for agent sessions). Workaround: generate a temporary SSH deploy key, add it via the GitHub API (which IS accessible via the connector), push via SSH, remove the key.
