import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  MessageCircle,
  UserCheck,
  FileText,
  FolderOpen,
  CalendarClock,
  Users,
  Send,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { apiRequest, clearStoredSession, getStoredToken, getStoredUser } from './lib/api.ts';
import type { AuthUser, DashboardStats } from './types.ts';
import { LoginScreen } from './components/LoginScreen.tsx';
import { OverviewTab } from './components/OverviewTab.tsx';
import { WhatsAppTab } from './components/WhatsAppTab.tsx';
import { FilesFoldersTab } from './components/FilesFoldersTab.tsx';
import { TasksTab } from './components/TasksTab.tsx';
import { GroupsLogsTab } from './components/GroupsLogsTab.tsx';
import { UsersSettingsTab } from './components/UsersSettingsTab.tsx';
import { AiTesterTab } from './components/AiTesterTab.tsx';
import { ContactsTab } from './components/ContactsTab.tsx';
import { DirectChatTab } from './components/DirectChatTab.tsx';

type TabKey =
  | 'overview'
  | 'whatsapp'
  | 'contacts'
  | 'chat'
  | 'files'
  | 'folders'
  | 'tasks'
  | 'groups'
  | 'logs'
  | 'ai'
  | 'users'
  | 'errors'
  | 'settings';

const TAB_TO_PATH: Record<TabKey, string> = {
  overview: '/dashboard',
  whatsapp: '/dashboard/qr-connect',
  contacts: '/dashboard/authorized-users',
  chat: '/dashboard/live-chat',
  files: '/dashboard/files',
  folders: '/dashboard/folders',
  tasks: '/dashboard/tasks',
  groups: '/dashboard/groups',
  logs: '/dashboard/logs',
  ai: '/dashboard/ai',
  users: '/dashboard/users',
  errors: '/dashboard/errors',
  settings: '/dashboard/settings',
};

