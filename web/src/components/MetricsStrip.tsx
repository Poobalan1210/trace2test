import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context';
import { duration } from '../lib/format';
import { Bone } from './Skeleton';

function Figure({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 border-line px-5 py-4 [&:not(:first-child)]:border-l max-sm:border-t max-sm:[&:nth-child(-n+2)]:border-t-0 max-sm:[&:nth-child(odd)]:border-l-0 max-sm:last:col-span-2">
      <dt className="truncate text-[12.5px] text-muted">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-ink tnum">{value}</span>
        {detail && <span className="truncate font-mono text-[12px] text-muted tnum">{detail}</span>}
      </dd>
    </div>
  );
}

export function MetricsStrip({ fast }: { fast: boolean }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['metrics'], queryFn: () => api.metrics(), refetchInterval: fast ? 3000 : 15000 });

  if (q.isPending) {
    return (
      <div className="grid grid-cols-2 rounded-panel border border-line bg-panel sm:grid-cols-5" aria-busy="true" aria-label="Loading metrics">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="px-4 py-3"><Bone className="h-3 w-24" /><Bone className="mt-2.5 h-5 w-14" /></div>
        ))}
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="flex items-center justify-between rounded-panel border border-line bg-panel px-4 py-3 text-muted">
        Metrics are unavailable.
        <button type="button" onClick={() => q.refetch()} className="text-[13px] text-ink underline-offset-2 hover:underline">Retry</button>
      </div>
    );
  }
  const m = q.data;
  return (
    <dl className="grid grid-cols-2 rounded-panel border border-line bg-panel sm:grid-cols-5">
      <Figure label="Failures captured" value={String(m.captured)} />
      <Figure label="Reproduced on staging" value={String(m.reproduced)} detail={m.reproducedPercent === null ? undefined : `${m.reproducedPercent}% of ${m.replayable}`} />
      <Figure label="Tests generated" value={String(m.testsGenerated)} />
      <Figure label="Median capture to test" value={duration(m.medianCaptureToTestMs)} detail={m.medianSampleSize ? `n=${m.medianSampleSize}` : undefined} />
      <Figure label="Sensitive values redacted" value={String(m.redactions)} detail={m.leaks === 0 ? '0 leaked' : `${m.leaks} caught by Sanitize`} />
    </dl>
  );
}
