import crypto from 'node:crypto';
import { getDb } from '../connection.ts';
import { normalizePhoneE164 } from '../../config/env.ts';

export interface MemoryTurn {
  id: string;
  user_phone: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context_json: string;
  created_at: string;
}

export interface PendingAction {
  type: 'confirm_schedule' | 'confirm_send' | 'confirm_delete_file' | 'select_group' | 'select_task' | 'fill_slot';
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

const MAX_MEMORY_TURNS = 12;

export function addMemoryTurn(
  rawPhone: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  context: Record<string, unknown> = {}
): void {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return;
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversation_memory (id, user_phone, role, content, context_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), phone, role, content.slice(0, 2000), JSON.stringify(context), now);

  // Keep memory bounded per user
  db.prepare(`
    DELETE FROM conversation_memory
    WHERE user_phone = ?
      AND id NOT IN (
        SELECT id FROM conversation_memory
        WHERE user_phone = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
  `).run(phone, phone, MAX_MEMORY_TURNS);

  db.prepare(`
    INSERT INTO conversations (id, user_phone, last_message_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_phone) DO UPDATE SET last_message_at = excluded.last_message_at, updated_at = excluded.updated_at
  `).run(crypto.randomUUID(), phone, now, now);
}

export function getRecentMemory(rawPhone: string, limit = 8): MemoryTurn[] {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return [];
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT * FROM conversation_memory
      WHERE user_phone = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(phone, limit) as unknown as MemoryTurn[];
  return rows.reverse();
}

export function clearUserMemory(rawPhone: string): void {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return;
  const db = getDb();
  db.prepare('DELETE FROM conversation_memory WHERE user_phone = ?').run(phone);
  db.prepare("UPDATE conversations SET pending_action_json = '', updated_at = ? WHERE user_phone = ?").run(
    new Date().toISOString(),
    phone
  );
}

export function setPendingAction(rawPhone: string, action: PendingAction | null): void {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return;
  const db = getDb();
  const now = new Date().toISOString();
  const json = action ? JSON.stringify(action) : '';
  db.prepare(`
    INSERT INTO conversations (id, user_phone, pending_action_json, last_message_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_phone) DO UPDATE SET pending_action_json = excluded.pending_action_json, updated_at = excluded.updated_at
  `).run(crypto.randomUUID(), phone, json, now, now);
}

export function getPendingAction(rawPhone: string): PendingAction | null {
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT pending_action_json FROM conversations WHERE user_phone = ?')
    .get(phone) as { pending_action_json: string } | undefined;
  if (!row || !row.pending_action_json) return null;

  try {
    const parsed = JSON.parse(row.pending_action_json) as PendingAction;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
      setPendingAction(phone, null);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
