import { ApiError, UnauthorizedError, type Api, type IncidentDetail, type MetricsView, type TestFile } from './types';
import type { Incident } from '@shared/types';

export function httpApi(baseUrl: string, getToken: () => string | null): Api {
  const base = baseUrl.replace(/\/+$/, '');

  async function call<T>(path: string, init: RequestInit = {}, opts: { raw?: boolean } = {}): Promise<T> {
    const res = await fetch(base + path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-t2t-token': getToken() ?? '', ...(init.headers ?? {}) },
    });
    if (res.status === 401) throw new UnauthorizedError('unauthorized');
    if (opts.raw) return res as unknown as T;
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, (body && body.error) || `request failed (${res.status})`);
    return body as T;
  }

  return {
    listIncidents: (statuses, cursor) => {
      const q = new URLSearchParams();
      if (statuses.length) q.set('status', statuses.join(','));
      if (cursor) q.set('cursor', cursor);
      const qs = q.toString();
      return call<{ items: Incident[]; cursor: string | null }>(`/incidents${qs ? `?${qs}` : ''}`);
    },
    getIncident: (id) => call<IncidentDetail>(`/incidents/${encodeURIComponent(id)}`),
    getTest: (id) => call<TestFile>(`/incidents/${encodeURIComponent(id)}/test`),
    verify: async (id) => {
      await call(`/incidents/${encodeURIComponent(id)}/verify`, { method: 'POST' });
    },
    metrics: () => call<MetricsView>('/metrics'),
    trigger: async (cart) => {
      // The shop relays checkout's own status, so a 500 here is an answer, not an error.
      const res = await call<Response>('/demo/trigger', { method: 'POST', body: cart ? JSON.stringify(cart) : undefined }, { raw: true });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // keep text
      }
      return { status: res.status, body };
    },
    stagingFix: async () => (await call<{ stagingHasFix: boolean }>('/__local/staging-fix')).stagingHasFix,
    setStagingFix: async (on) =>
      (await call<{ stagingHasFix: boolean }>('/__local/staging-fix', { method: 'POST', body: JSON.stringify({ on }) })).stagingHasFix,
  };
}
