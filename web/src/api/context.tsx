import { createContext, useContext } from 'react';
import type { Api } from './types';

export interface ApiConfig {
  api: Api;
  /** True when the API is the local stack, so the UI can show its fixed dev token. */
  local: boolean;
  /** Shown in the generated test's run command when deploy-web.sh provides it. */
  stagingUrl?: string;
  /** The Lantern Books demo shop is deployed, so the walkthrough and /shop work. */
  demo: boolean;
}

export const ApiContext = createContext<ApiConfig | null>(null);

export function useApi(): Api {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi outside ApiContext');
  return ctx.api;
}

export function useIsLocal(): boolean {
  return useContext(ApiContext)?.local ?? false;
}

export function useIsDemo(): boolean {
  return useContext(ApiContext)?.demo ?? false;
}

export function useStagingUrl(): string | undefined {
  return useContext(ApiContext)?.stagingUrl;
}
