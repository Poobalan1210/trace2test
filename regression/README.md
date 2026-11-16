# regression/

Save generated tests here (the dashboard's Download button). Jest in this repository only looks in this folder, so from the repository root:

```bash
source .env
T2T_TARGET_URL=$(scripts/outputs.sh ShopStagingUrl) T2T_TARGET_API_KEY=$STAGING_API_KEY \
  npx jest checkout-500-<fingerprint>.test.js
```

Against the local stack (`npm run local:stack`) use `T2T_TARGET_URL=http://localhost:8789 T2T_TARGET_API_KEY=local-staging-key`.
