# Trace2Test

**Turns a failed production request into a runnable regression test, without sensitive data ever leaving your service.**

A Lantern Books customer writes in: "Checkout fails when I use my coupon and pay by UPI." That is all they can tell you, the logs show only a 500, and every cart you try on your machine works. The bug needs one exact combination, a percentage coupon that leaves fractional paise plus the UPI payment path, and nobody on the team has that request.

Trace2Test captured that request the moment it failed, with the customer's email and the API key already redacted. It replayed the request on staging and confirmed the same failure. Then it opened a pull request in your repository with a Jest test that fails until the bug is fixed.

It runs in your own AWS account, and the SDK works with Node.js services on Lambda, Express or Fastify.

## What it does

1. **Capture.** `@trace2tests/sdk` wraps a Lambda handler or adds a middleware to Express or Fastify, and records a request only when it fails (a thrown error or a 5xx). Successful requests are never recorded.
2. **Redact.** Emails, card numbers, phone numbers, tokens, keys and passwords are replaced inside your service, before anything is sent. The replacements stay valid, so the request can still be replayed.
3. **Sanitize.** A second pass runs in the pipeline. Anything the first pass missed is redacted and counted as a leak, and the raw capture is deleted.
4. **Replay.** The request is sent to your staging service. The host comes only from stack configuration, never from the capture, and nothing is ever replayed against production.
5. **Compare and generate.** If staging fails the same way, Trace2Test writes a self-contained Jest file from a fixed template. The same incident always produces the same file. A service with no staging target still gets the test, marked **unverified**, to run against a local server.
6. **Deliver.** The test is opened as a pull request in the service's repository, with the redacted request and the error in the description.
7. **Verify.** Fix the bug, deploy to staging, and press "Re-run on staging". The incident is marked Fixed once staging stops failing, and Trace2Test comments on the pull request.

## Architecture

```
Customer
   |
   v
API Gateway (shop-prod) --> Lambda: checkout (prod) --> Lambda: PayMock
                               |
                               | on 5xx or thrown error: withTrace2Test()
                               | redacts, then POSTs the capture
                               v
API Gateway (t2t-api)  POST /incidents
   |
   v
Lambda: ingest --> S3  raw/{id}.json (expires in 1 day)
   |           --> DynamoDB  incident item, status RECEIVED
   |           --> StartExecution
   v
Step Functions: t2t-pipeline
   Sanitize -> Validate -> Replay -> Compare -> GenerateTest -> Deliver -> SaveResult
      |           |          |                       |             |           |
      v           |          v                       v             v           v
   S3 bundle.json |   your staging service      S3 test file   GitHub PR   DynamoDB
                  |   (here: shop-staging)
                  +--> no staging target: GenerateTest (unverified) -> Deliver

Browser --> CloudFront --> S3 (React dashboard)
Browser --> API Gateway (t2t-api)  GET /incidents, GET /incidents/{id},
                                   POST /incidents/{id}/verify, GET /metrics
```

| Service | Job in this build |
| --- | --- |
| Amazon API Gateway (HTTP API) | t2t-api for ingest and the dashboard; the demo adds shop-prod and shop-staging |
| AWS Lambda | Ingest, the six workflow tasks, the dashboard API; the demo adds checkout (prod and staging) and PayMock |
| AWS Step Functions (Standard) | Runs the pipeline with retries, choice states and a catch-all failure path; two modes, capture and verify |
| Amazon S3 | Raw captures (1-day expiry), sanitized bundles, generated tests, and the dashboard's static files |
| Amazon DynamoDB (on-demand) | Incident metadata, per-step timings, fingerprint counts, metrics |
| AWS Systems Manager Parameter Store | The GitHub token, as a SecureString |
| Amazon CloudFront | HTTPS in front of the private dashboard bucket |

The Mermaid version, including the state machine, is in [docs/architecture.md](docs/architecture.md).

## Quick start

**Prerequisites:** an AWS account and credentials, the AWS CLI, AWS SAM CLI (built and validated with 1.141), Node.js 22, `make`, `openssl`.

