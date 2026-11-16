import { useState, type ReactNode } from 'react';
import { DEFAULT_RULES, DROPPED_HEADERS, TEST_CARD, TEST_PHONE } from '@shared/rules';
import { CodeView } from '../components/CodeView';
import { CopyButton } from '../components/CopyButton';

const REPO = 'https://github.com/Poobalan1210/trace2test';

const RESOURCES = [
  ['Source code', 'GitHub, MIT licensed', REPO],
  ['SDK', '@trace2tests/sdk on npm', 'https://www.npmjs.com/package/@trace2tests/sdk'],
  ['Demo video', '2½ minutes, on YouTube', 'https://youtu.be/jumX9CLc3Ew'],
  ['Write-up', 'How it works and why', `${REPO}/blob/main/docs/blog.md`],
];

const DEPLOY = `git clone ${REPO}.git
cd trace2test && npm ci
export AWS_REGION=us-east-1          # any region with Step Functions

scripts/new-secrets.sh               # writes IngestKey and DashboardToken to .env
sam build
sam deploy --parameter-overrides $(scripts/params.sh)
scripts/deploy-web.sh                # uploads this dashboard, prints its URL

scripts/outputs.sh IngestUrl         # the SDK posts failures here
`;

const CONFIG = `{
  ingestUrl: process.env.T2T_INGEST_URL,
  ingestKey: process.env.T2T_INGEST_KEY,
  service: 'orders',             // lowercase name; keys replay targets and delivery
  stage: process.env.STAGE,      // 'prod' or 'production' captures; nothing else does
}`;

const SNIPPETS: Record<string, string> = {
  Lambda: `import { withTrace2Test } from '@trace2tests/sdk';

// API Gateway HTTP and REST APIs, function URLs and ALB targets.
export const handler = withTrace2Test(realHandler, ${CONFIG});
`,
  Express: `import express from 'express';
import { trace2testExpress } from '@trace2tests/sdk';

const t2t = trace2testExpress(${CONFIG});
const app = express();
app.use(t2t.capture);        // first
app.use(express.json());
// ...your routes...
app.use(t2t.recordErrors);   // after the routes, before your error handler
`,
  Fastify: `import Fastify from 'fastify';
import { trace2testFastify } from '@trace2tests/sdk';

const app = Fastify();
trace2testFastify(app, ${CONFIG});   // before registering routes
`,
};

const SIDE_EFFECTS = `import { isReplay } from '@trace2tests/sdk';

// Replays carry an x-t2t-replay header. Run the code path, skip the side effect.
if (!isReplay(event)) await sendReceiptEmail(order);
`;

const STAGING_ENV = `# .env (gitignored), then redeploy
REPLAY_TARGETS='{"orders":{"baseUrl":"https://staging.example.com","routes":{"POST":["/orders"]}}}'
STAGING_API_KEY=...                  # optional, sent as x-api-key on every replay
`;

const GITHUB_ENV = `aws ssm put-parameter --type SecureString \\
  --name /trace2test/github-token --value <fine-grained token>

# .env, then redeploy
DELIVERY_TARGETS='{"orders":{"repo":"acme/orders","testDir":"regression"}}'
GITHUB_TOKEN_PARAMETER=/trace2test/github-token
`;

const REDEPLOY = `sam build && sam deploy --parameter-overrides $(scripts/params.sh)`;

const RUN_TEST = `T2T_TARGET_URL=https://staging.example.com \\
T2T_TARGET_API_KEY=<staging key> \\
npx jest regression/orders-500-a41f9c.test.js
`;

const ENV = [
  ['T2T_INGEST_URL', 'Stack output IngestUrl.'],
  ['T2T_INGEST_KEY', 'INGEST_KEY from .env, the IngestKey you deployed with.'],
  ['STAGE', 'prod or production to capture. Any other value turns capture off, so staging never captures its own replays.'],
];

