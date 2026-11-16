import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { Redaction } from '../api/types';
import { PLACEHOLDER_RE } from '../lib/narrate';

/**
 * Pretty-prints a JSON value. Captured strings are untrusted, so everything is
 * rendered as React text, never as HTML. Redacted values become labelled
 * chips; fields named in `highlight` are marked as differing.
 */

const LABEL: Record<string, string> = {
  email: 'email redacted', key: 'key redacted', token: 'token redacted', bearer: 'token redacted', jwt: 'token redacted',
  card: 'card redacted', phone: 'phone redacted', password: 'password redacted', cookie: 'cookie redacted', secret: 'secret redacted',
};

function placeholderType(v: string): string | null {
  const m = v.match(/^\[REDACTED:([a-z]+)\]$/);
  if (m) return m[1];
  if (/^user_[0-9a-f]{4}@redacted\.example$/.test(v)) return 'email';
  if (v === '4111111111111111') return 'card';
  if (v === '+10000000000') return 'phone';
  return null;
}

export function RedactionChip({ type, value }: { type: string; value?: string }) {
  return (
    <span
      title={value ? `Stored as ${value}` : undefined}
      className="mx-0.5 inline-flex items-center gap-1 rounded border border-amber/30 bg-amber-soft px-1.5 py-px align-baseline font-sans text-[11px] font-medium text-amber"
    >
      <ShieldCheck size={11} aria-hidden="true" />
      {LABEL[type] ?? `${type} redacted`}
    </span>
  );
}

interface Props {
  value: unknown;
  /** Path of `value` in the capture, e.g. "request.body", matching redaction paths. */
  basePath?: string;
  redactions?: Redaction[];
  /** Paths relative to `value` (as Compare's diff writes them) to mark. */
  highlight?: Set<string>;
  highlightTone?: 'amber' | 'red' | 'green';
}

const TONES = { amber: 'bg-amber-soft', red: 'bg-danger-soft', green: 'bg-ok-soft' };

export function JsonView({ value, basePath = '', redactions = [], highlight, highlightTone = 'amber' }: Props) {
  const byPath = new Map(redactions.map((r) => [r.path, r.type]));
  const join = (p: string, k: string | number) => (typeof k === 'number' ? `${p}[${k}]` : p ? `${p}.${k}` : k);

  const leaf = (v: unknown, full: string): ReactNode => {
    if (typeof v === 'string') {
      const whole = placeholderType(v);
      if (whole) return <RedactionChip type={whole} value={v} />;
      const pathType = byPath.get(full);
      const parts = v.split(new RegExp(`(${PLACEHOLDER_RE.source})`));
      if (parts.length > 1) {
        // Free text with a stand-in inside it: show the text, with each stand-in as a chip.
        return (
          <span className="whitespace-pre-wrap text-[#A5D6A7]">
            "{parts.map((p, i) => (i % 2 ? <RedactionChip key={i} type={placeholderType(p) ?? pathType ?? 'secret'} value={p} /> : JSON.stringify(p).slice(1, -1)))}"
          </span>
        );
      }
      if (pathType) return <RedactionChip type={pathType} value={v} />;
      return <span className="text-[#A5D6A7]">{JSON.stringify(v)}</span>;
    }
    if (typeof v === 'number') return <span className="text-[#F5C26B]">{String(v)}</span>;
    if (typeof v === 'boolean' || v === null) return <span className="text-[#9CB4F0]">{String(v)}</span>;
    return <span>{JSON.stringify(v)}</span>;
  };

  const render = (v: unknown, full: string, rel: string, indent: number, key: ReactNode, last: boolean): ReactNode => {
    const pad = '  '.repeat(indent);
    const marked = highlight?.has(rel || '$');
    const comma = last ? '' : ',';
    const line = (content: ReactNode) => (
      <div key={full} className={marked ? `-mx-1 rounded px-1 ${TONES[highlightTone]}` : undefined}>
        {pad}{key}{content}{comma}
      </div>
    );
    if (Array.isArray(v)) {
      if (v.length === 0) return line('[]');
      return (
        <div key={full}>
          <div>{pad}{key}[</div>
          {v.map((item, i) => render(item, join(full, i), join(rel, i), indent + 1, null, i === v.length - 1))}
          <div>{pad}]{comma}</div>
        </div>
      );
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
      if (entries.length === 0) return line('{}');
      return (
        <div key={full}>
          <div>{pad}{key}{'{'}</div>
          {entries.map(([k, x], i) =>
            render(x, join(full, k), join(rel, k), indent + 1, <span className="text-[#C3CAD8]">{JSON.stringify(k)}: </span>, i === entries.length - 1),
          )}
          <div>{pad}{'}'}{comma}</div>
        </div>
      );
    }
    return line(leaf(v, full));
  };

  return (
    <div className="overflow-x-auto whitespace-pre font-mono text-[12.5px] leading-[20px] text-ink">
      {render(value, basePath, '', 0, null, true)}
    </div>
  );
}
