import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createExpressApp } from '../app.ts';
import { closeDatabase, openDatabase } from '../database/connection.ts';
import { runMigrations } from '../database/migrations/runner.ts';
import { setSetting } from '../database/repositories/settingsRepo.ts';
import { deterministicArabicFallback } from '../ai/command-parser.ts';
import { ParsedCommandSchema } from '../ai/schemas.ts';
import { getAIProvider } from '../ai/gemini.ts';
import { getWhatsAppManager } from '../whatsapp/manager.ts';
import { LinkedDeviceTestStub } from './test-transport.ts';

describe('AI Schemas & Express Dashboard/APK REST API', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  let linkedStub: LinkedDeviceTestStub;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-api-test-'));
    openDatabase(path.join(tmpDir, 'test.sqlite'));
    runMigrations();
    setSetting('storage_path', path.join(tmpDir, 'storage'));
    setSetting('whatsapp_bot_phone', '249900000001');

    linkedStub = new LinkedDeviceTestStub('249900000001');
    await linkedStub.start();
    getWhatsAppManager().setTransportForTesting(linkedStub);

    const app = createExpressApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await linkedStub.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validates structured command JSON schemas and Arabic deterministic rules', () => {
    const valid = ParsedCommandSchema.safeParse({
      intent: 'schedule_file',
      file_query: 'latest',
      destination: 'مجموعة الدراسة',
      schedule: { type: 'weekly', day_of_week: 'sunday', time_hhmm: '20:00' },
      requires_confirmation: true,
      confidence: 0.95,
    });
    assert.equal(valid.success, true);

    const todayCmd = deterministicArabicFallback('ما الملفات التي استلمتها اليوم؟');
    assert.equal(todayCmd.intent, 'list_files');
    assert.equal(todayCmd.today_only, true);
  });

  it('enforces Linked Device authorized_users CRUD, silent unauthorized rejection, live_chat/bot_auto logs, and Owner-only phone masking', async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as {
      ok: boolean;
      app: string;
      whatsapp: { provider: string; connectedPhone: string | null };
    };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.app, 'Smart-Sender');
    assert.equal(healthJson.whatsapp.provider, 'whatsapp-web');
    // Public health masks full Linked Device phone
    assert.ok(!healthJson.whatsapp.connectedPhone?.includes('249900000001'));

    // Unauthenticated call must fail 401
    const unauthRes = await fetch(`${baseUrl}/api/files`);
    assert.equal(unauthRes.status, 401);

    // Wrong password fails 401
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
    });
    assert.equal(badLogin.status, 401);

    // Valid Owner login succeeds
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.DASHBOARD_ADMIN_USER || 'admin',
        password: process.env.DASHBOARD_ADMIN_PASS || 'SmartSender@2026',
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = (await loginRes.json()) as { token: string };
    assert.ok(loginJson.token);

    // Settings endpoint must NOT leak GEMINI_API_KEY
    const settingsRes = await fetch(`${baseUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${loginJson.token}` },
    });
    assert.equal(settingsRes.status, 200);
    const settingsText = await settingsRes.text();
    assert.equal(settingsText.includes('AIza'), false);
    assert.equal(settingsText.includes('GEMINI_API_KEY'), false);

    // Reject phone format with '+' on /api/authorized-users
    const badPhoneRes = await fetch(`${baseUrl}/api/authorized-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({ phone: '+249911223344', nickname: 'خالد', permission: 'chat' }),
    });
    assert.equal(badPhoneRes.status, 400);

    // Owner adds authorized user strictly without '+'
    const addAuthRes = await fetch(`${baseUrl}/api/authorized-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({
        phone: '249911223344',
        nickname: 'خالد عثمان',
        permission: 'chat',
      }),
    });
    assert.equal(addAuthRes.status, 201);
    const addAuthJson = (await addAuthRes.json()) as {
      user: { id: string; phone: string; nickname: string; permission: string; is_active: number };
      linkedBotPhone: string;
      instructionMessage: string;
    };
    assert.equal(addAuthJson.user.phone, '249911223344');
    assert.equal(addAuthJson.user.nickname, 'خالد عثمان');
    assert.equal(addAuthJson.user.permission, 'chat');
    assert.equal(addAuthJson.user.is_active, 1);
    assert.ok(addAuthJson.instructionMessage.includes('249900000001'));

    // Duplicate phone MUST fail with 409
    const dupRes = await fetch(`${baseUrl}/api/authorized-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({ phone: '249911223344', nickname: 'مكرر', permission: 'chat' }),
    });
    assert.equal(dupRes.status, 409);

    // Simulate incoming greeting from authorized user -> replies and logs bot_auto
    const simAuthRes = await fetch(`${baseUrl}/api/simulator/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({
        senderPhone: '249911223344',
        senderName: 'خالد',
        message: 'السلام عليكم',
      }),
    });
    assert.equal(simAuthRes.status, 200);
    const simAuthJson = (await simAuthRes.json()) as { ok: boolean; reply: string };
    assert.equal(simAuthJson.ok, true);
    assert.ok(simAuthJson.reply.includes('Smart-Sender'));

    // Simulate unauthorized caller -> empty reply & unauthorized_attempt logged
    const simUnauthRes = await fetch(`${baseUrl}/api/simulator/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({
        senderPhone: '249988776655',
        senderName: 'مجهول',
        message: 'مرحبا',
      }),
    });
    const simUnauthJson = (await simUnauthRes.json()) as { ok: boolean; reply: string };
    assert.equal(simUnauthJson.reply, '');

    // Owner sends message via /api/live-chat/send
    const liveSendRes = await fetch(`${baseUrl}/api/live-chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({
        phone: '249911223344',
        message: 'أهلاً يا خالد، تم تفعيل رقمك عبر الجهاز المرتبط.',
      }),
    });
    assert.equal(liveSendRes.status, 200);
    const liveSendJson = (await liveSendRes.json()) as {
      ok: boolean;
      contact: { unread_count: number; connection_state: string };
      messages: Array<{ interaction_type: string; message_text: string }>;
    };
    assert.equal(liveSendJson.ok, true);
    assert.equal(liveSendJson.contact.unread_count, 0);
    assert.ok(liveSendJson.messages.some((m) => m.message_text.includes('تم تفعيل رقمك') && m.interaction_type === 'live_chat'));

    // Disable authorized user -> subsequent inbound returns '' and logs unauthorized_attempt
    const disableRes = await fetch(`${baseUrl}/api/authorized-users/${addAuthJson.user.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(disableRes.status, 200);

    const disabledSimRes = await fetch(`${baseUrl}/api/simulator/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({
        senderPhone: '249911223344',
        senderName: 'خالد',
        message: 'اختبار بعد التعطيل',
      }),
    });
    const disabledSimJson = (await disabledSimRes.json()) as { reply: string };
    assert.equal(disabledSimJson.reply, '');

    // Check logs filter by bot_auto, live_chat, unauthorized_attempt
    const botAutoLogsRes = await fetch(`${baseUrl}/api/logs?interactionType=bot_auto`, {
      headers: { Authorization: `Bearer ${loginJson.token}` },
    });
    const botAutoLogsJson = (await botAutoLogsRes.json()) as { logs: Array<{ interaction_type: string }> };
    assert.ok(botAutoLogsJson.logs.length >= 2);
    assert.ok(botAutoLogsJson.logs.every((l) => l.interaction_type === 'bot_auto'));

    const unauthLogsRes = await fetch(`${baseUrl}/api/logs?interactionType=unauthorized_attempt`, {
      headers: { Authorization: `Bearer ${loginJson.token}` },
    });
    const unauthLogsJson = (await unauthLogsRes.json()) as { logs: Array<{ phone: string }> };
    assert.ok(unauthLogsJson.logs.some((l) => l.phone === '249988776655'));

    // Create a non-owner dashboard user ('viewer') and verify RBAC + phone masking
    await fetch(`${baseUrl}/api/users/dashboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({
        username: 'viewer1',
        fullName: 'Viewer Account',
        password: 'ViewerPassword@2026',
        role: 'viewer',
      }),
    });
    const viewerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'viewer1', password: 'ViewerPassword@2026' }),
    });
    const viewerJson = (await viewerLogin.json()) as { token: string };

    // Viewer MUST get 403 on /api/authorized-users and /api/live-chat/threads
    const viewerAuthUsers = await fetch(`${baseUrl}/api/authorized-users`, {
      headers: { Authorization: `Bearer ${viewerJson.token}` },
    });
    assert.equal(viewerAuthUsers.status, 403);

    const viewerLiveThreads = await fetch(`${baseUrl}/api/live-chat/threads`, {
      headers: { Authorization: `Bearer ${viewerJson.token}` },
    });
    assert.equal(viewerLiveThreads.status, 403);

    // Viewer sees masked phones in /api/logs
    const viewerLogsRes = await fetch(`${baseUrl}/api/logs`, {
      headers: { Authorization: `Bearer ${viewerJson.token}` },
    });
    const viewerLogsText = await viewerLogsRes.text();
    assert.equal(viewerLogsText.includes('249911223344'), false);
    assert.equal(viewerLogsText.includes('249988776655'), false);
  });

  it('runs live Gemini Arabic parsing when GEMINI_API_KEY is configured', async (t) => {
    const ai = getAIProvider();
    if (!ai.isConfigured()) {
      t.skip('GEMINI_API_KEY not configured in test environment');
      return;
    }
    const result = await ai.parseArabicCommand({
      userMessage: 'أرسل ملف المحاضرة لمجموعة الدراسة يوم الأحد الساعة 8 مساءً',
      timezone: 'Africa/Khartoum',
      nowLocalIso: '2026-11-13 15:00:00',
      memoryTurns: [],
      recentFiles: [{ id: 'f1', name: 'محاضرة_1.pdf', folder: 'المحاضرات', type: 'pdf', receivedAt: '2026-11-13' }],
      folders: ['المحاضرات', 'الدراسة'],
      groups: [{ id: 'g1@g.us', name: 'مجموعة الدراسة', alias: 'مجموعة الدراسة' }],
      upcomingTasks: [],
    });
    assert.equal(result.intent, 'schedule_file');
    assert.equal(result.schedule?.time_hhmm, '20:00');
  });
});
