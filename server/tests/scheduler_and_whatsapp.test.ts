import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, getDb, openDatabase } from '../database/connection.ts';
import { runMigrations } from '../database/migrations/runner.ts';
import { setSetting } from '../database/repositories/settingsRepo.ts';
import { getFileById } from '../database/repositories/filesRepo.ts';
import { upsertGroup } from '../database/repositories/groupsRepo.ts';
import { listMessageLogs } from '../database/repositories/logsRepo.ts';
import {
  claimTaskForExecution,
  getTaskById,
  recoverInterruptedTasks,
  updateScheduledTask,
} from '../database/repositories/tasksRepo.ts';
import { createAuthorizedUserStrict } from '../database/repositories/usersRepo.ts';
import { saveIncomingFile } from '../files/storage.ts';
import { cancelTask, computeNextRunIso, pauseTask, resumeTask, scheduleNewTask } from '../scheduler/task-manager.ts';
import { scheduler } from '../scheduler/scheduler.ts';
import { executeTaskDelivery } from '../whatsapp/sender.ts';
import { handleIncomingWhatsAppMessage } from '../whatsapp/message-handler.ts';
import { LinkedDeviceTestStub } from './test-transport.ts';

describe('Scheduler, Recovery & Linked Device WhatsApp Execution', () => {
  let tmpDir: string;
  let linkedDevice: LinkedDeviceTestStub;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sched-test-'));
    openDatabase(path.join(tmpDir, 'test.sqlite'));
    runMigrations();
    setSetting('storage_path', path.join(tmpDir, 'storage'));
    setSetting('owner_phone', '+249900000000');

    linkedDevice = new LinkedDeviceTestStub('249900000001');
    await linkedDevice.start();
    upsertGroup({
      waGroupId: '120363000001@g.us',
      name: 'مجموعة الدراسة - المستوى الرابع',
      alias: 'مجموعة الدراسة',
      memberCount: 24,
    });
  });

  after(async () => {
    scheduler.stop();
    await linkedDevice.stop();
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('computes Africa/Khartoum next run and supports pause/resume/cancel', () => {
    const nextIso = computeNextRunIso({
      scheduleType: 'weekly',
      dayOfWeek: 'sunday',
      timeOfDay: '20:00',
      timezone: 'Africa/Khartoum',
    });
    assert.ok(nextIso && !Number.isNaN(Date.parse(nextIso)));

    const task = scheduleNewTask({
      title: 'مهمة أسبوعية',
      taskType: 'text',
      messageText: 'تذكير بالمحاضرة',
      destinationType: 'group',
      destinationId: '120363000001@g.us',
      destinationLabel: 'مجموعة الدراسة',
      scheduleType: 'weekly',
      daysOfWeek: ['sunday'],
      timeOfDay: '20:00',
      timezone: 'Africa/Khartoum',
    });
    assert.equal(task.status, 'Pending');

    const paused = pauseTask(task.id);
    assert.equal(paused?.status, 'Paused');

    const resumed = resumeTask(task.id);
    assert.equal(resumed?.status, 'Pending');

    const cancelled = cancelTask(task.id);
    assert.equal(cancelled?.status, 'Cancelled');
  });

  it('recovers interrupted Running tasks on restart and prevents double claim', () => {
    const task = scheduleNewTask({
      title: 'مهمة متوقفة',
      taskType: 'text',
      messageText: 'رسالة اختبار',
      destinationType: 'group',
      destinationId: '120363000001@g.us',
      destinationLabel: 'مجموعة الدراسة',
      scheduleType: 'once',
      explicitNextRunIso: new Date(Date.now() - 60_000).toISOString(),
    });

    updateScheduledTask(task.id, { status: 'Running' });
    const recoveredCount = recoverInterruptedTasks();
    assert.equal(recoveredCount, 1);
    assert.equal(getTaskById(task.id)?.status, 'Pending');

    assert.equal(claimTaskForExecution(task.id), true);
    assert.equal(claimTaskForExecution(task.id), false);
  });

  it('executes scheduled file delivery via Linked Device transport and keeps original file on failure', async () => {
    const file = saveIncomingFile({
      buffer: Buffer.from('PDF test payload'),
      originalName: 'تقرير_الشهر.pdf',
      mimeType: 'application/pdf',
      folderName: 'المستندات',
    });

    const task = scheduleNewTask({
      title: 'إرسال التقرير الشهري',
      taskType: 'file',
      fileIds: [file.id],
      messageText: 'مرفق التقرير',
      destinationType: 'group',
      destinationId: '120363000001@g.us',
      destinationLabel: 'مجموعة الدراسة',
      scheduleType: 'once',
      explicitNextRunIso: new Date(Date.now() - 5000).toISOString(),
    });

    scheduler.setExecutor((t) => executeTaskDelivery(linkedDevice, t));
    const processed = await scheduler.tick();
    assert.equal(processed, 1);
    assert.equal(getTaskById(task.id)?.status, 'Completed');
    assert.equal(getFileById(file.id)?.send_count, 1);
    assert.equal(linkedDevice.outboundHistory.length, 1);

    linkedDevice.shouldFailNextSend = true;
    const failTask = scheduleNewTask({
      title: 'مهمة فاشلة',
      taskType: 'file',
      fileIds: [file.id],
      destinationType: 'group',
      destinationId: '120363000001@g.us',
      destinationLabel: 'مجموعة الدراسة',
      scheduleType: 'once',
      explicitNextRunIso: new Date(Date.now() - 5000).toISOString(),
    });
    await scheduler.tick();
    assert.ok(fs.existsSync(file.storage_path));
    assert.notEqual(getTaskById(failTask.id)?.status, 'Completed');
  });

  it('silently drops unauthorized senders & group messages, logs unauthorized_attempt, and replies to authorized chat users via bot_auto', async () => {
    const beforeOutboundCount = linkedDevice.outboundHistory.length;

    // 1. Unauthorized sender -> MUST NOT reply at all (empty string + no outbound send) + log unauthorized_attempt
    const deniedReply = await handleIncomingWhatsAppMessage(linkedDevice, {
      messageId: 'm-unauth-1',
      fromRaw: '249999999999@c.us',
      senderPhoneE164: '+249999999999',
      senderDisplayName: 'Stranger',
      isGroup: false,
      body: 'اعرض الملفات',
      hasMedia: false,
    });
    assert.equal(deniedReply, '');
    assert.equal(linkedDevice.outboundHistory.length, beforeOutboundCount);

    const unauthLogs = listMessageLogs({ interactionType: 'unauthorized_attempt' });
    assert.ok(unauthLogs.some((l) => l.phone === '249999999999' && l.interaction_type === 'unauthorized_attempt'));

    // 2. Group message -> NEVER reply to groups
    const groupReply = await handleIncomingWhatsAppMessage(linkedDevice, {
      messageId: 'm-group-1',
      fromRaw: '120363000001@g.us',
      senderPhoneE164: '+249900000000',
      senderDisplayName: 'Mohammed Asim',
      isGroup: true,
      body: 'كم عدد الملفات',
      hasMedia: false,
    });
    assert.equal(groupReply, '');
    assert.equal(linkedDevice.outboundHistory.length, beforeOutboundCount);

    // 3. Authorized 'view_only' user -> logs inbound without bot auto-reply
    createAuthorizedUserStrict({
      phone: '249911112222',
      nickname: 'مشاهد فقط',
      permission: 'view_only',
    });
    const viewOnlyReply = await handleIncomingWhatsAppMessage(linkedDevice, {
      messageId: 'm-view-1',
      fromRaw: '249911112222@c.us',
      senderPhoneE164: '+249911112222',
      senderDisplayName: 'Viewer Contact',
      isGroup: false,
      body: 'مرحبا بالبوت',
      hasMedia: false,
    });
    assert.equal(viewOnlyReply, '');

    // 4. Owner / 'chat' user -> replies via Linked Device and logs bot_auto
    const allowedReply = await handleIncomingWhatsAppMessage(linkedDevice, {
      messageId: 'm-owner-1',
      fromRaw: '249900000000@c.us',
      senderPhoneE164: '+249900000000',
      senderDisplayName: 'Mohammed Asim',
      isGroup: false,
      body: 'كم عدد الملفات',
      hasMedia: false,
    });
    assert.ok(allowedReply.includes('إجمالي الملفات'));

    const botAutoLogs = listMessageLogs({ interactionType: 'bot_auto' });
    assert.ok(botAutoLogs.some((l) => l.phone === '249900000000' && l.direction === 'outbound'));

    // Sanity check table columns exist in authorized_users
    const cols = getDb().prepare(`PRAGMA table_info(authorized_users)`).all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    for (const reqCol of ['id', 'phone', 'nickname', 'permission', 'is_active', 'created_at']) {
      assert.ok(colNames.has(reqCol), `authorized_users missing column ${reqCol}`);
    }
  });
});
