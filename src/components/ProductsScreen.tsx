import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Product, LocationType, User } from '../types.ts';
import { api } from '../services/api.ts';
import { useFormShortcuts, focusRef } from '../hooks/useFormShortcuts.ts';
import {
  Package,
  Plus,
  Search,
  ArrowLeftRight,
  Download,
  Upload,
  AlertTriangle,
  Edit2,
  Trash2,
  Filter,
  Check,
  X,
  Store,
  BookOpen,
} from 'lucide-react';

interface ProductsScreenProps {
  currentUser: User;
  activeLocation: LocationType;
  onLocationChange: (loc: LocationType) => void;
}

export const ProductsScreen: React.FC<ProductsScreenProps> = ({
  currentUser,
  activeLocation,
  onLocationChange,
}) => {
  const isAdmin = currentUser.role === 'admin';

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [lowStockFilter, setLowStockFilter] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTargetProduct, setTransferTargetProduct] = useState<Product | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  // Form states for Add/Edit
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('قطعة');
  const [location, setLocation] = useState<LocationType>(activeLocation);
  const [quantity, setQuantity] = useState<number>(0);
  const [salePrice, setSalePrice] = useState<number>(0);
  const [purchaseCost, setPurchaseCost] = useState<number>(0);
  const [minStockAlert, setMinStockAlert] = useState<number>(5);
  const [category, setCategory] = useState('أدوات منزلية');
  const [formError, setFormError] = useState<string | null>(null);

  // Transfer form states
  const [transferQty, setTransferQty] = useState<number>(1);
  const [transferNotes, setTransferNotes] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);

  // Import states
  const [importErrors, setImportErrors] = useState<{ rowNumber: number; reason: string; data: any }[]>([]);
  const [importSummary, setImportSummary] = useState<{ imported: number; errors: number } | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Refs for keyboard-shortcut focus management (Add/Edit product modal)
  const skuInputRef = focusRef<HTMLInputElement>();
  const nameInputRef = focusRef<HTMLInputElement>();
  const unitInputRef = focusRef<HTMLInputElement>();
  const purchaseInputRef = focusRef<HTMLInputElement>();
  const saleInputRef = focusRef<HTMLInputElement>();
  const minStockInputRef = focusRef<HTMLInputElement>();
  const quantityInputRef = focusRef<HTMLInputElement>();
  const categoryInputRef = focusRef<HTMLInputElement>();
  const saveButtonRef = focusRef<HTMLButtonElement>();
  const searchInputRef = focusRef<HTMLInputElement>();
  const addButtonRef = focusRef<HTMLButtonElement>();

  // Wire keyboard shortcuts for the Add/Edit modal.
  const formShortcuts = useMemo(() => ({
    'escape': () => setShowAddModal(false),
    'alt+c': () => skuInputRef.current?.focus(),
    'alt+n': () => nameInputRef.current?.focus(),
    'alt+u': () => unitInputRef.current?.focus(),
    'alt+b': () => purchaseInputRef.current?.focus(),
    'alt+p': () => saleInputRef.current?.focus(),
    'alt+q': () => quantityInputRef.current?.focus(),
    'alt+d': () => minStockInputRef.current?.focus(),
    'alt+g': () => categoryInputRef.current?.focus(),
    'ctrl+enter': () => saveButtonRef.current?.click(),
  }), []);
  useFormShortcuts(formShortcuts, showAddModal);

  // Page-level shortcuts: Ctrl+N opens the Add modal, Alt+S focuses search.
  const pageShortcuts = useMemo(() => ({
    'ctrl+n': (e: KeyboardEvent) => {
      // Don't capture Ctrl+N when a modal is open or when typing in inputs.
      if (showAddModal || showTransferModal || showImportModal) return;
      e.preventDefault();
      openAddModal();
      // Focus the SKU field after the modal renders.
      setTimeout(() => skuInputRef.current?.focus(), 50);
    },
    'alt+s': () => searchInputRef.current?.focus(),
  }), [showAddModal, showTransferModal, showImportModal]);
  useFormShortcuts(pageShortcuts, true);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const data = await api.getProducts({
        location: activeLocation,
        search: searchQuery,
        lowStock: lowStockFilter,
      });
      setProducts(data);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    setLocation(activeLocation);
  }, [activeLocation, searchQuery, lowStockFilter]);

  const openAddModal = () => {
    setEditingProduct(null);
    setName('');
    setSku('');
    setUnit('قطعة');
    setLocation(activeLocation);
    setQuantity(0);
    setSalePrice(0);
    setPurchaseCost(0);
    setMinStockAlert(5);
    setCategory(activeLocation === 'gallery' ? 'أدوات منزلية' : 'قرطاسية');
    setFormError(null);
    setShowAddModal(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setSku(p.sku);
    setUnit(p.unit);
    setLocation(p.location);
    setQuantity(p.quantity);
    setSalePrice(p.salePrice);
    setPurchaseCost(p.purchaseCost);
    setMinStockAlert(p.minStockAlert);
    setCategory(p.category);
    setFormError(null);
    setShowAddModal(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !sku.trim()) {
      setFormError('اسم المنتج والكود/الباركود مطلوبان');
      return;
    }

    try {
      if (editingProduct) {
        const res = await api.updateProduct(editingProduct.id, {
          name,
          sku,
          unit,
          quantity,
          salePrice,
          purchaseCost,
          minStockAlert,
          category,
        });
        if (res.success) {
          setShowAddModal(false);
          fetchProducts();
        } else {
          setFormError(res.error || 'حدث خطأ أثناء تعديل المنتج');
        }
      } else {
        const res = await api.createProduct({
          name,
          sku,
          barcode: sku, // Unified
          unit,
          location,
          quantity,
          salePrice,
          purchaseCost,
          minStockAlert,
          category,
        });
        if (res.success) {
          setShowAddModal(false);
          fetchProducts();
        } else {
          setFormError(res.error || 'حدث خطأ أثناء إضافة المنتج');
        }
      }
    } catch (err: any) {
      setFormError(err.message || 'فشل الاتصال بالخادم');
    }
  };

  const handleDeleteProduct = async (id: string, prodName: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف المنتج (${prodName}) نهائياً من المخزون؟`)) return;
    try {
      const res = await api.deleteProduct(id);
      if (res.success) {
        fetchProducts();
      } else {
        alert(res.error || 'فشل حذف المنتج');
      }
    } catch (err: any) {
      alert(err.message || 'فشل الاتصال بالخادم');
    }
  };

  // Inter-location transfer: Product shifts completely or relocates quantity
  const openTransferModal = (p: Product) => {
    setTransferTargetProduct(p);
    setTransferQty(p.quantity);
    setTransferNotes('');
    setTransferError(null);
    setShowTransferModal(true);
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTargetProduct) return;
    setTransferError(null);

    const destinationLoc: LocationType = transferTargetProduct.location === 'gallery' ? 'stationery' : 'gallery';

    try {
      const res = await api.transferProduct({
        productId: transferTargetProduct.id,
        fromLocation: transferTargetProduct.location,
        toLocation: destinationLoc,
        quantity: transferQty,
        notes: transferNotes,
        userId: currentUser.id,
        userName: currentUser.name,
      });

      if (res.success) {
        setShowTransferModal(false);
        fetchProducts();
      } else {
        setTransferError(res.error || 'فشل إتمام عملية النقل');
      }
    } catch (err: any) {
      setTransferError(err.message || 'فشل الاتصال بالخادم');
    }
  };

  // Real Excel Export matching current filter and location
  const handleExportExcel = () => {
    const dataToExport = products.map((p, idx) => ({
      '#': idx + 1,
      'اسم المنتج': p.name,
      'الكود / الباركود': p.sku,
      'الوحدة': p.unit,
      'الموقع': p.location === 'gallery' ? 'المعرض' : 'المكتبة',
      'الكمية المتوفرة': p.quantity,
      'سعر الشراء': p.purchaseCost,
      'سعر البيع': p.salePrice,
      'حد الطلب الأدنى': p.minStockAlert,
      'التصنيف': p.category,
      'إجمالي تكلفة المخزون': p.quantity * p.purchaseCost,
      'القيمة البيعية للمخزون': p.quantity * p.salePrice,
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'المخزون');
    const locArabic = activeLocation === 'gallery' ? 'المعرض' : 'المكتبة';
    XLSX.writeFile(workbook, `مخزون-${locArabic}-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Real Excel Import with row-by-row error validation
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportErrors([]);
    setImportSummary(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const b64 = (evt.target?.result as string).split(',')[1];
        const res = await api.importXlsx({
          fileBase64: b64,
          defaultLocation: activeLocation,
        });

        if (res.success) {
          setImportSummary({
            imported: res.importedCount || 0,
            errors: res.errorCount || 0,
          });
          setImportErrors(res.errors || []);
          fetchProducts();
        } else {
          alert(res.error || 'فشل استيراد الملف');
        }
      } catch (err: any) {
        alert(err.message || 'فشل تحليل ملف Excel');
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-600" />
            <span>إدارة المنتجات والمخزون</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            فصل تام بين مخزون المعرض ومخزون المكتبة مع دعم نقل البضائع واستيراد/تصدير Excel
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Location Switcher Tabs */}
          <div className="flex items-center bg-slate-200/80 p-1 rounded-xl">
            <button
              onClick={() => onLocationChange('gallery')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeLocation === 'gallery'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>مخزون المعرض</span>
            </button>
            <button
              onClick={() => onLocationChange('stationery')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeLocation === 'stationery'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>مخزون المكتبة</span>
            </button>
          </div>

          <button
            onClick={handleExportExcel}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>تصدير Excel</span>
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => {
                  setImportSummary(null);
                  setImportErrors([]);
                  setShowImportModal(true);
                }}
                className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-slate-500" />
                <span>استيراد XLSX</span>
              </button>

              <button
                ref={addButtonRef}
                onClick={openAddModal}
                title="إضافة منتج جديد (Ctrl+N)"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm shadow-emerald-900/20 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة منتج جديد</span>
                <kbd className="hidden sm:inline-flex items-center justify-center min-w-[34px] h-5 px-1.5 mx-1 text-[10px] font-mono font-bold bg-white/20 border border-white/30 rounded">Ctrl+N</kbd>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3.5 rounded-2xl shadow-xs border border-slate-200 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <input
            type="text"
            data-search-input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم المنتج أو الكود أو الباركود... (Alt+S)"
            ref={searchInputRef}
            className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={lowStockFilter}
              onChange={(e) => setLowStockFilter(e.target.checked)}
              className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
            />
            <span className="flex items-center gap-1 text-rose-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              الأصناف المنخفضة عن حد الطلب فقط
            </span>
          </label>

          <span className="text-xs text-slate-400 font-mono">
            العدد: {products.length} منتج
          </span>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
              <tr>
                <th className="p-3.5">#</th>
                <th className="p-3.5">اسم المنتج</th>
                <th className="p-3.5">الكود / الباركود</th>
                <th className="p-3.5">الموقع</th>
                <th className="p-3.5 text-center">الكمية</th>
                <th className="p-3.5 text-center">سعر الشراء</th>
                <th className="p-3.5 text-center">سعر البيع</th>
                <th className="p-3.5 text-center">حد الطلب</th>
                <th className="p-3.5">التصنيف</th>
                {isAdmin && <th className="p-3.5 text-center">الإجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    جاري تحميل المخزون...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    لا توجد منتجات مسجلة في {activeLocation === 'gallery' ? 'المعرض' : 'المكتبة'} حالياً
                  </td>
                </tr>
              ) : (
                products.map((p, idx) => {
                  const isLow = p.quantity <= p.minStockAlert;
                  return (
                    <tr key={p.id} className={`hover:bg-slate-50/80 transition-colors ${isLow ? 'bg-rose-50/30' : ''}`}>
                      <td className="p-3.5 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="p-3.5">
                        <div className="font-bold text-slate-800">{p.name}</div>
                        <div className="text-[10px] text-slate-400">الوحدة: {p.unit}</div>
                      </td>
                      <td className="p-3.5 font-mono text-slate-600 font-semibold">{p.sku}</td>
                      <td className="p-3.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            p.location === 'gallery'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {p.location === 'gallery' ? 'المعرض' : 'المكتبة'}
                        </span>
                      </td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`font-extrabold px-2 py-0.5 rounded-lg font-mono ${
                            isLow ? 'bg-rose-100 text-rose-700' : 'text-slate-800'
                          }`}
                        >
                          {p.quantity} {p.unit}
                        </span>
                      </td>
                      <td className="p-3.5 text-center font-semibold text-slate-600 font-mono">
                        {(Number(p.purchaseCost) || 0).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-center font-bold text-emerald-600 font-mono">
                        {(Number(p.salePrice) || 0).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-center font-mono text-slate-500">
                        {p.minStockAlert}
                      </td>
                      <td className="p-3.5 text-slate-600">{p.category}</td>
                      {isAdmin && (
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => openTransferModal(p)}
                              title="نقل المنتج إلى الموقع الآخر"
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openEditModal(p)}
                              title="تعديل المنتج"
                              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(p.id, p.name)}
                              title="حذف المنتج"
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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

      {/* Add / Edit Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-base font-bold text-slate-800">
                {editingProduct ? 'تعديل بيانات منتج' : 'إضافة منتج جديد للمخزون'}
              </h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveProduct} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    اسم المنتج * <span className="text-slate-400 font-normal text-[10px]">(Alt+N)</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: طقم حلل تيفال 10 قطع"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    الكود / الباركود (SKU موحد) * <span className="text-slate-400 font-normal text-[10px]">(Alt+C)</span>
                  </label>
                  <input
                    ref={skuInputRef}
                    type="text"
                    required
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="HW-1001"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    الوحدة <span className="text-slate-400 font-normal text-[10px]">(Alt+U)</span>
                  </label>
                  <input
                    ref={unitInputRef}
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="قطعة، طقم، كرتونة"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {!editingProduct && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">موقع التخزين المخصص *</label>
                    <select
                      value={location}
                      onChange={(e) => setLocation(e.target.value as LocationType)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="gallery">المعرض (الأدوات المنزلية)</option>
                      <option value="stationery">المكتبة</option>
                    </select>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                      القاعدة: ينتمي المنتج حصرياً إما للمعرض أو للمكتبة
                    </span>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    الكمية الافتتاحية <span className="text-slate-400 font-normal text-[10px]">(Alt+Q)</span>
                  </label>
                  <input
                    ref={quantityInputRef}
                    type="number"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    سعر الشراء (التكلفة) * <span className="text-slate-400 font-normal text-[10px]">(Alt+B)</span>
                  </label>
                  <input
                    ref={purchaseInputRef}
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={purchaseCost}
                    onChange={(e) => setPurchaseCost(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    سعر البيع * <span className="text-slate-400 font-normal text-[10px]">(Alt+P)</span>
                  </label>
                  <input
                    ref={saleInputRef}
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={salePrice}
                    onChange={(e) => setSalePrice(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    الحد الأدنى للتنبيه <span className="text-slate-400 font-normal text-[10px]">(Alt+D)</span>
                  </label>
                  <input
                    ref={minStockInputRef}
                    type="number"
                    min="1"
                    value={minStockAlert}
                    onChange={(e) => setMinStockAlert(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    التصنيف / القسم <span className="text-slate-400 font-normal text-[10px]">(Alt+G)</span>
                  </label>
                  <input
                    ref={categoryInputRef}
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="مثال: أواني، أدوات مائدة، كشاكيل"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  ref={saveButtonRef}
                  type="submit"
                  data-save-button
                  title="حفظ (Ctrl+Enter أو Ctrl+S)"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  {editingProduct ? 'حفظ التعديلات' : 'إضافة المنتج'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransferModal && transferTargetProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-indigo-600" />
                <span>نقل المنتج بين المواقع</span>
              </h2>
              <button onClick={() => setShowTransferModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {transferError && (
              <div className="mb-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                {transferError}
              </div>
            )}

            <form onSubmit={handleExecuteTransfer} className="space-y-3.5 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                <div>المنتج: <b className="text-slate-800">{transferTargetProduct.name}</b></div>
                <div>الكود: <span className="font-mono text-slate-600">{transferTargetProduct.sku}</span></div>
                <div>الموقع الحالي: <b className="text-emerald-700">{transferTargetProduct.location === 'gallery' ? 'المعرض' : 'المكتبة'}</b></div>
                <div>الموقع الجديد: <b className="text-indigo-700">{transferTargetProduct.location === 'gallery' ? 'المكتبة' : 'المعرض'}</b></div>
                <div>الرصيد المتاح: <b>{transferTargetProduct.quantity} {transferTargetProduct.unit}</b></div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">الكمية المنقولة</label>
                <input
                  type="number"
                  min="1"
                  max={transferTargetProduct.quantity}
                  value={transferQty}
                  onChange={(e) => setTransferQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">ملاحظات النقل (اختياري)</label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="سبب النقل أو توجيه المخزن"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px]">
                ملاحظة: وفقاً لسياسة النظام، سينتقل سجل المنتج إلى الموقع الهدف لضمان عدم وجود الصنف في الموقعين في الوقت نفسه.
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  data-save-button
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  تأكيد النقل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Real XLSX Import Modal with Row Error List */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Upload className="w-4 h-4 text-emerald-600" />
                <span>استيراد منتجات من ملف Excel (XLSX)</span>
              </h2>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 flex-1 overflow-y-auto text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl leading-relaxed text-slate-600">
                <p className="font-bold text-slate-800 mb-1">شروط وميزات الاستيراد الذكي:</p>
                <ul className="list-disc list-inside space-y-1 text-[11px]">
                  <li>يتعرف تلقائياً على صف العناوين وأسماء الأعمدة بالعربية والإنجليزية (اسم المنتج، الكود، سعر البيع، سعر الشراء، الكمية، الموقع).</li>
                  <li>يتم تجاهل الصفوف الفارغة بالكامل دون التسبب في خطأ.</li>
                  <li>فحص كل صف على حدة واستيراد الصفوف الصحيحة مع تقرير تفصيلي بأرقام الصفوف الخاطئة.</li>
                  <li>منع الأكواد المكررة لمنع تضارب المخزون.</li>
                </ul>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">اختر ملف Excel (.xlsx أو .xls):</label>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  disabled={isImporting}
                  onChange={handleFileUpload}
                  className="w-full text-xs text-slate-500 file:mr-0 file:ml-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
                />
              </div>

              {isImporting && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-center font-bold">
                  جاري قراءة وفحص ملف Excel بدقة...
                </div>
              )}

              {importSummary && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-800 font-bold">
                  <span>تم استيراد {importSummary.imported} منتج بنجاح</span>
                  {importSummary.errors > 0 && (
                    <span className="text-rose-600">يوجد {importSummary.errors} صف به أخطاء</span>
                  )}
                </div>
              )}

              {importErrors.length > 0 && (
                <div className="border border-rose-200 rounded-xl p-3 bg-rose-50/50">
                  <div className="font-bold text-rose-800 mb-2">تقرير الصفوف المرفوضة:</div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-rose-100 text-[11px]">
                    {importErrors.map((err, i) => (
                      <div key={i} className="py-1.5 flex items-center justify-between">
                        <span className="font-semibold text-rose-700">صف رقم {err.rowNumber}: {err.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
