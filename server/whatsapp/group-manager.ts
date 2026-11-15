import {
  findGroupsByQuery,
  getGroupById,
  listGroups,
  updateGroupAlias,
  upsertGroup,
  type GroupRecord,
} from '../database/repositories/groupsRepo.ts';
import { logSystem } from '../database/repositories/logsRepo.ts';
import { type WhatsAppTransport } from './provider.ts';

export type GroupResolutionResult =
  | { status: 'found'; group: GroupRecord }
  | { status: 'ambiguous'; candidates: GroupRecord[] }
  | { status: 'not_found' };

export async function syncGroupsFromTransport(transport: WhatsAppTransport): Promise<GroupRecord[]> {
  try {
    const remoteGroups = await transport.fetchGroups();
    for (const g of remoteGroups) {
      upsertGroup({
        waGroupId: g.waGroupId,
        name: g.name,
        description: g.description,
        memberCount: g.memberCount,
        members: g.members,
      });
    }
    if (remoteGroups.length > 0) {
      logSystem('info', 'whatsapp', `تمت مزامنة ${remoteGroups.length} مجموعة واتساب`);
    }
  } catch (err) {
    logSystem('warn', 'whatsapp', 'تعذر مزامنة المجموعات من واتساب', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return listGroups();
}

/**
 * Resolves a destination query (alias, group name, or WA group ID) safely.
 * Never guesses if multiple groups match the same query!
 */
export function resolveTargetGroup(query: string): GroupResolutionResult {
  const clean = (query || '').trim();
  if (!clean) return { status: 'not_found' };

  const byId = getGroupById(clean);
  if (byId) return { status: 'found', group: byId };

  const matches = findGroupsByQuery(clean);
  if (matches.length === 1) return { status: 'found', group: matches[0] };
  if (matches.length > 1) {
    // Prefer exact alias match if unique
    const exactAlias = matches.filter((m) => m.alias.toLowerCase() === clean.toLowerCase());
    if (exactAlias.length === 1) return { status: 'found', group: exactAlias[0] };
    return { status: 'ambiguous', candidates: matches };
  }
  return { status: 'not_found' };
}

export function assignGroupAlias(groupIdOrName: string, alias: string): GroupRecord | null {
  const res = resolveTargetGroup(groupIdOrName);
  if (res.status !== 'found') return null;
  return updateGroupAlias(res.group.id, alias) || null;
}
