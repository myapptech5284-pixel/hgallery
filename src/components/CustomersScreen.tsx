import React, { useState, useEffect, useMemo } from 'react';
import { Customer, CustomerSummary, User } from '../types.ts';
import { api } from '../services/api.ts';
import {
  Users,
  Plus,
  Search,
  Phone,
  MapPin,
  Pencil,
  Trash2,
  X,
  BookOpen,
  Clock,
  UserPlus,
} from 'lucide-react';
import { CustomerLedgerModal } from './CustomerLedgerModal.tsx';

interface CustomersScreenProps {
  currentUser: User;
}

const money = (value: any) => (Number(value) || 0).toFixed(2);

const EMPTY_SUMMARY: CustomerSummary = {
  invoiceCount: 0,
  installmentCount: 0,
  openInstallmentCount: 0,
  overdueInstallmentCount: 0,
  totalInvoiced: 0,
  totalDiscount: 0,
  totalPaid: 0,
  totalRemaining: 0,
  totalReturns: 0,
  netSales: 0,
  installmentTotal: 0,
  installmentPaid: 0,
  installmentRemaining: 0,
};

/**
 * Customer directory — separated from suppliers into its own screen.
 *
 * Every row carries the customer's real business figures (sales, returns,
 * open installments, outstanding balance) and opens a full account ledger
 * where their invoices, installment invoices, payments and returns all
 * live together, with installment settlement available in place.
 */
