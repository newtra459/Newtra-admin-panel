import type { ApiError } from '../types/api';

function pickMessage(payload: unknown): string {
  const body = (payload || {}) as Record<string, unknown>;
  const nested = (body.error || {}) as Record<string, unknown>;

  const candidates = [
    nested.user_msg,
    nested.error_msg,
    nested.description,
    body.user_msg,
    body.error_msg,
    body.message,
    body.error,
  ];

  const found = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof found === 'string' ? found : '';
}

export function getApiErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  const err = (error || {}) as ApiError & { message?: string };
  const payloadMessage = pickMessage(err.payload);
  if (payloadMessage) return payloadMessage;
  if (typeof err.message === 'string' && err.message.trim()) return err.message;
  return fallback;
}
