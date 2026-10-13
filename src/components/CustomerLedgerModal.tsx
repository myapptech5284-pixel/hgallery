import React, { useState, useEffect, useCallback } from 'react';
import {
  Customer,
  CustomerLedger,
  InstallmentRecord,
  LedgerEntry,
  User,
} from '../types.ts';
import { api } from '../services/api.ts';
import {
  X,
  Phone,
  MapPin,
  Pencil,
  FileText,
  CreditCard,
  Undo2,
  History,
  Receipt,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Store,
  BookOpen,
  Wallet,
  TrendingUp,
  RefreshCw,
  Package,
  User as UserIcon,
} from 'lucide-react';
import { InstallmentPaymentModal } from './InstallmentPaymentModal.tsx';

interface CustomerLedgerModalProps {
  customerId: string;
  currentUser: User;
  onClose: () => void;
  onEdit?: (customer: Customer) => void;
  onChanged?: () => void;
}

type LedgerTab = 'statement' | 'invoices' | 'installments' | 'returns';

const money = (value: any) => (Number(value) || 0).toFixed(2);

const LOCATION_LABEL: Record<string, string> = { gallery: 'المعرض', stationery: 'المكتبة' };

const TABS: { id: LedgerTab; label: string; icon: any }[] = [
  { id: 'statement', label: 'كشف الحساب', icon: History },
  { id: 'invoices', label: 'الفواتير', icon: Receipt },
  { id: 'installments', label: 'فواتير التقسيط', icon: CreditCard },
  { id: 'returns', label: 'المرتجعات', icon: Undo2 },
];

/**
 * The complete customer record: contact details, money totals, every
 * invoice with its line items, every installment invoice with its payment
 * history, every return, and a chronological statement with a running
 * balance. Installment invoices can be settled right here — no need to
 * leave for the installments tab.
 */
