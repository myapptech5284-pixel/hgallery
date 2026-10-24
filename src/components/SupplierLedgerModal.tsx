import React, { useState, useEffect, useCallback } from 'react';
import { Supplier, SupplierLedger, User , LOCATION_LABEL } from '../types.ts';
import { api } from '../services/api.ts';
import {
  X,
  Phone,
  MapPin,
  Pencil,
  History,
  Truck,
  Undo2,
  AlertCircle,
  RefreshCw,
  Package,
  Store,
  Wrench,
  BookOpen,
  Wallet,
  TrendingUp,
  Clock,
} from 'lucide-react';

interface SupplierLedgerModalProps {
  supplierId: string;
  onClose: () => void;
  onEdit?: (supplier: Supplier) => void;
}

const money = (value: any) => (Number(value) || 0).toFixed(2);

/**
 * The complete supplier record on the purchase side: contact details,
 * every restocking movement with its quantity and cost, and a running
 * statement of what the business owes the supplier.
 */
export const SupplierLedgerModal: React.FC<SupplierLedgerModalProps> = ({
  supplierId,
  onClose,
  onEdit,
}) => {
  const [ledger, setLedger] = useState<SupplierLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'statement' | 'supplies'>('statement');

  const loadLedger = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getSupplierLedger(supplierId);
      if (res.success && res.ledger) {
        setLedger(res.ledger);
      } else {
        setError(res.error || 'تعذر تحميل سجل المورد');
      }
    } catch (err: any) {
      setError(err?.message || 'فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    setLoading(true);
    loadLedger();
  }, [loadLedger]);

  const supplier = ledger?.supplier;
  const summary = ledger?.summary;
  const statement = ledger?.statement || [];
  const finalBalance = statement.length > 0 ? statement[statement.length - 1].balance : 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-5" dir="rtl">
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-6xl h-[94vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-indigo-500 text-white flex items-center justify-center font-bold shadow-xs shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900">{supplier?.name || 'جارٍ التحميل...'}</h2>
              <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] text-slate-500">
                {supplier?.company && <span className="font-bold text-indigo-700">{supplier.company}</span>}
                <span className="inline-flex items-center gap-1 font-mono">
                  <Phone className="w-3 h-3 text-slate-400" />
                  {supplier?.phone || '-'}
                </span>
                {supplier?.address && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    {supplier.address}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  مسجل منذ: {supplier?.createdAt ? String(supplier.createdAt).substring(0, 10) : '-'}
                </span>
              </div>
              {supplier?.notes && (
                <p className="text-[11px] text-slate-500 mt-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 inline-block">
                  ملاحظات: {supplier.notes}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => supplier && onEdit?.(supplier)}
              disabled={!supplier}
              className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>تعديل البيانات</span>
            </button>
            <button
              onClick={loadLedger}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              title="تحديث السجل"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              title="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading && !ledger ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              جاري تحميل سجل المورد...
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center">
              <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            </div>
          ) : !ledger || !summary ? null : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Truck className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[11px] font-semibold text-slate-500">عدد حركات التوريد</span>
                  </div>
                  <span className="text-base font-extrabold font-mono text-slate-900">{summary.supplyCount}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">{summary.itemCount} قطعة</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Wallet className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-[11px] font-semibold text-slate-500">إجمالي المشتريات</span>
                  </div>
                  <span className="text-base font-extrabold font-mono text-indigo-700">{money(summary.totalPurchases)}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Undo2 className="w-3.5 h-3.5 text-rose-500" />
                    <span className="text-[11px] font-semibold text-slate-500">مرتجعات للمورد</span>
                  </div>
                  <span className="text-base font-extrabold font-mono text-rose-600">{money(summary.totalReturns)}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">صافي: {money(summary.netPurchases)}</span>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-[11px] font-semibold text-slate-500">صافي المستحق للمورد</span>
                  </div>
                  <span className="text-base font-extrabold font-mono text-emerald-700">{money(finalBalance)}</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-1 mb-4 flex items-center gap-1">
                <button
                  onClick={() => setView('statement')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    view === 'statement' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>كشف الحساب</span>
                  <span className={`px-1.5 rounded-full text-[10px] font-mono ${view === 'statement' ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>
                    {statement.length}
                  </span>
                </button>
                <button
                  onClick={() => setView('supplies')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    view === 'supplies' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>حركات التوريد</span>
                  <span className={`px-1.5 rounded-full text-[10px] font-mono ${view === 'supplies' ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>
                    {ledger.supplies.length}
                  </span>
                </button>
              </div>

              {view === 'statement' && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <History className="w-4 h-4 text-slate-400" />
                      كشف حساب المورد — التوريدات والمرتجعات مرتبة زمنياً
                    </h3>
                    <span className="text-xs font-extrabold font-mono text-indigo-600">
                      صافي المستحق: {money(finalBalance)} ج.م
                    </span>
                  </div>

                  {statement.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                      لا توجد حركات توريد مسجلة على هذا المورد بعد
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
                          <tr>
                            <th className="p-3">#</th>
                            <th className="p-3">التاريخ</th>
                            <th className="p-3">الكود</th>
                            <th className="p-3">البيان</th>
                            <th className="p-3 text-center">عليه (توريد)</th>
                            <th className="p-3 text-center">له (مرتجع)</th>
                            <th className="p-3 text-center">الرصيد</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {statement.map((entry, idx) => (
                            <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3 text-slate-400 font-mono">{idx + 1}</td>
                              <td className="p-3 font-mono text-slate-600 text-[11px] whitespace-nowrap">{entry.date}</td>
                              <td className="p-3 font-mono text-slate-600">{entry.reference}</td>
                              <td className="p-3 text-slate-600">{entry.description}</td>
                              <td className="p-3 text-center font-mono font-bold text-indigo-700">
                                {entry.debit > 0 ? money(entry.debit) : '-'}
                              </td>
                              <td className="p-3 text-center font-mono font-bold text-emerald-600">
                                {entry.credit > 0 ? money(entry.credit) : '-'}
                              </td>
                              <td className="p-3 text-center font-mono font-extrabold text-slate-800">
                                {money(entry.balance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {view === 'supplies' && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-slate-400" />
                      كل حركات التوريد ({ledger.supplies.length})
                    </h3>
                  </div>

                  {ledger.supplies.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">لا توجد حركات توريد مسجلة</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
                          <tr>
                            <th className="p-3">التاريخ</th>
                            <th className="p-3">الصنف</th>
                            <th className="p-3">الكود</th>
                            <th className="p-3">الموقع</th>
                            <th className="p-3 text-center">الكمية</th>
                            <th className="p-3 text-center">سعر الشراء</th>
                            <th className="p-3 text-center">الإجمالي</th>
                            <th className="p-3">النوع</th>
                            <th className="p-3">الموظف</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ledger.supplies.map((supply) => {
                            const isReturn = Number(supply.isReturn) === 1;
                            const value = (Number(supply.quantity) || 0) * (Number(supply.purchasePrice) || 0);
                            return (
                              <tr key={supply.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="p-3 font-mono text-slate-600 text-[11px]">
                                  {String(supply.date || '').substring(0, 10)}
                                </td>
                                <td className="p-3 font-bold text-slate-700">{supply.productName}</td>
                                <td className="p-3 font-mono text-slate-500">{supply.sku}</td>
                                <td className="p-3 text-slate-600">
                                  <span className="inline-flex items-center gap-1">
                                    {supply.location === 'stationery' ? (
                                      <BookOpen className="w-3 h-3 text-indigo-400" />
                                    ) : supply.location === 'tools' ? (
                                      <Wrench className="w-3 h-3 text-amber-400" />
                                    ) : (
                                      <Store className="w-3 h-3 text-emerald-400" />
                                    )}
                                    {LOCATION_LABEL[supply.location] || supply.location}
                                  </span>
                                </td>
                                <td className="p-3 text-center font-mono">{supply.quantity}</td>
                                <td className="p-3 text-center font-mono">{money(supply.purchasePrice)}</td>
                                <td
                                  className={`p-3 text-center font-mono font-extrabold ${
                                    isReturn ? 'text-emerald-600' : 'text-indigo-700'
                                  }`}
                                >
                                  {money(value)}
                                </td>
                                <td className="p-3">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      isReturn ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'
                                    }`}
                                  >
                                    {isReturn ? 'مرتجع للمورد' : 'توريد'}
                                  </span>
                                </td>
                                <td className="p-3 text-slate-600 text-[11px]">{supply.createdByName || '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};