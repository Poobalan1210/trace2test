# Architecture

A failure flows one way: the capture wrapper, the ingest API, the Step Functions workflow, then the dashboard reads the result.

```mermaid
flowchart TB
  customer([Customer]) --> shopProd["Amazon API Gateway<br/>shop-prod"]
  shopProd --> checkoutProd["AWS Lambda<br/>checkout (prod)<br/>withTrace2Test()"]
  checkoutProd -- "lambda:Invoke" --> paymock["AWS Lambda<br/>PayMock"]
  checkoutProd -- "on 5xx or thrown error:<br/>redact, then POST the capture" --> t2tApi["Amazon API Gateway<br/>t2t-api"]

  t2tApi -- "POST /incidents" --> ingest["AWS Lambda<br/>ingest"]
  ingest -- "raw/{id}.json<br/>(expires in 1 day)" --> s3[("Amazon S3<br/>data bucket")]
  ingest -- "incident item, RECEIVED" --> ddb[("Amazon DynamoDB<br/>t2t table")]
  ingest -- "StartExecution" --> sfn

  subgraph sfn["AWS Step Functions: t2t-pipeline (Standard)"]
    direction LR
    sanitize[Sanitize] --> validate[Validate] --> replay[Replay] --> compare[Compare] --> generate[GenerateTest] --> save["SaveResult<br/>(direct DynamoDB)"]
  end

  sanitize -- "bundle.json" --> s3
  replay -- "x-t2t-replay" --> shopStaging["Amazon API Gateway<br/>shop-staging"] --> checkoutStaging["AWS Lambda<br/>checkout (staging)"]
  checkoutStaging --> paymock
  generate -- "<name>.test.js" --> s3
  save --> ddb

  browser([Developer's browser]) --> cf["Amazon CloudFront"] --> web[("Amazon S3<br/>dashboard bucket")]
  browser -- "GET /incidents, GET /incidents/{id},<br/>POST /incidents/{id}/verify, GET /metrics" --> t2tApi
  t2tApi --> apiFn["AWS Lambda<br/>dashboard API"]
  apiFn --> ddb
  apiFn --> s3
  apiFn -- "verify: StartExecution" --> sfn
```

## What each service does

| Service | Job in this build |
| --- | --- |
| Amazon API Gateway (HTTP API) | Three APIs: shop-prod, shop-staging, and t2t-api for ingest and the dashboard. Ingest is throttled at 10 requests per second, burst 20. |
| AWS Lambda | Checkout (prod and staging), PayMock, ingest, the five workflow tasks, and the dashboard API. arm64, 256 MB. |
| AWS Step Functions (Standard) | Runs the pipeline in two modes (capture and verify), with retries, choice states and a catch-all failure path. |
| Amazon S3 | Raw captures (1-day expiry), sanitized bundles, replay results and generated tests (30 days), plus the dashboard's static files. |
| Amazon DynamoDB (on-demand) | Incident metadata, per-step timings, fingerprint counts and metrics. TTL removes items after 30 days. |
| Amazon CloudFront | HTTPS in front of the private dashboard bucket, with origin access control. |

## The workflow

```mermaid
stateDiagram-v2
  [*] --> ModeChoice
  ModeChoice --> Sanitize: capture
  ModeChoice --> Replay: verify
  Sanitize --> Validate
  Validate --> ReplayableChoice
  ReplayableChoice --> MarkNotReplayable: no
  ReplayableChoice --> Replay: yes
  Replay --> Compare
  Compare --> AfterCompare
  AfterCompare --> VerdictChoice: capture
  AfterCompare --> SaveVerifyResult: verify
  VerdictChoice --> GenerateTest: REPRODUCED
  VerdictChoice --> NoTest: NOT_REPRODUCED
  GenerateTest --> SaveResult
  NoTest --> SaveResult
  SaveResult --> SaveMetrics
  SaveVerifyResult --> FixedChoice
  FixedChoice --> MarkFirstFix: FIXED
  MarkFirstFix --> CountFix
  MarkNotReplayable --> [*]
  SaveMetrics --> [*]
  CountFix --> [*]
  FixedChoice --> [*]: STILL_FAILING
```

Any unhandled error in any task goes to `MarkPipelineFailed`, then to a `Fail` state. `SaveResult`, `SaveMetrics`, `SaveVerifyResult`, `MarkFirstFix`, `CountFix`, `MarkNotReplayable` and `MarkPipelineFailed` are direct DynamoDB integrations, with no Lambda in between.

## Step Functions execution graph

<!-- SCREENSHOT: after the first deploy, run scripts/trigger-bug.sh, open the execution in the Step Functions console, and save the graph view here as docs/execution-graph.png. -->

_Screenshot to be added after the first deployment._
