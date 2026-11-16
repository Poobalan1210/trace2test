import { useState, type ReactNode } from 'react';
import { DEFAULT_RULES, DROPPED_HEADERS, TEST_CARD, TEST_PHONE } from '@shared/rules';
import { CodeView } from '../components/CodeView';
import { CopyButton } from '../components/CopyButton';

const CONFIG = `{
  ingestUrl: process.env.T2T_INGEST_URL,
  ingestKey: process.env.T2T_INGEST_KEY,
  service: 'orders',             // lowercase name; keys replay targets and delivery
  stage: process.env.STAGE,      // 'prod' or 'production' captures; nothing else does
}`;

const SNIPPETS: Record<string, string> = {
  Lambda: `import { withTrace2Test } from '@trace2test/sdk';

// API Gateway HTTP and REST APIs, function URLs and ALB targets.
export const handler = withTrace2Test(realHandler, ${CONFIG});
`,
  Express: `import express from 'express';
import { trace2testExpress } from '@trace2test/sdk';

const t2t = trace2testExpress(${CONFIG});
const app = express();
app.use(t2t.capture);        // first
app.use(express.json());
// ...your routes...
app.use(t2t.recordErrors);   // after the routes, before your error handler
`,
  Fastify: `import Fastify from 'fastify';
import { trace2testFastify } from '@trace2test/sdk';

const app = Fastify();
trace2testFastify(app, ${CONFIG});   // before registering routes
`,
};

const SIDE_EFFECTS = `import { isReplay } from '@trace2test/sdk';

// Replays carry an x-t2t-replay header. Run the code path, skip the side effect.
if (!isReplay(event)) await sendReceiptEmail(order);
`;

const ENV = [
  ['T2T_INGEST_URL', 'Stack output IngestUrl.'],
  ['T2T_INGEST_KEY', 'The IngestKey parameter you deployed with.'],
  ['STAGE', 'prod or production to capture. Any other value turns capture off, so staging never captures its own replays.'],
];

const STACK = [
  ['ReplayTargets', '{"orders":{"baseUrl":"https://staging.example.com","routes":{"POST":["/orders"]}}}', 'Where each service’s failures are replayed, and which routes are safe to send. Services without one still get a test, marked unverified.'],
  ['StagingApiKey', 'optional', 'Sent as x-api-key on every replay.'],
  ['DeliveryTargets', '{"orders":{"repo":"acme/orders","testDir":"regression"}}', 'Opens each new test as a pull request in that repository, and comments when the fix is verified.'],
  ['GitHubTokenParameter', '/trace2test/github-token', 'An SSM SecureString holding a fine-grained token with Contents and Pull requests (read and write) on those repositories.'],
];

const REPLACEMENTS = [
  ['Email', 'user_<4 hex>@redacted.example, stable per address so equal emails stay equal'],
  ['Card number', `${TEST_CARD} (13 to 19 digits that pass the Luhn check)`],
  ['Phone', TEST_PHONE],
  ['Keys, tokens, passwords, cookies', '[REDACTED:<type>]'],
];

function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-panel">
      <header className="flex min-h-12 items-center justify-between border-b border-line px-5 py-2.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Install() {
  const [tab, setTab] = useState('Lambda');
  const code = SNIPPETS[tab];
  return (
    <Card
      title="Install"
      aside={<CopyButton text={code} />}
    >
      <p className="font-mono text-[13px] text-ink">npm install @trace2test/sdk</p>
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
      <div role="tabpanel" className="-mx-5 -mb-5 mt-3 bg-bg"><CodeView key={tab} code={code} language="typescript" label={`${tab} snippet`} /></div>
    </Card>
  );
}

export function SetupPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="kicker">Setup</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-[1.25] tracking-[-0.015em] sm:text-[32px]">Add Trace2Test to your service</h1>
        <p className="mt-2 text-[15px] text-body">Add the SDK to a Node.js service on Lambda, Express or Fastify. Nothing else in your code changes, and successful requests are never recorded.</p>
      </div>

      <Install />

      <Card title="Skip side effects on replay" aside={<CopyButton text={SIDE_EFFECTS} />}>
        <p className="mb-3 text-muted">Trace2Test replays failed requests on staging. If staging sends real emails, charges or webhooks, guard them.</p>
        <div className="-mx-5 -mb-5 bg-bg"><CodeView code={SIDE_EFFECTS} language="typescript" label="isReplay snippet" /></div>
      </Card>

      <Card title="Environment">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[180px_1fr]">
          {ENV.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-[13px] text-ink">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Stack parameters">
        <p className="mb-3 text-muted">Set when deploying <span className="font-mono text-[13px]">template.yaml</span>. All optional; with none, every failure still gets a redacted capture and a test.</p>
        <dl className="space-y-3">
          {STACK.map(([k, example, v]) => (
            <div key={k}>
              <dt className="font-mono text-[13px] text-ink">{k}</dt>
              <dd className="text-muted">{v}</dd>
              <dd className="mt-1 overflow-x-auto whitespace-nowrap rounded border border-line bg-bg px-2 py-1 font-mono text-[12px] text-muted">{example}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Active redaction rules">
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
              <tr key={k}><th scope="row" className="w-48 py-1.5 pr-4 font-normal text-ink">{k}</th><td className="py-1.5 font-mono text-[12px] text-muted">{v}</td></tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 text-[12px] font-medium uppercase tracking-wide text-muted">Headers dropped entirely</h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {DROPPED_HEADERS.map((h) => <li key={h} className="rounded border border-line bg-bg px-2 py-0.5 font-mono text-[12px]">{h}</li>)}
        </ul>
        <p className="mt-4 text-[13px] text-muted">Redactions are recorded by path and type only. The original value, a prefix of it, or its length is never stored.</p>
      </Card>

      <Card title="What it reproduces">
        <p className="text-muted">Deterministic HTTP failures: the same request fails the same way on staging. Failures that depend on database state, timing or concurrency are marked Not reproduced, with the reason.</p>
      </Card>
    </div>
  );
}
