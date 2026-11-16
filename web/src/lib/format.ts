export function relativeTime(isoTime: string, now = Date.now()): string {
  const s = Math.round((now - Date.parse(isoTime)) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '–';
  // Sub-millisecond steps (in-memory stores, the local stack) read as zero otherwise.
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function clockTime(isoTime: string): string {
  return new Date(isoTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

export const rupees = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
