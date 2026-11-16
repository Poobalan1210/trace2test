import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Wrench } from 'lucide-react';
import { useApi, useIsLocal } from '../api/context';
import type { Incident } from '../api/types';
import { MetricsStrip } from '../components/MetricsStrip';
import { StatusPill, STATUS_MEANING, isLive } from '../components/StatusPill';
import { Bone } from '../components/Skeleton';
import { ErrorState, errorMessage } from '../components/ErrorState';
import { relativeTime } from '../lib/format';
import { scenarioFor } from '../lib/narrate';

const FILTERS: { label: string; statuses: string[] }[] = [
  { label: 'All', statuses: [] },
  { label: 'Test ready', statuses: ['TEST_READY', 'TEST_UNVERIFIED'] },
  { label: 'Fixed', statuses: ['FIXED'] },
  { label: 'Not reproduced', statuses: ['NOT_REPRODUCED', 'NOT_REPLAYABLE'] },
  { label: 'Failed', statuses: ['PIPELINE_FAILED', 'STILL_FAILING'] },
];

function Row({ incident, fresh }: { incident: Incident; fresh: boolean }) {
  const s = scenarioFor(incident);
  return (
    <li className={fresh ? 'animate-slidein' : undefined}>
      <Link
        to={`/incidents/${incident.id}`}
        className="group grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-2.5 px-5 py-4 transition-state hover:bg-raised/60 focus-visible:bg-raised md:grid-cols-[minmax(0,1fr)_340px_auto]"
      >
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-ink">
            {s ? s.title : <>{incident.errorName}: {incident.errorMessage}</>}
          </span>
          <span className="mt-0.5 block truncate text-[13.5px] text-muted">
            {s ? <>Customer said “{s.complaint}”</> : <span className="font-mono">{incident.method} {incident.path}</span>}
          </span>
        </span>
        <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-2 md:col-span-1 md:row-start-auto">
          <StatusPill status={incident.status} />
          <span className="truncate text-[13.5px] text-body">{STATUS_MEANING[incident.status]}</span>
        </span>
        <span className="col-start-2 row-start-1 flex items-center gap-3 whitespace-nowrap text-[12px] text-muted md:col-start-auto md:row-start-auto">
          {incident.occurrences > 1 && <span className="tnum">seen {incident.occurrences}×</span>}
          <time dateTime={incident.lastSeenAt} className="tnum">{relativeTime(incident.lastSeenAt)}</time>
          <ChevronRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
        </span>
      </Link>
    </li>
  );
}

/** Local stack only: a reminder that new captures will not reproduce while staging has the fix. */
function StagingFixBanner() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stagingFix'], queryFn: () => api.stagingFix() });
  const off = useMutation({
    mutationFn: () => api.setStagingFix(false),
    onSuccess: (v) => qc.setQueryData(['stagingFix'], v),
  });
  if (!q.data) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-panel border border-ok/30 bg-ok-soft px-4 py-3 text-[13px] text-ink">
      <Wrench size={15} aria-hidden="true" className="text-ok" />
      <span className="min-w-0 flex-1">
        Staging currently has the fix deployed, so new failures will show as “Not reproduced”. Remove it to see the bugs reproduce again.
      </span>
      <button type="button" onClick={() => off.mutate()} disabled={off.isPending} className="rounded border border-line bg-bg px-3 py-1 text-ink hover:border-muted disabled:opacity-60">
        Remove the fix from staging
      </button>
    </div>
  );
}

export function IncidentsPage() {
  const api = useApi();
  const local = useIsLocal();
  const [filter, setFilter] = useState(0);
  const statuses = FILTERS[filter].statuses;
  const seen = useRef<Set<string> | null>(null);

  const q = useQuery({
    queryKey: ['incidents', statuses],
    queryFn: () => api.listIncidents(statuses),
    refetchInterval: (query) => (query.state.data?.items.some((i) => isLive(i.status)) ? 3000 : 15000),
  });

  // Rows that arrive after the first load slide in; the first load does not animate.
  const items = q.data?.items ?? [];
  const fresh = new Set<string>();
  if (seen.current) for (const i of items) if (!seen.current.has(i.id)) fresh.add(i.id);
  useEffect(() => {
    if (!q.data) return;
    seen.current ??= new Set();
    for (const i of q.data.items) seen.current.add(i.id);
  }, [q.data]);

  const anyLive = items.some((i) => isLive(i.status));

  return (
    <div className="space-y-8">
      <div>
        <p className="kicker">Failures</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-[1.25] tracking-[-0.015em] sm:text-[32px]">Every failure Trace2Test has captured</h1>
        <p className="mt-2 text-[15px] text-body">
          Open one for the full technical details. New here? Start with the <Link to="/" className="text-ink underline underline-offset-2 hover:text-amber">overview and live demo</Link>.
        </p>
      </div>

      {local && <StagingFixBanner />}

      <section aria-label="Totals so far">
        <MetricsStrip fast={anyLive} />
      </section>

      <section aria-labelledby="count-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="count-title" className="text-[16px] font-semibold">{q.isSuccess ? `${items.length} ${items.length === 1 ? 'failure' : 'failures'}` : 'Failures'}</h2>
          <div role="group" aria-label="Filter incidents" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f, i) => (
              <button
                key={f.label}
                type="button"
                aria-pressed={i === filter}
                onClick={() => setFilter(i)}
                className={`rounded-full border px-3 py-1 text-[13px] transition-state ${
                  i === filter ? 'border-amber/50 bg-amber-soft text-amber' : 'border-line text-muted hover:border-muted hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-panel border border-line bg-panel">
          {q.isPending && (
            <ul aria-busy="true" aria-label="Loading incidents" className="divide-y divide-line">
              {Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="flex-1 space-y-1.5"><Bone className="h-4 w-48" /><Bone className="h-3 w-72" /></div><Bone className="h-5 w-40 rounded-full" />
                </li>
              ))}
            </ul>
          )}
          {q.isError && <div className="p-4"><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>}
          {q.isSuccess && items.length === 0 && (
            <p className="px-6 py-16 text-center text-muted">
              {filter === 0 ? 'Nothing captured yet. Try the live demo on the overview page and the failure appears here within a second.' : 'No incidents match this filter.'}
            </p>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-line">
              {items.map((i) => <Row key={i.id} incident={i} fresh={fresh.has(i.id)} />)}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
