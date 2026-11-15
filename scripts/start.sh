#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "ملف .env غير موجود. انسخ .env.example إلى .env وأضف GEMINI_API_KEY و OWNER_PHONE أولاً."
  exit 1
fi

mkdir -p data/storage data/wwebjs_auth data/backups data/logs
docker compose up -d --build
echo "تم تشغيل Smart-Sender بنجاح. تحقق من السجلات عبر: docker compose logs -f"
