import React, { useState, useEffect, useCallback } from 'react';
import { Search, Download, Trash2, Plus, Pause, Play, XCircle, Wifi, UserPlus, MessageCircle, Send, RefreshCw } from 'lucide-react';
import { apkFetch, testServerHealth } from '../api';
import { getApiBaseUrl, getJwtToken, setApiBaseUrl } from '../config';

export interface ApkFile {
  id: string;
  original_name: string;
  folder_name?: string;
  file_type: string;
  size_bytes: number;
  received_at: string;
}

export interface ApkTask {
  id: string;
  title: string;
  destination_label: string;
  schedule_type: string;
  time_of_day: string;
  next_run_at: string | null;
  status: string;
}

export interface ApkGroup {
  id: string;
  wa_group_id: string;
  name: string;
  alias: string;
  member_count: number;
}

export interface ApkLog {
  id: string;
  direction: string;
  phone?: string;
  nickname?: string;
  message_text?: string;
  sender_phone: string;
  recipient_label: string;
  contact_phone?: string;
  interaction_type?: string;
  content_preview: string;
  status: string;
  error_message: string;
  created_at: string;
}

export interface ApkWaUser {
  id: string;
  phone: string;
  phone_e164: string;
  display_name: string;
  nickname?: string;
  alias?: string;
  permission?: 'chat' | 'view_only' | 'blocked';
  role: string;
  is_active?: number;
  connection_state?: string;
  unread_count?: number;
}

