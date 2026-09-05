#!/usr/bin/env sh
# Platform boundary guard - Phase 0 of the Steward platform plan.
#
# Two invariants this repo must never break:
#
#   1. Platform billing belongs to the console. STRIPE_PLATFORM_* credentials
#      exist only in the console's environment. A product app knows about
#      entitlements; it never knows about invoices.
#   2. The platform root domain is configuration, not a source constant.
#      Everything derives from PLATFORM_ROOT_DOMAIN.
#
# Documentation (*.md) and *.example files are exempt: they exist to name real
# values. Source code is not.

set -eu

STATUS=0

SOURCE_GLOBS="--include=*.ts --include=*.tsx --include=*.js --include=*.jsx
--include=*.mjs --include=*.cjs --include=*.json --include=*.yml --include=*.yaml
--include=*.sql --include=*.sh --include=*.css"

EXCLUDES="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next
--exclude-dir=dist --exclude-dir=build --exclude-dir=coverage
--exclude-dir=playwright-report --exclude-dir=test-results
--exclude=pnpm-lock.yaml --exclude=package-lock.json
--exclude=check-platform-boundaries.sh"

scan() {
  label="$1"
  pattern="$2"
  # shellcheck disable=SC2086
  hits=$(grep -rInE "$pattern" . $SOURCE_GLOBS $EXCLUDES || true)
  if [ -n "$hits" ]; then
    echo "FAIL: $label"
    echo "$hits" | sed 's/^/  /'
    echo ""
    STATUS=1
  else
    echo "ok: $label"
  fi
}

scan "no platform Stripe credentials in a product app" \
  "STRIPE_PLATFORM_"

# The trailing class is load-bearing. Without it the pattern also matches a
# tenant host like "grace-stewardtable.app.example.org", where the domain is
# example.org and "stewardtable.app" is merely a label followed by more
# labels. Matching to end-of-token means only a real hardcoded domain trips it.
scan "no hardcoded platform domain (use PLATFORM_ROOT_DOMAIN)" \
  "steward(grace|table|pos)?\.(app|com)([^a-z0-9.-]|$)"

if [ "$STATUS" -ne 0 ]; then
  echo "Platform boundary guard failed. See docs/HOSTING.md."
fi

exit "$STATUS"