There are two stacks. `template.yaml` is Trace2Test on its own, for your services. `demo/template.yaml` adds Lantern Books, a sample shop with seeded bugs, and deploys the core stack inside it.

### For your services

```bash
npm ci
scripts/new-secrets.sh                                   # random secrets into .env (gitignored)
sam build && sam deploy --guided                         # Trace2Test only; stack "trace2test"
scripts/deploy-web.sh                                    # the dashboard, behind CloudFront
```

Then add the SDK to a service (below), and set the stack parameters you need. All are optional:

| Parameter | Example | What it does |
| --- | --- | --- |
| `ReplayTargets` | `{"orders":{"baseUrl":"https://staging.example.com","routes":{"POST":["/orders"]}}}` | Where each service's failures are replayed, and which routes are safe to send. Without one, a service still gets tests, marked unverified. |
| `StagingApiKey` | | Sent as `x-api-key` on every replay. |
| `DeliveryTargets` | `{"orders":{"repo":"acme/orders","testDir":"regression"}}` | Opens each new test as a pull request in that repository. Also takes `baseBranch` and `draft`. |
| `GitHubTokenParameter` | `/trace2test/github-token` | An SSM SecureString parameter with a fine-grained GitHub token: Contents and Pull requests, read and write, on those repositories. |
| `GitHubApiUrl` | `https://github.example.com/api/v3` | GitHub Enterprise Server only. |

```bash
aws ssm put-parameter --name /trace2test/github-token --type SecureString --value "$GITHUB_TOKEN"
```

To deploy without prompts, put `REPLAY_TARGETS`, `DELIVERY_TARGETS` and `GITHUB_TOKEN_PARAMETER` in `.env` and run `sam deploy --parameter-overrides $(scripts/params.sh)`. JSON values may not contain spaces, which is why routes can be written as `{"POST":["/orders"]}`; `params.sh` checks this.

### The demo

```bash
npm ci
scripts/new-secrets.sh
sam build --config-env demo && sam deploy --config-env demo --guided   # keep StagingHasFix=false
STACK_NAME=trace2test-demo scripts/deploy-web.sh
scripts/trigger-bug.sh            # sends the failing checkout to prod and waits for TEST_READY
```

To deploy the demo without prompts: `sam deploy --config-env demo --parameter-overrides $(scripts/params.sh demo)`. Add `DELIVERY_TARGETS='{"lantern-checkout":{"repo":"you/sandbox"}}'` and `GITHUB_TOKEN_PARAMETER` to `.env` to see pull requests too.

`sam deploy --guided` offers to save your answers to `samconfig.toml`. If you accept, check that no secret values were written there before you commit.

Open the dashboard URL that `deploy-web.sh` prints and enter your `DashboardToken`. With the demo, the home page explains what Trace2Test is and runs a live walkthrough (press Pay as the customer and watch each step fill in). Without it, the dashboard opens on the list of failures. Every captured failure, with full technical detail, is under **Failures** (`/incidents`), and `/setup` shows how to add the SDK.

### Run the test, fix the bug, verify

```bash
source .env
# Download the test from the incident page into regression/, then:
T2T_TARGET_URL=$(STACK_NAME=trace2test-demo scripts/outputs.sh ShopStagingUrl) T2T_TARGET_API_KEY=$STAGING_API_KEY \
  npx jest checkout-500-<fingerprint>.test.js        # fails: staging has the bug

sam deploy --config-env demo --parameter-overrides $(STAGING_HAS_FIX=true scripts/params.sh demo)

T2T_TARGET_URL=$(STACK_NAME=trace2test-demo scripts/outputs.sh ShopStagingUrl) T2T_TARGET_API_KEY=$STAGING_API_KEY \
  npx jest checkout-500-<fingerprint>.test.js        # passes
```

Then press **Re-run against staging** on the incident page.

**About `StagingHasFix`:** this parameter is a demo device, not a product feature. The checkout code reads `FIX_UPI_ROUNDING` and `FIX_ADDRESS_LINE2`, and the parameter sets both on the staging function only. Production keeps the bug while staging gets the fix, with no second code branch to maintain. In a real team, staging would simply run the newer code.

