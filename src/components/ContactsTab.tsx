import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus,
  Trash2,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  Copy,
  Check,
  Power,
} from 'lucide-react';
import { apiRequest, formatArabicDate } from '../lib/api.ts';
import type {
  AuthUser,
  ContactPermission,
  WhatsAppState,
  WhatsAppUserItem,
} from '../types.ts';

interface ContactsTabProps {
  currentUser: AuthUser;
  onOpenChat: (phoneDigits: string) => void;
  onRefreshStats: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

const PERMISSION_LABEL: Record<ContactPermission, string> = {
  chat: 'دردشة كاملة مع البوت (chat)',
  view_only: 'متابعة واستقبال فقط (view_only)',
  blocked: 'محظور (blocked)',
};

export const ContactsTab: React.FC<ContactsTabProps> = ({
  currentUser,
  onOpenChat,
  onRefreshStats,
  onNotify,
}) => {
  const [contacts, setContacts] = useState<WhatsAppUserItem[]>([]);
  const [waState, setWaState] = useState<WhatsAppState | null>(null);
  const [linkedBotPhone, setLinkedBotPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Form state for adding authorized number
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [permission, setPermission] = useState<ContactPermission>('chat');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [instructionAlert, setInstructionAlert] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const isOwner = currentUser.role === 'owner';

  const loadAuthorizedUsers = useCallback(
    async (query = '') => {
      if (!isOwner) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const qs = query.trim() ? `?search=${encodeURIComponent(query.trim())}` : '';
        const res = await apiRequest<{
          users: WhatsAppUserItem[];
          linkedBotPhone: string;
          whatsapp: WhatsAppState;
        }>(`/api/authorized-users${qs}`);
        setContacts(res.users);
        setLinkedBotPhone(res.linkedBotPhone || res.whatsapp?.linkedBotPhone || '');
        setWaState(res.whatsapp);
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'تعذر تحميل قائمة الأرقام المصرح لها', true);
      } finally {
        setLoading(false);
      }
    },
    [isOwner, onNotify]
  );

  useEffect(() => {
    void loadAuthorizedUsers(search);
  }, [loadAuthorizedUsers, search]);

