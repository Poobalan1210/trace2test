# Decisions

Choices made where the spec was silent, and the places where following it literally did not work. Newest concerns at the bottom of each section.

## Capture and redaction

**Handlers attach the error to their own 500.** Lantern Books answers an unexpected failure with `500 {"error":"Internal error"}`, as most services do, which hides the error from a wrapper. `serverError(err)` in `@t2t/shared` builds that response and attaches the error under a symbol key. JSON serialisation ignores symbol keys, so the HTTP response does not change, but `withTrace2Test` can still record `error.name`, `message` and `stackTop`. A handler that throws instead is also captured. In that case the capture records the response API Gateway sends for a thrown Lambda error (`500 {"message":"Internal Server Error"}`), and the wrapper rethrows. A plain 5xx with nothing attached is recorded as `HttpError: HTTP <status>`.

**Error messages and staging responses are redacted too.** The spec lists headers, query and body. Error messages often echo user input, so `error.message` also gets the pattern pass. The staging response that Replay stores gets the same treatment, because it is replayed data.

**Extra headers are dropped.** Besides the spec's list (`x-forwarded-for`, `x-amzn-trace-id`, `user-agent`, `cloudfront-*`), the wrapper drops transport and path headers: `host`, `connection`, `content-length`, `accept-encoding`, `forwarded`, `via`, `x-forwarded-*`, `x-real-ip`, `x-amz-cf-id` and `sec-*`. They say nothing about the request, and they cluttered the replay and the generated test.

**Leak count.** Sanitize runs the full rule set again over the capture. Every value it still has to redact is counted as a leak (the wrapper missed it), and then redacted. A third scan of the result should find nothing; anything it does find is added to the count.

**Fingerprint input.** The fields are joined with newlines before hashing. `stackTop` keeps its line number, so a redeploy that moves the failing line produces a new fingerprint, and a new incident is opened. Bundles are built unminified, with source maps and `--enable-source-maps`, so `stackTop` names the TypeScript function and file (`chargeUpi (checkout.ts:34)`), not a minified symbol.

## Pipeline and data

**When a repeat failure counts as a duplicate.** The spec says to skip the workflow when the fingerprint's incident already has a test. Ingest also skips it while that incident is still in progress, so a failure storm in the first seconds cannot start an execution per request. When the earlier incident ended without a test (`NOT_REPRODUCED`, `NOT_REPLAYABLE`, `PIPELINE_FAILED`), the next capture opens a new incident. The fingerprint item is claimed with `if_not_exists`, and reassigned with a condition, so two concurrent captures cannot both start a workflow.

**Extra metrics.** The reproduction rate is reproduced ÷ replayable, so the metrics item also counts `replayable`. `GET /metrics` reports the median capture-to-test time, which a running total cannot give. It computes the median from the newest 200 incidents and reports the sample size beside it.

**Verify results are stored separately.** Verify mode writes `incidents/<id>/verify.json`, which keeps the original reproduction in `replay.json`. The dashboard can show either one.

**State machine shape.** Besides the spec's states there are:
- `AfterCompare`, `VerdictChoice` and `FixedChoice`, which choose the next step
- `NoTest`, a Pass state, so both verdicts can share `SaveResult`
- `SaveMetrics` and `CountFix`, which update the metrics item
- `MarkFirstFix`
- `Done` and `PipelineFailed`, which end the execution

`SaveResult` and `MarkFirstFix` are conditional writes (`attribute_not_exists`). A re-run of either state hits `ConditionalCheckFailedException`, which is caught and leads to `Done`, so the metrics are never counted twice. Lambda payloads carry only `incidentId` and `mode`, and each result is narrowed with `ResultSelector`.

**Verify failures use the same failure path.** An error during verify mode sets `PIPELINE_FAILED` with the error recorded. The incident keeps its `testKey`, so the test stays downloadable and the incident still counts as owning its fingerprint.

**Resource names include the stack name.** These are the table `<stack>-t2t` and the state machine `t2t-pipeline-<stack>`. Two stacks can then share an account and region. With the default stack name, `trace2test`, they read `trace2test-t2t` and `t2t-pipeline-trace2test`.

## Infrastructure

**PayMock is invoked directly, not over HTTP.** Checkout calls PayMock with a synchronous `lambda:Invoke` scoped to that one function. This needs no extra public endpoint and no function URL auth settings. The spec's diagram allows either ("Lambda URL/API").

