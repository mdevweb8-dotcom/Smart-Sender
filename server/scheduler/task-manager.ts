import {
  createScheduledTask,
  getTaskById,
  updateScheduledTask,
  type ScheduledTaskRecord,
  type ScheduleType,
  type TaskType,
} from '../database/repositories/tasksRepo.ts';
import { getSetting } from '../database/repositories/settingsRepo.ts';

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Computes UTC offset in minutes for an IANA timezone (default Africa/Khartoum = +120).
 */
export function getTimezoneOffsetMinutes(timezone: string, referenceDate: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    }).formatToParts(referenceDate);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    const match = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (match) {
      const sign = match[1] === '-' ? -1 : 1;
      const hours = Number(match[2] || 0);
      const mins = Number(match[3] || 0);
      return sign * (hours * 60 + mins);
    }
  } catch {
    // Fallback for Africa/Khartoum (+02:00)
  }
  return timezone === 'Africa/Khartoum' ? 120 : 0;
}

/**
 * Converts a local wall-clock date/time in `timezone` into a UTC Date.
 */
export function localDateTimeToUtc(
  year: number,
  month1Based: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const approxUtc = new Date(Date.UTC(year, month1Based - 1, day, hour, minute, 0, 0));
  const offsetMin = getTimezoneOffsetMinutes(timezone, approxUtc);
  return new Date(approxUtc.getTime() - offsetMin * 60_000);
}

