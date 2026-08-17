#!/bin/bash
# Post-merge setup: runs automatically (bash, stdin closed) after a task
# merge, from the project root. Keep idempotent, non-interactive, fail-fast.
set -euo pipefail

npm install --no-audit --no-fund

# Apply any schema migrations a merged task added. The runner is the
# project's own tracked, idempotent migration applier — re-running it after
# a merge with no new migrations is a no-op, and a genuinely broken
# migration fails this hook loudly rather than being skipped. Data loss is
# unacceptable in this project, so nothing here is forced.
npm run db:apply-migrations
