import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiContext } from './api/context';
import { httpApi } from './api/http';
import { UnauthorizedError } from './api/types';
import { clearToken, readToken, writeToken } from './lib/token';
import { Layout } from './components/Layout';
import { TokenDialog } from './components/TokenDialog';
import { IncidentsPage } from './pages/IncidentsPage';
import { HomePage } from './pages/HomePage';
import { IncidentPage } from './pages/IncidentPage';
import { ShopPage } from './pages/ShopPage';
import { DocsPage } from './pages/DocsPage';
import { NotFoundPage } from './pages/NotFoundPage';

const tokenRef: { current: string | null } = { current: null };

interface RuntimeConfig {
  apiUrl: string;
  stagingUrl?: string;
  /** True when the Lantern Books demo shop is deployed. Older configs without it imply it from stagingUrl. */
  demo?: boolean;
  /** Published only for the public demo stack, so visitors are not asked for a token. */
  token?: string;
}

export function App() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [token, setToken] = useState<string | null>(() => readToken());

  useEffect(() => {
    fetch('/config.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setConfig)
      .catch(() => setConfigError(true));
  }, []);

  const queryClient = useMemo(() => {
    // A 401 anywhere means the token is wrong or rotated: forget it and ask again.
    const onError = (err: unknown) => {
      if (err instanceof UnauthorizedError) {
        clearToken();
        tokenRef.current = null;
        setToken(null);
      }
    };
    return new QueryClient({
        queryCache: new QueryCache({ onError }),
        mutationCache: new MutationCache({ onError }),
        defaultOptions: {
          queries: {
            // Retry transient failures only; a 401 or 404 will not change on its own.
            retry: (n, err) => !(err instanceof UnauthorizedError) && (err as { status?: number }).status !== 404 && n < 2,
            refetchOnWindowFocus: false,
          },
        },
      });
  }, []);

  // Built once per config; the client reads the token through tokenRef, so it always sends the latest one.
  const ctx = useMemo(() => {
    if (!config) return null;
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(config.apiUrl);
    const demo = config.demo ?? !!config.stagingUrl;
    return { local, demo, stagingUrl: config.stagingUrl, api: httpApi(config.apiUrl, () => tokenRef.current ?? config.token ?? null) };
  }, [config]);
  tokenRef.current = token;

  if (configError) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-medium">Configuration missing</h1>
        <p className="mt-2 text-muted">The dashboard could not load /config.json. Run scripts/deploy-web.sh to publish it.</p>
      </main>
    );
  }
  if (!ctx) return <div className="min-h-screen bg-bg" aria-busy="true" />;

  if (!token && !config?.token) {
    // Nothing loads until there is a token, so no page renders a wall of 401s behind the dialog.
    return (
      <div className="min-h-screen bg-bg">
        <TokenDialog
          localHint={ctx.local}
          onSubmit={(t) => {
            writeToken(t);
            tokenRef.current = t;
            queryClient.clear();
            setToken(t);
          }}
        />
      </div>
    );
  }

  return (
    <ApiContext.Provider value={ctx}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            {ctx.demo && <Route path="/shop" element={<ShopPage />} />}
            <Route element={<Layout />}>
              {/* Without the demo shop, the live walkthrough has nothing to call: open on the failures instead. */}
              <Route path="/" element={ctx.demo ? <HomePage /> : <Navigate to="/incidents" replace />} />
              <Route path="/incidents" element={<IncidentsPage />} />
              <Route path="/incidents/:id" element={<IncidentPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/setup" element={<Navigate to="/docs" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