const STACK = [
  ['ReplayTargets', '{"orders":{"baseUrl":"https://staging.example.com","routes":{"POST":["/orders"]}}}', 'Where each service’s failures are replayed, and which routes are safe to send. Services without one still get a test, marked unverified.'],
  ['StagingApiKey', 'optional', 'Sent as x-api-key on every replay.'],
  ['DeliveryTargets', '{"orders":{"repo":"acme/orders","testDir":"regression"}}', 'Opens each new test as a pull request in that repository, and comments when the fix is verified. Also takes baseBranch and draft.'],
  ['GitHubTokenParameter', '/trace2test/github-token', 'An SSM SecureString holding a fine-grained token with Contents and Pull requests (read and write) on those repositories.'],
  ['GitHubApiUrl', 'https://github.example.com/api/v3', 'Only for GitHub Enterprise Server.'],
];

const OPTIONS = [
  ['ingestUrl, ingestKey', 'Required to capture. Without them nothing is sent.'],
  ['service', 'Lowercase letters, digits and dashes.'],
  ['stage', 'prod or production captures.'],
  ['enabled', 'Overrides the stage check.'],
  ['redact.keys', 'Extra field and header names to redact at any depth, ignoring case.'],
  ['redact.patterns', 'Patterns to redact inside every string. Default: email, card, jwt, bearer.'],
  ['maxBodyBytes', '262144. Larger or non-JSON bodies are not captured.'],
  ['timeoutMs', '1500. Budget for sending a capture.'],
  ['codeVersion', 'Defaults to AWS_LAMBDA_FUNCTION_VERSION. Recorded with the capture.'],
  ['log', 'Defaults to console.warn. Called when a capture could not be sent.'],
];

const REPLACEMENTS = [
  ['Email', 'user_<4 hex>@redacted.example, stable per address so equal emails stay equal'],
  ['Card number', `${TEST_CARD} (13 to 19 digits that pass the Luhn check)`],
  ['Phone', TEST_PHONE],
  ['Keys, tokens, passwords, cookies', '[REDACTED:<type>]'],
];

const TOC = [
  ['how', 'How it works'],
  ['deploy', '1. Deploy the stack'],
  ['sdk', '2. Add the SDK'],
  ['staging', '3. Connect staging'],
  ['github', '4. Pull requests'],
  ['verify', '5. Run and verify'],
  ['options', 'SDK options'],
  ['redaction', 'Redaction rules'],
  ['limits', 'Limits'],
  ['resources', 'Resources'],
];

