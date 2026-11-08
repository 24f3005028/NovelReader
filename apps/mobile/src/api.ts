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
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(25000),
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.EXPO_PUBLIC_API_TOKEN
        ? { Authorization: `Bearer ${process.env.EXPO_PUBLIC_API_TOKEN}` }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      value.error || `Request failed (${response.status})`,
      response.status,
      value.code,
    );
  return value;
}
