import cors from 'cors';
import express from 'express';
import { config } from './config/env.ts';
import { logSystem } from './database/repositories/logsRepo.ts';
import { createApiRouter } from './dashboard/routes/api.ts';

export function createExpressApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin/non-browser calls (e.g. curl, healthcheck) and Capacitor APK origins
        if (!origin) {
          callback(null, true);
          return;
        }
        if (
          origin.startsWith('capacitor://') ||
          origin.startsWith('http://localhost') ||
          origin.startsWith('https://localhost') ||
          config.allowedOrigins.includes(origin) ||
          config.allowedOrigins.includes('*')
        ) {
          callback(null, true);
          return;
        }
        callback(null, true); // Allow hosted preview / VPS IP origins when authenticated via Bearer JWT
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  app.use('/api', createApiRouter());

  // Global API error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logSystem('error', 'system', `خطأ خادم غير متوقع: ${err.message}`);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
  });

  return app;
}
