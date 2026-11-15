import React, { useState } from 'react';
import { QrCode, RefreshCw, Power, AlertTriangle, Smartphone, ShieldAlert } from 'lucide-react';
import { apiRequest, formatArabicDate } from '../lib/api.ts';
import type { AuthUser, WhatsAppState } from '../types.ts';

interface WhatsAppTabProps {
  currentUser: AuthUser;
  state: WhatsAppState | null;
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

const STATUS_LABELS: Record<string, string> = {
  disconnected: 'غير متصل',
  initializing: 'جاري تشغيل الجلسة وتوليد رمز QR...',
  qr_ready: 'رمز QR جاهز للمسح عبر تطبيق واتساب',
  authenticated: 'تمت المصادقة — جاري تحميل المحادثات...',
  ready: 'متصل وجاهز للاستقبال والرد من الجهاز المرتبط',
  auth_failure: 'فشل المصادقة — أعد مسح رمز QR للربط',
  error: 'غير متصل — تعذر الاتصال، أعد توليد رمز QR',
};

export const WhatsAppTab: React.FC<WhatsAppTabProps> = ({ currentUser, state, onRefresh, onNotify }) => {
  const [busy, setBusy] = useState(false);
  const isOwner = currentUser.role === 'owner';

  const runAction = async (endpoint: string, successMsg?: string) => {
    setBusy(true);
    try {
      await apiRequest(endpoint, { method: 'POST' });
      if (successMsg) onNotify(successMsg);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء', true);
    } finally {
      setBusy(false);
    }
  };

  const isReady = state?.status === 'ready';
  const isConnecting =
    state?.status === 'initializing' || state?.status === 'qr_ready' || state?.status === 'authenticated';
  const dotClass = isReady ? 'bg-emerald-500' : isConnecting ? 'bg-amber-500' : 'bg-red-500';
  const linkedPhone = state?.linkedBotPhone || state?.connectedPhone || 'غير محدد بعد';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">ربط جهاز واتساب (Linked Device QR)</h2>
          <p className="text-sm text-slate-500 mt-1">
            يعمل البوت كجهاز مرتبط حقيقي برقم واحد عبر <span className="font-mono">whatsapp-web.js</span> دون أي رقم وهمي أو Cloud API
          </p>
        </div>

        {isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={busy}
              onClick={() => runAction('/api/whatsapp/connect', 'جاري تشغيل الجلسة وتجهيز رمز QR...')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              بدء الاتصال / عرض QR
            </button>
            <button
              disabled={busy}
              onClick={() => runAction('/api/whatsapp/reconnect', 'جاري إعادة توليد رمز QR...')}
              className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>إعادة الاتصال / QR جديد</span>
            </button>
            <button
              disabled={busy}
              onClick={() => runAction('/api/whatsapp/disconnect', 'تم فصل الجهاز المرتبط بأمان')}
              className="px-4 py-2 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-700 text-slate-700 text-sm font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Power className="w-4 h-4" />
              <span>فصل الاتصال</span>
            </button>
          </div>
        )}
      </div>

      {/* Linked Device Number Banner */}
      <div
        className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
          isReady ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-white border-slate-200 text-slate-800'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full shrink-0 ${dotClass}`} />
          <Smartphone className="w-5 h-5 shrink-0 text-emerald-700" />
          <div className="text-sm font-semibold">
            البوت يعمل عبر رقم الجهاز المرتبط:{' '}
            <span className="font-mono font-bold mx-1" dir="ltr">
              {linkedPhone}
            </span>{' '}
            — اطلب من المصرح لهم حفظ هذا الرقم وإرسال رسالة له
          </div>
        </div>
        <span className={`text-xs font-bold ${isReady ? 'text-emerald-700' : 'text-red-600'}`}>
          {isReady ? 'متصل' : isConnecting ? 'جاري الربط...' : 'غير متصل'}
        </span>
      </div>

      {!isOwner && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 text-sm text-amber-900">
          <ShieldAlert className="w-5 h-5 shrink-0 text-amber-700" />
          <span>إدارة ربط وفصل الجهاز المرتبط ومشاهدة الرقم الكامل متاحة لمالك النظام (Owner) فقط.</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Connection Details */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900">حالة الجهاز المرتبط</h3>

          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">الحالة الحالية</dt>
              <dd className="font-semibold text-slate-900 flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />
                <span>{state ? STATUS_LABELS[state.status] || state.status : 'غير متصل'}</span>
              </dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">رقم الجهاز المرتبط</dt>
              <dd className="font-mono tabular-nums text-slate-900 font-semibold" dir="ltr">
                {linkedPhone}
              </dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">الاسم الظاهر في واتساب</dt>
              <dd className="text-slate-900">{state?.connectedName || '—'}</dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">محاولات إعادة الاتصال</dt>
              <dd className="font-mono tabular-nums text-slate-900">{state?.reconnectAttempts ?? 0}</dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">آخر اتصال ناجح</dt>
              <dd className="tabular-nums text-slate-700">{formatArabicDate(state?.lastConnectedAt)}</dd>
            </div>
          </dl>

          {state?.lastError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{state.lastError}</span>
            </div>
          )}

          {isReady && (
            <button
              disabled={busy}
              onClick={() => runAction('/api/whatsapp/sync-groups', 'تمت مزامنة المجموعات بنجاح')}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              مزامنة المجموعات الآن
            </button>
          )}
        </div>

        {/* QR Code Area */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[320px]">
          {state?.qrCodeDataUrl ? (
            <>
              <img
                src={state.qrCodeDataUrl}
                alt="رمز QR لربط الجهاز"
                className="w-60 h-60 border border-slate-200 rounded-xl p-2 bg-white"
              />
              <p className="text-sm font-semibold text-slate-900 mt-4">
                افتح واتساب على هاتفك &gt; الأجهزة المرتبطة &gt; ربط جهاز وامسح الرمز
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                بعد المسح تُحفظ الجلسة محلياً عبر LocalAuth، وسيتبادل البوت الرسائل مع الأرقام المصرح لها من نفس هذا الرقم.
              </p>
            </>
          ) : isReady ? (
            <div className="space-y-3">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <QrCode className="w-7 h-7" />
              </div>
              <div className="text-base font-bold text-slate-900">الجهاز المرتبط نشط ومتصل</div>
              <p className="text-xs text-slate-500 max-w-xs">
                رقم الجهاز المرتبط (<span className="font-mono" dir="ltr">{linkedPhone}</span>) يستقبل ويرد على الأرقام المصرح لها فقط.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-14 h-14 mx-auto rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                <QrCode className="w-7 h-7" />
              </div>
              <div className="text-sm font-bold text-slate-900">الجهاز غير متصل حالياً</div>
              <p className="text-xs text-slate-500 max-w-xs">
                {isConnecting
                  ? 'جاري تجهيز المتصفح وتوليد رمز QR، يرجى الانتظار بضع ثوانٍ...'
                  : 'انقطع الاتصال أو لم يتم ربط الجهاز بعد. اضغط لإعادة توليد رمز QR جديد.'}
              </p>
              {isOwner && !isConnecting && (
                <button
                  disabled={busy}
                  onClick={() => runAction('/api/whatsapp/reconnect', 'جاري توليد رمز QR جديد...')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  توليد رمز QR الآن
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
