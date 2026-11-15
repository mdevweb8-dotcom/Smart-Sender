import { backup as sqliteBackup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.ts';
import { closeDatabase, getCurrentDbPath, getDb, openDatabase } from '../database/connection.ts';
import { getSettingNumber } from '../database/repositories/settingsRepo.ts';
import { logSystem } from '../database/repositories/logsRepo.ts';

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export async function createDatabaseBackup(label = 'manual'): Promise<BackupInfo> {
  const dbPath = getCurrentDbPath();
  if (dbPath === ':memory:') {
    throw new Error('النسخ الاحتياطي غير مدعوم لقاعدة البيانات المؤقتة في الذاكرة');
  }

  fs.mkdirSync(config.backupPath, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `smart-sender-${safeLabel}-${stamp}.sqlite`;
  const destPath = path.resolve(config.backupPath, filename);

  const db = getDb();
  await sqliteBackup(db, destPath);

  pruneOldBackups();

  const stat = fs.statSync(destPath);
  logSystem('info', 'database', 'تم إنشاء نسخة احتياطية لقاعدة البيانات بنجاح', {
    filename,
    sizeBytes: stat.size,
  });

  return {
    filename,
    sizeBytes: stat.size,
    createdAt: stat.birthtime.toISOString(),
  };
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(config.backupPath)) return [];
  const entries = fs.readdirSync(config.backupPath);
  return entries
    .filter((name) => name.endsWith('.sqlite'))
    .map((filename) => {
      const full = path.join(config.backupPath, filename);
      const stat = fs.statSync(full);
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveSafeBackupPath(filename: string): string {
  const cleanName = path.basename(filename);
  if (!cleanName.endsWith('.sqlite') || cleanName !== filename) {
    throw new Error('اسم ملف النسخة الاحتياطية غير صالح');
  }
  const base = path.resolve(config.backupPath);
  const resolved = path.resolve(base, cleanName);
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error('محاولة وصول غير مصرح بها لمسار النسخ الاحتياطي');
  }
  return resolved;
}

export async function restoreDatabaseBackup(filename: string): Promise<void> {
  const backupFile = resolveSafeBackupPath(filename);
  if (!fs.existsSync(backupFile)) {
    throw new Error('ملف النسخة الاحتياطية غير موجود');
  }
  const currentPath = getCurrentDbPath();
  if (currentPath === ':memory:') {
    throw new Error('لا يمكن استعادة نسخة احتياطية فوق قاعدة بيانات في الذاكرة');
  }

  // Create a safety pre-restore snapshot first
  await createDatabaseBackup('pre-restore');

  closeDatabase();
  fs.copyFileSync(backupFile, currentPath);
  openDatabase(currentPath);

  logSystem('warn', 'database', 'تمت استعادة قاعدة البيانات من نسخة احتياطية', { filename });
}

function pruneOldBackups(): void {
  const retention = Math.max(2, getSettingNumber('backup_retention_count', 10));
  const backups = listBackups();
  if (backups.length <= retention) return;
  for (const old of backups.slice(retention)) {
    try {
      fs.unlinkSync(resolveSafeBackupPath(old.filename));
    } catch {
      // ignore cleanup error
    }
  }
}
