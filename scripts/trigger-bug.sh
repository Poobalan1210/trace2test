#!/usr/bin/env bash
# Sends the Lantern Books failing checkout (READ15 + UPI) to shop-prod, then
# waits for Trace2Test to turn it into a TEST_READY incident.
# Needs PROD_API_KEY and DASHBOARD_TOKEN, from .env or the environment.
set -euo pipefail
cd "$(dirname "$0")/.."
# The shop is only in the demo stack.
export STACK_NAME="${STACK_NAME:-trace2test-demo}"
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
: "${PROD_API_KEY:?set PROD_API_KEY (scripts/new-secrets.sh writes it to .env)}"

SHOP_URL="$(scripts/outputs.sh ShopProdUrl)"
API_URL="$(scripts/outputs.sh T2tApiUrl)"

CART='{"items":[{"sku":"BK-1042","price":1299,"qty":1},{"sku":"BK-2210","price":349.5,"qty":1}],"coupon":"READ15","paymentMethod":"upi","customer":{"email":"asha.k@example.com"}}'

start=$(date +%s)
echo "POST $SHOP_URL/checkout  (READ15, UPI)"
status=$(curl -s -o /tmp/t2t-checkout.json -w '%{http_code}' -X POST "$SHOP_URL/checkout" \
  -H 'content-type: application/json' -H "x-api-key: $PROD_API_KEY" -d "$CART")
echo "shop-prod answered $status: $(cat /tmp/t2t-checkout.json)"
rm -f /tmp/t2t-checkout.json

if [[ -z "${DASHBOARD_TOKEN:-}" ]]; then
  echo "Set DASHBOARD_TOKEN to follow the incident from here."
  exit 0
fi

echo "Waiting for the incident to reach TEST_READY…"
for _ in $(seq 1 30); do
  sleep 1
  latest=$(curl -s "$API_URL/incidents" -H "x-t2t-token: $DASHBOARD_TOKEN" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=(JSON.parse(s).items||[]).find(x=>x.path==="/checkout");if(i)console.log(i.id+" "+i.status+" "+i.occurrences)})')
  if [[ -n "$latest" ]]; then
    read -r id st occ <<<"$latest"
    printf '\r  %-16s %s (seen %s times)' "$st" "$id" "$occ"
    case "$st" in
      TEST_READY|TEST_UNVERIFIED|FIXED|STILL_FAILING|NOT_REPRODUCED|NOT_REPLAYABLE|PIPELINE_FAILED)
        echo; echo "Done in $(( $(date +%s) - start )) s. Open the dashboard: $(scripts/outputs.sh DashboardUrl)/incidents/$id"; exit 0 ;;
    esac
  fi
done
echo; echo "Still running after 30 s. Check the Step Functions console for the execution." >&2
exit 1