export const CustomersScreen: React.FC<CustomersScreenProps> = ({ currentUser }) => {
  const isAdmin = currentUser.role === 'admin';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithDebt, setOnlyWithDebt] = useState(false);

  // Ledger
  const [ledgerCustomerId, setLedgerCustomerId] = useState<string | null>(null);

  // Add / edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getCustomers();
      setCustomers(data || []);
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openAddModal = () => {
    setEditingId(null);
    setName('');
    setPhone('');
    setAddress('');
    setNotes('');
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (customer: Customer) => {
    setEditingId(customer.id);
    setName(customer.name || '');
    setPhone(customer.phone || '');
    setAddress(customer.address || '');
    setNotes(customer.notes || '');
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !phone.trim()) {
      setFormError('الاسم ورقم الهاتف مطلوبان');
      return;
    }

    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
      };

      const res = editingId
        ? await api.updateCustomer(editingId, payload)
        : await api.createCustomer(payload);

      if (res.success) {
        setShowModal(false);
        loadData();
      } else {
        setFormError(res.error || (editingId ? 'فشل تعديل بيانات العميل' : 'فشل إضافة العميل'));
      }
    } catch (err: any) {
      setFormError(err.message || 'فشل الاتصال بالخادم');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await api.deleteCustomer(deleteTarget.id);
      if (res.success) {
        setDeleteTarget(null);
        loadData();
      } else {
        setDeleteError(res.error || 'فشل حذف العميل');
      }
    } catch (err: any) {
      setDeleteError(err.message || 'فشل الاتصال بالخادم');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return customers.filter((c) => {
      const summary = c.summary || EMPTY_SUMMARY;
      if (onlyWithDebt && (summary.totalRemaining || 0) <= 0) return false;
      if (!query) return true;
      return (
        c.name.toLowerCase().includes(query) ||
        c.phone.toLowerCase().includes(query) ||
        (c.address || '').toLowerCase().includes(query)
      );
    });
  }, [customers, searchQuery, onlyWithDebt]);

  // The portfolio KPI strip that used to sit above this list was removed at
  // the owner's request — the directory is now contacts + per-row figures and
  // the ledger modal, nothing else. Money totals live in التقارير instead.

  const ledgerCustomer = customers.find((c) => c.id === ledgerCustomerId) || null;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            <span>دليل العملاء</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            كل عميل ومعه سجله الكامل: الفواتير والمشتريات وفواتير التقسيط وسدادها من مكان واحد
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>إضافة عميل جديد</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <input
            type="text"
            data-search-input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم العميل أو رقم الهاتف أو العنوان... (Alt+S)"
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnlyWithDebt((v) => !v)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              onlyWithDebt ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>عليهم مستحقات فقط</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">اسم العميل</th>
                <th className="p-3">رقم الهاتف</th>
                <th className="p-3 text-center">عدد الفواتير</th>
                <th className="p-3 text-center">صافي المشتريات</th>
                <th className="p-3 text-center">المسدد</th>
                <th className="p-3 text-center">المتبقي</th>
                <th className="p-3 text-center">أقساط</th>
                <th className="p-3">آخر تعامل</th>
                <th className="p-3 text-center">السجل</th>
                {isAdmin && <th className="p-3 text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
                    جاري التحميل...
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
                    {customers.length === 0 ? 'لا يوجد عملاء مسجلين — ابدأ بإضافة عميل جديد' : 'لا توجد نتائج مطابقة للبحث'}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c, idx) => {
                  const s = c.summary || EMPTY_SUMMARY;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{c.name}</div>
                        {c.address && (
                          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            {c.address}
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {c.phone}
                        </span>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-slate-700">{s.invoiceCount}</td>
                      <td className="p-3 text-center font-mono font-bold text-emerald-700">{money(s.netSales)}</td>
                      <td className="p-3 text-center font-mono font-bold text-emerald-600">{money(s.totalPaid)}</td>
                      <td
                        className={`p-3 text-center font-mono font-extrabold ${
                          s.totalRemaining > 0 ? 'text-rose-600' : 'text-slate-400'
                        }`}
                      >
                        {money(s.totalRemaining)}
                      </td>
                      <td className="p-3 text-center">
                        {s.openInstallmentCount > 0 ? (
                          <span className="inline-flex flex-col items-center gap-0.5">
                            <span className="font-mono font-extrabold text-amber-700">
                              {money(s.installmentRemaining)}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {s.openInstallmentCount} قسط
                              {s.overdueInstallmentCount > 0 && (
                                <span className="text-rose-600 font-bold"> ({s.overdueInstallmentCount} متأخر)</span>
                              )}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono">-</span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-500 text-[11px]">
                        {s.lastActivityDate ? String(s.lastActivityDate).substring(0, 10) : '-'}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => setLedgerCustomerId(c.id)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 justify-center shadow-xs cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>فتح السجل</span>
                        </button>
                      </td>
                      {isAdmin && (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openEditModal(c)}
                              title="تعديل البيانات"
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setDeleteTarget(c);
                                setDeleteError(null);
                              }}
                              title="حذف العميل"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- Customer ledger ---------------- */}
      {ledgerCustomerId && (
        <CustomerLedgerModal
          customerId={ledgerCustomerId}
          currentUser={currentUser}
          onClose={() => setLedgerCustomerId(null)}
          onEdit={openEditModal}
          onChanged={loadData}
        />
      )}

      {/* ---------------- Add / Edit modal ---------------- */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                {editingId ? <Pencil className="w-4 h-4 text-emerald-600" /> : <Plus className="w-4 h-4 text-emerald-600" />}
                <span>{editingId ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}</span>
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                {formError}
              </div>
            )}

            {editingId && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded-xl">
                تنبيه: الفواتير السابقة مرتبطة برقم الهاتف القديم. إذا غيّرت الرقم فلن تظهر الفواتير
                السابقة داخل السجل الجديد.
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">اسم العميل *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">رقم الهاتف *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010xxxxxxxx"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">العنوان</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="المدينة / المنطقة"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">ملاحظات</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  data-save-button
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  {editingId ? 'حفظ التعديلات' : 'حفظ السجل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- Delete confirm ---------------- */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-600" />
                <span>تأكيد حذف العميل</span>
              </h2>
              <button
                onClick={() => setDeleteTarget(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              هل تريد حذف العميل <span className="font-bold text-slate-800">{deleteTarget.name}</span> نهائياً
              من الدليل؟
            </p>

            {deleteError && (
              <div className="mt-3 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                {deleteError}
              </div>
            )}

            <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-300 text-white font-bold rounded-xl cursor-pointer"
              >
                {isDeleting ? 'جاري الحذف...' : 'حذف نهائي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};