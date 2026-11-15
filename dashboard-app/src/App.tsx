import { useState, useEffect, useCallback } from 'react';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import {
  Home,
  FileText,
  CalendarClock,
  Users,
  Send,
  ShieldCheck,
  Settings,
  MessageCircle,
  WifiOff,
  Wifi,
} from 'lucide-react';
import { apkFetch, testServerHealth } from './api';
import {
  clearAuthSession,
  getApiBaseUrl,
  getJwtToken,
  getStoredUser,
  saveAuthSession,
  setApiBaseUrl,
} from './config';
import {
  DirectChatScreen,
  FilesScreen,
  GroupsScreen,
  TasksScreen,
  UsersAndSettingsScreen,
  type ApkFile,
  type ApkGroup,
  type ApkLog,
  type ApkTask,
  type ApkWaUser,
} from './components/MobileScreens';

type Tab = 'home' | 'files' | 'tasks' | 'groups' | 'chat' | 'logs' | 'users' | 'settings';

interface ApkUser {
  id: string;
  username: string;
  role: 'owner' | 'admin' | 'viewer';
  full_name: string;
}

interface StatsResponse {
  botStatus: string;
  whatsapp: {
    status: string;
    provider: string;
    connectedPhone: string | null;
    linkedBotPhone?: string;
  };
  gemini: { configured: boolean; model: string };
  files: { total_files: number };
  tasks: Record<string, number>;
  unreadDirectChats?: number;
  newContactsCount?: number;
}

