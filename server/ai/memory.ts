import {
  addMemoryTurn,
  clearUserMemory,
  getPendingAction,
  getRecentMemory,
  setPendingAction,
  type PendingAction,
} from '../database/repositories/memoryRepo.ts';

export { addMemoryTurn, clearUserMemory, getPendingAction, getRecentMemory, setPendingAction };
export type { PendingAction };

export function createPendingAction(
  userPhone: string,
  type: PendingAction['type'],
  payload: Record<string, unknown>,
  ttlMinutes = 15
): PendingAction {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  const action: PendingAction = {
    type,
    payload,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  setPendingAction(userPhone, action);
  return action;
}

export function getLastReferencedFileId(userPhone: string): string | undefined {
  const turns = getRecentMemory(userPhone, 8);
  for (let i = turns.length - 1; i >= 0; i--) {
    try {
      const ctx = JSON.parse(turns[i].context_json || '{}');
      if (typeof ctx.fileId === 'string' && ctx.fileId) {
        return ctx.fileId;
      }
    } catch {
      // ignore invalid JSON
    }
  }
  return undefined;
}