export const CustomerLedgerModal: React.FC<CustomerLedgerModalProps> = ({
  customerId,
  currentUser,
  onClose,
  onEdit,
  onChanged,
}) => {
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LedgerTab>('statement');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [expandedInstallmentId, setExpandedInstallmentId] = useState<string | null>(null);
  const [payingInstallment, setPayingInstallment] = useState<InstallmentRecord | null>(null);

  const loadLedger = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getCustomerLedger(customerId);
      if (res.success && res.ledger) {
        setLedger(res.ledger);
      } else {
        setError(res.error || 'تعذر تحميل سجل العميل');
      }
    } catch (err: any) {
      setError(err?.message || 'فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    setLoading(true);
    loadLedger();
  }, [loadLedger]);

  const handlePaid = () => {
    loadLedger();
    onChanged?.();
  };

  const customer = ledger?.customer;
  const summary = ledger?.summary;
  const statement = ledger?.statement || [];
  const finalBalance = statement.length > 0 ? statement[statement.length - 1].balance : 0;

  const card = (
    label: string,
    value: string,
    tone: string,
    icon: any,
    hint?: string
  ) => {
    const Icon = icon;
    return (
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-1.5 mb-1">
          <Icon className={`w-3.5 h-3.5 ${tone}`} />
          <span className="text-[11px] font-semibold text-slate-500">{label}</span>
        </div>
        <span className={`text-base font-extrabold font-mono ${tone}`}>{value}</span>
        {hint && <span className="text-[10px] text-slate-400 block mt-0.5">{hint}</span>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-5" dir="rtl">
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-7xl h-[94vh] flex flex-col overflow-hidden border border-slate-200">
        {/* ---------------- Header ---------------- */}
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold shadow-xs shrink-0">
              <UserIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                <span>{customer?.name || 'جارٍ التحميل...'}</span>
                {summary && summary.openInstallmentCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                    <CreditCard className="w-3 h-3" />
                    {summary.openInstallmentCount} قسط مفتوح
                  </span>
                )}
                {summary && summary.overdueInstallmentCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">
                    <AlertCircle className="w-3 h-3" />
                    {summary.overdueInstallmentCount} متأخر
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1 font-mono">
                  <Phone className="w-3 h-3 text-slate-400" />
                  {customer?.phone || '-'}
                </span>
                {customer?.address && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    {customer.address}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  مسجل منذ: {customer?.createdAt ? String(customer.createdAt).substring(0, 10) : '-'}
                </span>
                {summary?.lastActivityDate && (
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-slate-400" />
                    آخر تعامل: {String(summary.lastActivityDate).substring(0, 10)}
                  </span>
                )}
              </div>
              {customer?.notes && (
                <p className="text-[11px] text-slate-500 mt-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 inline-block">
                  ملاحظات: {customer.notes}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => customer && onEdit?.(customer)}
              disabled={!customer}
              className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>تعديل البيانات</span>
            </button>
            <button
              onClick={loadLedger}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
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

        {/* ---------------- Body ---------------- */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading && !ledger ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              جاري تحميل السجل الشامل للعميل...
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
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
                {card('إجمالي الفواتير', money(summary.totalInvoiced), 'text-slate-900', Receipt, `${summary.invoiceCount} فاتورة`)}
                {card('صافي المشتريات', money(summary.netSales), 'text-emerald-700', Wallet, `مسترجع: ${money(summary.totalReturns)}`)}
                {card('إجمالي المسدد', money(summary.totalPaid), 'text-emerald-600', CheckCircle2, `خصومات: ${money(summary.totalDiscount)}`)}
                {card('المستحق على العميل', money(summary.totalRemaining), 'text-rose-600', AlertCircle, 'الرصيد النهائي للعميل')}
                {card('أقساط متبقية', money(summary.installmentRemaining), 'text-amber-700', CreditCard, `من إجمالي ${money(summary.installmentTotal)}`)}
                {card('صافي الربح', money(summary.totalProfit), 'text-sky-700', TrendingUp, 'ربح الفواتير بعد المرتجعات')}
              </div>

              {ledger.matchInfo.nameSharedWithAnotherCustomer && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    يوجد أكثر من عميل مسجل بنفس الاسم «{ledger.matchInfo.nameKey}». تم اعتماد مطابقة
                    الفواتير بدون رقم هاتف على الاسم، وقد تُستثنى بعض الفواتير النقدية القديمة من السجل
                    لتفادي الازدواج.
                  </span>
                </div>
              )}

              {/* Inner tabs */}
              <div className="bg-white rounded-xl border border-slate-200 p-1 mb-4 flex items-center gap-1 overflow-x-auto">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  const count =
                    tab.id === 'invoices'
                      ? ledger.invoices.length
                      : tab.id === 'installments'
                        ? ledger.installments.length
                        : tab.id === 'returns'
                          ? ledger.returns.length
                          : statement.length;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                        isActive ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                      <span
                        className={`px-1.5 rounded-full text-[10px] font-mono ${
                          isActive ? 'bg-white/25' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ---------------- Statement ---------------- */}
              {activeTab === 'statement' && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <History className="w-4 h-4 text-slate-400" />
                      كشف حساب كامل — كل الفواتير والسدّدات والمرتجعات مرتبة زمنياً
                    </h3>
                    <span className="text-xs font-extrabold font-mono text-rose-600">
                      الرصيد المستحق: {money(finalBalance)} ج.م
                    </span>
                  </div>

                  {statement.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                      لا توجد حركات مسجلة على هذا العميل بعد
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
                          <tr>
                            <th className="p-3">#</th>
                            <th className="p-3">التاريخ</th>
                            <th className="p-3">المرجع</th>
                            <th className="p-3">البيان</th>
                            <th className="p-3 text-center">مدين (عليه)</th>
                            <th className="p-3 text-center">دائن (له)</th>
                            <th className="p-3 text-center">الرصيد</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {statement.map((entry: LedgerEntry, idx) => (
                            <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3 text-slate-400 font-mono">{idx + 1}</td>
                              <td className="p-3 font-mono text-slate-600 text-[11px] whitespace-nowrap">
                                {entry.date} {entry.time || ''}
                              </td>
                              <td className="p-3 font-mono font-bold text-slate-700">{entry.reference}</td>
                              <td className="p-3 text-slate-600">{entry.description}</td>
                              <td className="p-3 text-center font-mono font-bold text-amber-700">
                                {entry.debit > 0 ? money(entry.debit) : '-'}
                              </td>
                              <td className="p-3 text-center font-mono font-bold text-emerald-600">
                                {entry.credit > 0 ? money(entry.credit) : '-'}
                              </td>
                              <td
                                className={`p-3 text-center font-mono font-extrabold ${
                                  entry.balance > 0 ? 'text-rose-600' : 'text-emerald-600'
                                }`}
                              >
                                {money(entry.balance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-extrabold">
                          <tr>
                            <td className="p-3 text-slate-600" colSpan={4}>
                              الإجمالي النهائي
                            </td>
                            <td className="p-3 text-center font-mono text-amber-700">
                              {money(summary.totalInvoiced)}
                            </td>
                            <td className="p-3 text-center font-mono text-emerald-600">
                              {money(summary.totalPaid + summary.totalReturns)}
                            </td>
                            <td className="p-3 text-center font-mono text-rose-600">{money(finalBalance)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ---------------- Invoices ---------------- */}
              {activeTab === 'invoices' && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-slate-400" />
                      كل فواتير البيع ({ledger.invoices.length})
                    </h3>
                  </div>

                  {ledger.invoices.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">لا توجد فواتير مسجلة</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
                          <tr>
                            <th className="p-3">رقم الفاتورة</th>
                            <th className="p-3">التاريخ</th>
                            <th className="p-3">الموقع</th>
                            <th className="p-3">طريقة الدفع</th>
                            <th className="p-3 text-center">الإجمالي</th>
                            <th className="p-3 text-center">المسدد</th>
                            <th className="p-3 text-center">المتبقي</th>
                            <th className="p-3">البائع</th>
                            <th className="p-3 text-center">الأصناف</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ledger.invoices.map((invoice) => {
                            const isExpanded = expandedInvoiceId === invoice.id;
                            const isInstallment =
                              invoice.paymentMethod === 'installment' || invoice.isInstallment;
                            return (
                              <React.Fragment key={invoice.id}>
                                <tr className="hover:bg-slate-50/80 transition-colors">
                                  <td className="p-3 font-mono font-bold text-slate-700">{invoice.invoiceNumber}</td>
                                  <td className="p-3 font-mono text-slate-600 text-[11px] whitespace-nowrap">
                                    {invoice.date} {invoice.time}
                                  </td>
                                  <td className="p-3 text-slate-600">
                                    <span className="inline-flex items-center gap-1">
                                      {invoice.location === 'stationery' ? (
                                        <BookOpen className="w-3 h-3 text-indigo-400" />
                                      ) : (
                                        <Store className="w-3 h-3 text-emerald-400" />
                                      )}
                                      {LOCATION_LABEL[invoice.location] || invoice.location}
                                    </span>
                                  </td>
                                  <td className="p-3">
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                        isInstallment ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                                      }`}
                                    >
                                      {isInstallment ? 'تقسيط' : invoice.paymentMethod === 'card' ? 'شبكة' : 'نقدي'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-center font-mono font-bold text-slate-800">
                                    {money(invoice.total)}
                                  </td>
                                  <td className="p-3 text-center font-mono font-bold text-emerald-600">
                                    {money(invoice.paid)}
                                  </td>
                                  <td
                                    className={`p-3 text-center font-mono font-extrabold ${
                                      invoice.remaining > 0 ? 'text-rose-600' : 'text-slate-400'
                                    }`}
                                  >
                                    {money(invoice.remaining)}
                                  </td>
                                  <td className="p-3 text-slate-600 text-[11px]">
                                    {invoice.sellerName} ({invoice.sellerCode})
                                  </td>
                                  <td className="p-3 text-center">
                                    <button
                                      onClick={() => setExpandedInvoiceId(isExpanded ? null : invoice.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] cursor-pointer"
                                    >
                                      <Package className="w-3 h-3" />
                                      <span>{(invoice.items || []).length} صنف</span>
                                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                  </td>
                                </tr>

                                {isExpanded && (
                                  <tr className="bg-slate-50/90 border-b border-slate-200">
                                    <td colSpan={9} className="p-4">
                                      <div className="bg-white rounded-xl border border-slate-200 p-3.5">
                                        <div className="font-bold text-xs text-slate-800 mb-2">
                                          أصناف فاتورة {invoice.invoiceNumber}
                                        </div>
                                        <table className="w-full text-right text-xs">
                                          <thead className="bg-slate-50 text-slate-500 text-[11px]">
                                            <tr>
                                              <th className="p-2">الصنف</th>
                                              <th className="p-2">الكود</th>
                                              <th className="p-2 text-center">الكمية</th>
                                              <th className="p-2 text-center">سعر البيع</th>
                                              <th className="p-2 text-center">الخصم</th>
                                              <th className="p-2 text-center">التكلفة</th>
                                              <th className="p-2 text-center">الربح</th>
                                              <th className="p-2 text-center">الإجمالي</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                                            {(invoice.items || []).map((item) => (
                                              <tr key={item.productId + item.sku}>
                                                <td className="p-2 font-sans text-slate-700 font-semibold">{item.productName}</td>
                                                <td className="p-2 text-slate-500">{item.sku}</td>
                                                <td className="p-2 text-center">{item.quantity}</td>
                                                <td className="p-2 text-center">{money(item.actualSalePrice)}</td>
                                                <td className="p-2 text-center text-rose-600">{money(item.discount)}</td>
                                                <td className="p-2 text-center text-slate-500">{money(item.frozenPurchaseCost)}</td>
                                                <td className="p-2 text-center font-bold text-sky-700">{money(item.itemProfit)}</td>
                                                <td className="p-2 text-center font-bold text-slate-800">{money(item.total)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ---------------- Installments (payable here) ---------------- */}
              {activeTab === 'installments' && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-amber-500" />
                      فواتير التقسيط ({ledger.installments.length}) — يمكن السداد من هنا مباشرة
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      المتبقي على العميل من الأقساط:{' '}
                      <span className="font-mono font-extrabold text-amber-700">{money(summary.installmentRemaining)}</span> ج.م
                    </span>
                  </div>

                  {ledger.installments.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                      لا توجد فواتير تقسيط مسجلة على هذا العميل
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
                          <tr>
                            <th className="p-3">رقم الفاتورة</th>
                            <th className="p-3">تاريخ الفاتورة</th>
                            <th className="p-3">الاستحقاق</th>
                            <th className="p-3 text-center">الإجمالي</th>
                            <th className="p-3 text-center">المسدد</th>
                            <th className="p-3 text-center">المتبقي</th>
                            <th className="p-3">الحالة</th>
                            <th className="p-3 text-center">الدفعات</th>
                            <th className="p-3 text-center">سداد</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ledger.installments.map((inst) => {
                            const remaining = Number(inst.remainingAmount) || 0;
                            const isCompleted = remaining <= 0;
                            const isOverdue = !isCompleted && String(inst.dueDate) < new Date().toISOString().split('T')[0];
                            const isExpanded = expandedInstallmentId === inst.id;
                            return (
                              <React.Fragment key={inst.id}>
                                <tr
                                  className={`hover:bg-slate-50/80 transition-colors ${
                                    isOverdue ? 'bg-rose-50/50' : !isCompleted ? 'bg-amber-50/30' : ''
                                  }`}
                                >
                                  <td className="p-3 font-mono font-bold text-slate-700">{inst.invoiceNumber}</td>
                                  <td className="p-3 font-mono text-slate-600 text-[11px]">
                                    {String(inst.createdAt || '').substring(0, 10)}
                                  </td>
                                  <td className="p-3 font-mono text-slate-600 text-[11px]">
                                    {inst.dueDate}
                                    {isOverdue && (
                                      <span className="inline-flex items-center gap-1 mr-1 text-rose-600 font-bold">
                                        <Clock className="w-3 h-3" />
                                        متأخر
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-center font-mono font-bold text-slate-800">
                                    {money(inst.totalAmount)}
                                  </td>
                                  <td className="p-3 text-center font-mono font-bold text-emerald-600">
                                    {money(inst.paidAmount)}
                                  </td>
                                  <td
                                    className={`p-3 text-center font-mono font-extrabold ${
                                      remaining > 0 ? 'text-amber-700' : 'text-slate-400'
                                    }`}
                                  >
                                    {money(remaining)}
                                  </td>
                                  <td className="p-3">
                                    <span
                                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                        isCompleted
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : isOverdue
                                            ? 'bg-rose-100 text-rose-700'
                                            : 'bg-amber-100 text-amber-800'
                                      }`}
                                    >
                                      {isCompleted ? 'مسدد بالكامل' : isOverdue ? 'متأخر السداد' : 'نشط (متبقي)'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-center">
                                    <button
                                      onClick={() => setExpandedInstallmentId(isExpanded ? null : inst.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] cursor-pointer"
                                    >
                                      <span>{(inst.payments || []).length} دفعة</span>
                                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                  </td>
                                  <td className="p-3 text-center">
                                    {!isCompleted ? (
                                      <button
                                        onClick={() => setPayingInstallment(inst)}
                                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 shadow-xs cursor-pointer"
                                      >
                                        <DollarSign className="w-3.5 h-3.5" />
                                        <span>سداد دفعة</span>
                                      </button>
                                    ) : (
                                      <span className="text-emerald-600 font-bold text-[11px] flex items-center justify-center gap-1">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        تم الإتمام
                                      </span>
                                    )}
                                  </td>
                                </tr>

                                {isExpanded && (
                                  <tr className="bg-slate-50/90 border-b border-slate-200">
                                    <td colSpan={9} className="p-4">
                                      <div className="bg-white rounded-xl border border-slate-200 p-3.5">
                                        <div className="font-bold text-xs text-slate-800 mb-2">
                                          سجل دفعات السداد للقسط ({inst.invoiceNumber})
                                        </div>
                                        {(inst.payments || []).length === 0 ? (
                                          <div className="text-center text-slate-400 text-xs py-2">
                                            لم يتم تسجيل أي دفعات بعد
                                          </div>
                                        ) : (
                                          <table className="w-full text-right text-xs">
                                            <thead className="bg-slate-50 text-slate-500 text-[11px]">
                                              <tr>
                                                <th className="p-2">#</th>
                                                <th className="p-2">تاريخ ووقت السداد</th>
                                                <th className="p-2">المبلغ المسدد</th>
                                                <th className="p-2">طريقة الدفع</th>
                                                <th className="p-2">الموظف المستلم</th>
                                                <th className="p-2">ملاحظات</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                                              {(inst.payments || []).map((payment, pIdx) => (
                                                <tr key={payment.id || pIdx}>
                                                  <td className="p-2 text-slate-400">{pIdx + 1}</td>
                                                  <td className="p-2 text-slate-700 font-sans">
                                                    {payment.date} {payment.time}
                                                  </td>
                                                  <td className="p-2 font-bold text-emerald-600">{money(payment.amount)} ج.م</td>
                                                  <td className="p-2 font-sans text-slate-600">{payment.paymentMethod}</td>
                                                  <td className="p-2 font-sans text-slate-600">{payment.receivedByName}</td>
                                                  <td className="p-2 font-sans text-slate-400">{payment.notes || '-'}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ---------------- Returns ---------------- */}
              {activeTab === 'returns' && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Undo2 className="w-4 h-4 text-rose-400" />
                      المرتجعات والاستردادات ({ledger.returns.length})
                    </h3>
                  </div>

                  {ledger.returns.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">لا توجد مرتجعات مسجلة</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
                          <tr>
                            <th className="p-3">التاريخ</th>
                            <th className="p-3">الصنف</th>
                            <th className="p-3">الكود</th>
                            <th className="p-3 text-center">الكمية</th>
                            <th className="p-3 text-center">سعر الاسترداد</th>
                            <th className="p-3 text-center">قيمة الاسترداد</th>
                            <th className="p-3">الفاتورة</th>
                            <th className="p-3">السبب</th>
                            <th className="p-3">الموظف</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ledger.returns.map((record: any) => (
                            <tr key={record.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3 font-mono text-slate-600 text-[11px]">
                                {String(record.date || '').substring(0, 10)}
                              </td>
                              <td className="p-3 font-bold text-slate-700">{record.productName}</td>
                              <td className="p-3 font-mono text-slate-500">{record.sku}</td>
                              <td className="p-3 text-center font-mono">{record.quantity}</td>
                              <td className="p-3 text-center font-mono">{money(record.unitRefundPrice)}</td>
                              <td className="p-3 text-center font-mono font-bold text-rose-600">
                                {money(record.totalRefund)}
                              </td>
                              <td className="p-3 font-mono text-slate-600">{record.invoiceNumber || '-'}</td>
                              <td className="p-3 text-slate-500 text-[11px]">{record.reason || '-'}</td>
                              <td className="p-3 text-slate-600 text-[11px]">{record.createdByName || '-'}</td>
                            </tr>
                          ))}
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

      {/* Inline installment payment — no need to leave the customer record */}
      {payingInstallment && (
        <InstallmentPaymentModal
          installment={payingInstallment}
          currentUser={currentUser}
          contextLabel={`يتم السداد من سجل العميل: ${customer?.name || ''}`}
          onClose={() => setPayingInstallment(null)}
          onPaid={handlePaid}
        />
      )}
    </div>
  );
};