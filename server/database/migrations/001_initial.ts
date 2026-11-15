import { DatabaseSync } from 'node:sqlite';

export const migration001 = {
  id: '001_initial_schema',
  up(db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'viewer')) DEFAULT 'admin',
        full_name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS authorized_users (
        id TEXT PRIMARY KEY,
        phone_e164 TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'authorized', 'unauthorized')) DEFAULT 'authorized',
        is_active INTEGER NOT NULL DEFAULT 1,
        notes TEXT DEFAULT '',
        added_by TEXT DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        description TEXT DEFAULT '',
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        mime_type TEXT NOT NULL,
        file_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL DEFAULT '',
        storage_path TEXT NOT NULL,
        sender_phone TEXT DEFAULT '',
        sender_name TEXT DEFAULT '',
        source_group_id TEXT DEFAULT '',
        source_group_name TEXT DEFAULT '',
        ai_summary TEXT DEFAULT '',
        ai_category TEXT DEFAULT '',
        analysis_status TEXT NOT NULL CHECK(analysis_status IN ('pending', 'completed', 'failed', 'unsupported')) DEFAULT 'pending',
        transcript TEXT DEFAULT '',
        send_count INTEGER NOT NULL DEFAULT 0,
        received_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        wa_group_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        alias TEXT DEFAULT '',
        description TEXT DEFAULT '',
        member_count INTEGER NOT NULL DEFAULT 0,
        members_json TEXT DEFAULT '[]',
        is_allowed INTEGER NOT NULL DEFAULT 1,
        last_synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        task_type TEXT NOT NULL CHECK(task_type IN ('file', 'text', 'multi_file')) DEFAULT 'file',
        file_ids_json TEXT NOT NULL DEFAULT '[]',
        message_text TEXT DEFAULT '',
        destination_type TEXT NOT NULL CHECK(destination_type IN ('group', 'contact')) DEFAULT 'group',
        destination_id TEXT NOT NULL,
        destination_label TEXT NOT NULL,
        schedule_type TEXT NOT NULL CHECK(schedule_type IN ('once', 'daily', 'weekly', 'monthly', 'custom_days')) DEFAULT 'once',
        cron_days_json TEXT DEFAULT '[]',
        day_of_month INTEGER,
        time_of_day TEXT DEFAULT '',
        scheduled_at TEXT,
        next_run_at TEXT,
        timezone TEXT NOT NULL DEFAULT 'Africa/Khartoum',
        status TEXT NOT NULL CHECK(status IN ('Pending', 'Running', 'Completed', 'Failed', 'Cancelled', 'Paused')) DEFAULT 'Pending',
        requires_confirmation INTEGER NOT NULL DEFAULT 0,
        is_confirmed INTEGER NOT NULL DEFAULT 1,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        created_by_phone TEXT DEFAULT '',
        last_run_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS task_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        error_message TEXT DEFAULT '',
        details_json TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS message_logs (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
        whatsapp_message_id TEXT DEFAULT '',
        sender_phone TEXT DEFAULT '',
        recipient_id TEXT DEFAULT '',
        recipient_label TEXT DEFAULT '',
        message_type TEXT NOT NULL DEFAULT 'text',
        content_preview TEXT DEFAULT '',
        file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES scheduled_tasks(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'received',
        error_message TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_phone TEXT NOT NULL UNIQUE,
        pending_action_json TEXT DEFAULT '',
        last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversation_memory (
        id TEXT PRIMARY KEY,
        user_phone TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        context_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        is_sensitive INTEGER NOT NULL DEFAULT 0,
        description TEXT DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS system_logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error')) DEFAULT 'info',
        category TEXT NOT NULL DEFAULT 'system',
        message TEXT NOT NULL,
        meta_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
      CREATE INDEX IF NOT EXISTS idx_files_received ON files(received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_files_sender ON files(sender_phone);
      CREATE INDEX IF NOT EXISTS idx_tasks_status_next ON scheduled_tasks(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_message_logs_created ON message_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_user_created ON conversation_memory(user_phone, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_groups_alias ON groups(alias);
    `);
  },
};
