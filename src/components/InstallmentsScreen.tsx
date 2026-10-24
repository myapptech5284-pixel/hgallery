import React, { useState, useEffect } from 'react';
import { InstallmentRecord, LocationType, User , LOCATION_LABEL } from '../types.ts';
import { LocationTabs } from './LocationTabs.tsx';
import { api } from '../services/api.ts';
import { InstallmentPaymentModal } from './InstallmentPaymentModal.tsx';
import {
  CreditCard,
  Search,
  CheckCircle2,
  Clock,
  User as UserIcon,
  Phone,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  DollarSign,
  FileText,
  Store,
  BookOpen,
} from 'lucide-react';

interface InstallmentsScreenProps {
  currentUser: User;
  activeLocation: LocationType;
  onLocationChange: (loc: LocationType) => void;
}

export const InstallmentsScreen: React.FC<InstallmentsScreenProps> = ({
  currentUser,
  activeLocation,
  onLocationChange,
}) => {
  const [installments, setInstallments] = useState<InstallmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');

  // Payment Modal
  const [activeInstallment, setActiveInstallment] = useState<InstallmentRecord | null>(null);

  // Expanded payment audit log row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadInstallments = async () => {
    setLoading(true);
    try {
      const data = await api.getInstallments({
        location: activeLocation,
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: searchQuery,
      });
      setInstallments(data);
    } catch (err) {
      console.error('Failed to load installments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInstallments();
  }, [activeLocation, statusFilter, searchQuery]);

  // The payment form itself lives in <InstallmentPaymentModal /> so this
  // screen and the customer ledger settle installments through exactly the
  // same validated, audited code path.
  const openPaymentModal = (inst: InstallmentRecord) => {
    setActiveInstallment(inst);
  };

  // Metrics
  const totalInstallmentSales = installments.reduce((acc, i) => acc + i.totalAmount, 0);
  const totalPaid = installments.reduce((acc, i) => acc + i.paidAmount, 0);
  const totalRemaining = installments.reduce((acc, i) => acc + i.remainingAmount, 0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-amber-600" />
            <span>إدارة الأقساط وسداد الدفعات</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            متابعة دقيقة لأقساط العملاء، توثيق دفعات السداد الجزئي والكامل بالوقت والتاريخ، وتحديث الفواتير والإيصالات فورياً
          </p>
        </div>

        <LocationTabs
          activeLocation={activeLocation}
          onLocationChange={onLocationChange}
          label={(loc) => `أقساط ${LOCATION_LABEL[loc]}`}
        />
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 block mb-1">إجمالي مبيعات الأقساط</span>
          <span className="text-xl font-extrabold text-slate-900 font-mono">
            {totalInstallmentSales.toFixed(2)} ج.م
          </span>
          <span className="text-[11px] text-slate-400 block mt-1">
            إجمالي الفواتير الآجلة في {LOCATION_LABEL[activeLocation]}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200">
          <span className="text-xs font-semibold text-emerald-600 block mb-1">المبالغ المسددة والمحصلة</span>
          <span className="text-xl font-extrabold text-emerald-700 font-mono">
            {totalPaid.toFixed(2)} ج.م
          </span>
          <span className="text-[11px] text-slate-400 block mt-1">
            نسبة التحصيل: {totalInstallmentSales > 0 ? ((totalPaid / totalInstallmentSales) * 100).toFixed(1) : 0}%
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200">
          <span className="text-xs font-semibold text-amber-600 block mb-1">المبالغ المتبقية للتحصيل</span>
          <span className="text-xl font-extrabold text-amber-700 font-mono">
            {totalRemaining.toFixed(2)} ج.م
          </span>
          <span className="text-[11px] text-slate-400 block mt-1">
            مستحقات قيد المتابعة والتحصيل
          </span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-3.5 rounded-2xl shadow-xs border border-slate-200 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <input
            type="text"
            data-search-input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم العميل، رقم الهاتف، أو رقم الفاتورة... (Alt+S)"
            className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">الحالة:</span>
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
              }`}
            >
              الكل
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === 'active' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              متبقي (نشط)
            </button>
            <button
              onClick={() => setStatusFilter('completed')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === 'completed' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              مسدد بالكامل
            </button>
          </div>
        </div>
      </div>

      {/* Installments Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
              <tr>
                <th className="p-3.5">#</th>
                <th className="p-3.5">رقم الفاتورة</th>
                <th className="p-3.5">العميل ورقم الهاتف</th>
                <th className="p-3.5 text-center">إجمالي القسط</th>
                <th className="p-3.5 text-center">المسدد</th>
                <th className="p-3.5 text-center">المتبقي</th>
                <th className="p-3.5 text-center">عدد الدفعات</th>
                <th className="p-3.5">تاريخ الاستحقاق</th>
                <th className="p-3.5">الحالة</th>
                <th className="p-3.5">البائع المسؤول</th>
                <th className="p-3.5 text-center">سداد / تفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
                    جاري تحميل سجل الأقساط...
                  </td>
                </tr>
              ) : installments.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
                    لا توجد سجلات أقساط مسجلة في هذا القسم
                  </td>
                </tr>
              ) : (
                installments.map((inst, idx) => {
                  const isCompleted = inst.remainingAmount <= 0;
                  const isExpanded = expandedId === inst.id;

                  return (
                    <React.Fragment key={inst.id}>
                      <tr className={`hover:bg-slate-50/80 transition-colors ${!isCompleted ? 'bg-amber-50/20' : ''}`}>
                        <td className="p-3.5 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="p-3.5 font-mono font-bold text-slate-700">
                          {inst.invoiceNumber}
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-slate-800">{inst.customerName}</div>
                          <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {inst.customerPhone}
                          </div>
                        </td>
                        <td className="p-3.5 text-center font-bold text-slate-800 font-mono">
                          {inst.totalAmount.toFixed(2)}
                        </td>
                        <td className="p-3.5 text-center font-bold text-emerald-600 font-mono">
                          {inst.paidAmount.toFixed(2)}
                        </td>
                        <td className="p-3.5 text-center font-extrabold text-amber-700 font-mono">
                          {inst.remainingAmount.toFixed(2)}
                        </td>
                        <td className="p-3.5 text-center">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : inst.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] cursor-pointer"
                          >
                            <span>{inst.paymentCount} دفعات</span>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </td>
                        <td className="p-3.5 font-mono text-slate-600 text-[11px]">
                          {inst.dueDate}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              isCompleted
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {isCompleted ? 'مسدد بالكامل' : 'نشط (متبقي)'}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-600 text-[11px]">
                          {inst.sellerName} ({inst.sellerCode})
                        </td>
                        <td className="p-3.5 text-center">
                          {!isCompleted ? (
                            <button
                              onClick={() => openPaymentModal(inst)}
                              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-xs cursor-pointer"
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

                      {/* Expanded Payment Audit Log */}
                      {isExpanded && (
                        <tr className="bg-slate-50/90 border-b border-slate-200">
                          <td colSpan={11} className="p-4">
                            <div className="bg-white rounded-xl border border-slate-200 p-3.5">
                              <div className="font-bold text-xs text-slate-800 mb-2 flex items-center justify-between">
                                <span>سجل تواريخ وأوقات دفعات السداد للقسط ({inst.invoiceNumber})</span>
                                <span className="text-[11px] text-slate-400 font-mono">
                                  إجمالي المرات: {inst.payments?.length || 0}
                                </span>
                              </div>

                              {!inst.payments || inst.payments.length === 0 ? (
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
                                    {inst.payments.map((p, pIdx) => (
                                      <tr key={p.id || pIdx}>
                                        <td className="p-2 text-slate-400">{pIdx + 1}</td>
                                        <td className="p-2 text-slate-700 font-sans">
                                          {p.date} {p.time}
                                        </td>
                                        <td className="p-2 font-bold text-emerald-600">
                                          {p.amount.toFixed(2)} ج.م
                                        </td>
                                        <td className="p-2 font-sans text-slate-600">{p.paymentMethod}</td>
                                        <td className="p-2 font-sans text-slate-600">{p.receivedByName}</td>
                                        <td className="p-2 font-sans text-slate-400">{p.notes || '-'}</td>
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
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Payment Modal - shared with the customer ledger */}
      {activeInstallment && (
        <InstallmentPaymentModal
          installment={activeInstallment}
          currentUser={currentUser}
          onClose={() => setActiveInstallment(null)}
          onPaid={() => {
            loadInstallments();
          }}
        />
      )}
    </div>
  );
};