export default function App() {
  const [user, setUser] = useState<ApkUser | null>(() =>
    getJwtToken() ? getStoredUser<ApkUser>() : null
  );
  const [tab, setTab] = useState<Tab>('home');
  const [selectedChatPhone, setSelectedChatPhone] = useState<string | null>(null);
  const [offlineMsg, setOfflineMsg] = useState('');
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);

  // Login state
  const [serverUrl, setServerUrl] = useState(() => getApiBaseUrl());
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [healthStatus, setHealthStatus] = useState('');

  // Data state
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [files, setFiles] = useState<ApkFile[]>([]);
  const [tasks, setTasks] = useState<ApkTask[]>([]);
  const [groups, setGroups] = useState<ApkGroup[]>([]);
  const [logs, setLogs] = useState<ApkLog[]>([]);
  const [waUsers, setWaUsers] = useState<ApkWaUser[]>([]);

  const notify = useCallback((text: string, err = false) => {
    setToast({ text, err });
    setTimeout(() => setToast((p) => (p?.text === text ? null : p)), 4000);
  }, []);

  useEffect(() => {
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    const sub = CapApp.addListener('backButton', () => {
      if (tab !== 'home') {
        setTab('home');
      }
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [tab]);

  const loadAll = useCallback(async () => {
    if (!getJwtToken()) return;
    try {
      const current = getStoredUser<ApkUser>();
      const ownerMode = current?.role === 'owner';

      const [s, f, t, g, l, u] = await Promise.all([
        apkFetch<StatsResponse>('/api/stats'),
        apkFetch<{ files: ApkFile[] }>('/api/files'),
        apkFetch<{ tasks: ApkTask[] }>('/api/tasks'),
        apkFetch<{ groups: ApkGroup[] }>('/api/groups'),
        apkFetch<{ logs: ApkLog[] }>('/api/logs?limit=80'),
        ownerMode
          ? apkFetch<{ users: ApkWaUser[] }>('/api/authorized-users').then((r) => ({ whatsappUsers: r.users }))
          : apkFetch<{ whatsappUsers: ApkWaUser[] }>('/api/users'),
      ]);
      setStats(s);
      setFiles(f.files);
      setTasks(t.tasks);
      setGroups(g.groups);
      setLogs(l.logs);
      setWaUsers(u.whatsappUsers);
      setOfflineMsg('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'لا يوجد اتصال بالسيرفر';
      if (!getJwtToken()) {
        setUser(null);
      } else {
        setOfflineMsg(msg);
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadAll();
    }
  }, [user, loadAll]);

  const handleTestConnection = async () => {
    setHealthStatus('جاري فحص الاتصال...');
    try {
      const normalized = setApiBaseUrl(serverUrl);
      setServerUrl(normalized);
      const h = await testServerHealth(normalized);
      setHealthStatus(
        `متصل (${h.app}) · واتساب: ${h.whatsapp.status} · الذكاء الاصطناعي: ${h.gemini.configured ? 'جاهز' : 'غير مضبوط'}`
      );
    } catch (err) {
      setHealthStatus(err instanceof Error ? err.message : 'لا يوجد اتصال بالسيرفر');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    try {
      const normalized = setApiBaseUrl(serverUrl);
      const res = await apkFetch<{ token: string; user: ApkUser }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        },
        normalized
      );
      saveAuthSession(res.token, res.user);
      setUser(res.user);
      setOfflineMsg('');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'فشل تسجيل الدخول', true);
    } finally {
      setLoginBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-5">
        <main className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Smart-Sender Dashboard</h1>
              <p className="text-xs text-slate-500 mt-1">تطبيق التحكم عن بُعد في بوت واتساب المرتبط</p>
            </div>

            {toast && (
              <div className={`p-3 rounded-xl text-xs ${toast.err ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
                {toast.text}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">رابط السيرفر</label>
                <input
                  type="url"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  dir="ltr"
                  required
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <button
                type="button"
                onClick={handleTestConnection}
                className="w-full py-2.5 bg-slate-100 text-slate-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5"
              >
                <Wifi className="w-4 h-4" />
                <span>اختبار الاتصال بالسيرفر</span>
              </button>

              {healthStatus && (
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  {healthStatus}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">اسم المستخدم</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">كلمة المرور</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <button
                type="submit"
                disabled={loginBusy}
                className="w-full py-3 bg-emerald-600 text-white text-sm font-semibold rounded-xl min-h-[48px]"
              >
                {loginBusy ? 'جاري الدخول...' : 'تسجيل الدخول'}
              </button>
            </form>
          </div>
          <p className="text-center text-xs text-slate-500">Made by Mohammed Asim</p>
        </main>
      </div>
    );
  }

  const isOwner = user.role === 'owner';
  const waReady = stats?.whatsapp.status === 'ready';
  const linkedBotPhone = stats?.whatsapp.linkedBotPhone || stats?.whatsapp.connectedPhone || '';
  const unreadDirect = stats?.unreadDirectChats || 0;

  const navTabs: Array<{ id: Tab; label: string; icon: typeof Home }> = isOwner
    ? [
        { id: 'home', label: 'الرئيسية', icon: Home },
        { id: 'chat', label: 'الدردشة', icon: MessageCircle },
        { id: 'files', label: 'الملفات', icon: FileText },
        { id: 'tasks', label: 'المهام', icon: CalendarClock },
        { id: 'settings', label: 'المزيد', icon: Settings },
      ]
    : [
        { id: 'home', label: 'الرئيسية', icon: Home },
        { id: 'files', label: 'الملفات', icon: FileText },
        { id: 'tasks', label: 'المهام', icon: CalendarClock },
        { id: 'groups', label: 'المجموعات', icon: Users },
        { id: 'settings', label: 'المزيد', icon: Settings },
      ];

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur border-b border-slate-200 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${waReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="text-base font-bold text-slate-900">Smart-Sender</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('groups')} className="p-2 text-slate-600" aria-label="المجموعات">
            <Users className="w-4 h-4" />
          </button>
          <button onClick={() => setTab('logs')} className="p-2 text-slate-600" aria-label="سجل الرسائل">
            <Send className="w-4 h-4" />
          </button>
          {isOwner && (
            <button onClick={() => setTab('users')} className="relative p-2 text-slate-600" aria-label="الأرقام المصرح لها">
              <ShieldCheck className="w-4 h-4" />
              {(stats?.newContactsCount || 0) > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500" />
              )}
            </button>
          )}
        </div>
      </header>

      {isOwner && linkedBotPhone && (
        <div className="mx-4 mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 font-medium">
          البوت يعمل عبر رقم الجهاز المرتبط:{' '}
          <span className="font-mono font-bold" dir="ltr">
            {linkedBotPhone}
          </span>{' '}
          — اطلب من المصرح لهم حفظ هذا الرقم وإرسال رسالة له
        </div>
      )}

      {offlineMsg && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>{offlineMsg}</span>
          </div>
          <button onClick={() => void loadAll()} className="font-semibold underline shrink-0">إعادة</button>
        </div>
      )}

      {toast && (
        <div className="mx-4 mt-3 p-3 rounded-xl text-xs font-medium bg-white border border-slate-200 text-slate-900">
          {toast.text}
        </div>
      )}

      <main className="p-4 max-w-3xl mx-auto space-y-4">
        {tab === 'home' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="text-xs text-slate-500">حالة الجهاز المرتبط</div>
                <div className="text-base font-bold text-slate-900 mt-1 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${waReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span>{waReady ? 'متصل وجاهز' : 'غير متصل'}</span>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="text-xs text-slate-500">عدد الملفات</div>
                <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                  {stats?.files.total_files ?? 0}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="text-xs text-slate-500">المهام القادمة</div>
                <div className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                  {stats?.tasks.Pending ?? 0}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="text-xs text-slate-500">المهام الفاشلة</div>
                <div className="text-2xl font-bold text-red-600 mt-1 tabular-nums">
                  {stats?.tasks.Failed ?? 0}
                </div>
              </div>
            </div>

            {isOwner && (
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setTab('chat')} className="py-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm font-semibold text-emerald-900">
                  الدردشة المباشرة {unreadDirect > 0 ? `(${unreadDirect})` : ''}
                </button>
                <button onClick={() => setTab('users')} className="py-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold text-slate-800">
                  الأرقام المصرح لها ({waUsers.length})
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'chat' && (
          <DirectChatScreen
            isOwner={isOwner}
            waReady={waReady}
            waUsers={waUsers}
            initialPhone={selectedChatPhone}
            onRefresh={() => void loadAll()}
            onNotify={notify}
          />
        )}
        {tab === 'files' && <FilesScreen files={files} onRefresh={() => void loadAll()} onNotify={notify} />}
        {tab === 'tasks' && <TasksScreen tasks={tasks} files={files} groups={groups} onRefresh={() => void loadAll()} onNotify={notify} />}
        {tab === 'groups' && <GroupsScreen groups={groups} onRefresh={() => void loadAll()} onNotify={notify} />}
        {tab === 'logs' && (
          <div className="space-y-2.5">
            {logs.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">لا توجد سجلات</div>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>
                      {l.direction === 'outbound'
                        ? `إلى: ${l.nickname || l.recipient_label || l.phone}`
                        : `من: ${l.nickname || l.phone || l.sender_phone}`}
                      {l.interaction_type === 'live_chat'
                        ? ' · دردشة مباشرة'
                        : l.interaction_type === 'bot_auto'
                          ? ' · رد البوت التلقائي'
                          : l.interaction_type === 'unauthorized_attempt'
                            ? ' · محاولة غير مصرح لها'
                            : ''}
                    </span>
                    <span className={l.status === 'failed' || l.status === 'rejected' ? 'text-red-600' : 'text-emerald-700'}>
                      {l.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">{l.message_text || l.content_preview}</div>
                </div>
              ))
            )}
          </div>
        )}
        {(tab === 'users' || tab === 'settings') && (
          <>
            <UsersAndSettingsScreen
              mode={tab}
              isOwner={isOwner}
              linkedBotPhone={linkedBotPhone}
              waUsers={waUsers}
              onOpenChat={(phone) => {
                setSelectedChatPhone(phone);
                setTab('chat');
              }}
              onRefresh={() => void loadAll()}
              onLogout={() => {
                clearAuthSession();
                setUser(null);
              }}
              onNotify={notify}
            />
            {tab === 'settings' && (
              <footer className="pt-4 pb-2 text-center text-xs text-slate-500">
                Made by Mohammed Asim
              </footer>
            )}
          </>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur border-t border-slate-200 grid grid-cols-5 items-center">
        {navTabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`relative flex flex-col items-center justify-center min-h-[44px] ${
                active ? 'text-emerald-700 font-semibold' : 'text-slate-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              {item.id === 'chat' && unreadDirect > 0 && (
                <span className="absolute top-1.5 left-1/3 w-2 h-2 rounded-full bg-emerald-600" />
              )}
              <span className="text-[10px] mt-1">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
