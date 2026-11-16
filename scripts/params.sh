#!/usr/bin/env bash
# Prints --parameter-overrides for sam deploy from .env.
# Usage:
#   sam deploy --parameter-overrides $(scripts/params.sh)                          Trace2Test only
#   sam deploy --config-env demo --parameter-overrides $(scripts/params.sh demo)   with the demo shop
# Optional .env entries: REPLAY_TARGETS and STAGING_API_KEY (core only),
# DELIVERY_TARGETS and GITHUB_TOKEN_PARAMETER. JSON values go in single quotes;
# they are checked and compacted here, because the overrides are split on spaces.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source .env
compact() { node -e 'const v=JSON.parse(process.argv[1]); const s=JSON.stringify(v); if (/\s/.test(s)) { console.error("JSON values may not contain spaces: " + s); process.exit(1) } process.stdout.write(s)' "$1"; }
if [[ "${1:-core}" == "demo" ]]; then
  out="IngestKey=$INGEST_KEY DashboardToken=$DASHBOARD_TOKEN ProdApiKey=$PROD_API_KEY StagingApiKey=$STAGING_API_KEY StagingHasFix=${STAGING_HAS_FIX:-false}"
else
  out="IngestKey=$INGEST_KEY DashboardToken=$DASHBOARD_TOKEN"
  [[ -n "${REPLAY_TARGETS:-}" ]] && out+=" ReplayTargets=$(compact "$REPLAY_TARGETS")"
  [[ -n "${STAGING_API_KEY:-}" ]] && out+=" StagingApiKey=$STAGING_API_KEY"
fi
[[ -n "${DELIVERY_TARGETS:-}" ]] && out+=" DeliveryTargets=$(compact "$DELIVERY_TARGETS")"
[[ -n "${GITHUB_TOKEN_PARAMETER:-}" ]] && out+=" GitHubTokenParameter=$GITHUB_TOKEN_PARAMETER"
echo "$out"
