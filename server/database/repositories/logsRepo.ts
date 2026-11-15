import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, normalizePhoneDigits } from '../../config/env.ts';
import { getDb } from '../connection.ts';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory =
  | 'whatsapp'
  | 'gemini'
  | 'files'
  | 'database'
  | 'scheduler'
  | 'sender'
  | 'auth'
  | 'system';

function redactSecrets(input: string): string {
  if (!input) return '';
  let out = input
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+)[A-Za-z0-9\-_.]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(password|passwd|secret|token|apiKey|api_key)\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]');
  if (config.geminiApiKey && config.geminiApiKey.length > 6) {
    out = out.split(config.geminiApiKey).join('[REDACTED_GEMINI_KEY]');
  }
  if (config.jwtSecret && config.jwtSecret.length > 8) {
    out = out.split(config.jwtSecret).join('[REDACTED_JWT_SECRET]');
  }
  return out;
}

export function logSystem(
  level: LogLevel,
  category: LogCategory,
  message: string,
  meta: Record<string, unknown> = {}
): void {
  const safeMessage = redactSecrets(message);
  const safeMetaJson = redactSecrets(JSON.stringify(meta));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO system_logs (id, level, category, message, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, level, category, safeMessage, safeMetaJson, now);
  } catch {
    // Fallback if DB isn't open yet
  }

  try {
    if (config.logPath && fs.existsSync(config.logPath)) {
      const line = JSON.stringify({ ts: now, level, category, message: safeMessage }) + '\n';
      fs.appendFileSync(path.join(config.logPath, 'smart-sender.log'), line, 'utf8');
    }
  } catch {
    // ignore file logging error
  }
}

export function listSystemLogs(options: { level?: string; category?: string; limit?: number } = {}) {
  const db = getDb();
  const limit = Math.min(500, Math.max(1, options.limit || 100));
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.level && options.level !== 'all') {
    conditions.push('level = ?');
    params.push(options.level);
  }
  if (options.category && options.category !== 'all') {
    conditions.push('category = ?');
    params.push(options.category);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM system_logs ${whereClause} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit);
}

export type MessageInteractionType =
  | 'live_chat'
  | 'bot_auto'
  | 'unauthorized_attempt'
  | 'direct_chat'
  | 'bot_command'
  | 'scheduled'
  | 'file_upload'
  | 'system_reply';

export interface CreateMessageLogInput {
  direction: 'inbound' | 'outbound';
  whatsappMessageId?: string;
  senderPhone?: string;
  recipientId?: string;
  recipientLabel?: string;
  contactPhone?: string;
  phone?: string;
  nickname?: string;
  messageText?: string;
  interactionType?: MessageInteractionType;
  messageType?: string;
  contentPreview?: string;
  fileId?: string | null;
  taskId?: string | null;
  status?: string;
  errorMessage?: string;
}

export function logMessage(input: CreateMessageLogInput): string {
  const db = getDb();
  const id = crypto.randomUUID();

  const inferredContact =
    input.contactPhone ||
    (input.phone ? `+${normalizePhoneDigits(input.phone)}` : '') ||
    (input.direction === 'inbound'
      ? input.senderPhone || ''
      : input.recipientId && !input.recipientId.includes('@g.us')
        ? input.recipientId.replace(/@c\.us$/i, '')
        : '');

  const digitsPhone =
    normalizePhoneDigits(input.phone || '') ||
    normalizePhoneDigits(inferredContact) ||
    normalizePhoneDigits(input.senderPhone || '') ||
    (input.recipientId && !input.recipientId.includes('@g.us') ? normalizePhoneDigits(input.recipientId) : '');

  const safeText = redactSecrets((input.messageText ?? input.contentPreview ?? '').slice(0, 2000));
  const safeNickname = input.nickname || input.recipientLabel || digitsPhone;

  db.prepare(`
    INSERT INTO message_logs (
      id, direction, whatsapp_message_id, sender_phone, recipient_id,
      recipient_label, contact_phone, phone, nickname, message_text,
      interaction_type, message_type, content_preview, file_id, task_id,
      status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.direction,
    input.whatsappMessageId || '',
    input.senderPhone || (digitsPhone ? `+${digitsPhone}` : ''),
    input.recipientId || '',
    input.recipientLabel || safeNickname,
    inferredContact,
    digitsPhone,
    safeNickname,
    safeText,
    input.interactionType || 'bot_auto',
    input.messageType || 'text',
    safeText.slice(0, 1500),
    input.fileId || null,
    input.taskId || null,
    input.status || (input.direction === 'inbound' ? 'received' : 'sent'),
    redactSecrets(input.errorMessage || ''),
    new Date().toISOString()
  );
  return id;
}

export function listMessageLogs(
  options: { direction?: string; status?: string; interactionType?: string; limit?: number } = {}
) {
  const db = getDb();
  const limit = Math.min(500, Math.max(1, options.limit || 100));
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.direction && options.direction !== 'all') {
    conditions.push('m.direction = ?');
    params.push(options.direction);
  }
  if (options.status && options.status !== 'all') {
    conditions.push('m.status = ?');
    params.push(options.status);
  }
  if (options.interactionType && options.interactionType !== 'all') {
    conditions.push('m.interaction_type = ?');
    params.push(options.interactionType);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db
    .prepare(`
      SELECT m.*, f.original_name as file_name
      FROM message_logs m
      LEFT JOIN files f ON f.id = m.file_id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ?
    `)
    .all(...params, limit);
}

export function getDirectChatThread(rawPhone: string, limit = 150) {
  const db = getDb();
  const digits = normalizePhoneDigits(rawPhone);
  const phoneE164 = `+${digits}`;
  const safeLimit = Math.min(300, Math.max(1, limit));
  const rows = db
    .prepare(`
      SELECT m.*, f.original_name as file_name
      FROM message_logs m
      LEFT JOIN files f ON f.id = m.file_id
      WHERE (m.phone = ?
         OR m.contact_phone = ?
         OR m.sender_phone = ?
         OR m.recipient_id = ?)
        AND m.interaction_type != 'unauthorized_attempt'
      ORDER BY m.created_at DESC
      LIMIT ?
    `)
    .all(digits, phoneE164, phoneE164, `${digits}@c.us`, safeLimit);
  return rows.reverse();
}
