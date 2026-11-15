const API_URL_STORAGE_KEY = 'smart_sender_apk_server_url';
const TOKEN_STORAGE_KEY = 'smart_sender_apk_jwt';
const USER_STORAGE_KEY = 'smart_sender_apk_user';

export const DEFAULT_API_BASE_URL = 'http://YOUR_SERVER_IP:3000';

export function getApiBaseUrl(): string {
  const saved = localStorage.getItem(API_URL_STORAGE_KEY);
  const url = (saved && saved.trim()) || DEFAULT_API_BASE_URL;
  return url.replace(/\/+$/, '');
}

export function setApiBaseUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, '');
  localStorage.setItem(API_URL_STORAGE_KEY, normalized);
  return normalized;
}

export function getJwtToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function saveAuthSession(token: string, user: unknown): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function getStoredUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearAuthSession(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
}
