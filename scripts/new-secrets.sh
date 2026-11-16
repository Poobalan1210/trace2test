#!/usr/bin/env bash
# Generates the four stack secrets into .env (gitignored) and prints them for
# `sam deploy --guided`. Re-running keeps an existing .env unless --force.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env && "${1:-}" != "--force" ]]; then
  echo ".env already exists; pass --force to replace it." >&2
else
  umask 077
  {
    echo "INGEST_KEY=$(openssl rand -hex 24)"
    echo "DASHBOARD_TOKEN=$(openssl rand -hex 24)"
    echo "PROD_API_KEY=$(openssl rand -hex 24)"
    echo "STAGING_API_KEY=$(openssl rand -hex 24)"
  } > .env
  echo "Wrote .env"
fi

# shellcheck disable=SC1091
source .env
cat <<OUT

Paste these when sam deploy --guided asks for them:
  IngestKey       $INGEST_KEY
  DashboardToken  $DASHBOARD_TOKEN
  ProdApiKey      $PROD_API_KEY
  StagingApiKey   $STAGING_API_KEY
  StagingHasFix   false

Or deploy without prompts:
  sam deploy --parameter-overrides \$(scripts/params.sh)
OUT
