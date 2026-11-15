import { Router } from 'express';
import fs from 'node:fs';
import multer from 'multer';
import { getAIProvider } from '../../ai/gemini.ts';
import { parseUserArabicCommand } from '../../ai/command-parser.ts';
import { clearUserMemory } from '../../ai/memory.ts';
import {
  authenticateDashboardCredentials,
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from '../../auth/authentication.ts';
import { config, normalizePhoneDigits, normalizePhoneE164 } from '../../config/env.ts';
import {
  getFileById,
  getFileStats,
  listFiles,
  updateFileMetadata,
} from '../../database/repositories/filesRepo.ts';
import {
  createFolder,
  deleteFolder,
  listFolders,
  renameFolder,
} from '../../database/repositories/foldersRepo.ts';
import { listGroups, updateGroupAlias, upsertGroup } from '../../database/repositories/groupsRepo.ts';
import {
  getDirectChatThread,
  listMessageLogs,
  listSystemLogs,
  logSystem,
} from '../../database/repositories/logsRepo.ts';
import { getSetting, listPublicSettings, setSetting } from '../../database/repositories/settingsRepo.ts';
import {
  getTaskById,
  getTaskStats,
  listScheduledTasks,
  listTaskLogs,
  updateScheduledTask,
} from '../../database/repositories/tasksRepo.ts';
import {
  createAuthorizedUserStrict,
  createDashboardUser,
  deleteDashboardUser,
  deleteWhatsAppUser,
  getWhatsAppUserByPhone,
  listDashboardUsers,
  listWhatsAppUsers,
  markContactChatRead,
  updateAuthorizedUserById,
  upsertWhatsAppUser,
  type ContactPermission,
} from '../../database/repositories/usersRepo.ts';
import { copyFileToFolder, deleteFileCompletely, moveFileToFolder, resolveSafeStoragePath } from '../../files/storage.ts';
import { scheduler } from '../../scheduler/scheduler.ts';
import { cancelTask, pauseTask, resumeTask, scheduleNewTask } from '../../scheduler/task-manager.ts';
import { createDatabaseBackup, listBackups, resolveSafeBackupPath, restoreDatabaseBackup } from '../../services/backup.ts';
import { ingestAndAnalyzeFile } from '../../whatsapp/file-handler.ts';
import { getWhatsAppManager } from '../../whatsapp/manager.ts';
import { handleIncomingWhatsAppMessage } from '../../whatsapp/message-handler.ts';
import type { TransportStateSnapshot } from '../../whatsapp/provider.ts';
import { sendDirectChatMessage } from '../../whatsapp/sender.ts';

function maskPhone(raw: string | null | undefined): string {
  const digits = normalizePhoneDigits(raw || '');
  if (!digits) return '';
  if (digits.length <= 4) return '••••';
  return `${digits.slice(0, 4)}••••${digits.slice(-2)}`;
}

function sanitizeWaState(state: TransportStateSnapshot, isOwner: boolean) {
  if (isOwner) return state;
  return {
    ...state,
    connectedPhone: state.connectedPhone ? maskPhone(state.connectedPhone) : null,
    linkedBotPhone: state.linkedBotPhone ? maskPhone(state.linkedBotPhone) : '',
    notice: 'البوت يعمل عبر رقم الجهاز المرتبط (مخفي لغير المالك).',
  };
}

function sanitizeLogRow<T extends Record<string, unknown>>(row: T, isOwner: boolean): T {
  if (isOwner) return row;
  const sender = typeof row.sender_phone === 'string' ? row.sender_phone : '';
  const contact = typeof row.contact_phone === 'string' ? row.contact_phone : '';
  const phone = typeof row.phone === 'string' ? row.phone : '';
  const rec = typeof row.recipient_id === 'string' ? row.recipient_id : '';
  return {
    ...row,
    sender_phone: sender ? maskPhone(sender) : '',
    contact_phone: contact ? maskPhone(contact) : '',
    phone: phone ? maskPhone(phone) : '',
    recipient_id: rec.includes('@c.us') ? maskPhone(rec) : rec,
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

export function createApiRouter(): Router {
  const router = Router();

  // ===========================================================================
  // Public Health & Auth Endpoints
  // ===========================================================================
  router.get('/health', async (_req, res) => {
    const wa = getWhatsAppManager().getState();
    const ai = getAIProvider();
    res.json({
      ok: true,
      app: 'Smart-Sender',
      author: 'Mohammed Asim',
      timestamp: new Date().toISOString(),
      timezone: getSetting('timezone', config.timezone),
      schedulerRunning: scheduler.isRunning(),
      whatsapp: {
        provider: wa.provider,
        status: wa.status,
        connectedPhone: wa.connectedPhone ? maskPhone(wa.connectedPhone) : null,
        isOfficialApi: false,
      },
      gemini: {
        configured: ai.isConfigured(),
        model: ai.getActiveModel(),
      },
    });
  });

  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const result = authenticateDashboardCredentials(String(username || ''), String(password || ''));
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json({
      token: result.token,
      user: result.user,
    });
  });

  // Protect everything below this line with JWT Authentication
  router.use(requireAuth);

  router.get('/auth/me', (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  // ===========================================================================
  // Overview & Dashboard Stats
  // ===========================================================================
  router.get('/stats', (req: AuthenticatedRequest, res) => {
    const isOwner = req.user?.role === 'owner';
    const fileStats = getFileStats();
    const taskStats = getTaskStats();
    const waState = sanitizeWaState(getWhatsAppManager().getState(), isOwner);
    const ai = getAIProvider();
    const recentFiles = listFiles({ limit: 6 }).map((f) =>
      isOwner ? f : { ...f, sender_phone: f.sender_phone ? maskPhone(f.sender_phone) : '' }
    );
    const recentMessages = (listMessageLogs({ limit: 8 }) as Array<Record<string, unknown>>).map((m) =>
      sanitizeLogRow(m, isOwner)
    );
    const upcomingTasks = listScheduledTasks({ status: 'Pending', limit: 6 });
    const contacts = listWhatsAppUsers();
    const unreadDirectChats = isOwner ? contacts.reduce((sum, c) => sum + (c.unread_count || 0), 0) : 0;
    const newContactsCount = isOwner ? contacts.filter((c) => c.connection_state === 'registered').length : 0;

    res.json({
      botStatus: 'running',
      schedulerRunning: scheduler.isRunning(),
      whatsapp: waState,
      gemini: {
        configured: ai.isConfigured(),
        model: ai.getActiveModel(),
      },
      files: fileStats,
      tasks: taskStats,
      groupsCount: listGroups().length,
      unreadDirectChats,
      newContactsCount,
      registeredContactsCount: contacts.filter((c) => c.permission !== 'blocked' && c.is_active === 1).length,
      recentFiles,
      recentMessages,
      upcomingTasks,
    });
  });

  // ===========================================================================
  // WhatsApp Linked Device Connection (whatsapp-web.js only)
  // ===========================================================================
  router.get('/whatsapp/status', (req: AuthenticatedRequest, res) => {
    const isOwner = req.user?.role === 'owner';
    res.json(sanitizeWaState(getWhatsAppManager().getState(), isOwner));
  });

  router.post('/whatsapp/connect', requireRole(['owner']), async (_req, res) => {
    const state = await getWhatsAppManager().connect();
    res.json(state);
  });

  router.post('/whatsapp/reconnect', requireRole(['owner']), async (_req, res) => {
    const state = await getWhatsAppManager().reconnect();
    res.json(state);
  });

  router.post('/whatsapp/disconnect', requireRole(['owner']), async (_req, res) => {
    const state = await getWhatsAppManager().disconnect();
    res.json(state);
  });

  router.post('/whatsapp/sync-groups', requireRole(['owner', 'admin']), async (_req, res) => {
    const groups = await getWhatsAppManager().syncGroups();
    res.json({ groups });
  });

  // Linked Device Arabic message test endpoint (routes strictly through active Linked Device transport)
  router.post('/simulator/message', requireRole(['owner']), upload.single('file'), async (req, res) => {
    try {
      const senderPhone = String(req.body?.senderPhone || getSetting('owner_phone', config.ownerPhone));
      const senderName = String(req.body?.senderName || 'Mohammed Asim');
      const body = String(req.body?.message || '');
      const manager = getWhatsAppManager();
      const transport = manager.getTransport();

      const file = req.file;
      const reply = await handleIncomingWhatsAppMessage(transport, {
        messageId: `sim-${Date.now()}`,
        fromRaw: `${normalizePhoneDigits(senderPhone)}@c.us`,
        senderPhoneE164: normalizePhoneE164(senderPhone),
        senderDisplayName: senderName,
        isGroup: false,
        body,
        hasMedia: Boolean(file),
        downloadMedia: file
          ? async () => ({
              buffer: file.buffer,
              filename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
              mimeType: file.mimetype,
            })
          : undefined,
      });

      res.json({ ok: true, reply });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ===========================================================================
  // Gemini AI Health & Arabic Command Parser Testing
  // ===========================================================================
  router.get('/gemini/health', async (_req, res) => {
    const health = await getAIProvider().healthCheck();
    res.json(health);
  });

  router.post('/gemini/parse', requireRole(['owner', 'admin']), async (req, res) => {
    try {
      const text = String(req.body?.message || '').trim();
      if (!text) {
        res.status(400).json({ error: 'النص مطلوب للتحليل' });
        return;
      }
      const userPhone = String(req.body?.userPhone || getSetting('owner_phone', config.ownerPhone));
      const parsed = await parseUserArabicCommand(userPhone, text);
      res.json({ parsed });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/gemini/memory/clear', requireRole(['owner', 'admin']), (req, res) => {
    const phone = String(req.body?.userPhone || getSetting('owner_phone', config.ownerPhone));
    clearUserMemory(phone);
    res.json({ ok: true });
  });

  // ===========================================================================
  // Files & Folders Management
  // ===========================================================================
  router.get('/files', (req, res) => {
    const files = listFiles({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      folderId: typeof req.query.folderId === 'string' ? req.query.folderId : undefined,
      fileType: typeof req.query.fileType === 'string' ? req.query.fileType : undefined,
      todayOnly: req.query.today === 'true',
      limit: Number(req.query.limit || 200),
    });
    res.json({ files });
  });

  router.get('/files/:id', (req, res) => {
    const file = getFileById(req.params.id);
    if (!file) {
      res.status(404).json({ error: 'الملف غير موجود' });
      return;
    }
    res.json({ file });
  });

  router.get('/files/:id/download', (req, res) => {
    const file = getFileById(req.params.id);
    if (!file) {
      res.status(404).json({ error: 'الملف غير موجود' });
      return;
    }
    try {
      const safePath = resolveSafeStoragePath(file.storage_path);
      if (!fs.existsSync(safePath)) {
        res.status(404).json({ error: 'الملف غير موجود على القرص' });
        return;
      }
      res.download(safePath, file.original_name);
    } catch (err) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'وصول غير مصرح به' });
    }
  });

  router.post('/files/upload', requireRole(['owner', 'admin']), upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'يرجى إرفاق ملف' });
        return;
      }
      const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const saved = await ingestAndAnalyzeFile({
        buffer: req.file.buffer,
        originalName,
        mimeType: req.file.mimetype,
        explicitFolderName: req.body?.folderName ? String(req.body.folderName) : undefined,
        captionHint: req.body?.hint ? String(req.body.hint) : undefined,
        senderPhone: getSetting('owner_phone', config.ownerPhone),
        senderName: 'رفع مباشر من لوحة التحكم',
      });
      res.status(201).json({ file: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put('/files/:id', requireRole(['owner', 'admin']), (req, res) => {
    const file = getFileById(req.params.id);
    if (!file) {
      res.status(404).json({ error: 'الملف غير موجود' });
      return;
    }
    const { original_name, folder_id, folder_name } = req.body || {};
    let updated = file;
    if (folder_id || folder_name) {
      const moved = moveFileToFolder(file.id, String(folder_id || folder_name));
      if (moved) updated = moved;
    }
    if (original_name && String(original_name).trim()) {
      const renamed = updateFileMetadata(file.id, { original_name: String(original_name).trim() });
      if (renamed) updated = renamed;
    }
    res.json({ file: updated });
  });

  router.post('/files/:id/copy', requireRole(['owner', 'admin']), (req, res) => {
    try {
      const folderTarget = String(req.body?.folderName || req.body?.folderId || '').trim();
      if (!folderTarget) {
        res.status(400).json({ error: 'يرجى تحديد المجلد الهدف' });
        return;
      }
      const copied = copyFileToFolder(req.params.id, folderTarget);
      if (!copied) {
        res.status(404).json({ error: 'الملف الأصلي غير موجود' });
        return;
      }
      res.status(201).json({ file: copied });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/files/:id', requireRole(['owner', 'admin']), (req, res) => {
    const ok = deleteFileCompletely(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'الملف غير موجود' });
      return;
    }
    res.json({ ok: true });
  });

  router.get('/folders', (_req, res) => {
    res.json({ folders: listFolders() });
  });

  router.post('/folders', requireRole(['owner', 'admin']), (req, res) => {
    try {
      const folder = createFolder(String(req.body?.name || ''), String(req.body?.description || ''));
      res.status(201).json({ folder });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put('/folders/:id', requireRole(['owner', 'admin']), (req, res) => {
    try {
      const folder = renameFolder(
        req.params.id,
        String(req.body?.name || ''),
        req.body?.description !== undefined ? String(req.body.description) : undefined
      );
      if (!folder) {
        res.status(404).json({ error: 'المجلد غير موجود' });
        return;
      }
      res.json({ folder });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/folders/:id', requireRole(['owner', 'admin']), (req, res) => {
    const result = deleteFolder(req.params.id);
    if (!result.deleted) {
      res.status(400).json({ error: result.reason || 'تعذر حذف المجلد' });
      return;
    }
    res.json({ ok: true });
  });

  // ===========================================================================
  // Scheduled Tasks Management
  // ===========================================================================
  router.get('/tasks', (req, res) => {
    const tasks = listScheduledTasks({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    res.json({ tasks });
  });

  router.get('/tasks/:id', (req, res) => {
    const task = getTaskById(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'المهمة غير موجودة' });
      return;
    }
    res.json({ task, logs: listTaskLogs(task.id) });
  });

  router.post('/tasks', requireRole(['owner', 'admin']), (req: AuthenticatedRequest, res) => {
    try {
      const b = req.body || {};
      const fileIds: string[] = Array.isArray(b.fileIds)
        ? b.fileIds
        : b.fileId
          ? [String(b.fileId)]
          : [];

      const destinationId = String(b.destinationId || '').trim();
      const destinationLabel = String(b.destinationLabel || destinationId).trim();
      if (!destinationId) {
        res.status(400).json({ error: 'وجهة الإرسال مطلوبة' });
        return;
      }
      if (fileIds.length === 0 && !String(b.messageText || '').trim()) {
        res.status(400).json({ error: 'يجب تحديد ملف أو نص رسالة' });
        return;
      }

      const task = scheduleNewTask({
        title: String(b.title || (fileIds.length ? 'إرسال ملف مجدول' : 'رسالة مجدولة')),
        taskType: fileIds.length > 1 ? 'multi_file' : fileIds.length === 1 ? 'file' : 'text',
        fileIds,
        messageText: String(b.messageText || ''),
        destinationType: b.destinationType === 'contact' ? 'contact' : 'group',
        destinationId,
        destinationLabel,
        scheduleType: b.scheduleType || 'once',
        daysOfWeek: Array.isArray(b.daysOfWeek) ? b.daysOfWeek : [],
        dayOfMonth: b.dayOfMonth ? Number(b.dayOfMonth) : null,
        timeOfDay: String(b.timeOfDay || '09:00'),
        dateIso: b.dateIso ? String(b.dateIso) : undefined,
        explicitNextRunIso: b.nextRunAt ? String(b.nextRunAt) : undefined,
        timezone: String(b.timezone || getSetting('timezone', config.timezone)),
        isConfirmed: true,
        createdByPhone: req.user?.username || 'dashboard',
      });

      res.status(201).json({ task });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put('/tasks/:id', requireRole(['owner', 'admin']), (req, res) => {
    const existing = getTaskById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'المهمة غير موجودة' });
      return;
    }
    const b = req.body || {};
    let updated = existing;

    if (b.action === 'pause') {
      updated = pauseTask(existing.id) || existing;
    } else if (b.action === 'resume') {
      updated = resumeTask(existing.id) || existing;
    } else if (b.action === 'cancel') {
      updated = cancelTask(existing.id) || existing;
    } else {
      updated =
        updateScheduledTask(existing.id, {
          title: b.title !== undefined ? String(b.title) : undefined,
          message_text: b.messageText !== undefined ? String(b.messageText) : undefined,
          destination_id: b.destinationId !== undefined ? String(b.destinationId) : undefined,
          destination_label: b.destinationLabel !== undefined ? String(b.destinationLabel) : undefined,
          schedule_type: b.scheduleType,
          time_of_day: b.timeOfDay,
          next_run_at: b.nextRunAt,
          timezone: b.timezone,
          status: b.status,
        }) || existing;
    }

    res.json({ task: updated });
  });

  router.post('/tasks/:id/run', requireRole(['owner', 'admin']), async (req, res) => {
    const result = await scheduler.runTaskNow(req.params.id);
    if (!result.ok) {
      res.status(400).json({ error: result.error || 'فشل تنفيذ المهمة' });
      return;
    }
    res.json({ ok: true, task: getTaskById(req.params.id) });
  });

  router.delete('/tasks/:id', requireRole(['owner', 'admin']), (req, res) => {
    const cancelled = cancelTask(req.params.id);
    if (!cancelled) {
      res.status(404).json({ error: 'المهمة غير موجودة أو مكتملة بالفعل' });
      return;
    }
    res.json({ ok: true, task: cancelled });
  });

  // ===========================================================================
  // Groups & Contacts
  // ===========================================================================
  router.get('/groups', (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    res.json({ groups: listGroups(search) });
  });

  router.post('/groups', requireRole(['owner', 'admin']), (req, res) => {
    const b = req.body || {};
    if (!b.waGroupId || !b.name) {
      res.status(400).json({ error: 'معرف المجموعة واسمها مطلوبان' });
      return;
    }
    const group = upsertGroup({
      waGroupId: String(b.waGroupId),
      name: String(b.name),
      alias: b.alias ? String(b.alias) : '',
      description: b.description ? String(b.description) : '',
      memberCount: Number(b.memberCount || 0),
    });
    res.status(201).json({ group });
  });

  router.put('/groups/:id', requireRole(['owner', 'admin']), (req, res) => {
    const updated = updateGroupAlias(
      req.params.id,
      String(req.body?.alias || ''),
      req.body?.isAllowed !== undefined ? Boolean(req.body.isAllowed) : undefined
    );
    if (!updated) {
      res.status(404).json({ error: 'المجموعة غير موجودة' });
      return;
    }
    res.json({ group: updated });
  });

  // ===========================================================================
  // Logs (Messages & System Errors - Mask full phones for non-owner)
  // ===========================================================================
  router.get('/logs', (req: AuthenticatedRequest, res) => {
    const isOwner = req.user?.role === 'owner';
    const direction = typeof req.query.direction === 'string' ? req.query.direction : 'all';
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const interactionType = typeof req.query.interactionType === 'string' ? req.query.interactionType : 'all';
    const limit = Number(req.query.limit || 100);
    const rawLogs = listMessageLogs({ direction, status, interactionType, limit }) as Array<Record<string, unknown>>;
    const logs = rawLogs.map((l) => sanitizeLogRow(l, isOwner));
    res.json({ logs });
  });

  router.get('/logs/system', (req, res) => {
    const level = typeof req.query.level === 'string' ? req.query.level : 'all';
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';
    const limit = Number(req.query.limit || 120);
    res.json({ logs: listSystemLogs({ level, category, limit }) });
  });

  // ===========================================================================
  // Authorized Users & Linked Device Live Chat (Owner Only)
  // ===========================================================================
  router.get('/authorized-users', requireRole(['owner']), (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const waState = getWhatsAppManager().getState();
    res.json({
      users: listWhatsAppUsers(search),
      linkedBotPhone: waState.linkedBotPhone,
      whatsapp: waState,
    });
  });

  router.post('/authorized-users', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
    try {
      const b = req.body || {};
      const perm = (b.permission || 'chat') as ContactPermission;
      if (!['chat', 'view_only', 'blocked'].includes(perm)) {
        res.status(400).json({ error: 'قيمة الصلاحية غير صالحة (chat / view_only / blocked)' });
        return;
      }

      const user = createAuthorizedUserStrict({
        phone: String(b.phone || ''),
        nickname: String(b.nickname || b.alias || b.displayName || ''),
        permission: perm,
        notes: b.notes ? String(b.notes) : '',
        addedBy: req.user?.username || 'owner',
      });

      const linkedBotPhone = getWhatsAppManager().getLinkedBotPhone() || 'رقم الجهاز المرتبط';
      logSystem('info', 'auth', `تم إضافة رقم مصرح له: ${user.phone} (${user.nickname})`);
      res.status(201).json({
        user,
        linkedBotPhone,
        instructionMessage: `اطلب من هذا الشخص حفظ هذا الرقم: ${linkedBotPhone} كجهة اتصال وإرسال رسالة له`,
      });
    } catch (err) {
      const statusCode = (err as Error & { statusCode?: number }).statusCode || 400;
      res.status(statusCode).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const handleUpdateAuthorizedUser = (req: AuthenticatedRequest, res: import('express').Response) => {
    const b = req.body || {};
    const perm = b.permission !== undefined ? (String(b.permission) as ContactPermission) : undefined;
    if (perm && !['chat', 'view_only', 'blocked'].includes(perm)) {
      res.status(400).json({ error: 'قيمة الصلاحية غير صالحة' });
      return;
    }
    const updated = updateAuthorizedUserById(req.params.id, {
      nickname: b.nickname !== undefined ? String(b.nickname) : undefined,
      permission: perm,
      isActive: b.isActive !== undefined ? Boolean(b.isActive) : b.is_active !== undefined ? Boolean(b.is_active) : undefined,
      notes: b.notes !== undefined ? String(b.notes) : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'الرقم غير موجود في قائمة المصرح لهم' });
      return;
    }
    res.json({ user: updated });
  };

  router.put('/authorized-users/:id', requireRole(['owner']), handleUpdateAuthorizedUser);
  router.patch('/authorized-users/:id', requireRole(['owner']), handleUpdateAuthorizedUser);

  router.delete('/authorized-users/:id', requireRole(['owner']), (req, res) => {
    const deleted = deleteWhatsAppUser(req.params.id);
    if (!deleted) {
      res.status(400).json({ error: 'لا يمكن حذف مالك النظام أو الرقم غير موجود' });
      return;
    }
    res.json({ ok: true });
  });

  // Backwards-compatible aliases (Owner Only)
  router.get('/contacts', requireRole(['owner']), (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const waState = getWhatsAppManager().getState();
    res.json({
      contacts: listWhatsAppUsers(search),
      linkedBotPhone: waState.linkedBotPhone,
      whatsapp: waState,
    });
  });

  router.post('/contacts', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
    try {
      const b = req.body || {};
      const contact = upsertWhatsAppUser({
        phone: String(b.phone || ''),
        displayName: String(b.displayName || b.nickname || ''),
        alias: b.alias !== undefined ? String(b.alias) : b.nickname ? String(b.nickname) : '',
        nickname: b.nickname !== undefined ? String(b.nickname) : b.alias || b.displayName,
        role: b.role || 'authorized',
        permission: b.permission,
        notes: b.notes ? String(b.notes) : '',
        addedBy: req.user?.username || 'owner',
        isActive: b.isActive !== false,
      });
      const linkedBotPhone = getWhatsAppManager().getLinkedBotPhone() || 'رقم الجهاز المرتبط';
      logSystem('info', 'auth', `تم تسجيل/تحديث جهة اتصال مصرح لها: ${contact.phone} (${contact.nickname})`);
      res.status(201).json({
        contact,
        linkedBotPhone,
        instructionMessage: `اطلب من هذا الشخص حفظ هذا الرقم: ${linkedBotPhone} كجهة اتصال وإرسال رسالة له`,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/contacts/:id', requireRole(['owner']), (req, res) => {
    const deleted = deleteWhatsAppUser(req.params.id);
    if (!deleted) {
      res.status(400).json({ error: 'لا يمكن حذف مالك النظام أو جهة الاتصال غير موجودة' });
      return;
    }
    res.json({ ok: true });
  });

  // Live Chat routes (Owner ONLY: only Owner can view all conversations and full numbers)
  const handleGetThreads = (_req: AuthenticatedRequest, res: import('express').Response) => {
    const contacts = listWhatsAppUsers()
      .filter((c) => c.permission !== 'blocked' && c.role !== 'unauthorized' && c.is_active === 1)
      .sort((a, b) => {
        if (b.unread_count !== a.unread_count) return b.unread_count - a.unread_count;
        const tA = a.last_chat_at ? Date.parse(a.last_chat_at) : 0;
        const tB = b.last_chat_at ? Date.parse(b.last_chat_at) : 0;
        return tB - tA;
      });
    res.json({
      contacts,
      whatsapp: getWhatsAppManager().getState(),
    });
  };

  const handleGetMessages = (req: AuthenticatedRequest, res: import('express').Response) => {
    const rawPhone = typeof req.query.phone === 'string' ? req.query.phone : '';
    const digits = normalizePhoneDigits(rawPhone);
    if (!digits) {
      res.status(400).json({ error: 'رقم الهاتف غير صالح' });
      return;
    }
    const contact = getWhatsAppUserByPhone(digits);
    if (!contact) {
      res.status(404).json({ error: 'جهة الاتصال غير مسجلة في authorized_users' });
      return;
    }
    if (req.query.markRead !== 'false') {
      markContactChatRead(digits);
    }
    const limit = Number(req.query.limit || 150);
    const messages = getDirectChatThread(digits, limit);
    res.json({
      contact: getWhatsAppUserByPhone(digits) || contact,
      messages,
      whatsapp: getWhatsAppManager().getState(),
    });
  };

  const handleSendLiveChat = async (req: AuthenticatedRequest, res: import('express').Response) => {
    try {
      const digits = normalizePhoneDigits(String(req.body?.phone || ''));
      const message = String(req.body?.message || '').trim();
      if (!digits) {
        res.status(400).json({ error: 'يرجى تحديد رقم هاتف دولي صالح' });
        return;
      }
      if (!message) {
        res.status(400).json({ error: 'نص الرسالة مطلوب' });
        return;
      }

      const contact = getWhatsAppUserByPhone(digits);
      if (!contact || contact.permission === 'blocked' || contact.role === 'unauthorized' || contact.is_active !== 1) {
        res.status(403).json({ error: 'هذا الرقم غير مسجل أو معطل/محظور في authorized_users' });
        return;
      }

      const manager = getWhatsAppManager();
      const waState = manager.getState();
      if (waState.status !== 'ready') {
        res.status(409).json({
          error: 'الجهاز المرتبط غير متصل حالياً. امسح رمز QR من صفحة ربط الجهاز للاتصال.',
        });
        return;
      }

      const transport = manager.getTransport();
      const label = contact.nickname || contact.alias || contact.display_name || contact.phone;
      const sendRes = await sendDirectChatMessage(transport, {
        phoneE164: `+${digits}`,
        contactLabel: label,
        text: message,
      });

      if (!sendRes.ok) {
        res.status(502).json({ error: sendRes.error || 'فشل إرسال الرسالة عبر الجهاز المرتبط' });
        return;
      }

      markContactChatRead(digits);
      res.json({
        ok: true,
        messageId: sendRes.messageId || '',
        contact: getWhatsAppUserByPhone(digits) || contact,
        messages: getDirectChatThread(digits, 150),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  router.get('/live-chat/threads', requireRole(['owner']), handleGetThreads);
  router.get('/live-chat/messages', requireRole(['owner']), handleGetMessages);
  router.post('/live-chat/send', requireRole(['owner']), handleSendLiveChat);

  router.get('/chat/threads', requireRole(['owner']), handleGetThreads);
  router.get('/chat/messages', requireRole(['owner']), handleGetMessages);
  router.post('/chat/send', requireRole(['owner']), handleSendLiveChat);

  // ===========================================================================
  // Users & RBAC (Mask phones for non-owner)
  // ===========================================================================
  router.get('/users', (req: AuthenticatedRequest, res) => {
    const isOwner = req.user?.role === 'owner';
    const whatsappUsers = listWhatsAppUsers().map((u) =>
      isOwner
        ? u
        : {
            ...u,
            phone: maskPhone(u.phone),
            phone_e164: maskPhone(u.phone_e164),
          }
    );
    res.json({
      whatsappUsers,
      dashboardUsers: listDashboardUsers(),
    });
  });

  router.post('/users/whatsapp', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
    try {
      const b = req.body || {};
      const user = upsertWhatsAppUser({
        phone: String(b.phone || ''),
        displayName: String(b.displayName || b.nickname || ''),
        alias: b.alias !== undefined ? String(b.alias) : undefined,
        nickname: b.nickname !== undefined ? String(b.nickname) : b.alias,
        role: b.role || 'authorized',
        permission: b.permission,
        notes: b.notes ? String(b.notes) : '',
        addedBy: req.user?.username || 'owner',
        isActive: b.isActive !== false,
      });
      res.status(201).json({ user });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/users/whatsapp/:id', requireRole(['owner']), (req, res) => {
    const deleted = deleteWhatsAppUser(req.params.id);
    if (!deleted) {
      res.status(400).json({ error: 'لا يمكن حذف مالك النظام أو المستخدم غير موجود' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/users/dashboard', requireRole(['owner']), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.username || !b.password) {
        res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        return;
      }
      const user = createDashboardUser({
        username: String(b.username),
        password: String(b.password),
        role: b.role === 'viewer' ? 'viewer' : 'admin',
        fullName: String(b.fullName || b.username),
      });
      res.status(201).json({ user });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/users/dashboard/:id', requireRole(['owner']), (req, res) => {
    const ok = deleteDashboardUser(req.params.id);
    if (!ok) {
      res.status(400).json({ error: 'لا يمكن حذف مالك النظام أو الحساب غير موجود' });
      return;
    }
    res.json({ ok: true });
  });

  // ===========================================================================
  // Settings & Backups (Never expose .env or Gemini API Key!)
  // ===========================================================================
  router.get('/settings', (_req, res) => {
    res.json({ settings: listPublicSettings() });
  });

  router.put('/settings', requireRole(['owner', 'admin']), (req, res) => {
    const updates = req.body?.settings;
    if (!updates || typeof updates !== 'object') {
      res.status(400).json({ error: 'صيغة الإعدادات غير صالحة' });
      return;
    }
    const BLOCKED_KEYS = new Set(['gemini_api_key', 'jwt_secret', 'password_hash']);
    for (const [key, value] of Object.entries(updates)) {
      if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
      setSetting(key, String(value));
    }
    logSystem('info', 'system', 'تم تحديث إعدادات النظام من لوحة التحكم');
    res.json({ settings: listPublicSettings() });
  });

  router.get('/backups', requireRole(['owner', 'admin']), (_req, res) => {
    res.json({ backups: listBackups() });
  });

  router.post('/backups', requireRole(['owner', 'admin']), async (_req, res) => {
    try {
      const backup = await createDatabaseBackup('manual');
      res.status(201).json({ backup });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/backups/:filename/download', requireRole(['owner']), (req, res) => {
    try {
      const file = resolveSafeBackupPath(req.params.filename);
      if (!fs.existsSync(file)) {
        res.status(404).json({ error: 'النسخة الاحتياطية غير موجودة' });
        return;
      }
      res.download(file, req.params.filename);
    } catch (err) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'وصول مرفوض' });
    }
  });

  router.post('/backups/restore', requireRole(['owner']), async (req, res) => {
    try {
      const filename = String(req.body?.filename || '');
      await restoreDatabaseBackup(filename);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
