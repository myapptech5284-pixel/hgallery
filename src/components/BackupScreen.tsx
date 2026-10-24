import React, { useState, useEffect } from 'react';
import { User, AuditLog } from '../types.ts';
import { api } from '../services/api.ts';
import {
  HardDrive,
  Download,
  Upload,
  RefreshCcw,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  History,
  Lock,
  FileCheck,
  Server,
  Calendar,
  FolderInput,
  Play,
} from 'lucide-react';

interface BackupScreenProps {
  currentUser: User;
  onSystemResetSuccess: () => void;
}

export const BackupScreen: React.FC<BackupScreenProps> = ({ currentUser, onSystemResetSuccess }) => {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  // Daily auto backup state
  const [backupFolder, setBackupFolder] = useState<string>('');
  const [lastBackup, setLastBackup] = useState<{ timestamp: string; copiedFiles: number; totalBytes: number } | null>(null);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string>('');

  // Status message
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Restore state
  const [isRestoring, setIsRestoring] = useState(false);

  // Reset System State
  const [showResetModal, setShowResetModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const logs = await api.getAuditLogs(100);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  // ---- Daily auto backup ----
  // Load target folder from localStorage and read last-backup.json
  useEffect(() => {
    const target = localStorage.getItem('hawr_backup_folder_v2') || '';
    setBackupFolder(target);
    if (target) refreshLastBackup(target);
  }, []);

  const refreshLastBackup = async (target: string) => {
    const api: any = (window as any).hawr;
    if (!api || typeof api.getLastBackup !== 'function') return;
    const r = await api.getLastBackup(target);
    if (r && r.ok && r.hasBackup) {
      setLastBackup({ timestamp: r.timestamp, copiedFiles: r.copiedFiles, totalBytes: r.totalBytes });
    } else {
      setLastBackup(null);
    }
  };

  const handleSelectBackupFolder = async () => {
    const api: any = (window as any).hawr;
    if (!api || typeof api.selectBackupFolder !== 'function') {
      setBackupMessage('⚠ ميزة اختيار المجلد تتطلب تشغيل التطبيق كـ Setup.exe');
      return;
    }
    const r = await api.selectBackupFolder();
    if (r && r.ok) {
      setBackupFolder(r.path);
      try { localStorage.setItem('hawr_backup_folder_v2', r.path); } catch (_) { /* ignore */ }
      await api.saveBackupTarget(r.path);
      setBackupMessage('✓ تم اختيار المجلد: ' + r.path);
      // Run backup immediately
      await handleRunBackup();
    } else if (r && r.canceled) {
      setBackupMessage('تم الإلغاء');
    } else {
      setBackupMessage('فشل: ' + (r?.error || 'خطأ غير معروف'));
    }
  };

  const handleRunBackup = async () => {
    if (!backupFolder) { setBackupMessage('⚠ اختر مكان الحفظ أولاً'); return; }
    const api: any = (window as any).hawr;
    if (!api || typeof api.runBackup !== 'function') {
      setBackupMessage('⚠ هذه الميزة تعمل داخل Setup.exe فقط');
      return;
    }
    setBackupRunning(true);
    setBackupMessage('جاري النسخ الاحتياطي (يستبدل النسخة القديمة)...');
    try {
      const r = await api.runBackup({ path: backupFolder });
      if (r && r.ok) {
        setLastBackup({ timestamp: r.timestamp, copiedFiles: r.copiedFiles, totalBytes: r.totalBytes });
        setBackupMessage(`✓ تم بنجاح: ${r.copiedFiles} ملف (${(r.totalBytes / 1024).toFixed(1)} KB) — استبدل النسخة القديمة`);
      } else {
        setBackupMessage('فشل: ' + (r?.error || 'خطأ غير معروف'));
      }
    } catch (e: any) {
      setBackupMessage('فشل: ' + String(e?.message || e));
    } finally {
      setBackupRunning(false);
    }
  };

  const handleOpenBackupFolder = () => {
    if (!backupFolder) return;
    (window as any).hawr?.openBackupFolder?.(backupFolder);
  };

  // 1. Manual Backup Download — opens a Save-As dialog so the user picks
  //    the destination folder + filename for the .db file.
  const handleDownloadBackup = async () => {
    const api: any = (window as any).hawr;
    if (!api || typeof api.downloadSqliteBackup !== 'function') {
      setStatusMessage({
        type: 'error',
        text: 'هذه الميزة تعمل داخل Setup.exe فقط (وليس في المتصفح)',
      });
      return;
    }
    setStatusMessage({ type: 'info', text: '⏳ جاري فتح نافذة اختيار مكان الحفظ...' });
    const r = await api.downloadSqliteBackup();
    if (r && r.ok) {
      setStatusMessage({
        type: 'success',
        text: `✓ تم حفظ النسخة بنجاح: ${r.path} (${(r.size / 1024).toFixed(1)} KB)`,
      });
      setLastDownloadPath(r.path);
      try { localStorage.setItem('hawr_last_sqlite_download', r.path); } catch (_) { /* ignore */ }
    } else if (r && r.canceled) {
      setStatusMessage({ type: 'info', text: 'تم الإلغاء' });
    } else {
      setStatusMessage({ type: 'error', text: 'فشل التحميل: ' + (r?.error || 'خطأ غير معروف') });
    }
    loadLogs();
  };

  // 1b. Reveal the last downloaded .db in Windows Explorer
  const [lastDownloadPath, setLastDownloadPath] = useState<string>('');
  useEffect(() => {
    try { setLastDownloadPath(localStorage.getItem('hawr_last_sqlite_download') || ''); } catch (_) { /* ignore */ }
  }, []);
  const handleOpenDownload = () => {
    if (!lastDownloadPath) return;
    (window as any).hawr?.revealInFolder?.(lastDownloadPath);
  };

  // 2. Verified Restore
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm('تحذير: استعادة النسخة الاحتياطية ستستبدل البيانات الحالية بعد فحص التوقيع والسلامة الهيكلية. سيتم أخذ نسخة أمان تلقائية قبل التبديل. هل ترغب بالاستمرار؟')) {
      e.target.value = '';
      return;
    }

    setIsRestoring(true);
    setStatusMessage(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const b64 = (evt.target?.result as string).split(',')[1];
        const res = await api.restoreDatabase({
          fileBase64: b64,
          userId: currentUser.id,
          userName: currentUser.name,
        });

        if (res.success) {
          setStatusMessage({
            type: 'success',
            text: res.message || 'تم فحص توقيع SQLite والتكامل الهيكلي واستعادة قاعدة البيانات بنجاح تام',
          });
          loadLogs();
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          setStatusMessage({
            type: 'error',
            text: res.error || 'فشلت استعادة قاعدة البيانات: الملف غير صالح أو فشل اختبار PRAGMA integrity_check',
          });
        }
      } catch (err: any) {
        setStatusMessage({
          type: 'error',
          text: err.message || 'حدث خطأ أثناء قراءة ملف النسخة الاحتياطية',
        });
      } finally {
        setIsRestoring(false);
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  // 3. Secure System Reset
  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    if (!adminPassword.trim()) {
      setResetError('كلمة مرور المدير مطلوبة لتأكيد هذا الإجراء الحساس');
      return;
    }

    setResetting(true);
    try {
      const res = await api.resetSystem({
        adminPassword: adminPassword.trim(),
        userId: currentUser.id,
        userName: currentUser.name,
      });

      if (res.success) {
        setShowResetModal(false);
        alert('تم أخذ نسخة أمان تلقائية وإعادة ضبط النظام بنجاح. سيتم توجيهك الآن لشاشة التهيئة الأولى.');
        onSystemResetSuccess();
      } else {
        setResetError(res.error || 'فشلت عملية إعادة ضبط النظام');
      }
    } catch (err: any) {
      setResetError(err.message || 'فشل الاتصال بالخادم');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Top Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-indigo-600" />
          <span>النسخ الاحتياطي والصيانة والتدقيق الأمني</span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          إدارة نسخ قاعدة بيانات SQLite وفحص السلامة الهيكلية ومعالجة أخطاء القفل وسجل تدقيق العمليات الحساسة
        </p>
      </div>

      {/* 🗄 Auto-backup section — every 60 seconds */}
      <div className="mb-6 bg-gradient-to-l from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-5 h-5 text-amber-700" />
          <h2 className="text-base font-bold text-amber-900">النسخ الاحتياطي التلقائي كل دقيقة</h2>
          <span className="text-[10px] bg-amber-600 text-white px-2 py-0.5 rounded font-bold">يعمل تلقائياً</span>
        </div>
        <p className="text-[11px] text-amber-800 mb-4">
          ينسخ البرنامج قاعدة البيانات تلقائياً <b>كل 60 ثانية</b> إلى مجلد مستقل باسم وقت النسخ.
          النسخة القديمة <b>لا تُحذف إلا بعد مرور 20 دقيقة</b> عليها، فتحتفظ دائماً بآخر 20 نسخة
          متتابعة (نسخة كل دقيقة) لتسترجع أي لحظة خلال آخر 20 دقيقة.
          <br />
          أما النسخ التي تأخذها يدوياً من زر «احفظ الآن» فلا تُحذف أبداً.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-amber-700 mb-1">مكان الحفظ على الجهاز</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={backupFolder}
                placeholder="لم تختر مكاناً بعد — اضغط الزر المجاور"
                className="flex-1 px-3 py-2 bg-white border border-amber-300 rounded-lg text-sm text-slate-700"
              />
              <button
                type="button"
                onClick={handleSelectBackupFolder}
                className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
              >
                <FolderInput className="w-3.5 h-3.5" />
                اختر مكان
              </button>
            </div>
            {backupFolder && (
              <button
                type="button"
                onClick={handleOpenBackupFolder}
                className="mt-1 text-[10px] text-amber-700 hover:text-amber-900 font-bold"
              >
                📂 افتح المجلد في Windows
              </button>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold text-amber-700 mb-1">الإجراء اليدوي</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRunBackup}
                disabled={backupRunning || !backupFolder}
                className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 disabled:bg-slate-300"
              >
                <Play className="w-3.5 h-3.5" />
                {backupRunning ? 'جاري النسخ...' : 'نسخة احتياطية الآن'}
              </button>
              <button
                type="button"
                onClick={() => backupFolder && refreshLastBackup(backupFolder)}
                disabled={!backupFolder}
                className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold disabled:opacity-40"
                title="تحديث معلومات آخر نسخة"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-1 text-[10px] text-amber-700">
              {lastBackup
                ? `آخر نسخة: ${new Date(lastBackup.timestamp).toLocaleString('ar-EG')} (${lastBackup.copiedFiles} ملف، ${(lastBackup.totalBytes / 1024).toFixed(1)} KB)`
                : '— لم تنسخ أي نسخة بعد —'}
            </div>
          </div>
        </div>

        {backupMessage && (
          <div className="mt-3 text-[11px] px-3 py-2 bg-white border border-amber-200 rounded-lg text-slate-700">
            {backupMessage}
          </div>
        )}

        <div className="mt-3 text-[10px] text-amber-700 bg-amber-100/60 rounded p-2">
          <b>كيف يعمل النسخ التلقائي:</b>
          <ol className="list-decimal pr-5 mt-1 space-y-0.5">
            <li>افتح التطبيق → يتحقق من آخر نسخة (في `last-backup.json` داخل مجلد النسخ)</li>
            <li>لو مرت 24 ساعة أو لا توجد نسخة → ينسخ تلقائياً بصمت</li>
            <li>كل نسخة جديدة تمسح محتوى `hawr-latest-backup/` القديم وتنسخ محلها</li>
            <li>ما في ملفات قديمة تتراكم — دائماً آخر بيانات فقط</li>
          </ol>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`mb-6 p-4 rounded-2xl text-xs font-semibold flex items-center justify-between border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : statusMessage.type === 'info'
                ? 'bg-sky-50 border-sky-200 text-sky-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="font-bold text-base px-2">×</button>
        </div>
      )}

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {/* Backup Download */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-sm text-slate-800 mb-1">نسخ احتياطي يدوي فوري</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              تحميل نسخة كاملة ومحدثة من قاعدة بيانات SQLite تشمل المنتجات، المبيعات، الأقساط، والمصروفات.
            </p>
          </div>

          <button
            onClick={handleDownloadBackup}
            className="mt-4 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>تحميل نسخة SQLite (اختر مكان الحفظ)</span>
          </button>
          {lastDownloadPath && (
            <div className="mt-2 text-[10px] text-slate-500 truncate flex items-center gap-1">
              <span title={lastDownloadPath}>آخر تحميل: {lastDownloadPath.split(/[\\/]/).pop()}</span>
              <button type="button" onClick={handleOpenDownload}
                className="text-emerald-700 hover:text-emerald-900 font-bold underline">
                افتح في المجلد
              </button>
            </div>
          )}
        </div>

        {/* Restore Database with Verification */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
              <FileCheck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-sm text-slate-800 mb-1">استعادة قاعدة بيانات مفحوصة</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              يتم فحص ترويسة SQLite (SQLite format 3)، واختبار التكامل الهيكلي PRAGMA integrity_check، وأخذ نسخة أمان قبل الاستبدال.
            </p>
          </div>

          <label className="mt-4 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-colors text-center">
            <Upload className="w-4 h-4" />
            <span>{isRestoring ? 'جاري الفحص والاستعادة...' : 'استعادة وفحص ملف نسخة'}</span>
            <input
              type="file"
              accept=".sqlite, .db"
              disabled={isRestoring}
              onChange={handleRestoreFile}
              className="hidden"
            />
          </label>
        </div>

        {/* Reset System */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-sm text-slate-800 mb-1">إعادة ضبط النظام</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              تصفير كافة الجداول لبدء سنة مالية جديدة. يتطلب كلمة مرور المدير ويقوم بحفظ نسخة أمان تلقائياً أولاً.
            </p>
          </div>

          <button
            onClick={() => setShowResetModal(true)}
            className="mt-4 w-full py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <RefreshCcw className="w-4 h-4 text-rose-600" />
            <span>بدء إجراء إعادة الضبط</span>
          </button>
        </div>
      </div>

      {/* Windows EXE Installer Guide Banner */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-xl border border-slate-800 mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold mb-1">
            <Server className="w-4 h-4" />
            <span>جاهزية مثبت Windows EXE المستقل</span>
          </div>
          <h3 className="font-bold text-sm">وضع التحديث (الحفاظ على البيانات) مقابل التثبيت النظيف</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            قاعدة بيانات النظام تعمل بمحرك SQLite الداخلي الآمن (In-Memory + Atomic Flush) لمنع أخطاء قفل ملفات الـ WAL تماماً، ويتم حفظ ملف البيانات في المسار المحلي مع حماية ملفات النسخ من الحذف عند التحديث.
          </p>
        </div>
        <div className="text-xs bg-slate-800 px-3 py-2 rounded-xl border border-slate-700 font-mono text-slate-300">
          hawr-gallery.sqlite
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-xs text-slate-800">سجل تدقيق العمليات الحساسة والأمان (Audit Log)</h3>
          </div>
          <button
            onClick={loadLogs}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
          >
            تحديث السجل
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">التاريخ والوقت</th>
                <th className="p-3">نوع الإجراء</th>
                <th className="p-3">التفاصيل والبيان</th>
                <th className="p-3">المستخدم المسؤول</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingLogs ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">
                    جاري تحميل سجل الأمان...
                  </td>
                </tr>
              ) : auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">
                    لا توجد سجلات مسجلة
                  </td>
                </tr>
              ) : (
                auditLogs.map((log, idx) => (
                  <tr key={log.id || idx} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-3 text-slate-400 font-mono">{idx + 1}</td>
                    <td className="p-3 font-mono text-slate-500 text-[11px]">
                      {new Date(log.timestamp).toLocaleString('ar-EG')}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono text-[10px] font-bold">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-3 text-slate-700 font-medium">{log.details}</td>
                    <td className="p-3 font-bold text-slate-800">{log.userName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <ShieldAlert className="w-6 h-6" />
              <h2 className="text-base font-bold text-slate-900">تأكيد إعادة ضبط النظام بالكامل</h2>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              سيتم تفريغ فواتير المبيعات، المخزون، الأقساط، والمصروفات. سيقوم النظام بحفظ نسخة أمان احتياطية تلقائياً قبل البدء. هذا الإجراء غير قابل للتراجع.
            </p>

            {resetError && (
              <div className="mb-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                {resetError}
              </div>
            )}

            <form onSubmit={handleExecuteReset} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  أدخل كلمة مرور حساب المدير العام للتأكيد *
                </label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-rose-500 pr-9"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-300 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  {resetting ? 'جاري الحفظ وإعادة الضبط...' : 'تأكيد وإعادة الضبط'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
