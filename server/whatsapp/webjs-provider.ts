import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
import type { Client as WWebClient, Message as WWebMessage } from 'whatsapp-web.js';
import { config, normalizePhoneDigits, normalizePhoneE164 } from '../config/env.ts';
import { logSystem } from '../database/repositories/logsRepo.ts';
import { getSetting, getSettingBoolean, getSettingNumber, setSetting } from '../database/repositories/settingsRepo.ts';
import type {
  IncomingMessageListener,
  IncomingWhatsAppMessage,
  RemoteGroupInfo,
  SendMessageResult,
  TransportStateSnapshot,
  WhatsAppConnectionStatus,
  WhatsAppTransport,
} from './provider.ts';

const { Client, LocalAuth, MessageMedia } = pkg;

function formatWhatsAppChatId(target: string): string {
  const clean = target.trim();
  if (clean.includes('@g.us') || clean.includes('@c.us') || clean.includes('@s.whatsapp.net')) {
    return clean;
  }
  const digits = normalizePhoneDigits(clean);
  return `${digits}@c.us`;
}

export class WebJSProvider implements WhatsAppTransport {
  readonly providerName = 'whatsapp-web' as const;
  private client: WWebClient | null = null;
  private status: WhatsAppConnectionStatus = 'disconnected';
  private qrCodeDataUrl: string | null = null;
  private connectedPhone: string | null = null;
  private connectedName: string | null = null;
  private lastError: string | null = null;
  private lastConnectedAt: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manualStop = false;
  private listeners: IncomingMessageListener[] = [];

  private resolveConfiguredBotPhone(): string {
    if (this.connectedPhone) {
      return normalizePhoneDigits(this.connectedPhone);
    }
    const stored = normalizePhoneDigits(getSetting('whatsapp_bot_phone', ''));
    if (stored) return stored;
    return config.whatsappBotPhone;
  }

  getState(): TransportStateSnapshot {
    const linkedBotPhone = this.resolveConfiguredBotPhone();
    return {
      provider: 'whatsapp-web',
      isOfficialApi: false,
      status: this.status,
      qrCodeDataUrl: this.qrCodeDataUrl,
      connectedPhone: this.connectedPhone,
      linkedBotPhone,
      connectedName: this.connectedName,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt: this.lastConnectedAt,
      notice: linkedBotPhone
        ? `البوت يعمل عبر رقم الجهاز المرتبط: ${linkedBotPhone} - اطلب من المصرح لهم حفظ هذا الرقم وإرسال رسالة له`
        : 'اربط رقم الواتساب الخاص بالبوت عبر مسح رمز QR من تطبيق واتساب > الأجهزة المرتبطة.',
    };
  }

  onMessage(listener: IncomingMessageListener): void {
    this.listeners.push(listener);
  }

  private getSessionPath(): string {
    const configured = getSetting('whatsapp_session_path', config.whatsappSessionPath);
    const resolved = path.resolve(configured || config.whatsappSessionPath);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  async start(): Promise<void> {
    if (
      this.client &&
      (this.status === 'initializing' ||
        this.status === 'ready' ||
        this.status === 'qr_ready' ||
        this.status === 'authenticated')
    ) {
      return;
    }

    this.manualStop = false;
    this.status = 'initializing';
    this.lastError = null;
    this.qrCodeDataUrl = null;

    const sessionPath = this.getSessionPath();
    logSystem('info', 'whatsapp', 'بدء تهيئة الجهاز المرتبط (WhatsApp Web + LocalAuth)', { sessionPath });

    const puppeteerConfig: Record<string, unknown> = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
      ],
    };

