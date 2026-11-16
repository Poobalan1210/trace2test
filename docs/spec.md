

# Trace2Test: implementation spec for Claude Code
 · 

## 1. Overview
Build Trace2Test: a serverless tool that captures a failed API request in production, strips sensitive data, replays it against staging, and hands the developer a runnable Jest regression test.
This is an entry for an AWS serverless weekend challenge. Entries close Monday 16 November 2026 at 1:00 PM PT (Tuesday 2:30 AM IST). Judges score four things equally: originality, craft, usefulness and storytelling.
Hard constraints
- 
Everything runs on managed serverless services. No EC2, containers, VPCs, NAT gateways or always-on workers.
- 
All five of these must do real work: AWS Lambda, Amazon API Gateway, Amazon DynamoDB, Amazon S3, AWS Step Functions.
- 
One command deploys the whole thing: sam build && sam deploy.
- 
Idle cost is close to zero: on-demand billing everywhere, no provisioned capacity.
- 
A small build that works end to end beats a larger one with rough edges. When in doubt, cut scope, not quality.
How to use this spec
- 
Build in the milestone order in section 10. Do not start a milestone until the previous one passes its acceptance check.
- 
Where this spec is silent, choose the simpler option and note the choice in docs/decisions.md.
- 
Do everything that can be tested locally before asking the user to deploy. The user runs sam deploy with their own AWS credentials.
- 
Never invent measurements, statistics or testimonials for the README. Leave marked placeholders for numbers the user must measure.

## 2. The use case
The demo is built around one bug class that real payment integrations hit: money computed as a floating-point number and sent to a payment provider that only accepts whole minor units (paise, cents).
The sample service: Lantern Books
Lantern Books is a fictional online bookshop. Its checkout API is one Lambda behind API Gateway: POST /checkout. It calls PayMock, a fictional payment provider that is also a Lambda in this repo. Both names are invented; do not imitate any real brand.
The seeded bug
- 
The card payment path was written first and converts rupees to paise with Math.round(total * 100).
- 
The UPI path was added later by a different developer and sends total * 100 unrounded.
- 
PayMock rejects any amount that is not an integer with 400 amount must be an integer. The checkout handler does not expect that and returns 500.
- 
So checkout fails only when a percentage coupon produces a fractional paise total and the customer pays by UPI.
The failing request
Field
Value
Cart
One book at ₹1,299.00 and one at ₹349.50
Coupon
READ15 (15% off)
Payment method
upi
Total
₹1,648.50 × 0.85 = ₹1,401.225, which is 140,122.5 paise
Result
PayMock returns 400, checkout returns 500
The same cart with card succeeds. The same coupon with round prices succeeds. That is why it "works on my machine": the existing unit tests use round prices. Add a unit test that proves this exact cart fails before the fix and passes after.
The story the demo tells
- 
A customer writes in: "Checkout fails when I use my coupon and pay by UPI." They cannot say more than that.
- 
Without Trace2Test, the developer searches logs, guesses carts and tries combinations.
- 
With Trace2Test, the failed request was captured the moment it happened. The email and API key were redacted before the capture left the service.
- 
The workflow replayed it on staging, confirmed the same failure, and generated a Jest test.
- 
The developer runs the test (red), applies the one-line fix, deploys to staging, and runs it again (green). The dashboard marks the incident fixed.
How a real team adopts it
They deploy the stack once, then wrap each Lambda handler: export const handler = withTrace2Test(realHandler, config). Nothing else in their code changes.

## 3. Architecture
A failure flows one way: capture wrapper, ingest API, Step Functions workflow, then the dashboard reads the result.
```
 Lambda: checkout (prod) --> Lambda URL/API: PayMock
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
   Sanitize -> Validate -> Replay -> Compare -> GenerateTest -> SaveResult
      |                      |                       |              |
      v                      v                       v              v
   S3 bundle.json   API Gateway (shop-staging)   S3 test file   DynamoDB
                    --> Lambda: checkout (staging)

Browser --> CloudFront --> S3 (React dashboard)
Browser --> API Gateway (t2t-api)  GET /incidents, GET /incidents/{id},
                                   POST /incidents/{id}/verify, GET /metrics]]>
```

