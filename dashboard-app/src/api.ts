import { clearAuthSession, getApiBaseUrl, getJwtToken } from './config';

export class OfflineOrServerError extends Error {
  isOffline: boolean;
  status: number;
  constructor(message: string, isOffline = false, status = 0) {
    super(message);
    this.isOffline = isOffline;
    this.status = status;
  }
}

export async function apkFetch<T>(
  path: string,
  options: RequestInit = {},
  overrideBaseUrl?: string
): Promise<T> {
  const base = (overrideBaseUrl || getApiBaseUrl()).replace(/\/+$/, '');
  if (!base || base.includes('YOUR_SERVER_IP')) {
    throw new OfflineOrServerError('يرجى إدخال رابط السيرفر الصحيح أولاً (مثال: http://192.168.1.10:3000)', true, 0);
  }

  const token = getJwtToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        clearAuthSession();
      }
      throw new OfflineOrServerError(data.error || `خطأ من الخادم (${res.status})`, false, res.status);
    }
    return data as T;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof OfflineOrServerError) throw err;
    throw new OfflineOrServerError('لا يوجد اتصال بالسيرفر — تحقق من الإنترنت أو رابط السيرفر', true, 0);
  }
}

export async function testServerHealth(serverUrl: string) {
  return apkFetch<{
    ok: boolean;
    app: string;
    whatsapp: { status: string; provider: string; connectedPhone: string | null };
    gemini: { configured: boolean; model: string };
    schedulerRunning: boolean;
  }>('/api/health', { method: 'GET' }, serverUrl);
}
