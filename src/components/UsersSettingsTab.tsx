import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Trash2, Save, Database, Download, RotateCcw } from 'lucide-react';
import { apiRequest, buildBackupDownloadUrl, formatArabicDate, formatBytes } from '../lib/api.ts';
import type { AuthUser, BackupItem, SettingItem, WhatsAppRole, WhatsAppUserItem } from '../types.ts';

interface UsersSettingsTabProps {
  mode: 'users' | 'settings';
  currentUser: AuthUser;
  onNotify: (msg: string, isError?: boolean) => void;
}

const WA_ROLE_AR: Record<WhatsAppRole, string> = {
  owner: 'مالك النظام (Owner)',
  admin: 'مدير (Admin)',
  authorized: 'مستخدم مصرح له',
  unauthorized: 'غير مصرح له',
};

export const UsersSettingsTab: React.FC<UsersSettingsTabProps> = ({
  mode,
  currentUser,
  onNotify,
}) => {
  const [waUsers, setWaUsers] = useState<WhatsAppUserItem[]>([]);
  const [dashUsers, setDashUsers] = useState<AuthUser[]>([]);
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [backups, setBackups] = useState<BackupItem[]>([]);

  // New WA user form
  const [waPhone, setWaPhone] = useState('');
  const [waName, setWaName] = useState('');
  const [waAlias, setWaAlias] = useState('');
  const [waRole, setWaRole] = useState<WhatsAppRole>('authorized');

  // New Dashboard user form
  const [dashUsername, setDashUsername] = useState('');
  const [dashFullName, setDashFullName] = useState('');
  const [dashPassword, setDashPassword] = useState('');
  const [dashRole, setDashRole] = useState<'admin' | 'viewer'>('admin');

  const isOwner = currentUser.role === 'owner';

  const loadData = useCallback(async () => {
    try {
      if (mode === 'users') {
        const res = await apiRequest<{ whatsappUsers: WhatsAppUserItem[]; dashboardUsers: AuthUser[] }>('/api/users');
        setWaUsers(res.whatsappUsers);
        setDashUsers(res.dashboardUsers);
      } else {
        const [setRes, bkpRes] = await Promise.all([
          apiRequest<{ settings: SettingItem[] }>('/api/settings'),
          apiRequest<{ backups: BackupItem[] }>('/api/backups').catch(() => ({ backups: [] })),
        ]);
        setSettings(setRes.settings);
        const drafts: Record<string, string> = {};
        for (const s of setRes.settings) drafts[s.key] = s.value;
        setSettingDrafts(drafts);
        setBackups(bkpRes.backups);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر تحميل البيانات', true);
    }
  }, [mode, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddWaUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/users/whatsapp', {
        method: 'POST',
        body: JSON.stringify({ phone: waPhone, displayName: waName, alias: waAlias, role: waRole }),
      });
      setWaPhone('');
      setWaName('');
      setWaAlias('');
      onNotify('تم حفظ مستخدم واتساب وصلاحياته بنجاح');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل الإضافة', true);
    }
  };

  const handleDeleteWaUser = async (id: string) => {
    try {
      await apiRequest(`/api/users/whatsapp/${id}`, { method: 'DELETE' });
      onNotify('تم حذف المستخدم');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر الحذف', true);
    }
  };

  const handleAddDashUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/users/dashboard', {
        method: 'POST',
        body: JSON.stringify({
          username: dashUsername,
          fullName: dashFullName,
          password: dashPassword,
          role: dashRole,
        }),
      });
      setDashUsername('');
      setDashFullName('');
      setDashPassword('');
      onNotify('تم إنشاء حساب لوحة التحكم');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر إنشاء الحساب', true);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: settingDrafts }),
      });
      onNotify('تم حفظ الإعدادات بنجاح');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات', true);
    }
  };

  const handleCreateBackup = async () => {
    try {
      await apiRequest('/api/backups', { method: 'POST' });
      onNotify('تم إنشاء نسخة احتياطية جديدة لقاعدة البيانات');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشل النسخ الاحتياطي', true);
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    try {
      await apiRequest('/api/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ filename }),
      });
      onNotify('تمت استعادة قاعدة البيانات بنجاح');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'فشلت الاستعادة', true);
    }
  };

  if (mode === 'users') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">المستخدمون والصلاحيات (RBAC)</h2>
          <p className="text-sm text-slate-500 mt-1">
            التحقق عبر رقم واتساب الفعلي بصيغة دولية لمنع غير المصرح لهم من التحكم في البوت
          </p>
        </div>

        {isOwner && (
          <form onSubmit={handleAddWaUser} className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">رقم واتساب الدولي</label>
              <input
                type="text"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                placeholder="+249912345678"
                required
                dir="ltr"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">الاسم</label>
              <input
                type="text"
                value={waName}
                onChange={(e) => setWaName(e.target.value)}
                placeholder="الاسم التعريفي"
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">الاسم المستعار</label>
              <input
                type="text"
                value={waAlias}
                onChange={(e) => setWaAlias(e.target.value)}
                placeholder="اختياري"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">الصلاحية</label>
              <select
                value={waRole}
                onChange={(e) => setWaRole(e.target.value as WhatsAppRole)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="authorized">مستخدم مصرح له</option>
                <option value="admin">مدير (Admin)</option>
                <option value="unauthorized">محظور / غير مصرح له</option>
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>إضافة / تحديث</span>
            </button>
          </form>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 text-sm font-bold text-slate-900">
            أرقام واتساب المسجلة
          </div>
          <div className="divide-y divide-slate-100">
            {waUsers.map((u) => (
              <div key={u.id} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        u.role === 'unauthorized' || u.is_active !== 1
                          ? 'bg-red-500'
                          : u.connection_state === 'active'
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                      }`}
                    />
                    <span className="text-sm font-semibold text-slate-900">
                      {u.alias ? `${u.alias} (${u.display_name})` : u.display_name}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5" dir="ltr">
                    {u.phone_e164}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-semibold text-slate-700">{WA_ROLE_AR[u.role]}</span>
                  {isOwner && u.role !== 'owner' && (
                    <button
                      onClick={() => handleDeleteWaUser(u.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard Accounts */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="text-sm font-bold text-slate-900">حسابات الدخول للوحة التحكم ويب / APK</div>
          {isOwner && (
            <form onSubmit={handleAddDashUser} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end pb-4 border-b border-slate-100">
              <input
                type="text"
                value={dashUsername}
                onChange={(e) => setDashUsername(e.target.value)}
                placeholder="اسم المستخدم"
                required
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                value={dashFullName}
                onChange={(e) => setDashFullName(e.target.value)}
                placeholder="الاسم الكامل"
                required
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="password"
                value={dashPassword}
                onChange={(e) => setDashPassword(e.target.value)}
                placeholder="كلمة المرور"
                required
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <div className="flex gap-2">
                <select
                  value={dashRole}
                  onChange={(e) => setDashRole(e.target.value as 'admin' | 'viewer')}
                  className="px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white flex-1"
                >
                  <option value="admin">مدير</option>
                  <option value="viewer">مشاهد فقط</option>
                </select>
                <button
                  type="submit"
                  className="px-3 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  إضافة
                </button>
              </div>
            </form>
          )}
          <div className="divide-y divide-slate-100">
            {dashUsers.map((du) => (
              <div key={du.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <span className="font-semibold text-slate-900">{du.full_name}</span>
                  <span className="text-xs text-slate-500 font-mono mr-2">@{du.username}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-600">{du.role}</span>
                  {isOwner && du.role !== 'owner' && (
                    <button
                      onClick={async () => {
                        await apiRequest(`/api/users/dashboard/${du.id}`, { method: 'DELETE' });
                        onNotify('تم حذف الحساب');
                        await loadData();
                      }}
                      className="text-red-600 hover:bg-red-50 p-1 rounded cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">الإعدادات والنسخ الاحتياطي</h2>
        <p className="text-sm text-slate-500 mt-1">
          تعديل إعدادات التشغيل والجدولة دون تعديل الكود (المفاتيح السرية محفوظة في الخادم فقط)
        </p>
      </div>

      <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {settings.map((s) => (
            <div key={s.key}>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {s.description || s.key} <span className="font-mono text-slate-400">({s.key})</span>
              </label>
              {s.key === 'gemini_model' ? (
                <select
                  value={settingDrafts[s.key] || 'gemini-4-hydrogen'}
                  onChange={(e) => setSettingDrafts((p) => ({ ...p, [s.key]: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-mono"
                >
                  <option value="gemini-4-hydrogen">gemini-4-hydrogen (الافتراضي الموصى به)</option>
                  <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (خفيف وسريع)</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={settingDrafts[s.key] ?? ''}
                  onChange={(e) => setSettingDrafts((p) => ({ ...p, [s.key]: e.target.value }))}
                  dir="ltr"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                />
              )}
            </div>
          ))}
        </div>
        <div className="pt-3 border-t border-slate-100 flex justify-end">
          <button
            type="submit"
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>حفظ الإعدادات</span>
          </button>
        </div>
      </form>

      {/* Database Backups */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-slate-700" />
            <div>
              <h3 className="text-base font-bold text-slate-900">النسخ الاحتياطي والاستعادة لقاعدة البيانات</h3>
              <p className="text-xs text-slate-500">نسخ فوري آمن أثناء التشغيل عبر SQLite Backup API</p>
            </div>
          </div>
          <button
            onClick={handleCreateBackup}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg cursor-pointer"
          >
            إنشاء نسخة احتياطية الآن
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {backups.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">لا توجد نسخ احتياطية محفوظة بعد.</p>
          ) : (
            backups.map((b) => (
              <div key={b.filename} className="py-3 flex flex-wrap items-center justify-between gap-4 text-sm">
                <div>
                  <div className="font-mono text-xs text-slate-900">{b.filename}</div>
                  <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                    {formatBytes(b.sizeBytes)} · {formatArabicDate(b.createdAt)}
                  </div>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-3">
                    <a
                      href={buildBackupDownloadUrl(b.filename)}
                      className="text-xs text-slate-700 hover:text-slate-900 flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تحميل</span>
                    </a>
                    <button
                      onClick={() => handleRestoreBackup(b.filename)}
                      className="text-xs text-amber-700 hover:text-amber-800 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>استعادة</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