What each service does
Service
Job in this build
API Gateway (HTTP API)
Three APIs: shop-prod, shop-staging, and t2t-api for ingest and the dashboard
Lambda
Checkout handler, PayMock, ingest, the five workflow tasks, the dashboard read API
Step Functions (Standard)
Orchestrates the pipeline with retries, a choice state and a catch-all failure path
S3
Raw captures (1-day expiry), sanitized bundles, generated tests, and the dashboard's static files
DynamoDB (on-demand)
Incident metadata, per-step timings, fingerprint counts, metrics
CloudFront
HTTPS in front of the private dashboard bucket
Design decisions
- 
Use a Standard workflow, not Express. The visual execution history is part of the demo, and at this volume the cost difference is negligible.
- 
SaveResult and the failure handler call DynamoDB directly from Step Functions, with no Lambda in between. This shows off service integrations.
- 
Prod and staging are two deployments of the same checkout code inside one SAM stack, selected by a STAGE environment variable. One stack keeps deployment to a single command.
- 
The capture wrapper is the only code that runs inside the user's service. Everything else is in the Trace2Test stack.

## 4. Repo layout and tooling
One repository, TypeScript throughout, deployed with AWS SAM.
```

```

Tooling
Area
Choice
Lambda runtime
Node.js 22 (nodejs22.x), or the newest LTS runtime the installed SAM CLI supports; arm64
Bundling
SAM's built-in esbuild build method; no layers
AWS SDK
v3, modular clients only
Unit tests
Vitest for the repo's own code
Generated tests
Plain JavaScript for Jest, no dependencies beyond Jest and Node's built-in fetch
IDs
ULID for incident IDs, so they sort by time
Frontend
React 18+, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query
Code display
Shiki or Prism for syntax highlighting; a small custom JSON diff, no heavy diff library
SAM parameters
- 
IngestKey (NoEcho): shared secret the wrapper sends when posting a capture.
- 
DashboardToken (NoEcho): shared secret the dashboard sends on every API call.
- 
StagingApiKey (NoEcho): the key the replay step uses against staging.
Stack outputs
Print these after deploy: prod shop URL, staging shop URL, t2t-api URL, dashboard URL, state machine ARN, web bucket name.

## 5. The capture wrapper
withTrace2Test(handler, config) wraps a Lambda handler and sends a redacted capture only when the request fails.
Behaviour
- 
Call the real handler.
- 
If it returns a status below 500, return the response untouched. Nothing is recorded.
- 
If it throws or returns 500 or above, build a capture, redact it, and POST it to the ingest URL.
- 
Await the POST with a 1.5 second timeout before returning, because Lambda freezes the process after the response.
- 
Never change the handler's response and never throw from the wrapper. A capture failure is logged and swallowed.
Config
```

```

Capture shape
```
<" }
}]]>
```

Redaction rules
- 
Redaction happens inside the wrapper, before anything leaves the service. This is the first of two passes; the second is the Sanitize step.
- 
Key-based: any object key matching the keys list, case-insensitive, at any depth, in headers, query and body.
- 
Pattern-based: scan every string value for emails, card numbers (13 to 19 digits that pass the Luhn check), JWTs and bearer tokens.
- 
Replacements keep the value valid so the replay still passes input validation:
Type
Replacement
Email
user_<4 hex chars from a hash>@redacted.example (stable per input, so equal emails stay equal)
Card number
4111111111111111
Phone
+10000000000
Header secrets, tokens, passwords
[REDACTED:<type>]
- 
Record every redaction in redactions with its path and type. Never record the original value, a prefix of it, or its length.
- 
Drop these headers entirely: x-forwarded-for, x-amzn-trace-id, user-agent, and anything starting with cloudfront-.
- 
If the body exceeds maxBodyBytes or is not JSON, send the capture with body: null and bodyOmitted: true. Such incidents are marked not replayable later.
Tests required
- 
Each redaction type, nested objects, arrays, and a string holding two secrets.
- 
A successful response produces no network call.
- 
An ingest timeout does not delay the response past the 1.5 second budget or change it.

