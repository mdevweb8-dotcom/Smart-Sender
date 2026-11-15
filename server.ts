import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createExpressApp } from './server/app.ts';
import { config, ensureRuntimeDirectories } from './server/config/env.ts';
import { closeDatabase, openDatabase } from './server/database/connection.ts';
import { runMigrations } from './server/database/migrations/runner.ts';
import { logSystem } from './server/database/repositories/logsRepo.ts';
import { scheduler } from './server/scheduler/scheduler.ts';
import { getWhatsAppManager } from './server/whatsapp/manager.ts';

async function bootstrap() {
  ensureRuntimeDirectories(config);
  openDatabase(config.databasePath);
  runMigrations();

  const waManager = getWhatsAppManager();
  scheduler.start();

  if (config.whatsappAutoConnect) {
    // Non-blocking startup so HTTP dashboard remains responsive and generates QR immediately
    void waManager.connect();
  }

  const app = createExpressApp();

  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    logSystem('info', 'system', `خادم Smart-Sender يعمل على المنفذ ${config.port} (${config.nodeEnv})`);
    console.log(`Smart-Sender server listening on http://0.0.0.0:${config.port}`);
  });

  const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down Smart-Sender gracefully...`);
    scheduler.stop();
    await waManager.disconnect();
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Failed to start Smart-Sender server:', err);
  process.exit(1);
});