function resolveTabFromPathname(pathname: string): TabKey {
  const clean = pathname.replace(/\/+$/, '').toLowerCase();
  if (clean === '/dashboard/qr-connect') return 'whatsapp';
  if (clean === '/dashboard/authorized-users') return 'contacts';
  if (clean === '/dashboard/live-chat') return 'chat';
  if (clean === '/dashboard/files') return 'files';
  if (clean === '/dashboard/folders') return 'folders';
  if (clean === '/dashboard/tasks') return 'tasks';
  if (clean === '/dashboard/groups') return 'groups';
  if (clean === '/dashboard/logs') return 'logs';
  if (clean === '/dashboard/ai') return 'ai';
  if (clean === '/dashboard/users') return 'users';
  if (clean === '/dashboard/errors') return 'errors';
  if (clean === '/dashboard/settings') return 'settings';
  return 'overview';
}

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: typeof LayoutDashboard; ownerOnly?: boolean }> = [
  { key: 'overview', label: 'الرئيسية', icon: LayoutDashboard },
  { key: 'whatsapp', label: 'ربط الجهاز (QR)', icon: MessageSquare },
  { key: 'contacts', label: 'الأرقام المصرح لها', icon: UserCheck, ownerOnly: true },
  { key: 'chat', label: 'الدردشة المباشرة', icon: MessageCircle, ownerOnly: true },
  { key: 'files', label: 'الملفات المستلمة', icon: FileText },
  { key: 'folders', label: 'إدارة المجلدات', icon: FolderOpen },
  { key: 'tasks', label: 'المهام المجدولة', icon: CalendarClock },
  { key: 'groups', label: 'المجموعات', icon: Users },
  { key: 'logs', label: 'سجل الرسائل', icon: Send },
  { key: 'ai', label: 'الذكاء الاصطناعي', icon: Sparkles },
  { key: 'users', label: 'المستخدمون والصلاحيات', icon: ShieldCheck },
  { key: 'errors', label: 'سجل الأخطاء', icon: AlertCircle },
  { key: 'settings', label: 'الإعدادات والنسخ', icon: Settings },
];

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    return getStoredToken() ? getStoredUser<AuthUser>() : null;
  });
  const [activeTab, setActiveTabState] = useState<TabKey>(() => resolveTabFromPathname(window.location.pathname));
  const [selectedChatPhone, setSelectedChatPhone] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);

  const navigateTab = useCallback((next: TabKey) => {
    setActiveTabState(next);
    const targetPath = TAB_TO_PATH[next] || '/dashboard';
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveTabState(resolveTabFromPathname(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const notify = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const fetchStats = useCallback(async () => {
    if (!getStoredToken()) return;
    setLoadingStats(true);
    try {
      const data = await apiRequest<DashboardStats>('/api/stats');
      setStats(data);
    } catch (err) {
      if (err instanceof Error && err.message.includes('تسجيل الدخول')) {
        setUser(null);
      }
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void fetchStats();
    const id = setInterval(() => {
      void fetchStats();
    }, 10000);
    return () => clearInterval(id);
  }, [user, fetchStats]);

  const handleLogout = () => {
    clearStoredSession();
    setUser(null);
    setStats(null);
  };

  if (!user) {
    return <LoginScreen onSuccess={(u) => setUser(u)} />;
  }

  const isOwner = user.role === 'owner';
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.ownerOnly || isOwner);
  const currentNav = NAV_ITEMS.find((i) => i.key === activeTab) || NAV_ITEMS[0];
  const unreadDirect = stats?.unreadDirectChats || 0;
  const waReady = stats?.whatsapp.status === 'ready';
  const waConnecting =
    stats?.whatsapp.status === 'qr_ready' ||
    stats?.whatsapp.status === 'initializing' ||
    stats?.whatsapp.status === 'authenticated';
  const waDotClass = waReady ? 'bg-emerald-500' : waConnecting ? 'bg-amber-500' : 'bg-red-500';
  const linkedBotPhone = stats?.whatsapp.linkedBotPhone || stats?.whatsapp.connectedPhone || '';

  const renderNavBadge = (key: TabKey) => {
    if (key === 'chat' && unreadDirect > 0) {
      return (
        <span className="mr-auto min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
          {unreadDirect}
        </span>
      );
    }
    if (key === 'whatsapp') {
      return <span className={`mr-auto w-2.5 h-2.5 rounded-full ${waDotClass}`} />;
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:right-0 bg-white border-l border-slate-200 z-30">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200">
          <img
            src="/src/assets/images/smart_sender_avatar_1794637773593.jpg"
            alt="Smart-Sender"
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
          />
          <span className="text-base font-bold text-slate-900 whitespace-nowrap">Smart-Sender</span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navigateTab(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-emerald-50 text-emerald-800 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-700' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
                {renderNavBadge(item.key)}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs text-slate-500">
            <div className="font-semibold text-slate-800">{user.full_name}</div>
            <div className="font-mono">@{user.username} · {user.role}</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col z-10 p-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <span className="text-base font-bold text-slate-900">Smart-Sender</span>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-3 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      navigateTab(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {renderNavBadge(item.key)}
                  </button>
                );
              })}
            </nav>
            <button
              onClick={handleLogout}
              className="mt-2 px-3 py-2.5 text-sm text-red-700 bg-red-50 rounded-lg flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pr-64 flex flex-col min-h-screen">
        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              aria-label="فتح القائمة"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-semibold text-slate-800">
              Smart-Sender <span className="text-slate-400 mx-1">/</span> {currentNav.label}
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            {isOwner && (
              <button
                onClick={() => navigateTab('chat')}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span className={`w-2 h-2 rounded-full ${waDotClass}`} />
                <span>الدردشة المباشرة</span>
                {unreadDirect > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold tabular-nums">
                    {unreadDirect}
                  </span>
                )}
              </button>
            )}

            <span className="hidden sm:flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${waDotClass}`} />
              <span>
                الجهاز المرتبط: <strong>{waReady ? 'متصل' : 'غير متصل'}</strong>
              </span>
            </span>

            <button
              onClick={() => navigateTab('whatsapp')}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              ربط QR
            </button>
          </div>
        </header>

        {/* Linked Device Persistent Banner for Owner */}
        {isOwner && linkedBotPhone && (
          <div className="bg-emerald-50/80 border-b border-emerald-200 px-4 sm:px-6 py-2 text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
            <div>
              البوت يعمل عبر رقم الجهاز المرتبط:{' '}
              <span className="font-mono font-bold mx-1" dir="ltr">
                {linkedBotPhone}
              </span>{' '}
              — اطلب من المصرح لهم حفظ هذا الرقم وإرسال رسالة له
            </div>
            <span className={`font-bold ${waReady ? 'text-emerald-700' : 'text-red-600'}`}>
              {waReady ? 'متصل' : 'غير متصل'}
            </span>
          </div>
        )}

        {/* Toast Alert */}
        {toast && (
          <div className="px-4 sm:px-6 pt-4">
            <div
              className={`p-3 rounded-lg border text-sm font-medium ${
                toast.isError
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              {toast.text}
            </div>
          </div>
        )}

        {/* Active View */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'overview' && (
            <OverviewTab
              stats={stats}
              loading={loadingStats}
              onRefresh={() => void fetchStats()}
              onNavigate={(t) => navigateTab(t as TabKey)}
            />
          )}
          {activeTab === 'whatsapp' && (
            <WhatsAppTab
              currentUser={user}
              state={stats?.whatsapp || null}
              onRefresh={() => void fetchStats()}
              onNotify={notify}
            />
          )}
          {activeTab === 'contacts' && (
            <ContactsTab
              currentUser={user}
              onOpenChat={(phone) => {
                setSelectedChatPhone(phone);
                navigateTab('chat');
              }}
              onRefreshStats={() => void fetchStats()}
              onNotify={notify}
            />
          )}
          {activeTab === 'chat' && (
            <DirectChatTab
              currentUser={user}
              initialPhone={selectedChatPhone}
              onNavigateTab={(t) => navigateTab(t as TabKey)}
              onRefreshStats={() => void fetchStats()}
              onNotify={notify}
            />
          )}
          {(activeTab === 'files' || activeTab === 'folders') && (
            <FilesFoldersTab mode={activeTab} onNotify={notify} />
          )}
          {activeTab === 'tasks' && <TasksTab onNotify={notify} />}
          {(activeTab === 'groups' || activeTab === 'logs' || activeTab === 'errors') && (
            <GroupsLogsTab mode={activeTab} onNotify={notify} />
          )}
          {activeTab === 'ai' && <AiTesterTab onNotify={notify} />}
          {(activeTab === 'users' || activeTab === 'settings') && (
            <UsersSettingsTab mode={activeTab} currentUser={user} onNotify={notify} />
          )}
        </main>

        {/* Mandatory Author Footer */}
        <footer className="border-t border-slate-200 bg-white px-6 py-4 text-center text-xs text-slate-500">
          Made by Mohammed Asim
        </footer>
      </div>
    </div>
  );
}