**Dashboard routes are declared as raw API Gateway resources.** Defining every route as a SAM event creates a dependency cycle: `ShopProdApi → CheckoutProdFunction → T2tApi → ApiFunction → ShopProdApi`. The ingest route stays a SAM event (it keeps its route-level throttling), and the six dashboard routes are explicit `AWS::ApiGatewayV2::Route` resources. `T2tApi` therefore no longer depends on `ApiFunction`.

**Build uses SAM's makefile builder, not its esbuild builder.** SAM's esbuild builder runs `npm update` in the source tree, which pruned the workspace's dev dependencies (esbuild included) during a build. `Makefile` calls `scripts/bundle.mjs` (esbuild's API) once per function. The build takes about two seconds and leaves `node_modules` alone. Paths are quoted, because the repository may live in a directory with spaces.

**One log group.** All functions log to `/trace2test/<stack>/functions` through `LoggingConfig`, with 7-day retention. This avoids ten log groups that Lambda would otherwise create with no expiry.

**Secrets are Lambda environment variables.** The four NoEcho parameters reach the functions as environment variables. Anyone with `lambda:GetFunctionConfiguration` in the account can read them. That is acceptable for this demo; a production deployment would read them from Secrets Manager or SSM SecureString at cold start.

## Generated test

**Only replayable headers go into the test.** The test carries the same request headers the Replay step sends (`content-type`, `accept`, `accept-language`). The API key comes from `T2T_TARGET_API_KEY`, never from the capture, which only ever holds a placeholder.

**Comment safety.** Captured text that appears in the header comment (path, error message, redacted paths) is flattened to one line, and every `*/` becomes `* /`. Everything in code positions goes through `JSON.stringify`. The injection test evaluates a file built from hostile input in a sandbox and checks that it sends exactly the captured body.

## Dashboard