export const FilesScreen: React.FC<{
  files: ApkFile[];
  onRefresh: () => void;
  onNotify: (m: string, err?: boolean) => void;
}> = ({ files, onRefresh, onNotify }) => {
  const [search, setSearch] = useState('');
  const [confirmFile, setConfirmFile] = useState<ApkFile | null>(null);
  const [selectedFile, setSelectedFile] = useState<ApkFile | null>(null);

  const filtered = files.filter((f) =>
    f.original_name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const handleDelete = async () => {
    if (!confirmFile) return;
    try {
      await apkFetch(`/api/files/${confirmFile.id}`, { method: 'DELETE' });
      onNotify(`تم حذف ${confirmFile.original_name}`);
      setConfirmFile(null);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل الحذف', true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث عن ملف..."
          className="w-full pr-9 pl-3 py-3 text-sm bg-white border border-slate-200 rounded-xl"
        />
      </div>

      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
            لا توجد ملفات مطابقة
          </div>
        ) : (
          filtered.map((f) => (
            <div key={f.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3">
              <button
                onClick={() => setSelectedFile(f)}
                className="min-w-0 flex-1 text-right min-h-[44px] flex flex-col justify-center"
              >
                <div className="text-sm font-semibold text-slate-900 truncate">{f.original_name}</div>
                <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  {f.folder_name || 'غير مصنف'} · {f.file_type} · {Math.max(1, Math.round(f.size_bytes / 1024))} KB
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={`${getApiBaseUrl()}/api/files/${encodeURIComponent(f.id)}/download?token=${encodeURIComponent(getJwtToken() || '')}`}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600"
                  aria-label="تحميل"
                >
                  <Download className="w-5 h-5" />
                </a>
                <button
                  onClick={() => setConfirmFile(f)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-red-600"
                  aria-label="حذف"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedFile && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3">
            <h3 className="text-base font-bold text-slate-900">{selectedFile.original_name}</h3>
            <div className="text-xs text-slate-600 space-y-1">
              <div>المجلد: {selectedFile.folder_name || 'غير مصنف'}</div>
              <div>النوع: {selectedFile.file_type}</div>
              <div>الحجم: {Math.max(1, Math.round(selectedFile.size_bytes / 1024))} KB</div>
              <div>تاريخ الاستلام: {new Date(selectedFile.received_at).toLocaleString('ar-SD')}</div>
            </div>
            <button
              onClick={() => setSelectedFile(null)}
              className="w-full py-3 bg-slate-900 text-white text-sm font-medium rounded-xl"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}

      {confirmFile && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900">تأكيد الحذف</h3>
            <p className="text-sm text-slate-600">هل تريد حذف الملف "{confirmFile.original_name}" نهائياً؟</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmFile(null)} className="flex-1 py-3 bg-slate-100 rounded-xl text-sm">إلغاء</button>
              <button onClick={handleDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-semibold">حذف</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const TasksScreen: React.FC<{
  tasks: ApkTask[];
  files: ApkFile[];
  groups: ApkGroup[];
  onRefresh: () => void;
  onNotify: (m: string, err?: boolean) => void;
}> = ({ tasks, files, groups, onRefresh, onNotify }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [fileId, setFileId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [scheduleType, setScheduleType] = useState('once');
  const [dateIso, setDateIso] = useState(() => new Date().toISOString().slice(0, 10));
  const [timeOfDay, setTimeOfDay] = useState('20:00');
  const [messageText, setMessageText] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = destinationId || groups[0]?.wa_group_id || '';
    const grp = groups.find((g) => g.wa_group_id === target);
    try {
      await apkFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: title || 'مهمة من التطبيق',
          fileIds: fileId ? [fileId] : [],
          messageText,
          destinationType: 'group',
          destinationId: target,
          destinationLabel: grp?.alias || grp?.name || target,
          scheduleType,
          dateIso: scheduleType === 'once' ? dateIso : undefined,
          timeOfDay,
        }),
      });
      setShowCreate(false);
      setTitle('');
      setMessageText('');
      onNotify('تمت جدولة المهمة بنجاح');
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل إنشاء المهمة', true);
    }
  };

  const act = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      await apkFetch(`/api/tasks/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ action }),
      });
      onNotify('تم تحديث المهمة');
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل التحديث', true);
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowCreate(true)}
        className="w-full py-3 bg-emerald-600 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 min-h-[48px]"
      >
        <Plus className="w-4 h-4" />
        <span>إنشاء مهمة مجدولة جديدة</span>
      </button>

      <div className="space-y-2.5">
        {tasks.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
            لا توجد مهام مجدولة حالياً
          </div>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900">{t.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {t.destination_label} · {t.schedule_type} · {t.time_of_day}
                  </div>
                </div>
                <span className="text-xs font-semibold text-slate-700">{t.status}</span>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                {t.status === 'Pending' && (
                  <button
                    onClick={() => act(t.id, 'pause')}
                    className="flex-1 py-2 text-xs bg-amber-50 text-amber-800 rounded-lg flex items-center justify-center gap-1 min-h-[40px]"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>إيقاف مؤقت</span>
                  </button>
                )}
                {t.status === 'Paused' && (
                  <button
                    onClick={() => act(t.id, 'resume')}
                    className="flex-1 py-2 text-xs bg-emerald-50 text-emerald-800 rounded-lg flex items-center justify-center gap-1 min-h-[40px]"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>استئناف</span>
                  </button>
                )}
                {(t.status === 'Pending' || t.status === 'Paused') && (
                  <button
                    onClick={() => act(t.id, 'cancel')}
                    className="flex-1 py-2 text-xs bg-red-50 text-red-700 rounded-lg flex items-center justify-center gap-1 min-h-[40px]"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>إلغاء</span>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3 max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900">مهمة جديدة</h3>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان المهمة"
              required
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"
            />
            <select
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white"
            >
              <option value="">رسالة نصية بدون ملف</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>{f.original_name}</option>
              ))}
            </select>
            <select
              value={destinationId || groups[0]?.wa_group_id || ''}
              onChange={(e) => setDestinationId(e.target.value)}
              required
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.wa_group_id}>{g.alias || g.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value)}
                className="px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white"
              >
                <option value="once">مرة واحدة</option>
                <option value="daily">يومي</option>
                <option value="weekly">أسبوعي</option>
                <option value="monthly">شهري</option>
              </select>
              <input
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="px-3 py-2.5 text-sm border border-slate-300 rounded-xl"
              />
            </div>
            {scheduleType === 'once' && (
              <input
                type="date"
                value={dateIso}
                onChange={(e) => setDateIso(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"
              />
            )}
            <textarea
              rows={2}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="رسالة مصاحبة (اختياري)"
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"
            />
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-3 bg-slate-100 rounded-xl text-sm">إلغاء</button>
              <button type="submit" className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold">حفظ</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const GroupsScreen: React.FC<{
  groups: ApkGroup[];
  onRefresh: () => void;
  onNotify: (m: string, err?: boolean) => void;
}> = ({ groups, onRefresh, onNotify }) => {
  const [search, setSearch] = useState('');
  const [aliases, setAliases] = useState<Record<string, string>>({});

  const filtered = groups.filter(
    (g) => g.name.includes(search) || g.alias.includes(search)
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث في المجموعات..."
          className="w-full pr-9 pl-3 py-3 text-sm bg-white border border-slate-200 rounded-xl"
        />
      </div>
      <div className="space-y-2.5">
        {filtered.map((g) => (
          <div key={g.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
            <div className="text-sm font-bold text-slate-900">{g.name}</div>
            <div className="text-xs text-slate-500">{g.member_count} عضو</div>
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={aliases[g.id] ?? g.alias}
                onChange={(e) => setAliases((p) => ({ ...p, [g.id]: e.target.value }))}
                placeholder="الاسم المستعار"
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <button
                onClick={async () => {
                  try {
                    await apkFetch(`/api/groups/${g.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ alias: aliases[g.id] ?? g.alias }),
                    });
                    onNotify('تم حفظ الاسم المستعار');
                    onRefresh();
                  } catch (err) {
                    onNotify(err instanceof Error ? err.message : 'فشل الحفظ', true);
                  }
                }}
                className="px-4 py-2 bg-slate-900 text-white text-xs rounded-lg min-h-[40px]"
              >
                حفظ
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const DirectChatScreen: React.FC<{
  isOwner: boolean;
  waReady: boolean;
  waUsers: ApkWaUser[];
  initialPhone?: string | null;
  onRefresh: () => void;
  onNotify: (m: string, err?: boolean) => void;
}> = ({ isOwner, waReady, waUsers, initialPhone, onRefresh, onNotify }) => {
  const authorized = waUsers.filter((u) => u.permission !== 'blocked' && u.role !== 'unauthorized' && u.is_active !== 0);
  const [selectedPhone, setSelectedPhone] = useState<string>(
    initialPhone || authorized[0]?.phone || ''
  );
  const [messages, setMessages] = useState<ApkLog[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (initialPhone) setSelectedPhone(initialPhone.replace(/\D/g, ''));
  }, [initialPhone]);

  useEffect(() => {
    if (!selectedPhone && authorized[0]?.phone) {
      setSelectedPhone(authorized[0].phone);
    }
  }, [authorized, selectedPhone]);

  const loadThread = useCallback(async () => {
    if (!isOwner || !selectedPhone) return;
    try {
      const res = await apkFetch<{ messages: ApkLog[] }>(
        `/api/live-chat/messages?phone=${encodeURIComponent(selectedPhone)}`
      );
      setMessages(res.messages);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل الدردشة', true);
    }
  }, [isOwner, selectedPhone, onRefresh, onNotify]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  if (!isOwner) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-xs text-red-900">
        الدردشة المباشرة متاحة لمالك النظام (Owner) فقط.
      </div>
    );
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPhone || !draft.trim()) return;
    setSending(true);
    try {
      const res = await apkFetch<{ messages: ApkLog[] }>('/api/live-chat/send', {
        method: 'POST',
        body: JSON.stringify({ phone: selectedPhone, message: draft.trim() }),
      });
      setDraft('');
      setMessages(res.messages);
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر الإرسال', true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${waReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <select
          value={selectedPhone}
          onChange={(e) => setSelectedPhone(e.target.value)}
          className="flex-1 px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl"
        >
          {authorized.length === 0 ? (
            <option value="">لا توجد أرقام مصرح لها</option>
          ) : (
            authorized.map((u) => (
              <option key={u.id} value={u.phone}>
                {u.nickname || u.alias || u.display_name} ({u.phone})
              </option>
            ))
          )}
        </select>
        <button
          onClick={() => void loadThread()}
          className="min-h-[44px] min-w-[44px] bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-700"
          aria-label="تحديث"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 min-h-[300px] max-h-[52vh] overflow-y-auto space-y-2.5">
        {messages.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            لا توجد رسائل بعد مع جهة الاتصال المختارة
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs border ${
                  m.direction === 'outbound'
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-slate-50 text-slate-900 border-slate-200'
                }`}
              >
                <div className="whitespace-pre-wrap">{m.message_text || m.content_preview}</div>
                <div className={`text-[10px] mt-1 ${m.direction === 'outbound' ? 'text-emerald-100' : 'text-slate-400'}`}>
                  {m.interaction_type === 'live_chat'
                    ? 'رد المالك المباشر'
                    : m.interaction_type === 'bot_auto'
                      ? 'رد البوت التلقائي'
                      : m.interaction_type || 'رسالة'}{' '}
                  · {new Date(m.created_at).toLocaleTimeString('ar-SD', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!waReady || sending}
          placeholder={waReady ? 'اكتب رسالة واتساب عبر الجهاز المرتبط...' : 'الجهاز المرتبط غير متصل'}
          className="flex-1 px-3 py-3 text-sm bg-white border border-slate-200 rounded-xl disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={sending || !waReady || !draft.trim() || !selectedPhone}
          className="px-4 py-3 bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5 min-h-[44px]"
        >
          <Send className="w-4 h-4" />
          <span>إرسال</span>
        </button>
      </form>
    </div>
  );
};

export const UsersAndSettingsScreen: React.FC<{
  mode: 'users' | 'settings';
  isOwner: boolean;
  linkedBotPhone?: string;
  waUsers: ApkWaUser[];
  onOpenChat: (phone: string) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onNotify: (m: string, err?: boolean) => void;
}> = ({ mode, isOwner, linkedBotPhone, waUsers, onOpenChat, onRefresh, onLogout, onNotify }) => {
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [permission, setPermission] = useState<'chat' | 'view_only' | 'blocked'>('chat');
  const [instructionAlert, setInstructionAlert] = useState('');
  const [serverUrl, setServerUrl] = useState(() => getApiBaseUrl());
  const [healthResult, setHealthResult] = useState('');

  if (mode === 'users') {
    if (!isOwner) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-xs text-red-900">
          إدارة الأرقام المصرح لها وعرض أرقام الهواتف مقصور على مالك النظام (Owner) فقط.
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const res = await apkFetch<{ instructionMessage?: string }>('/api/authorized-users', {
                method: 'POST',
                body: JSON.stringify({ phone: phone.trim(), nickname: nickname.trim(), permission }),
              });
              setPhone('');
              setNickname('');
              setPermission('chat');
              if (res.instructionMessage) setInstructionAlert(res.instructionMessage);
              onNotify('تمت إضافة الرقم المصرح له بنجاح');
              onRefresh();
            } catch (err) {
              onNotify(err instanceof Error ? err.message : 'تعذرت الإضافة', true);
            }
          }}
          className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"
        >
          <div className="text-sm font-bold text-slate-900">إضافة رقم مصرح له (بدون +)</div>
          {linkedBotPhone && (
            <div className="text-xs text-emerald-900 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
              رقم الجهاز المرتبط: <span className="font-mono font-bold" dir="ltr">{linkedBotPhone}</span>
            </div>
          )}
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="249912345678"
            dir="ltr"
            required
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl font-mono"
          />
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="الاسم المستعار"
            required
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"
          />
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value as 'chat' | 'view_only' | 'blocked')}
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white"
          >
            <option value="chat">دردشة مع البوت (chat)</option>
            <option value="view_only">متابعة فقط (view_only)</option>
            <option value="blocked">محظور (blocked)</option>
          </select>
          <button type="submit" className="w-full py-3 bg-emerald-600 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2">
            <UserPlus className="w-4 h-4" />
            <span>إضافة وتفعيل الرقم</span>
          </button>
        </form>

        {instructionAlert && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-xs text-blue-900 font-semibold">
            {instructionAlert}
          </div>
        )}

        <div className="space-y-2">
          {waUsers.map((u) => {
            const isEnabled = u.is_active !== 0;
            const canChat = isEnabled && u.permission !== 'blocked' && u.role !== 'unauthorized';
            return (
              <div key={u.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        !canChat ? 'bg-red-500' : 'bg-emerald-500'
                      }`}
                    />
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {u.nickname || u.alias || u.display_name}
                    </span>
                    {(u.unread_count || 0) > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                        {u.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5" dir="ltr">
                    {u.phone} · {u.permission || 'chat'} {!isEnabled ? '(معطل)' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canChat && (
                    <button
                      onClick={() => onOpenChat(u.phone)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-emerald-700"
                      aria-label="دردشة مباشرة"
                    >
                      <MessageCircle className="w-5 h-5" />
                    </button>
                  )}
                  {u.role !== 'owner' && (
                    <>
                      <button
                        onClick={async () => {
                          await apkFetch(`/api/authorized-users/${u.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ isActive: !isEnabled }),
                          });
                          onNotify(isEnabled ? 'تم تعطيل الرقم' : 'تم تفعيل الرقم');
                          onRefresh();
                        }}
                        className="px-2.5 py-1.5 text-[11px] bg-slate-100 rounded-lg text-slate-700"
                      >
                        {isEnabled ? 'تعطيل' : 'تفعيل'}
                      </button>
                      <button
                        onClick={async () => {
                          await apkFetch(`/api/authorized-users/${u.id}`, { method: 'DELETE' });
                          onNotify('تم حذف الرقم');
                          onRefresh();
                        }}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <label className="block text-sm font-bold text-slate-900">رابط السيرفر (Server URL)</label>
        <input
          type="url"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          dir="ltr"
          className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl font-mono"
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              const saved = setApiBaseUrl(serverUrl);
              setServerUrl(saved);
              onNotify('تم حفظ رابط السيرفر');
            }}
            className="flex-1 py-3 bg-slate-900 text-white text-sm font-medium rounded-xl"
          >
            حفظ الرابط
          </button>
          <button
            onClick={async () => {
              try {
                const h = await testServerHealth(serverUrl);
                setHealthResult(`السيرفر متصل · واتساب: ${h.whatsapp.status} · Gemini: ${h.gemini.configured ? 'جاهز' : 'غير مضبوط'}`);
                onNotify('الاتصال بالسيرفر ناجح');
              } catch (err) {
                setHealthResult(err instanceof Error ? err.message : 'فشل الاتصال');
                onNotify('تعذر الاتصال بالسيرفر', true);
              }
            }}
            className="flex-1 py-3 bg-emerald-600 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-1.5"
          >
            <Wifi className="w-4 h-4" />
            <span>اختبار الاتصال</span>
          </button>
        </div>
        {healthResult && <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200">{healthResult}</div>}
      </div>

      <button
        onClick={onLogout}
        className="w-full py-3 bg-red-50 text-red-700 text-sm font-semibold rounded-xl border border-red-200"
      >
        تسجيل الخروج
      </button>
    </div>
  );
};
