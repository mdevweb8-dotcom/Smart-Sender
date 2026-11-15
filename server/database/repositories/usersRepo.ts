import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../connection.ts';
import { normalizePhoneDigits, normalizePhoneE164 } from '../../config/env.ts';

export type DashboardRole = 'owner' | 'admin' | 'viewer';
export type WhatsAppRole = 'owner' | 'admin' | 'authorized' | 'unauthorized';
export type ContactPermission = 'chat' | 'view_only' | 'blocked';
export type ContactConnectionState = 'registered' | 'active' | 'pending' | 'blocked';

export interface DashboardUser {
  id: string;
  username: string;
  role: DashboardRole;
  full_name: string;
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

export interface WhatsAppUser {
  id: string;
  phone: string; // International digits without +, e.g. 2499XXXXXXXX
  phone_e164: string;
  nickname: string;
  display_name: string;
  alias: string;
  permission: ContactPermission;
  role: WhatsAppRole;
  is_active: number;
  notes: string;
  added_by: string;
  connection_state: ContactConnectionState;
  unread_count: number;
  last_chat_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapPermissionToRole(permission: ContactPermission, currentRole?: WhatsAppRole): WhatsAppRole {
  if (currentRole === 'owner') return 'owner';
  if (permission === 'blocked') return 'unauthorized';
  if (currentRole === 'admin') return 'admin';
  return 'authorized';
}

function mapRoleToPermission(role: WhatsAppRole, explicit?: ContactPermission): ContactPermission {
  if (explicit) return explicit;
  if (role === 'unauthorized') return 'blocked';
  return 'chat';
}

export function findDashboardUserByUsername(username: string) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username) as (DashboardUser & { password_hash: string }) | undefined;
}

export function findDashboardUserById(id: string): DashboardUser | undefined {
  const db = getDb();
  return db
    .prepare('SELECT id, username, role, full_name, is_active, created_at, last_login_at FROM users WHERE id = ?')
    .get(id) as DashboardUser | undefined;
}

export function listDashboardUsers(): DashboardUser[] {
  const db = getDb();
  return db
    .prepare('SELECT id, username, role, full_name, is_active, created_at, last_login_at FROM users ORDER BY created_at ASC')
    .all() as unknown as DashboardUser[];
}

export function createDashboardUser(input: {
  username: string;
  password: string;
  role: DashboardRole;
  fullName: string;
}): DashboardUser {
  const db = getDb();
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(input.password, 10);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, full_name, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(id, input.username.trim(), hash, input.role, input.fullName.trim());
  return findDashboardUserById(id)!;
}

export function deleteDashboardUser(id: string): boolean {
  const db = getDb();
  const target = findDashboardUserById(id);
  if (!target || target.role === 'owner') return false;
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return info.changes > 0;
}

export function recordDashboardLogin(id: string): void {
  const db = getDb();
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function listWhatsAppUsers(search = ''): WhatsAppUser[] {
  const db = getDb();
  const q = search.trim().toLowerCase();
  const rows = db
    .prepare(`
      SELECT * FROM authorized_users
      ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'authorized' THEN 3 ELSE 4 END, created_at ASC
    `)
    .all() as unknown as WhatsAppUser[];

  if (!q) return rows;
  return rows.filter(
    (r) =>
      (r.phone || '').toLowerCase().includes(q) ||
      (r.phone_e164 || '').toLowerCase().includes(q) ||
      (r.nickname || '').toLowerCase().includes(q) ||
      (r.alias || '').toLowerCase().includes(q) ||
      (r.display_name || '').toLowerCase().includes(q)
  );
}

export function getWhatsAppUserById(id: string): WhatsAppUser | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM authorized_users WHERE id = ?').get(id) as WhatsAppUser | undefined;
}

export function getWhatsAppUserByPhone(rawPhone: string): WhatsAppUser | undefined {
  const digits = normalizePhoneDigits(rawPhone);
  const e164 = normalizePhoneE164(rawPhone);
  if (!digits || !e164) return undefined;
  const db = getDb();
  return db
    .prepare('SELECT * FROM authorized_users WHERE phone = ? OR phone_e164 = ?')
    .get(digits, e164) as WhatsAppUser | undefined;
}

