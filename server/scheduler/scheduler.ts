import { config } from '../config/env.ts';
import { getSettingNumber } from '../database/repositories/settingsRepo.ts';
import {
  addTaskLog,
  claimTaskForExecution,
  getDuePendingTasks,
  getTaskById,
  recoverInterruptedTasks,
  updateScheduledTask,
  type ScheduledTaskRecord,
} from '../database/repositories/tasksRepo.ts';
import { logSystem } from '../database/repositories/logsRepo.ts';
import { computeNextRunIso } from './task-manager.ts';

export type TaskExecutorFn = (task: ScheduledTaskRecord) => Promise<{
  ok: boolean;
  error?: string;
  details?: Record<string, unknown>;
}>;

class PersistentScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private executor: TaskExecutorFn | null = null;

  setExecutor(fn: TaskExecutorFn): void {
    this.executor = fn;
  }

  start(): void {
    if (this.timer) return;

    const recovered = recoverInterruptedTasks();
    if (recovered > 0) {
      logSystem('warn', 'scheduler', `تمت استعادة ${recovered} مهمة متوقفة بعد إعادة التشغيل`);
    }

    const pollMs = Math.max(3000, getSettingNumber('scheduler_poll_ms', config.schedulerPollMs));
    logSystem('info', 'scheduler', `تم تشغيل محرك الجدولة الموثوق (فحص كل ${pollMs}ms)`);

    // Immediate startup scan + periodic polling
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  async tick(nowIso: string = new Date().toISOString()): Promise<number> {
    if (this.isTicking || !this.executor) return 0;
    this.isTicking = true;
    let processed = 0;

    try {
      const dueTasks = getDuePendingTasks(nowIso);
      for (const task of dueTasks) {
        const claimed = claimTaskForExecution(task.id);
        if (!claimed) continue; // Already claimed by another cycle

        await this.executeTaskRecord(task);
        processed += 1;
      }
    } catch (err) {
      logSystem('error', 'scheduler', 'خطأ غير متوقع في دورة فحص الجدولة', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.isTicking = false;
    }

    return processed;
  }

  async runTaskNow(taskId: string): Promise<{ ok: boolean; error?: string }> {
    const task = getTaskById(taskId);
    if (!task) return { ok: false, error: 'المهمة غير موجودة' };
    if (!this.executor) return { ok: false, error: 'منفذ الإرسال غير جاهز' };

    updateScheduledTask(taskId, { status: 'Running', is_confirmed: 1 });
    return this.executeTaskRecord(task, true);
  }

  private async executeTaskRecord(
    task: ScheduledTaskRecord,
    manualTrigger = false
  ): Promise<{ ok: boolean; error?: string }> {
    const startedAt = new Date().toISOString();
    const attempt = task.retry_count + 1;

    try {
      const result = await this.executor!(task);
      const finishedAt = new Date().toISOString();

      if (result.ok) {
        addTaskLog({
          taskId: task.id,
          status: 'Completed',
          attempt,
          startedAt,
          finishedAt,
          details: result.details || {},
        });

        if (task.schedule_type === 'once' || manualTrigger) {
          updateScheduledTask(task.id, {
            status: task.schedule_type === 'once' ? 'Completed' : 'Pending',
            last_run_at: finishedAt,
            retry_count: 0,
            next_run_at:
              task.schedule_type === 'once'
                ? null
                : computeNextRunIso({
                    scheduleType: task.schedule_type,
                    timeOfDay: task.time_of_day || '09:00',
                    daysOfWeek: JSON.parse(task.cron_days_json || '[]'),
                    dayOfMonth: task.day_of_month,
                    timezone: task.timezone,
                    fromDate: new Date(Date.now() + 60_000),
                  }),
          });
        } else {
          const nextIso = computeNextRunIso({
            scheduleType: task.schedule_type,
            timeOfDay: task.time_of_day || '09:00',
            daysOfWeek: JSON.parse(task.cron_days_json || '[]'),
            dayOfMonth: task.day_of_month,
            timezone: task.timezone,
            fromDate: new Date(Date.now() + 60_000),
          });
          updateScheduledTask(task.id, {
            status: 'Pending',
            last_run_at: finishedAt,
            next_run_at: nextIso,
            retry_count: 0,
          });
        }

        logSystem('info', 'scheduler', `تم تنفيذ المهمة المجدولة بنجاح: ${task.title}`, {
          taskId: task.id,
        });
        return { ok: true };
      }

      // Failure handling (never crash scheduler; retry if under max_retries)
      const errMsg = result.error || 'فشل إرسال المهمة';
      addTaskLog({
        taskId: task.id,
        status: 'Failed',
        attempt,
        startedAt,
        finishedAt,
        errorMessage: errMsg,
        details: result.details || {},
      });

      if (attempt < task.max_retries && !manualTrigger) {
        const retryAt = new Date(Date.now() + attempt * 60_000).toISOString();
        updateScheduledTask(task.id, {
          status: 'Pending',
          retry_count: attempt,
          next_run_at: retryAt,
          last_run_at: finishedAt,
        });
      } else {
        updateScheduledTask(task.id, {
          status: 'Failed',
          retry_count: attempt,
          last_run_at: finishedAt,
        });
      }

      logSystem('error', 'scheduler', `فشل تنفيذ المهمة (${task.title}): ${errMsg}`, {
        taskId: task.id,
        attempt,
      });
      return { ok: false, error: errMsg };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addTaskLog({
        taskId: task.id,
        status: 'Failed',
        attempt,
        startedAt,
        finishedAt: new Date().toISOString(),
        errorMessage: errMsg,
      });
      updateScheduledTask(task.id, { status: 'Failed', retry_count: attempt });
      logSystem('error', 'scheduler', `استثناء أثناء تنفيذ المهمة ${task.title}: ${errMsg}`);
      return { ok: false, error: errMsg };
    }
  }
}

export const scheduler = new PersistentScheduler();
