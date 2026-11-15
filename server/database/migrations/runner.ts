import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config, normalizePhoneDigits, normalizePhoneE164 } from '../../config/env.ts';
import { getDb } from '../connection.ts';
import { migration001 } from './001_initial.ts';
import { migration002 } from './002_direct_chat.ts';
import { migration003 } from './003_linked_device_chat.ts';

const DEFAULT_FOLDERS = [
  { name: 'المحاضرات', slug: 'lectures', description: 'ملفات المحاضرات والعروض التقديمية والمقررات' },
  { name: 'الدراسة', slug: 'study', description: 'ملخصات الدراسة والواجبات والمراجعات' },
  { name: 'المستندات', slug: 'documents', description: 'الوثائق الرسمية والتقارير والكتب' },
  { name: 'الصور', slug: 'images', description: 'الصور واللقطات والمخططات' },
  { name: 'الفيديوهات', slug: 'videos', description: 'المقاطع المرئية والشروحات المسجلة' },
  { name: 'الصوتيات', slug: 'audio', description: 'التسجيلات الصوتية والملاحظات الصوتية' },
  { name: 'الملفات الشخصية', slug: 'personal', description: 'الملفات الخاصة والمهمة' },
  { name: 'الأرشيف', slug: 'archive', description: 'الملفات المؤرشفة القديمة' },
];

export function runMigrations(db: DatabaseSync = getDb()): void {
  const migrations = [migration001, migration002, migration003];

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const checkStmt = db.prepare('SELECT id FROM migrations WHERE id = ?');
  const insertMig = db.prepare('INSERT INTO migrations (id) VALUES (?)');

  for (const mig of migrations) {
    const existing = checkStmt.get(mig.id) as { id: string } | undefined;
    if (!existing) {
      db.exec('BEGIN IMMEDIATE');
      try {
        mig.up(db);
        insertMig.run(mig.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  seedInitialDefaults(db);
}

function seedInitialDefaults(db: DatabaseSync): void {
  // 1. Seed default folders idempotently
  const insertFolder = db.prepare(`
    INSERT OR IGNORE INTO folders (id, name, slug, description, is_system)
    VALUES (?, ?, ?, ?, 1)
  `);
  for (const folder of DEFAULT_FOLDERS) {
    insertFolder.run(crypto.randomUUID(), folder.name, folder.slug, folder.description);
  }

  // 2. Seed initial dashboard owner/admin user if users table is empty
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (userCount.cnt === 0) {
    const hash = bcrypt.hashSync(config.dashboardAdminPass, 10);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, full_name, is_active)
      VALUES (?, ?, ?, 'owner', ?, 1)
    `).run(crypto.randomUUID(), config.dashboardAdminUser, hash, config.ownerName || 'Mohammed Asim');
  }

  // 3. Seed owner WhatsApp phone idempotently
  const ownerE164 = normalizePhoneE164(config.ownerPhone);
  const ownerDigits = normalizePhoneDigits(config.ownerPhone);
  if (ownerE164) {
    db.prepare(`
      INSERT OR IGNORE INTO authorized_users (
        id, phone_e164, phone, display_name, alias, nickname, role, permission, is_active, notes, added_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'owner', 'chat', 1, 'مالك النظام الرئيسي', 'system')
    `).run(
      crypto.randomUUID(),
      ownerE164,
      ownerDigits,
      config.ownerName || 'Owner',
      config.ownerName || 'Owner',
      config.ownerName || 'Owner'
    );
  }

  // 4. Seed configurable settings without overwriting user edits
  const defaultSettings: Array<[string, string, string]> = [
    ['whatsapp_bot_phone', config.whatsappBotPhone || '', 'رقم واتساب الجهاز المرتبط (بدون +)'],
    ['owner_phone', ownerE164 || '+249900000000', 'رقم واتساب مالك النظام بصيغة دولية'],
    ['timezone', config.timezone, 'المنطقة الزمنية الافتراضية للجدولة'],
    ['gemini_model', config.geminiModel, 'نموذج Gemini المستخدم في تحليل الأوامر والملفات'],
    ['gemini_timeout_ms', String(config.geminiTimeoutMs), 'مهلة اتصال Gemini بالمللي ثانية'],
    ['storage_path', config.storagePath, 'مسار حفظ الملفات المستلمة على السيرفر'],
    ['whatsapp_session_path', config.whatsappSessionPath, 'مسار حفظ جلسة واتساب الدائمة (LocalAuth)'],
    ['max_file_size_mb', String(config.maxFileSizeMb), 'الحد الأقصى لحجم الملف بالميجابايت'],
    ['whatsapp_reconnect_enabled', 'true', 'تفعيل إعادة الاتصال التلقائي عند انقطاع الشبكة'],
    ['whatsapp_reconnect_max_retries', '10', 'عدد محاولات إعادة الاتصال قبل التوقف المؤقت'],
    ['scheduler_poll_ms', String(config.schedulerPollMs), 'فترة فحص المهام المجدولة بالمللي ثانية'],
    ['require_confirmation_group_send', 'true', 'طلب تأكيد صريح قبل الإرسال للمجموعات'],
    ['backup_retention_count', '10', 'عدد النسخ الاحتياطية المحفوظة تلقائياً'],
  ];

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, is_sensitive, description)
    VALUES (?, ?, 0, ?)
  `);
  for (const [k, v, desc] of defaultSettings) {
    insertSetting.run(k, v, desc);
  }
}
