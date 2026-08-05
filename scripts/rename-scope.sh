#!/usr/bin/env bash
# Renames the client packages to a different npm scope.
#
#   bash scripts/rename-scope.sh @yourname
#
# Every npm account owns the scope matching its username, so this is the escape
# hatch if the @arbiter organisation cannot be created. It rewrites the package
# names, the cross-references between them, and every install line in the docs.
set -euo pipefail

NEW_SCOPE="${1:-}"
if [ -z "$NEW_SCOPE" ] || [ "$NEW_SCOPE" = "${NEW_SCOPE#@}" ]; then
  echo "usage: bash scripts/rename-scope.sh @yourname" >&2
  exit 1
fi

OLD_SCOPE=$(node -p "require('./clients/sdk/package.json').name.split('/')[0]")
if [ "$OLD_SCOPE" = "$NEW_SCOPE" ]; then
  echo "Already using $NEW_SCOPE."
  exit 0
fi

echo "Renaming $OLD_SCOPE -> $NEW_SCOPE"

# Source, package manifests and docs all name the packages, and a rename that
# updates only package.json produces installs that resolve to nothing.
FILES=$(git ls-files | grep -E '\.(json|ts|tsx|md|sh|yaml|yml)$' || true)

for f in $FILES; do
  if grep -q "$OLD_SCOPE/" "$f" 2>/dev/null; then
    # macOS and GNU sed disagree about -i, so write through a temp file.
    sed "s|$OLD_SCOPE/|$NEW_SCOPE/|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    echo "  $f"
  fi
done

echo
echo "Done. Reinstall so the workspace links pick up the new names:"
echo "    npm install"
echo "    npm run build:clients"