export function validateInternationalPhone(
  raw: string,
  strictNoPlus = false
): { ok: true; digits: string; e164: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (strictNoPlus) {
    if (trimmed.includes('+') || !/^[1-9]\d{7,14}$/.test(trimmed)) {
      return {
        ok: false,
        error: 'صيغة رقم الهاتف غير صحيحة. أدخل الرقم بالصيغة الدولية بدون + مثل: 249912345678',
      };
    }
    return { ok: true, digits: trimmed, e164: `+${trimmed}` };
  }

  const digits = normalizePhoneDigits(trimmed);
  if (!digits || digits.length < 8 || digits.length > 15 || !/^[1-9]\d{7,14}$/.test(digits)) {
    return {
      ok: false,
      error: 'صيغة رقم الهاتف غير صحيحة. أدخل الرقم بالصيغة الدولية بدون + مثل: 249912345678',
    };
  }
  return { ok: true, digits, e164: `+${digits}` };
}

export function createAuthorizedUserStrict(input: {
  phone: string;
  nickname: string;
  permission?: ContactPermission;
  notes?: string;
  addedBy?: string;
}): WhatsAppUser {
  const checked = validateInternationalPhone(input.phone, true);
  if (!checked.ok) {
    throw new Error(checked.error);
  }

  const existing = getWhatsAppUserByPhone(checked.digits);
  if (existing) {
    const err = new Error(`الرقم (${checked.digits}) مسجل مسبقاً باسم "${existing.nickname || existing.display_name}"`);
    (err as Error & { statusCode?: number }).statusCode = 409;
    throw err;
  }

  const nickname = input.nickname.trim();
  if (!nickname) {
    throw new Error('الاسم المستعار (nickname) مطلوب');
  }

  const permission: ContactPermission = input.permission || 'chat';
  const role: WhatsAppRole = mapPermissionToRole(permission);
  const isActive = permission === 'blocked' ? 0 : 1;
  const initialState: ContactConnectionState = permission === 'blocked' ? 'blocked' : 'registered';
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const db = getDb();
  db.prepare(`
    INSERT INTO authorized_users (
      id, phone_e164, phone, display_name, alias, nickname, role, permission,
      is_active, notes, added_by, connection_state, unread_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    checked.e164,
    checked.digits,
    nickname,
    nickname,
    nickname,
    role,
    permission,
    isActive,
    input.notes || '',
    input.addedBy || 'owner',
    initialState,
    now,
    now
  );

  return getWhatsAppUserById(id)!;
}

export function updateAuthorizedUserById(
  id: string,
  updates: {
    nickname?: string;
    permission?: ContactPermission;
    isActive?: boolean;
    notes?: string;
  }
): WhatsAppUser | undefined {
  const existing = getWhatsAppUserById(id);
  if (!existing) return undefined;

  const nextNickname = updates.nickname !== undefined ? updates.nickname.trim() || existing.nickname : existing.nickname;
  const nextPermission: ContactPermission =
    existing.role === 'owner'
      ? 'chat'
      : updates.permission || existing.permission || 'chat';
  const nextActive =
    existing.role === 'owner'
      ? 1
      : updates.isActive !== undefined
        ? updates.isActive
          ? 1
          : 0
        : existing.is_active;
  const nextRole = mapPermissionToRole(nextPermission, existing.role);
  const nextState: ContactConnectionState =
    nextPermission === 'blocked' || nextActive === 0
      ? 'blocked'
      : existing.connection_state === 'active'
        ? 'active'
        : 'registered';

  const db = getDb();
  db.prepare(`
    UPDATE authorized_users
    SET nickname = ?, alias = ?, display_name = ?, permission = ?, role = ?,
        is_active = ?, notes = ?, connection_state = ?, updated_at = ?
    WHERE id = ?
  `).run(
    nextNickname,
    nextNickname,
    nextNickname,
    nextPermission,
    nextRole,
    nextActive,
    updates.notes !== undefined ? updates.notes : existing.notes,
    nextState,
    new Date().toISOString(),
    id
  );

  return getWhatsAppUserById(id);
}

export function upsertWhatsAppUser(input: {
  phone: string;
  displayName: string;
  alias?: string;
  nickname?: string;
  role?: WhatsAppRole;
  permission?: ContactPermission;
  notes?: string;
  addedBy?: string;
  isActive?: boolean;
}): WhatsAppUser {
  const checked = validateInternationalPhone(input.phone);
  if (!checked.ok) {
    throw new Error(checked.error);
  }
  const db = getDb();
  const existing = getWhatsAppUserByPhone(checked.digits);
  const now = new Date().toISOString();
  const nextActive = input.isActive === undefined ? (existing ? existing.is_active : 1) : input.isActive ? 1 : 0;
  const resolvedRole: WhatsAppRole = input.role || (input.permission ? mapPermissionToRole(input.permission) : 'authorized');
  const resolvedPerm: ContactPermission = mapRoleToPermission(resolvedRole, input.permission);
  const resolvedNick = (input.nickname || input.alias || input.displayName || existing?.nickname || checked.digits).trim();

  if (existing) {
    const nextRole = existing.role === 'owner' ? 'owner' : resolvedRole;
    const nextPerm: ContactPermission = existing.role === 'owner' ? 'chat' : resolvedPerm;
    const nextState: ContactConnectionState =
      nextPerm === 'blocked' || nextRole === 'unauthorized' || nextActive === 0
        ? 'blocked'
        : existing.connection_state === 'active'
          ? 'active'
          : 'registered';

    db.prepare(`
      UPDATE authorized_users
      SET phone = ?, phone_e164 = ?, display_name = ?, alias = ?, nickname = ?,
          role = ?, permission = ?, is_active = ?, notes = ?, connection_state = ?, updated_at = ?
      WHERE id = ?
    `).run(
      checked.digits,
      checked.e164,
      input.displayName.trim() || resolvedNick,
      input.alias !== undefined ? input.alias.trim() : resolvedNick,
      resolvedNick,
      nextRole,
      nextPerm,
      nextActive,
      input.notes !== undefined ? input.notes : existing.notes,
      nextState,
      now,
      existing.id
    );
    return getWhatsAppUserByPhone(checked.digits)!;
  }

  const id = crypto.randomUUID();
  const initialState: ContactConnectionState =
    resolvedPerm === 'blocked' || resolvedRole === 'unauthorized' || nextActive === 0 ? 'blocked' : 'registered';
  db.prepare(`
    INSERT INTO authorized_users (
      id, phone_e164, phone, display_name, alias, nickname, role, permission,
      is_active, notes, added_by, connection_state, unread_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    checked.e164,
    checked.digits,
    input.displayName.trim() || resolvedNick,
    (input.alias || resolvedNick).trim(),
    resolvedNick,
    resolvedRole,
    resolvedPerm,
    nextActive,
    input.notes || '',
    input.addedBy || 'dashboard',
    initialState,
    now,
    now
  );
  return getWhatsAppUserByPhone(checked.digits)!;
}

export function touchContactChatActivity(rawPhone: string, incrementUnread: boolean): void {
  const digits = normalizePhoneDigits(rawPhone);
  const e164 = normalizePhoneE164(rawPhone);
  if (!digits || !e164) return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE authorized_users
    SET connection_state = 'active',
        last_chat_at = ?,
        unread_count = CASE WHEN ? = 1 THEN unread_count + 1 ELSE unread_count END,
        updated_at = ?
    WHERE (phone = ? OR phone_e164 = ?) AND permission != 'blocked' AND role != 'unauthorized' AND is_active = 1
  `).run(now, incrementUnread ? 1 : 0, now, digits, e164);
}

export function markContactChatRead(rawPhone: string): void {
  const digits = normalizePhoneDigits(rawPhone);
  const e164 = normalizePhoneE164(rawPhone);
  if (!digits || !e164) return;
  const db = getDb();
  db.prepare(`UPDATE authorized_users SET unread_count = 0 WHERE phone = ? OR phone_e164 = ?`).run(digits, e164);
}

export function deleteWhatsAppUser(id: string): boolean {
  const db = getDb();
  const row = getWhatsAppUserById(id);
  if (!row || row.role === 'owner') return false;
  const info = db.prepare('DELETE FROM authorized_users WHERE id = ?').run(id);
  return info.changes > 0;
}
