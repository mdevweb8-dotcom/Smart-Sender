import crypto from 'node:crypto';
import { getDb } from '../connection.ts';

export interface GroupRecord {
  id: string;
  wa_group_id: string;
  name: string;
  alias: string;
  description: string;
  member_count: number;
  members_json: string;
  is_allowed: number;
  last_synced_at: string | null;
  created_at: string;
}

export function listGroups(search = ''): GroupRecord[] {
  const db = getDb();
  if (search.trim()) {
    const term = `%${search.trim()}%`;
    return db
      .prepare('SELECT * FROM groups WHERE name LIKE ? OR alias LIKE ? OR wa_group_id LIKE ? ORDER BY name ASC')
      .all(term, term, term) as unknown as GroupRecord[];
  }
  return db.prepare('SELECT * FROM groups ORDER BY name ASC').all() as unknown as GroupRecord[];
}

export function getGroupById(id: string): GroupRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM groups WHERE id = ? OR wa_group_id = ?').get(id, id) as
    | GroupRecord
    | undefined;
}

export function findGroupsByQuery(query: string): GroupRecord[] {
  const db = getDb();
  const clean = query.trim();
  if (!clean) return [];
  const exact = db
    .prepare('SELECT * FROM groups WHERE wa_group_id = ? OR LOWER(alias) = LOWER(?) OR LOWER(name) = LOWER(?)')
    .all(clean, clean, clean) as unknown as GroupRecord[];
  if (exact.length > 0) return exact;

  const term = `%${clean}%`;
  return db
    .prepare('SELECT * FROM groups WHERE alias LIKE ? OR name LIKE ? ORDER BY name ASC')
    .all(term, term) as unknown as GroupRecord[];
}

export function upsertGroup(input: {
  waGroupId: string;
  name: string;
  alias?: string;
  description?: string;
  memberCount?: number;
  members?: Array<{ id: string; name?: string; isAdmin?: boolean }>;
  isAllowed?: boolean;
}): GroupRecord {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM groups WHERE wa_group_id = ?').get(input.waGroupId) as
    | GroupRecord
    | undefined;
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE groups SET
        name = ?,
        alias = COALESCE(NULLIF(?, ''), alias),
        description = COALESCE(?, description),
        member_count = COALESCE(?, member_count),
        members_json = COALESCE(?, members_json),
        is_allowed = COALESCE(?, is_allowed),
        last_synced_at = ?
      WHERE id = ?
    `).run(
      input.name.trim() || existing.name,
      input.alias !== undefined ? input.alias.trim() : '',
      input.description !== undefined ? input.description : null,
      input.memberCount !== undefined ? input.memberCount : null,
      input.members !== undefined ? JSON.stringify(input.members) : null,
      input.isAllowed !== undefined ? (input.isAllowed ? 1 : 0) : null,
      now,
      existing.id
    );
    return getGroupById(existing.id)!;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO groups (
      id, wa_group_id, name, alias, description, member_count, members_json, is_allowed, last_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.waGroupId,
    input.name.trim(),
    (input.alias || '').trim(),
    input.description || '',
    input.memberCount ?? (input.members ? input.members.length : 0),
    JSON.stringify(input.members || []),
    input.isAllowed === false ? 0 : 1,
    now,
    now
  );
  return getGroupById(id)!;
}

export function updateGroupAlias(idOrWaId: string, alias: string, isAllowed?: boolean): GroupRecord | undefined {
  const db = getDb();
  const group = getGroupById(idOrWaId);
  if (!group) return undefined;

  db.prepare(`
    UPDATE groups
    SET alias = ?, is_allowed = COALESCE(?, is_allowed)
    WHERE id = ?
  `).run(alias.trim(), isAllowed !== undefined ? (isAllowed ? 1 : 0) : null, group.id);

  return getGroupById(group.id);
}
