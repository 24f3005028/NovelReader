import { Platform } from 'react-native';
const fallback = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
export const apiUrl = process.env.EXPO_PUBLIC_API_URL || fallback;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export class ReaderError extends Error {}

export function readerMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
) {
  if (__DEV__) console.debug('NovelReader request or storage error', error);
  if (error instanceof ReaderError) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403)
      return 'Access is unavailable right now. Please try again later.';
    if (error.status === 404) return 'This content is no longer available.';
    if (error.status === 429) return 'Too many requests. Wait a moment and try again.';
    if (error.status >= 500) return 'The service is temporarily unavailable. Try again shortly.';
  }
  return fallback;
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EXPO_PUBLIC_API_TOKEN
          ? { Authorization: `Bearer ${process.env.EXPO_PUBLIC_API_TOKEN}` }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 204) return undefined as T;
    const value = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        value?.error || `Request failed (${response.status})`,
        response.status,
        value?.code,
      );
    if (value === null)
      throw new ReaderError('The service sent an unexpected response. Try again shortly.');
    return value;
  } catch (error) {
    if (error instanceof ApiError || error instanceof ReaderError) throw error;
    if (__DEV__) console.debug('NovelReader network error', error);
    throw new ReaderError(
      controller.signal.aborted
        ? 'The request took too long. Please try again.'
        : 'Couldn’t connect. Check your internet connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }
}
