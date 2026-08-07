#!/usr/bin/env bash
#
# Rewrites the deployed URL everywhere it appears.
#
# The hostname is in READMEs, the MCP registry manifest, and the client package
# docs. Missing one leaves a dead link in a published package, which is the kind
# of thing nobody notices until someone follows it.
#
#   bash scripts/rename-public-url.sh https://arbiter-hs23.onrender.com https://arbiter-x402.onrender.com
#   DRY_RUN=1 bash scripts/rename-public-url.sh <old> <new>    # preview only
#
set -euo pipefail

OLD="${1:-}"
NEW="${2:-}"

if [[ -z "$OLD" || -z "$NEW" ]]; then
  echo "usage: bash scripts/rename-public-url.sh <old-url> <new-url>" >&2
  exit 2
fi

# Trailing slashes would produce doubled slashes on substitution.
OLD="${OLD%/}"
NEW="${NEW%/}"

# Bare hostnames too: server.json and some prose reference the host without a
# scheme, and those matter as much as the linked ones.
OLD_HOST="${OLD#https://}"; OLD_HOST="${OLD_HOST#http://}"
NEW_HOST="${NEW#https://}"; NEW_HOST="${NEW_HOST#http://}"

cd "$(dirname "$0")/.."

mapfile -t FILES < <(
  git grep -l -F -e "$OLD" -e "$OLD_HOST" -- \
    '*.md' '*.json' '*.ts' '*.tsx' '*.yaml' '*.yml' '*.sh' '*.html' 2>/dev/null || true
)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No references to $OLD_HOST found. Nothing to do."
  exit 0
fi

echo
echo "Rewriting $OLD_HOST -> $NEW_HOST in ${#FILES[@]} file(s):"
for f in "${FILES[@]}"; do
  n=$(grep -c -F -e "$OLD_HOST" "$f" || true)
  printf '  %-46s %s occurrence(s)\n' "$f" "$n"
done

# "1" is truthy here and so is "false" — only an unset/empty variable means go.
if [[ -n "${DRY_RUN:-}" ]]; then
  echo
  echo "DRY_RUN set — nothing written."
  exit 0
fi

for f in "${FILES[@]}"; do
  # Host-only substitution covers both, since the scheme is left untouched.
  perl -pi -e "s/\Q$OLD_HOST\E/$NEW_HOST/g" "$f"
done

echo
echo "Done. Remaining references to the old host (should be none outside history):"
git grep -n -F "$OLD_HOST" -- '*.md' '*.json' '*.ts' '*.tsx' '*.yaml' '*.yml' '*.sh' '*.html' || echo "  none"
echo
echo "Next:"
echo "  1. Review with: git diff"
echo "  2. Republish the MCP registry entry if clients/mcp/server.json changed."
echo "  3. Re-register the routes so the catalog picks up current examples:"
echo "       ARBITER_URL=$NEW npx tsx scripts/register-routes.ts"