## Scenarios

The live demo on the home page offers the three bugs; the `/shop` page offers all of them except the storm. There are five scenarios in all. Each sends a real request to the production shop, and each ends differently:

| Scenario | What the customer says | What is really wrong | What Trace2Test does |
| --- | --- | --- | --- |
| Coupon + UPI | "Checkout fails when I use my coupon and pay by UPI." | The UPI path sends fractional paise (140122.5) to the payment provider | Reproduces it, generates a test, verifies the fix |
| Address without a flat number | "I can't order a gift for my brother." | The shipping-label code calls `.trim()` on the optional address line 2 | Reproduces it; the email inside the free-text gift note is redacted |
| Sold out in production only | "The Quiet Harbour shows on the site, but checkout fails every time." | Production's stock data has the book at zero; staging's does not | **Not reproduced**, with the reason: the failure depends on production data |
| Failure storm | Many customers hit the same bug | The coupon + UPI request, five times | One incident, with its occurrence count raised; no new pipeline runs |
| A normal order | Nothing | Nothing | Nothing captured: successful requests are never recorded |

The scenarios are defined once, in `services/shop/src/scenarios.ts`, and the tests check that each behaves as described in production, in staging with the bugs, and in staging with the fixes. The different stock data for production and staging is a demo device, like `StagingHasFix`.

## Add it to your service

```bash
npm install @trace2tests/sdk
```

```ts
import { withTrace2Test, trace2testExpress, trace2testFastify } from '@trace2tests/sdk';

const config = {
  ingestUrl: process.env.T2T_INGEST_URL,   // stack output IngestUrl
  ingestKey: process.env.T2T_INGEST_KEY,   // the IngestKey parameter
  service: 'orders',                       // keys ReplayTargets and DeliveryTargets
  stage: process.env.STAGE,                // 'prod' or 'production' captures; nothing else does
};

// Lambda: API Gateway HTTP and REST APIs, function URLs and ALB targets.
export const handler = withTrace2Test(realHandler, config);

// Express: capture first, recordErrors after your routes and before your error handler.
const t2t = trace2testExpress(config);
app.use(t2t.capture);
app.use(express.json());
// ...routes...
app.use(t2t.recordErrors);

// Fastify: on the root instance, before registering routes.
trace2testFastify(app, config);
```

Set `STAGE=prod` on production only. Staging never captures, so a replayed failure cannot create an incident of its own. Successful responses are untouched and cause no network call. On Lambda the wrapper waits at most 1.5 seconds for the capture to send; on Express and Fastify the capture is sent after the response has gone out. It never changes your response or throws. If a Lambda handler answers unexpected errors with its own 500, return `serverError(err)` from `@trace2tests/sdk` so the capture still knows which error it was.

Replays carry an `x-t2t-replay` header. Use `isReplay()` to skip side effects on staging while still running the failing code path:

```ts
import { isReplay } from '@trace2tests/sdk';
if (!isReplay(req)) await sendReceiptEmail(order);
```

The active redaction rules are on the dashboard's `/setup` page.

## Patterns you can reuse

- **One-command serverless stack.** `template.yaml` deploys an HTTP API, eight functions, a state machine, a table, two buckets and a CloudFront distribution with `sam build && sam deploy`. `demo/template.yaml` nests it as an `AWS::Serverless::Application` and shows how to break the dependency cycle between the two by declaring an API's route and integration as plain `AWS::ApiGatewayV2` resources.
- **Direct service integrations.** Results, metrics and failure states are written by Step Functions straight to DynamoDB, with no Lambda in between. Conditional writes make re-runs safe: a retried `SaveResult` cannot count an incident twice.
- **A two-mode state machine.** One definition handles both "capture a new failure" and "check a fix", chosen by a `mode` field at the start. See `scripts/build-asl.mjs`, which generates `statemachine/pipeline.asl.json` so every task gets identical retry and catch blocks.
- **Redaction that keeps data usable.** Replacements are valid values (a stable fake email, a test card number), so the redacted request still passes input validation on replay.

## Scale to zero

