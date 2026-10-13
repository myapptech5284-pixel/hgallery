import React, { useState } from 'react';
import { User } from '../types.ts';
import { api } from '../services/api.ts';
import { ShieldCheck, UserPlus, LogIn, Lock, User as UserIcon, Hash, Store } from 'lucide-react';

interface AuthScreenProps {
  isInitialized: boolean;
  onLoginSuccess: (user: User) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ isInitialized, onLoginSuccess }) => {
  const [isRegisterMode, setIsRegisterMode] = useState(!isInitialized);

  // Form states
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegisterAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !username.trim() || !password.trim() || !employeeCode.trim()) {
      setError('جميع البيانات مطلوبة لتهيئة حساب المدير');
      return;
    }

    setLoading(true);
    try {
      const res = await api.registerAdmin({
        name: name.trim(),
        username: username.trim(),
        password: password.trim(),
        employeeCode: employeeCode.trim(),
      });

      if (res.success && res.user) {
        onLoginSuccess(res.user);
      } else {
        setError(res.error || 'حدث خطأ أثناء إنشاء حساب المدير');
      }
    } catch (err: any) {
      setError(err.message || 'تعذر الاتصال بقاعدة البيانات المحلية');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    setLoading(true);
    try {
      const res = await api.login({
        username: username.trim(),
        password: password.trim(),
      });

      if (res.success && res.user) {
        onLoginSuccess(res.user);
      } else {
        setError(res.error || 'فشل تسجيل الدخول: تحقق من بياناتك');
      }
    } catch (err: any) {
      setError(err.message || 'تعذر الاتصال بقاعدة البيانات المحلية');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center p-4 relative overflow-hidden font-sans text-slate-800" dir="rtl">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8 relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 mb-3 shadow-xs">
            <Store className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">نظام إدارة معرض حور</h1>
          <p className="text-xs text-slate-500 mt-1">
            إدارة المعرض والمكتبة والمخزون ونقاط البيع المستقلة
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isRegisterMode ? (
          <div>
            <div className="mb-6 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0" />
              <span>تثبيت نظيف لأول مرة: يرجى إعداد حساب المدير العام المسؤول عن النظام.</span>
            </div>

            <form onSubmit={handleRegisterAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">الاسم الكامل للمدير</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: د. محمد سليمان"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all pl-10"
                  />
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم المستخدم (Username فريد)</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all pl-10"
                  />
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">كود المدير (كود تعريفي فريد)</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    placeholder="ADM-001"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all pl-10"
                  />
                  <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">كلمة المرور (مشفرة بـ PBKDF2/Salt)</label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all pl-10"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>{loading ? 'جاري تهيئة قاعدة البيانات...' : 'إنشاء حساب المدير وبدء التشغيل'}</span>
              </button>
            </form>
          </div>
        ) : (
          <div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم المستخدم (Username)</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="اسم المستخدم أو كود الموظف"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all pl-10"
                  />
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">كلمة المرور</label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all pl-10"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>{loading ? 'جاري التحقق...' : 'تسجيل الدخول للنظام'}</span>
              </button>
            </form>
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span>نظام محلي متكامل (Offline SQLite)</span>
          <span>الإصدار 2.4.0 (Windows EXE)</span>
        </div>
      </div>
    </div>
  );
};
