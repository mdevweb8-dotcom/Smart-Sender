import crypto from 'node:crypto';
import { getDb } from '../connection.ts';

export interface FolderRecord {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string;
  is_system: number;
  created_at: string;
  file_count?: number;
}

function makeSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (ascii || 'folder') + '-' + crypto.randomBytes(3).toString('hex');
}

export function listFolders(): FolderRecord[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT f.*, COUNT(fl.id) as file_count
      FROM folders f
      LEFT JOIN files fl ON fl.folder_id = f.id
      GROUP BY f.id
      ORDER BY f.is_system DESC, f.name ASC
    `)
    .all() as unknown as FolderRecord[];
}

export function getFolderById(id: string): FolderRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRecord | undefined;
}

export function findFolderByNameOrSlug(query: string): FolderRecord | undefined {
  const db = getDb();
  const clean = query.trim();
  if (!clean) return undefined;
  return db
    .prepare('SELECT * FROM folders WHERE name = ? OR slug = ? OR name LIKE ? LIMIT 1')
    .get(clean, clean.toLowerCase(), `%${clean}%`) as FolderRecord | undefined;
}

export function createFolder(name: string, description = '', parentId: string | null = null): FolderRecord {
  const db = getDb();
  const cleanName = name.trim();
  if (!cleanName) throw new Error('اسم المجلد مطلوب');

  const existing = db.prepare('SELECT * FROM folders WHERE name = ?').get(cleanName) as
    | FolderRecord
    | undefined;
  if (existing) return existing;

  const id = crypto.randomUUID();
  const slug = makeSlug(cleanName);
  db.prepare(`
    INSERT INTO folders (id, name, slug, parent_id, description, is_system, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(id, cleanName, slug, parentId, description.trim(), new Date().toISOString());

  return getFolderById(id)!;
}

export function ensureFolder(name: string): FolderRecord {
  return findFolderByNameOrSlug(name) || createFolder(name);
}

export function renameFolder(id: string, newName: string, description?: string): FolderRecord | undefined {
  const db = getDb();
  const cleanName = newName.trim();
  if (!cleanName) throw new Error('الاسم الجديد للمجلد مطلوب');
  const existing = getFolderById(id);
  if (!existing) return undefined;

  db.prepare(`
    UPDATE folders
    SET name = ?, description = COALESCE(?, description)
    WHERE id = ?
  `).run(cleanName, description !== undefined ? description.trim() : null, id);

  return getFolderById(id);
}

export function deleteFolder(id: string): { deleted: boolean; reason?: string } {
  const db = getDb();
  const folder = getFolderById(id);
  if (!folder) return { deleted: false, reason: 'المجلد غير موجود' };
  if (folder.is_system === 1) return { deleted: false, reason: 'لا يمكن حذف مجلد نظام أساسي' };

  const count = db.prepare('SELECT COUNT(*) as cnt FROM files WHERE folder_id = ?').get(id) as {
    cnt: number;
  };
  if (count.cnt > 0) {
    return { deleted: false, reason: 'المجلد يحتوي على ملفات، انقلها أو احذفها أولاً' };
  }

  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  return { deleted: true };
}
