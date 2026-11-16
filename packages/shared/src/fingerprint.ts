import { createHash } from 'node:crypto';
import type { Capture } from './types.js';

/** SHA-256 of service, method, path, error name and top stack frame; first 12 hex characters. */
export function fingerprint(c: Pick<Capture, 'service' | 'request' | 'error'>): string {
  const input = [c.service, c.request.method.toUpperCase(), c.request.path, c.error.name, c.error.stackTop].join('\n');
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/** "at chargeUpi (/var/task/src/checkout.ts:88:11)" becomes "chargeUpi (checkout.ts:88)". */
export function stackTop(err: unknown): string {
  const stack = err instanceof Error ? err.stack : undefined;
  if (!stack) return '';
  for (const line of stack.split('\n')) {
    const m = line.trim().match(/^at (?:async )?(?:(.+?) \()?(.+?):(\d+):\d+\)?$/);
    if (!m) continue;
    const [, fn, file, lineNo] = m;
    if (file.startsWith('node:')) continue;
    const base = file.split(/[\\/]/).pop()!;
    return `${fn ?? '<anonymous>'} (${base}:${lineNo})`;
  }
  return '';
}
