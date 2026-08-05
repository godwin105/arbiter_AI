#!/usr/bin/env bash
# Publishes the client packages to npm.
#
#   bash scripts/publish-packages.sh --dry-run   # check everything, publish nothing
#   bash scripts/publish-packages.sh             # publish
#
# Publishing is close to irreversible: npm only allows unpublishing within 72
# hours, and a version number can never be reused even after it is removed. The
# dry run exists so every avoidable problem is found before that matters.
set -euo pipefail

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# Dependency order: each package depends on the ones before it, and npm resolves
# those from the registry at install time rather than from this repo.
PACKAGES=(sdk mcp langchain eliza proxy keeperhub)

echo
echo "Arbiter — npm publish${DRY_RUN:+ (dry run)}"
echo "=============================================================================="
echo

# --- Who are we publishing as? ----------------------------------------------
if ! WHOAMI=$(npm whoami 2>/dev/null); then
  cat <<'MSG'
  Not logged in to npm.

      npm login

  Then re-run. Publishing needs your account — nothing here can do it for you.
MSG
  exit 1
fi
echo "  publishing as: $WHOAMI"

# --- Can we publish under this scope? ---------------------------------------
SCOPE=$(node -p "require('./clients/sdk/package.json').name.split('/')[0]")
echo "  scope:         $SCOPE"

if [ "$SCOPE" != "${SCOPE#@}" ]; then
  ORG="${SCOPE#@}"
  if [ "$ORG" != "$WHOAMI" ] && ! npm org ls "$ORG" >/dev/null 2>&1; then
    cat <<MSG

  You are not a member of the '$ORG' organisation on npm, so publishing
  under $SCOPE will fail with 402 or 404.

  Either create it (free, for public packages):
      https://www.npmjs.com/org/create        name it: $ORG

  Or switch to your own scope, which always works:
      bash scripts/rename-scope.sh @$WHOAMI

MSG
    exit 1
  fi
fi
echo

# --- Publish ------------------------------------------------------------------
for name in "${PACKAGES[@]}"; do
  DIR="clients/$name"
  PKG=$(node -p "require('./$DIR/package.json').name")
  VER=$(node -p "require('./$DIR/package.json').version")

  printf "  %-24s v%s  " "$PKG" "$VER"

  # Republishing an existing version always fails; say so plainly rather than
  # letting npm's error be the first sign.
  if npm view "$PKG@$VER" version >/dev/null 2>&1; then
    echo "already published — bump the version to publish again"
    continue
  fi

  if $DRY_RUN; then
    FILES=$(cd "$DIR" && npm publish --dry-run 2>&1 | grep -c "^npm notice [0-9]" || true)
    (cd "$DIR" && npm publish --dry-run >/dev/null 2>&1) && echo "ok — would publish" \
      || { echo "FAILED dry run"; (cd "$DIR" && npm publish --dry-run 2>&1 | tail -8); exit 1; }
  else
    (cd "$DIR" && npm publish) >/dev/null && echo "published" \
      || { echo "FAILED"; exit 1; }
  fi
done

echo
echo "=============================================================================="
if $DRY_RUN; then
  echo
  echo "  Dry run clean. Publish for real with:"
  echo "      bash scripts/publish-packages.sh"
  echo
else
  echo
  echo "  Published. Verify:"
  echo "      npm view @arbiter/sdk"
  echo
  echo "  Then submit the MCP server to a directory — one listing reaches more"
  echo "  agents than every other channel combined:"
  echo "      https://github.com/modelcontextprotocol/servers"
  echo
fi
