import { listFiles } from '../database/repositories/filesRepo.ts';
import { listFolders } from '../database/repositories/foldersRepo.ts';
import { listGroups } from '../database/repositories/groupsRepo.ts';
import { listScheduledTasks } from '../database/repositories/tasksRepo.ts';
import { getSetting } from '../database/repositories/settingsRepo.ts';
import { logSystem } from '../database/repositories/logsRepo.ts';
import { getRecentMemory } from './memory.ts';
import { getAIProvider } from './gemini.ts';
import { ParsedCommandSchema, type ParsedCommand } from './schemas.ts';

const CONFIRM_WORDS = new Set(['نعم', 'أكيد', 'اكيد', 'تأكيد', 'تاكيد', 'موافق', 'نفذ', 'تم', 'yes', 'confirm', 'ok']);
const CANCEL_WORDS = new Set(['لا', 'إلغاء', 'الغاء', 'الغي', 'تراجع', 'ارفض', 'cancel', 'no']);

export function detectDirectConfirmation(text: string): 'confirm' | 'cancel' | null {
  const clean = (text || '').trim().toLowerCase().replace(/[.!؟،]/g, '');
  if (CONFIRM_WORDS.has(clean)) return 'confirm';
  if (CANCEL_WORDS.has(clean)) return 'cancel';
  return null;
}

function getLocalClockString(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Deterministic Arabic fallback parser used ONLY when Gemini is unconfigured
 * or temporarily unreachable, so critical queries/confirmations still work reliably.
 */
export function deterministicArabicFallback(message: string): ParsedCommand {
  const text = message.trim();
  const confirmCheck = detectDirectConfirmation(text);
  if (confirmCheck === 'confirm') {
    return ParsedCommandSchema.parse({ intent: 'confirm_action', confidence: 0.99 });
  }
  if (confirmCheck === 'cancel') {
    return ParsedCommandSchema.parse({ intent: 'cancel_pending', confidence: 0.99 });
  }

  if (/^(السلام عليكم|مرحبا|مرحباً|أهلا|أهلاً|هلا|اهلا|صباح الخير|مساء الخير|هاي|hi|hello)/i.test(text)) {
    return ParsedCommandSchema.parse({
      intent: 'chat_help',
      reply_ar:
        'أهلاً بك في Smart-Sender! أنا جاهز لمساعدتك في استقبال الملفات وتنظيمها وجدولتها وإرسالها عبر واتساب. كيف أساعدك اليوم؟',
      confidence: 0.92,
    });
  }
  if (/مسح الذاكرة|امسح الذاكرة|انسى المحادثة/.test(text)) {
    return ParsedCommandSchema.parse({ intent: 'clear_memory', confidence: 0.95 });
  }
  if (/ما الملفات.*اليوم|ملفات اليوم|استلمتها اليوم/.test(text)) {
    return ParsedCommandSchema.parse({ intent: 'list_files', today_only: true, confidence: 0.9 });
  }
  if (/كم عدد الملفات|احصائيات|إحصائيات/.test(text)) {
    return ParsedCommandSchema.parse({ intent: 'query_stats', confidence: 0.9 });
  }
  if (/اعرض.*المهام|المهام القادمة|المهام المجدولة/.test(text)) {
    return ParsedCommandSchema.parse({ intent: 'list_tasks', confidence: 0.9 });
  }
  if (/اعرض.*المجموعات|المجموعات/.test(text)) {
    return ParsedCommandSchema.parse({ intent: 'list_groups', confidence: 0.9 });
  }
  if (/ابحث عن|أين حفظت/.test(text)) {
    const q = text.replace(/ابحث عن|أين حفظت|ملف|اسمه/g, '').trim();
    return ParsedCommandSchema.parse({ intent: 'search_files', file_query: q, confidence: 0.8 });
  }
  if (/اعرض الملفات في مجلد|ملفات مجلد/.test(text)) {
    const folder = text.replace(/اعرض الملفات في مجلد|اعرض|ملفات مجلد/g, '').trim();
    return ParsedCommandSchema.parse({ intent: 'list_files', folder_name: folder, confidence: 0.85 });
  }
  if (/أنشئ مجلد|انشئ مجلد|مجلد جديد/.test(text)) {
    const folder = text.replace(/أنشئ مجلد|انشئ مجلد|مجلد جديد|باسم/g, '').trim();
    return ParsedCommandSchema.parse({ intent: 'create_folder', folder_name: folder, confidence: 0.85 });
  }

  return ParsedCommandSchema.parse({
    intent: 'clarify',
    clarification_question_ar:
      'تم استلام رسالتك بنجاح. يمكنك التحدث معي باللغة العربية أو استخدام أوامر مثل: "ملفات اليوم"، "المهام القادمة"، "المجموعات"، أو "كم عدد الملفات".',
    confidence: 0.3,
  });
}

async function tryOpenAiCompatibleBotFallback(message: string): Promise<ParsedCommand | null> {
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const openRouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const endpoint = groqKey
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : openRouterKey
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : '';
  const apiKey = groqKey || openRouterKey;
  if (!endpoint || !apiKey) return null;

  const model = groqKey
    ? process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
    : process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'أنت مساعد Smart-Sender الذكي عبر واتساب. أجب المستخدم باللغة العربية باختصار ووضوح.',
          },
          { role: 'user', content: message },
        ],
        temperature: 0.4,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content?.trim();
    if (!reply) return null;
    return ParsedCommandSchema.parse({
      intent: 'chat_help',
      reply_ar: reply,
      confidence: 0.85,
    });
  } catch {
    return null;
  }
}

export async function parseUserArabicCommand(userPhone: string, message: string): Promise<ParsedCommand> {
  const direct = detectDirectConfirmation(message);
  if (direct === 'confirm') {
    return ParsedCommandSchema.parse({ intent: 'confirm_action', confidence: 1 });
  }
  if (direct === 'cancel') {
    return ParsedCommandSchema.parse({ intent: 'cancel_pending', confidence: 1 });
  }

  const ai = getAIProvider();
  if (!ai.isConfigured()) {
    const alt = await tryOpenAiCompatibleBotFallback(message);
    return alt || deterministicArabicFallback(message);
  }

  const timezone = getSetting('timezone', 'Africa/Khartoum');
  const memoryTurns = getRecentMemory(userPhone, 8).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const recentFiles = listFiles({ limit: 10 }).map((f) => ({
    id: f.id,
    name: f.original_name,
    folder: f.folder_name || '',
    type: f.file_type,
    receivedAt: f.received_at,
  }));
  const folders = listFolders().map((f) => f.name);
  const groups = listGroups().map((g) => ({
    id: g.wa_group_id,
    name: g.name,
    alias: g.alias,
  }));
  const upcomingTasks = listScheduledTasks({ status: 'Pending', limit: 10 }).map((t) => ({
    id: t.id,
    title: t.title,
    destination: t.destination_label,
    status: t.status,
    nextRunAt: t.next_run_at,
  }));

  try {
    return await ai.parseArabicCommand({
      userMessage: message,
      timezone,
      nowLocalIso: getLocalClockString(timezone),
      memoryTurns,
      recentFiles,
      folders,
      groups,
      upcomingTasks,
    });
  } catch (err) {
    logSystem('error', 'gemini', 'فشل تحليل الأمر عبر Gemini، تم التحويل للمحلل الاحتياطي', {
      error: err instanceof Error ? err.message : String(err),
    });
    const alt = await tryOpenAiCompatibleBotFallback(message);
    return alt || deterministicArabicFallback(message);
  }
}
