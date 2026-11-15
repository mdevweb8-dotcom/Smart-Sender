import fs from 'node:fs';
import { getFileById, incrementFileSendCount } from '../database/repositories/filesRepo.ts';
import { logMessage, logSystem, type MessageInteractionType } from '../database/repositories/logsRepo.ts';
import type { ScheduledTaskRecord } from '../database/repositories/tasksRepo.ts';
import { touchContactChatActivity } from '../database/repositories/usersRepo.ts';
import type { WhatsAppTransport } from './provider.ts';

export async function executeTaskDelivery(
  transport: WhatsAppTransport,
  task: ScheduledTaskRecord
): Promise<{ ok: boolean; error?: string; details?: Record<string, unknown> }> {
  const fileIds: string[] = JSON.parse(task.file_ids_json || '[]');
  const destination = task.destination_id;

  if (!destination) {
    return { ok: false, error: 'لم يتم تحديد معرف الوجهة للإرسال' };
  }

  if (fileIds.length === 0) {
    const text = task.message_text?.trim();
    if (!text) {
      return { ok: false, error: 'المهمة لا تحتوي على ملف أو نص للإرسال' };
    }
    const res = await transport.sendText(destination, text);
    logMessage({
      direction: 'outbound',
      whatsappMessageId: res.messageId || '',
      recipientId: destination,
      recipientLabel: task.destination_label,
      interactionType: 'scheduled',
      messageType: 'text',
      contentPreview: text,
      taskId: task.id,
      status: res.ok ? 'sent' : 'failed',
      errorMessage: res.error || '',
    });
    return { ok: res.ok, error: res.error, details: { messageId: res.messageId } };
  }

  const sentMessageIds: string[] = [];
  for (let i = 0; i < fileIds.length; i++) {
    const fileId = fileIds[i];
    const file = getFileById(fileId);
    if (!file) {
      const errMsg = `الملف (${fileId}) غير موجود في قاعدة البيانات`;
      logMessage({
        direction: 'outbound',
        recipientId: destination,
        recipientLabel: task.destination_label,
        interactionType: 'scheduled',
        messageType: 'file',
        contentPreview: task.message_text || fileId,
        fileId,
        taskId: task.id,
        status: 'failed',
        errorMessage: errMsg,
      });
      return { ok: false, error: errMsg };
    }

    if (!fs.existsSync(file.storage_path)) {
      const errMsg = `الملف (${file.original_name}) غير موجود على القرص`;
      logMessage({
        direction: 'outbound',
        recipientId: destination,
        recipientLabel: task.destination_label,
        interactionType: 'scheduled',
        messageType: file.file_type,
        contentPreview: file.original_name,
        fileId: file.id,
        taskId: task.id,
        status: 'failed',
        errorMessage: errMsg,
      });
      return { ok: false, error: errMsg };
    }

    const caption = i === 0 ? task.message_text : undefined;
    const res = await transport.sendFile(destination, file.storage_path, caption, file.original_name);
    logMessage({
      direction: 'outbound',
      whatsappMessageId: res.messageId || '',
      recipientId: destination,
      recipientLabel: task.destination_label,
      interactionType: 'scheduled',
      messageType: file.file_type,
      contentPreview: `${file.original_name}${caption ? ' — ' + caption : ''}`,
      fileId: file.id,
      taskId: task.id,
      status: res.ok ? 'sent' : 'failed',
      errorMessage: res.error || '',
    });

    if (!res.ok) {
      // Never delete original file on failure!
      logSystem('error', 'sender', `فشل إرسال الملف ${file.original_name} إلى ${task.destination_label}: ${res.error}`);
      return { ok: false, error: res.error || 'فشل إرسال الملف' };
    }

    incrementFileSendCount(file.id);
    if (res.messageId) sentMessageIds.push(res.messageId);
  }

  return { ok: true, details: { sentMessageIds, fileCount: fileIds.length } };
}

export async function sendImmediateMessage(
  transport: WhatsAppTransport,
  params: {
    destinationId: string;
    destinationLabel: string;
    fileId?: string;
    messageText?: string;
    interactionType?: MessageInteractionType;
    contactPhone?: string;
  }
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const interactionType = params.interactionType || 'bot_command';

  if (params.fileId) {
    const file = getFileById(params.fileId);
    if (!file || !fs.existsSync(file.storage_path)) {
      return { ok: false, error: 'الملف غير موجود' };
    }
    const res = await transport.sendFile(
      params.destinationId,
      file.storage_path,
      params.messageText,
      file.original_name
    );
    logMessage({
      direction: 'outbound',
      whatsappMessageId: res.messageId || '',
      recipientId: params.destinationId,
      recipientLabel: params.destinationLabel,
      contactPhone: params.contactPhone,
      interactionType,
      messageType: file.file_type,
      contentPreview: `${file.original_name}${params.messageText ? ' — ' + params.messageText : ''}`,
      fileId: file.id,
      status: res.ok ? 'sent' : 'failed',
      errorMessage: res.error || '',
    });
    if (res.ok) incrementFileSendCount(file.id);
    return res;
  }

  const res = await transport.sendText(params.destinationId, params.messageText || '');
  logMessage({
    direction: 'outbound',
    whatsappMessageId: res.messageId || '',
    recipientId: params.destinationId,
    recipientLabel: params.destinationLabel,
    contactPhone: params.contactPhone,
    interactionType,
    messageType: 'text',
    contentPreview: params.messageText || '',
    status: res.ok ? 'sent' : 'failed',
    errorMessage: res.error || '',
  });
  return res;
}

export async function sendDirectChatMessage(
  transport: WhatsAppTransport,
  params: {
    phoneE164: string;
    contactLabel: string;
    text: string;
  }
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const digits = params.phoneE164.replace(/\D/g, '');
  const chatId = `${digits}@c.us`;
  const res = await transport.sendText(chatId, params.text);

  logMessage({
    direction: 'outbound',
    whatsappMessageId: res.messageId || '',
    recipientId: chatId,
    recipientLabel: params.contactLabel || digits,
    contactPhone: `+${digits}`,
    phone: digits,
    nickname: params.contactLabel || digits,
    messageText: params.text,
    interactionType: 'live_chat',
    messageType: 'text',
    contentPreview: params.text,
    status: res.ok ? 'sent' : 'failed',
    errorMessage: res.error || '',
  });

  if (res.ok) {
    touchContactChatActivity(digits, false);
  }

  return res;
}
