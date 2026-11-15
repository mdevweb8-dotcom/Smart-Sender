import React, { useState } from 'react';
import { Lock, User, ArrowLeft } from 'lucide-react';
import { apiRequest, setStoredSession } from '../lib/api.ts';
import type { AuthUser } from '../types.ts';

interface LoginScreenProps {
  onSuccess: (user: AuthUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setStoredSession(res.token, res.user);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-6">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8">
          <div className="flex items-center gap-4 mb-6">
            {!imgFailed ? (
              <img
                src="/src/assets/images/smart_sender_avatar_1794637773593.jpg"
                alt="شعار Smart-Sender"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center font-bold text-lg shrink-0">
                SS
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-slate-900">Smart-Sender</h1>
              <p className="text-sm text-slate-500 mt-0.5">لوحة إدارة مساعد واتساب الذكي</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-sm font-medium text-slate-700 mb-1.5">
                اسم المستخدم
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  className="w-full pr-10 pl-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                  placeholder="admin"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full pr-10 pl-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                  placeholder="أدخل كلمة المرور"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{loading ? 'جاري التحقق...' : 'دخول إلى لوحة التحكم'}</span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          </form>

          <p className="mt-5 text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-4">
            الإعداد الافتراضي الأولي: المستخدم <span className="font-mono text-slate-700">admin</span> وكلمة المرور المضبوطة في متغير <span className="font-mono text-slate-700">DASHBOARD_ADMIN_PASS</span>.
          </p>
        </div>
      </div>

      <footer className="text-center text-xs text-slate-500 py-3">
        Made by Mohammed Asim
      </footer>
    </div>
  );
};