When nothing fails, nothing runs. There are no servers, containers, VPCs, NAT gateways or scheduled jobs. Lambda, API Gateway, Step Functions and DynamoDB on-demand all bill per request. The only standing cost is storage: the small static dashboard in S3, and any incidents still within their 30-day expiry (raw captures expire after one day). Logs are kept for 7 days. API Gateway throttling on ingest, plus fingerprint de-duplication, cap what a failure storm can start: repeats of a known failure only increment a counter.

## Limits

Trace2Test reproduces **deterministic HTTP failures**: the same request fails the same way on staging. It does not reproduce:

- failures that depend on production data, timing or concurrency. These are marked **Not reproduced**, with the reason ("staging returned 200; the bug may already be fixed or may depend on production data").
- requests whose body is over 256 KB or not JSON. These are marked **Not replayable**.
- anything outside Node.js services on Lambda, Express or Fastify. The generated tests are Jest only, and they call a running server over HTTP, so in CI they need one to call (they are skipped when `T2T_TARGET_URL` is not set).

It never replays against production, never records successful requests, and does not use an AI model anywhere: the test and the pull request are filled in from fixed templates.

## Measured impact

Nothing below has been measured yet. The protocol is in [docs/impact.md](docs/impact.md). One seeded bug timed three times is a demonstration, not a study.

| Metric | How it is measured | Manual | With Trace2Test |
| --- | --- | --- | --- |
| Time to reproduce | Stopwatch, from reading the complaint to seeing the failure locally; three runs | _to measure_ | _to measure_ |
| Time to a regression test | Stopwatch to a failing test that targets the bug | _to measure_ | _to measure_ |
| Reproduction rate | Reproduced incidents ÷ replayable incidents | not applicable | _from GET /metrics_ |
| Sensitive values left after redaction | Leak scan count across all bundles | not applicable | _from GET /metrics_ |

## How this differs from existing tools

<!-- TODO before submitting: name the nearest existing tools you have checked yourself, and keep only claims you have confirmed. -->

What sets Trace2Test apart: it captures only on failure, redacts before anything is stored, produces a portable test as its output, and deploys serverless with one command.

## Developing locally

```bash
npm test                 # redaction, the SDK (real Express and Fastify servers), ingest, every pipeline task, GitHub delivery
                         #   against a fake GitHub, the generator (including real Jest runs), API, state machine shape
npm run lint && npm run typecheck
npm run local:pipeline   # wrapped checkout -> ingest -> the five tasks, with in-memory stores; writes the test to .local/
npm run dev              # the whole stack on localhost plus the dashboard at http://localhost:5173; no AWS needed
                         #   (real handlers, in-memory stores, emulated state machine; token: local-dashboard-token)
curl -X POST http://localhost:8787/__local/staging-fix   # switch the fixes on (or off again) for local staging
```

Design and implementation choices that the spec left open are recorded in [docs/decisions.md](docs/decisions.md). The video shot list is in [docs/demo-script.md](docs/demo-script.md).

## Repository layout

```
template.yaml            Trace2Test (SAM)
demo/template.yaml       the Lantern Books demo, with Trace2Test nested inside
Makefile                 one esbuild bundle per function, called by sam build
packages/shared          types, redaction rules, fingerprinting, capture schema, JSON diff
packages/sdk             @trace2tests/sdk: Lambda, Express and Fastify adapters, isReplay
packages/aws             S3, DynamoDB and Step Functions stores, plus in-memory fakes
services/shop            Lantern Books checkout (prod and staging) and PayMock
services/ingest          POST /incidents
services/pipeline        Sanitize, Validate, Replay, Compare, GenerateTest, Deliver, the test generator and the GitHub client
services/api             dashboard API, verify and the demo trigger
statemachine/            pipeline.asl.json (generated by scripts/build-asl.mjs)
web/                     React dashboard (Vite, Tailwind, TanStack Query)
scripts/                 deploy, trigger and local tooling
docs/                    architecture, decisions, impact protocol, demo script
```

Lantern Books and PayMock are fictional and live in this repository. No real payment provider is involved.