export function getLocalParts(date: Date, timezone: string) {
  const offsetMin = getTimezoneOffsetMinutes(timezone, date);
  const shifted = new Date(date.getTime() + offsetMin * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(), // 0=Sun..6=Sat
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export interface ComputeNextRunInput {
  scheduleType: ScheduleType;
  timeOfDay?: string; // HH:MM
  dateIso?: string; // YYYY-MM-DD
  relativeDay?: '' | 'today' | 'tomorrow';
  dayOfWeek?: string;
  daysOfWeek?: string[];
  dayOfMonth?: number | null;
  timezone?: string;
  fromDate?: Date;
}

export function parseTimeHHMM(raw: string | undefined): { hour: number; minute: number } {
  const match = (raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: 9, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return { hour, minute };
}

export function computeNextRunIso(input: ComputeNextRunInput): string | null {
  const timezone = input.timezone || getSetting('timezone', 'Africa/Khartoum');
  const now = input.fromDate || new Date();
  const localNow = getLocalParts(now, timezone);
  const { hour, minute } = parseTimeHHMM(input.timeOfDay || '09:00');

  if (input.scheduleType === 'once') {
    if (input.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(input.dateIso)) {
      const [y, m, d] = input.dateIso.split('-').map(Number);
      return localDateTimeToUtc(y, m, d, hour, minute, timezone).toISOString();
    }

    const baseLocal = localDateTimeToUtc(localNow.year, localNow.month, localNow.day, hour, minute, timezone);
    if (input.relativeDay === 'tomorrow') {
      return new Date(baseLocal.getTime() + 86_400_000).toISOString();
    }
    if (input.relativeDay === 'today') {
      return baseLocal.toISOString();
    }
    if (input.dayOfWeek && DAY_INDEX[input.dayOfWeek.toLowerCase()] !== undefined) {
      const targetDow = DAY_INDEX[input.dayOfWeek.toLowerCase()];
      let delta = (targetDow - localNow.dayOfWeek + 7) % 7;
      const candidate = new Date(baseLocal.getTime() + delta * 86_400_000);
      if (candidate.getTime() <= now.getTime()) {
        delta += 7;
      }
      return new Date(baseLocal.getTime() + delta * 86_400_000).toISOString();
    }
    // If no day specified, today if in future else tomorrow
    if (baseLocal.getTime() > now.getTime()) {
      return baseLocal.toISOString();
    }
    return new Date(baseLocal.getTime() + 86_400_000).toISOString();
  }

  if (input.scheduleType === 'daily') {
    const todayCandidate = localDateTimeToUtc(localNow.year, localNow.month, localNow.day, hour, minute, timezone);
    if (todayCandidate.getTime() > now.getTime() + 5000) {
      return todayCandidate.toISOString();
    }
    return new Date(todayCandidate.getTime() + 86_400_000).toISOString();
  }

  if (input.scheduleType === 'weekly' || input.scheduleType === 'custom_days') {
    const daysList = (
      input.daysOfWeek && input.daysOfWeek.length > 0
        ? input.daysOfWeek
        : input.dayOfWeek
          ? [input.dayOfWeek]
          : ['sunday']
    )
      .map((d) => DAY_INDEX[d.toLowerCase()])
      .filter((n) => n !== undefined);

    const uniqueDays = daysList.length > 0 ? Array.from(new Set(daysList)) : [localNow.dayOfWeek];
    let best: Date | null = null;
    for (const targetDow of uniqueDays) {
      let delta = (targetDow - localNow.dayOfWeek + 7) % 7;
      const base = localDateTimeToUtc(localNow.year, localNow.month, localNow.day, hour, minute, timezone);
      let candidate = new Date(base.getTime() + delta * 86_400_000);
      if (candidate.getTime() <= now.getTime() + 5000) {
        candidate = new Date(candidate.getTime() + 7 * 86_400_000);
      }
      if (!best || candidate.getTime() < best.getTime()) {
        best = candidate;
      }
    }
    return best ? best.toISOString() : null;
  }

  if (input.scheduleType === 'monthly') {
    const dom = Math.min(28, Math.max(1, input.dayOfMonth || localNow.day));
    let candidate = localDateTimeToUtc(localNow.year, localNow.month, dom, hour, minute, timezone);
    if (candidate.getTime() <= now.getTime() + 5000) {
      const nextMonth = localNow.month === 12 ? 1 : localNow.month + 1;
      const nextYear = localNow.month === 12 ? localNow.year + 1 : localNow.year;
      candidate = localDateTimeToUtc(nextYear, nextMonth, dom, hour, minute, timezone);
    }
    return candidate.toISOString();
  }

  return null;
}

export function scheduleNewTask(params: {
  title: string;
  taskType: TaskType;
  fileIds?: string[];
  messageText?: string;
  destinationType: 'group' | 'contact';
  destinationId: string;
  destinationLabel: string;
  scheduleType: ScheduleType;
  daysOfWeek?: string[];
  dayOfMonth?: number | null;
  timeOfDay?: string;
  dateIso?: string;
  relativeDay?: '' | 'today' | 'tomorrow';
  explicitNextRunIso?: string;
  timezone?: string;
  requiresConfirmation?: boolean;
  isConfirmed?: boolean;
  createdByPhone?: string;
}): ScheduledTaskRecord {
  const timezone = params.timezone || getSetting('timezone', 'Africa/Khartoum');
  const nextRunAt =
    params.explicitNextRunIso ||
    computeNextRunIso({
      scheduleType: params.scheduleType,
      timeOfDay: params.timeOfDay || '09:00',
      dateIso: params.dateIso,
      relativeDay: params.relativeDay,
      dayOfWeek: params.daysOfWeek?.[0],
      daysOfWeek: params.daysOfWeek,
      dayOfMonth: params.dayOfMonth,
      timezone,
    });

  return createScheduledTask({
    title: params.title,
    taskType: params.taskType,
    fileIds: params.fileIds,
    messageText: params.messageText,
    destinationType: params.destinationType,
    destinationId: params.destinationId,
    destinationLabel: params.destinationLabel,
    scheduleType: params.scheduleType,
    cronDays: params.daysOfWeek,
    dayOfMonth: params.dayOfMonth,
    timeOfDay: params.timeOfDay || '09:00',
    scheduledAt: nextRunAt,
    nextRunAt,
    timezone,
    requiresConfirmation: params.requiresConfirmation,
    isConfirmed: params.isConfirmed,
    createdByPhone: params.createdByPhone,
  });
}

export function pauseTask(taskId: string): ScheduledTaskRecord | undefined {
  const task = getTaskById(taskId);
  if (!task || task.status === 'Cancelled' || task.status === 'Completed') return undefined;
  return updateScheduledTask(taskId, { status: 'Paused' });
}

export function resumeTask(taskId: string): ScheduledTaskRecord | undefined {
  const task = getTaskById(taskId);
  if (!task || task.status !== 'Paused') return undefined;
  const days = JSON.parse(task.cron_days_json || '[]') as string[];
  const nextRunAt =
    task.next_run_at && new Date(task.next_run_at).getTime() > Date.now()
      ? task.next_run_at
      : computeNextRunIso({
          scheduleType: task.schedule_type,
          timeOfDay: task.time_of_day || '09:00',
          daysOfWeek: days,
          dayOfMonth: task.day_of_month,
          timezone: task.timezone,
        });
  return updateScheduledTask(taskId, { status: 'Pending', next_run_at: nextRunAt });
}

export function cancelTask(taskId: string): ScheduledTaskRecord | undefined {
  const task = getTaskById(taskId);
  if (!task || task.status === 'Completed') return undefined;
  return updateScheduledTask(taskId, { status: 'Cancelled' });
}

export function confirmTask(taskId: string): ScheduledTaskRecord | undefined {
  const task = getTaskById(taskId);
  if (!task) return undefined;
  return updateScheduledTask(taskId, { is_confirmed: 1 });
}