    if (config.puppeteerExecutablePath && fs.existsSync(config.puppeteerExecutablePath)) {
      puppeteerConfig.executablePath = config.puppeteerExecutablePath;
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'smart-sender-linked-device',
        dataPath: sessionPath,
      }),
      puppeteer: puppeteerConfig,
    });

    client.on('qr', async (qr: string) => {
      this.status = 'qr_ready';
      this.lastError = null;
      try {
        qrcodeTerminal.generate(qr, { small: true });
        this.qrCodeDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
        logSystem('info', 'whatsapp', 'تم توليد رمز QR لربط الجهاز — بانتظار المسح من تطبيق واتساب');
      } catch (err) {
        logSystem('error', 'whatsapp', 'تعذر توليد صورة رمز QR', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    client.on('authenticated', () => {
      this.status = 'authenticated';
      this.qrCodeDataUrl = null;
      this.lastError = null;
      logSystem('info', 'whatsapp', 'تمت مصادقة الجهاز المرتبط وحفظ الجلسة محلياً (LocalAuth)');
    });

    client.on('auth_failure', (msg: string) => {
      this.status = 'auth_failure';
      this.lastError = `فشل المصادقة: ${msg}.`;
      logSystem('error', 'whatsapp', this.lastError);
    });

    client.on('ready', () => {
      this.status = 'ready';
      this.qrCodeDataUrl = null;
      this.lastError = null;
      this.reconnectAttempts = 0;
      this.lastConnectedAt = new Date().toISOString();

      const info = client.info;
      const detectedDigits = info?.wid?.user ? normalizePhoneDigits(info.wid.user) : config.whatsappBotPhone;
      this.connectedPhone = detectedDigits ? `+${detectedDigits}` : null;
      this.connectedName = info?.pushname || 'Smart-Sender Linked Device';

      if (detectedDigits) {
        try {
          setSetting('whatsapp_bot_phone', detectedDigits);
        } catch {
          // Ignore if DB closed
        }
      }

      logSystem(
        'info',
        'whatsapp',
        `الجهاز المرتبط جاهز ومتصل برقم: ${detectedDigits || 'غير معروف'}`
      );
    });

    client.on('disconnected', (reason: string) => {
      this.status = 'disconnected';
      this.connectedPhone = null;
      this.qrCodeDataUrl = null;
      this.lastError = `انقطع اتصال الجهاز المرتبط: ${reason}`;
      logSystem('warn', 'whatsapp', this.lastError);

      if (!this.manualStop) {
        this.scheduleSafeReconnect();
      }
    });

    client.on('message', async (rawMsg: WWebMessage) => {
      try {
        if (rawMsg.fromMe || rawMsg.isStatus) return;

        const chat = await rawMsg.getChat();
        const isGroup = Boolean(chat.isGroup);
        // Never reply to or process group chats when operating in single linked-device 1:1 mode
        if (isGroup) {
          return;
        }

        const contact = await rawMsg.getContact();
        const senderRaw = rawMsg.from;
        const senderPhoneE164 = normalizePhoneE164(contact.number || senderRaw);

        const wrapped: IncomingWhatsAppMessage = {
          messageId: rawMsg.id?._serialized || '',
          fromRaw: rawMsg.from,
          senderPhoneE164,
          senderDisplayName: contact.pushname || contact.name || senderPhoneE164,
          isGroup: false,
          body: rawMsg.body || '',
          hasMedia: Boolean(rawMsg.hasMedia),
          downloadMedia: async () => {
            if (!rawMsg.hasMedia) return null;
            const media = await rawMsg.downloadMedia();
            if (!media || !media.data) return null;
            const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
            return {
              buffer: Buffer.from(media.data, 'base64'),
              filename: media.filename || `whatsapp-${Date.now()}.${ext}`,
              mimeType: media.mimetype,
            };
          },
        };

        for (const listener of this.listeners) {
          await listener(wrapped);
        }
      } catch (err) {
        logSystem('error', 'whatsapp', 'خطأ أثناء معالجة رسالة واتساب واردة', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this.client = client;

    try {
      await client.initialize();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      this.lastError = `تعذر تشغيل Chromium/WhatsApp Web: ${msg}`;
      this.client = null;
      logSystem('error', 'whatsapp', this.lastError);
    }
  }

  private scheduleSafeReconnect(): void {
    const enabled = getSettingBoolean('whatsapp_reconnect_enabled', true);
    const maxRetries = getSettingNumber('whatsapp_reconnect_max_retries', 10);
    if (!enabled || this.reconnectAttempts >= maxRetries) {
      logSystem('warn', 'whatsapp', 'تم إيقاف محاولات إعادة الاتصال التلقائي بعد بلوغ الحد الأقصى');
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts += 1;
    const delayMs = Math.min(60_000, 3000 * Math.pow(1.5, this.reconnectAttempts - 1));
    logSystem(
      'info',
      'whatsapp',
      `جدولة إعادة الربط التلقائي خلال ${Math.round(delayMs / 1000)} ثانية (محاولة ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(async () => {
      await this.reconnect();
    }, delayMs);
  }

  async stop(): Promise<void> {
    this.manualStop = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // ignore destroy error
      }
      this.client = null;
    }
    this.status = 'disconnected';
    this.connectedPhone = null;
    this.qrCodeDataUrl = null;
    logSystem('info', 'whatsapp', 'تم فصل اتصال الجهاز المرتبط بأمان دون مسح الجلسة');
  }

  async reconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.qrCodeDataUrl = null;
    await this.start();
  }

  async sendText(toChatId: string, text: string): Promise<SendMessageResult> {
    if (!this.client || this.status !== 'ready') {
      return { ok: false, error: 'الجهاز المرتبط غير متصل حالياً' };
    }
    try {
      const chatId = formatWhatsAppChatId(toChatId);
      const sent = await this.client.sendMessage(chatId, text);
      return { ok: true, messageId: sent.id?._serialized || '' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendFile(toChatId: string, filePath: string, caption?: string, filename?: string): Promise<SendMessageResult> {
    if (!this.client || this.status !== 'ready') {
      return { ok: false, error: 'الجهاز المرتبط غير متصل حالياً' };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'الملف غير موجود على القرص' };
    }
    try {
      const chatId = formatWhatsAppChatId(toChatId);
      const media = MessageMedia.fromFilePath(filePath);
      if (filename) media.filename = filename;
      const sent = await this.client.sendMessage(chatId, media, { caption: caption || undefined });
      return { ok: true, messageId: sent.id?._serialized || '' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async fetchGroups(): Promise<RemoteGroupInfo[]> {
    if (!this.client || this.status !== 'ready') {
      return [];
    }
    const chats = await this.client.getChats();
    const groups = chats.filter((c) => c.isGroup);
    const result: RemoteGroupInfo[] = [];

    for (const grp of groups) {
      const gAny = grp as unknown as {
        id: { _serialized: string };
        name: string;
        description?: string;
        participants?: Array<{ id: { user: string }; isAdmin?: boolean }>;
      };
      const members = (gAny.participants || []).map((p) => ({
        id: `+${p.id.user}`,
        isAdmin: Boolean(p.isAdmin),
      }));
      result.push({
        waGroupId: gAny.id._serialized,
        name: gAny.name || gAny.id._serialized,
        description: gAny.description || '',
        memberCount: members.length,
        members,
      });
    }
    return result;
  }
}
