/**
 * Replay targets come only from stack configuration, keyed by service name.
 * Nothing in a capture can choose the host, scheme or port.
 */
export interface ReplayTarget {
  baseUrl: string;
  /** "METHOD /path" pairs that may be replayed. */
  routes: string[];
}

export type ReplayTargets = Record<string, ReplayTarget>;

/** Request headers a replay may carry over from the bundle. Everything else is dropped. */
export const REPLAY_HEADERS = ['content-type', 'accept', 'accept-language'];

/**
 * Parses REPLAY_TARGETS. Routes are a list of "METHOD /path", or, because a
 * stack parameter cannot easily carry spaces, an object of method to paths:
 * {"POST": ["/orders"]}. Both become the list form.
 */
export function parseTargets(raw: string | undefined): ReplayTargets {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, { baseUrl: string; routes: string[] | Record<string, string[]> }>;
  const targets: ReplayTargets = {};
  for (const [name, t] of Object.entries(parsed)) {
    const url = new URL(t.baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error(`replay target ${name} must use https`);
    }
    const routes = Array.isArray(t.routes)
      ? t.routes
      : Object.entries(t.routes ?? {}).flatMap(([method, paths]) => paths.map((p) => `${method.toUpperCase()} ${p}`));
    targets[name] = { baseUrl: t.baseUrl, routes };
  }
  return targets;
}

/** Joins a base URL and a captured path, refusing anything that would change the origin. */
export function targetUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('path must be absolute');
  const base = new URL(baseUrl);
  const url = new URL(base.href.replace(/\/+$/, '') + path);
  if (url.origin !== base.origin) throw new Error('path changed the origin');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.href;
}
