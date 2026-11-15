# Smart-Sender — بوت واتساب الذكي + لوحة التحكم وتطبيق Android

**المؤلف:** Mohammed Asim  

**Smart-Sender** هو مساعد شخصي ذكي يعمل عبر WhatsApp باللغة العربية الطبيعية، ويعتمد على **Gemini API** لفهم الأوامر والملفات، و**SQLite** للتخزين الدائم، ومحرك جدولة موثوق بتوقيت **Africa/Khartoum**، مع لوحة تحكم ويب احترافية وتطبيق Android منفصل (**Smart-Sender Dashboard**).

---

## البنية المعمارية للمشروع

```text
Smart-Sender/
├── server.ts                  # نقطة تشغيل الخادم (Express + Vite/Static + Scheduler + WhatsApp)
├── server/
│   ├── ai/                    # طبقة Gemini API المستقلة + المخططات JSON + ذاكرة المحادثة
│   ├── auth/                  # التحقق من أرقام واتساب (RBAC) + مصادقة JWT للوحة والتحكم
│   ├── config/                # قراءة متغيرات البيئة وتطبيع الأرقام الدولية
│   ├── database/              # اتصال SQLite (node:sqlite) + الترحيلات (Migrations) + Repositories
│   ├── dashboard/routes/      # واجهات REST API (/api/*) المشتركة للويب وتطبيق APK
│   ├── files/                 # تخزين الملفات الآمن + التصنيف + البحث ومنع Path Traversal
│   ├── scheduler/             # محرك الجدولة الدائم + استعادة المهام بعد إعادة التشغيل
│   ├── services/              # النسخ الاحتياطي والاستعادة لقاعدة البيانات
│   ├── whatsapp/              # طبقة الاتصال (whatsapp-web.js + LocalAuth + Mock للتجارب)
│   └── tests/                 # اختبارات الوحدات والتكامل (tsx --test)
├── src/                       # واجهة لوحة التحكم ويب العربية (React + TypeScript + Tailwind CSS)
├── dashboard-app/             # تطبيق Android APK منفصل (React + Vite + Capacitor)
├── .github/workflows/         # بناء APK تلقائياً عبر GitHub Actions
├── Dockerfile & docker-compose.yml
└── scripts/                   # سكربتات التشغيل والإيقاف والفحص
```

---

## متطلبات التشغيل على السيرفر (Linux + Docker)

1. خادم Linux (Ubuntu/Debian) مع **Docker** و **Docker Compose**.
2. مفتاح **Gemini API** صالح يُضاف على الخادم فقط داخل `.env`.
3. رقم واتساب مخصص للبوت بصيغة دولية (مثال: `+249912345678`).

---

## دليل النشر خطوة بخطوة

### 1. تجهيز ملف البيئة
انسخ `.env.example` إلى `.env` وعدّل القيم:
```bash
cp .env.example .env
```
املأ القيم الأساسية:
- `GEMINI_API_KEY`: مفتاح Gemini API (يبقى على الخادم فقط ولا يُكشف للمتصفح أو APK).
- `OWNER_PHONE`: رقمك الدولي بصيغة `+249XXXXXXXXX`.
- `JWT_SECRET`: سلسلة عشوائية طويلة لحماية جلسات لوحة التحكم وAPK.
- `DASHBOARD_ADMIN_USER` و `DASHBOARD_ADMIN_PASS`: بيانات دخول لوحة التحكم.
- `WHATSAPP_MODE=whatsapp-web` و `WHATSAPP_AUTO_CONNECT=true`.

### 2. التشغيل عبر Docker (مع حفظ دائم للبيانات والجلسة)
```bash
chmod +x scripts/*.sh
./scripts/start.sh
```
يتم حفظ قاعدة البيانات والملفات المستلمة والنسخ الاحتياطية ومجلد جلسة واتساب (`LocalAuth`) داخل Volume دائم (`smart_sender_data`) بحيث لا تضيع عند إيقاف الحاوية أو تحديثها.

### 3. التشغيل المباشر عبر Node.js 22 (للتطوير أو السيرفر بدون Docker)
```bash
npm install --legacy-peer-deps
npm run build
npm start
```

### 4. فتح لوحة التحكم وربط واتساب عبر QR
1. افتح المتصفح على: `http://YOUR_SERVER_IP:3000`
2. سجّل الدخول باسم المستخدم وكلمة المرور المضبوطة في `.env`.
3. انتقل إلى **اتصال واتساب** واضغط **بدء الاتصال**.
4. امسح رمز **QR** من تطبيق واتساب (`الأجهزة المرتبطة > ربط جهاز`).
5. ستُحفظ الجلسة في مجلد `LocalAuth` ولن يُطلب مسح الرمز عند إعادة التشغيل.

### 5. فحص Gemini والنسخ الاحتياطي
- من تبويب **Gemini والمحاكي** اضغط **فحص اتصال Gemini** للتأكد من استجابة الخادم.
- من تبويب **الإعدادات والنسخ** يمكنك إنشاء نسخة احتياطية فورية لقاعدة بيانات SQLite أو استعادتها بأمان.

---

## تنبيه مهم حول WhatsApp Web (غير الرسمي)
يستخدم البوت مكتبة `whatsapp-web.js` مع Puppeteer، وهي وسيلة غير رسمية من Meta وقد تتعرض للتقييد أو الحظر عند إرسال رسائل جماعية مزعجة أو عند تغيّر واجهة واتساب ويب.
تم عزل الاتصال داخل الواجهة البرمجية `WhatsAppTransport` في `server/whatsapp/provider.ts` لتسهيل استبداله مستقبلاً بواجهة **WhatsApp Business Platform API** الرسمية دون تعديل منطق الذكاء الاصطناعي أو الجدولة.

---

## تطبيق لوحة التحكم Android (APK)
المجلد `dashboard-app/` يحتوي على تطبيق Android منفصل يتصل بالسيرفر عبر REST API وJWT فقط، ولا يحتوي على أي كود للبوت أو أسرار:
- المعرف: `com.smartsender.dashboard.app`
- يُبنى تلقائياً عبر GitHub Actions (`.github/workflows/build-apk.yml`) ويُرفع باسم **Smart-Sender-Dashboard-APK**.
- عند فتح التطبيق، أدخل رابط السيرفر (`http://YOUR_SERVER_IP:3000`) واضغط **اختبار الاتصال** ثم سجّل الدخول.

---

## الاختبارات
```bash
npm test
```
تغطي الاختبارات: قاعدة البيانات والترحيلات، الصلاحيات (RBAC)، تخزين الملفات ومنع Path Traversal، تحليل الأوامر العربية، محرك الجدولة واستعادة المهام بعد إعادة التشغيل، ومحاكي واتساب، وواجهات API والمصادقة.
