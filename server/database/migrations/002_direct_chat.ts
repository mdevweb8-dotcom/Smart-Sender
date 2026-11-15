import { DatabaseSync } from 'node:sqlite';

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export const migration002 = {
  id: '002_direct_chat_and_contacts',
  up(db: DatabaseSync) {
    if (!hasColumn(db, 'message_logs', 'interaction_type')) {
      db.exec(`ALTER TABLE message_logs ADD COLUMN interaction_type TEXT NOT NULL DEFAULT 'bot_command';`);
    }
    if (!hasColumn(db, 'message_logs', 'contact_phone')) {
      db.exec(`ALTER TABLE message_logs ADD COLUMN contact_phone TEXT DEFAULT '';`);
    }

    if (!hasColumn(db, 'authorized_users', 'alias')) {
      db.exec(`ALTER TABLE authorized_users ADD COLUMN alias TEXT DEFAULT '';`);
    }
    if (!hasColumn(db, 'authorized_users', 'connection_state')) {
      db.exec(`ALTER TABLE authorized_users ADD COLUMN connection_state TEXT NOT NULL DEFAULT 'registered';`);
    }
    if (!hasColumn(db, 'authorized_users', 'unread_count')) {
      db.exec(`ALTER TABLE authorized_users ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!hasColumn(db, 'authorized_users', 'last_chat_at')) {
      db.exec(`ALTER TABLE authorized_users ADD COLUMN last_chat_at TEXT;`);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_message_logs_contact ON message_logs(contact_phone, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_message_logs_interaction ON message_logs(interaction_type, created_at DESC);
    `);
  },
};
