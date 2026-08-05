#!/usr/bin/env bash
# Deploys Arbiter to Fly.io.
#
# Run after `flyctl auth login`. Safe to re-run: every step is idempotent, so a
# failure partway through can be fixed and the script run again.
#
#   bash scripts/deploy-fly.sh
set -euo pipefail

FLY="${FLYCTL:-flyctl}"
APP="$(grep -m1 '^app = ' fly.toml | sed 's/app = "\(.*\)"/\1/')"
REGION="$(grep -m1 '^primary_region = ' fly.toml | sed 's/primary_region = "\(.*\)"/\1/')"
VOLUME="arbiter_data"

if [ ! -f .env ]; then
  echo "error: .env not found. PAY_TO must be set before deploying." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

if [ -z "${PAY_TO:-}" ]; then
  echo "error: PAY_TO is not set in .env." >&2
  exit 1
fi

PUBLIC_URL="https://${APP}.fly.dev"

echo "app:        $APP"
echo "region:     $REGION"
echo "public url: $PUBLIC_URL"
echo "payTo:      $PAY_TO"
echo

# --- 1. App ------------------------------------------------------------------
if "$FLY" apps list 2>/dev/null | grep -qE "^${APP}\s"; then
  echo "[1/4] app exists"
else
  echo "[1/4] creating app"
  "$FLY" apps create "$APP"
fi

# --- 2. Volume ---------------------------------------------------------------
# Holds unresolved reviewer questions that callers have already paid for, and
# the ledger of USDC owed to reviewers. Without it a redeploy destroys both.
if "$FLY" volumes list -a "$APP" 2>/dev/null | grep -q "$VOLUME"; then
  echo "[2/4] volume exists"
else
  echo "[2/4] creating volume"
  "$FLY" volumes create "$VOLUME" --size 1 --region "$REGION" -a "$APP" --yes
fi

# --- 3. Secrets --------------------------------------------------------------
# Set as secrets rather than committed to fly.toml: PAY_TO must stay fixed for
# the whole competition, and an ordinary config edit should not be able to
# change where the money lands.
echo "[3/4] setting secrets"
"$FLY" secrets set -a "$APP" \
  PAY_TO="$PAY_TO" \
  PUBLIC_URL="$PUBLIC_URL" \
  --stage

# --- 4. Deploy ---------------------------------------------------------------
echo "[4/4] deploying"
"$FLY" deploy -a "$APP" --ha=false

echo
echo "deployed. verifying:"
echo "  npm run preflight -- $PUBLIC_URL"