function Card({ id, title, children, aside }: { id?: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-panel border border-line bg-panel">
      <header className="flex min-h-12 items-center justify-between border-b border-line px-5 py-2.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Code({ code, language = 'bash', label }: { code: string; language?: string; label: string }) {
  return (
    <div className="mt-3 overflow-hidden rounded border border-line bg-bg">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[12px] text-muted">{label}</span>
        <CopyButton text={code} />
      </div>
      <CodeView code={code} language={language} label={label} />
    </div>
  );
}

function Install() {
  const [tab, setTab] = useState('Lambda');
  const code = SNIPPETS[tab];
  return (
    <Card id="sdk" title="2. Add the SDK to your service" aside={<CopyButton text={code} />}>
      <p className="text-muted">Node.js 18 or later, no runtime dependencies. Successful requests are never recorded, and the SDK never changes your response or throws.</p>
      <p className="mt-3 font-mono text-[13px] text-ink">npm install @trace2tests/sdk</p>
      <div role="tablist" aria-label="Framework" className="mt-4 flex gap-1">
        {Object.keys(SNIPPETS).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-[13px] transition-state ${t === tab ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="-mx-5 mt-3 bg-bg"><CodeView key={tab} code={code} language="typescript" label={`${tab} snippet`} /></div>
      <h3 className="mt-5 text-[12px] font-medium uppercase tracking-wide text-muted">Environment variables</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[160px_1fr]">
        {ENV.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-[13px] text-ink">{k}</dt>
            <dd className="text-muted">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-muted">Deploy, then make a request fail in production. It appears under <b className="font-medium text-ink">Failures</b> within seconds, redacted, with a test. Without step 3 the test is marked <i>unverified</i>.</p>
    </Card>
  );
}

export function DocsPage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_200px]">
      <div className="min-w-0 max-w-3xl space-y-6">
        <div>
          <p className="kicker">Docs</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-[1.25] tracking-[-0.015em] sm:text-[32px]">Add Trace2Test to your service</h1>
          <p className="mt-2 text-[15px] text-body">Deploy the stack to your AWS account, wrap your handler, and every request that fails in production becomes a redacted capture and a regression test. Steps 3 and 4 are optional.</p>
        </div>

        <Card id="how" title="How it works">
          <ol className="list-decimal space-y-1.5 pl-5 text-muted">
            <li><b className="font-medium text-ink">Capture.</b> The SDK records a request only when it throws or answers 5xx, and redacts private data inside your service before sending it.</li>
            <li><b className="font-medium text-ink">Sanitize.</b> The pipeline redacts again and counts anything the SDK missed as a leak.</li>
            <li><b className="font-medium text-ink">Replay.</b> The request is sent to your staging copy, on routes you allow, with an <code className="font-mono text-[13px]">x-t2t-replay</code> header. Never to production.</li>
            <li><b className="font-medium text-ink">Test.</b> If staging fails the same way, a Jest test is written from a fixed template, and optionally opened as a pull request.</li>
            <li><b className="font-medium text-ink">Verify.</b> After your fix reaches staging, <i>Re-run on staging</i> replays the request; a 2xx marks the incident Fixed.</li>
          </ol>
          <p className="mt-3 text-[13px] text-muted">You need an AWS account with the <a className="text-amber hover:underline" href="https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html" target="_blank" rel="noreferrer">SAM CLI</a>, Node.js 18+, and a Node.js service on Lambda, Express or Fastify.</p>
        </Card>

        <Card id="deploy" title="1. Deploy the Trace2Test stack">
          <p className="text-muted">One stack in your own account: API Gateway, Lambda, Step Functions, DynamoDB, S3 and CloudFront. It scales to zero when nothing fails.</p>
          <Code code={DEPLOY} label="Deploy commands" />
          <p className="mt-3 text-[13px] text-muted">Keep <code className="font-mono">.env</code>: it holds the ingest key your services send and the token this dashboard asks for.</p>
        </Card>

        <Install />

        <Card id="staging" title="3. Connect a staging copy (optional)">
          <p className="text-muted">Replay proves the bug is real before a test is written. Add your staging URL and the routes that are safe to replay, then redeploy.</p>
          <Code code={STAGING_ENV} label="Staging settings" />
          <Code code={REDEPLOY} label="Redeploy" />
          <p className="mt-4 text-muted">Staging runs the same code path, so guard side effects that must not happen twice:</p>
          <Code code={SIDE_EFFECTS} language="typescript" label="isReplay snippet" />
        </Card>

        <Card id="github" title="4. Get tests as pull requests (optional)">
          <p className="text-muted">Store a fine-grained GitHub token with <i>Contents</i> and <i>Pull requests</i> (read and write) on the repository, name the repository per service, and redeploy. Each new test arrives on its own branch, with the redacted request in the description.</p>
          <Code code={GITHUB_ENV} label="GitHub settings" />
        </Card>

        <Card id="verify" title="5. Run the test and verify the fix">
          <p className="text-muted">Download the test from the incident page, or take it from the pull request. It fails while the bug is there and is skipped when <code className="font-mono text-[13px]">T2T_TARGET_URL</code> is not set.</p>
          <Code code={RUN_TEST} label="Run the test" />
          <p className="mt-3 text-muted">Fix the bug and deploy it to staging, then press <b className="font-medium text-ink">Re-run on staging</b> on the incident. Trace2Test replays the same request; when staging answers 2xx the incident is marked Fixed and the pull request gets a comment.</p>
        </Card>

        <Card id="options" title="SDK options">
          <table className="w-full text-left">
            <tbody className="divide-y divide-line">
              {OPTIONS.map(([k, v]) => (
                <tr key={k}><th scope="row" className="w-32 py-1.5 pr-4 align-top font-mono text-[12.5px] font-normal text-ink [overflow-wrap:anywhere] sm:w-44">{k}</th><td className="py-1.5 text-muted [overflow-wrap:anywhere]">{v}</td></tr>
              ))}
            </tbody>
          </table>
          <h3 className="mt-5 text-[12px] font-medium uppercase tracking-wide text-muted">Stack parameters</h3>
          <dl className="mt-2 space-y-3">
            {STACK.map(([k, example, v]) => (
              <div key={k}>
                <dt className="font-mono text-[13px] text-ink">{k}</dt>
                <dd className="text-muted">{v}</dd>
                <dd className="mt-1 overflow-x-auto whitespace-nowrap rounded border border-line bg-bg px-2 py-1 font-mono text-[12px] text-muted">{example}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card id="redaction" title="Redaction rules">
          <p className="text-muted">Applied twice: inside your service before the capture is sent, and again by the Sanitize step, which counts anything the first pass missed as a leak.</p>
          <h3 className="mt-4 text-[12px] font-medium uppercase tracking-wide text-muted">Keys, at any depth, ignoring case</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {DEFAULT_RULES.keys.map((k) => <li key={k} className="rounded border border-line bg-bg px-2 py-0.5 font-mono text-[12px]">{k}</li>)}
          </ul>
          <h3 className="mt-4 text-[12px] font-medium uppercase tracking-wide text-muted">Patterns in every string</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {DEFAULT_RULES.patterns.map((k) => <li key={k} className="rounded border border-line bg-bg px-2 py-0.5 font-mono text-[12px]">{k}</li>)}
          </ul>
          <h3 className="mt-4 text-[12px] font-medium uppercase tracking-wide text-muted">Replacements keep values valid for replay</h3>
          <table className="mt-2 w-full text-left">
            <tbody className="divide-y divide-line">
              {REPLACEMENTS.map(([k, v]) => (
                <tr key={k}><th scope="row" className="w-32 py-1.5 pr-4 align-top font-normal text-ink sm:w-48">{k}</th><td className="py-1.5 font-mono text-[12px] text-muted [overflow-wrap:anywhere]">{v}</td></tr>
              ))}
            </tbody>
          </table>
          <h3 className="mt-4 text-[12px] font-medium uppercase tracking-wide text-muted">Headers dropped entirely</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {DROPPED_HEADERS.map((h) => <li key={h} className="rounded border border-line bg-bg px-2 py-0.5 font-mono text-[12px]">{h}</li>)}
          </ul>
          <p className="mt-4 text-[13px] text-muted">Redactions are recorded by path and type only. The original value, a prefix of it, or its length is never stored.</p>
        </Card>

        <Card id="limits" title="Limits">
          <ul className="list-disc space-y-1.5 pl-5 text-muted">
            <li>Node.js services, and JSON request bodies up to 256 KB.</li>
            <li>Deterministic HTTP failures: the same request fails the same way on staging. Failures that depend on database state, timing or concurrency are marked Not reproduced, with the reason.</li>
            <li>A 5xx is the signal. A wrong answer sent with a 200 is not caught.</li>
            <li>The test proves the server no longer errors on this request, not that the business answer is right.</li>
          </ul>
        </Card>

        <Card id="resources" title="Resources">
          <ul className="grid gap-3 sm:grid-cols-2">
            {RESOURCES.map(([title, sub, href]) => (
              <li key={href}>
                <a href={href} target="_blank" rel="noreferrer" className="block rounded border border-line bg-bg px-4 py-3 transition-state hover:border-muted">
                  <span className="block font-medium text-ink">{title} ↗</span>
                  <span className="text-[13px] text-muted">{sub}</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <nav aria-label="On this page" className="hidden lg:block">
        <div className="sticky top-24 text-[13px]">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">On this page</p>
          <ul className="space-y-1.5 border-l border-line">
            {TOC.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="-ml-px block border-l border-transparent pl-3 text-muted hover:border-muted hover:text-ink">{label}</a></li>
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}
