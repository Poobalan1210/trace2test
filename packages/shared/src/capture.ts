import type { Capture } from './types.js';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrMap = (v: unknown) => isObj(v) && Object.values(v).every(isStr);

/** Checks a posted capture against the schema. Returns a reason, or null when valid. */
export function validateCapture(v: unknown): string | null {
  if (!isObj(v)) return 'capture must be an object';
  if (v.schemaVersion !== 1) return 'schemaVersion must be 1';
  if (!isStr(v.service) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v.service)) return 'service must be a short lowercase name';
  if (!isStr(v.capturedAt) || Number.isNaN(Date.parse(v.capturedAt))) return 'capturedAt must be an ISO timestamp';
  const req = v.request;
  if (!isObj(req)) return 'request is required';
  if (!isStr(req.method) || !/^[A-Z]{3,7}$/.test(req.method)) return 'request.method must be an HTTP method';
  if (!isStr(req.path) || !req.path.startsWith('/') || req.path.length > 2048) return 'request.path must start with /';
  if (!isStrMap(req.query)) return 'request.query must map strings to strings';
  if (!isStrMap(req.headers)) return 'request.headers must map strings to strings';
  if (!('body' in req)) return 'request.body is required (null when omitted)';
  if (req.bodyOmitted !== undefined && typeof req.bodyOmitted !== 'boolean') return 'request.bodyOmitted must be boolean';
  const res = v.response;
  if (!isObj(res) || !Number.isInteger(res.status) || (res.status as number) < 100 || (res.status as number) > 599) {
    return 'response.status must be an HTTP status';
  }
  const err = v.error;
  if (!isObj(err) || !isStr(err.name) || !isStr(err.message) || !isStr(err.stackTop)) return 'error needs name, message and stackTop';
  if (!Array.isArray(v.redactions) || !v.redactions.every((r) => isObj(r) && isStr(r.path) && isStr(r.type))) {
    return 'redactions must be a list of { path, type }';
  }
  if (!isObj(v.runtime) || !isStr(v.runtime.node) || !isStr(v.runtime.codeVersion)) return 'runtime needs node and codeVersion';
  return null;
}

export function asCapture(v: unknown): Capture {
  const reason = validateCapture(v);
  if (reason) throw new Error(reason);
  return v as Capture;
}