  if (!isOwner) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center gap-3 text-red-900">
        <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" />
        <div>
          <div className="text-sm font-bold">الوصول مقصور على مالك النظام (Owner Only)</div>
          <div className="text-xs mt-1 text-red-800">
            إدارة الأرقام المصرح لها وعرض أرقام الهواتف الكاملة متاحة فقط لصاحب الحساب الرئيسي لحماية الخصوصية.
          </div>
        </div>
      </div>
    );
  }

  const validatePhoneInput = (raw: string): { ok: boolean; digits: string; error?: string } => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('+')) {
      return {
        ok: false,
        digits: '',
        error: 'أدخل الرقم بالصيغة الدولية بدون علامة + (مثال: 249912345678)',
      };
    }
    const digits = trimmed.replace(/\D/g, '');
    if (!/^[1-9]\d{7,14}$/.test(digits)) {
      return {
        ok: false,
        digits: '',
        error: 'صيغة الرقم غير صحيحة — أدخل 8 إلى 15 رقماً بالصيغة الدولية بدون + (مثال: 249912345678)',
      };
    }
    return { ok: true, digits };
  };

  const handleAddAuthorizedUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const validation = validatePhoneInput(phone);
    if (!validation.ok) {
      setFormError(validation.error || 'رقم غير صالح');
      return;
    }

    setSaving(true);
    try {
      const res = await apiRequest<{
        user: WhatsAppUserItem;
        linkedBotPhone: string;
        instructionMessage: string;
      }>('/api/authorized-users', {
        method: 'POST',
        body: JSON.stringify({
          phone: validation.digits,
          nickname: nickname.trim(),
          permission,
        }),
      });
      setPhone('');
      setNickname('');
      setPermission('chat');
      setInstructionAlert(res.instructionMessage);
      setLinkedBotPhone(res.linkedBotPhone || linkedBotPhone);
      onNotify('تمت إضافة الرقم المصرح له بنجاح');
      await loadAuthorizedUsers(search);
      onRefreshStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر إضافة الرقم';
      setFormError(msg);
      onNotify(msg, true);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (contact: WhatsAppUserItem) => {
    try {
      const nextActive = contact.is_active !== 1;
      await apiRequest(`/api/authorized-users/${contact.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: nextActive }),
      });
      onNotify(nextActive ? `تم تفعيل الرقم ${contact.phone}` : `تم تعطيل الرقم ${contact.phone}`);
      await loadAuthorizedUsers(search);
      onRefreshStats();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحديث الحالة', true);
    }
  };

  const handlePermissionChange = async (contact: WhatsAppUserItem, nextPerm: ContactPermission) => {
    try {
      await apiRequest(`/api/authorized-users/${contact.id}`, {
        method: 'PUT',
        body: JSON.stringify({ permission: nextPerm }),
      });
      onNotify(`تم تحديث صلاحية "${contact.nickname || contact.phone}"`);
      await loadAuthorizedUsers(search);
      onRefreshStats();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحديث الصلاحية', true);
    }
  };

  const handleDelete = async (contact: WhatsAppUserItem) => {
    try {
      await apiRequest(`/api/authorized-users/${contact.id}`, { method: 'DELETE' });
      onNotify(`تم حذف الرقم ${contact.phone}`);
      await loadAuthorizedUsers(search);
      onRefreshStats();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر حذف الرقم', true);
    }
  };

  const handleCopyBotNumber = async () => {
    if (!linkedBotPhone) return;
    try {
      await navigator.clipboard.writeText(linkedBotPhone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors in restricted iframes
    }
  };

  const waReady = waState?.status === 'ready';
  const botDisplayPhone = linkedBotPhone || waState?.linkedBotPhone || waState?.connectedPhone || 'رقم الجهاز المرتبط';
  const activeCount = contacts.filter((c) => c.is_active === 1 && c.permission !== 'blocked').length;
  const blockedCount = contacts.filter((c) => c.is_active !== 1 || c.permission === 'blocked').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">الأرقام المصرح لها بالدردشة (authorized_users)</h2>
          <p className="text-sm text-slate-500 mt-1">
            أي رسالة تصل من رقم غير موجود هنا أو معطل/محظور يتم تجاهلها بصمت دون أي رد وتسجيلها كمحاولة غير مصرح لها.
          </p>
        </div>
        <button
          onClick={() => void loadAuthorizedUsers(search)}
          className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium text-slate-700 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>تحديث</span>
        </button>
      </div>

      {/* Mandatory Linked Device Banner */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-emerald-950">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full shrink-0 ${waReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <Smartphone className="w-5 h-5 text-emerald-700 shrink-0" />
          <div className="text-sm font-semibold">
            البوت يعمل عبر رقم الجهاز المرتبط:{' '}
            <span className="font-mono font-bold mx-1" dir="ltr">
              {botDisplayPhone}
            </span>{' '}
            — اطلب من المصرح لهم حفظ هذا الرقم وإرسال رسالة له
          </div>
        </div>
        {linkedBotPhone && (
          <button
            type="button"
            onClick={handleCopyBotNumber}
            className="px-3 py-1.5 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'تم النسخ' : 'نسخ رقم البوت'}</span>
          </button>
        )}
      </div>

      {/* Clear Instruction Alert immediately after adding a user */}
      {instructionAlert && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-3 text-sm text-blue-950">
          <div className="font-semibold">{instructionAlert}</div>
          <button
            onClick={() => setInstructionAlert('')}
            className="text-xs text-blue-700 hover:underline shrink-0 cursor-pointer"
          >
            إخفاء
          </button>
        </div>
      )}

      {/* Summary Counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">الأرقام المفعّلة والمصرح لها</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">{activeCount}</div>
          </div>
          <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">المعطلة أو المحظورة</div>
            <div className="text-2xl font-bold text-red-700 mt-1 tabular-nums">{blockedCount}</div>
          </div>
          <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">حالة الجهاز المرتبط الآن</div>
            <div className="text-sm font-bold text-slate-900 mt-1">
              {waReady ? 'متصل وجاهز للرد' : 'غير متصل'}
            </div>
          </div>
          <span className={`w-3 h-3 rounded-full shrink-0 ${waReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
        </div>
      </div>

      {/* Add New Authorized User Form */}
      <form onSubmit={handleAddAuthorizedUser} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">إضافة رقم مصرح له جديد</h3>
          <span className="text-xs text-slate-500">صيغة دولية بدون + (مثال: 249912345678)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              رقم الهاتف (دولي بدون +)
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setFormError('');
              }}
              placeholder="249912345678"
              dir="ltr"
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">الاسم المستعار</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="مثال: أحمد علي / منسق الدفعة"
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">الصلاحية</label>
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value as ContactPermission)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="chat">دردشة مع البوت (chat)</option>
              <option value="view_only">متابعة فقط دون رد آلي (view_only)</option>
              <option value="blocked">محظور (blocked)</option>
            </select>
          </div>
        </div>

        {formError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
            {formError}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>{saving ? 'جاري الإضافة...' : 'إضافة رقم مصرح له'}</span>
          </button>
        </div>
      </form>

      {/* Search & Authorized Users List */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">الأرقام المسجلة ({contacts.length})</h3>
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالرقم أو الاسم المستعار..."
              className="w-full pr-9 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-400">جاري تحميل الأرقام...</div>
          ) : contacts.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">لا توجد أرقام مطابقة.</div>
          ) : (
            contacts.map((contact) => {
              const isEnabled = contact.is_active === 1;
              const canOpenChat = isEnabled && contact.permission !== 'blocked';
              const isOwnerRow = contact.role === 'owner';

              return (
                <div key={contact.id} className="py-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          !isEnabled || contact.permission === 'blocked'
                            ? 'bg-red-500'
                            : waReady
                              ? 'bg-emerald-500'
                              : 'bg-amber-500'
                        }`}
                      />
                      <span className="text-sm font-bold text-slate-900">
                        {contact.nickname || contact.alias || contact.display_name || contact.phone}
                      </span>
                      {contact.unread_count > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold tabular-nums">
                          {contact.unread_count} رسالة جديدة
                        </span>
                      )}
                      {!isEnabled && (
                        <span className="text-xs font-semibold text-red-600">معطّل</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800" dir="ltr">
                        {contact.phone}
                      </span>
                      <span>·</span>
                      <span>{PERMISSION_LABEL[contact.permission || 'chat']}</span>
                      <span>·</span>
                      <span className="tabular-nums">أضيف: {formatArabicDate(contact.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {!isOwnerRow && (
                      <select
                        value={contact.permission || 'chat'}
                        onChange={(e) => void handlePermissionChange(contact, e.target.value as ContactPermission)}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                        aria-label="صلاحية الرقم"
                      >
                        <option value="chat">chat</option>
                        <option value="view_only">view_only</option>
                        <option value="blocked">blocked</option>
                      </select>
                    )}

                    {!isOwnerRow && (
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(contact)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1 cursor-pointer ${
                          isEnabled
                            ? 'bg-white border-slate-200 text-amber-700 hover:bg-amber-50'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{isEnabled ? 'تعطيل' : 'تفعيل'}</span>
                      </button>
                    )}

                    {canOpenChat && (
                      <button
                        type="button"
                        onClick={() => onOpenChat(contact.phone)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>دردشة</span>
                      </button>
                    )}

                    {!isOwnerRow && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(contact)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                        title="حذف الرقم"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
