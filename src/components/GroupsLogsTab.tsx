import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Plus } from 'lucide-react';
import { apiRequest, formatArabicDate } from '../lib/api.ts';
import type { GroupItem, MessageLogItem, SystemLogItem } from '../types.ts';

interface GroupsLogsTabProps {
  mode: 'groups' | 'logs' | 'errors';
  onNotify: (msg: string, isError?: boolean) => void;
}

export const GroupsLogsTab: React.FC<GroupsLogsTabProps> = ({ mode, onNotify }) => {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [msgLogs, setMsgLogs] = useState<MessageLogItem[]>([]);
  const [sysLogs, setSysLogs] = useState<SystemLogItem[]>([]);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [interactionFilter, setInteractionFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  // Group manual add / alias edit
  const [aliasEdits, setAliasEdits] = useState<Record<string, string>>({});
  const [newGroupId, setNewGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupAlias, setNewGroupAlias] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'groups') {
        const res = await apiRequest<{ groups: GroupItem[] }>(
          `/api/groups?search=${encodeURIComponent(search.trim())}`
        );
        setGroups(res.groups);
      } else if (mode === 'logs') {
        const qs =
          interactionFilter !== 'all' ? `&interactionType=${encodeURIComponent(interactionFilter)}` : '';
        const res = await apiRequest<{ logs: MessageLogItem[] }>(`/api/logs?limit=150${qs}`);
        setMsgLogs(res.logs);
      } else {
        const qs = levelFilter !== 'all' ? `&level=${encodeURIComponent(levelFilter)}` : '';
        const res = await apiRequest<{ logs: SystemLogItem[] }>(`/api/logs/system?limit=150${qs}`);
        setSysLogs(res.logs);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل البيانات', true);
    } finally {
      setLoading(false);
    }
  }, [mode, search, levelFilter, interactionFilter, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSaveAlias = async (group: GroupItem) => {
    const alias = aliasEdits[group.id] ?? group.alias;
    try {
      await apiRequest(`/api/groups/${group.id}`, {
        method: 'PUT',
        body: JSON.stringify({ alias }),
      });
      onNotify(`تم حفظ الاسم المستعار للمجموعة "${group.name}"`);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر الحفظ', true);
    }
  };

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          waGroupId: newGroupId.trim(),
          name: newGroupName.trim(),
          alias: newGroupAlias.trim(),
        }),
      });
      setNewGroupId('');
      setNewGroupName('');
      setNewGroupAlias('');
      onNotify('تمت إضافة المجموعة بنجاح');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر إضافة المجموعة', true);
    }
  };

  if (mode === 'groups') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">المجموعات والأسماء المستعارة</h2>
            <p className="text-sm text-slate-500 mt-1">
              اربط أسماء عربية واضحة (مثل: مجموعة الدراسة) بمعرفات مجموعات واتساب الحقيقية
            </p>
          </div>
          <button
            onClick={async () => {
              try {
                await apiRequest('/api/whatsapp/sync-groups', { method: 'POST' });
                onNotify('تمت المزامنة مع واتساب');
                await loadData();
              } catch (err) {
                onNotify(err instanceof Error ? err.message : 'فشلت المزامنة', true);
              }
            }}
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>مزامنة من واتساب</span>
          </button>
        </div>

        <form onSubmit={handleAddGroup} className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">معرف المجموعة (JID)</label>
            <input
              type="text"
              value={newGroupId}
              onChange={(e) => setNewGroupId(e.target.value)}
              placeholder="120363000001@g.us"
              required
              dir="ltr"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">اسم المجموعة</label>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="مجموعة كلية الهندسة"
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">الاسم المستعار</label>
            <input
              type="text"
              value={newGroupAlias}
              onChange={(e) => setNewGroupAlias(e.target.value)}
              placeholder="مجموعة الدراسة"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>حفظ مجموعة</span>
          </button>
        </form>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="relative max-w-md mb-4">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الاسم المستعار..."
              className="w-full pr-9 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <div className="divide-y divide-slate-100">
            {loading ? (
              <div className="py-8 text-center text-sm text-slate-400">جاري التحميل...</div>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">لا توجد مجموعات مسجلة حالياً.</div>
            ) : (
              groups.map((g) => (
                <div key={g.id} className="py-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">{g.name}</div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5 tabular-nums">
                      {g.wa_group_id} · {g.member_count} عضو
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={aliasEdits[g.id] ?? g.alias}
                      onChange={(e) => setAliasEdits((prev) => ({ ...prev, [g.id]: e.target.value }))}
                      placeholder="الاسم المستعار..."
                      className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg w-44"
                    />
                    <button
                      onClick={() => handleSaveAlias(g)}
                      className="px-3 py-1.5 text-xs bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      حفظ
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'logs') {
    const interactionLabel = (type?: string) => {
      switch (type) {
        case 'live_chat':
        case 'direct_chat':
          return 'دردشة مباشرة';
        case 'bot_auto':
        case 'bot_command':
        case 'system_reply':
          return 'رد البوت التلقائي';
        case 'unauthorized_attempt':
          return 'محاولة غير مصرح لها';
        case 'scheduled':
          return 'مهمة مجدولة';
        case 'file_upload':
          return 'استلام ملف';
        default:
          return type || 'رسالة';
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">سجل عمليات الإرسال والرسائل (message_logs)</h2>
            <p className="text-sm text-slate-500 mt-1">
              توثيق فعلي لكل رسالة واردة وصادرة عبر الجهاز المرتبط بما فيها الدردشة المباشرة والمحاولات غير المصرح لها
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={interactionFilter}
              onChange={(e) => setInteractionFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">كل أنواع التفاعل</option>
              <option value="live_chat">دردشة مباشرة (live_chat)</option>
              <option value="bot_auto">رد البوت التلقائي (bot_auto)</option>
              <option value="unauthorized_attempt">محاولة غير مصرح لها (unauthorized_attempt)</option>
              <option value="scheduled">مهمة مجدولة (scheduled)</option>
            </select>
            <button
              onClick={() => void loadData()}
              className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="py-3 px-4">الاتجاه</th>
                  <th className="py-3 px-4">نوع التفاعل</th>
                  <th className="py-3 px-4">جهة الاتصال</th>
                  <th className="py-3 px-4">النص</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4">الوقت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {msgLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">لا توجد رسائل مسجلة بعد.</td>
                  </tr>
                ) : (
                  msgLogs.map((log) => {
                    const isUnauthorized = log.interaction_type === 'unauthorized_attempt';
                    return (
                      <tr key={log.id} className={isUnauthorized ? 'bg-red-50/40' : 'hover:bg-slate-50/60'}>
                        <td className="py-3 px-4 text-xs font-semibold">
                          {log.direction === 'outbound' ? 'صادر' : 'وارد'}
                        </td>
                        <td
                          className={`py-3 px-4 text-xs font-semibold whitespace-nowrap ${
                            isUnauthorized ? 'text-red-700' : 'text-slate-700'
                          }`}
                        >
                          {interactionLabel(log.interaction_type)}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {log.nickname && <div className="font-semibold text-slate-900">{log.nickname}</div>}
                          <div className="font-mono text-slate-600" dir="ltr">
                            {log.phone ||
                              (log.direction === 'outbound'
                                ? log.recipient_label || log.contact_phone || log.recipient_id
                                : log.sender_phone || log.contact_phone)}
                          </div>
                        </td>
                        <td className="py-3 px-4 max-w-md truncate text-slate-700">
                          {log.message_text || log.content_preview || log.file_name || '—'}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <span
                            className={
                              log.status === 'failed' || log.status === 'rejected'
                                ? 'text-red-600 font-semibold'
                                : 'text-emerald-700 font-semibold'
                            }
                          >
                            {log.status}
                          </span>
                          {log.error_message && <div className="text-red-500 mt-0.5">{log.error_message}</div>}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {formatArabicDate(log.created_at)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">سجل الأخطاء والنظام</h2>
          <p className="text-sm text-slate-500 mt-1">مراقبة أحداث واتساب والجدولة وGemini دون كشف أي أسرار</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="all">كل المستويات</option>
            <option value="error">أخطاء (Error)</option>
            <option value="warn">تحذيرات (Warn)</option>
            <option value="info">معلومات (Info)</option>
          </select>
          <button
            onClick={() => void loadData()}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {sysLogs.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">لا توجد سجلات مطابقة.</div>
        ) : (
          sysLogs.map((item) => (
            <div key={item.id} className="p-4 flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="text-xs font-mono text-slate-500">
                  <span className={item.level === 'error' ? 'text-red-600 font-bold' : item.level === 'warn' ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'}>
                    {item.level.toUpperCase()}
                  </span>
                  {' · '}
                  <span>{item.category}</span>
                </div>
                <div className="text-sm text-slate-900">{item.message}</div>
              </div>
              <div className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                {formatArabicDate(item.created_at)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
