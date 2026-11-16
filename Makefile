# sam build calls one build-<LogicalId> target per function (BuildMethod: makefile).
BUNDLE = node scripts/bundle.mjs

build-PayMockFunction:
	$(BUNDLE) services/shop/src/paymock.ts "$(ARTIFACTS_DIR)"

build-CheckoutProdFunction build-CheckoutStagingFunction:
	$(BUNDLE) services/shop/src/handler.ts "$(ARTIFACTS_DIR)"

build-IngestFunction:
	$(BUNDLE) services/ingest/src/handler.ts "$(ARTIFACTS_DIR)"

build-SanitizeFunction build-ValidateFunction build-ReplayFunction build-CompareFunction build-GenerateTestFunction build-DeliverFunction:
	$(BUNDLE) services/pipeline/src/handlers.ts "$(ARTIFACTS_DIR)"

build-ApiFunction:
	$(BUNDLE) services/api/src/handler.ts "$(ARTIFACTS_DIR)"
