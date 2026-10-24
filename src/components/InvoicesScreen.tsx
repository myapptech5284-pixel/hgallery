import React, { useState, useEffect, useMemo } from 'react';
import { Invoice, User, InvoiceItem, LocationType, LOCATION_TYPES, LOCATION_SHORT_LABEL, LOCATION_BADGE, isLocationType } from '../types.ts';
import { api } from '../services/api.ts';
import { ThermalReceipt } from './ThermalReceipt.tsx';
import {
  Receipt,
  Search,
  Eye,
  Printer,
  X,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface InvoicesScreenProps {
  currentUser: User;
}

// The server always attaches `items` to every invoice it returns from
// GET /api/invoices, so rows are plain `Invoice` values here.
type InvoiceWithItems = Invoice;

/**
 * Which branch(es) an invoice actually touched.
 *
 * This screen deliberately does NOT split the gallery from the stationery:
 * one list shows every saved invoice. A single invoice may mix both
 * branches, so the badge is derived from its line items — `invoice_items.location`
 * is the source of truth — and falls back to the header `location` for old
 * rows that predate per-item locations.
 */
type BranchBadge = { kind: LocationType | 'mixed'; label: string };

function getInvoiceBranch(invoice: InvoiceWithItems): BranchBadge {
  const itemLocations = new Set<string>();
  for (const item of invoice.items || []) {
    const loc = (item as InvoiceItem).location || invoice.location;
    if (loc) itemLocations.add(loc);
  }
  if (itemLocations.size === 0) {
    const loc = invoice.location;
    if (isLocationType(loc)) return { kind: loc, label: LOCATION_SHORT_LABEL[loc] };
    return { kind: 'mixed', label: '—' };
  }
  if (itemLocations.size > 1) {
    const names = Array.from(itemLocations)
      .filter((l) => isLocationType(l))
      .map((l) => LOCATION_SHORT_LABEL[l as LocationType]);
    return { kind: 'mixed', label: names.length ? names.join(' + ') : '—' };
  }
  const only = itemLocations.values().next().value;
  if (isLocationType(only)) return { kind: only, label: LOCATION_SHORT_LABEL[only] };
  return { kind: 'mixed', label: '—' };
}

export const InvoicesScreen: React.FC<InvoicesScreenProps> = ({ currentUser }) => {
  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'cash' | 'installment'>('all');
  // Optional branch narrowing on top of the unified list. 'all' (default)
  // means "show everything" — the unified behaviour the screen is built for.
  const [filterBranch, setFilterBranch] = useState<'all' | LocationType>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceWithItems | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  // Always load EVERY invoice regardless of the global branch toggle: the
  // saved-invoices screen is one unified ledger for gallery + stationery.
  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const data = await api.getInvoices();
      setInvoices(data || []);
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  // Keyboard shortcuts: Ctrl+P (print) and Ctrl+X/Esc (close view)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod && e.key !== 'Escape') return;
      if (e.key === 'Escape' && selectedInvoice) {
        e.preventDefault();
        setSelectedInvoice(null);
        return;
      }
      if (!isMod) return;
      // Layout-independent key detection: accept either the typed letter
      // or the physical-key code so Arabic / non-Latin keyboards work.
      const k = (e.key || '').toLowerCase();
      const isPKey = k === 'p' || e.code === 'KeyP';
      const isXKey = k === 'x' || e.code === 'KeyX';
      if (isPKey && selectedInvoice) {
        e.preventDefault();
        handlePrint(selectedInvoice);
      } else if (isXKey && selectedInvoice) {
        e.preventDefault();
        setSelectedInvoice(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvoice]);

  const filtered = useMemo(() => {
    let list = invoices;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          (i.invoiceNumber || '').toLowerCase().includes(q) ||
          (i.customerName || '').toLowerCase().includes(q) ||
          (i.customerPhone || '').includes(q) ||
          (i.sellerName || '').toLowerCase().includes(q)
      );
    }
    if (filterDate) {
      list = list.filter((i) => (i.date || '').startsWith(filterDate));
    }
    if (filterPayment) {
      list = list.filter((i) => i.paymentMethod === filterPayment);
    }
    if (filterType === 'cash') {
      list = list.filter((i) => !i.isInstallment);
    } else if (filterType === 'installment') {
      list = list.filter((i) => i.isInstallment);
    }
    // Optional branch narrowing. Mixed invoices match BOTH branches so they
    // never disappear when the cashier filters by one of them.
    if (filterBranch !== 'all') {
      list = list.filter((i) => {
        const branch = getInvoiceBranch(i);
        return branch.kind === 'mixed' || branch.kind === filterBranch;
      });
    }
    return list;
  }, [invoices, searchQuery, filterDate, filterPayment, filterType, filterBranch]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const totals = useMemo(() => {
    let total = 0, paid = 0, remaining = 0, count = 0;
    for (const i of filtered) {
      total += i.total || 0;
      paid += i.paid || 0;
      remaining += i.remaining || 0;
      count += 1;
    }
    return { total, paid, remaining, count };
  }, [filtered]);

  const handlePrint = (inv: InvoiceWithItems) => {
    setSelectedInvoice(inv);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 font-sans" dir="rtl">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            الفواتير المحفوظة
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            كل الفواتير المحفوظة — المعرض والمكتبة والأدوات الكهربائية في صفحة واحدة
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1 text-[10px] text-slate-500 font-mono">
            <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-bold">Ctrl+P</kbd>
            <span>طباعة</span>
            <span className="mx-1 text-slate-300">|</span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-bold">Ctrl+X</kbd>
            <span>إغلاق</span>
          </div>
          <button
            type="button"
            onClick={fetchInvoices}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1.5"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            تحديث
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">بحث</label>
          <div className="relative">
            <input
              type="text"
              data-search-input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="رقم الفاتورة، اسم العميل، أو البائع (Alt+S)"
              className="w-full px-3 py-2 pr-9 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          </div>
        </div>
        <div className="w-40">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">التاريخ</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => { setFilterDate(e.target.value); setPage(1); }}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="w-36">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">الدفع</label>
          <select
            value={filterPayment}
            onChange={(e) => { setFilterPayment(e.target.value); setPage(1); }}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="">الكل</option>
            <option value="cash">نقدي</option>
            <option value="card">بطاقة</option>
            <option value="transfer">تحويل</option>
          </select>
        </div>
        <div className="w-36">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">النوع</label>
          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value as any); setPage(1); }}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="all">الكل</option>
            <option value="cash">فوري</option>
            <option value="installment">قسط</option>
          </select>
        </div>
        <div className="w-40">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">الفرع</label>
          <select
            value={filterBranch}
            onChange={(e) => { setFilterBranch(e.target.value as any); setPage(1); }}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="all">كل الفروع</option>
            <option value="gallery">المعرض</option>
            <option value="stationery">المكتبة</option>
            <option value="tools">الأدوات الكهربائية</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-right px-3 py-3 font-bold">رقم</th>
                <th className="text-right px-3 py-3 font-bold">التاريخ</th>
                <th className="text-right px-3 py-3 font-bold">العميل</th>
                <th className="text-right px-3 py-3 font-bold">الفرع</th>
                <th className="text-right px-3 py-3 font-bold">البائع</th>
                <th className="text-right px-3 py-3 font-bold">الدفع</th>
                <th className="text-left px-3 py-3 font-bold">الإجمالي</th>
                <th className="text-left px-3 py-3 font-bold">المتبقي</th>
                <th className="text-center px-3 py-3 font-bold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 text-sm">جاري التحميل...</td>
                </tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 text-sm">
                    {filtered.length === 0 && invoices.length === 0
                      ? 'لا توجد فواتير محفوظة بعد. ابدأ بإصدار فاتورة من تبويب "نقطة البيع السريع".'
                      : 'لا توجد فواتير تطابق الفلاتر الحالية.'}
                  </td>
                </tr>
              ) : (
                paged.map((inv) => (
                  <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3 font-mono font-bold text-slate-800">{inv.invoiceNumber}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      <div className="font-semibold">{inv.date}</div>
                      <div className="text-slate-400">{inv.time}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <div className="font-semibold">{inv.customerName || '—'}</div>
                      {inv.customerPhone && <div className="text-[10px] text-slate-400">{inv.customerPhone}</div>}
                    </td>
                    <td className="px-3 py-3">
                      {(() => {
                        const branch = getInvoiceBranch(inv);
                        if (branch.kind === 'mixed') {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold rounded-md">
                              {branch.label}
                            </span>
                          );
                        }
                        if (branch.kind === 'gallery') {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded-md">
                              معرض
                            </span>
                          );
                        }
                        if (branch.kind === 'stationery') {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-sky-50 border border-sky-200 text-sky-700 text-[10px] font-bold rounded-md">
                              مكتبة
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold rounded-md">
                            أدوات كهربائية
                          </span>
                        );
                        return <span className="text-slate-300 text-xs">—</span>;
                      })()}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      <div className="font-semibold">{inv.sellerName}</div>
                      <div className="text-slate-400 font-mono">{inv.sellerCode}</div>
                    </td>
                    <td className="px-3 py-3">
                      {inv.isInstallment ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold rounded-md">
                          قسط
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded-md">
                          {inv.paymentMethod === 'cash' ? 'نقدي' : inv.paymentMethod === 'card' ? 'بطاقة' : 'تحويل'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-left font-mono font-bold text-emerald-600">{inv.total.toFixed(2)}</td>
                    <td className="px-3 py-3 text-left font-mono font-bold text-rose-600">
                      {inv.remaining > 0 ? inv.remaining.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(inv)}
                          className="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors"
                          title="عرض التفاصيل"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrint(inv)}
                          className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                          title="طباعة الفاتورة"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              عرض {paged.length} من {filtered.length} فاتورة
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 hover:bg-slate-100 disabled:opacity-30 rounded-lg"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="font-mono font-bold mx-2">{page} / {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 hover:bg-slate-100 disabled:opacity-30 rounded-lg"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 print:bg-white print:p-0" dir="rtl">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto print:shadow-none print:max-w-full print:max-h-full print:rounded-none">
            <div className="sticky top-0 bg-white border-b border-slate-100 p-4 flex items-center justify-between print:hidden">
              <h3 className="text-base font-bold text-slate-800">تفاصيل الفاتورة {selectedInvoice.invoiceNumber}</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrint(selectedInvoice)}
                  className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg"
                  title="طباعة"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  className="p-2 hover:bg-rose-50 text-rose-600 rounded-lg"
                  title="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4">
              <ThermalReceipt
                invoice={selectedInvoice}
                onClose={() => setSelectedInvoice(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Print-only styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .fixed.inset-0, .fixed.inset-0 * { visibility: visible; }
          .fixed.inset-0 { position: absolute; left: 0; top: 0; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
};
