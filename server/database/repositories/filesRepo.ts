import crypto from 'node:crypto';
import { getDb } from '../connection.ts';

export interface FileRecord {
  id: string;
  original_name: string;
  stored_name: string;
  folder_id: string | null;
  folder_name?: string;
  mime_type: string;
  file_type: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  sender_phone: string;
  sender_name: string;
  source_group_id: string;
  source_group_name: string;
  ai_summary: string;
  ai_category: string;
  analysis_status: 'pending' | 'completed' | 'failed' | 'unsupported';
  transcript: string;
  send_count: number;
  received_at: string;
  updated_at: string;
}

export interface CreateFileInput {
  id?: string;
  originalName: string;
  storedName: string;
  folderId: string | null;
  mimeType: string;
  fileType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  senderPhone?: string;
  senderName?: string;
  sourceGroupId?: string;
  sourceGroupName?: string;
  aiSummary?: string;
  aiCategory?: string;
  analysisStatus?: 'pending' | 'completed' | 'failed' | 'unsupported';
  transcript?: string;
}

export function createFileRecord(input: CreateFileInput): FileRecord {
  const db = getDb();
  const id = input.id || crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO files (
      id, original_name, stored_name, folder_id, mime_type, file_type,
      size_bytes, sha256, storage_path, sender_phone, sender_name,
      source_group_id, source_group_name, ai_summary, ai_category,
      analysis_status, transcript, send_count, received_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    input.originalName,
    input.storedName,
    input.folderId,
    input.mimeType,
    input.fileType,
    input.sizeBytes,
    input.sha256,
    input.storagePath,
    input.senderPhone || '',
    input.senderName || '',
    input.sourceGroupId || '',
    input.sourceGroupName || '',
    input.aiSummary || '',
    input.aiCategory || '',
    input.analysisStatus || 'pending',
    input.transcript || '',
    now,
    now
  );
  return getFileById(id)!;
}

export function getFileById(id: string): FileRecord | undefined {
  const db = getDb();
  return db
    .prepare(`
      SELECT f.*, fld.name as folder_name
      FROM files f
      LEFT JOIN folders fld ON fld.id = f.folder_id
      WHERE f.id = ?
    `)
    .get(id) as FileRecord | undefined;
}

export function listFiles(options: {
  search?: string;
  folderId?: string;
  fileType?: string;
  todayOnly?: boolean;
  limit?: number;
} = {}): FileRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.search && options.search.trim()) {
    const term = `%${options.search.trim()}%`;
    conditions.push('(f.original_name LIKE ? OR f.ai_summary LIKE ? OR f.ai_category LIKE ? OR f.transcript LIKE ? OR fld.name LIKE ?)');
    params.push(term, term, term, term, term);
  }
  if (options.folderId && options.folderId !== 'all') {
    conditions.push('f.folder_id = ?');
    params.push(options.folderId);
  }
  if (options.fileType && options.fileType !== 'all') {
    conditions.push('f.file_type = ?');
    params.push(options.fileType);
  }
  if (options.todayOnly) {
    conditions.push("date(f.received_at) = date('now')");
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, options.limit || 200));

  return db
    .prepare(`
      SELECT f.*, fld.name as folder_name
      FROM files f
      LEFT JOIN folders fld ON fld.id = f.folder_id
      ${where}
      ORDER BY f.received_at DESC
      LIMIT ?
    `)
    .all(...params, limit) as unknown as FileRecord[];
}

export function updateFileMetadata(
  id: string,
  updates: Partial<{
    original_name: string;
    folder_id: string | null;
    ai_summary: string;
    ai_category: string;
    analysis_status: 'pending' | 'completed' | 'failed' | 'unsupported';
    transcript: string;
  }>
): FileRecord | undefined {
  const db = getDb();
  const existing = getFileById(id);
  if (!existing) return undefined;

  db.prepare(`
    UPDATE files SET
      original_name = COALESCE(?, original_name),
      folder_id = CASE WHEN ? = 1 THEN ? ELSE folder_id END,
      ai_summary = COALESCE(?, ai_summary),
      ai_category = COALESCE(?, ai_category),
      analysis_status = COALESCE(?, analysis_status),
      transcript = COALESCE(?, transcript),
      updated_at = ?
    WHERE id = ?
  `).run(
    updates.original_name ?? null,
    updates.folder_id !== undefined ? 1 : 0,
    updates.folder_id ?? null,
    updates.ai_summary ?? null,
    updates.ai_category ?? null,
    updates.analysis_status ?? null,
    updates.transcript ?? null,
    new Date().toISOString(),
    id
  );
  return getFileById(id);
}

export function incrementFileSendCount(id: string): void {
  const db = getDb();
  db.prepare('UPDATE files SET send_count = send_count + 1, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id
  );
}

export function deleteFileRecord(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM files WHERE id = ?').run(id);
  return info.changes > 0;
}

export function getFileStats() {
  const db = getDb();
  const totals = db
    .prepare('SELECT COUNT(*) as total_files, COALESCE(SUM(size_bytes), 0) as total_bytes FROM files')
    .get() as { total_files: number; total_bytes: number };

  const byType = db
    .prepare('SELECT file_type, COUNT(*) as count FROM files GROUP BY file_type')
    .all() as Array<{ file_type: string; count: number }>;

  return { ...totals, by_type: byType };
}
