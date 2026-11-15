import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { config } from '../config/env.ts';
import { getSetting, getSettingNumber } from '../database/repositories/settingsRepo.ts';
import {
  createFileRecord,
  deleteFileRecord,
  getFileById,
  updateFileMetadata,
  type FileRecord,
} from '../database/repositories/filesRepo.ts';
import { ensureFolder, getFolderById } from '../database/repositories/foldersRepo.ts';
import { logSystem } from '../database/repositories/logsRepo.ts';

export type LogicalFileType = 'pdf' | 'document' | 'spreadsheet' | 'text' | 'image' | 'audio' | 'video' | 'other';

const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'text/'];
const ALLOWED_EXACT_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/json',
  'application/zip',
  'application/x-rar-compressed',
  'application/octet-stream',
]);

export function getStorageRoot(): string {
  const configured = getSetting('storage_path', config.storagePath);
  const resolved = path.resolve(configured || config.storagePath);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function resolveSafeStoragePath(relativeOrFull: string): string {
  const root = getStorageRoot();
  const target = path.isAbsolute(relativeOrFull)
    ? path.resolve(relativeOrFull)
    : path.resolve(root, relativeOrFull);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('مسار الملف غير مصرح به (تم منع Path Traversal)');
  }
  return target;
}

export function detectLogicalFileType(mimeType: string, filename: string): LogicalFileType {
  const ext = path.extname(filename).toLowerCase();
  const m = (mimeType || '').toLowerCase();

  if (m === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (m.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return 'image';
  if (m.startsWith('audio/') || ['.mp3', '.ogg', '.opus', '.wav', '.m4a', '.aac'].includes(ext)) return 'audio';
  if (m.startsWith('video/') || ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video';
  if (
    m.includes('spreadsheet') ||
    m.includes('excel') ||
    ['.xlsx', '.xls', '.csv'].includes(ext)
  ) {
    return 'spreadsheet';
  }
  if (
    m.includes('wordprocessingml') ||
    m === 'application/msword' ||
    m.includes('presentation') ||
    ['.doc', '.docx', '.ppt', '.pptx'].includes(ext)
  ) {
    return 'document';
  }
  if (m.startsWith('text/') || m === 'application/json' || ['.txt', '.md', '.json', '.log'].includes(ext)) {
    return 'text';
  }
  return 'other';
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return base || `file-${Date.now()}`;
}

export function validateIncomingFile(buffer: Buffer, mimeType: string, originalName: string): void {
  const maxMb = getSettingNumber('max_file_size_mb', config.maxFileSizeMb);
  const maxBytes = maxMb * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error(`حجم الملف (${(buffer.length / 1024 / 1024).toFixed(1)} MB) يتجاوز الحد المسموح (${maxMb} MB).`);
  }
  if (buffer.length === 0) {
    throw new Error('الملف فارغ ولا يمكن حفظه.');
  }
  const cleanMime = (mimeType || mime.lookup(originalName) || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const allowed =
    ALLOWED_EXACT_MIMES.has(cleanMime) || ALLOWED_MIME_PREFIXES.some((prefix) => cleanMime.startsWith(prefix));
  if (!allowed) {
    throw new Error(`نوع الملف (${cleanMime}) غير مدعوم لأسباب أمنية.`);
  }
}

function getUniqueTargetPath(dir: string, desiredName: string): { storedName: string; fullPath: string } {
  const safeName = sanitizeFilename(desiredName);
  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;

  let candidate = safeName;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stem} (${counter})${ext}`;
    counter += 1;
  }
  const fullPath = resolveSafeStoragePath(path.join(dir, candidate));
  return { storedName: candidate, fullPath };
}

export interface SaveIncomingFileInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folderName?: string;
  folderId?: string;
  senderPhone?: string;
  senderName?: string;
  sourceGroupId?: string;
  sourceGroupName?: string;
}

export function saveIncomingFile(input: SaveIncomingFileInput): FileRecord {
  const cleanMime = (input.mimeType || mime.lookup(input.originalName) || 'application/octet-stream')
    .split(';')[0]
    .trim()
    .toLowerCase();

  validateIncomingFile(input.buffer, cleanMime, input.originalName);

  const fileType = detectLogicalFileType(cleanMime, input.originalName);
  const folder = input.folderId
    ? getFolderById(input.folderId)
    : ensureFolder(input.folderName || 'المستندات');

  const root = getStorageRoot();
  const folderSlugDir = path.join(root, folder ? folder.slug : 'uncategorized');
  fs.mkdirSync(folderSlugDir, { recursive: true });

  const { storedName, fullPath } = getUniqueTargetPath(folderSlugDir, input.originalName);
  fs.writeFileSync(fullPath, input.buffer);

  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const record = createFileRecord({
    originalName: sanitizeFilename(input.originalName),
    storedName,
    folderId: folder ? folder.id : null,
    mimeType: cleanMime,
    fileType,
    sizeBytes: input.buffer.length,
    sha256,
    storagePath: fullPath,
    senderPhone: input.senderPhone || '',
    senderName: input.senderName || '',
    sourceGroupId: input.sourceGroupId || '',
    sourceGroupName: input.sourceGroupName || '',
    analysisStatus: 'pending',
  });

  logSystem('info', 'files', `تم حفظ الملف: ${record.original_name}`, {
    fileId: record.id,
    folder: folder?.name || 'غير مصنف',
    sizeBytes: record.size_bytes,
  });

  return record;
}

export function moveFileToFolder(fileId: string, targetFolderIdOrName: string): FileRecord | undefined {
  const file = getFileById(fileId);
  if (!file) return undefined;

  const targetFolder = getFolderById(targetFolderIdOrName) || ensureFolder(targetFolderIdOrName);
  const root = getStorageRoot();
  const destDir = path.join(root, targetFolder.slug);
  fs.mkdirSync(destDir, { recursive: true });

  const currentPath = resolveSafeStoragePath(file.storage_path);
  if (fs.existsSync(currentPath)) {
    const { storedName, fullPath } = getUniqueTargetPath(destDir, file.original_name);
    fs.renameSync(currentPath, fullPath);
    const dbRecord = updateFileMetadata(file.id, { folder_id: targetFolder.id });
    // Also update storage_path & stored_name directly
    if (dbRecord) {
      updateStoredPath(file.id, storedName, fullPath);
    }
  } else {
    updateFileMetadata(file.id, { folder_id: targetFolder.id });
  }
  return getFileById(file.id);
}

export function copyFileToFolder(fileId: string, targetFolderIdOrName: string): FileRecord | undefined {
  const file = getFileById(fileId);
  if (!file) return undefined;
  const currentPath = resolveSafeStoragePath(file.storage_path);
  if (!fs.existsSync(currentPath)) {
    throw new Error('الملف الفعلي غير موجود على القرص');
  }
  const buffer = fs.readFileSync(currentPath);
  return saveIncomingFile({
    buffer,
    originalName: file.original_name,
    mimeType: file.mime_type,
    folderName: targetFolderIdOrName,
    senderPhone: file.sender_phone,
    senderName: file.sender_name,
    sourceGroupId: file.source_group_id,
    sourceGroupName: file.source_group_name,
  });
}

function updateStoredPath(fileId: string, storedName: string, storagePath: string): void {
  // Imported lazily to avoid circular imports
  import('../database/connection.ts').then(({ getDb }) => {
    getDb()
      .prepare('UPDATE files SET stored_name = ?, storage_path = ?, updated_at = ? WHERE id = ?')
      .run(storedName, storagePath, new Date().toISOString(), fileId);
  });
}

export function deleteFileCompletely(fileId: string): boolean {
  const file = getFileById(fileId);
  if (!file) return false;

  try {
    const safePath = resolveSafeStoragePath(file.storage_path);
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
    }
  } catch (err) {
    logSystem('warn', 'files', 'تعذر حذف الملف من القرص', {
      fileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return deleteFileRecord(fileId);
}