## 6. API and data model
One HTTP API (t2t-api) serves both ingest and the dashboard; one DynamoDB table and one data bucket hold everything.
Endpoints
Method and path
Auth header
Purpose
POST /incidents
x-t2t-ingest-key
Receive a capture, store it, start the workflow. Returns 202 { incidentId }
GET /incidents?status=&cursor=
x-t2t-token
List incidents, newest first, 25 per page
GET /incidents/{id}
x-t2t-token
Full incident: metadata, step timings, sanitized request, replay result, diff
GET /incidents/{id}/test
x-t2t-token
The generated test as text, plus its filename
POST /incidents/{id}/verify
x-t2t-token
Re-run the replay against staging to check a fix. Returns 202
GET /metrics
x-t2t-token
Totals for the dashboard header
POST /demo/trigger
x-t2t-token
Sends the seeded failing checkout to shop-prod, for the demo button
- 
Compare secrets with a constant-time comparison. Return 401 with no detail on mismatch.
- 
CORS: allow only the dashboard's CloudFront origin, plus http://localhost:5173 for development.
- 
Ingest validates the capture against the schema, rejects bodies over 300 KB with 413, and throttles at the API Gateway level (10 requests per second, burst 20).
Fingerprinting and duplicates
- 
Fingerprint = SHA-256 of service + method + path + error.name + error.stackTop, first 12 hex characters.
- 
On ingest, increment the fingerprint's counter. If an incident with that fingerprint already has a generated test, do not start a new workflow; return the existing incidentId and bump occurrences and lastSeenAt.
- 
This keeps a failure storm from starting thousands of executions.
DynamoDB table t2t (on-demand, TTL on expiresAt, 30 days)
Item
pk
sk
Key attributes
Incident
INC#<id>
META
status, service, method, path, errorName, errorMessage, fingerprint, occurrences, createdAt, lastSeenAt, steps, verdict, prodStatus, stagingStatus, redactionCount, leakCount, testKey, executionArn, gsi1pk, gsi1sk
Fingerprint
FP#<hash>
META
incidentId, count, firstSeenAt, lastSeenAt
Metrics
METRICS
TOTALS
captured, reproduced, testsGenerated, fixed, redactions, leaks, pipelineMsTotal
- 
GSI gsi1: gsi1pk = "INC", gsi1sk = createdAt. The list endpoint queries it in descending order.
- 
steps is a map keyed by state name: { startedAt, endedAt, ms, ok }. The dashboard's stepper and timings come from it.
- 
Update metrics with atomic ADD expressions.
Incident statuses
RECEIVED, SANITIZED, REPLAYING, REPRODUCED, NOT_REPRODUCED, NOT_REPLAYABLE, TEST_READY, VERIFYING, FIXED, STILL_FAILING, PIPELINE_FAILED.
S3 data bucket (private, encryption on, public access blocked)
Key
Contents
Lifecycle
raw/<id>.json
Capture as received (already redacted once by the wrapper)
Deleted by Sanitize; 1-day expiry as a backstop
incidents/<id>/bundle.json
Sanitized replay bundle
30 days
incidents/<id>/replay.json
Staging response and the diff
30 days
incidents/<id>/<name>.test.js
Generated Jest test
30 days
The dashboard's static files live in a second bucket, private, served only through CloudFront with origin access control.

## 7. The workflow
One Standard state machine, t2t-pipeline, runs in two modes: capture for a new incident and verify to check a fix.
Input: { "incidentId": "<ulid>", "mode": "capture" | "verify" }. States pass only small references (IDs, S3 keys, verdicts) between each other, never the capture body.
```
 ModeChoice
       capture -> Sanitize -> Validate -> ReplayableChoice
                                            no  -> MarkNotReplayable -> End
                                            yes -> Replay -> Compare -> VerdictChoice
                                                      REPRODUCED     -> GenerateTest -> SaveResult -> End
                                                      NOT_REPRODUCED -> SaveResult -> End
       verify  -> Replay -> Compare -> SaveVerifyResult -> End

Any unhandled error in any state -> MarkPipelineFailed -> Fail]]>
```

