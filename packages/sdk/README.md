# @trace2tests/sdk

Captures failed HTTP requests in production for [Trace2Test](https://github.com/Poobalan1210/trace2test), with private data redacted inside your service before anything is sent. Trace2Test then replays the request on staging, writes a Jest regression test and opens a pull request with it.

- Records only failures: a thrown error or a 5xx. Successful requests cause no network call.
- Redacts emails, card numbers, phone numbers, tokens, keys and passwords in place, with valid stand-ins, so the request can still be replayed.
- Never changes your response and never throws.
- No runtime dependencies. Node.js 18 or later, ESM and CommonJS.

You need a deployed Trace2Test stack. Its `IngestUrl` output and `IngestKey` parameter go into the config below.

## Install

```bash
npm install @trace2tests/sdk
```

```ts
const config = {
  ingestUrl: process.env.T2T_INGEST_URL,
  ingestKey: process.env.T2T_INGEST_KEY,
  service: 'orders',          // lowercase; Trace2Test keys replay targets and delivery by it
  stage: process.env.STAGE,   // 'prod' or 'production' captures; nothing else does
};
```

### AWS Lambda

API Gateway HTTP APIs and REST APIs, function URLs and ALB targets.

```ts
import { withTrace2Test } from '@trace2tests/sdk';

export const handler = withTrace2Test(realHandler, config);
```

The wrapper sends the capture before returning, because Lambda freezes once the handler returns. It waits at most `timeoutMs` (1.5 s by default). If your handler answers unexpected errors with its own 500, return `serverError(err)` so the capture still records the error:

```ts
import { serverError } from '@trace2tests/sdk';

try { /* ... */ } catch (err) { return serverError(err); } // 500 {"error":"Internal error"}
```

### Express

```ts
import { trace2testExpress } from '@trace2tests/sdk';

const t2t = trace2testExpress(config);
app.use(t2t.capture);       // first
app.use(express.json());
// ...your routes...
app.use(t2t.recordErrors);  // after the routes, before your error handler
```

### Fastify

```ts
import { trace2testFastify } from '@trace2tests/sdk';

trace2testFastify(app, config); // on the root instance, before registering routes
```

On Express and Fastify the capture is sent after the response has gone out, so it adds no latency. The request body is whatever the framework parsed.

## Skipping side effects on replay

Trace2Test replays failed requests on staging with an `x-t2t-replay` header. Run the code path, but skip what should not happen twice:

```ts
import { isReplay } from '@trace2tests/sdk';

if (!isReplay(req)) await sendReceiptEmail(order); // a Lambda event, an Express or Fastify request
```

## Options

| Option | Default | |
| --- | --- | --- |
| `ingestUrl`, `ingestKey` | | Required to capture. Without them nothing is sent. |
| `service` | | Lowercase letters, digits and dashes. |
| `stage` | | `prod` or `production` captures. |
| `enabled` | | Overrides the stage check. |
| `redact.keys` | see `/setup` on your dashboard | Field and header names to redact at any depth, ignoring case. |
| `redact.patterns` | `email`, `card`, `jwt`, `bearer` | Patterns to redact inside every string. |
| `maxBodyBytes` | 262144 | Larger or non-JSON bodies are not captured. |
| `timeoutMs` | 1500 | Budget for sending a capture. |
| `codeVersion` | `AWS_LAMBDA_FUNCTION_VERSION` | Recorded with the capture. |
| `log` | `console.warn` | Called when a capture could not be sent. |
