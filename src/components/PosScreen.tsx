import React, { useState, useEffect, useRef } from 'react';
import { User, Product, LocationType, Invoice, InvoiceItem, InvoiceDraft } from '../types.ts';
import { api } from '../services/api.ts';
import { ThermalReceipt } from './ThermalReceipt.tsx';
import {
  Search,
  Barcode,
  Trash2,
  Plus,
  Minus,
  Printer,
  CheckCircle2,
  AlertCircle,
  Clock,
  User as UserIcon,
  Phone,
  Calendar,
  Layers,
  Sparkles,
  PauseCircle,
  PlayCircle,
  Folder,
} from 'lucide-react';

interface PosScreenProps {
  currentUser: User;
  activeLocation: LocationType;
}

export const PosScreen: React.FC<PosScreenProps> = ({ currentUser, activeLocation }) => {
  // Products cache for search
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchingProducts, setMatchingProducts] = useState<Product[]>([]);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);

  // Invoice state
  const [cartItems, setCartItems] = useState<InvoiceItem[]>([]);
  const [customerName, setCustomerName] = useState('عميل نقدي');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'installment'>('cash');
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [installmentDueDate, setInstallmentDueDate] = useState<string>('');
  const [installmentPercent, setInstallmentPercent] = useState<number>(0);
  const [invoiceNotes, setInvoiceNotes] = useState('');

  // Execution states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInvoice, setSuccessInvoice] = useState<Invoice | null>(null);

  // Drafts (suspended invoices)
  const [drafts, setDrafts] = useState<InvoiceDraft[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const lastAutoSaveRef = useRef<number>(0);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load products for the active location
  const loadProducts = async () => {
    try {
      const data = await api.getProducts({ location: activeLocation });
      setProducts(data);
    } catch (err) {
      console.error('Failed to load products for POS:', err);
    }
  };

  useEffect(() => {
    loadProducts();
    setCartItems([]);
    setSearchQuery('');
    setMatchingProducts([]);
    setIsSearchDropdownOpen(false);
    setPaidAmount(0);
  }, [activeLocation]);

  // Floating search logic: only show products when user types
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) {
      setMatchingProducts([]);
      setIsSearchDropdownOpen(false);
      return;
    }

    const matches = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
    );

    // Exact barcode match: automatically add if barcode scanner input (single match exact)
    if (matches.length === 1 && (matches[0].sku.toLowerCase() === q || matches[0].barcode.toLowerCase() === q)) {
      handleAddToCart(matches[0]);
      setSearchQuery('');
      setMatchingProducts([]);
      setIsSearchDropdownOpen(false);
      return;
    }

    setMatchingProducts(matches);
    setIsSearchDropdownOpen(matches.length > 0);
  }, [searchQuery, products]);

  const handleAddToCart = (product: Product) => {
    if (product.quantity <= 0) {
      setErrorMessage(`المنتج (${product.name}) غير متوفر في المخزون حالياً`);
      return;
    }

    setErrorMessage(null);
    setCartItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.productId === product.id);
      if (existingIndex > -1) {
        const currentItem = prev[existingIndex];
        const newQty = currentItem.quantity + 1;
        if (newQty > product.quantity) {
          setErrorMessage(`الكمية المتاحة في المخزن (${product.quantity}) لا تكفي`);
          return prev;
        }
        const updated = [...prev];
        const actualSalePrice = currentItem.unitSalePrice - currentItem.discount;
        // ربح البند = (سعر البيع بعد الخصم − سعر الشراء) × الكمية
        const itemProfit = (actualSalePrice - currentItem.frozenPurchaseCost) * newQty;
        updated[existingIndex] = {
          ...currentItem,
          quantity: newQty,
          itemProfit,
          total: actualSalePrice * newQty,
        };
        return updated;
      } else {
        const actualSalePrice = product.salePrice;
        const itemProfit = (actualSalePrice - product.purchaseCost) * 1;
        const newItem: InvoiceItem = {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          unit: product.unit,
          quantity: 1,
          unitSalePrice: product.salePrice,
          discount: 0,
          actualSalePrice,
          frozenPurchaseCost: product.purchaseCost,
          itemProfit,
          total: actualSalePrice * 1,
        };
        return [...prev, newItem];
      }
    });

    setSearchQuery('');
    setIsSearchDropdownOpen(false);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const handleUpdateQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(index);
      return;
    }

    const item = cartItems[index];
    const product = products.find((p) => p.id === item.productId);
    if (product && newQty > product.quantity) {
      setErrorMessage(`الكمية المتاحة في المخزن (${product.quantity}) لا تكفي`);
      return;
    }

    setErrorMessage(null);
    setCartItems((prev) => {
      const updated = [...prev];
      const it = updated[index];
      const actualSalePrice = it.unitSalePrice - it.discount;
      const itemProfit = (actualSalePrice - it.frozenPurchaseCost) * newQty;
      updated[index] = {
        ...it,
        quantity: newQty,
        itemProfit,
        total: actualSalePrice * newQty,
      };
      return updated;
    });
  };

  const handleUpdateDiscount = (index: number, discount: number) => {
    const validDiscount = Math.max(0, discount);
    setCartItems((prev) => {
      const updated = [...prev];
      const it = updated[index];
      const actualSalePrice = Math.max(0, it.unitSalePrice - validDiscount);
      // ربح البند = (سعر البيع بعد الخصم − سعر الشراء) × الكمية
      const itemProfit = (actualSalePrice - it.frozenPurchaseCost) * it.quantity;
      updated[index] = {
        ...it,
        discount: validDiscount,
        actualSalePrice,
        itemProfit,
        total: actualSalePrice * it.quantity,
      };
      return updated;
    });
  };

  const handleRemoveItem = (index: number) => {
    setCartItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Totals calculations
  const subtotal = cartItems.reduce((acc, it) => acc + it.unitSalePrice * it.quantity, 0);
  const totalDiscount = cartItems.reduce((acc, it) => acc + it.discount * it.quantity, 0);
  const total = Math.max(0, subtotal - totalDiscount);
  const totalProfit = cartItems.reduce((acc, it) => acc + it.itemProfit, 0);
  // When payment is installment, add the optional percent on top of total
  const installmentSurcharge = paymentMethod === 'installment' && installmentPercent > 0
    ? total * (installmentPercent / 100)
    : 0;
  const finalTotal = total + installmentSurcharge;

  // Set default paidAmount when total changes and not in installment mode
  useEffect(() => {
    if (paymentMethod !== 'installment') {
      setPaidAmount(total);
    }
  }, [total, paymentMethod]);

  const remaining = Math.max(0, total - (paidAmount || 0));

  const handleCompleteSale = async () => {
    setErrorMessage(null);
    if (cartItems.length === 0) {
      setErrorMessage('لا توجد أصناف في الفاتورة');
      return;
    }

    // Rule: Mandatory customer name and phone when payment method is installment
    if (paymentMethod === 'installment') {
      if (!customerName || customerName.trim() === '' || customerName === 'عميل نقدي') {
        setErrorMessage('يجب إدخال اسم العميل الحقيقي عند البيع بالتقسيط');
        return;
      }
      if (!customerPhone || customerPhone.trim() === '') {
        setErrorMessage('رقم هاتف العميل إلزامي لحفظ القسط والمتابعة');
        return;
      }
      if (!installmentDueDate) {
        setErrorMessage('يرجى تحديد تاريخ استحقاق القسط');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // Create sales invoice. The total sent to the server is the FINAL
      // total (with installment surcharge already added). The base total
      // (before surcharge) is stored in `installmentSurcharge` field note.
      const invoiceTotal = finalTotal;
      const paidFinal = paymentMethod === 'installment' ? paidAmount || 0 : invoiceTotal;
      const remainingFinal = paymentMethod === 'installment' ? Math.max(0, invoiceTotal - paidFinal) : 0;
      const payload = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        location: activeLocation,
        sellerId: currentUser.id,
        sellerName: currentUser.name,
        sellerCode: currentUser.employeeCode,
        items: cartItems,
        subtotal,
        totalDiscount,
        // Store the FINAL price (after installment surcharge) in `total`
        // so the receipt shows the actual price the customer pays.
        total: invoiceTotal,
        installmentPercent: paymentMethod === 'installment' ? installmentPercent : 0,
        installmentSurcharge: paymentMethod === 'installment' ? installmentSurcharge : 0,
        paid: paidFinal,
        remaining: remainingFinal,
        paymentMethod,
        isInstallment: paymentMethod === 'installment',
        installmentDueDate: paymentMethod === 'installment' ? installmentDueDate : undefined,
        notes: invoiceNotes,
      };

      const res = await api.createInvoice(payload);
      if (res.success && res.invoiceId) {
        // Build completed invoice object for thermal receipt preview
        const newInvoice: Invoice = {
          id: res.invoiceId,
          invoiceNumber: res.invoiceNumber || 'HAWR-000',
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          location: activeLocation,
          sellerId: currentUser.id,
          sellerName: currentUser.name,
          sellerCode: currentUser.employeeCode,
          date: new Date().toISOString().split('T')[0],
          time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          items: cartItems,
          subtotal,
          totalDiscount,
          total,
          paid: payload.paid,
          remaining: payload.remaining,
          paymentMethod,
          isInstallment: paymentMethod === 'installment',
          installmentDueDate: payload.installmentDueDate,
          installmentPercent: paymentMethod === 'installment' ? installmentPercent : 0,
          installmentSurcharge: paymentMethod === 'installment' ? installmentSurcharge : 0,
          finalTotal: paymentMethod === 'installment' ? finalTotal : total,
          status: payload.remaining > 0 ? 'partial' : 'completed',
          notes: invoiceNotes,
          createdAt: new Date().toISOString(),
        };

        setSuccessInvoice(newInvoice);
        // Reset cart
        setCartItems([]);
        setCustomerName('عميل نقدي');
        setCustomerPhone('');
        setPaymentMethod('cash');
        setInvoiceNotes('');
        loadProducts(); // refresh stock numbers
      } else {
        setErrorMessage(res.error || 'حدث خطأ أثناء حفظ الفاتورة');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'فشل الاتصال بالخادم المحلي');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ===== Suspended invoice (draft) management =====
  const fetchDrafts = async () => {
    try {
      const list = await api.getInvoiceDrafts({
        location: activeLocation,
        sellerId: currentUser.id,
      });
      setDrafts(list || []);
    } catch (err) {
      console.error('Failed to fetch drafts:', err);
    }
  };

  useEffect(() => {
    fetchDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation, currentUser.id]);

  // Click-outside handler: close the search dropdown when clicking anywhere
  // outside of it OR on the dropdown's empty chrome (not a product item).
  // This is critical — without it, the floating dropdown (which is
  // absolute-positioned below the search bar and spans the full width)
  // can stay open and visually cover the customer name / phone / payment
  // fields, making them look unresponsive to mouse clicks.
  const isSearchDropdownOpenRef = useRef(false);
  useEffect(() => {
    isSearchDropdownOpenRef.current = isSearchDropdownOpen;
  }, [isSearchDropdownOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (!isSearchDropdownOpenRef.current) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Close the dropdown if the click is NOT on a product item.
      // Product items have data-product-row="1" so we can detect them.
      const onProduct = target.closest('[data-product-row="1"]');
      if (onProduct) return; // let the product's onClick run
      setIsSearchDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  const computeSubtotalAndDiscount = () => {
    let subtotal = 0;
    let totalDiscount = 0;
    for (const it of cartItems) {
      subtotal += it.unitSalePrice * it.quantity;
      totalDiscount += it.discount * it.quantity;
    }
    return { subtotal, totalDiscount };
  };

  const handleSuspend = async () => {
    if (cartItems.length === 0) {
      setErrorMessage('لا توجد أصناف لتعليقها في الفاتورة');
      return;
    }
    setSavingDraft(true);
    setErrorMessage(null);
    try {
      const { subtotal, totalDiscount } = computeSubtotalAndDiscount();
      const now = new Date();
      const draftLabel =
        (customerName && customerName.trim() && customerName !== 'عميل نقدي'
          ? customerName.trim()
          : 'فاتورة معلقة') +
        ' — ' +
        cartItems.length +
        ' صنف';
      const res = await api.saveInvoiceDraft({
        id: currentDraftId || undefined,
        draftLabel,
        customerName: customerName.trim() || 'عميل نقدي',
        customerPhone: customerPhone.trim() || undefined,
        location: activeLocation,
        sellerId: currentUser.id,
        sellerName: currentUser.name,
        sellerCode: currentUser.employeeCode,
        date: now.toISOString().substring(0, 10),
        time: now.toISOString().substring(11, 19),
        items: cartItems,
        subtotal,
        totalDiscount,
        total,
        paid: paymentMethod === 'installment' ? paidAmount || 0 : total,
        remaining: paymentMethod === 'installment' ? Math.max(0, total - (paidAmount || 0)) : 0,
        paymentMethod,
        isInstallment: paymentMethod === 'installment',
        installmentDueDate: paymentMethod === 'installment' ? installmentDueDate : undefined,
        notes: invoiceNotes,
      });
      if (res.success) {
        setCurrentDraftId(res.draft?.id || null);
        setCartItems([]);
        setCustomerName('عميل نقدي');
        setCustomerPhone('');
        setPaymentMethod('cash');
        setInstallmentDueDate('');
        setInvoiceNotes('');
        await fetchDrafts();
        setErrorMessage('✓ تم تعليق الفاتورة بنجاح — يمكنك استكمالها لاحقاً');
        setTimeout(() => setErrorMessage(null), 3000);
      } else {
        setErrorMessage(res.error || 'فشل تعليق الفاتورة');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'تعذر تعليق الفاتورة');
    } finally {
      setSavingDraft(false);
    }
  };

  const loadDraft = async (id: string) => {
    try {
      const res = await api.getInvoiceDraft(id);
      if (res.success && res.draft) {
        const d = res.draft;
        setCartItems(d.items || []);
        setCustomerName(d.customerName || 'عميل نقدي');
        setCustomerPhone(d.customerPhone || '');
        setPaymentMethod(d.paymentMethod || 'cash');
        setInstallmentDueDate(d.installmentDueDate || '');
        setInvoiceNotes(d.notes || '');
        // Track the draft so saving later removes it (instead of creating a new invoice
        // in addition to the still-listed draft). The draft stays in the list until
        // the user either completes the sale (Ctrl+S) or explicitly deletes it.
        setCurrentDraftId(d.id);
        setErrorMessage('✓ تم استدعاء الفاتورة المعلقة — يمكنك تعديلها ثم حفظها');
        setTimeout(() => setErrorMessage(null), 2500);
      } else {
        setErrorMessage(res.error || 'فشل تحميل المسودة');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'تعذر تحميل المسودة');
    }
  };

  const deleteDraft = async (id: string) => {
    if (!window.confirm('هل تريد حذف هذه الفاتورة المعلقة نهائياً؟')) return;
    try {
      await api.deleteInvoiceDraft(id);
      await fetchDrafts();
    } catch (err) {
      console.error('Failed to delete draft:', err);
    }
  };

  // Silent auto-save: only fires when the user has been idle for 15 minutes.
  // This updates the existing draft (or creates one) WITHOUT clearing the cart
  // or showing intrusive UI — it's a safety net for accidental closes.
  useEffect(() => {
    const AUTO_SAVE_MS = 15 * 60 * 1000; // 15 minutes
    const interval = setInterval(() => {
      if (cartItems.length === 0) return;
      const now = Date.now();
      if (now - lastAutoSaveRef.current < AUTO_SAVE_MS) return;
      lastAutoSaveRef.current = now;
      // Silent save: same as suspend but no UI feedback and no form reset
      (async () => {
        try {
          const { subtotal, totalDiscount } = computeSubtotalAndDiscount();
          const now2 = new Date();
          await api.saveInvoiceDraft({
            id: currentDraftId || undefined,
            draftLabel:
              (customerName && customerName.trim() && customerName !== 'عميل نقدي'
                ? customerName.trim()
                : 'فاتورة معلقة') + ' — ' + cartItems.length + ' صنف',
            customerName: customerName.trim() || 'عميل نقدي',
            customerPhone: customerPhone.trim() || undefined,
            location: activeLocation,
            sellerId: currentUser.id,
            sellerName: currentUser.name,
            sellerCode: currentUser.employeeCode,
            date: now2.toISOString().substring(0, 10),
            time: now2.toISOString().substring(11, 19),
            items: cartItems,
            subtotal,
            totalDiscount,
            total,
            paid: paymentMethod === 'installment' ? paidAmount || 0 : total,
            remaining: paymentMethod === 'installment' ? Math.max(0, total - (paidAmount || 0)) : 0,
            paymentMethod,
            isInstallment: paymentMethod === 'installment',
            installmentDueDate: paymentMethod === 'installment' ? installmentDueDate : undefined,
            notes: invoiceNotes,
          });
          await fetchDrafts();
        } catch (e) {
          console.warn('auto-save draft failed:', e);
        }
      })();
    }, 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartItems, currentDraftId, customerName, customerPhone, paymentMethod, installmentDueDate, invoiceNotes, total, paidAmount]);

  // Track user activity so auto-save respects idle time
  useEffect(() => {
    const resetTimer = () => { lastAutoSaveRef.current = Date.now(); };
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('click', resetTimer);
    return () => {
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('click', resetTimer);
    };
  }, []);

  // Print handler for the success modal
  const handlePrint = () => {
    setTimeout(() => {
      window.print();
      // After print dialog closes, dismiss the success modal so the user
      // can keep working without an extra click.
      setTimeout(() => setSuccessInvoice(null), 300);
    }, 100);
  };

  // After successful save, remove the linked draft if any
  useEffect(() => {
    if (successInvoice && currentDraftId) {
      api.deleteInvoiceDraft(currentDraftId).then(() => {
        setCurrentDraftId(null);
        fetchDrafts();
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successInvoice]);

  // Keyboard shortcuts
  // Alt+S: focus the product search input (universal shortcut).
  //   Bound locally because the global Alt+S handler in App.tsx bails
  //   out on the POS tab so it doesn't conflict with POS-owned Ctrl+S.
  //   We replicate the Alt+S behaviour here so the universal shortcut
  //   works in POS too. Bound in CAPTURE phase on BOTH window AND
  //   document (belt-and-suspenders) — same pattern as the global
  //   handler in App.tsx so it survives any library that might try to
  //   swallow the event first.
  // Ctrl+S: save/complete the current sale (ONLY when not typing in an input)
  // Ctrl+W: suspend the current invoice as a draft (ONLY when not in input)
  // Ctrl+P: print the just-completed invoice (when success modal is open)
  // Ctrl+X: close the success modal
  // Escape: close the search dropdown OR the success modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Layout-independent "S" detection: accept 's'/'S' or Arabic Seen 'س'
      // in event.key AND the physical 'KeyS' code (covers AZERTY / Dvorak
      // and any non-Latin keyboard layout).
      const k = (e.key || '').toLowerCase();
      const isSKey = k === 's' || k === 'س' || e.code === 'KeyS';
      const mod = e.ctrlKey || e.metaKey;

      // Alt+S → focus search (universal, works in any state).
      if (e.altKey && !mod && isSKey) {
        e.preventDefault();
        if (searchInputRef.current) {
          try { searchInputRef.current.focus({ preventScroll: false } as any); } catch (_) { /* ignore */ }
          try { searchInputRef.current.select(); } catch (_) { /* ignore */ }
        }
        return;
      }
      if (!mod) {
        if (e.key === 'Escape') {
          if (isSearchDropdownOpen) {
            setIsSearchDropdownOpen(false);
            e.preventDefault();
          } else if (successInvoice) {
            setSuccessInvoice(null);
            e.preventDefault();
          }
        }
        return;
      }
      // From here on we have Ctrl/Meta + some key.
      // Ctrl+S: complete the sale. Allowed even when focus is inside an
      // input (the user's intent is unambiguous — they want to finalise
      // the sale). The previous "block-when-typing" check made the
      // shortcut a no-op whenever the user was focused on the search
      // box, customer name, payment select, etc. — i.e. ALWAYS in POS —
      // which meant the shortcut never fired.
      if (isSKey) {
        if (successInvoice) return;
        e.preventDefault();
        if (!isSubmitting) handleCompleteSale();
        return;
      }
      if (k === 'w' || e.code === 'KeyW') {
        e.preventDefault();
        handleSuspend();
        return;
      }
      if ((k === 'p' || e.code === 'KeyP') && successInvoice) {
        e.preventDefault();
        handlePrint();
        return;
      }
      if ((k === 'x' || e.code === 'KeyX') && successInvoice) {
        e.preventDefault();
        setSuccessInvoice(null);
        return;
      }
    };
    // Capture-phase on BOTH window AND document — same defensive
    // pattern as the global handler in App.tsx so the listener survives
    // even if some library tries to remove or swallow it.
    window.addEventListener('keydown', handler, true);
    document.addEventListener('keydown', handler, true);
    // Also bind on document.documentElement (the <html> root) so the
    // listener is reachable from the very top of the DOM — same
    // bulletproof pattern as the module-level handler in App.tsx.
    if (document.documentElement) {
      document.documentElement.addEventListener('keydown', handler, true);
      document.documentElement.addEventListener('keydown', handler, false);
    }
    return () => {
      window.removeEventListener('keydown', handler, true);
      document.removeEventListener('keydown', handler, true);
      if (document.documentElement) {
        document.documentElement.removeEventListener('keydown', handler, true);
        document.documentElement.removeEventListener('keydown', handler, false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmitting, cartItems, paymentMethod, customerName, customerPhone, installmentDueDate, paidAmount, total, successInvoice, isSearchDropdownOpen]);

  return (
    <div className="h-[calc(100vh-6.5rem)] flex flex-col p-4 bg-[#F1F5F9] overflow-hidden" dir="rtl">
      {/* Search Header Bar with Floating Product Results */}
      <div className="relative mb-3 z-30">
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-2.5 flex items-center gap-3">
          <div className="relative flex-1">
            <input
              ref={searchInputRef}
              type="text"
              data-search-input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث باسم المنتج أو امسح الباركود / الكود (Alt+S — لا تظهر الأصناف إلا عند الكتابة)..."
              className="w-full pr-11 pl-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
            />
            <div className="absolute right-3.5 top-3 text-slate-400 flex items-center gap-1">
              <Search className="w-4 h-4" />
              <Barcode className="w-4 h-4 text-slate-300" />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-600">
            <Layers className="w-4 h-4 text-emerald-600" />
            <span>الموقع: {activeLocation === 'gallery' ? 'المعرض' : 'المكتبة'}</span>
          </div>
        </div>

        {/* Floating Search Dropdown */}
        {isSearchDropdownOpen && matchingProducts.length > 0 && (
          <div className="absolute top-full right-0 left-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-72 overflow-y-auto z-50">
            <div className="p-2 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-500 flex justify-between">
              <span>نتائج البحث المتاحة ({matchingProducts.length})</span>
              <span>انقر لاختيار الصنف</span>
            </div>
            <div className="divide-y divide-slate-100">
              {matchingProducts.map((prod) => (
                <div
                  key={prod.id}
                  data-product-row="1"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleAddToCart(prod)}
                  className="p-3 hover:bg-emerald-50/60 cursor-pointer flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      {prod.unit.substring(0, 2)}
                    </div>
                    <div>
                      <span className="font-bold text-sm text-slate-800 block">{prod.name}</span>
                      <span className="text-xs text-slate-400 font-mono">الكود: {prod.sku} | القسم: {prod.category}</span>
                    </div>
                  </div>

                  <div className="text-left">
                    <span className="font-extrabold text-sm text-emerald-600 block">{(Number(prod.salePrice) || 0).toFixed(2)} ج.م</span>
                    <span className={`text-[11px] font-semibold ${prod.quantity <= prod.minStockAlert ? 'text-rose-500' : 'text-slate-500'}`}>
                      المتوفر: {prod.quantity} {prod.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div className="mb-3 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-500 hover:text-rose-800 font-bold">×</button>
        </div>
      )}

      {/* Main Screen: The Invoice takes the entire central layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0">
        {/* Left: Invoice items list (takes dominant 8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-2xl shadow-xs border border-slate-200 flex flex-col overflow-hidden">
          {/* Invoice Header details */}
          <div className="p-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-slate-700">فاتورة مبيعات جديدة</span>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono text-[11px]">
                {cartItems.length} صنف
              </span>
            </div>

            <div className="flex items-center gap-4 text-slate-500 text-[11px]">
              <span className="flex items-center gap-1">
                <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                البائع: <b className="text-slate-700">{currentUser.name}</b> ({currentUser.employeeCode})
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {new Date().toLocaleDateString('ar-EG')}
              </span>
            </div>
          </div>

          {/* Items Table */}
          <div className="flex-1 overflow-y-auto">
            {cartItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-slate-400 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                  <Barcode className="w-8 h-8 text-slate-300" />
                </div>
                <p className="font-bold text-slate-600 text-sm mb-1">الفاتورة فارغة حالياً</p>
                <p className="text-xs text-slate-400 max-w-sm">
                  استخدم شريط البحث بالأعلى للبحث عن المنتجات بالاسم أو امسح الباركود لإضافتها مباشرة إلى الفاتورة
                </p>
              </div>
            ) : (
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0 font-bold">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">اسم المنتج / الكود</th>
                    <th className="p-3 text-center">الكمية</th>
                    <th className="p-3 text-center">السعر</th>
                    <th className="p-3 text-center">خصم البند</th>
                    <th className="p-3 text-center">صافي السعر</th>
                    <th className="p-3 text-left">الإجمالي</th>
                    <th className="p-3 text-center">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cartItems.map((item, index) => (
                    <tr key={index} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 text-slate-400 font-mono">{index + 1}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{item.productName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          كود: {item.sku}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
                          <button
                            onClick={() => handleUpdateQuantity(index, item.quantity - 1)}
                            className="p-1.5 hover:bg-slate-100 text-slate-500 cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={item.quantity}
                            onChange={(e) => {
                              const raw = e.target.value;
                              // Allow empty string while user is editing
                              // (so backspace doesn't get stuck). We commit
                              // on blur and on Enter.
                              if (raw === '') return;
                              const n = Number(raw);
                              if (isNaN(n) || n < 0) return;
                              handleUpdateQuantity(index, Math.floor(n));
                            }}
                            onBlur={(e) => {
                              // On blur, ensure we have a valid value (1
                              // by default if the field was left empty).
                              const n = Number(e.target.value);
                              if (!isNaN(n) && n >= 0) {
                                handleUpdateQuantity(index, Math.floor(n));
                              } else {
                                handleUpdateQuantity(index, 1);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-12 px-1 py-1 font-bold text-slate-800 text-xs text-center focus:outline-none focus:bg-emerald-50 focus:text-emerald-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            title="انقر لتعديل الكمية يدوياً (حد أقصى = المخزون المتاح)"
                          />
                          <button
                            onClick={() => handleUpdateQuantity(index, item.quantity + 1)}
                            className="p-1.5 hover:bg-slate-100 text-slate-500 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="p-3 text-center font-semibold text-slate-700">
                        {(Number(item.unitSalePrice) || 0).toFixed(2)}
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.discount || ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            // Allow empty string while editing so backspace
                            // doesn't get stuck. We commit on blur.
                            if (raw === '') return;
                            const n = Number(raw);
                            if (isNaN(n) || n < 0) return;
                            handleUpdateDiscount(index, n);
                          }}
                          onBlur={(e) => {
                            // On blur, ensure we have a valid value (0 if
                            // left empty / invalid) — never negative.
                            const n = Number(e.target.value);
                            if (!isNaN(n) && n >= 0) {
                              handleUpdateDiscount(index, n);
                            } else {
                              handleUpdateDiscount(index, 0);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          placeholder="0"
                          title="انقر لتعديل الخصم يدوياً (قيمة عشرية حرة)"
                          className="w-16 p-1 text-center bg-slate-50 border border-slate-200 rounded-md text-xs font-semibold focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </td>
                      <td className="p-3 text-center font-bold text-slate-800">
                        {(Number(item.actualSalePrice) || 0).toFixed(2)}
                      </td>
                      <td className="p-3 text-left font-bold text-slate-900">
                        {(Number(item.total) || 0).toFixed(2)} ج.م
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleRemoveItem(index)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Payment & Summary Panel (takes 4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-2xl shadow-xs border border-slate-200 flex flex-col p-4 overflow-y-auto">
          <div className="font-bold text-sm text-slate-800 mb-3 pb-2 border-b border-slate-100">
            <span>بيانات العميل والدفع</span>
          </div>

          <div className="space-y-3 flex-1">
            {/* Customer Details */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                اسم العميل {paymentMethod === 'installment' && <span className="text-rose-500">*</span>}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="اسم العميل"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500 pl-8"
                />
                <UserIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                رقم الهاتف {paymentMethod === 'installment' && <span className="text-rose-500">* (إلزامي للتقسيط)</span>}
              </label>
              <div className="relative">
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="010xxxxxxxx"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500 pl-8"
                />
                <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">طريقة الدفع</label>
              <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    paymentMethod === 'cash' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  نقدي
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    paymentMethod === 'card' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  شبكة / بطاقة
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('installment')}
                  className={`py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    paymentMethod === 'installment' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  تقسيط
                </button>
              </div>
            </div>

            {/* Installment specific fields */}
            {paymentMethod === 'installment' && (
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2.5">
                <div className="text-[11px] font-bold text-amber-800">بيانات القسط والدفعة المقدمة:</div>
                <div>
                  <label className="block text-[10px] font-semibold text-amber-900 mb-1">المبلغ المدفوع مقدماً (ج.م)</label>
                  <input
                    type="number"
                    min="0"
                    max={total}
                    value={paidAmount || ''}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-amber-900 mb-1 flex items-center justify-between">
                    <span>نسبة زيادة التقسيط (%) — اختيارية</span>
                    <span className="font-mono text-amber-700">{installmentPercent}%</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={installmentPercent || ''}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setInstallmentPercent(isNaN(v) || v < 0 ? 0 : Math.min(100, v));
                    }}
                    placeholder="0"
                    className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
                  />
                  {installmentPercent > 0 && (
                    <div className="text-[10px] text-amber-700 mt-1">
                      + زيادة: {total.toFixed(2)} × {installmentPercent}% = {(total * installmentPercent / 100).toFixed(2)} ج.م
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-amber-900 mb-1">تاريخ استحقاق القسط القادم *</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={installmentDueDate}
                      onChange={(e) => setInstallmentDueDate(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-500 pl-8"
                    />
                    <Calendar className="w-3.5 h-3.5 text-amber-600 absolute left-2.5 top-2.5" />
                  </div>
                </div>
                <div className="flex justify-between text-xs font-bold text-amber-900 pt-1 border-t border-amber-200">
                  <span>المتبقي في القسط:</span>
                  <span>{(Number(remaining) || 0).toFixed(2)} ج.م</span>
                </div>
              </div>
            )}

            {/* Calculations Breakdown */}
            <div className="bg-slate-50 p-3 rounded-xl space-y-1.5 text-xs text-slate-600 border border-slate-200">
              <div className="flex justify-between">
                <span>المجموع الفرعي:</span>
                <span className="font-semibold">{(Number(subtotal) || 0).toFixed(2)} ج.م</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>إجمالي الخصم:</span>
                  <span className="font-semibold">-{(Number(totalDiscount) || 0).toFixed(2)} ج.م</span>
                </div>
              )}
              {installmentSurcharge > 0 && (
                <div className="text-[11px] flex justify-between text-amber-700 bg-amber-50 px-2 py-1 rounded">
                  <span>السعر قبل الزيادة:</span>
                  <span className="font-mono font-bold">{total.toFixed(2)} ج.م</span>
                </div>
              )}
              {installmentSurcharge > 0 && (
                <div className="text-[11px] flex justify-between text-amber-700 bg-amber-50 px-2 py-1 rounded">
                  <span>+ زيادة التقسيط ({installmentPercent}%):</span>
                  <span className="font-mono font-bold">{installmentSurcharge.toFixed(2)} ج.م</span>
                </div>
              )}
              <div className="flex justify-between text-base font-extrabold text-slate-900 pt-1.5 border-t border-slate-200">
                <span>الإجمالي {installmentSurcharge > 0 ? '(بعد الزيادة)' : 'النهائي'}:</span>
                <span className="text-emerald-600">{(Number(finalTotal) || 0).toFixed(2)} ج.م</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-3 border-t border-slate-100 mt-2 space-y-2">
            <button
              onClick={handleCompleteSale}
              disabled={isSubmitting || cartItems.length === 0}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'جاري حفظ الفاتورة وتحديث المخزون...' : 'إتمام البيع وحفظ الفاتورة'}</span>
              <kbd className="hidden sm:inline-flex items-center justify-center min-w-[28px] h-5 px-1.5 mx-1 text-[10px] font-mono font-bold bg-white/20 border border-white/30 rounded">Ctrl+S</kbd>
            </button>
            <button
              type="button"
              onClick={handleSuspend}
              disabled={isSubmitting || cartItems.length === 0 || savingDraft}
              className="w-full py-2.5 bg-amber-100 hover:bg-amber-200 disabled:bg-slate-100 text-amber-800 font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2"
              title="تعليق الفاتورة للرجوع إليها لاحقاً (Ctrl+W)"
            >
              <PauseCircle className="w-4 h-4" />
              <span>{savingDraft ? 'جاري تعليق الفاتورة...' : 'تعليق الفاتورة (لاستكمالها لاحقاً)'}</span>
              <kbd className="hidden sm:inline-flex items-center justify-center min-w-[28px] h-5 px-1.5 mx-1 text-[10px] font-mono font-bold bg-amber-200 border border-amber-300 rounded text-amber-900">Ctrl+W</kbd>
            </button>

            {drafts.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <div className="text-[10px] font-bold text-slate-500 mb-1.5 flex items-center gap-1.5">
                  <Folder className="w-3 h-3" /> فواتير معلقة ({drafts.length})
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {drafts.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-1 p-1.5 bg-amber-50/60 border border-amber-200 rounded-lg text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono font-bold text-amber-900 truncate">
                          {d.draftLabel || d.invoiceNumber || d.id.slice(-6)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {d.itemCount} صنف · {(d.total || 0).toFixed(2)} ج.م
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadDraft(d.id)}
                        className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded-md flex items-center gap-1"
                        title="استكمال الفاتورة"
                      >
                        <PlayCircle className="w-3 h-3" /> فتح
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteDraft(d.id)}
                        className="px-1.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-600 text-[10px] font-bold rounded-md"
                        title="حذف المسودة"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Success Modal with Thermal Receipt Preview */}
      {successInvoice && (
        <ThermalReceipt invoice={successInvoice} onClose={() => setSuccessInvoice(null)} />
      )}
    </div>
  );
};
