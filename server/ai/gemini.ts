import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import { config } from '../config/env.ts';
import { getSetting, getSettingNumber } from '../database/repositories/settingsRepo.ts';
import { logSystem } from '../database/repositories/logsRepo.ts';
import {
  GEMINI_COMMAND_RESPONSE_SCHEMA,
  GEMINI_FILE_ANALYSIS_SCHEMA,
  ParsedCommandSchema,
  type ParsedCommand,
} from './schemas.ts';

export interface CommandParseContext {
  userMessage: string;
  timezone: string;
  nowLocalIso: string;
  memoryTurns: Array<{ role: string; content: string }>;
  recentFiles: Array<{ id: string; name: string; folder: string; type: string; receivedAt: string }>;
  folders: string[];
  groups: Array<{ id: string; name: string; alias: string }>;
  upcomingTasks: Array<{ id: string; title: string; destination: string; status: string; nextRunAt: string | null }>;
}

export interface FileAnalysisInput {
  filePath: string;
  originalName: string;
  mimeType: string;
  fileType: string;
}

export interface FileAnalysisResult {
  status: 'completed' | 'failed' | 'unsupported';
  categoryFolder: string;
  summaryAr: string;
  transcript: string;
  error?: string;
}

export interface AIProvider {
  readonly name: string;
  isConfigured(): boolean;
  getActiveModel(): string;
  parseArabicCommand(ctx: CommandParseContext): Promise<ParsedCommand>;
  analyzeFile(input: FileAnalysisInput): Promise<FileAnalysisResult>;
  healthCheck(): Promise<{ ok: boolean; model: string; configured: boolean; message: string }>;
}

