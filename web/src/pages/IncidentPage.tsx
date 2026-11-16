import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Download, GitPullRequest, Play, Quote, Wrench } from 'lucide-react';
import { useApi, useIsLocal, useStagingUrl } from '../api/context';
import type { DiffEntry, IncidentDetail, ReplayRecord } from '../api/types';
import { StatusPill, STATUS_MEANING, isLive, statusLabel } from '../components/StatusPill';
import { Stepper } from '../components/Stepper';
import { JsonView } from '../components/JsonView';
import { CodeView } from '../components/CodeView';
import { CopyButton } from '../components/CopyButton';
import { Bone } from '../components/Skeleton';
import { ErrorState, errorMessage } from '../components/ErrorState';
import { clockTime, duration } from '../lib/format';
import { narrate, placeholdersIn, REDACTION_NOUN, scenarioFor, valueAt } from '../lib/narrate';

const BACK = (
  <Link to="/incidents" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted transition-state hover:text-ink">
    <ArrowLeft size={14} aria-hidden="true" /> All failures
  </Link>
);

export function IncidentPage() {
  const { id = '' } = useParams();
  const api = useApi();

  const q = useQuery({
    queryKey: ['incident', id],
    queryFn: () => api.getIncident(id),
    refetchInterval: (query) => (query.state.data && !isLive(query.state.data.incident.status) ? false : 1500),
  });

  if (q.isPending) return <DetailSkeleton />;
  if (q.isError) {
    return (
      <div className="space-y-4">
        {BACK}
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      </div>
    );
  }

  const d = q.data;
  const inc = d.incident;
  const s = scenarioFor(inc);
  const n = narrate(d);

  return (
    <div className="space-y-7">
      {BACK}

      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusPill status={inc.status} size="md" />
          <span className="text-[14.5px] text-body">{STATUS_MEANING[inc.status]}</span>
        </div>
        <h1 className="break-words text-[28px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[32px]">{s ? s.title : `${inc.errorName}: ${inc.errorMessage}`}</h1>
        {s && (
          <p className="flex gap-2.5 text-[16px] italic text-body">
            <Quote size={15} aria-hidden="true" className="mt-1 shrink-0 text-amber" />
            {s.complaint}
          </p>
        )}
        <p className="flex flex-wrap gap-2 text-[12.5px] text-muted">
          <Meta mono>{inc.method} {inc.path}</Meta>
          <Meta mono>{inc.service}</Meta>
          <Meta>captured <time dateTime={inc.capturedAt} className="tnum">{clockTime(inc.capturedAt)}</time></Meta>
          <Meta>{inc.occurrences === 1 ? 'seen once' : `seen ${inc.occurrences} times`}</Meta>
        </p>
      </header>
      <p className="sr-only" aria-live="polite">Status: {statusLabel(inc.status)}</p>

      <div className="rounded-panel border border-line bg-panel px-5 py-5">
        <Stepper incident={inc} />
        {inc.status === 'PIPELINE_FAILED' && inc.failure && <p className="mt-3 font-mono text-[12px] text-danger">{inc.failure.error}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <section aria-labelledby="next-title" className="rounded-panel border border-amber/30 bg-panel bg-gradient-to-b from-amber/[0.07] to-transparent p-5 lg:sticky lg:top-20 lg:order-2">
        <h2 id="next-title" className="kicker">In short</h2>
        <p className="mt-2 text-[15px] leading-[23px] text-ink">{n.result}</p>
        <h3 className="mt-5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">What to do next</h3>
        <ol className="mt-3 space-y-2.5">
          {n.next.map((step, i) => (
            <li key={step} className="flex gap-2.5 text-[14px] leading-[21px] text-body">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-[11px] text-ink">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <ol className="min-w-0 space-y-5 lg:order-1">
        <Chapter n={1} title={s ? 'The customer’s checkout failed' : 'The request failed in production'}>
          <p>{n.happened}</p>
          {s && <p className="text-muted"><b className="font-medium text-ink">The real cause:</b> {s.cause}</p>}
        </Chapter>
        <Chapter n={2} title={`Private data was removed before it left ${s ? 'the shop' : inc.service}`}>
          <PrivacyChapter d={d} privacy={n.privacy} />
        </Chapter>
        <Chapter n={3} title={inc.replayable === false ? 'It was not replayed on staging' : 'Trace2Test sent the same request to staging'}>
          <CompareChapter d={d} />
        </Chapter>
        <Chapter n={4} title={inc.testKey ? 'A test was written for it' : 'A test is written only when staging fails too'}>
          <TestChapter d={d} />
        </Chapter>
        <Chapter n={5} title="Fix the bug and check it">
          <VerifyChapter d={d} />
        </Chapter>
      </ol>
      </div>
    </div>
  );
}

function Meta({ mono, children }: { mono?: boolean; children: ReactNode }) {
  return <span className={`rounded-md border border-line bg-panel px-2 py-0.5 ${mono ? 'font-mono' : ''}`}>{children}</span>;
}

function Chapter({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="min-w-0 rounded-panel border border-line bg-panel">
      <h2 className="flex items-center gap-3 border-b border-line px-5 py-4 text-[16px] font-semibold">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber/25 bg-amber-soft font-mono text-[12.5px] text-amber">{n}</span>
        {title}
      </h2>
      <div className="space-y-4 p-5 text-[14.5px] leading-[22px] text-body">{children}</div>
    </li>
  );
}

/** Collapsed raw detail: there for developers, out of the way for everyone else. */
function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] text-muted hover:text-ink">
        <ChevronDown size={14} aria-hidden="true" className="transition-transform group-open:rotate-180" />
        {label}
      </summary>
      <div className="space-y-3 border-t border-line p-3">{children}</div>
    </details>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="space-y-2" aria-busy="true">
      <p className="text-muted">{text}</p>
      <Bone className="h-3 w-2/3" /><Bone className="h-3 w-1/2" />
    </div>
  );
}

function PrivacyChapter({ d, privacy }: { d: IncidentDetail; privacy: string | null }) {
  const req = d.request;
  if (!req) return <Waiting text="Cleaning the captured request…" />;
  return (
    <>
      <p>{privacy}</p>
      {d.incident.leakCount > 0 && <p className="text-muted">A second check inside Trace2Test caught {d.incident.leakCount} more and removed them too.</p>}
      {req.redactions.length > 0 && <RedactionTable d={d} />}
      <More label="Show the exact request that was kept (headers and body)">
        {Object.keys(req.query).length > 0 && <Block label="Query"><JsonView value={req.query} basePath="request.query" redactions={req.redactions} /></Block>}
        <Block label="Headers"><JsonView value={req.headers} basePath="request.headers" redactions={req.redactions} /></Block>
        <Block label="Body">
          {req.bodyOmitted ? <p className="text-muted">Body omitted: it was too large or not JSON.</p> : <JsonView value={req.body} basePath="request.body" redactions={req.redactions} />}
        </Block>
      </More>
    </>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">{label}</h3>
      <div className="rounded-lg border border-line bg-bg px-3 py-2">{children}</div>
    </div>
  );
}

const diffPaths = (diff: DiffEntry[] | undefined, side: 'prod' | 'staging') =>
  new Set((diff ?? []).filter((e) => e.kind === 'changed' || (side === 'prod' ? e.kind === 'removed' : e.kind === 'added')).map((e) => e.path));

function CompareChapter({ d }: { d: IncidentDetail }) {
  const record = d.replay;
  const staging = record && 'status' in record.staging ? record.staging : null;
  const prod = d.production;

  if (d.incident.status === 'NOT_REPLAYABLE') return <p>It was not sent: {d.incident.reason}.</p>;
  if (d.incident.replayable === false) {
    return <p>It was not sent: {d.incident.reason}. Trace2Test only replays on a staging target you configure, for routes you allow.</p>;
  }
  if (!prod || !record) return <Waiting text="Sending it to staging…" />;

  const reproduced = record.verdict === 'REPRODUCED';
  return (
    <>
      <p className={`text-[16px] font-medium ${reproduced ? 'text-danger' : 'text-ink'}`}>
        {reproduced
          ? `Staging failed too (${staging?.status}). The bug is real and can be reproduced.`
          : `Staging did not fail (${staging?.status ?? 'no answer'}). The bug did not happen there.`}
      </p>
      <p className="text-muted">
        {reproduced
          ? 'Production and staging gave the same error for the same request, so this is a bug in the code, not a one-off.'
          : `${record.reason ? `${record.reason[0].toUpperCase()}${record.reason.slice(1)}. ` : ''}Usually this means production has different data or settings than staging. Trace2Test will not write a test that already passes, because it would prove nothing.`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Side label="Production (what the customer got)" status={prod.status} body={prod.body} highlight={diffPaths(record.diff, 'prod')} tone="red" />
        {staging ? (
          <Side label={`Staging (the replay, ${duration(staging.ms)})`} status={staging.status} body={staging.body} highlight={diffPaths(record.diff, 'staging')} tone="red" />
        ) : (
          <div className="rounded border border-line p-3 text-muted">Staging could not be reached.</div>
        )}
      </div>
      {!reproduced && <p className="text-[12.5px] text-muted">Highlighted lines are where the two answers differ.</p>}
    </>
  );
}

function Side({ label, status, body, highlight, tone }: { label: string; status: number; body: unknown; highlight: Set<string>; tone: 'red' | 'green' }) {
  const color = status >= 500 ? 'text-danger' : 'text-ok';
  return (
    <div className="min-w-0 rounded-lg border border-line bg-bg">
      <div className="border-b border-line px-3 py-2 text-[12px] text-muted">{label}</div>
      <div className="flex items-baseline gap-2 px-3 pt-2">
        <span className={`font-mono text-[28px] font-medium leading-9 tnum ${color}`}>{status}</span>
        <span className="text-[12.5px] text-muted">{status >= 500 ? 'server error' : status < 300 ? 'success' : ''}</span>
      </div>
      <div className="px-3 pb-3 pt-1">
        <JsonView value={body} highlight={highlight} highlightTone={tone === 'green' ? 'green' : 'amber'} />
      </div>
    </div>
  );
}

function TestChapter({ d }: { d: IncidentDetail }) {
  const api = useApi();
  const stagingUrl = useStagingUrl();
  const inc = d.incident;
  const q = useQuery({ queryKey: ['test', inc.id], queryFn: () => api.getTest(inc.id), enabled: !!inc.testKey, staleTime: Infinity });
  // The demo shop's staging URL is only right for incidents that were replayed there.
  const target = inc.replayable === false ? 'http://localhost:<port>' : (stagingUrl ?? 'https://<staging-host>');
  const command = q.data ? `T2T_TARGET_URL=${target} T2T_TARGET_API_KEY=<key> npx jest ${q.data.filename}` : '';

  if (!inc.testKey) {
    const reason =
      inc.status === 'NOT_REPRODUCED' ? 'No test here: staging did not fail, so a test would pass today and catch nothing. Look at what differs between production and staging instead.'
      : inc.status === 'NOT_REPLAYABLE' ? 'No test here: the request could not be replayed.'
      : inc.status === 'PIPELINE_FAILED' ? 'No test here: Trace2Test hit an error before it got this far.'
      : null;
    return reason ? <p className="text-muted">{reason}</p> : <Waiting text="The test is written as soon as staging fails the same way…" />;
  }
  if (q.isPending) return <Waiting text="Loading the test…" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  const download = () => {
    const url = URL.createObjectURL(new Blob([q.data.source], { type: 'text/javascript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = q.data.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <Delivery d={d} />
      <p>
        <span className="font-mono">{q.data.filename}</span> sends this exact request to the server in <span className="font-mono">T2T_TARGET_URL</span> and expects a proper answer instead of a server error.{' '}
        {inc.replayable === false
          ? <>It was not checked on staging, so run it once to see it fail before you fix anything.</>
          : <>So <b className="font-medium">it fails today</b>, which proves it catches the bug, and <b className="font-medium">passes once the bug is fixed</b>.</>}{' '}
        It holds no secrets, and it is skipped when <span className="font-mono">T2T_TARGET_URL</span> is not set.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={download} className="btn-ghost px-3 py-1.5 text-[13px] font-normal">
          <Download size={14} aria-hidden="true" /> Download the test
        </button>
        <CopyButton text={q.data.source} label="Copy the test" />
      </div>
      <div>
        <p className="mb-1 text-[12.5px] text-muted">Run it from your project:</p>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-muted">
            <span aria-hidden="true" className="select-none text-amber">$ </span>{command}
          </code>
          <CopyButton text={command} label="Copy command" />
        </div>
      </div>
      <More label="Show the test code">
        <div className="max-h-[520px] overflow-auto rounded bg-bg">
          <CodeView code={q.data.source} label={`Generated test ${q.data.filename}`} />
        </div>
      </More>
    </>
  );
}

/** Where the test went: the pull request, or why it could not be opened. */
function Delivery({ d }: { d: IncidentDetail }) {
  const del = d.incident.delivery;
  if (!del) return null;
  if (del.pullRequestUrl) {
    return (
      <a href={del.pullRequestUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg border border-ok/40 bg-ok-soft px-3.5 py-2.5 text-ink hover:border-ok">
        <GitPullRequest size={16} aria-hidden="true" className="shrink-0 text-ok" />
        <span className="min-w-0">
          <span className="font-medium">Pull request #{del.pullRequestNumber}</span> in <span className="font-mono text-[13px]">{del.repo}</span>
          <span className="block text-[12.5px] text-muted">The test is on branch <span className="font-mono">{del.branch}</span>. Push the fix there.</span>
        </span>
      </a>
    );
  }
  return (
    <p role="status" className="rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[13.5px]">
      <b className="font-medium text-danger">Could not open a pull request in {del.repo}.</b> {del.error} The test is still here to download.
    </p>
  );
}

function VerifyChapter({ d }: { d: IncidentDetail }) {
  const api = useApi();
  const qc = useQueryClient();
  const local = useIsLocal();
  const inc = d.incident;
  const live = isLive(inc.status);
  const canVerify = !!inc.replayable && !!inc.testKey && !live;

  const verify = useMutation({
    mutationFn: () => api.verify(inc.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incident', inc.id] }),
  });

  if (!inc.testKey) return <p className="text-muted">Nothing to check: there is no test for this failure.</p>;
  if (inc.replayable === false) {
    return (
      <p className="text-muted">
        Trace2Test can only check a fix on a staging copy it can reach. Run the test yourself after fixing the code, or add a staging
        target for <span className="font-mono">{inc.service}</span> (the <span className="font-mono">ReplayTargets</span> stack parameter) so later failures are checked for you.
      </p>
    );
  }

  const v = d.verify;
  const vStaging = v && 'status' in v.staging ? v.staging : null;

  return (
    <>
      <p>
        Fix the code and deploy it to staging. Then press <b className="font-medium">Re-run on staging</b>: Trace2Test sends the same request again.
        If staging now answers without a server error, this failure is marked <b className="font-medium text-ok">Fixed</b>.
      </p>
      {local && <LocalFix />}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canVerify || verify.isPending}
          onClick={() => verify.mutate()}
          className="btn-primary"
        >
          <Play size={14} aria-hidden="true" fill="currentColor" />
          {inc.status === 'VERIFYING' ? 'Re-running on staging…' : 'Re-run on staging'}
        </button>
        {verify.isError && <span role="alert" className="text-[12.5px] text-danger">{errorMessage(verify.error)}</span>}
      </div>
      {v && vStaging && !live && (
        <VerifyResult record={v} status={vStaging.status} body={vStaging.body} at={inc.verifiedAt} />
      )}
    </>
  );
}

function VerifyResult({ record, status, body, at }: { record: ReplayRecord; status: number; body: unknown; at?: string }) {
  const fixed = record.verdict === 'FIXED';
  return (
    <div className={`rounded border p-3 ${fixed ? 'border-ok/40 bg-ok-soft' : 'border-danger/40 bg-danger-soft'}`}>
      <p className={`font-medium ${fixed ? 'text-ok' : 'text-danger'}`}>
        {fixed ? `Fixed: staging now answers ${status} to the same request.` : `Still failing: staging still answers ${status}.`}
        {at && <span className="font-normal text-muted"> Checked {clockTime(at)}.</span>}
      </p>
      <p className="mt-1 text-[13px] text-ink/85">
        {fixed ? 'The test passes now. Keep it in your suite so this bug cannot come back, and ship the fix to production.' : 'Make sure the fix is deployed to staging, then re-run.'}
      </p>
      <More label="Show staging’s answer">
        <JsonView value={body} />
      </More>
    </div>
  );
}

/** Local stack only: stands in for "deploy the fix to staging". */
function LocalFix() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stagingFix'], queryFn: () => api.stagingFix() });
  const set = useMutation({
    mutationFn: (on: boolean) => api.setStagingFix(on),
    onSuccess: (v) => qc.setQueryData(['stagingFix'], v),
  });
  const on = !!q.data;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line bg-bg px-3.5 py-3 text-[13.5px]">
      <Wrench size={14} aria-hidden="true" className={on ? 'text-ok' : 'text-muted'} />
      <span className="min-w-0 flex-1">
        {on ? <>Demo: <b className="font-medium text-ok">staging has the fix</b>. Press Re-run to check it.</> : <>Demo: staging still has the bug. Pretend you fixed it:</>}
      </span>
      <button
        type="button"
        disabled={q.isPending || set.isPending}
        onClick={() => set.mutate(!on)}
        className="rounded border border-line bg-panel px-3 py-1 text-ink transition-state hover:border-muted disabled:opacity-60"
      >
        {on ? 'Remove the fix' : 'Deploy the fix to staging'}
      </button>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading incident">
      <Bone className="h-4 w-20" />
      <div className="space-y-2"><Bone className="h-6 w-28 rounded-full" /><Bone className="h-7 w-2/3" /><Bone className="h-4 w-1/2" /></div>
      <Bone className="h-28 w-full rounded-panel" />
      <Bone className="h-[76px] w-full rounded-panel" />
      <Bone className="h-48 w-full rounded-panel" />
    </div>
  );
}

function RedactionTable({ d }: { d: IncidentDetail }) {
  const req = d.request!;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-bg text-[12px] text-muted">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-medium">What was removed</th>
            <th scope="col" className="px-3 py-1.5 font-medium">Where</th>
            <th scope="col" className="px-3 py-1.5 font-medium">Replaced with</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {req.redactions.map((r, i) => {
            const raw = valueAt(req as unknown as Record<string, unknown>, r.path);
            const found = typeof raw === 'string' ? placeholdersIn(raw) : [];
            const inText = typeof raw === 'string' && found.length > 0 && found[0] !== raw;
            const stored = inText ? found.join(', ') : raw;
            return (
              <tr key={`${r.path}-${i}`}>
                <td className="px-3 py-1.5 text-ink">{REDACTION_NOUN[r.type] ?? r.type}{inText && <span className="text-muted"> (inside text)</span>}</td>
                <td className="px-3 py-1.5 font-mono text-[12px] text-muted">{r.path.replace(/^request\./, '')}</td>
                <td className="max-w-[240px] truncate px-3 py-1.5 font-mono text-[12px] text-muted" title={typeof stored === 'string' ? stored : undefined}>
                  {typeof stored === 'string' ? stored : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
