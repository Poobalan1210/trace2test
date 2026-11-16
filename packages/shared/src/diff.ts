import type { DiffEntry } from './types.js';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Field-level diff of two JSON values: one entry per differing leaf. */
export function jsonDiff(prod: unknown, staging: unknown, path = ''): DiffEntry[] {
  if (Array.isArray(prod) && Array.isArray(staging)) {
    const out: DiffEntry[] = [];
    for (let i = 0; i < Math.max(prod.length, staging.length); i++) {
      const p = `${path}[${i}]`;
      if (i >= staging.length) out.push({ path: p, kind: 'removed', prod: prod[i] });
      else if (i >= prod.length) out.push({ path: p, kind: 'added', staging: staging[i] });
      else out.push(...jsonDiff(prod[i], staging[i], p));
    }
    return out;
  }
  if (isObj(prod) && isObj(staging)) {
    const out: DiffEntry[] = [];
    const keys = [...new Set([...Object.keys(prod), ...Object.keys(staging)])].sort();
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in staging)) out.push({ path: p, kind: 'removed', prod: prod[k] });
      else if (!(k in prod)) out.push({ path: p, kind: 'added', staging: staging[k] });
      else out.push(...jsonDiff(prod[k], staging[k], p));
    }
    return out;
  }
  if (JSON.stringify(prod) === JSON.stringify(staging)) return [];
  return [{ path: path || '$', kind: 'changed', prod, staging }];
}