const VALID_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-3.5-transcribe',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiAIProvider implements AIProvider {
  readonly name = 'gemini';

  isConfigured(): boolean {
    return Boolean(config.geminiApiKey && config.geminiApiKey !== 'MY_GEMINI_API_KEY');
  }

  getActiveModel(): string {
    const configured = getSetting('gemini_model', config.geminiModel || 'gemini-4-hydrogen').trim();
    if (!configured || configured === 'gemini-3.8-flash') {
      // Map deprecated/alias name to supported active Gemini model
      return 'gemini-4-hydrogen';
    }
    return VALID_MODELS.has(configured) ? configured : 'gemini-4-hydrogen';
  }

  private createClient(): GoogleGenAI {
    if (!this.isConfigured()) {
      throw new Error('مفتاح GEMINI_API_KEY غير مضبوط في متغيرات البيئة على الخادم');
    }
    return new GoogleGenAI({
      apiKey: config.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  private async withRetryAndTimeout<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const timeoutMs = getSettingNumber('gemini_timeout_ms', config.geminiTimeoutMs || 25000);
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`انتهت مهلة استجابة Gemini (${timeoutMs}ms)`)), timeoutMs)
          ),
        ]);
        return result;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        logSystem('warn', 'gemini', `فشل محاولة ${attempt} لعملية ${label}: ${msg}`);
        if (attempt < 2) {
          await sleep(600 * attempt);
        }
      }
    }
    throw lastError;
  }

  async parseArabicCommand(ctx: CommandParseContext): Promise<ParsedCommand> {
    const ai = this.createClient();
    const model = this.getActiveModel();

    const systemInstruction = `أنت محلل أوامر ذكي ومساعد شخصي لنظام Smart-Sender لإدارة ملفات واتساب وجدولة الإرسال والدردشة مع المستخدمين المصرح لهم.
مهمتك تحويل رسالة المستخدم العربية إلى JSON منظم بدقة تامة دون تنفيذ أي أوامر أو اختلاق ملفات أو مجموعات غير موجودة.
القواعد الصارمة:
1. المنطقة الزمنية الحالية هي: ${ctx.timezone} والوقت الحالي: ${ctx.nowLocalIso}.
2. حوّل الأوقات العربية إلى صيغة 24 ساعة (مثال: "8 مساءً" -> "20:00"، "7 صباحاً" -> "07:00").
3. إذا أشار المستخدم لملف مثل "هذا الملف" أو "الملف الأخير" ضع file_query = "latest" أو استنتجه من ذاكرة المحادثة القريبة.
4. إذا كانت الرسالة تحية أو دردشة عامة أو سؤالاً عن قدرات البوت، اجعل intent = "chat_help" واكتب رداً عربياً ودوداً ومختصراً وطبيعياً في reply_ar.
5. إذا كانت الرسالة أمراً ينقصه وجهة أو موعد عند الجدولة أو يوجد التباس، اجعل intent = "clarify" واكتب سؤالاً واضحاً ومختصراً بالعربية في clarification_question_ar ولا تخمّن.
6. عند الإرسال لمجموعة أو الحذف، اجعل requires_confirmation = true.
7. استخرج أسماء المجموعات أو الأسماء المستعارة بدقة من القائمة المتاحة إن وجدت.`;

    const contextBlock = JSON.stringify(
      {
        memory: ctx.memoryTurns.slice(-6),
        folders: ctx.folders,
        recentFiles: ctx.recentFiles.slice(0, 8),
        groups: ctx.groups.slice(0, 15),
        upcomingTasks: ctx.upcomingTasks.slice(0, 10),
        userMessage: ctx.userMessage,
      },
      null,
      2
    );

    const response = await this.withRetryAndTimeout(
      () =>
        ai.models.generateContent({
          model,
          contents: `حلل الرسالة التالية في ضوء السياق وأرجع JSON فقط:\n${contextBlock}`,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_COMMAND_RESPONSE_SCHEMA,
          },
        }),
      'parseArabicCommand'
    );

    const rawText = (response.text || '').trim();
    if (!rawText) {
      throw new Error('لم يُرجع Gemini استجابة نصية صالحة');
    }

    const json = JSON.parse(rawText);
    const parsed = ParsedCommandSchema.safeParse(json);
    if (!parsed.success) {
      logSystem('warn', 'gemini', 'فشل التحقق من بنية JSON العائدة من Gemini', {
        issues: parsed.error.issues.map((i) => i.message),
      });
      return ParsedCommandSchema.parse({
        intent: 'clarify',
        clarification_question_ar: 'لم أتمكن من فهم طلبك بشكل كامل. هل يمكنك توضيح المطلوب بدقة؟',
        confidence: 0.2,
      });
    }

    logSystem('info', 'gemini', `تم تحليل أمر المستخدم بنجاح (${parsed.data.intent})`, {
      model,
      confidence: parsed.data.confidence,
    });
    return parsed.data;
  }

  async analyzeFile(input: FileAnalysisInput): Promise<FileAnalysisResult> {
    if (!this.isConfigured()) {
      return {
        status: 'failed',
        categoryFolder: '',
        summaryAr: '',
        transcript: '',
        error: 'مفتاح GEMINI_API_KEY غير مضبوط على الخادم',
      };
    }

    try {
      const stat = fs.statSync(input.filePath);
      const ai = this.createClient();

      // Text files: read content directly
      if (input.fileType === 'text' || input.mimeType.startsWith('text/') || input.mimeType === 'application/json') {
        const textSample = fs.readFileSync(input.filePath, 'utf8').slice(0, 18000);
        const res = await this.withRetryAndTimeout(
          () =>
            ai.models.generateContent({
              model: this.getActiveModel(),
              contents: `حلل الملف النصي التالي (${input.originalName})، صنّفه لأقرب مجلد، ولخص محتواه بالعربية:\n\n${textSample}`,
              config: {
                responseMimeType: 'application/json',
                responseSchema: GEMINI_FILE_ANALYSIS_SCHEMA,
              },
            }),
          'analyzeTextFile'
        );
        const parsed = JSON.parse((res.text || '{}').trim());
        return {
          status: 'completed',
          categoryFolder: parsed.category_folder || 'المستندات',
          summaryAr: parsed.summary_ar || '',
          transcript: '',
        };
      }

      // Multimodal files: PDF, image, audio, video (up to 15 MB inlineData limit)
      const isSupportedMultimodal =
        input.mimeType === 'application/pdf' ||
        input.mimeType.startsWith('image/') ||
        input.mimeType.startsWith('audio/') ||
        input.mimeType.startsWith('video/');

      if (!isSupportedMultimodal || stat.size > 15 * 1024 * 1024) {
        return {
          status: 'unsupported',
          categoryFolder: '',
          summaryAr: '',
          transcript: '',
          error: stat.size > 15 * 1024 * 1024 ? 'حجم الملف يتجاوز حد التحليل المباشر (15MB)' : 'نوع الملف غير مدعوم للتحليل التلقائي',
        };
      }

      const base64Data = fs.readFileSync(input.filePath).toString('base64');
      const isAudio = input.mimeType.startsWith('audio/');
      const modelToUse = isAudio ? 'gemini-3.5-transcribe' : this.getActiveModel();

      if (isAudio) {
        const transcribeRes = await this.withRetryAndTimeout(
          () =>
            ai.models.generateContent({
              model: modelToUse,
              contents: {
                parts: [
                  { inlineData: { mimeType: input.mimeType, data: base64Data } },
                  { text: 'فرّغ هذا المقطع الصوتي إلى نص دقيق باللغة التي يتحدث بها المتكلم.' },
                ],
              },
            }),
          'transcribeAudio'
        );
        const transcript = (transcribeRes.text || '').trim();
        return {
          status: transcript ? 'completed' : 'failed',
          categoryFolder: 'الصوتيات',
          summaryAr: transcript ? `تفريغ صوتي: ${transcript.slice(0, 180)}...` : '',
          transcript,
        };
      }

      const res = await this.withRetryAndTimeout(
        () =>
          ai.models.generateContent({
            model: this.getActiveModel(),
            contents: {
              parts: [
                { inlineData: { mimeType: input.mimeType, data: base64Data } },
                {
                  text: `حلل محتوى هذا الملف (${input.originalName}) بدقة. اقترح المجلد الأنسب ولخص المحتوى بالعربية في جملتين دون اختلاق معلومات غير موجودة.`,
                },
              ],
            },
            config: {
              responseMimeType: 'application/json',
              responseSchema: GEMINI_FILE_ANALYSIS_SCHEMA,
            },
          }),
        'analyzeMultimodalFile'
      );

      const parsed = JSON.parse((res.text || '{}').trim());
      return {
        status: 'completed',
        categoryFolder: parsed.category_folder || '',
        summaryAr: parsed.summary_ar || '',
        transcript: parsed.transcript_ar || '',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logSystem('error', 'gemini', `فشل تحليل الملف ${input.originalName}: ${msg}`);
      return {
        status: 'failed',
        categoryFolder: '',
        summaryAr: '',
        transcript: '',
        error: msg,
      };
    }
  }

  async healthCheck(): Promise<{ ok: boolean; model: string; configured: boolean; message: string }> {
    const model = this.getActiveModel();
    if (!this.isConfigured()) {
      return {
        ok: false,
        model,
        configured: false,
        message: 'مفتاح GEMINI_API_KEY غير مضبوط في متغيرات البيئة على الخادم',
      };
    }
    try {
      const ai = this.createClient();
      const res = await this.withRetryAndTimeout(
        () =>
          ai.models.generateContent({
            model,
            contents: 'أجب بكلمة: جاهز',
          }),
        'healthCheck'
      );
      const text = (res.text || '').trim();
      return {
        ok: Boolean(text),
        model,
        configured: true,
        message: text ? 'متصل وجاهز للعمل' : 'استجابة فارغة من Gemini',
      };
    } catch (err) {
      return {
        ok: false,
        model,
        configured: true,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

let activeProvider: AIProvider = new GeminiAIProvider();

export function getAIProvider(): AIProvider {
  return activeProvider;
}

export function setAIProvider(provider: AIProvider): void {
  activeProvider = provider;
}
