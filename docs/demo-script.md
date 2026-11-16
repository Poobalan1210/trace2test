# Demo script

A shot list for a video under three minutes, recorded at 1280 × 720.

## Before recording

- Deploy with `StagingHasFix=false`, run `scripts/deploy-web.sh`, and open the dashboard once so the token is entered.
- Delete earlier incidents, or record on a fresh stack, so the list starts empty.
- Open three windows at 1280 × 720: the `/shop` page, the dashboard list, and a terminal in the repository.
- Keep the Step Functions console open on the `t2t-pipeline-<stack>` state machine.
- Prepare the fix deploy so it can be cut: `sam deploy --parameter-overrides $(STAGING_HAS_FIX=true scripts/params.sh)`. Say plainly that this flag is a demo device: it deploys the rounding fix to staging only, while production keeps the bug.

## Shot list

| Time | On screen | Narration covers |
| --- | --- | --- |
| 0:00 to 0:25 | `/shop`, scenario "Coupon + UPI": pay, see "Something went wrong". Then pay by card: it works | A customer hits a bug the team cannot reproduce |
| 0:25 to 0:55 | Dashboard list: the incident appears. Open it; the stepper fills in | The failure was captured as it happened; the pipeline runs on its own |
| 0:55 to 1:20 | Captured request panel with redaction chips; then the Step Functions execution graph | Email and key were redacted before leaving the service; five services, no servers |
| 1:20 to 1:45 | Production vs staging panel: both 500 | The failure is reproduced on staging |
| 1:45 to 2:25 | Terminal: run the generated test (red). Flip the fix on staging, redeploy (cut), run again (green) | The output is a real test, and it proves the fix |
| 2:25 to 2:45 | Dashboard: "Re-run against staging", status turns Fixed | The loop is closed |
| 2:45 to 3:00 | Architecture diagram and the measured numbers | Idle cost, reuse in three lines, link to the repo |

If there is time, add a 15-second beat after 2:45: run "Sold out in production only" from the home page and show it marked Not reproduced, with the reason. It shows Trace2Test is honest about what it cannot reproduce.

## Commands for the terminal shot

```bash
# Download the test from the dashboard into regression/, then from the repository root:
source .env
T2T_TARGET_URL=$(scripts/outputs.sh ShopStagingUrl) T2T_TARGET_API_KEY=$STAGING_API_KEY \
  npx jest checkout-500-<fingerprint>.test.js        # red

sam deploy --parameter-overrides $(STAGING_HAS_FIX=true scripts/params.sh)   # cut

T2T_TARGET_URL=$(scripts/outputs.sh ShopStagingUrl) T2T_TARGET_API_KEY=$STAGING_API_KEY \
  npx jest checkout-500-<fingerprint>.test.js        # green
```

Only show numbers on the final card that you measured with [impact.md](impact.md).
