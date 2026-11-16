import { RotateCw } from 'lucide-react';

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-danger/40 bg-danger-soft px-4 py-3">
      <p className="text-ink">{message}</p>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded border border-line bg-panel px-3 py-1.5 text-[13px] text-ink transition-state hover:border-muted">
        <RotateCw size={13} aria-hidden="true" /> Retry
      </button>
    </div>
  );
}

export function errorMessage(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 404) return 'That was not found. It may have expired after 30 days.';
  if (err instanceof TypeError) return 'Could not reach the Trace2Test API. Check your connection and the API URL in config.json.';
  return (err as Error)?.message || 'Something went wrong loading this.';
}
