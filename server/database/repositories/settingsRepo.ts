import { getDb } from '../connection.ts';

export interface SettingRow {
  key: string;
  value: string;
  is_sensitive: number;
  description: string;
  updated_at: string;
}

export function getSetting(key: string, fallback = ''): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : fallback;
}

export function getSettingNumber(key: string, fallback: number): number {
  const val = Number(getSetting(key, String(fallback)));
  return Number.isFinite(val) ? val : fallback;
}

export function getSettingBoolean(key: string, fallback: boolean): boolean {
  const val = getSetting(key, fallback ? 'true' : 'false').toLowerCase();
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  return fallback;
}

export function setSetting(key: string, value: string, description?: string): SettingRow {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (key, value, is_sensitive, description, updated_at)
    VALUES (?, ?, 0, COALESCE(?, ''), ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      description = CASE WHEN excluded.description != '' THEN excluded.description ELSE settings.description END,
      updated_at = excluded.updated_at
  `).run(key, String(value), description || null, now);

  return db.prepare('SELECT * FROM settings WHERE key = ?').get(key) as unknown as SettingRow;
}

export function listPublicSettings(): SettingRow[] {
  const db = getDb();
  return db
    .prepare('SELECT key, value, is_sensitive, description, updated_at FROM settings WHERE is_sensitive = 0 ORDER BY key ASC')
    .all() as unknown as SettingRow[];
}