**One development mode.** `npm run dev` starts the local stack (the real handlers, in-memory stores, and an emulation of the state machine's direct DynamoDB steps) together with the dashboard. `web/public/config.json` points at it. An earlier in-browser mock API was removed: it was a second implementation that drifted from the real one. `scripts/deploy-web.sh` writes the deployed site's own `config.json`.

**No requests before a token.** The app renders only the token dialog until a token exists, so no page fills with 401 errors behind it. Any later 401, from a query or a mutation, clears the token and asks again.

**Green and amber.** Green is used only for a verified fix (the Fixed pill, the last step of the stepper, staging's 200 on a fix check). "0 leaked" is shown in muted text. Amber marks captured and in-progress states and the primary button.

## Scenarios

**More than one bug.** Lantern Books has three seeded failures, each with a different outcome: coupon + UPI (reproduced, fixable), a missing address line 2 (reproduced, fixable, with an email in free text), and a book sold out only in production (not reproduced). A fourth scenario repeats the first five times, to show de-duplication. `StagingHasFix` turns on both fixes. Production and staging get different stock data from `STOCK` in `catalog.ts`, keyed by `STAGE`. That is a demo device that stands in for the data differences real environments have.

**Plain-language summaries.** The incident page opens with "What happened" and "What to do next". Both are filled from a fixed template using the incident's own fields (`web/src/lib/narrate.ts`); no model is involved. A "Not reproduced" verdict is drawn as a neutral stop in the stepper, not as a red failure, because it is an honest result rather than an error.

**One scrolling overview, no Next button.** The audience is hackathon judges, so the home page (`HomePage.tsx`) answers four questions in order: what it is (one-sentence hero), what problem it solves (without/with), does it work (a live demo: pick a complaint and press Pay on the left, and a five-row timeline on the right fills in by itself from the real incident), and can I use it (three steps with real snippets, plus what it is and is not built for), then who it helps. "Staging" is called the "test copy", with one line naming the term. On the local stack, paying first switches staging's fix off so the bug reproduces. An earlier eight-screen Next/Next walkthrough was replaced by this because it hid the reuse story and made viewers click to see anything. The incident list is at `/incidents`.

**One story per incident page.** The incident page reads top to bottom as five numbered chapters (checkout failed, private data removed, replayed on staging, test written, check the fix); raw headers, body and test code sit behind "Show…" toggles. Incidents are titled with the matching scenario's name and complaint (`errorIncludes` in `scenarios.ts`); an incident that matches no scenario falls back to its error. On the local stack a "Deploy the fix to staging" button replaces the curl command, and `/__local/staging-fix` accepts `{"on": bool}` and answers GET.

## Beyond the spec: making it adoptable (2026-11-16)

These change the original spec on purpose. The goal moved from a demo to a tool other teams can install.

**The SDK is a published package, `@trace2tests/sdk`.** `trace2test` is already taken on npm. The package is built with tsup into ESM, CommonJS and bundled type definitions, and `@t2t/shared` is bundled in, so it has no runtime dependencies. Inside this repository it still runs from source: `tsconfig.json` paths and the vitest alias map the name to `packages/sdk/src`, and esbuild and tsx read those paths. The type bundler treats anything under `node_modules` as external, so `packages/sdk/tsconfig.build.json` maps `@t2t/shared` straight to its source folder.

**Lambda, Express and Fastify.** The SDK has one framework-neutral core (`core.ts`: request info to capture, redaction, posting) and three thin adapters. The Lambda adapter reads payload v2 (HTTP APIs, function URLs) and v1 (REST APIs, ALB, including multi-value maps). Express and Fastify post the capture after the response has gone out, so they add no latency; Lambda still waits up to 1.5 s, because the container freezes once the handler returns. Their types are structural, so the SDK depends on neither framework. `stage` now accepts `production` as well as `prod`, and `enabled` overrides it.

**`isReplay()` for side effects.** Replays already carried `x-t2t-replay`. The helper makes it usable: services skip emails, charges and webhooks on replay while still running the failing code path.

**Capture-only mode.** A service without a replay target, or a route not on the allowlist, used to end as `NOT_REPLAYABLE` with nothing to show. It now gets a test anyway and ends as `TEST_UNVERIFIED`. Teams without a staging copy still get the exact redacted request as a runnable test. `NOT_REPLAYABLE` now means only that the body was too large or not JSON, so there is nothing to build a test from. Validate returns `testable`; GenerateTest decides verified or not from whether a replay record exists, and returns the final status and metric deltas, so SaveResult and SaveMetrics read everything from `$.test`. SaveResult no longer writes `verdict`: Compare already does, and unverified incidents have none.

**Tests go to GitHub as pull requests.** A Deliver task after GenerateTest opens a pull request in the service's repository (`DeliveryTargets`), on branch `trace2test/<test name>`, with the test in `testDir` (default `regression`). On the first verified fix, NotifyFix comments on it. Every GitHub step is idempotent (existing branch, file or open PR is reused). GitHub errors are recorded on the incident (`delivery.error`) and do not fail the pipeline, because the test is still on the dashboard. Captured values appear in the PR only inside code spans and fences sized past their longest backtick run, so they cannot format the page or @mention anyone. The token is an SSM SecureString rather than a Secrets Manager secret, so an idle stack still costs nothing. Plain REST over fetch, no Octokit.

**Generated tests skip without a target.** They used to throw in `beforeAll` when `T2T_TARGET_URL` was unset. Now they use `describe.skip`, so a test merged from a pull request does not break a suite that has no server to call.

**Core and demo stacks.** `template.yaml` is Trace2Test only; replay targets, the staging key, delivery and the GitHub token are parameters. `demo/template.yaml` deploys Lantern Books and PayMock and nests the core as an `AWS::Serverless::Application`. The production shop's API, route and integration are plain `AWS::ApiGatewayV2` resources: as a SAM event, the API would depend on the function, which depends on the core's ingest URL, which (through the demo trigger) depends on the API. The demo stack repeats the core's outputs, so the scripts read one stack either way. `samconfig.toml` has a `demo` environment.

**Routes without spaces.** `--parameter-overrides $(scripts/params.sh)` is split on spaces, and `"POST /orders"` has one. `parseTargets` also accepts `{"POST": ["/orders"]}`, and `params.sh` compacts JSON values and refuses any that still contain a space.

**The dashboard without the demo.** `config.json` gains `demo`. Without it (and without a staging URL) the home page redirects to `/incidents`, and the Overview and Demo shop links are hidden. The Setup page shows Lambda, Express and Fastify snippets, `isReplay`, and the stack parameters.

## Not verified locally

- `sam local invoke` (milestone 1's check) needs Docker, which was not running on the build machine. The handlers are covered by unit tests, and the built bundles were imported and invoked directly with Node.
- Nothing has been deployed yet. `sam validate --lint` passes and `sam build` succeeds for both `template.yaml` and `demo/template.yaml`, but the first `sam deploy` is the first real test of IAM policies, the nested stack, the CORS origin and the CloudFront origin access control.
- Delivery has been tested against an in-memory fake of the GitHub REST API (`github.test.ts`), not against github.com. The first real run is the test of token scopes and the SSM read.
- How SAM CLI parses JSON in `--parameter-overrides` was not checked against its source; compact JSON without spaces is expected to pass through as one value.
