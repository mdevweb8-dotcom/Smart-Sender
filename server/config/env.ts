import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

export type WhatsAppMode = 'whatsapp-web' | 'mock';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  appUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiTimeoutMs: number;
  whatsappBotPhone: string;
  whatsappAutoConnect: boolean;
  whatsappSessionPath: string;
  puppeteerExecutablePath: string;
  ownerPhone: string;
  ownerName: string;
  timezone: string;
  schedulerPollMs: number;
  databasePath: string;
  storagePath: string;
  backupPath: string;
  logPath: string;
  maxFileSizeMb: number;
  jwtSecret: string;
  dashboardAdminUser: string;
  dashboardAdminPass: string;
  allowedOrigins: string[];
}

export function normalizePhoneDigits(raw: string): string {
  const stripped = String(raw || '')
    .replace(/@c\.us$/i, '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@lid$/i, '')
    .replace(/[\s\-()]/g, '')
    .trim();
  if (!stripped) return '';
  let digits = stripped.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  return digits;
}

export function normalizePhoneE164(raw: string): string {
  const digits = normalizePhoneDigits(raw);
  return digits ? `+${digits}` : '';
}

export function loadConfig(): AppConfig {
  const rootDir = process.cwd();
  const resolveDir = (envVal: string | undefined, fallbackRel: string) =>
    path.resolve(rootDir, envVal && envVal.trim() ? envVal.trim() : fallbackRel);

  const rawOrigins = (
    process.env.ALLOWED_ORIGINS ||
    'http://localhost:3000,http://localhost:5173,capacitor://localhost,http://localhost,https://localhost'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (process.env.APP_URL) {
    rawOrigins.push(process.env.APP_URL.trim());
  }

  return {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
    geminiModel: (process.env.GEMINI_MODEL || 'gemini-4-hydrogen').trim(),
    geminiTimeoutMs: Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS || 25000)),
    whatsappBotPhone: normalizePhoneDigits(process.env.WHATSAPP_BOT_PHONE || ''),
    whatsappAutoConnect: process.env.WHATSAPP_AUTO_CONNECT !== 'false',
    whatsappSessionPath: resolveDir(process.env.WHATSAPP_SESSION_PATH, './data/wwebjs_auth'),
    puppeteerExecutablePath: (process.env.PUPPETEER_EXECUTABLE_PATH || '').trim(),
    ownerPhone: normalizePhoneE164(process.env.OWNER_PHONE || '+249900000000'),
    ownerName: (process.env.OWNER_NAME || 'Mohammed Asim').trim(),
    timezone: (process.env.TIMEZONE || 'Africa/Khartoum').trim(),
    schedulerPollMs: Math.max(3000, Number(process.env.SCHEDULER_POLL_MS || 15000)),
    databasePath: resolveDir(process.env.DATABASE_PATH, './data/smart-sender.sqlite'),
    storagePath: resolveDir(process.env.STORAGE_PATH, './data/storage'),
    backupPath: resolveDir(process.env.BACKUP_PATH, './data/backups'),
    logPath: resolveDir(process.env.LOG_PATH, './data/logs'),
    maxFileSizeMb: Math.max(1, Number(process.env.MAX_FILE_SIZE_MB || 25)),
    jwtSecret:
      (process.env.JWT_SECRET && process.env.JWT_SECRET !== 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET_KEY'
        ? process.env.JWT_SECRET
        : 'smart-sender-dev-secret-change-in-production-' + (process.env.OWNER_PHONE || 'default')),
    dashboardAdminUser: (process.env.DASHBOARD_ADMIN_USER || 'admin').trim(),
    dashboardAdminPass: process.env.DASHBOARD_ADMIN_PASS || 'SmartSender@2026',
    allowedOrigins: Array.from(new Set(rawOrigins)),
  };
}

export const config = loadConfig();

export function ensureRuntimeDirectories(cfg: AppConfig = config): void {
  const dirs = [
    path.dirname(cfg.databasePath),
    cfg.storagePath,
    cfg.backupPath,
    cfg.logPath,
    cfg.whatsappSessionPath,
  ];
  for (const dir of dirs) {
    if (dir && dir !== '.' && !dir.startsWith(':memory:')) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
