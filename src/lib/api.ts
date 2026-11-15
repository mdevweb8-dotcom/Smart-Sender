const TOKEN_KEY = 'smart_sender_jwt';
const USER_KEY = 'smart_sender_user';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredSession(token: string, user: unknown): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError('لا يوجد اتصال بالخادم حالياً، يرجى التحقق من الشبكة.', 0);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      clearStoredSession();
    }
    throw new ApiError(data.error || `خطأ من الخادم (${response.status})`, response.status);
  }
  return data as T;
}

export function buildDownloadUrl(fileId: string): string {
  const token = getStoredToken() || '';
  return `/api/files/${encodeURIComponent(fileId)}/download?token=${encodeURIComponent(token)}`;
}

export function buildBackupDownloadUrl(filename: string): string {
  const token = getStoredToken() || '';
  return `/api/backups/${encodeURIComponent(filename)}/download?token=${encodeURIComponent(token)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatArabicDate(iso: string | null | undefined, tz = 'Africa/Khartoum'): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SD', {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
