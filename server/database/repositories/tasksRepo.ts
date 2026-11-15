import crypto from 'node:crypto';
import { getDb } from '../connection.ts';

export type TaskStatus = 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Cancelled' | 'Paused';
export type ScheduleType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom_days';
export type TaskType = 'file' | 'text' | 'multi_file';

export interface ScheduledTaskRecord {
  id: string;
  title: string;
  task_type: TaskType;
  file_ids_json: string;
  message_text: string;
  destination_type: 'group' | 'contact';
  destination_id: string;
  destination_label: string;
  schedule_type: ScheduleType;
  cron_days_json: string;
  day_of_month: number | null;
  time_of_day: string;
  scheduled_at: string | null;
  next_run_at: string | null;
  timezone: string;
  status: TaskStatus;
  requires_confirmation: number;
  is_confirmed: number;
  retry_count: number;
  max_retries: number;
  created_by_phone: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  taskType: TaskType;
  fileIds?: string[];
  messageText?: string;
  destinationType: 'group' | 'contact';
  destinationId: string;
  destinationLabel: string;
  scheduleType: ScheduleType;
  cronDays?: string[];
  dayOfMonth?: number | null;
  timeOfDay?: string;
  scheduledAt?: string | null;
  nextRunAt: string | null;
  timezone?: string;
  requiresConfirmation?: boolean;
  isConfirmed?: boolean;
  createdByPhone?: string;
  status?: TaskStatus;
}

export function createScheduledTask(input: CreateTaskInput): ScheduledTaskRecord {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO scheduled_tasks (
      id, title, task_type, file_ids_json, message_text, destination_type,
      destination_id, destination_label, schedule_type, cron_days_json,
      day_of_month, time_of_day, scheduled_at, next_run_at, timezone,
      status, requires_confirmation, is_confirmed, retry_count, max_retries,
      created_by_phone, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 3, ?, ?, ?)
  `).run(
    id,
    input.title.trim(),
    input.taskType,
    JSON.stringify(input.fileIds || []),
    input.messageText || '',
    input.destinationType,
    input.destinationId,
    input.destinationLabel,
    input.scheduleType,
    JSON.stringify(input.cronDays || []),
    input.dayOfMonth ?? null,
    input.timeOfDay || '',
    input.scheduledAt || null,
    input.nextRunAt,
    input.timezone || 'Africa/Khartoum',
    input.status || 'Pending',
    input.requiresConfirmation ? 1 : 0,
    input.isConfirmed === false ? 0 : 1,
    input.createdByPhone || '',
    now,
    now
  );

  return getTaskById(id)!;
}

export function getTaskById(id: string): ScheduledTaskRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTaskRecord
    | undefined;
}

export function listScheduledTasks(options: { status?: string; search?: string; limit?: number } = {}): ScheduledTaskRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.status && options.status !== 'all') {
    conditions.push('status = ?');
    params.push(options.status);
  }
  if (options.search && options.search.trim()) {
    const term = `%${options.search.trim()}%`;
    conditions.push('(title LIKE ? OR destination_label LIKE ? OR message_text LIKE ?)');
    params.push(term, term, term);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, options.limit || 200));
  return db
    .prepare(`SELECT * FROM scheduled_tasks ${where} ORDER BY COALESCE(next_run_at, created_at) ASC LIMIT ?`)
    .all(...params, limit) as unknown as ScheduledTaskRecord[];
}

export function findTasksByQuery(query: string): ScheduledTaskRecord[] {
  const db = getDb();
  const term = `%${query.trim()}%`;
  return db
    .prepare(`
      SELECT * FROM scheduled_tasks
      WHERE status IN ('Pending', 'Paused')
        AND (title LIKE ? OR destination_label LIKE ? OR message_text LIKE ?)
      ORDER BY created_at DESC
    `)
    .all(term, term, term) as unknown as ScheduledTaskRecord[];
}

export function updateScheduledTask(
  id: string,
  updates: Partial<{
    title: string;
    message_text: string;
    destination_type: 'group' | 'contact';
    destination_id: string;
    destination_label: string;
    schedule_type: ScheduleType;
    cron_days_json: string;
    day_of_month: number | null;
    time_of_day: string;
    scheduled_at: string | null;
    next_run_at: string | null;
    timezone: string;
    status: TaskStatus;
    is_confirmed: number;
    file_ids_json: string;
    retry_count: number;
    last_run_at: string;
  }>
): ScheduledTaskRecord | undefined {
  const db = getDb();
  const existing = getTaskById(id);
  if (!existing) return undefined;

  const setClauses: string[] = ['updated_at = ?'];
  const params: Array<string | number | null> = [new Date().toISOString()];

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      setClauses.push(`${key} = ?`);
      params.push(val as string | number | null);
    }
  }

  params.push(id);
  db.prepare(`UPDATE scheduled_tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  return getTaskById(id);
}

export function getDuePendingTasks(nowIso: string = new Date().toISOString()): ScheduledTaskRecord[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM scheduled_tasks
      WHERE status = 'Pending'
        AND is_confirmed = 1
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC
    `)
    .all(nowIso) as unknown as ScheduledTaskRecord[];
}

/**
 * Atomic state transition Pending -> Running to prevent duplicate execution
 */
export function claimTaskForExecution(id: string): boolean {
  const db = getDb();
  const info = db
    .prepare(`
      UPDATE scheduled_tasks
      SET status = 'Running', updated_at = ?
      WHERE id = ? AND status = 'Pending' AND is_confirmed = 1
    `)
    .run(new Date().toISOString(), id);
  return info.changes > 0;
}

/**
 * On startup, recover tasks stuck in 'Running' due to an abrupt crash back to 'Pending'
 * only if they did not already record a completion log for the current run.
 */
export function recoverInterruptedTasks(): number {
  const db = getDb();
  const info = db
    .prepare(`
      UPDATE scheduled_tasks
      SET status = 'Pending', updated_at = ?
      WHERE status = 'Running'
    `)
    .run(new Date().toISOString());
  return Number(info.changes);
}

export function addTaskLog(input: {
  taskId: string;
  status: string;
  attempt?: number;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  details?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO task_logs (id, task_id, status, attempt, started_at, finished_at, error_message, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    input.taskId,
    input.status,
    input.attempt || 1,
    input.startedAt || new Date().toISOString(),
    input.finishedAt || new Date().toISOString(),
    input.errorMessage || '',
    JSON.stringify(input.details || {})
  );
}

export function listTaskLogs(taskId: string) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY started_at DESC LIMIT 50')
    .all(taskId);
}

export function getTaskStats() {
  const db = getDb();
  const rows = db
    .prepare('SELECT status, COUNT(*) as count FROM scheduled_tasks GROUP BY status')
    .all() as Array<{ status: TaskStatus; count: number }>;

  const counts: Record<string, number> = {
    Pending: 0,
    Running: 0,
    Completed: 0,
    Failed: 0,
    Cancelled: 0,
    Paused: 0,
  };
  for (const r of rows) {
    counts[r.status] = r.count;
  }
  return counts;
}
