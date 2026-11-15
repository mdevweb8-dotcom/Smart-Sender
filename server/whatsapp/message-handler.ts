import {
  addMemoryTurn,
  clearUserMemory,
  createPendingAction,
  getLastReferencedFileId,
  getPendingAction,
  setPendingAction,
} from '../ai/memory.ts';
import { parseUserArabicCommand } from '../ai/command-parser.ts';
import type { ParsedCommand } from '../ai/schemas.ts';
import { checkWhatsAppPermission } from '../auth/permissions.ts';
import { normalizePhoneE164 } from '../config/env.ts';
import { getFileById, getFileStats, listFiles, type FileRecord } from '../database/repositories/filesRepo.ts';
import { createFolder, listFolders } from '../database/repositories/foldersRepo.ts';
import { listGroups } from '../database/repositories/groupsRepo.ts';
import { logMessage, logSystem } from '../database/repositories/logsRepo.ts';
import { getSetting, getSettingBoolean } from '../database/repositories/settingsRepo.ts';
import { touchContactChatActivity } from '../database/repositories/usersRepo.ts';
import {
  findTasksByQuery,
  getTaskById,
  getTaskStats,
  listScheduledTasks,
  updateScheduledTask,
} from '../database/repositories/tasksRepo.ts';
import { findBestMatchingFile, searchFilesSmart } from '../files/search.ts';
import { deleteFileCompletely, moveFileToFolder } from '../files/storage.ts';
import {
  cancelTask,
  computeNextRunIso,
  pauseTask,
  resumeTask,
  scheduleNewTask,
} from '../scheduler/task-manager.ts';
import { ingestAndAnalyzeFile } from './file-handler.ts';
import { assignGroupAlias, resolveTargetGroup } from './group-manager.ts';
import type { IncomingWhatsAppMessage, WhatsAppTransport } from './provider.ts';
import { sendImmediateMessage } from './sender.ts';

