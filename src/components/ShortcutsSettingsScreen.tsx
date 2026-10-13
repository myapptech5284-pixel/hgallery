import React, { useState, useEffect, useMemo } from 'react';
import { Keyboard, Plus, Trash2, RotateCcw, AlertCircle } from 'lucide-react';
import {
  getAllBindings,
  saveBindings,
  resetBindingsToDefaults,
  type ShortcutBinding,
  type ShortcutAction,
  DEFAULT_BINDINGS,
} from '../services/shortcutsStore';

/**
 * Shortcuts settings
 * -------------------
 * In-app screen for editing the user's keyboard-shortcut mappings. Each
 * row binds a logical action ("focusSearch", "saveForm", ...) to a
 * specific key + modifier combo. The keys are stored in localStorage and
 * consumed by the global handler in App.tsx.
 *
 * Defaults come pre-populated with both the Latin letter (Alt+S) AND
 * its Arabic counterpart (Alt+س) so the program works out of the box
 * on any keyboard layout the operator happens to be using.
 */
export const ShortcutsSettingsScreen: React.FC = () => {
  const [bindings, setBindings] = useState<ShortcutBinding[]>([]);
  const [recording, setRecording] = useState<string | null>(null); // id of the row currently capturing
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Load on mount.
  useEffect(() => {
    setBindings(getAllBindings());
  }, []);

  // While the user is recording, listen for the next keydown anywhere
  // and capture it into the binding being recorded.
  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore the trigger click itself.
      e.preventDefault();
      e.stopPropagation();
      // Cancel on Escape.
      if (e.key === 'Escape') {
        setRecording(null);
        setCaptureError(null);
        return;
      }
      // Tab/Shift+Tab navigation keys should not be captured.
      if (e.key === 'Tab') {
        setCaptureError('لا يمكن استخدام مفتاح Tab كاختصار — اختر مفتاحاً آخر');
        return;
      }
      // Block empty / useless keys.
      if (!e.key || e.key.length === 0) {
        setCaptureError('مفتاح غير صالح');
        return;
      }
      // Accept and store.
      const updated = bindings.map((b) =>
        b.id === recording
          ? { ...b, key: e.key, alt: !!e.altKey, ctrl: !!e.ctrlKey, meta: !!e.metaKey, shift: !!e.shiftKey }
          : b
      );
      setBindings(updated);
      saveBindings(updated);
      setRecording(null);
      setCaptureError(null);
    };
    // Capture phase + every target so we always see the keydown,
    // regardless of which element has focus.
    window.addEventListener('keydown', handler, true);
    document.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      document.removeEventListener('keydown', handler, true);
    };
  }, [recording, bindings]);

  const grouped = useMemo(() => {
    const m = new Map<ShortcutAction, ShortcutBinding[]>();
    for (const b of bindings) {
      if (!m.has(b.action)) m.set(b.action, []);
      m.get(b.action)!.push(b);
    }
    return Array.from(m.entries());
  }, [bindings]);

  const handleReset = () => {
    if (!confirm('إعادة تعيين كل الاختصارات إلى القيم الافتراضية؟')) return;
    const def = resetBindingsToDefaults();
    setBindings(def);
  };

  const handleAddBinding = (action: ShortcutAction) => {
    const newBinding: ShortcutBinding = {
      id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      action,
      label: '',
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
      key: '',
    };
    setBindings([...bindings, newBinding]);
    saveBindings([...bindings, newBinding]);
    setRecording(newBinding.id);
  };

  const handleDelete = (id: string) => {
    if (!confirm('حذف هذا الاختصار؟')) return;
    const updated = bindings.filter((b) => b.id !== id);
    setBindings(updated);
    saveBindings(updated);
  };

  const formatMod = (b: ShortcutBinding): string => {
    const parts: string[] = [];
    if (b.ctrl) parts.push('Ctrl');
    if (b.meta) parts.push('Meta');
    if (b.alt) parts.push('Alt');
    if (b.shift) parts.push('Shift');
    parts.push(formatKey(b.key));
    return parts.join('+');
  };

  const formatKey = (k: string): string => {
    if (!k) return '—';
    if (k === ' ') return 'Space';
    if (k.length === 1) return k.toUpperCase();
    return k;
  };

  // A map from action → default label so the user can see what each
  // action does. Matches DEFAULT_BINDINGS but kept inline here so the
  // screen doesn't depend on labels in the JSON.
  const ACTION_LABEL: Record<ShortcutAction, string> = {
    focusSearch: 'فوكس على البحث',
    saveForm: 'حفظ النموذج / إتمام البيع',
    openAddProduct: 'فتح شاشة إضافة منتج',
    addItem: 'إضافة جديدة (Ctrl+N)',
    posComplete: 'إتمام البيع (Ctrl+S — POS فقط)',
    posSuspend: 'تعليق الفاتورة (Ctrl+W — POS)',
    print: 'طباعة (Ctrl+P)',
    closeReceipt: 'إغلاق الإيصال (Ctrl+X)',
    help: 'مساعدة (F1)',
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto font-sans text-slate-800" dir="rtl">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Keyboard className="w-5 h-5 text-emerald-600" />
              تخصيص اختصارات لوحة المفاتيح
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              اختر أي حرف عربي أو لاتيني لكل اختصار. اضغط على زر "تسجيل" ثم
              اضغط الاختصار المطلوب من لوحة المفاتيح — هيتم حفظه تلقائياً.
              ده بيحل مشكلة الكيبورد العربي/اللاتيني بدون ما تحتاج English layout.
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            إعادة تعيين للافتراضي
          </button>
        </div>
      </div>

      {/* Capture status banner */}
      {recording && (
        <div className="mb-4 p-3.5 bg-amber-50 border-2 border-amber-300 rounded-2xl flex items-center justify-between text-xs text-amber-900 animate-pulse">
          <div className="flex items-center gap-2 font-bold">
            <AlertCircle className="w-4 h-4" />
            جاري تسجيل الاختصار... اضغط أي مفتاح (Escape للإلغاء)
          </div>
          <button
            type="button"
            onClick={() => { setRecording(null); setCaptureError(null); }}
            className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-lg text-xs font-bold"
          >
            إلغاء
          </button>
        </div>
      )}
      {captureError && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold">
          ⚠ {captureError}
        </div>
      )}

      {/* Groups */}
      <div className="space-y-4">
        {grouped.map(([action, rows]) => (
          <div key={action} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 p-3 bg-slate-50/80 border-b border-slate-200">
              <div className="text-sm font-bold text-slate-800">
                {ACTION_LABEL[action] || action}
              </div>
              <button
                type="button"
                onClick={() => handleAddBinding(action)}
                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold rounded-lg text-[11px] flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                إضافة اختصار
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {rows.map((b) => (
                <div
                  key={b.id}
                  className={`flex items-center gap-3 p-3 ${recording === b.id ? 'bg-amber-50' : ''}`}
                >
                  {/* Key combo display */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <kbd className="px-2 py-1 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-xs text-slate-800 min-w-[40px] text-center">
                        {b.key ? formatKey(b.key) : 'فارغ'}
                      </kbd>
                      {(b.alt || b.ctrl || b.meta || b.shift) && (
                        <span className="text-xs text-slate-500">
                          {[
                            b.ctrl && 'Ctrl',
                            b.meta && 'Meta',
                            b.alt && 'Alt',
                            b.shift && 'Shift',
                          ].filter(Boolean).join(' + ')}
                        </span>
                      )}
                    </div>
                    {/* Inline editable label */}
                    <input
                      type="text"
                      value={b.label}
                      onChange={(e) => {
                        const updated = bindings.map((x) => x.id === b.id ? { ...x, label: e.target.value } : x);
                        setBindings(updated);
                      }}
                      onBlur={() => saveBindings(bindings)}
                      placeholder="وصف مختصر..."
                      className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setCaptureError(null);
                        setRecording(recording === b.id ? null : b.id);
                      }}
                      className={`px-3 py-1.5 font-bold rounded-lg text-xs ${
                        recording === b.id
                          ? 'bg-amber-500 text-white'
                          : 'bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700'
                      }`}
                    >
                      {recording === b.id ? 'جاري التسجيل...' : 'تسجيل مفتاح'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(b.id)}
                      title="حذف هذا الاختصار"
                      className="px-2 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {rows.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-400">
                  لا يوجد اختصارات لهذا الإجراء بعد
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Hint footer */}
      <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 leading-relaxed">
        <b className="text-slate-800">نصيحة:</b> تقدر تضيف أكثر من اختصار لنفس الإجراء.
        مثال: اربط "حفظ" بـ <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono">Ctrl+S</kbd> للـ English layout
        و <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono">Ctrl+س</kbd> للـ Arabic layout.
        الاثنين هيشتغلوا في نفس الوقت.
      </div>
    </div>
  );
};
