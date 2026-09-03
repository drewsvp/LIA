#!/usr/bin/env bash
# lint-adm-btn.sh — Catch shared button variants used without their base class.
#
# IMPORTANT: This script must always run to completion.
# It contains two independent checks: a TSX/TS source scan (Step 1) and a CSS
# combined-selector check (Step 2).  Do NOT short-circuit after the source scan
# only (e.g. via an early exit or a partial --include flag) — the CSS check
# will be silently skipped and index.css regressions will go undetected.
# Register this script as its own required validation step rather than calling
# it at the tail of a &&-chained command.
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
echo ""

# Shared ui-btn variants are modifiers, not standalone button definitions.
# A missing ui-btn base would silently drop the canonical geometry and focus
# treatment while leaving only the semantic colour rule.
UI_VARIANT_VIOLATIONS=$(
  grep -rnE 'ui-btn-(primary|teal|secondary|selected|danger|compact)' client/src/ \
    --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js" \
  | grep -vP '(^|[\s"'"'"'`=])ui-btn([\s"'"'"'`]|$)' \
  || true
)

if [ -n "$UI_VARIANT_VIOLATIONS" ]; then
  echo "lint-adm-btn: ERROR — ui-btn variant used without ui-btn base class."
  echo "Every ui-btn-* variant in application source must also include ui-btn."
  echo ""
  echo "$UI_VARIANT_VIOLATIONS"
  echo ""
  exit 1
fi

echo "lint-adm-btn: OK — all ui-btn variants correctly pair with ui-btn."
echo ""

# Every native button must either use a named class contract or explicitly
# document why it is a purpose-built control (for example, an inline text
# disclosure). This prevents new browser-default action buttons from shipping.
BARE_BUTTONS=$(
  python - <<'PY'
from pathlib import Path
import re

for path in Path("client/src").rglob("*.tsx"):
    source = path.read_text()
    for match in re.finditer(r"<button\b([\s\S]*?)>", source):
        attrs = match.group(1)
        if "className=" not in attrs and "data-button-pattern=" not in attrs:
            line = source.count("\n", 0, match.start()) + 1
            print(f"{path}:{line}")
PY
)

if [ -n "$BARE_BUTTONS" ]; then
  echo "lint-adm-btn: ERROR — native buttons need className or a documented data-button-pattern exception."
  echo "$BARE_BUTTONS"
  echo ""
  exit 1
fi

echo "lint-adm-btn: OK — no undocumented browser-default buttons found."
echo ""

# ---------------------------------------------------------------------------
# CSS structure check — verify .adm-btn and .adm-btn-outline share a selector.
#
# If the two classes are split back into separate rules, .adm-btn-outline will
# silently lose the shared border/font/padding/cursor/border-radius styles.
# ---------------------------------------------------------------------------
CSS_FILE="client/src/index.css"
echo "lint-adm-btn CSS check ($CSS_FILE):"

if [ ! -f "$CSS_FILE" ]; then
  echo "  ERROR: $CSS_FILE not found."
  exit 1
fi

# Collapse the file (newlines → spaces) so a multi-line selector like
#   .adm-btn,
#   .adm-btn-outline {
# becomes a single searchable string.
COLLAPSED=$(tr '\n' ' ' < "$CSS_FILE")

# Match a combined selector in either order.
# (?!-) prevents .adm-btn from matching .adm-btn-outline / .adm-btn-sm etc.
# [^{]* stops at the opening brace so we don't stray into the next rule.
CSS_OK=0
if printf '%s' "$COLLAPSED" | grep -qP '\.adm-btn(?!-)[^{]*,\s*\.adm-btn-outline[^{]*\{'; then
  CSS_OK=1
elif printf '%s' "$COLLAPSED" | grep -qP '\.adm-btn-outline[^{]*,\s*\.adm-btn(?!-)[^{]*\{'; then
  CSS_OK=1
fi

if [ "$CSS_OK" -eq 1 ]; then
  echo "  PASS: .adm-btn and .adm-btn-outline share a combined selector."
else
  echo "  FAIL: .adm-btn and .adm-btn-outline are no longer in a combined selector."
  echo "  They must share a rule (e.g. '.adm-btn, .adm-btn-outline { ... }') so"
  echo "  .adm-btn-outline inherits the shared border / font / padding / cursor styles."
  echo "  Restore the combined selector in $CSS_FILE."
  exit 1
fi

for REQUIRED_SELECTOR in ".ui-btn" ".ui-btn-secondary" ".ui-btn-selected" ".ui-btn-danger"; do
  if ! grep -qF "$REQUIRED_SELECTOR" "$CSS_FILE"; then
    echo "  FAIL: shared button contract is missing $REQUIRED_SELECTOR."
    exit 1
  fi
done
echo "  PASS: shared base, secondary, selected, and destructive selectors are present."

if ! python - "$CSS_FILE" <<'PY'
from pathlib import Path
import re
import sys

css = Path(sys.argv[1]).read_text()
required = {
    ".adm-actions",
    ".adm-btn-row",
    ".adm-child-actions",
    ".adm-image-actions",
    ".adm-report-actions",
    ".mp5-confirm-actions",
    ".mp8-buttons",
}
matching = []
for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
    selector_text = re.sub(r"/\*.*?\*/", "", match.group(1), flags=re.S)
    selectors = {part.strip() for part in selector_text.split(",")}
    if required <= selectors:
        matching.append((match.start(), match.group(2)))

if not matching:
    print("  FAIL: conventional action wrappers no longer share one authoritative layout rule.")
    raise SystemExit(1)

layout_rules = [
    (position, declarations)
    for position, declarations in matching
    if re.search(r"(?:^|;)\s*display\s*:\s*flex\s*(?:;|$)", declarations)
]
if not layout_rules:
    print("  FAIL: shared action wrappers must use display: flex.")
    raise SystemExit(1)

position, declarations = layout_rules[-1]
if re.search(r"(?:^|;)\s*flex-wrap\s*:\s*wrap\s*(?:;|$)", declarations) is None:
    print("  FAIL: shared action wrappers must use flex-wrap: wrap.")
    raise SystemExit(1)
gap_match = re.search(r"(?:^|;)\s*gap\s*:\s*([\d.]+)px\s*(?:;|$)", declarations)
gap = re.fullmatch(r"([\d.]+)px", f"{gap_match.group(1)}px") if gap_match else None
if gap is None or float(gap.group(1)) < 8:
    print("  FAIL: shared action wrappers must keep a visible gap of at least 8px.")
    raise SystemExit(1)

# The contract must occur after the legacy admin declarations; otherwise a
# later page rule can silently replace it in the runtime cascade.
legacy_position = css.rfind(".adm-actions {", 0, position)
if legacy_position < 0:
    print("  FAIL: shared action contract must follow the legacy .adm-actions rule.")
    raise SystemExit(1)

print("  PASS: shared action wrappers keep an authoritative gap and wrapping rule.")
PY
then
  exit 1
fi

echo ""
echo "lint-adm-btn: OK — CSS combined-selector check passed."
