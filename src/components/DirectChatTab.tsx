import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Send, RefreshCw, Search, MessageSquare, UserPlus, AlertTriangle, ShieldAlert, Smartphone } from 'lucide-react';
import { apiRequest, formatArabicDate } from '../lib/api.ts';
import type { AuthUser, MessageLogItem, WhatsAppState, WhatsAppUserItem } from '../types.ts';

interface DirectChatTabProps {
  currentUser: AuthUser;
  initialPhone?: string | null;
  onNavigateTab: (tab: string) => void;
  onRefreshStats: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

const INTERACTION_AR: Record<string, string> = {
  live_chat: 'رد المالك المباشر',
  bot_auto: 'رد البوت التلقائي',
  unauthorized_attempt: 'محاولة غير مصرح لها',
  direct_chat: 'دردشة مباشرة',
  bot_command: 'أمر ذكي',
  scheduled: 'رسالة مجدولة',
  file_upload: 'استقبال ملف',
  system_reply: 'رد آلي',
};

export const DirectChatTab: React.FC<DirectChatTabProps> = ({
  currentUser,
  initialPhone,
  onNavigateTab,
  onRefreshStats,
  onNotify,
}) => {
  const [contacts, setContacts] = useState<WhatsAppUserItem[]>([]);
  const [waState, setWaState] = useState<WhatsAppState | null>(null);
  const [selectedPhone, setSelectedPhone] = useState<string>(initialPhone || '');
  const [selectedContact, setSelectedContact] = useState<WhatsAppUserItem | null>(null);
  const [messages, setMessages] = useState<MessageLogItem[]>([]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const isOwner = currentUser.role === 'owner';

  useEffect(() => {
    if (initialPhone) {
      setSelectedPhone(initialPhone.replace(/\D/g, ''));
    }
  }, [initialPhone]);

  const loadThreads = useCallback(async () => {
    if (!isOwner) {
      setLoadingThreads(false);
      return;
    }
    try {
      const res = await apiRequest<{ contacts: WhatsAppUserItem[]; whatsapp: WhatsAppState }>('/api/live-chat/threads');
      setContacts(res.contacts);
      setWaState(res.whatsapp);
      setSelectedPhone((prev) => prev || res.contacts[0]?.phone || '');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل محادثات الأرقام المصرح لها', true);
    } finally {
      setLoadingThreads(false);
    }
  }, [isOwner, onNotify]);

  const loadMessages = useCallback(
    async (phone: string, markRead = true) => {
      if (!isOwner || !phone) {
        setMessages([]);
        setSelectedContact(null);
        return;
      }
      setLoadingMessages(true);
      try {
        const res = await apiRequest<{
          contact: WhatsAppUserItem;
          messages: MessageLogItem[];
          whatsapp: WhatsAppState;
        }>(`/api/live-chat/messages?phone=${encodeURIComponent(phone)}&markRead=${markRead ? 'true' : 'false'}`);
        setSelectedContact(res.contact);
        setMessages(res.messages);
        if (res.whatsapp) setWaState(res.whatsapp);
        if (markRead) {
          onRefreshStats();
        }
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'تعذر جلب سجل المحادثة', true);
      } finally {
        setLoadingMessages(false);
      }
    },
    [isOwner, onNotify, onRefreshStats]
  );

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (selectedPhone) {
      void loadMessages(selectedPhone, true);
    }
  }, [selectedPhone, loadMessages]);

  useEffect(() => {
    if (!isOwner) return;
    const id = setInterval(() => {
      void loadThreads();
      if (selectedPhone) {
        void loadMessages(selectedPhone, true);
      }
    }, 4500);
    return () => clearInterval(id);
  }, [isOwner, selectedPhone, loadThreads, loadMessages]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedPhone]);

  if (!isOwner) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center gap-3 text-red-900">
        <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" />
        <div>
          <div className="text-sm font-bold">الدردشة المباشرة متاحة للمالك (Owner Only) فقط</div>
          <div className="text-xs mt-1 text-red-800">
            حفاظاً على خصوصية المحادثات وأرقام الهواتف، يقتصر عرض المحادثات وإرسال الرسائل عبر الجهاز المرتبط على المالك فقط.
          </div>
        </div>
      </div>
    );
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !selectedPhone) return;

    setSending(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        contact: WhatsAppUserItem;
        messages: MessageLogItem[];
      }>('/api/live-chat/send', {
        method: 'POST',
        body: JSON.stringify({
          phone: selectedPhone,
          message: text,
        }),
      });
      setDraft('');
      setSelectedContact(res.contact);
      setMessages(res.messages);
      await loadThreads();
      onRefreshStats();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل إرسال الرسالة عبر الجهاز المرتبط', true);
    } finally {
      setSending(false);
    }
  };

  const waReady = waState?.status === 'ready';
  const linkedPhone = waState?.linkedBotPhone || waState?.connectedPhone || 'غير محدد';
  const filteredContacts = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.phone.toLowerCase().includes(q) ||
      (c.nickname || '').toLowerCase().includes(q) ||
      c.display_name.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">الدردشة المباشرة (Live Chat)</h2>
          <p className="text-sm text-slate-500 mt-1">
            تعرض جهات الاتصال المصرح لها والمفعّلة فقط، مع الإرسال مباشرة من رقم الجهاز المرتبط
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigateTab('contacts')}
            className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>إدارة الأرقام المصرح لها</span>
          </button>
          <button
            onClick={() => {
              void loadThreads();
              if (selectedPhone) void loadMessages(selectedPhone, true);
            }}
            className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* Linked Device Banner with green/red dot */}
      <div
        className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
          waReady ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-red-50 border-red-200 text-red-900'
        }`}
      >
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          <span className={`w-3 h-3 rounded-full shrink-0 ${waReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>
            البوت يعمل عبر رقم الجهاز المرتبط:{' '}
            <span className="font-mono font-bold mx-1" dir="ltr">
              {linkedPhone}
            </span>{' '}
            — اطلب من المصرح لهم حفظ هذا الرقم وإرسال رسالة له
          </span>
        </div>
        {!waReady && (
          <button
            onClick={() => onNavigateTab('whatsapp')}
            className="px-3.5 py-1.5 bg-red-700 hover:bg-red-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            ربط الجهاز (QR)
          </button>
        )}
      </div>

      {/* 2-Column RTL Live Chat Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Authorized Contacts List */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl flex flex-col h-[560px]">
          <div className="p-3 border-b border-slate-200">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث في الأرقام المصرح لها..."
                className="w-full pr-9 pl-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {loadingThreads ? (
              <div className="p-6 text-center text-sm text-slate-400">جاري تحميل القائمة...</div>
            ) : filteredContacts.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500 space-y-2">
                <div>لا توجد أرقام مصرح لها ومفعّلة حالياً.</div>
                <button
                  onClick={() => onNavigateTab('contacts')}
                  className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                >
                  أضف أول رقم مصرح له
                </button>
              </div>
            ) : (
              filteredContacts.map((c) => {
                const isSelected = c.phone === selectedPhone;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedPhone(c.phone)}
                    className={`w-full text-right p-3.5 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            waReady ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                          title={waReady ? 'الجهاز المرتبط متصل' : 'الجهاز المرتبط غير متصل'}
                        />
                        <span className="text-sm font-bold text-slate-900 truncate">
                          {c.nickname || c.alias || c.display_name || c.phone}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-1 truncate" dir="ltr">
                        {c.phone}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {c.unread_count > 0 && (
                        <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
                          {c.unread_count}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400 font-mono">{c.permission}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Active Conversation Thread */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl flex flex-col h-[560px]">
          {!selectedContact ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <MessageSquare className="w-10 h-10 mb-3 text-slate-300" />
              <p className="text-sm text-slate-500">اختر جهة اتصال مصرح لها لعرض المحادثة والرد عبر الجهاز المرتبط</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${waReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {selectedContact.nickname || selectedContact.alias || selectedContact.display_name}
                    </div>
                    <div className="text-xs text-slate-500 font-mono" dir="ltr">
                      {selectedContact.phone}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span>الجهاز المرتبط:</span>
                  <strong className={waReady ? 'text-emerald-700' : 'text-red-600'}>
                    {waReady ? 'متصل وجاهز' : 'غير متصل'}
                  </strong>
                </div>
              </div>

              {/* Messages Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/70">
                {loadingMessages && messages.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">جاري تحميل المحادثة...</div>
                ) : messages.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    لا توجد رسائل مسجلة مع {selectedContact.nickname || selectedContact.phone} بعد.
                  </div>
                ) : (
                  messages.map((m) => {
                    const isOutbound = m.direction === 'outbound';
                    return (
                      <div key={m.id} className={`flex ${isOutbound ? 'justify-start' : 'justify-end'}`}>
                        <div
                          className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm border ${
                            isOutbound
                              ? 'bg-emerald-600 text-white border-emerald-700'
                              : 'bg-white text-slate-900 border-slate-200'
                          }`}
                        >
                          <div className="whitespace-pre-wrap leading-relaxed break-words">
                            {m.message_text || m.content_preview || m.file_name || '—'}
                          </div>
                          <div
                            className={`mt-1.5 flex items-center justify-between gap-3 text-[11px] tabular-nums ${
                              isOutbound ? 'text-emerald-100' : 'text-slate-400'
                            }`}
                          >
                            <span>
                              {INTERACTION_AR[m.interaction_type || 'live_chat'] || 'دردشة مباشرة'}
                              {m.status === 'failed' ? ' · فشل الإرسال' : ''}
                            </span>
                            <span>{formatArabicDate(m.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Message Composer */}
              <form onSubmit={handleSendMessage} className="p-3.5 border-t border-slate-200 bg-white space-y-2">
                {!waReady && (
                  <div className="text-xs text-red-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>الجهاز المرتبط غير متصل — امسح رمز QR لتتمكن من إرسال الرسائل.</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`اكتب رسالة لإرسالها عبر الجهاز المرتبط إلى ${selectedContact.nickname || selectedContact.phone}...`}
                    disabled={sending || !waReady}
                    className="flex-1 px-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={sending || !waReady || !draft.trim()}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>{sending ? 'جاري الإرسال...' : 'إرسال'}</span>
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
