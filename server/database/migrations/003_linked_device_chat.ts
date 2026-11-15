import { DatabaseSync } from 'node:sqlite';

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export const migration003 = {
  id: '003_linked_device_chat',
  up(db: DatabaseSync) {
    // 1. Ensure requested authorized_users schema columns:
    // id, phone (international without +), nickname, permission (chat/view_only/blocked), is_active, created_at
    if (!hasColumn(db, 'authorized_users', 'phone')) {
      db.exec(`ALTER TABLE authorized_users ADD COLUMN phone TEXT DEFAULT '';`);
    }
    if (!hasColumn(db, 'authorized_users', 'nickname')) {
      db.exec(`ALTER TABLE authorized_users ADD COLUMN nickname TEXT DEFAULT '';`);
    }
    if (!hasColumn(db, 'authorized_users', 'permission')) {
      db.exec(`ALTER TABLE authorized_users ADD COLUMN permission TEXT NOT NULL DEFAULT 'chat';`);
    }

    db.exec(`
      UPDATE authorized_users
      SET phone = REPLACE(phone_e164, '+', '')
      WHERE (phone IS NULL OR phone = '') AND phone_e164 != '';

      UPDATE authorized_users
      SET nickname = COALESCE(NULLIF(alias, ''), NULLIF(display_name, ''), phone)
      WHERE nickname IS NULL OR nickname = '';

      UPDATE authorized_users
      SET permission = CASE
        WHEN role = 'unauthorized' OR is_active = 0 THEN 'blocked'
        ELSE 'chat'
      END
      WHERE permission IS NULL OR permission = '';
    `);

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_authorized_users_phone_digits
      ON authorized_users(phone) WHERE phone != '';
    `);

    // 2. Ensure requested message_logs schema columns:
    // phone, nickname, message_text, direction, interaction_type, created_at
    if (!hasColumn(db, 'message_logs', 'phone')) {
      db.exec(`ALTER TABLE message_logs ADD COLUMN phone TEXT DEFAULT '';`);
    }
    if (!hasColumn(db, 'message_logs', 'nickname')) {
      db.exec(`ALTER TABLE message_logs ADD COLUMN nickname TEXT DEFAULT '';`);
    }
    if (!hasColumn(db, 'message_logs', 'message_text')) {
      db.exec(`ALTER TABLE message_logs ADD COLUMN message_text TEXT DEFAULT '';`);
    }

    db.exec(`
      UPDATE message_logs
      SET phone = REPLACE(COALESCE(NULLIF(contact_phone, ''), NULLIF(sender_phone, ''), ''), '+', '')
      WHERE phone IS NULL OR phone = '';

      UPDATE message_logs
      SET nickname = COALESCE(NULLIF(recipient_label, ''), phone)
      WHERE nickname IS NULL OR nickname = '';

      UPDATE message_logs
      SET message_text = COALESCE(content_preview, '')
      WHERE message_text IS NULL OR message_text = '';

      CREATE INDEX IF NOT EXISTS idx_message_logs_phone_digits
      ON message_logs(phone, created_at ASC);
    `);
  },
};
