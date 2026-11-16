// The dashboard token lives in sessionStorage. Storage can be unavailable
// (private windows, blocked site data), so every access is guarded.
const KEY = 't2t.token';

export function readToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // Kept in memory only for this tab.
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