function formatLocalDateTime(iso: string | null, timezone: string): string {
  if (!iso) return 'غير محدد';
  try {
    return new Intl.DateTimeFormat('ar-SD', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function scheduleTypeLabelAr(type: string): string {
  const map: Record<string, string> = {
    once: 'مرة واحدة',
    daily: 'يومي',
    weekly: 'أسبوعي',
    monthly: 'شهري',
    custom_days: 'أيام محددة',
  };
  return map[type] || type;
}

function resolveFileReference(
  userPhone: string,
  fileQuery: string,
  recentUploadedFileId?: string
): FileRecord | null {
  if (recentUploadedFileId) {
    const f = getFileById(recentUploadedFileId);
    if (f) return f;
  }
  const clean = (fileQuery || '').trim();
  if (!clean || clean === 'latest' || clean === 'هذا الملف' || clean === 'الملف') {
    const lastId = getLastReferencedFileId(userPhone);
    if (lastId) {
      const f = getFileById(lastId);
      if (f) return f;
    }
    const latest = listFiles({ limit: 1 });
    return latest[0] || null;
  }
  const matches = findBestMatchingFile(clean);
  return matches[0] || null;
}

function resolveDestination(destQuery: string): {
  ok: true;
  type: 'group' | 'contact';
  id: string;
  label: string;
} | {
  ok: false;
  replyAr: string;
} {
  const clean = (destQuery || '').trim();
  if (!clean) {
    return { ok: false, replyAr: 'يرجى تحديد الوجهة (اسم المجموعة أو رقم الشخص).' };
  }

  // Check if it looks like a phone number
  if (/^\+?\d{8,15}$/.test(clean.replace(/[\s\-()]/g, ''))) {
    const e164 = normalizePhoneE164(clean);
    return { ok: true, type: 'contact', id: `${e164.replace('+', '')}@c.us`, label: e164 };
  }

  const groupRes = resolveTargetGroup(clean);
  if (groupRes.status === 'found') {
    return {
      ok: true,
      type: 'group',
      id: groupRes.group.wa_group_id,
      label: groupRes.group.alias || groupRes.group.name,
    };
  }
  if (groupRes.status === 'ambiguous') {
    const list = groupRes.candidates.map((g, i) => `${i + 1}. ${g.name} (${g.alias || g.wa_group_id})`).join('\n');
    return {
      ok: false,
      replyAr: `يوجد أكثر من مجموعة مطابقة للاسم "${clean}". أي مجموعة تقصد؟\n${list}`,
    };
  }
  return {
    ok: false,
    replyAr: `لم أجد مجموعة أو جهة اتصال مطابقة لـ "${clean}". يمكنك عرض المجموعات بكتابة: "اعرض المجموعات".`,
  };
}

export async function handleIncomingWhatsAppMessage(
  transport: WhatsAppTransport,
  msg: IncomingWhatsAppMessage
): Promise<string> {
  // Never reply to group messages — single Linked Device 1:1 chats only
  if (msg.isGroup) {
    return '';
  }

  // 1. Check real sender identity in authorized_users (is_active = 1 & permission != 'blocked')
  const perm = checkWhatsAppPermission(msg.senderPhoneE164, 'authorized');
  const messageText = msg.body || (msg.hasMedia ? '[مرفق ملف]' : '');

  if (!perm.allowed) {
    logMessage({
      direction: 'inbound',
      whatsappMessageId: msg.messageId,
      senderPhone: perm.phoneE164 || msg.senderPhoneE164,
      recipientId: 'bot',
      recipientLabel: msg.senderDisplayName || perm.phoneDigits || 'غير مصرح له',
      contactPhone: perm.phoneE164 || msg.senderPhoneE164,
      phone: perm.phoneDigits,
      nickname: msg.senderDisplayName || perm.phoneDigits,
      messageText,
      interactionType: 'unauthorized_attempt',
      messageType: msg.hasMedia ? 'media' : 'text',
      contentPreview: messageText,
      status: 'rejected',
      errorMessage: perm.reason || 'غير مصرح له',
    });
    logSystem('warn', 'auth', `تم تجاهل محاولة مراسلة غير مصرح بها من الرقم ${perm.phoneDigits || msg.senderPhoneE164}`);
    // Requirement: never reply to unauthorized numbers
    return '';
  }

  // Record contact activity and increment unread counter for Live Chat bubble
  touchContactChatActivity(perm.phoneDigits, true);

  // If permission is view_only, log inbound message for Owner inspection in Live Chat without bot auto-reply
  if (perm.permission === 'view_only' && perm.role !== 'owner') {
    logMessage({
      direction: 'inbound',
      whatsappMessageId: msg.messageId,
      senderPhone: perm.phoneE164,
      recipientId: 'bot',
      recipientLabel: perm.nickname,
      contactPhone: perm.phoneE164,
      phone: perm.phoneDigits,
      nickname: perm.nickname,
      messageText,
      interactionType: 'live_chat',
      messageType: msg.hasMedia ? 'media' : 'text',
      contentPreview: messageText,
      status: 'received',
    });
    return '';
  }

  logMessage({
    direction: 'inbound',
    whatsappMessageId: msg.messageId,
    senderPhone: perm.phoneE164,
    recipientId: 'bot',
    recipientLabel: perm.nickname,
    contactPhone: perm.phoneE164,
    phone: perm.phoneDigits,
    nickname: perm.nickname,
    messageText,
    interactionType: 'bot_auto',
    messageType: msg.hasMedia ? 'media' : 'text',
    contentPreview: messageText,
    status: 'received',
  });

  const replyTarget = msg.fromRaw;
  const sendReply = async (text: string): Promise<string> => {
    const res = await transport.sendText(replyTarget, text);
    logMessage({
      direction: 'outbound',
      whatsappMessageId: res.messageId || '',
      recipientId: replyTarget,
      recipientLabel: perm.nickname,
      contactPhone: perm.phoneE164,
      phone: perm.phoneDigits,
      nickname: perm.nickname,
      messageText: text,
      interactionType: 'bot_auto',
      messageType: 'text',
      contentPreview: text,
      status: res.ok ? 'sent' : 'failed',
      errorMessage: res.error || '',
    });
    addMemoryTurn(perm.phoneE164, 'assistant', text);
    return text;
  };

  let uploadedFile: FileRecord | null = null;

  // 2. If message carries media, ingest, classify, save, and analyze first
  if (msg.hasMedia && msg.downloadMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media) {
        uploadedFile = await ingestAndAnalyzeFile({
          buffer: media.buffer,
          originalName: media.filename,
          mimeType: media.mimeType,
          captionHint: msg.body,
          senderPhone: msg.senderPhoneE164,
          senderName: msg.senderDisplayName,
          sourceGroupId: msg.groupId || '',
          sourceGroupName: msg.groupName || '',
        });

        addMemoryTurn(msg.senderPhoneE164, 'user', msg.body || `أرسلت ملف: ${uploadedFile.original_name}`, {
          fileId: uploadedFile.id,
          fileName: uploadedFile.original_name,
        });

        // If no text command accompanied the media, report saving & analysis honestly
        if (!msg.body || !msg.body.trim()) {
          const analysisLine =
            uploadedFile.analysis_status === 'completed' && uploadedFile.ai_summary
              ? `\nالملخص: ${uploadedFile.ai_summary}`
              : uploadedFile.analysis_status === 'failed'
                ? '\nملاحظة: تم حفظ الملف بنجاح، لكن تعذر تحليل محتواه حالياً.'
                : '';
          return sendReply(
            `تم استلام وحفظ الملف بنجاح:\n- الاسم: ${uploadedFile.original_name}\n- النوع: ${uploadedFile.file_type}\n- المجلد: ${uploadedFile.folder_name || 'المستندات'}${analysisLine}`
          );
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logSystem('error', 'files', `فشل استقبال ملف من ${msg.senderPhoneE164}: ${errMsg}`);
      return sendReply(`تعذر حفظ الملف المرسل: ${errMsg}`);
    }
  } else if (msg.body.trim()) {
    addMemoryTurn(msg.senderPhoneE164, 'user', msg.body.trim());
  }

  const textBody = (msg.body || '').trim();
  if (!textBody) {
    return sendReply('أرسل ملفاً أو اكتب طلبك بالعربية وسأساعدك فوراً.');
  }

  // 3. Parse natural Arabic command (with memory + Gemini structured output)
  const cmd: ParsedCommand = await parseUserArabicCommand(msg.senderPhoneE164, textBody);
  const timezone = getSetting('timezone', 'Africa/Khartoum');

  // 4. Handle pending confirmation / clarification actions
  const pending = getPendingAction(msg.senderPhoneE164);
  if (cmd.intent === 'confirm_action' && pending) {
    return executeConfirmedPendingAction(transport, msg.senderPhoneE164, pending, uploadedFile, sendReply);
  }
  if (cmd.intent === 'cancel_pending' && pending) {
    setPendingAction(msg.senderPhoneE164, null);
    return sendReply('تم إلغاء العملية المعلقة ولن يتم تنفيذها.');
  }

  // 5. Execute parsed intent safely
  switch (cmd.intent) {
    case 'clear_memory': {
      clearUserMemory(msg.senderPhoneE164);
      return sendReply('تم مسح ذاكرة المحادثة القريبة بنجاح.');
    }

    case 'create_folder': {
      const name = (cmd.folder_name || '').trim();
      if (!name) return sendReply('ما الاسم الذي تريد إنشاء المجلد به؟');
      const folder = createFolder(name);
      return sendReply(`تم إنشاء/تجهيز المجلد "${folder.name}" بنجاح.`);
    }

    case 'organize_file': {
      const targetFile = resolveFileReference(msg.senderPhoneE164, cmd.file_query, uploadedFile?.id);
      if (!targetFile) {
        return sendReply('لم أجد الملف المطلوب. اكتب اسم الملف أو أرسله أولاً.');
      }
      const folderName = (cmd.folder_name || '').trim();
      if (!folderName) {
        return sendReply(`إلى أي مجلد تريد نقل الملف "${targetFile.original_name}"؟`);
      }
      const moved = moveFileToFolder(targetFile.id, folderName);
      if (!moved) return sendReply('تعذر نقل الملف للمجلد المطلوب.');
      return sendReply(`تم حفظ ونقل الملف "${moved.original_name}" إلى مجلد "${moved.folder_name}".`);
    }

    case 'delete_file': {
      if (perm.role !== 'owner' && perm.role !== 'admin') {
        return sendReply('حذف الملفات متاح فقط للمالك أو المدير.');
      }
      const targetFile = resolveFileReference(msg.senderPhoneE164, cmd.file_query, uploadedFile?.id);
      if (!targetFile) return sendReply('لم أجد الملف المطلوب حذفه.');

      createPendingAction(msg.senderPhoneE164, 'confirm_delete_file', {
        fileId: targetFile.id,
        fileName: targetFile.original_name,
      });
      return sendReply(
        `تأكيد الحذف:\nهل أنت متأكد من حذف الملف "${targetFile.original_name}" من مجلد "${targetFile.folder_name || 'غير مصنف'}" نهائياً؟\nأجب بـ "نعم" للتأكيد أو "لا" للإلغاء.`
      );
    }

    case 'list_files':
    case 'search_files': {
      const files = searchFilesSmart({
        query: cmd.file_query && cmd.file_query !== 'latest' ? cmd.file_query : undefined,
        folderName: cmd.folder_name || undefined,
        todayOnly: cmd.today_only,
        limit: 15,
      });
      if (files.length === 0) {
        return sendReply('لا توجد ملفات مطابقة لطلبك في قاعدة البيانات.');
      }
      const lines = files.map(
        (f, i) =>
          `${i + 1}. ${f.original_name} (${f.folder_name || 'غير مصنف'} · ${Math.max(1, Math.round(f.size_bytes / 1024))} KB · مرات الإرسال: ${f.send_count})`
      );
      return sendReply(`الملفات المطابقة (${files.length}):\n${lines.join('\n')}`);
    }

    case 'query_stats': {
      const fStats = getFileStats();
      const tStats = getTaskStats();
      return sendReply(
        `ملخص الحالة الحالية:\n- إجمالي الملفات: ${fStats.total_files}\n- المهام القادمة: ${tStats.Pending || 0}\n- المهام المكتملة: ${tStats.Completed || 0}\n- المهام الفاشلة: ${tStats.Failed || 0}`
      );
    }

    case 'list_groups': {
      const groups = listGroups();
      if (groups.length === 0) {
        return sendReply('لا توجد مجموعات مسجلة حالياً. تأكد من اتصال واتساب ومزامنة المجموعات.');
      }
      const lines = groups.map(
        (g, i) =>
          `${i + 1}. ${g.name}${g.alias ? ` (الاسم المستعار: ${g.alias})` : ''} — ${g.member_count} عضو`
      );
      return sendReply(`المجموعات المسجلة (${groups.length}):\n${lines.join('\n')}`);
    }

    case 'set_group_alias': {
      if (!cmd.destination || !cmd.group_alias) {
        return sendReply('يرجى تحديد اسم المجموعة والاسم المستعار المطلوب ربطه بها.');
      }
      const updated = assignGroupAlias(cmd.destination, cmd.group_alias);
      if (!updated) {
        return sendReply(`تعذر العثور على مجموعة واضحة باسم "${cmd.destination}".`);
      }
      return sendReply(`تم ربط الاسم المستعار "${updated.alias}" بالمجموعة "${updated.name}" بنجاح.`);
    }

    case 'schedule_file':
    case 'send_now': {
      // Optional folder move first if user said "احفظه في مجلد ... وأرسله..."
      let targetFile = resolveFileReference(msg.senderPhoneE164, cmd.file_query, uploadedFile?.id);
      if (uploadedFile && cmd.folder_name) {
        const moved = moveFileToFolder(uploadedFile.id, cmd.folder_name);
        if (moved) targetFile = moved;
      }

      if (!targetFile && !cmd.message_text) {
        return sendReply('ما الملف أو الرسالة التي تريد إرسالها؟');
      }

      if (!cmd.destination) {
        if (targetFile) {
          addMemoryTurn(msg.senderPhoneE164, 'system', `ملف محدد: ${targetFile.original_name}`, {
            fileId: targetFile.id,
          });
        }
        return sendReply('إلى أي مجموعة أو شخص تريد إرسال هذا الملف؟');
      }

      const destRes = resolveDestination(cmd.destination);
      if (!destRes.ok) {
        return sendReply(destRes.replyAr);
      }

      if (cmd.intent === 'send_now') {
        const requireConfirm =
          destRes.type === 'group' && getSettingBoolean('require_confirmation_group_send', true);

        if (requireConfirm) {
          createPendingAction(msg.senderPhoneE164, 'confirm_send', {
            fileId: targetFile?.id || null,
            fileName: targetFile?.original_name || '',
            messageText: cmd.message_text || '',
            destinationType: destRes.type,
            destinationId: destRes.id,
            destinationLabel: destRes.label,
          });
          return sendReply(
            `ملخص الإرسال الفوري:\n- المحتوى: ${targetFile ? targetFile.original_name : cmd.message_text}\n- الوجهة: ${destRes.label}\nهل أرسل الآن؟ أجب بـ "نعم" للتأكيد أو "لا" للإلغاء.`
          );
        }

        const res = await sendImmediateMessage(transport, {
          destinationId: destRes.id,
          destinationLabel: destRes.label,
          fileId: targetFile?.id,
          messageText: cmd.message_text,
        });
        return sendReply(
          res.ok
            ? `تم الإرسال إلى "${destRes.label}" بنجاح.`
            : `فشل الإرسال إلى "${destRes.label}": ${res.error}`
        );
      }

      // Schedule flow
      const sched = cmd.schedule;
      if (
        !sched ||
        (!sched.time_hhmm && !sched.date_iso && !sched.relative_day && !sched.day_of_week && !sched.day_of_month)
      ) {
        if (targetFile) {
          addMemoryTurn(msg.senderPhoneE164, 'system', `ملف محدد: ${targetFile.original_name}، الوجهة: ${destRes.label}`, {
            fileId: targetFile.id,
            destination: destRes.label,
          });
        }
        return sendReply(`متى تريد إرسال ${targetFile ? `"${targetFile.original_name}"` : 'الرسالة'} إلى "${destRes.label}"؟`);
      }

      const nextRunAt = computeNextRunIso({
        scheduleType: sched.type,
        timeOfDay: sched.time_hhmm || '09:00',
        dateIso: sched.date_iso,
        relativeDay: sched.relative_day,
        dayOfWeek: sched.day_of_week,
        daysOfWeek: sched.days_of_week,
        dayOfMonth: sched.day_of_month,
        timezone,
      });

      const requireConfirm =
        destRes.type === 'group' && getSettingBoolean('require_confirmation_group_send', true);

      if (requireConfirm) {
        createPendingAction(msg.senderPhoneE164, 'confirm_schedule', {
          title: targetFile ? `إرسال ${targetFile.original_name}` : 'رسالة مجدولة',
          taskType: targetFile ? 'file' : 'text',
          fileIds: targetFile ? [targetFile.id] : [],
          fileName: targetFile?.original_name || '',
          messageText: cmd.message_text || '',
          destinationType: destRes.type,
          destinationId: destRes.id,
          destinationLabel: destRes.label,
          scheduleType: sched.type,
          daysOfWeek: sched.days_of_week.length ? sched.days_of_week : sched.day_of_week ? [sched.day_of_week] : [],
          dayOfMonth: sched.day_of_month,
          timeOfDay: sched.time_hhmm || '09:00',
          nextRunAt,
          timezone,
        });
        return sendReply(
          `تأكيد الجدولة:\n- الملف/المحتوى: ${targetFile ? targetFile.original_name : cmd.message_text}\n- الوجهة: ${destRes.label}\n- الموعد القادم: ${formatLocalDateTime(nextRunAt, timezone)} (${timezone})\n- التكرار: ${scheduleTypeLabelAr(sched.type)}\nأجب بـ "نعم" لتأكيد الحفظ والجدولة أو "لا" للإلغاء.`
        );
      }

      const task = scheduleNewTask({
        title: targetFile ? `إرسال ${targetFile.original_name}` : 'رسالة مجدولة',
        taskType: targetFile ? 'file' : 'text',
        fileIds: targetFile ? [targetFile.id] : [],
        messageText: cmd.message_text || '',
        destinationType: destRes.type,
        destinationId: destRes.id,
        destinationLabel: destRes.label,
        scheduleType: sched.type,
        daysOfWeek: sched.days_of_week.length ? sched.days_of_week : sched.day_of_week ? [sched.day_of_week] : [],
        dayOfMonth: sched.day_of_month,
        timeOfDay: sched.time_hhmm || '09:00',
        explicitNextRunIso: nextRunAt || undefined,
        timezone,
        createdByPhone: msg.senderPhoneE164,
      });
      return sendReply(
        `تمت الجدولة بنجاح (رقم المهمة: ${task.id.slice(0, 8)}).\nالموعد القادم: ${formatLocalDateTime(task.next_run_at, timezone)}`
      );
    }

    case 'list_tasks': {
      const tasks = listScheduledTasks({ status: 'Pending', limit: 15 });
      if (tasks.length === 0) {
        return sendReply('لا توجد مهام مجدولة قادمة حالياً.');
      }
      const lines = tasks.map(
        (t, i) =>
          `${i + 1}. ${t.title} -> ${t.destination_label} | ${formatLocalDateTime(t.next_run_at, t.timezone)} (${scheduleTypeLabelAr(t.schedule_type)})`
      );
      return sendReply(`المهام المجدولة القادمة (${tasks.length}):\n${lines.join('\n')}`);
    }

    case 'task_cancel':
    case 'task_pause':
    case 'task_resume':
    case 'task_update': {
      const candidates = cmd.task_id
        ? ([getTaskById(cmd.task_id)].filter(Boolean) as ReturnType<typeof findTasksByQuery>)
        : cmd.task_query
          ? findTasksByQuery(cmd.task_query)
          : listScheduledTasks({ status: 'Pending', limit: 10 });

      if (candidates.length === 0) {
        return sendReply('لم أجد مهمة مطابقة لهذا الوصف.');
      }
      if (candidates.length > 1) {
        const list = candidates
          .slice(0, 5)
          .map((t, i) => `${i + 1}. ${t.title} -> ${t.destination_label} (${formatLocalDateTime(t.next_run_at, t.timezone)})`)
          .join('\n');
        return sendReply(`يوجد أكثر من مهمة مطابقة، حدد اسم المهمة بدقة أكبر:\n${list}`);
      }

      const task = candidates[0];
      if (cmd.intent === 'task_cancel') {
        cancelTask(task.id);
        return sendReply(`تم إلغاء المهمة "${task.title}" بنجاح.`);
      }
      if (cmd.intent === 'task_pause') {
        pauseTask(task.id);
        return sendReply(`تم إيقاف المهمة "${task.title}" مؤقتاً.`);
      }
      if (cmd.intent === 'task_resume') {
        resumeTask(task.id);
        return sendReply(`تم استئناف المهمة "${task.title}" بنجاح.`);
      }
      if (cmd.intent === 'task_update' && cmd.schedule?.time_hhmm) {
        const nextRunAt = computeNextRunIso({
          scheduleType: task.schedule_type,
          timeOfDay: cmd.schedule.time_hhmm,
          daysOfWeek: JSON.parse(task.cron_days_json || '[]'),
          dayOfMonth: task.day_of_month,
          timezone: task.timezone,
        });
        updateScheduledTask(task.id, {
          time_of_day: cmd.schedule.time_hhmm,
          next_run_at: nextRunAt,
        });
        return sendReply(
          `تم تعديل موعد المهمة "${task.title}" إلى ${formatLocalDateTime(nextRunAt, task.timezone)}.`
        );
      }
      return sendReply('يرجى تحديد التعديل المطلوب على المهمة (مثل الوقت الجديد).');
    }

    case 'clarify':
      return sendReply(cmd.clarification_question_ar || 'هل يمكنك توضيح طلبك بشكل أدق؟');

    case 'chat_help':
    default:
      return sendReply(
        cmd.reply_ar ||
          'مرحباً بك في Smart-Sender! يمكنك إرسال أي ملف مع طلبك بالعربية مثل: "احفظ هذا الملف في مجلد المحاضرات وأرسله لمجموعة الدراسة غداً الساعة 8 مساءً".'
      );
  }
}

async function executeConfirmedPendingAction(
  transport: WhatsAppTransport,
  userPhone: string,
  pending: NonNullable<ReturnType<typeof getPendingAction>>,
  _uploadedFile: FileRecord | null,
  sendReply: (text: string) => Promise<string>
): Promise<string> {
  setPendingAction(userPhone, null);
  const p = pending.payload;

  if (pending.type === 'confirm_delete_file') {
    const ok = deleteFileCompletely(String(p.fileId));
    return sendReply(ok ? `تم حذف الملف "${p.fileName}" نهائياً.` : 'تعذر حذف الملف.');
  }

  if (pending.type === 'confirm_send') {
    const res = await sendImmediateMessage(transport, {
      destinationId: String(p.destinationId),
      destinationLabel: String(p.destinationLabel),
      fileId: p.fileId ? String(p.fileId) : undefined,
      messageText: p.messageText ? String(p.messageText) : undefined,
    });
    return sendReply(
      res.ok
        ? `تم الإرسال إلى "${p.destinationLabel}" بنجاح.`
        : `فشل الإرسال إلى "${p.destinationLabel}": ${res.error}`
    );
  }

  if (pending.type === 'confirm_schedule') {
    const timezone = String(p.timezone || 'Africa/Khartoum');
    const task = scheduleNewTask({
      title: String(p.title),
      taskType: (p.taskType as 'file' | 'text' | 'multi_file') || 'file',
      fileIds: Array.isArray(p.fileIds) ? (p.fileIds as string[]) : [],
      messageText: String(p.messageText || ''),
      destinationType: (p.destinationType as 'group' | 'contact') || 'group',
      destinationId: String(p.destinationId),
      destinationLabel: String(p.destinationLabel),
      scheduleType: (p.scheduleType as 'once' | 'daily' | 'weekly' | 'monthly' | 'custom_days') || 'once',
      daysOfWeek: Array.isArray(p.daysOfWeek) ? (p.daysOfWeek as string[]) : [],
      dayOfMonth: typeof p.dayOfMonth === 'number' ? p.dayOfMonth : null,
      timeOfDay: String(p.timeOfDay || '09:00'),
      explicitNextRunIso: typeof p.nextRunAt === 'string' ? p.nextRunAt : undefined,
      timezone,
      requiresConfirmation: true,
      isConfirmed: true,
      createdByPhone: userPhone,
    });
    return sendReply(
      `تم تأكيد وحفظ المهمة المجدولة "${task.title}" بنجاح.\nالموعد القادم: ${formatLocalDateTime(task.next_run_at, timezone)}`
    );
  }

  return sendReply('تم تأكيد الإجراء.');
}
