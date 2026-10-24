import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { FinancialReport, LocationType, User, Employee , LOCATION_LABEL } from '../types.ts';
import { LocationTabs } from './LocationTabs.tsx';
import { api } from '../services/api.ts';
import {
  BarChart3,
  Calendar,
  Download,
  Filter,
  TrendingUp,
  DollarSign,
  CreditCard,
  UserCheck,
  Package,
  Layers,
  Sparkles,
  ArrowDownRight,
  ArrowUpRight,
  Store,
  BookOpen,
} from 'lucide-react';

interface ReportsScreenProps {
  currentUser: User;
  activeLocation: LocationType;
  onLocationChange: (loc: LocationType) => void;
}

export const ReportsScreen: React.FC<ReportsScreenProps> = ({
  currentUser,
  activeLocation,
  onLocationChange,
}) => {
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [todayData, setTodayData] = useState<{
    invoiceCount: number;
    totalSales: number;
    totalPaid: number;
    totalRemaining: number;
    totalProfit: number;
  } | null>(null);

  // Inventory snapshot — number of distinct products, total units in stock,
  // and total stock value (= sum of quantity × purchaseCost). Loaded once
  // per location change; the user toggles the section open/closed via
  // `inventoryCollapsed` (default closed — saves vertical space).
  const [inventory, setInventory] = useState<{
    productCount: number;
    unitsInStock: number;
    totalValue: number;
    lowStockCount: number;
  } | null>(null);
  const [inventoryCollapsed, setInventoryCollapsed] = useState(true);

  // Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSellerId, setSelectedSellerId] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');

  const fetchReport = async () => {
    setLoading(true);
    try {
      const [reportData, empData, todayRes] = await Promise.all([
        api.getFinancialReport({
          location: activeLocation,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          sellerId: selectedSellerId || undefined,
          paymentMethod: selectedPaymentMethod || undefined,
        }),
        api.getEmployees(),
        api.getTodayReport({
          location: activeLocation,
          sellerId: selectedSellerId || undefined,
        }),
      ]);
      setReport(reportData);
      setEmployees(empData);
      setTodayData({
        invoiceCount: todayRes.invoiceCount || 0,
        totalSales: todayRes.totalSales || 0,
        totalPaid: todayRes.totalPaid || 0,
        totalRemaining: todayRes.totalRemaining || 0,
        totalProfit: todayRes.totalProfit || 0,
      });
    } catch (err) {
      console.error('Failed to fetch financial report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    fetchInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation, startDate, endDate, selectedSellerId, selectedPaymentMethod]);

  const fetchInventory = async () => {
    try {
      const products = await api.getProducts({ location: activeLocation });
      let unitsInStock = 0;
      let totalValue = 0;
      let lowStockCount = 0;
      for (const p of products) {
        const q = Number(p.quantity) || 0;
        const c = Number(p.purchaseCost) || 0;
        unitsInStock += q;
        totalValue += q * c;
        if (q <= 5) lowStockCount += 1;
      }
      setInventory({
        productCount: products.length,
        unitsInStock,
        totalValue,
        lowStockCount,
      });
    } catch (err) {
      console.error('Failed to fetch inventory snapshot:', err);
    }
  };

  const handleExportExcel = () => {
    if (!report) return;

    const workbook = XLSX.utils.book_new();
    const locArabic = LOCATION_LABEL[activeLocation];

    // Summary Sheet
    const summaryData = [
      { 'البند المالي': 'الموقع التشغيلي', 'القيمة': locArabic },
      { 'البند المالي': 'إجمالي المبيعات الإجمالية', 'القيمة': report.summary.totalGrossSales },
      { 'البند المالي': 'إجمالي الخصومات الممنوحة', 'القيمة': report.summary.totalDiscounts },
      { 'البند المالي': 'صافي المبيعات المحققة', 'القيمة': report.summary.totalNetSales },
      { 'البند المالي': 'إجمالي ربح المبيعات الفعلي', 'القيمة': report.summary.grossProfitFromSales },
      { 'البند المالي': 'المصروفات التشغيلية', 'القيمة': report.summary.totalExpenses },
      { 'البند المالي': 'رواتب الموظفين', 'القيمة': report.summary.totalSalaries },
      { 'البند المالي': 'قيمة الهوالك والتالف', 'القيمة': report.summary.totalScrap },
      { 'البند المالي': 'صافي الربح النهائي الشامل', 'القيمة': report.summary.netProfit },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, wsSummary, 'الملخص المالي');

    // Employee Performance Sheet
    const empData = report.sellerPerformance.map((s, idx) => ({
      '#': idx + 1,
      'اسم الموظف': s.sellerName,
      'كود الموظف': s.sellerCode,
      'عدد الفواتير': s.invoiceCount,
      'إجمالي المبيعات': s.totalSales,
      'الأرباح المحققة': s.totalProfit,
      'الخصومات الممنوحة': s.totalDiscount,
    }));
    const wsEmp = XLSX.utils.json_to_sheet(empData);
    XLSX.utils.book_append_sheet(workbook, wsEmp, 'أداء الموظفين');

    // Top Products Sheet
    const prodData = report.productPerformance.map((p, idx) => ({
      '#': idx + 1,
      'اسم المنتج': p.productName,
      'الكود': p.sku,
      'الكمية المباعة': p.quantitySold,
      'إجمالي المبيعات': p.totalSales,
      'إجمالي الربح': p.totalProfit,
    }));
    const wsProd = XLSX.utils.json_to_sheet(prodData);
    XLSX.utils.book_append_sheet(workbook, wsProd, 'أداء المنتجات');

    XLSX.writeFile(workbook, `تقرير-${locArabic}-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Today's Sales Widget */}
      {todayData && (
        <div className="bg-gradient-to-l from-emerald-500 to-emerald-600 text-white rounded-2xl p-4 mb-6 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              <h2 className="text-base font-bold">مبيعات اليوم</h2>
              <span className="text-xs text-emerald-100 font-mono">
                {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>
            </div>
            <button
              type="button"
              onClick={fetchReport}
              className="text-xs bg-white/20 hover:bg-white/30 px-2.5 py-1 rounded-lg font-semibold transition-colors"
            >
              تحديث
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white/15 rounded-xl p-3">
              <div className="text-[10px] text-emerald-100 font-bold mb-1">عدد الفواتير</div>
              <div className="text-xl font-bold font-mono">{todayData.invoiceCount}</div>
            </div>
            <div className="bg-white/15 rounded-xl p-3">
              <div className="text-[10px] text-emerald-100 font-bold mb-1">إجمالي المبيعات</div>
              <div className="text-xl font-bold font-mono">{todayData.totalSales.toFixed(2)} ج.م</div>
            </div>
            <div className="bg-white/15 rounded-xl p-3">
              <div className="text-[10px] text-emerald-100 font-bold mb-1">المحصّل</div>
              <div className="text-xl font-bold font-mono">{todayData.totalPaid.toFixed(2)} ج.م</div>
            </div>
            <div className="bg-white/15 rounded-xl p-3">
              <div className="text-[10px] text-emerald-100 font-bold mb-1">المتبقي (أقساط)</div>
              <div className="text-xl font-bold font-mono">{todayData.totalRemaining.toFixed(2)} ج.م</div>
            </div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            <span>التقارير المالية والتشغيلية المستقلة</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            فصل تام بين تقارير المعرض والمكتبة والأدوات الكهربائية مع تطبيق معادلة صافي الربح الدقيقة
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Location Switcher */}
          <LocationTabs
            activeLocation={activeLocation}
            onLocationChange={onLocationChange}
            label={(loc) => `تقارير ${LOCATION_LABEL[loc]}`}
          />

          <button
            onClick={handleExportExcel}
            disabled={!report}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>تصدير تقرير شامل إلى Excel</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-3.5 rounded-2xl shadow-xs border border-slate-200 mb-6 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1 text-slate-600 font-bold">
          <Filter className="w-4 h-4 text-emerald-600" />
          <span>تصفية التقرير:</span>
        </div>

        <div>
          <input
            type="date"
            data-search-input
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            title="من تاريخ"
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            title="إلى تاريخ"
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <select
            value={selectedSellerId}
            onChange={(e) => setSelectedSellerId(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-emerald-500"
          >
            <option value="">-- كل الموظفين والبائعين --</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.employeeCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={selectedPaymentMethod}
            onChange={(e) => setSelectedPaymentMethod(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-emerald-500"
          >
            <option value="">-- كل طرق الدفع --</option>
            <option value="cash">نقدي</option>
            <option value="card">شبكة / بطاقة</option>
            <option value="installment">تقسيط</option>
          </select>
        </div>

        {(startDate || endDate || selectedSellerId || selectedPaymentMethod) && (
          <button
            onClick={() => {
              setStartDate('');
              setEndDate('');
              setSelectedSellerId('');
              setSelectedPaymentMethod('');
            }}
            className="text-xs text-rose-600 hover:text-rose-800 font-semibold cursor-pointer"
          >
            إعادة تعيين الفلاتر
          </button>
        )}
      </div>

      {loading || !report ? (
        <div className="p-12 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
          جاري تجهيز وحساب التقرير المالي...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Main Financial KPI Formula Grid */}
          <div className="bg-white rounded-2xl shadow-sm p-6 text-slate-800 border border-slate-200">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-100 mb-6 gap-2">
              <div>
                <span className="text-xs text-emerald-600 font-bold block">معادلة صافي الربح المعتمدة</span>
                <h2 className="text-lg font-bold text-slate-900">
                  ملخص الأرباح والتدفقات لـ {LOCATION_LABEL[activeLocation]}
                </h2>
              </div>
              <span className="text-xs text-slate-500 font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                صافي الربح = ربح المبيعات − (المصروفات + الرواتب + الهوالك)
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-500 font-semibold block mb-1">إجمالي المبيعات المحققة</span>
                <span className="text-xl font-extrabold text-slate-800 font-mono">
                  {report.summary.totalNetSales.toFixed(2)} ج.م
                </span>
                <span className="text-[10px] text-slate-400 block mt-1 font-medium">
                  الخصومات: {report.summary.totalDiscounts.toFixed(2)} ج.م
                </span>
              </div>

              <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200/80">
                <span className="text-xs text-emerald-700 font-bold block mb-1">إجمالي ربح المبيعات</span>
                <span className="text-xl font-extrabold text-emerald-700 font-mono">
                  +{report.summary.grossProfitFromSales.toFixed(2)} ج.م
                </span>
                <span className="text-[10px] text-emerald-600 block mt-1 font-medium">
                  (سعر البيع − سعر الشراء)
                </span>
              </div>

              <div className="bg-rose-50/70 p-4 rounded-xl border border-rose-200/80">
                <span className="text-xs text-rose-700 font-bold block mb-1">إجمالي المنصرفات والهوالك</span>
                <span className="text-xl font-extrabold text-rose-700 font-mono">
                  -{ (report.summary.totalExpenses + report.summary.totalSalaries + report.summary.totalScrap).toFixed(2) } ج.م
                </span>
                <span className="text-[10px] text-rose-600 block mt-1 font-medium">
                  تشغيلي + رواتب + هوالك
                </span>
              </div>

              <div className="bg-emerald-600 text-white p-4 rounded-xl shadow-xs">
                <span className="text-xs text-emerald-100 font-bold block mb-1">صافي الربح النهائي</span>
                <span className="text-2xl font-black text-white font-mono">
                  {report.summary.netProfit.toFixed(2)} ج.م
                </span>
                <span className="text-[10px] text-emerald-100 block mt-1">
                  الأرباح الصافية بعد كافة الاستقطاعات
                </span>
              </div>
            </div>

            {/* Expenses breakdown pill counters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-slate-100 text-xs">
              <div className="flex justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-200/60">
                <span className="text-slate-500">المصروفات التشغيلية:</span>
                <span className="font-mono font-bold text-slate-800">{report.summary.totalExpenses.toFixed(2)} ج.م</span>
              </div>
              <div className="flex justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-200/60">
                <span className="text-slate-500">رواتب الموظفين المستحقة:</span>
                <span className="font-mono font-bold text-slate-800">{report.summary.totalSalaries.toFixed(2)} ج.م</span>
              </div>
              <div className="flex justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-200/60">
                <span className="text-slate-500">قيمة الهوالك والتالف:</span>
                <span className="font-mono font-bold text-amber-600">{report.summary.totalScrap.toFixed(2)} ج.م</span>
              </div>
            </div>
          </div>

          {/* Section: Installments Analytics */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-amber-600" />
                <span>قسم تقارير الأقساط والتحصيل المستقل</span>
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {report.installments.dueCount} قسط قيد المتابعة
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[11px] text-slate-500 block">إجمالي مبيعات الأقساط</span>
                <span className="text-lg font-bold text-slate-800 font-mono">
                  {report.installments.totalSales.toFixed(2)} ج.م
                </span>
              </div>
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                <span className="text-[11px] text-emerald-800 block">أرباح مبيعات الأقساط</span>
                <span className="text-lg font-bold text-emerald-700 font-mono">
                  {report.installments.totalProfit.toFixed(2)} ج.م
                </span>
              </div>
              <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100">
                <span className="text-[11px] text-indigo-800 block">المبالغ المسددة والمحصلة</span>
                <span className="text-lg font-bold text-indigo-700 font-mono">
                  {report.installments.totalCollected.toFixed(2)} ج.م
                </span>
              </div>
              <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-100">
                <span className="text-[11px] text-amber-900 block">المطلوب تحصيله (المتبقي)</span>
                <span className="text-lg font-bold text-amber-800 font-mono">
                  {report.installments.totalRemaining.toFixed(2)} ج.م
                </span>
              </div>
            </div>
          </div>

          {/* Grid: Seller Performance & Top Products */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Seller Performance Table */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-5">
              <h3 className="font-bold text-sm text-slate-800 mb-3 pb-2 border-b border-slate-100 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-indigo-600" />
                  <span>أداء الموظفين والبائعين الفعلي</span>
                </span>
                <span className="text-[11px] text-slate-400">حسب فواتير الموظف المسجلة</span>
              </h3>

              {report.sellerPerformance.length === 0 ? (
                <div className="text-center text-slate-400 text-xs py-8">لا توجد مبيعات مسجلة في هذه الفترة</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-bold">
                      <tr>
                        <th className="p-2.5">الموظف</th>
                        <th className="p-2.5 text-center">الفواتير</th>
                        <th className="p-2.5 text-center">المبيعات</th>
                        <th className="p-2.5 text-center">الأرباح</th>
                        <th className="p-2.5 text-center">الخصومات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {report.sellerPerformance.map((s, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 font-sans font-bold text-slate-800">
                            {s.sellerName}
                            <span className="text-slate-400 text-[10px] block font-mono">كود: {s.sellerCode}</span>
                          </td>
                          <td className="p-2.5 text-center text-slate-700">{s.invoiceCount}</td>
                          <td className="p-2.5 text-center font-bold text-slate-900">
                            {s.totalSales.toFixed(2)}
                          </td>
                          <td className="p-2.5 text-center font-bold text-emerald-600">
                            +{s.totalProfit.toFixed(2)}
                          </td>
                          <td className="p-2.5 text-center text-rose-500">
                            {s.totalDiscount.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Top Products Table */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-5">
              <h3 className="font-bold text-sm text-slate-800 mb-3 pb-2 border-b border-slate-100 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-emerald-600" />
                  <span>الأصناف والمنتجات الأكثر مبيعاً</span>
                </span>
                <span className="text-[11px] text-slate-400">الأعلى مساهمة في الأرباح</span>
              </h3>

              {report.productPerformance.length === 0 ? (
                <div className="text-center text-slate-400 text-xs py-8">لا توجد مبيعات أصناف مسجلة</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-bold">
                      <tr>
                        <th className="p-2.5">اسم الصنف</th>
                        <th className="p-2.5 text-center">الكمية المباعة</th>
                        <th className="p-2.5 text-center">إجمالي البيع</th>
                        <th className="p-2.5 text-center">الربح المحقق</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {report.productPerformance.slice(0, 8).map((p, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 font-sans font-bold text-slate-800">
                            {p.productName}
                            <span className="text-slate-400 text-[10px] block font-mono">كود: {p.sku}</span>
                          </td>
                          <td className="p-2.5 text-center font-bold text-slate-700">{p.quantitySold}</td>
                          <td className="p-2.5 text-center text-slate-800">{p.totalSales.toFixed(2)}</td>
                          <td className="p-2.5 text-center font-bold text-emerald-600">
                            +{p.totalProfit.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Inventory Snapshot — collapsible, default closed. Shows the
              number of distinct products, total units in stock, and total
              stock value (= Σ quantity × purchaseCost). */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200">
            <div className="flex items-center justify-between gap-2 p-4 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                تقرير المخزون (عدد الأصناف + إجمالي قيمة المخزون)
              </h3>
              <button
                type="button"
                onClick={() => setInventoryCollapsed((v) => !v)}
                className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold rounded-lg text-xs flex items-center gap-1"
                title={inventoryCollapsed ? 'إظهار تقرير المخزون' : 'طي تقرير المخزون'}>
                {inventoryCollapsed ? '▼ إظهار' : '▲ طي'}
              </button>
            </div>
            {!inventoryCollapsed && (
              <div className="p-5">
                {!inventory ? (
                  <div className="text-center text-slate-400 text-xs py-6">جاري تحميل بيانات المخزون...</div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                        <div className="text-[11px] font-bold text-emerald-700 mb-1">عدد الأصناف (المنتجات)</div>
                        <div className="text-2xl font-bold font-mono text-emerald-900">{inventory.productCount}</div>
                        <div className="text-[10px] text-emerald-600 mt-1">منتج مسجل في الموقع الحالي</div>
                      </div>
                      <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
                        <div className="text-[11px] font-bold text-sky-700 mb-1">إجمالي الوحدات في المخزون</div>
                        <div className="text-2xl font-bold font-mono text-sky-900">{inventory.unitsInStock.toLocaleString('ar-EG')}</div>
                        <div className="text-[10px] text-sky-600 mt-1">إجمالي الكميات الفعلية</div>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <div className="text-[11px] font-bold text-amber-700 mb-1">إجمالي قيمة المخزون</div>
                        <div className="text-2xl font-bold font-mono text-amber-900">
                          {inventory.totalValue.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م
                        </div>
                        <div className="text-[10px] text-amber-600 mt-1">محسوب بسعر التكلفة × الكمية</div>
                      </div>
                    </div>
                    {inventory.lowStockCount > 0 && (
                      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 flex items-center gap-2">
                        <span className="text-base">⚠</span>
                        يوجد <b className="font-bold mx-1">{inventory.lowStockCount}</b> صنف/أصناف على وشك النفاد (≤ 5 وحدات).
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