States
State
Type
What it does
Sanitize
Lambda
Reads raw/<id>.json. Runs the redaction rules a second time. Runs a leak scan over the result and counts any remaining matches. Writes bundle.json, deletes the raw object, sets status SANITIZED. If the leak count is above zero, redact those values and record the count
Validate
Lambda
Decides whether the incident can be replayed: body present and JSON, method and path on the allowlist, a staging target configured for the service. Returns { replayable, reason }
Replay
Lambda
Sends the bundled request to the staging base URL from configuration. Adds x-t2t-replay: <incidentId> and the staging API key. 10 second timeout. Writes the response to replay.json. Sets status REPLAYING, or VERIFYING in verify mode
Compare
Lambda
Compares production and staging results and returns a verdict (rules below). Writes a field-level JSON diff of the two response bodies into replay.json
GenerateTest
Lambda
Fills the Jest template (section 8), writes the test file to S3, returns its key
SaveResult
DynamoDB UpdateItem (direct integration)
Stores verdict, statuses, test key and final status TEST_READY or NOT_REPRODUCED; a second direct UpdateItem adds to the metrics item
SaveVerifyResult
DynamoDB UpdateItem (direct integration)
Sets FIXED when staging now returns below 500, otherwise STILL_FAILING
MarkNotReplayable, MarkPipelineFailed
DynamoDB UpdateItem (direct integration)
Record the reason or the error name and cause
Verdict rules in Compare
- 
REPRODUCED: staging status is 500 or above and the error signature matches. Signature = status class plus the error field of the response body when present.
- 
NOT_REPRODUCED: anything else. Store the reason, for example "staging returned 200; the bug may already be fixed or may depend on production data".
- 
In verify mode: FIXED when the staging status is below 500, otherwise STILL_FAILING.
Retries and errors
- 
Every Lambda task retries on Lambda.ServiceException, Lambda.TooManyRequestsException and States.Timeout: 2 attempts, 2 second interval, backoff rate 2.
- 
Replay also retries once on a custom NetworkError. A 5xx from staging is a result, not an error; do not retry it.
- 
Every task has a Catch for States.ALL that routes to MarkPipelineFailed.
- 
Each task Lambda records its own startedAt, endedAt and ms into the incident's steps map, so the dashboard can show per-step timings without calling the Step Functions API.
- 
Task Lambdas are idempotent: running a state twice for the same incident produces the same objects and does not double-count metrics.
Safety rule for Replay
The target host comes only from stack configuration, keyed by service name. Never take a host, scheme or port from the capture. Only the path, query, method, allowlisted headers and body come from the bundle.

## 8. The generated test
The output is one self-contained Jest file, built from a fixed template, that sends the captured request to any base URL and fails while the bug exists.
Rules
- 
Generate from a template with string substitution. Do not call an AI model. The same incident must always produce the same file, byte for byte.
- 
The file has no imports beyond Jest globals and Node's built-in fetch, so it drops into any Node 18+ project.
- 
The target URL and API key come from environment variables. No hostname or secret is written into the file.
- 
Filename: <path-slug>-<prodStatus>-<fingerprint first 6>.test.js, for example checkout-500-a41f9c.test.js.
- 
Escape every substituted value with JSON.stringify. A captured string must never be able to break out into code.
What a finished file looks like
```
< T2T_TARGET_API_KEY=]]>< \
 *     npx jest checkout-500-a41f9c.test.js
 *
 * This test fails while the bug exists and passes once it is fixed.
 */

const TARGET = process.env.T2T_TARGET_URL;
const API_KEY = process.env.T2T_TARGET_API_KEY;

const request = {
  method: "POST",
  path: "/checkout",
  headers: { "content-type": "application/json" },
  body: {
    items: [
      { sku: "BK-1042", price: 1299, qty: 1 },
      { sku: "BK-2210", price: 349.5, qty: 1 }
    ],
    coupon: "READ15",
    paymentMethod: "upi",
    customer: { email: "user_7f3a@redacted.example" }
  }
};

describe("POST /checkout (incident a41f9c)", () => {
  beforeAll(() => {
    if (!TARGET) throw new Error("Set T2T_TARGET_URL to the server under test");
  });

  test("does not fail with a server error", async () => {
    const res = await fetch(TARGET + request.path, {
      method: request.method,
      headers: { ...request.headers, ...(API_KEY ? { "x-api-key": API_KEY } : {}) },
      body: JSON.stringify(request.body)
    });
    const text = await res.text();

    // Captured in production: 500. A fixed server must not return 5xx here.
    ]]>= 500) console.error(text]]>
```

