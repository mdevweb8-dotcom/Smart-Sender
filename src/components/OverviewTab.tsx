import React from 'react';
import { RefreshCw, ArrowUpLeft } from 'lucide-react';
import { formatArabicDate, formatBytes } from '../lib/api.ts';
import type { DashboardStats } from '../types.ts';

interface OverviewTabProps {
  stats: DashboardStats | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
}

const WA_STATUS_AR: Record<string, string> = {
  ready: 'متصل وجاهز',
  qr_ready: 'بانتظار مسح رمز QR',
  authenticated: 'تمت المصادقة',
  initializing: 'جاري التهيئة',
  auth_failure: 'فشل المصادقة',
  error: 'غير متصل (خطأ)',
  disconnected: 'غير متصل',
};

export const OverviewTab: React.FC<OverviewTabProps> = ({
  stats,
  loading,
  onRefresh,
  onNavigate,
}) => {
  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <p className="text-sm text-slate-600 mb-4">تعذر تحميل بيانات لوحة التحكم.</p>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 cursor-pointer"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const pendingTasks = stats.tasks.Pending || 0;
  const completedTasks = stats.tasks.Completed || 0;
  const failedTasks = stats.tasks.Failed || 0;
  const waReady = stats.whatsapp.status === 'ready';
  const waDotColor = waReady
    ? 'bg-emerald-500'
    : stats.whatsapp.status === 'qr_ready' ||
        stats.whatsapp.status === 'initializing' ||
        stats.whatsapp.status === 'authenticated'
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">نظرة عامة على النظام</h2>
          <p className="text-sm text-slate-500 mt-1">
            حالة الجهاز المرتبط والجدولة والملفات المباشرة من قاعدة البيانات
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>تحديث البيانات</span>
        </button>
      </div>

      {/* Primary KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">حالة الجهاز المرتبط (واتساب)</div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${waDotColor}`} aria-hidden="true" />
            <span className="text-lg font-bold text-slate-900">
              {WA_STATUS_AR[stats.whatsapp.status] || stats.whatsapp.status}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums" dir="ltr">
            {stats.whatsapp.linkedBotPhone || stats.whatsapp.connectedPhone || 'غير مقترن'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">إجمالي الملفات المحفوظة</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {stats.files.total_files}
          </div>
          <div className="mt-2 text-xs text-slate-500 tabular-nums">
            الحجم الكلي: {formatBytes(stats.files.total_bytes)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">المهام القادمة والمكتملة</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {pendingTasks} <span className="text-sm font-normal text-slate-400">/ {completedTasks} مكتملة</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 tabular-nums">
            فاشلة: <span className={failedTasks > 0 ? 'text-red-600 font-semibold' : ''}>{failedTasks}</span> · المجموعات: {stats.groupsCount}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">محرك الذكاء الاصطناعي والجدولة</div>
          <div className="mt-2 text-lg font-bold text-slate-900">
            {stats.gemini.configured ? 'الذكاء الاصطناعي جاهز' : 'الوضع القواعدي المحلي'}
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono">
            {stats.gemini.model} · الجدولة {stats.schedulerRunning ? 'نشطة' : 'متوقفة'}
          </div>
        </div>
      </div>

      {/* Two-column operational lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-900">آخر الملفات المستلمة</h3>
            <button
              onClick={() => onNavigate('files')}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>عرض الكل</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-100 mt-2 flex-1">
            {stats.recentFiles.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                لم يتم استلام أي ملفات بعد. ارفع ملفاً من قسم الملفات أو أرسله عبر واتساب.
              </div>
            ) : (
              stats.recentFiles.map((f) => (
                <div key={f.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{f.original_name}</div>
                    <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                      {f.folder_name || 'غير مصنف'} · {f.file_type} · {formatBytes(f.size_bytes)}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                    {formatArabicDate(f.received_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-900">آخر عمليات الإرسال والرسائل</h3>
            <button
              onClick={() => onNavigate('logs')}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>السجل الكامل</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-100 mt-2 flex-1">
            {stats.recentMessages.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                لا توجد عمليات إرسال أو استقبال مسجلة حتى الآن.
              </div>
            ) : (
              stats.recentMessages.map((m) => (
                <div key={m.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {m.direction === 'outbound'
                        ? `إلى: ${m.nickname || m.recipient_label || m.phone || m.recipient_id}`
                        : `من: ${m.nickname ? `${m.nickname} (${m.phone || m.sender_phone})` : m.phone || m.sender_phone}`}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {m.message_text || m.content_preview || m.file_name || 'رسالة'}
                    </div>
                  </div>
                  <div className="text-xs font-medium whitespace-nowrap shrink-0 tabular-nums">
                    <span className={m.status === 'failed' || m.status === 'rejected' ? 'text-red-600' : 'text-emerald-700'}>
                      {m.status === 'sent' ? 'تم الإرسال' : m.status === 'failed' ? 'فشل' : m.status === 'rejected' ? 'مرفوض' : 'مستلم'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
