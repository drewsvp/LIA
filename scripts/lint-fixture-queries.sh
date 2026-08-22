#!/usr/bin/env bash
# lint-fixture-queries.sh
#
# Fails if any non-comment line under scripts/ (recursively) contains the
# unsafe text-to-boolean cast on a JSONB ->> extraction for the zz_fixture
# marker, including whitespace-formatted variants.
#
# UNSAFE — throws 22P02 when any peer row carries a non-boolean string:
#   payload->>'zz_fixture')::boolean IS TRUE
#   payload ->> 'zz_fixture') :: boolean IS TRUE   (same error, different spacing)
#
# SAFE — type-safe JSONB equality, always works:
#   payload->'zz_fixture' = 'true'::jsonb
#
# Reference implementation: scripts/test-email-preview-panel.ts (pre-clean block)
#
# Run via:  npm run lint:fixture-queries
#           (also invoked automatically by npm run check)

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Extended-regex pattern covering optional whitespace between the operators:
#   ->>  [ws]  'zz_fixture'  [ws]  )  [ws]  ::  [ws]  boolean
PATTERN="->>[[:space:]]*'zz_fixture'[[:space:]]*)[[:space:]]*::[[:space:]]*boolean"

# ---------------------------------------------------------------------------
# Self-test: verify the regex actually detects both the compact and spaced
# forms before we trust any result.  A false-negative here would make every
# run silently pass.
# ---------------------------------------------------------------------------
_TMPDIR=$(mktemp -d /tmp/lint-fixture-selftest-XXXXXX)
trap 'rm -rf "$_TMPDIR"' EXIT

# 1. Compact form (exact cast, no spaces)
printf "const q = \`delete from email_log where (payload->>'zz_fixture')::boolean IS TRUE\`;\n" \
  > "$_TMPDIR/compact.ts"

# 2. Spaced form (whitespace around operators — same 22P02 risk)
printf "const q = \`delete from email_log where (payload ->> 'zz_fixture') :: boolean IS TRUE\`;\n" \
  > "$_TMPDIR/spaced.ts"

# 3. Nested subdirectory — the real scan must be recursive
mkdir -p "$_TMPDIR/subdir"
printf "const q = \`delete from email_log where (payload->>'zz_fixture')::boolean IS TRUE\`;\n" \
  > "$_TMPDIR/subdir/nested.ts"

SELF_TEST_FAILURES=0

for _FILE in "$_TMPDIR/compact.ts" "$_TMPDIR/spaced.ts" "$_TMPDIR/subdir/nested.ts"; do
  if ! grep -qE -- "$PATTERN" "$_FILE" 2>/dev/null; then
    echo "ERROR: self-test FAILED — grep did not detect the unsafe pattern in $_FILE"
    SELF_TEST_FAILURES=$(( SELF_TEST_FAILURES + 1 ))
  fi
done

if [[ "$SELF_TEST_FAILURES" -gt 0 ]]; then
  echo "ERROR: $SELF_TEST_FAILURES self-test case(s) failed — the lint check cannot"
  echo "  be trusted. Fix the grep pattern before re-running."
  exit 2
fi

echo "lint-fixture-queries self-test: PASS (compact, spaced, and nested forms detected)"

# ---------------------------------------------------------------------------
# Real check: scan every .ts file under scripts/ recursively, skipping pure
# comment lines so that documentation examples do not trigger false positives.
# grep output format: "file:linenum:content" — we exclude lines whose content
# (after the last number: prefix) starts with optional whitespace then // or *.
# ---------------------------------------------------------------------------
MATCHES=$(
  find "$SCRIPTS_DIR" -name "*.ts" -print0 \
    | xargs -0 grep -nE -- "$PATTERN" 2>/dev/null \
    | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*(//|/\*|\*)' \
    || true
)

if [[ -n "$MATCHES" ]]; then
  echo ""
  echo "$MATCHES"
  echo ""
  echo "ERROR: unsafe zz_fixture boolean cast detected in the lines above."
  echo "Replace with the safe JSONB equality check:"
  echo "  payload->'zz_fixture' = 'true'::jsonb"
  echo ""
  echo "See scripts/test-email-preview-panel.ts for the reference implementation."
  exit 1
fi

echo "lint-fixture-queries: OK (no unsafe zz_fixture boolean casts found)"
