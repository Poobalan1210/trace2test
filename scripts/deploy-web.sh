#!/usr/bin/env bash
# Builds the dashboard, writes its config.json from the stack outputs, syncs
# it to the private web bucket and invalidates CloudFront.
# For the demo stack: STACK_NAME=trace2test-demo scripts/deploy-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
out() { scripts/outputs.sh "$1"; }

API_URL="$(out T2tApiUrl)"
# Only the demo stack has the shop; without it the dashboard opens on the failure list.
STAGING_URL="$(out ShopStagingUrl)"
[[ "$STAGING_URL" == "None" ]] && STAGING_URL=""
DEMO=$([[ -n "$STAGING_URL" ]] && echo true || echo false)
BUCKET="$(out WebBucketName)"
DIST_ID="$(out WebDistributionId)"
DASHBOARD_URL="$(out DashboardUrl)"
[[ -n "$BUCKET" && "$BUCKET" != "None" ]] || { echo "Stack outputs not found. Deploy the stack first (sam build && sam deploy --guided)." >&2; exit 1; }

npm run web:build
# The demo stack is public: publish its dashboard token so visitors are not asked for one.
# Its data is the sample shop's, and the API is rate limited. Set PUBLIC_DEMO=false to keep the prompt.
TOKEN_FIELD=""
if [[ "$DEMO" == true && "${PUBLIC_DEMO:-true}" == true ]]; then
  [[ -f .env ]] && source .env
  [[ -n "${DASHBOARD_TOKEN:-}" ]] && TOKEN_FIELD=", \"token\": \"$DASHBOARD_TOKEN\""
fi
printf '{ "apiUrl": "%s", "stagingUrl": "%s", "demo": %s%s }\n' "$API_URL" "$STAGING_URL" "$DEMO" "$TOKEN_FIELD" > web/dist/config.json

# Hashed assets can be cached for a year; the shell and config must not be.
aws s3 sync web/dist "s3://$BUCKET" --delete --exclude index.html --exclude config.json \
  --cache-control "public, max-age=31536000, immutable"
aws s3 cp web/dist/index.html "s3://$BUCKET/index.html" --cache-control "no-cache" --content-type "text/html; charset=utf-8"
aws s3 cp web/dist/config.json "s3://$BUCKET/config.json" --cache-control "no-cache" --content-type "application/json"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths /index.html /config.json >/dev/null

echo "Dashboard: $DASHBOARD_URL"