Tests required for the generator
- 
Snapshot test: the Lantern Books incident produces exactly the expected file.
- 
Injection test: a body containing quotes, backticks, */ and ${} still yields a file that parses.
- 
The generated file passes node --check.
- 
End to end: against a local server with the bug, the generated test fails; with the fix, it passes.
Stretch goal, only after section 10 is complete
An in-process variant that imports the handler and stubs outbound fetch, so the test runs without a deployed staging service. Do not start this before every milestone passes.

## 9. The dashboard
A React single-page app with four routes. The incident detail page is the centrepiece of the demo video and deserves the most care.
Routes
Route
Purpose
/
Incident list with a metrics strip
/incidents/:id
Incident detail: pipeline progress, request, replay diff, generated test
/shop
Lantern Books demo checkout, the customer's view of the bug
/setup
Install snippet and the active redaction rules
On first load, ask for the dashboard token in a small dialog and keep it in sessionStorage, wrapped in try/catch. Send it as x-t2t-token. On a 401, clear it and ask again.
Incident list (/)
- 
Metrics strip, five figures from GET /metrics: failures captured, reproduced on staging (count and percent), tests generated, median time from capture to test, sensitive values redacted (with "0 leaked" beside it when the leak count is zero).
- 
One row per incident: status pill, METHOD /path, error name and message on one truncated line, "seen N times" when occurrences exceed 1, relative time.
- 
Filter chips: All, Test ready, Fixed, Not reproduced, Failed.
- 
Poll every 3 seconds while any visible incident is in progress; otherwise every 15 seconds. New rows slide in at the top.
- 
Empty state: one sentence on what will appear here, and a "Trigger the sample failure" button that calls POST /demo/trigger.
Incident detail (/incidents/:id)
- 
Header: error name and message as the title, then METHOD /path, service, captured time, occurrences.
- 
Pipeline stepper directly under the header: Captured, Sanitized, Replayed, Reproduced, Test generated, Fix verified. Each step shows its duration from steps. The active step pulses; a failed step turns red and shows its reason. Poll every 1.5 seconds until the incident settles.
- 
Three panels, shown as tabs on narrow screens and as a two-column layout at 1280 px and wider (request on the left; diff and test stacked on the right):
- 
Captured request. Pretty-printed JSON. Every redacted value renders as a small labelled chip ("email redacted", "key redacted") instead of raw text. A caption states how many values were redacted and that the originals never left the service.
- 
Production vs staging. Two columns with status codes large at the top and response bodies below, differing fields highlighted. A one-line verdict above: "Reproduced: staging fails the same way" or the not-reproduced reason.
- 
Regression test. Syntax-highlighted code with line numbers, the filename, Copy and Download buttons, and the exact run command with its own copy button.
- 
Primary action: "Re-run against staging". It calls verify and the stepper's last step goes live. On FIXED, the header status turns green with the time the fix was verified. On STILL_FAILING, show the staging response.
Demo shop (/shop)
- 
A plain storefront in a light theme, visually distinct from the dashboard, so the video clearly shows two different products.
- 
A cart with the two books prefilled, a coupon field prefilled with READ15, and a Card or UPI choice.
- 
Pay calls shop-prod. Success shows an order confirmation. Failure shows what a real customer would see: "Something went wrong. Please try again."
- 
A discreet link, "View in Trace2Test", appears after a failure.
Visual direction
- 
A precise, calm developer tool. Dark theme for the dashboard. No gradient hero, no glassmorphism, no emoji, no stock illustrations.
- 
Colour: near-black background (#0B0E14), raised panels (#121722), hairline borders (#1F2633), primary text (#E6E9EF), muted text (#8B93A3). One accent, amber (#F5A524), for captured and in-progress states and the primary button. Red (#F0524F) only for failures, green (#3DD68C) only for reproduced-and-fixed outcomes. Check all text pairs for WCAG AA contrast.
- 
Type: IBM Plex Sans for interface text, IBM Plex Mono for code, IDs, routes and numbers. Self-host both. Use tabular figures for durations and counts.
- 
Density: 14 px base text, a 4 px spacing grid, 8 px panel radius, 1 px borders instead of shadows.
- 
Motion: 150 to 200 ms transitions on state changes only. Respect prefers-reduced-motion.
- 
Status is never shown by colour alone: every pill has a text label and an icon.
Quality bar
- 
Loading uses skeletons shaped like the content, not spinners. Every request has a visible error state with a retry.
- 
Keyboard: all actions reachable by tab, visible focus rings, copy buttons announce "Copied" to screen readers.
- 
Looks right at 1280 × 720 (the recording size) and remains usable at 390 px wide.
- 
No console errors or warnings in a production build.
- 
Before calling the UI done, open each route in a browser at 1280 × 720 and compare it against this section.

## 10. Build order
Eight milestones, each with a check that must pass before the next begins. Milestones 0 to 5 are the product; 6 and 7 make it presentable.
#
Milestone
Acceptance check
0
Scaffold: workspaces, TypeScript, lint, Vitest, an empty template.yaml
npm test and sam validate --lint both pass
1
Lantern Books checkout and PayMock, with the seeded bug, prod and staging functions, API key check
Unit tests show the READ15 + UPI cart returns 500 and the same cart with card returns 200. sam local invoke works for both
2
Shared redaction and fingerprint code, then the withTrace2Test wrapper
All redaction tests in section 5 pass. Wrapping the checkout handler produces the capture shape exactly
3
Ingest endpoint, DynamoDB table, data bucket, duplicate handling
Posting a capture to a local invoke of ingest writes the raw object and the incident item (verified against mocked AWS clients)
4
The five task Lambdas and pipeline.asl.json
Each task has unit tests. The state machine definition passes sam validate. A local script runs the five tasks in sequence against in-memory fakes and ends with a test file
5
Test generator hardening and the read API, verify and demo trigger endpoints
Section 8's four generator tests pass. Every endpoint in section 6 has a handler test, including the 401 paths
6
React dashboard, all four routes, against a mock API first and then the real one
npm run build has no errors or warnings. Each route matches section 9 at 1280 × 720
7
Deployment polish and documents
A fresh clone deploys with the README's commands alone. scripts/trigger-bug.sh produces a TEST_READY incident in under 30 seconds
After the user's first deploy, verify in this order
- 
scripts/trigger-bug.sh returns 500 from shop-prod.
- 
Within 30 seconds the incident reaches TEST_READY, and the Step Functions console shows a green execution.
- 
Download the test and run it against staging: it fails.
- 
Apply the fix (use Math.round in the UPI path) to staging only, redeploy, and run the test again: it passes.
- 
Press "Re-run against staging" in the dashboard: the incident becomes FIXED.
- 
Trigger the bug three more times: no new incident appears, and the occurrence count rises to 4.
Deploying the fix to staging only
The checkout code reads a FIX_UPI_ROUNDING environment variable. Staging sets it through a SAM parameter, StagingHasFix, defaulting to false. The demo flips that parameter and redeploys. This keeps production broken and staging fixed without maintaining two code branches. Explain this plainly in the README; it is a demo device, not a product feature.
Details that are easy to miss
- 
Add a ProdApiKey SAM parameter alongside StagingApiKey. The browser never holds either key.
- 
The /shop page does not call shop-prod directly. It posts the cart to POST /demo/trigger, which forwards it to shop-prod with the production key and relays the status and body. With no body, that endpoint sends the seeded failing cart.
- 
Set CloudWatch log retention to 7 days on every function.
- 
Give every function its own IAM role with only the actions and resources it needs.

## 11. Guardrails
These rules override convenience. If a milestone cannot be met without breaking one, stop and record the problem in docs/decisions.md.
Out of scope
- 
Other languages, frameworks or test runners. Node.js Lambda handlers and Jest only.
- 
Browser session recording, or capturing successful requests.
- 
Replaying anything against production.
- 
AI-generated code, explanations or automatic fixes.
- 
Reproducing bugs that depend on database state, timing or concurrency. Mark those NOT_REPRODUCED with an honest reason.
- 
User accounts, teams or roles. One shared dashboard token is enough.
Privacy and security
- 
Unredacted data never leaves the wrapped service. The raw object in S3 has already been through the first redaction pass and is deleted by Sanitize.
- 
Never log request bodies, headers or tokens. Log incident IDs, state names and durations only.
- 
Replay targets come from stack configuration only (section 7).
- 
Staging never captures, so a replayed failure cannot create a new incident and loop.
- 
Replayed requests carry x-t2t-replay, so the checkout service can label the resulting staging orders.
- 
No secrets in the repository. All three keys and the dashboard token are NoEcho parameters.
- 
Both buckets block public access and enforce TLS. The dashboard is reachable only through CloudFront.
- 
Escape everything rendered in the dashboard. Captured strings are untrusted input: render them as text, never as HTML.
Cost
- 
DynamoDB on-demand; Lambda at 256 MB on arm64 with 10 to 15 second timeouts; no provisioned concurrency.
- 
No VPC, NAT gateway, load balancer, OpenSearch, Kinesis or scheduled polling.
- 
API Gateway throttling on ingest, plus fingerprint de-duplication, cap what a failure storm can cost.
- 
30-day expiry on incident data and 7-day log retention.
- 
The README states the idle cost plainly: nothing runs when nothing fails. Storage of the small static site and any retained incidents is the only standing cost.
Honesty in everything written
- 
The README says what Trace2Test reproduces (deterministic HTTP failures) and what it does not.
- 
It names the nearest existing tools the user confirms after checking, and says how this differs: capture only on failure, redaction before storage, a portable test as the output, one-command serverless deploy.
- 
No statistic, quote or timing appears unless the user measured it or supplied a source.

## 12. Submission deliverables
Four documents ship with the code, and each maps to something the contest asks for.
README.md
- 
The problem in three sentences, told through the Lantern Books customer complaint.
- 
What Trace2Test does: the six steps from capture to verified fix.
- 
The architecture diagram and the table of what each AWS service does.
- 
Quick start: prerequisites, sam build && sam deploy --guided, scripts/deploy-web.sh, scripts/trigger-bug.sh.
- 
How to add it to your own Lambda: the three-line wrapper snippet.
- 
How the pattern can be reused: the SAM template, the direct DynamoDB integrations, the two-mode state machine.
- 
Scale to zero: what runs when idle (nothing) and what is stored.
- 
Limits: what it does not reproduce.
- 
Measured impact: the table from docs/impact.md.
docs/architecture.md
A Mermaid flowchart matching section 3, plus a screenshot placeholder for the Step Functions execution graph. Keep service names exactly as AWS writes them.
docs/impact.md
A protocol the user follows and a results table with empty cells. Do not fill the manual column.
Metric
How it is measured
Manual
With Trace2Test
Time to reproduce
Stopwatch, from reading the complaint to seeing the failure locally; three runs
user fills
from steps timings
Time to a regression test
Stopwatch to a failing test that targets the bug
user fills
capture-to-test time from the dashboard
Reproduction rate
Reproduced incidents ÷ replayable incidents
not applicable
from GET /metrics
Sensitive values left after redaction
Leak scan count across all bundles
not applicable
from GET /metrics
State the sample size beside every number. One seeded bug timed three times is a demonstration, not a study, and the README should say so.
docs/demo-script.md
A shot list for a video under three minutes, recorded at 1280 × 720.
Time
On screen
Narration covers
0:00 to 0:25
/shop: pay with READ15 and UPI, see the error. Then pay by card: it works
A customer hits a bug the team cannot reproduce
0:25 to 0:55
Dashboard list: the incident appears. Open it; the stepper fills in
The failure was captured as it happened; the pipeline runs on its own
0:55 to 1:20
Captured request panel with redaction chips; then the Step Functions execution graph
Email and key were redacted before leaving the service; five services, no servers
1:20 to 1:45
Production vs staging panel: both 500
The failure is reproduced on staging
1:45 to 2:25
Terminal: run the generated test (red). Flip the fix on staging, redeploy (cut), run again (green)
The output is a real test, and it proves the fix
2:25 to 2:45
Dashboard: "Re-run against staging", status turns Fixed
The loop is closed
2:45 to 3:00
Architecture diagram and the measured numbers
Idle cost, reuse in three lines, link to the repo
Final check before submitting
- 
A fresh clone deploys using only the README.
- 
The video is public, under three minutes, and shows the build running end to end.
- 
Every number in the README was measured by the user or has a checked source.
- 
The project has not been published anywhere before submission.
- 
The write-up names the serverless services used and how they connect.