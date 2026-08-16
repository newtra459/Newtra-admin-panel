function parseBoolean(input: unknown): boolean {
  const value = String(input ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function isApiIntegrationEnabled(): boolean {
  const baseUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  return baseUrl.length > 0;
}

export function getApiBaseUrl(): string {
  const raw = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (!raw) return '';

  // On localhost, prefer relative /v1 routes so the local server proxy can
  // forward requests to backend without browser CORS failures.
  if (typeof window !== 'undefined') {
    const host = String(window.location.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      return '';
    }
  }

  return raw.replace(/\/+$/, '');
}

export const API_REQUEST_TIMEOUT_MS: number = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);
export const API_LOGGING_ENABLED: boolean = parseBoolean(import.meta.env.VITE_API_DEBUG);
