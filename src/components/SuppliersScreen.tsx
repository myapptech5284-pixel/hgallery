import React, { useState, useEffect, useMemo } from 'react';
import { Supplier, SupplierSummary, User } from '../types.ts';
import { api } from '../services/api.ts';
import {
  Truck,
  Plus,
  Search,
  Phone,
  MapPin,
  Pencil,
  Trash2,
  X,
  BookOpen,
  Wallet,
  Package,
  Undo2,
  Building2,
} from 'lucide-react';
import { SupplierLedgerModal } from './SupplierLedgerModal.tsx';

interface SuppliersScreenProps {
  currentUser: User;
}

const money = (value: any) => (Number(value) || 0).toFixed(2);

const EMPTY_SUMMARY: SupplierSummary = {
  supplyCount: 0,
  itemCount: 0,
  totalPurchases: 0,
  totalReturns: 0,
  netPurchases: 0,
};

/**
 * Supplier directory — its own screen, fully separate from customers.
 * Each row shows the purchase-side totals and opens a full supplier
 * ledger with every restocking movement and a running statement.
 */
export const SuppliersScreen: React.FC<SuppliersScreenProps> = ({ currentUser }) => {
  const isAdmin = currentUser.role === 'admin';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Ledger
  const [ledgerSupplierId, setLedgerSupplierId] = useState<string | null>(null);

  // Add / edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getSuppliers();
      setSuppliers(data || []);
    } catch (err) {
      console.error('Failed to load suppliers:', err);
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
    setCompany('');
    setAddress('');
    setNotes('');
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setEditingId(supplier.id);
    setName(supplier.name || '');
    setPhone(supplier.phone || '');
    setCompany(supplier.company || '');
    setAddress(supplier.address || '');
    setNotes(supplier.notes || '');
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
        company: company.trim(),
        address: address.trim(),
        notes: notes.trim(),
      };

      const res = editingId
        ? await api.updateSupplier(editingId, payload)
        : await api.createSupplier(payload);

      if (res.success) {
        setShowModal(false);
        loadData();
      } else {
        setFormError(res.error || (editingId ? 'فشل تعديل بيانات المورد' : 'فشل إضافة المورد'));
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
      const res = await api.deleteSupplier(deleteTarget.id);
      if (res.success) {
        setDeleteTarget(null);
        loadData();
      } else {
        setDeleteError(res.error || 'فشل حذف المورد');
      }
    } catch (err: any) {
      setDeleteError(err.message || 'فشل الاتصال بالخادم');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredSuppliers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.phone.toLowerCase().includes(query) ||
        (s.company || '').toLowerCase().includes(query) ||
        (s.address || '').toLowerCase().includes(query)
    );
  }, [suppliers, searchQuery]);

  const portfolio = useMemo(() => {
    return suppliers.reduce(
      (acc, s) => {
        const sum = s.summary || EMPTY_SUMMARY;
        acc.totalPurchases += sum.totalPurchases;
        acc.netPurchases += sum.netPurchases;
        acc.itemCount += sum.itemCount;
        return acc;
      },
      { totalPurchases: 0, netPurchases: 0, itemCount: 0 }
    );
  }, [suppliers]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-600" />
            <span>دليل الموردين</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            سجل الموردين منفصل تماماً عن العملاء، ويشمل كل حركات التوريد والمرتجعات لكل مورد
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مورد جديد</span>
        </button>
      </div>

      {/* Portfolio summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-1.5 mb-1">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-semibold text-slate-500">عدد الموردين</span>
          </div>
          <span className="text-base font-extrabold font-mono text-slate-900">{suppliers.length}</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-1.5 mb-1">
            <Wallet className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[11px] font-semibold text-slate-500">إجمالي المشتريات</span>
          </div>
          <span className="text-base font-extrabold font-mono text-indigo-700">{money(portfolio.totalPurchases)}</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-1.5 mb-1">
            <Package className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[11px] font-semibold text-slate-500">صافي المشتريات بعد المرتجعات</span>
          </div>
          <span className="text-base font-extrabold font-mono text-emerald-700">{money(portfolio.netPurchases)}</span>
          <span className="text-[10px] text-slate-400 block mt-0.5">{portfolio.itemCount} قطعة موردة</span>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs mb-4">
        <div className="relative max-w-md">
          <input
            type="text"
            data-search-input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم المورد أو الشركة أو الهاتف... (Alt+S)"
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">اسم المورد</th>
                <th className="p-3">الشركة / المؤسسة</th>
                <th className="p-3">رقم الهاتف</th>
                <th className="p-3 text-center">حركات التوريد</th>
                <th className="p-3 text-center">إجمالي المشتريات</th>
                <th className="p-3 text-center">مرتجعات</th>
                <th className="p-3">آخر توريد</th>
                <th className="p-3 text-center">السجل</th>
                {isAdmin && <th className="p-3 text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    جاري التحميل...
                  </td>
                </tr>
              ) : filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    {suppliers.length === 0 ? 'لا يوجد موردين مسجلين — ابدأ بإضافة مورد جديد' : 'لا توجد نتائج مطابقة للبحث'}
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((s, idx) => {
                  const summary = s.summary || EMPTY_SUMMARY;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="p-3 font-bold text-slate-800">
                        {s.name}
                        {s.address && (
                          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5 font-normal">
                            <MapPin className="w-3 h-3" />
                            {s.address}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-indigo-700 font-semibold">{s.company || '-'}</td>
                      <td className="p-3 font-mono text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {s.phone}
                        </span>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-slate-700">
                        {summary.supplyCount}
                        <span className="text-[10px] text-slate-400 font-normal"> ({summary.itemCount} قطعة)</span>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-indigo-700">
                        {money(summary.totalPurchases)}
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-rose-600">
                        {summary.totalReturns > 0 ? money(summary.totalReturns) : '-'}
                      </td>
                      <td className="p-3 font-mono text-slate-500 text-[11px]">
                        {summary.lastActivityDate ? String(summary.lastActivityDate).substring(0, 10) : '-'}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => setLedgerSupplierId(s.id)}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 justify-center shadow-xs cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>فتح السجل</span>
                        </button>
                      </td>
                      {isAdmin && (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openEditModal(s)}
                              title="تعديل البيانات"
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setDeleteTarget(s);
                                setDeleteError(null);
                              }}
                              title="حذف المورد"
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

      {/* ---------------- Supplier ledger ---------------- */}
      {ledgerSupplierId && (
        <SupplierLedgerModal
          supplierId={ledgerSupplierId}
          onClose={() => setLedgerSupplierId(null)}
          onEdit={openEditModal}
        />
      )}

      {/* ---------------- Add / Edit modal ---------------- */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-base font-bold text-slate-800">
                {editingId ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
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

            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">اسم المورد المسؤول *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">اسم الشركة / المعمل</label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="مثال: شركة النصر للمنظفات"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
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
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">العنوان</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="المدينة / المنطقة"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">ملاحظات</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
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
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-xs cursor-pointer"
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
                <span>تأكيد حذف المورد</span>
              </h2>
              <button
                onClick={() => setDeleteTarget(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              هل تريد حذف المورد <span className="font-bold text-slate-800">{deleteTarget.name}</span> نهائياً
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