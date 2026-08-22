#!/usr/bin/env bash
# lint-adm-btn.sh — Catch adm-btn-outline used without the adm-btn base class.
#
# adm-btn-outline relies on adm-btn for button identity (element reset, display,
# base sizing).  A className that contains adm-btn-outline but not adm-btn as a
# standalone class token renders as a plain browser-default rectangle.
#
# "Standalone" means adm-btn is surrounded by class-token delimiters:
#   - preceded by: start-of-string, whitespace, a quote char (" ' `), or =
#   - followed by: end-of-string, whitespace, or a quote char (" ' `)
# This avoids false negatives from prefixed lookalikes like "not-adm-btn".
#
# Limitation: multi-line className expressions (e.g. template-literal objects
# spread across lines) are not detected.  All existing usages are single-line.
#
# Scans all TSX / TS / JSX / JS files under client/src/.
# Exits 1 if any violations are found; 0 if all usages are correct.
set -euo pipefail

# ---------------------------------------------------------------------------
# Self-tests — run before scanning so the pattern is verified on every CI run.
# ---------------------------------------------------------------------------
PASS=0
FAIL=0

# is_standalone_present <string>
# Returns 0 (true) if the string contains "adm-btn" as a standalone token.
is_standalone_present() {
  printf '%s' "$1" | grep -qP '(^|[\s"'"'"'`=])adm-btn([\s"'"'"'`]|$)'
}

# check_case <label> <className-string> <expect: violation|ok>
check_case() {
  local label="$1" input="$2" expect="$3"
  local got
  # A string is a violation when it contains adm-btn-outline AND lacks a
  # standalone adm-btn token.
  if printf '%s' "$input" | grep -q "adm-btn-outline"; then
    if is_standalone_present "$input"; then
      got="ok"
    else
      got="violation"
    fi
  else
    got="ok"   # no adm-btn-outline → not applicable, treat as ok
  fi

  if [ "$got" = "$expect" ]; then
    echo "  PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label — expected '$expect', got '$got'"
    echo "        input: $input"
    FAIL=$((FAIL + 1))
  fi
}

echo "lint-adm-btn self-tests:"
# --- violations (missing base class) ---
check_case "bare outline"             '"adm-btn-outline"'                             violation
check_case "outline + sm, no base"   '"adm-btn-outline adm-btn-sm"'                  violation
check_case "prefixed lookalike"       '"not-adm-btn adm-btn-outline"'                 violation
check_case "suffixed lookalike"       '"adm-btn-outlineX adm-btn-outline"'            violation

# --- valid usages (base class present) ---
check_case "base then outline"        '"adm-btn adm-btn-outline"'                     ok
check_case "outline then base"        '"adm-btn-outline adm-btn"'                     ok
check_case "base + outline + sm"      '"adm-btn adm-btn-outline adm-btn-sm"'          ok
check_case "outline + sm + base"      '"adm-btn-outline adm-btn-sm adm-btn"'          ok
check_case "eq-delimited"             '="adm-btn adm-btn-outline"'                    ok

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "lint-adm-btn: $FAIL self-test(s) FAILED — fix the lint pattern before trusting scan results."
  exit 1
fi
echo "  All $PASS self-tests passed."
echo ""

# ---------------------------------------------------------------------------
# Main scan
# ---------------------------------------------------------------------------

# Step 1: collect every line that mentions adm-btn-outline.
# Step 2: discard lines that also contain adm-btn as a standalone token.
# What remains are lines with adm-btn-outline but no base class — violations.
VIOLATIONS=$(
  grep -rn "adm-btn-outline" client/src/ \
    --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js" \
  | grep -vP '(^|[\s"'"'"'`=])adm-btn([\s"'"'"'`]|$)' \
  || true
)

if [ -n "$VIOLATIONS" ]; then
  echo "lint-adm-btn: ERROR — adm-btn-outline used without adm-btn base class."
  echo "Every className containing adm-btn-outline must also include adm-btn."
  echo ""
  echo "$VIOLATIONS"
  echo ""
  exit 1
fi

echo "lint-adm-btn: OK — all adm-btn-outline usages correctly pair with adm-btn."
