import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, LocationType } from '../types.ts';
import { useFormShortcuts, focusRef } from '../hooks/useFormShortcuts.ts';
import { api } from '../services/api.ts';
import {
  Tag,
  Search,
  Printer,
  Barcode,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
  Settings,
  Eye,
} from 'lucide-react';

// Lazy-loaded barcode renderer: jsbarcode is a large UMD bundle, and any
// failure to load it (or a runtime issue) used to blank the entire app.
// Loading it on demand keeps the rest of the app responsive.
let jsBarcodeInstance: any = null;
async function getJsBarcode(): Promise<any> {
  if (jsBarcodeInstance) return jsBarcodeInstance;
  try {
    const mod: any = await import('jsbarcode');
    jsBarcodeInstance = mod.default || mod;
  } catch (e) {
    // Fallback: try the global UMD on window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jsBarcodeInstance = (typeof window !== 'undefined' ? (window as any).JsBarcode : null);
  }
  return jsBarcodeInstance;
}

// Error boundary using a function component pattern (no class needed)
class LabelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('LabelPrintScreen error:', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl m-4">
          <div className="font-bold mb-1">حدث خطأ في شاشة طباعة الباركود</div>
          <div className="text-xs font-mono">{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface LabelPrintScreenProps {
  activeLocation: LocationType;
}

interface SelectedProduct extends Product {
  copies: number;
  selected: boolean;
}

// ----- Spec presets ----------------------------------------------------------
// 1×2″, 2×2″, 2×3″, 4×6″, 1×3″ at 25.4 mm/inch
const PRESET_SIZES = [
  { key: '1x2',  label: '1 × 2 بوصة (25.4 × 50.8 مم)',    w: 25.4,  h: 50.8  },
  { key: '2x2',  label: '2 × 2 بوصة (50.8 × 50.8 مم)',    w: 50.8,  h: 50.8  },
  { key: '2x3',  label: '2 × 3 بوصة (50.8 × 76.2 مم)',    w: 50.8,  h: 76.2  },
  { key: '4x6',  label: '4 × 6 بوصة (101.6 × 152.4 مم)',  w: 101.6, h: 152.4 },
  { key: '1x3',  label: '1 × 3 بوصة (25.4 × 76.2 مم)',    w: 25.4,  h: 76.2  },
];
const MAX_PRINTER_WIDTH_MM = 76; // ZYWELL ZY310 max print width
const PRINT_DPI = 203;
const MM_TO_PX = 96 / 25.4; // browser CSS px per millimetre
const PREVIEW_PX_PER_MM = 5; // on-screen preview scale (5px per mm)

// Layout style presets (each picks a default width-fraction of the
// barcode relative to the row width).
const LAYOUT_STYLES = {
  balanced: { label: 'متوازن',  barFraction: 0.6,  nameFrac: 0.6, priceSide: 'right' },
  compact:  { label: 'مضغوط',  barFraction: 0.5,  nameFrac: 0.55, priceSide: 'right' },
  wide:     { label: 'باركود عريض', barFraction: 0.78, nameFrac: 0.85, priceSide: 'bottom' },
} as const;

type LayoutStyle = keyof typeof LAYOUT_STYLES;
type BarcodeFormat = 'CODE128' | 'CODE39' | 'EAN13' | 'QR';
type FontFamily = 'system' | 'mono' | 'classic';
type BarcodeAlign = 'left' | 'center';
type AccordionKey = 'product' | 'size' | 'layout' | 'appearance' | 'textpos' | 'printer';
type ElementKey = 'shop' | 'name' | 'sku' | 'price' | 'barcode';

interface ElementConfig {
  x: number;          // mm from left edge of the row
  y: number;          // mm from top edge of the row
  w: number;          // width in mm
  h: number;          // height in mm
  fontSize: number;   // pt (for text only)
  rotation: 0 | 90 | 180 | 270; // degrees
  align: 'left' | 'center' | 'right';
  visible: boolean;
}

const DEFAULT_ELEMENTS: Record<ElementKey, ElementConfig> = {
  shop:    { x: 0, y: 0,  w: 38,  h: 5,  fontSize: 7,  rotation: 0,   align: 'center', visible: true },
  name:    { x: 0, y: 18, w: 38,  h: 4,  fontSize: 7,  rotation: 0,   align: 'right',  visible: true },
  sku:     { x: 0, y: 22, w: 38,  h: 3,  fontSize: 6,  rotation: 0,   align: 'left',   visible: true },
  price:   { x: 0, y: 4,  w: 12,  h: 8,  fontSize: 11, rotation: 0,   align: 'center', visible: true },
  barcode: { x: 12, y: 2, w: 26, h: 14, fontSize: 6,  rotation: 0,   align: 'center', visible: true },
};
type LabelMode = 'single' | 'double';

interface LabelTemplate {
  id: string;
  name: string;
  createdAt: number;
  barcodeFormat: BarcodeFormat;
  barcodeWidthMm: number;
  barcodeHeightMm: number;
  showBarcodeNumber: boolean;
  presetKey: string;
  customW: number;
  customH: number;
  rows: number;
  rowGapMm: number;
  marginXMm: number;
  marginYMm: number;
  borderRadiusMm: number;
  barcodeAlign: BarcodeAlign;
  layoutStyle: LayoutStyle;
  fontFamily: FontFamily;
  fontSizePt: number;
  showShop: boolean;
  showName: boolean;
  showSku: boolean;
  showPrice: boolean;
  showRowDivider: boolean;
  offsetShopMm: number;
  offsetNameMm: number;
  offsetSkuMm: number;
  offsetPriceMm: number;
  offsetXmm: number;
  offsetYmm: number;
  shopName: string;
}

// localStorage helpers
function loadTemplates(): LabelTemplate[] {
  try {
    const raw = localStorage.getItem('hawr_label_templates');
    return raw ? (JSON.parse(raw) as LabelTemplate[]) : [];
  } catch (_) { return []; }
}
function saveTemplates(t: LabelTemplate[]) {
  try { localStorage.setItem('hawr_label_templates', JSON.stringify(t)); } catch (_) { /* ignore */ }
}

// EAN-13 requires exactly 12 or 13 digits
function validateBarcodeData(format: BarcodeFormat, data: string): { ok: boolean; msg: string } {
  if (!data || !data.trim()) return { ok: false, msg: 'كود المنتج فارغ' };
  const v = data.trim();
  if (format === 'EAN13') {
    if (!/^\d{12,13}$/.test(v)) return { ok: false, msg: 'EAN-13 يجب أن يكون 12 أو 13 رقم' };
  } else if (format === 'CODE39') {
    if (!/^[0-9A-Z\-\.\$\/\+\%\s]+$/i.test(v)) return { ok: false, msg: 'CODE 39 يقبل أحرف وأرقام ورموز محددة' };
  } else if (format === 'CODE128') {
    if (v.length > 80) return { ok: false, msg: 'CODE 128: الحد الأقصى 80 حرف' };
  } else if (format === 'QR') {
    if (v.length > 256) return { ok: false, msg: 'QR: الحد الأقصى 256 حرف' };
  }
  return { ok: true, msg: '' };
}

// Build the inline style for an element using its ElementConfig.
// Positions are absolute, anchored to the top-left of the row.
function elStyle(cfg: ElementConfig, fontFamilyCss: string, dir: 'ltr' | 'rtl', fontSizeCss: string): React.CSSProperties {
  return {
    left: `${cfg.x}mm`,
    top: `${cfg.y}mm`,
    width: `${cfg.w}mm`,
    height: `${cfg.h}mm`,
    transform: `rotate(${cfg.rotation}deg)`,
    fontFamily: fontFamilyCss,
    fontSize: fontSizeCss,
    direction: dir,
    textAlign: cfg.align,
    alignItems: cfg.align === 'left' ? 'flex-start' : cfg.align === 'right' ? 'flex-end' : 'center',
    justifyContent: 'center',
  };
}

export const LabelPrintScreen: React.FC<LabelPrintScreenProps> = ({ activeLocation }) => {
  const [products, setProducts] = useState<SelectedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormat>('CODE128');
  // User-controlled scale of the barcode (1.0 = normal, 0.5 = half, 2.0 = double).
  const [barcodeScale, setBarcodeScale] = useState<number>(() => {
    const v = Number(localStorage.getItem('hawr_label_bc_scale'));
    return Number.isFinite(v) && v > 0 ? v : 1;
  });
  // ---- New spec controls (v26) ----
  const [rows, setRows] = useState<number>(2);
  const [rowGapMm, setRowGapMm] = useState<number>(1);
  const [marginXMm, setMarginXMm] = useState<number>(1);
  const [marginYMm, setMarginYMm] = useState<number>(1);
  const [borderRadiusMm, setBorderRadiusMm] = useState<number>(0);
  const [barcodeAlign, setBarcodeAlign] = useState<BarcodeAlign>('center');
  const [layoutStyle, setLayoutStyle] = useState<LayoutStyle>('balanced');
  const [fontFamily, setFontFamily] = useState<FontFamily>('system');
  const [fontSizePt, setFontSizePt] = useState<number>(7);
  const [showShop, setShowShop] = useState<boolean>(true);
  const [showName, setShowName] = useState<boolean>(true);
  const [showSku, setShowSku] = useState<boolean>(true);
  const [showPrice, setShowPrice] = useState<boolean>(true);
  const [showRowDivider, setShowRowDivider] = useState<boolean>(true);
  const [showBarcodeNumber, setShowBarcodeNumber] = useState<boolean>(false);
  // Per-element vertical offsets in mm (negative = up, positive = down)
  const [offsetShopMm, setOffsetShopMm] = useState<number>(0);
  const [offsetNameMm, setOffsetNameMm] = useState<number>(0);
  const [offsetSkuMm, setOffsetSkuMm] = useState<number>(0);
  const [offsetPriceMm, setOffsetPriceMm] = useState<number>(0);
  // Barcode dimensions in mm (override the auto-fit)
  const [barcodeWidthMm, setBarcodeWidthMm] = useState<number>(0); // 0 = auto
  const [barcodeHeightMm, setBarcodeHeightMm] = useState<number>(0); // 0 = auto
  // Accordion state — which sections are open. Default ALL closed so the
  // screen comes up tidy; user opens what they need.
  const [openSections, setOpenSections] = useState<Record<AccordionKey, boolean>>({
    product: false, size: false, layout: false, appearance: false, textpos: false, printer: false,
  });
  // Templates
  const [templates, setTemplates] = useState<LabelTemplate[]>(() => loadTemplates());
  // ID of the template currently marked as the default (auto-applied on load).
  // Persisted to localStorage so the user's choice survives restarts.
  const [activeTemplateId, setActiveTemplateId] = useState<string>(() => {
    try { return localStorage.getItem('hawr_label_active_template') || ''; } catch (_) { return ''; }
  });
  // Collapse the entire settings + search block (everything except preview/header)
  const [settingsCollapsed, setSettingsCollapsed] = useState(true);
  // Collapse the products table (default open — most-used surface)
  const [productsCollapsed, setProductsCollapsed] = useState(false);
  // Collapse the live preview pane (default closed — saves vertical space)
  const [previewCollapsed, setPreviewCollapsed] = useState(true);
  // Collapse the templates panel (default closed)
  const [templatesCollapsed, setTemplatesCollapsed] = useState(true);
  const [templateName, setTemplateName] = useState<string>('');
  const [templateMessage, setTemplateMessage] = useState<string>('');
  // Per-element full layout (x, y, w, h, font, rotation, align, visible)
  const [elements, setElements] = useState<Record<ElementKey, ElementConfig>>(() => {
    try {
      const raw = localStorage.getItem('hawr_label_elements');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge with defaults so new keys always exist
        return { ...DEFAULT_ELEMENTS, ...parsed };
      }
    } catch (_) { /* ignore */ }
    return DEFAULT_ELEMENTS;
  });
  const [activeElement, setActiveElement] = useState<ElementKey>('shop');
  // Keep element configs in localStorage
  useEffect(() => {
    try { localStorage.setItem('hawr_label_elements', JSON.stringify(elements)); } catch (_) { /* ignore */ }
  }, [elements]);
  // Manual input for product barcode (when not selecting from list)
  const [manualSku, setManualSku] = useState<string>('1253584698568856');
  const [manualName, setManualName] = useState<string>('شوب عصر تريكي');
  const [manualPrice, setManualPrice] = useState<number>(120);
  // Sticker geometry — preset or custom
  const [presetKey, setPresetKey] = useState<string>('2x2');
  const [customW, setCustomW] = useState<number>(50.8);
  const [customH, setCustomH] = useState<number>(50.8);
  // Shop name + offsets
  const [shopName, setShopName] = useState<string>(() => {
    try { return localStorage.getItem('hawr_label_shop_name') || 'معرض حور للأدوات المنزلية والمدرسية'; }
    catch (_) { return 'معرض حور للأدوات المنزلية والمدرسية'; }
  });
  const [offsetXmm, setOffsetXmm] = useState<number>(() => {
    const v = Number(localStorage.getItem('hawr_label_offx'));
    return Number.isFinite(v) ? v : 0;
  });
  const [offsetYmm, setOffsetYmm] = useState<number>(() => {
    const v = Number(localStorage.getItem('hawr_label_offy'));
    return Number.isFinite(v) ? v : 0;
  });
  const [copiesPerProduct, setCopiesPerProduct] = useState(2);
  const [page, setPage] = useState(1);
  const [printers, setPrinters] = useState<{ name: string; displayName?: string; isDefault?: boolean }[]>([]);
  const [printerName, setPrinterName] = useState<string>('');
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string>('');
  const PAGE_SIZE = 12;
  const printRef = useRef<HTMLDivElement>(null);

  // Persist the active-template selection so it survives restarts.
  useEffect(() => {
    try { localStorage.setItem('hawr_label_active_template', activeTemplateId || ''); } catch (_) { /* ignore */ }
  }, [activeTemplateId]);

  // Auto-apply the active template on first load (if any template is
  // marked as default). This means the user picks a default once and
  // every subsequent open of the screen comes up with the right settings.
  useEffect(() => {
    if (!activeTemplateId) return;
    if (templates.length === 0) return;
    const tpl = templates.find((t) => t.id === activeTemplateId);
    if (tpl) handleApplyTemplate(tpl);
    // We only want to auto-apply once on mount, not on every edit of
    // activeTemplateId, so leave the deps empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search input ref + page-level shortcuts (Alt+S → search, Ctrl+P → print).
  const searchInputRef = focusRef<HTMLInputElement>();
  const pageShortcuts = useMemo(() => ({
    'alt+s': () => searchInputRef.current?.focus(),
    'ctrl+p': () => {
      // Trigger the print button — defined later in the file. We just
      // dispatch a click on the button via document.querySelector by
      // data-testid (set in JSX below). Falling back to calling
      // handlePrint() is cleaner via the ref below.
      printButtonRef.current?.click();
    },
  }), []);
  useFormShortcuts(pageShortcuts, true);
  const printButtonRef = focusRef<HTMLButtonElement>();

  // Persist shop name + offsets
  useEffect(() => {
    try {
      localStorage.setItem('hawr_label_shop_name', shopName);
      localStorage.setItem('hawr_label_offx', String(offsetXmm));
      localStorage.setItem('hawr_label_offy', String(offsetYmm));
    } catch (_) { /* ignore */ }
  }, [shopName, offsetXmm, offsetYmm]);

  // Load installed printers (Electron only — silently no-op in browser)
  useEffect(() => {
    const api: any = (window as any).hawr;
    if (!api || typeof api.listPrinters !== 'function') return;
    (async () => {
      try {
        const list = await api.listPrinters();
        setPrinters(list || []);
        const def = (list || []).find((p: any) => p.isDefault);
        if (def) setPrinterName(def.name);
      } catch (_) { /* ignore */ }
    })();
  }, []);

  // Load products
  const loadProducts = async () => {
    setLoading(true);
    try {
      const all = await api.getProducts({ location: activeLocation });
      setProducts(
        (all || []).map((p) => ({ ...p, copies: copiesPerProduct, selected: false }))
      );
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation]);

  // Auto-select product on barcode entry. Works for BOTH:
  //   • manual paste (one onChange with full value → debounce fires once)
  //   • hardware barcode scanner (rapid keydown events → each fires
  //     onChange → debounce keeps resetting → fires once when input settles)
  //
  // We use 50 ms debounce inside a useEffect because the previous
  // "keydown accumulator + scanBufferRef" design (see git history)
  // had two failure modes on the user's machine:
  //   1. Some scanners fire keydown faster than React flushes state,
  //      so the accumulator captured partial barcodes and the React
  //      path skipped auto-select via the `scanBufferRef.current === ''`
  //      guard.
  //   2. The keydown handler skipped events with `k.length !== 1`,
  //      but some barcode scanners send IME composition events or
  //      pseudo-keys (e.g. `Dead`) that have length > 1.
  //
  // The simpler design below just watches `searchQuery` after a 50 ms
  // idle window. By then, both paste and scan have finished writing.
  useEffect(() => {
    const handle = setTimeout(() => {
      const q = (searchQuery || '').trim();
      if (q.length < 4) return;
      const qLower = q.toLowerCase();
      // Priority 1: exact barcode match.
      let match = products.find((p) => (p.barcode || '').toLowerCase() === qLower);
      // Priority 2: exact SKU match (covers hand-typed SKUs too).
      if (!match) match = products.find((p) => (p.sku || '').toLowerCase() === qLower);
      if (!match || match.selected) return;
      // Auto-select + clear input. Use a microtask delay to make sure
      // the input value is rendered before we clear it (otherwise React
      // can drop the clear).
      toggleProduct(match.id);
      setSearchQuery('');
      setPage(1);
      const wrapper = searchInputWrapperRef.current;
      if (wrapper) {
        const original = wrapper.className;
        wrapper.className = wrapper.className.replace(/border-slate-200/g, 'border-emerald-500');
        window.setTimeout(() => { wrapper.className = original; }, 500);
      }
    }, 50);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, products]);

  // Selected products (used for printing + draw effect)
  const selected = useMemo(() => products.filter((p) => p.selected), [products]);
  const totalLabels = useMemo(() => selected.reduce((acc, p) => acc + p.copies, 0), [selected]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '').includes(q)
      );
    }
    if (filterCategory) {
      list = list.filter((p) => p.category === filterCategory);
    }
    return list;
  }, [products, searchQuery, filterCategory]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Draw barcodes useEffect is moved further down (after previewSample
  // and safeBarW/safeBarH are declared) to avoid TS2448 use-before-
  // declaration and runtime TDZ issues.

  const toggleProduct = (id: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, selected: !p.selected, copies: !p.selected ? copiesPerProduct : p.copies } : p))
    );
  };

  // ---------------------------------------------------------------------------
  // Auto-select by barcode / SKU / name (Enter-triggered).
  // ---------------------------------------------------------------------------
  // When the user types (or a barcode scanner sends) a barcode/SKU/product
  // name into the search box and presses Enter (or the scanner sends
  // Enter automatically), we look up a matching product and:
  //   1. Toggle its `selected` flag (so it appears in the print batch).
  //   2. Populate the manual SKU/name/price fields so the preview shows it.
  //   3. Clear the search box so the operator can scan the next barcode.
  //
  // The match is EXACT, case-insensitive, against:
  //   - product.barcode (most common — barcode scanners emit the stored barcode)
  //   - product.sku (fallback for shops that key in the SKU instead of scanning)
  //   - product.name (last resort, only when there's no ambiguity)
  //
  // If multiple products share the same barcode/sku we pick the first one
  // and show a warning. If nothing matches, the search box stays put and
  // we briefly flash the input border red so the operator gets feedback.
  // ---------------------------------------------------------------------------
  const searchInputWrapperRef = useRef<HTMLDivElement | null>(null);
  const flashSearchNoMatch = () => {
    const el = searchInputWrapperRef.current;
    if (!el) return;
    const original = el.className;
    el.className = el.className.replace(/border-slate-200/g, 'border-rose-500');
    setTimeout(() => { el.className = original; }, 600);
  };
  const handleAutoSelect = () => {
    const q = searchQuery.trim();
    if (!q) return;
    const qLower = q.toLowerCase();
    // Priority 1: exact barcode match
    let match = products.find((p) => (p.barcode || '').toLowerCase() === qLower);
    // Priority 2: exact SKU match
    if (!match) match = products.find((p) => (p.sku || '').toLowerCase() === qLower);
    // Priority 3: exact (trimmed) name match
    if (!match) match = products.find((p) => (p.name || '').toLowerCase().trim() === qLower);
    if (!match) {
      flashSearchNoMatch();
      return;
    }
    // Toggle + populate preview fields + clear search
    toggleProduct(match.id);
    setManualSku(match.sku || '');
    setManualName(match.name || '');
    setManualPrice(Number(match.salePrice) || 0);
    setSearchQuery('');
    setPage(1);
  };

  const selectAll = () => {
    const allFilteredSelected = filtered.every((f) => products.find((p) => p.id === f.id)?.selected);
    setProducts((prev) =>
      prev.map((p) => {
        const isInFiltered = filtered.some((f) => f.id === p.id);
        if (!isInFiltered) return p;
        return { ...p, selected: !allFilteredSelected, copies: !allFilteredSelected ? copiesPerProduct : p.copies };
      })
    );
  };

  const updateCopies = (id: string, copies: number) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, copies: Math.max(0, copies) } : p)));
  };

  const updateBulkCopies = () => {
    setProducts((prev) => prev.map((p) => (p.selected ? { ...p, copies: copiesPerProduct } : p)));
  };

  const handlePrint = async () => {
    if (selected.length === 0) {
      alert('من فضلك اختر منتج واحد على الأقل');
      return;
    }
    if (widthGuardError) {
      setPrintError(widthGuardError);
      alert(widthGuardError);
      return;
    }
    setPrintError('');
    // Wait for any pending barcodes to render
    await new Promise((r) => setTimeout(r, 300));
    const api: any = (window as any).hawr;
    if (!api || typeof api.print !== 'function') {
      window.print();
      return;
    }
    setPrinting(true);
    try {
      // Apply the user's offsets to the page size — positive X shifts
      // the print area to the right, positive Y to the bottom.
      const pageSize = {
        width: Math.round((paperDims.w + Math.abs(offsetXmm)) * 1000),
        height: Math.round((paperDims.h + Math.abs(offsetYmm)) * 1000),
      };
      const result = await api.print({
        silent: false,
        deviceName: printerName || undefined,
        pageSize,
        offsetX: Math.round(offsetXmm * 1000),
        offsetY: Math.round(offsetYmm * 1000),
      });
      if (!result || !result.ok) {
        setPrintError(result?.reason || result?.error || 'فشلت الطباعة');
      }
    } catch (e: any) {
      setPrintError(String(e?.message || e));
    } finally {
      setPrinting(false);
    }
  };

  const handleTestPrint = async () => {
    if (selected.length === 0) {
      alert('من فضلك اختر منتج للاختبار');
      return;
    }
    // Save current copies and force 1 for the test
    const restore = selected[0]?.copies;
    try {
      setProducts((prev) => prev.map((p) => p.id === selected[0].id ? { ...p, copies: 1 } : p));
      await new Promise((r) => setTimeout(r, 50));
      await handlePrint();
    } finally {
      if (restore !== undefined) {
        setProducts((prev) => prev.map((p) => p.id === selected[0].id ? { ...p, copies: restore } : p));
      }
    }
  };

  // --- Templates ---
  const captureCurrentTemplate = (name: string): LabelTemplate => ({
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: Date.now(),
    barcodeFormat,
    barcodeWidthMm,
    barcodeHeightMm,
    showBarcodeNumber,
    presetKey,
    customW,
    customH,
    rows,
    rowGapMm,
    marginXMm,
    marginYMm,
    borderRadiusMm,
    barcodeAlign,
    layoutStyle,
    fontFamily,
    fontSizePt,
    showShop,
    showName,
    showSku,
    showPrice,
    showRowDivider,
    offsetShopMm,
    offsetNameMm,
    offsetSkuMm,
    offsetPriceMm,
    offsetXmm,
    offsetYmm,
    shopName,
  });

  const handleSaveTemplate = () => {
    const name = (templateName || '').trim() || `قالب ${new Date().toLocaleDateString('ar-EG')}`;
    const tpl = captureCurrentTemplate(name);
    const next = [tpl, ...templates];
    setTemplates(next);
    saveTemplates(next);
    setTemplateName('');
    setTemplateMessage(`تم حفظ القالب "${name}" بنجاح`);
    setTimeout(() => setTemplateMessage(''), 3000);
  };

  const handleApplyTemplate = (tpl: LabelTemplate) => {
    setBarcodeFormat(tpl.barcodeFormat);
    setBarcodeWidthMm(tpl.barcodeWidthMm);
    setBarcodeHeightMm(tpl.barcodeHeightMm);
    setShowBarcodeNumber(tpl.showBarcodeNumber);
    setPresetKey(tpl.presetKey);
    setCustomW(tpl.customW);
    setCustomH(tpl.customH);
    setRows(tpl.rows);
    setRowGapMm(tpl.rowGapMm);
    setMarginXMm(tpl.marginXMm);
    setMarginYMm(tpl.marginYMm);
    setBorderRadiusMm(tpl.borderRadiusMm);
    setBarcodeAlign(tpl.barcodeAlign);
    setLayoutStyle(tpl.layoutStyle);
    setFontFamily(tpl.fontFamily);
    setFontSizePt(tpl.fontSizePt);
    setShowShop(tpl.showShop);
    setShowName(tpl.showName);
    setShowSku(tpl.showSku);
    setShowPrice(tpl.showPrice);
    setShowRowDivider(tpl.showRowDivider);
    setOffsetShopMm(tpl.offsetShopMm);
    setOffsetNameMm(tpl.offsetNameMm);
    setOffsetSkuMm(tpl.offsetSkuMm);
    setOffsetPriceMm(tpl.offsetPriceMm);
    setOffsetXmm(tpl.offsetXmm);
    setOffsetYmm(tpl.offsetYmm);
    setShopName(tpl.shopName);
    setTemplateMessage(`تم تطبيق القالب "${tpl.name}"`);
    setTimeout(() => setTemplateMessage(''), 3000);
  };

  const handleDeleteTemplate = (id: string) => {
    if (!confirm('حذف هذا القالب؟')) return;
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    saveTemplates(next);
  };

  const handleExportSettings = () => {
    const data = captureCurrentTemplate('export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hawr-label-settings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResetSettings = () => {
    if (!confirm('إعادة ضبط كل الإعدادات إلى القيم الافتراضية؟')) return;
    setPresetKey('2x2');
    setCustomW(50.8); setCustomH(50.8);
    setRows(2); setRowGapMm(1);
    setMarginXMm(1); setMarginYMm(1);
    setBorderRadiusMm(0);
    setBarcodeAlign('center');
    setLayoutStyle('balanced');
    setFontFamily('system'); setFontSizePt(7);
    setShowShop(true); setShowName(true); setShowSku(true); setShowPrice(true);
    setShowRowDivider(true); setShowBarcodeNumber(false);
    setOffsetShopMm(0); setOffsetNameMm(0); setOffsetSkuMm(0); setOffsetPriceMm(0);
    setBarcodeWidthMm(0); setBarcodeHeightMm(0);
    setOffsetXmm(0); setOffsetYmm(0);
  };

  // Resolve current paper dimensions from preset/custom.
  const labelDims = useMemo(() => {
    if (presetKey === 'custom') return { w: customW, h: customH };
    const p = PRESET_SIZES.find((s) => s.key === presetKey);
    return p ? { w: p.w, h: p.h } : { w: 50.8, h: 50.8 };
  }, [presetKey, customW, customH]);

  // Row height = (sticker H - top/bottom margins - total gaps) / rows
  const ROWS = Math.max(1, Math.min(4, rows));
  const totalGapH = rowGapMm * Math.max(0, ROWS - 1);
  const rowH = useMemo(
    () => Math.max(4, (labelDims.h - marginYMm * 2 - totalGapH) / ROWS),
    [labelDims.h, marginYMm, totalGapH, ROWS]
  );

  // Paper dimensions = sticker size exactly (no automatic doubling).
  const paperDims = useMemo(
    () => ({ w: labelDims.w, h: labelDims.h }),
    [labelDims]
  );

  // Width guard
  const widthGuardError = useMemo(() => {
    if (paperDims.w > MAX_PRINTER_WIDTH_MM) {
      return `العرض ${paperDims.w}مم يتجاوز الحد الأقصى للطابعة (${MAX_PRINTER_WIDTH_MM}مم).`;
    }
    return '';
  }, [paperDims.w]);

  // Effective barcode dimensions: if user set explicit width/height, clamp
  // to safe space within the row. Auto-fit when value is 0.
  const layoutCfg = LAYOUT_STYLES[layoutStyle];
  const safeBarW = useMemo(() => {
    const userW = barcodeWidthMm > 0 ? barcodeWidthMm : labelDims.w * layoutCfg.barFraction;
    return Math.max(8, Math.min(userW, labelDims.w - marginXMm * 2));
  }, [barcodeWidthMm, labelDims.w, marginXMm, layoutCfg.barFraction]);
  const safeBarH = useMemo(() => {
    const userH = barcodeHeightMm > 0 ? barcodeHeightMm : rowH * 0.5;
    return Math.max(4, Math.min(userH, rowH * 0.6));
  }, [barcodeHeightMm, rowH]);
  const barcodeWasClamped = barcodeHeightMm > safeBarH + 0.01;

  // Font family mapping
  const fontFamilyCss = useMemo(() => {
    switch (fontFamily) {
      case 'mono':    return '"Cascadia Mono", "Consolas", monospace';
      case 'classic': return '"Times New Roman", "Liberation Serif", serif';
      default:        return '"Cairo", "Segoe UI", system-ui, sans-serif';
    }
  }, [fontFamily]);

  // Sample product for preview (use manual if no selection)
  const previewSample = useMemo(() => {
    if (selected.length > 0) return selected[0];
    return {
      id: 'preview',
      sku: manualSku,
      name: manualName,
      salePrice: manualPrice,
    } as any;
  }, [selected, manualSku, manualName, manualPrice]);

  const barcodeValidation = useMemo(
    () => validateBarcodeData(barcodeFormat, previewSample.sku || ''),
    [barcodeFormat, previewSample.sku]
  );

  // Draw barcodes for preview, table column, and print — placed AFTER the
  // useMemo declarations of safeBarW/safeBarH/ROWS/previewSample so
  // dependencies are initialised in scope.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let JsBarcode: any = null;
      try { JsBarcode = await getJsBarcode(); } catch (e) { return; }
      if (!JsBarcode || cancelled) return;

      const sample = previewSample;
      if (!sample) return;
      const sku = (sample.sku || sample.id || '').toString();
      const format = barcodeFormat;
      const fPt = fontSizePt;
      const showNum = showBarcodeNumber;

      const drawAt = (el: HTMLElement, w: number, h: number) => {
        try {
          el.innerHTML = '';
          el.setAttribute('width', String(Math.max(20, Math.round(w * MM_TO_PX * 4))));
          el.setAttribute('height', String(Math.max(20, Math.round(h * MM_TO_PX * 4))));
          let jsf: any = 'CODE128';
          if (format === 'EAN13') jsf = 'EAN13';
          else if (format === 'CODE39') jsf = 'CODE39';
          else if (format === 'QR') jsf = 'QR';
          JsBarcode(el, sku, {
            format: jsf,
            width: 1.2,
            height: Math.round(h * MM_TO_PX * 4 * 0.7),
            displayValue: showNum,
            fontSize: Math.max(6, fPt),
            margin: 0,
            flat: true,
          });
        } catch (_) { /* ignore */ }
      };

      // 1) on-screen preview
      Array.from({ length: ROWS }, (_, r) => {
        const el = document.getElementById(`preview-svg-${r}`);
        if (el) drawAt(el, safeBarW, safeBarH);
      });

      // 2) table column
      products.forEach((p) => {
        if (!p.selected) return;
        const el = document.getElementById(`barcode-${p.id}`);
        if (el) drawAt(el, safeBarW, safeBarH);
      });

      // 3) print
      selected.forEach((p) => {
        for (let i = 0; i < p.copies; i++) {
          for (let r = 0; r < ROWS; r++) {
            const el = document.getElementById(`print-barcode-${p.id}-${i}-r${r}`);
            if (el) drawAt(el, safeBarW, safeBarH);
          }
        }
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, selected, ROWS, safeBarW, safeBarH, barcodeFormat, previewSample, fontSizePt, showBarcodeNumber]);

  return (
    <LabelErrorBoundary>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 font-sans" dir="rtl">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Tag className="w-5 h-5 text-emerald-600" />
            طباعة باركود المنتجات
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {activeLocation === 'gallery' ? 'منتجات المعرض' : 'منتجات المكتبة'} — مصمم استيكرات احترافي (ZYWELL ZY310 · {PRINT_DPI} DPI · {MAX_PRINTER_WIDTH_MM}mm)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-slate-500 font-mono">
            {selected.length} منتج · {totalLabels} استيكر
          </div>
          <button type="button" onClick={handleTestPrint}
            disabled={selected.length === 0 || printing || !!widthGuardError}
            className="px-3 py-2 bg-sky-50 hover:bg-sky-100 border border-sky-200 disabled:bg-slate-100 disabled:border-slate-200 text-sky-700 disabled:text-slate-400 font-bold rounded-xl text-xs flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> تجربة
          </button>
          <button ref={printButtonRef} type="button" onClick={handlePrint}
            disabled={selected.length === 0 || printing || !!widthGuardError}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold rounded-xl text-xs flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> {printing ? 'جاري الطباعة...' : 'طباعة الآن'}
          </button>
          <button type="button" onClick={handleSaveTemplate}
            className="px-3 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 font-bold rounded-xl text-xs flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" /> حفظ كقالب
          </button>
          <button type="button" onClick={handleExportSettings}
            className="px-2 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1.5"
            title="تحميل نسخة احتياطية من الإعدادات">
            ⬇ تصدير
          </button>
          <button type="button" onClick={handleResetSettings}
            className="px-2 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold rounded-xl text-xs flex items-center gap-1.5"
            title="إعادة ضبط الإعدادات">
            ⟲ إعادة ضبط
          </button>
          <button type="button"
            onClick={() => setSettingsCollapsed((v) => !v)}
            className="px-2 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold rounded-xl text-xs flex items-center gap-1.5"
            title={settingsCollapsed ? 'إظهار الإعدادات والمنتجات' : 'طي الإعدادات والمنتجات (معاينة فقط)'}>
            {settingsCollapsed ? '▼ إظهار الإعدادات' : '▲ طي الإعدادات'}
          </button>
        </div>
      </div>

      {/* Top-level Search Bar — independent, always visible at the top.
          This is the ONLY search input on this screen so it is also the
          one Alt+S targets (via data-search-input). The previous version
          nested the search inside the settings block, which made Alt+S
          a no-op when the settings block was collapsed. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs">
        <div className="relative" ref={searchInputWrapperRef}>
          <input
            ref={searchInputRef}
            type="text"
            data-search-input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            placeholder="امسح/اكتب باركود أو كود المنتج (Alt+S)"
            className="w-full px-3 py-2 pr-20 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <kbd className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">Enter</kbd>
        </div>
      </div>

      {/* Big live preview with measurement bar (collapsible, default closed) */}
      <div className="bg-white border border-slate-200 rounded-2xl">
        <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-200">
          <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> معاينة الباركود
          </div>
          <button
            type="button"
            onClick={() => setPreviewCollapsed((v) => !v)}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold rounded-lg text-[11px] flex items-center gap-1"
            title={previewCollapsed ? 'إظهار المعاينة' : 'طي المعاينة'}>
            {previewCollapsed ? '▼ إظهار' : '▲ طي'}
          </button>
        </div>
        {!previewCollapsed && (
        <div className="p-4">
          {/* Measurement bar (above preview, updates instantly) */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-slate-700">
          <span className="font-bold text-slate-900">📏 شريط القياسات:</span>
          <span>عرض الباركود: <b className="text-emerald-700">{safeBarW.toFixed(1)} مم</b></span>
          <span>ارتفاع الباركود: <b className="text-emerald-700">{safeBarH.toFixed(1)} مم</b>{barcodeWasClamped && <span className="text-amber-600 mr-1">(آمن)</span>}</span>
          <span>ارتفاع الصف: <b>{rowH.toFixed(1)} مم</b></span>
          <span>النوع: <b>{barcodeFormat}</b></span>
          <span className="text-slate-500 italic">— تتحدث فورياً مع كل تعديل</span>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          {/* The big preview sticker */}
          <div className="bg-slate-100 p-4 rounded-xl" style={{ minHeight: 200 }}>
            <div
              className="bg-white border-2 border-dashed border-emerald-400 relative shadow-md"
              style={{
                width: `${paperDims.w * PREVIEW_PX_PER_MM}px`,
                height: `${paperDims.h * PREVIEW_PX_PER_MM}px`,
                fontFamily: fontFamilyCss,
                fontSize: `${fontSizePt}pt`,
                padding: `${marginYMm * PREVIEW_PX_PER_MM}px ${marginXMm * PREVIEW_PX_PER_MM}px`,
                borderRadius: `${borderRadiusMm * PREVIEW_PX_PER_MM}px`,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: `${rowGapMm * PREVIEW_PX_PER_MM}px`,
                direction: 'rtl',
                overflow: 'hidden',
              }}
            >
              {Array.from({ length: ROWS }, (_, r) => (
                <div key={r}
                  className="relative"
                  style={{
                    flex: 1, minHeight: 0, width: '100%',
                    borderBottom: (showRowDivider && r < ROWS - 1) ? '1px dashed #999' : 'none',
                  }}
                >
                  {elements.shop.visible && shopName && (
                    <div className="absolute truncate"
                      style={elStyle(elements.shop, fontFamilyCss, 'rtl', `${elements.shop.fontSize}pt`) as any}>
                      {shopName}
                    </div>
                  )}
                  {elements.price.visible && (
                    <div className="absolute truncate"
                      style={elStyle(elements.price, fontFamilyCss, 'ltr', `${elements.price.fontSize}pt`) as any}>
                      {previewSample.salePrice?.toFixed(2)} ج.م
                    </div>
                  )}
                  {elements.name.visible && previewSample.name && (
                    <div className="absolute truncate"
                      style={elStyle(elements.name, fontFamilyCss, 'rtl', `${elements.name.fontSize}pt`) as any}>
                      {previewSample.name}
                    </div>
                  )}
                  {elements.barcode.visible && (
                    <div className="absolute"
                      style={elStyle(elements.barcode, fontFamilyCss, 'ltr', '0') as any}>
                      <svg id={`preview-svg-${r}`} style={{ width: '100%', height: '100%' }} />
                    </div>
                  )}
                  {elements.sku.visible && (
                    <div className="absolute truncate"
                      style={elStyle(elements.sku, fontFamilyCss, 'ltr', `${elements.sku.fontSize}pt`) as any}>
                      {previewSample.sku}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Info column */}
          <div className="flex-1 min-w-[200px] text-[11px] text-slate-600 space-y-1">
            <div>أبعاد الملصق: <b className="text-slate-900">{paperDims.w} × {paperDims.h} مم</b></div>
            <div>عدد الصفوف: <b className="text-slate-900">{ROWS}</b></div>
            <div>نمط التخطيط: <b className="text-slate-900">{LAYOUT_STYLES[layoutStyle].label}</b></div>
            <div>دقة الطابعة: <b className="text-slate-900">{PRINT_DPI} DPI</b></div>
            <div>أقصى عرض: <b className="text-slate-900">{MAX_PRINTER_WIDTH_MM} مم</b></div>
            <div>الخط: <b className="text-slate-900">{fontFamily}</b> ({fontSizePt}pt)</div>
            <div className={`pt-1 font-bold ${barcodeValidation.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
              {barcodeValidation.ok ? '✓ جاهز للطباعة' : '⚠ ' + barcodeValidation.msg}
            </div>
          </div>
        </div>
        </div>
        )}
      </div>

      {/* Accordion settings + Search (collapsible) */}
      {!settingsCollapsed && (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          {/* Helper: render a section header (clickable) */}
          {(() => {
            const Section = ({ k, icon, title, children }: any) => {
              const isOpen = openSections[k as AccordionKey];
              return (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenSections((s) => ({ ...s, [k]: !s[k] }))}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
                    aria-expanded={isOpen}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      {icon}
                      {title}
                    </span>
                    <span className={`text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                      <ChevronLeft className="w-4 h-4" />
                    </span>
                  </button>
                  {isOpen && <div className="p-3 space-y-2 bg-white">{children}</div>}
                </div>
              );
            };
            const Fld = ({ label, children }: any) => (
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">{label}</label>
                {children}
              </div>
            );
            const inputCls = "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500";
            const allOpen = Object.values(openSections).every(Boolean);
            const anyOpen = Object.values(openSections).some(Boolean);
            return (
              <>
                {/* Collapse / Expand all */}
                <div className="flex items-center gap-2 mb-2">
                  <button type="button"
                    onClick={() => setOpenSections({
                      product: true, size: true, layout: true, appearance: true, textpos: true, printer: true, elements: true,
                    } as any)}
                    className="flex-1 px-2 py-1.5 text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg font-bold hover:bg-emerald-100">
                    ▼ فتح كل الأقسام
                  </button>
                  <button type="button"
                    onClick={() => setOpenSections({
                      product: false, size: false, layout: false, appearance: false, textpos: false, printer: false, elements: false,
                    } as any)}
                    className="flex-1 px-2 py-1.5 text-[10px] bg-slate-50 border border-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-100">
                    ▶ طي كل الأقسام
                  </button>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {Object.values(openSections).filter(Boolean).length}/{Object.keys(openSections).length} مفتوح
                  </span>
                </div>

                {/* 1) Product data */}
                <Section k="product" icon={<Tag className="w-3.5 h-3.5" />} title="بيانات المنتج">
                  <Fld label="اسم المنتج">
                    <input className={inputCls} value={manualName} onChange={(e) => setManualName(e.target.value)} />
                  </Fld>
                  <Fld label="كود المنتج (SKU)">
                    <input className={inputCls} value={manualSku} onChange={(e) => setManualSku(e.target.value)} />
                  </Fld>
                  <Fld label="السعر (ج.م)">
                    <input type="number" min="0" step="0.01" className={inputCls}
                      value={manualPrice} onChange={(e) => setManualPrice(Math.max(0, Number(e.target.value) || 0))} />
                  </Fld>
                  <Fld label="اسم المعرض / المتجر">
                    <input className={inputCls} value={shopName} onChange={(e) => setShopName(e.target.value)} />
                  </Fld>
                  <Fld label="نوع الباركود">
                    <select className={inputCls} value={barcodeFormat}
                      onChange={(e) => setBarcodeFormat(e.target.value as BarcodeFormat)}>
                      <option value="CODE128">Code 128 (افتراضي)</option>
                      <option value="CODE39">Code 39</option>
                      <option value="EAN13">EAN-13 (12 أو 13 رقم)</option>
                      <option value="QR">QR Code</option>
                    </select>
                  </Fld>
                  {!barcodeValidation.ok && (
                    <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
                      {barcodeValidation.msg}
                    </div>
                  )}
                </Section>

                {/* 2) Sticker size */}
                <Section k="size" icon={<Settings className="w-3.5 h-3.5" />} title="مقاس الاستيكر">
                  <Fld label="المقاس الجاهز">
                    <select className={inputCls} value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
                      <option value="custom">مقاس مخصص (مم)</option>
                      {PRESET_SIZES.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>
                  </Fld>
                  {presetKey === 'custom' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Fld label="العرض (مم)"><input type="number" min="10" step="0.1" className={inputCls}
                        value={customW} onChange={(e) => setCustomW(Math.max(10, Number(e.target.value) || 50))} /></Fld>
                      <Fld label="الارتفاع (مم)"><input type="number" min="10" step="0.1" className={inputCls}
                        value={customH} onChange={(e) => setCustomH(Math.max(10, Number(e.target.value) || 50))} /></Fld>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Fld label="عدد الصفوف (1-4)"><input type="number" min="1" max="4" className={inputCls}
                      value={rows} onChange={(e) => setRows(Math.min(4, Math.max(1, Number(e.target.value) || 1)))} /></Fld>
                    <Fld label="فاصل بين الصفوف (مم)"><input type="number" min="0" step="0.1" className={inputCls}
                      value={rowGapMm} onChange={(e) => setRowGapMm(Math.max(0, Number(e.target.value) || 0))} /></Fld>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Fld label="هامش جانبي (مم)"><input type="number" min="0" step="0.1" className={inputCls}
                      value={marginXMm} onChange={(e) => setMarginXMm(Math.max(0, Number(e.target.value) || 0))} /></Fld>
                    <Fld label="هامش رأسي (مم)"><input type="number" min="0" step="0.1" className={inputCls}
                      value={marginYMm} onChange={(e) => setMarginYMm(Math.max(0, Number(e.target.value) || 0))} /></Fld>
                  </div>
                  <Fld label="استدارة الزوايا (مم)">
                    <input type="number" min="0" step="0.5" className={inputCls}
                      value={borderRadiusMm} onChange={(e) => setBorderRadiusMm(Math.max(0, Number(e.target.value) || 0))} />
                  </Fld>
                </Section>

                {/* 3) Layout */}
                <Section k="layout" icon={<Barcode className="w-3.5 h-3.5" />} title="ضبط التخطيط">
                  <Fld label="نمط التخطيط">
                    <select className={inputCls} value={layoutStyle} onChange={(e) => setLayoutStyle(e.target.value as LayoutStyle)}>
                      {Object.entries(LAYOUT_STYLES).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </Fld>
                  <Fld label="محاذاة الباركود">
                    <div className="flex gap-1">
                      {(['left', 'center'] as BarcodeAlign[]).map((a) => (
                        <button key={a} type="button"
                          onClick={() => setBarcodeAlign(a)}
                          className={`flex-1 px-2 py-1.5 text-[11px] font-bold rounded-lg border ${barcodeAlign === a ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                          {a === 'left' ? 'يسار' : 'وسط'}
                        </button>
                      ))}
                    </div>
                  </Fld>
                  <div className="grid grid-cols-2 gap-2">
                    <Fld label="عرض الباركود (مم، 0=تلقائي)">
                      <input type="number" min="0" step="0.5" className={inputCls}
                        value={barcodeWidthMm} onChange={(e) => setBarcodeWidthMm(Math.max(0, Number(e.target.value) || 0))} />
                    </Fld>
                    <Fld label="ارتفاع الباركود (مم، 0=تلقائي)">
                      <input type="number" min="0" step="0.5" className={inputCls}
                        value={barcodeHeightMm} onChange={(e) => setBarcodeHeightMm(Math.max(0, Number(e.target.value) || 0))} />
                    </Fld>
                  </div>
                  <button type="button" onClick={() => setShowBarcodeNumber(!showBarcodeNumber)}
                    className="flex items-center gap-1 text-[11px]">
                    {showBarcodeNumber ? <CheckSquare className="w-3.5 h-3.5 text-emerald-600" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}
                    <span>إظهار الرقم تحت الباركود</span>
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <Fld label="عدد النسخ لكل منتج"><input type="number" min="1" max="200" className={inputCls}
                      value={copiesPerProduct} onChange={(e) => setCopiesPerProduct(Math.max(1, Number(e.target.value) || 1))} /></Fld>
                    <Fld label="حجم الباركود %">
                      <input type="range" min="0.5" max="2" step="0.05" className="w-full accent-emerald-600"
                        value={barcodeScale}
                        onChange={(e) => { const v = Number(e.target.value) || 1; setBarcodeScale(v); try { localStorage.setItem('hawr_label_bc_scale', String(v)); } catch(_){} }} />
                    </Fld>
                  </div>
                </Section>

                {/* 4) Appearance */}
                <Section k="appearance" icon={<Eye className="w-3.5 h-3.5" />} title="مظهر وقالب الملصق">
                  <Fld label="نوع الخط">
                    <select className={inputCls} value={fontFamily} onChange={(e) => setFontFamily(e.target.value as FontFamily)}>
                      <option value="system">System (Cairo / Segoe UI)</option>
                      <option value="mono">Mono (Consolas)</option>
                      <option value="classic">Classic (Times New Roman)</option>
                    </select>
                  </Fld>
                  <Fld label="حجم الخط (نقاط)">
                    <input type="number" min="4" max="20" step="0.5" className={inputCls}
                      value={fontSizePt} onChange={(e) => setFontSizePt(Math.min(20, Math.max(4, Number(e.target.value) || 7)))} />
                  </Fld>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {([
                      ['showShop', 'اسم المتجر', showShop, setShowShop],
                      ['showName', 'اسم المنتج', showName, setShowName],
                      ['showSku', 'كود المنتج', showSku, setShowSku],
                      ['showPrice', 'السعر', showPrice, setShowPrice],
                    ] as any).map(([_, label, val, setter]: any) => (
                      <button key={label} type="button" onClick={() => setter(!val)} className="flex items-center gap-1 text-[11px]">
                        {val ? <CheckSquare className="w-3.5 h-3.5 text-emerald-600" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setShowRowDivider(!showRowDivider)} className="flex items-center gap-1 text-[11px]">
                    {showRowDivider ? <CheckSquare className="w-3.5 h-3.5 text-emerald-600" /> : <Square className="w-3.5 h-3.5 text-slate-400" />}
                    <span>إظهار الفاصل بين الصفوف</span>
                  </button>
                </Section>

                {/* 5) Per-element full layout (x, y, w, h, font, rotation, align) */}
                <Section k="textpos" icon={<Settings className="w-3.5 h-3.5" />} title="تخصيص كامل لكل عنصر">
                  <div className="text-[10px] text-slate-500 -mt-1">اختر العنصر، ثم اضبط موقعه وحجمه واتجاهه</div>
                  <Fld label="العنصر النشط">
                    <select className={inputCls} value={activeElement}
                      onChange={(e) => setActiveElement(e.target.value as ElementKey)}>
                      <option value="shop">اسم المتجر</option>
                      <option value="name">اسم المنتج</option>
                      <option value="sku">كود المنتج (SKU)</option>
                      <option value="price">السعر</option>
                      <option value="barcode">الباركود</option>
                    </select>
                  </Fld>
                  {(() => {
                    const cur = elements[activeElement];
                    const update = (patch: Partial<ElementConfig>) =>
                      setElements((prev) => ({ ...prev, [activeElement]: { ...prev[activeElement], ...patch } }));
                    return (
                      <div className="space-y-2 border border-slate-200 rounded-lg p-2 bg-slate-50/50">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => update({ visible: !cur.visible })}
                            className="flex items-center gap-1 text-[11px]">
                            {cur.visible
                              ? <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                              : <Square className="w-3.5 h-3.5 text-slate-400" />}
                            <span>إظهار هذا العنصر</span>
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Fld label="X أفقي (مم)">
                            <input type="number" step="0.1" className={inputCls} value={cur.x}
                              onChange={(e) => update({ x: Number(e.target.value) || 0 })} />
                          </Fld>
                          <Fld label="Y عمودي (مم)">
                            <input type="number" step="0.1" className={inputCls} value={cur.y}
                              onChange={(e) => update({ y: Number(e.target.value) || 0 })} />
                          </Fld>
                          <Fld label="العرض (مم)">
                            <input type="number" min="2" step="0.1" className={inputCls} value={cur.w}
                              onChange={(e) => update({ w: Math.max(2, Number(e.target.value) || 0) })} />
                          </Fld>
                          <Fld label="الارتفاع (مم)">
                            <input type="number" min="2" step="0.1" className={inputCls} value={cur.h}
                              onChange={(e) => update({ h: Math.max(2, Number(e.target.value) || 0) })} />
                          </Fld>
                          <Fld label="حجم الخط (نقط)">
                            <input type="number" min="4" max="32" step="0.5" className={inputCls} value={cur.fontSize}
                              onChange={(e) => update({ fontSize: Math.max(4, Number(e.target.value) || 7) })} />
                          </Fld>
                          <Fld label="الدوران (°)">
                            <select className={inputCls} value={cur.rotation}
                              onChange={(e) => update({ rotation: Number(e.target.value) as 0|90|180|270 })}>
                              <option value="0">0° (عادي)</option>
                              <option value="90">90° (← يمين)</option>
                              <option value="180">180° (مقلوب)</option>
                              <option value="270">270° (يسار →)</option>
                            </select>
                          </Fld>
                          <Fld label="المحاذاة الأفقية">
                            <select className={inputCls} value={cur.align}
                              onChange={(e) => update({ align: e.target.value as 'left'|'center'|'right' })}>
                              <option value="left">يسار</option>
                              <option value="center">وسط</option>
                              <option value="right">يمين</option>
                            </select>
                          </Fld>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <button type="button" onClick={() => update({ x: cur.x - 0.5 })}
                            className="px-2 py-1 text-[10px] bg-sky-100 text-sky-700 rounded font-bold">← X</button>
                          <button type="button" onClick={() => update({ x: cur.x + 0.5 })}
                            className="px-2 py-1 text-[10px] bg-sky-100 text-sky-700 rounded font-bold">X →</button>
                          <button type="button" onClick={() => update({ y: cur.y - 0.5 })}
                            className="px-2 py-1 text-[10px] bg-sky-100 text-sky-700 rounded font-bold">↑ Y</button>
                          <button type="button" onClick={() => update({ y: cur.y + 0.5 })}
                            className="px-2 py-1 text-[10px] bg-sky-100 text-sky-700 rounded font-bold">Y ↓</button>
                        </div>
                        <button type="button"
                          onClick={() => setElements({ ...DEFAULT_ELEMENTS })}
                          className="w-full px-2 py-1.5 text-[11px] bg-rose-50 border border-rose-200 text-rose-700 rounded-lg font-bold">
                          ⟲ إعادة كل العناصر للوضع الافتراضي
                        </button>
                      </div>
                    );
                  })()}
                </Section>

                {/* 6) Printer */}
                <Section k="printer" icon={<Printer className="w-3.5 h-3.5" />} title="إعدادات الطابعة والورق">
                  {printers.length > 0 && (
                    <Fld label="الطابعة">
                      <select className={inputCls} value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
                        <option value="">— الافتراضية —</option>
                        {printers.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.displayName || p.name}{p.isDefault ? ' (افتراضية)' : ''}
                          </option>
                        ))}
                      </select>
                    </Fld>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Fld label="إزاحة أفقية (مم)"><input type="number" step="0.1" className={inputCls}
                      value={offsetXmm} onChange={(e) => setOffsetXmm(Number(e.target.value) || 0)} /></Fld>
                    <Fld label="إزاحة رأسية (مم)"><input type="number" step="0.1" className={inputCls}
                      value={offsetYmm} onChange={(e) => setOffsetYmm(Number(e.target.value) || 0)} /></Fld>
                  </div>
                </Section>

                {widthGuardError && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
                    {widthGuardError}
                  </div>
                )}
                {printError && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
                    {printError}
                  </div>
                )}
                {templateMessage && (
                  <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                    {templateMessage}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        <div>
          <div className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" /> فلترة
          </div>
          <div className="space-y-2">
            {/* Search input was moved to a top-level independent bar at the top of the screen (Alt+S targets it). */}
            <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500">
              <option value="">كل الأقسام</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex items-center gap-2">
              <button type="button" onClick={selectAll} className="text-xs font-bold text-emerald-700 hover:text-emerald-900">
                تحديد/إلغاء تحديد الكل
              </button>
              {selected.length > 0 && (
                <button type="button" onClick={updateBulkCopies} className="text-xs font-bold text-sky-700 hover:text-sky-900">
                  تطبيق {copiesPerProduct} نسخة على المحدد
                </button>
              )}
            </div>
          </div>

          {/* Templates library (collapsible, default closed) */}
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" /> قوالب الطباعة
              </div>
              <button
                type="button"
                onClick={() => setTemplatesCollapsed((v) => !v)}
                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 font-bold rounded-lg text-[11px] flex items-center gap-1"
                title={templatesCollapsed ? 'إظهار قوالب الطباعة' : 'طي قوالب الطباعة'}>
                {templatesCollapsed ? '▼ إظهار القوالب' : '▲ طي القوالب'}
              </button>
            </div>
            {!templatesCollapsed && (
              <>
            <div className="flex gap-2">
              <input className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                placeholder="اسم القالب"
                value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
              <button type="button" onClick={handleSaveTemplate}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg">
                حفظ
              </button>
            </div>
            {templates.length === 0 ? (
              <div className="text-[11px] text-slate-500 mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                لا توجد قوالب محفوظة. اضبط الإعدادات ثم اضغط "حفظ" لإنشاء أول قالب.
              </div>
            ) : (
              <div className="space-y-1 mt-2 max-h-48 overflow-y-auto">
                {templates.map((t) => (
                  <div key={t.id} className="border border-slate-200 rounded-lg p-2 bg-slate-50 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-slate-800 truncate">{t.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {t.barcodeFormat} · {t.presetKey === 'custom' ? `${t.customW}×${t.customH}` : t.presetKey} · {t.rows} صفوف
                      </div>
                      <div className="text-[9px] text-slate-400">{new Date(t.createdAt).toLocaleString('ar-EG')}</div>
                    </div>
                    <button type="button" onClick={() => handleApplyTemplate(t)}
                      className="px-2 py-1 text-[10px] bg-sky-100 hover:bg-sky-200 text-sky-700 rounded font-bold">
                      استخدام
                    </button>
                    <button type="button" onClick={() => setActiveTemplateId(t.id === activeTemplateId ? '' : t.id)}
                      title={t.id === activeTemplateId ? 'إلغاء التعليق كافتراضي' : 'تعيين كقالب افتراضي'}
                      className={`px-2 py-1 text-[10px] rounded font-bold ${
                        t.id === activeTemplateId
                          ? 'bg-emerald-200 text-emerald-800 ring-1 ring-emerald-400'
                          : 'bg-slate-100 hover:bg-emerald-50 text-slate-600'
                      }`}>
                      {t.id === activeTemplateId ? '★ افتراضي' : 'تعيين افتراضي'}
                    </button>
                    <button type="button" onClick={() => handleDeleteTemplate(t.id)}
                      className="px-2 py-1 text-[10px] bg-rose-100 hover:bg-rose-200 text-rose-700 rounded font-bold">
                      حذف
                    </button>
                  </div>
                ))}
              </div>
            )}
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Product List (collapsible) */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-200 bg-slate-50/50">
          <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Barcode className="w-3.5 h-3.5" /> المنتجات ({filtered.length})
          </div>
          <button
            type="button"
            onClick={() => setProductsCollapsed((v) => !v)}
            className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-lg text-[11px] flex items-center gap-1"
            title={productsCollapsed ? 'إظهار جدول المنتجات' : 'طي جدول المنتجات'}>
            {productsCollapsed ? '▼ إظهار الجدول' : '▲ طي الجدول'}
          </button>
        </div>
        {!productsCollapsed && (
        <>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-center px-3 py-3 font-bold w-10">✓</th>
                <th className="text-right px-3 py-3 font-bold">المنتج</th>
                <th className="text-right px-3 py-3 font-bold">الكود</th>
                <th className="text-right px-3 py-3 font-bold">القسم</th>
                <th className="text-left px-3 py-3 font-bold">السعر</th>
                <th className="text-center px-3 py-3 font-bold">النسخ</th>
                <th className="text-center px-3 py-3 font-bold">معاينة</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">جاري التحميل...</td>
                </tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">لا توجد منتجات تطابق الفلاتر</td>
                </tr>
              ) : (
                paged.map((p) => (
                  <tr key={p.id} className={`border-t border-slate-100 hover:bg-slate-50 transition-colors ${p.selected ? 'bg-emerald-50/40' : ''}`}>
                    <td className="text-center px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleProduct(p.id)}
                        className="inline-flex"
                      >
                        {p.selected ? (
                          <CheckSquare className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{p.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.sku}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{p.category}</td>
                    <td className="px-3 py-2 text-left font-mono font-bold text-emerald-600">
                      {p.salePrice.toFixed(2)} ج.م
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min="1"
                        value={p.copies}
                        onChange={(e) => updateCopies(p.id, Number(e.target.value) || 1)}
                        disabled={!p.selected}
                        className="w-16 px-2 py-1 text-center bg-slate-50 border border-slate-200 rounded-md text-xs disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.selected && (
                        <div className="inline-block bg-white border border-slate-200 rounded p-1">
                          <svg id={`barcode-${p.id}`} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>عرض {paged.length} من {filtered.length}</span>
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
        </>
        )}
      </div>

      {/* Print-only layout — each element is absolutely positioned by the
          user-defined x/y/w/h/rotation/align from the `elements` config. */}
      <div className="print-only" ref={printRef}>
        <style>{`
          @page { size: ${paperDims.w}mm ${paperDims.h}mm; margin: 0; }
          @media print {
            html, body { margin: 0; padding: 0; background: #fff; }
            body * { visibility: hidden !important; }
            .print-area, .print-area * { visibility: visible !important; }
            .print-area { position: absolute; left: 0; top: 0; }
          }
          @media screen { .print-only { display: none; } }
          .print-area {
            display: flex;
            flex-direction: column;
            flex-wrap: nowrap;
            justify-content: flex-start;
            align-items: stretch;
            font-family: ${fontFamilyCss};
            color: #000;
            background: #fff;
            width: ${paperDims.w}mm;
            height: ${paperDims.h}mm;
            direction: rtl;
            padding: ${marginYMm}mm ${marginXMm}mm;
            box-sizing: border-box;
            gap: ${rowGapMm}mm;
            border-radius: ${borderRadiusMm}mm;
            overflow: hidden;
          }
          .print-row {
            position: relative;
            width: 100%;
            height: ${rowH}mm;
            box-sizing: border-box;
            overflow: hidden;
            page-break-inside: avoid;
            flex-shrink: 0;
            ${showRowDivider ? 'border-bottom: 0.2mm dashed #999;' : ''}
          }
          .print-row:last-child { ${showRowDivider ? 'border-bottom: none;' : ''} }
          /* Absolutely-positioned elements using the per-element config:
             position absolute, left/top: x/y, width/height: w/h, transform: rotate(deg) */
          .el {
            position: absolute;
            display: flex;
            overflow: hidden;
            box-sizing: border-box;
            transform-origin: center center;
            line-height: 1;
            font-weight: 700;
            padding: 0;
            margin: 0;
          }
          .el-shop    { font-weight: 800; }
          .el-name    { font-weight: 700; }
          .el-sku     { font-family: monospace; color: #333; }
          .el-price   { font-weight: 900; }
          .el-barcode { display: block; }
          .el-barcode svg { width: 100%; height: 100%; }
        `}</style>
        <div className="print-area">
          {selected.flatMap((p) =>
            Array.from({ length: p.copies }, (_, i) => (
              <div key={`${p.id}-${i}`} style={{ display: 'contents' }}>
                {Array.from({ length: ROWS }, (_, r) => (
                  <div key={r} className="print-row">
                    {elements.shop.visible && shopName && (
                      <div className="el el-shop" data-k="shop" data-r={r}
                        style={elStyle(elements.shop, fontFamilyCss, 'rtl', `${elements.shop.fontSize}pt`)}>
                        {shopName}
                      </div>
                    )}
                    {elements.name.visible && (
                      <div className="el el-name" data-k="name" data-r={r}
                        style={elStyle(elements.name, fontFamilyCss, 'rtl', `${elements.name.fontSize}pt`)}>
                        {p.name}
                      </div>
                    )}
                    {elements.sku.visible && (
                      <div className="el el-sku" data-k="sku" data-r={r}
                        style={elStyle(elements.sku, fontFamilyCss, 'ltr', `${elements.sku.fontSize}pt`)}>
                        {showBarcodeNumber ? p.sku : p.sku}
                      </div>
                    )}
                    {elements.price.visible && (
                      <div className="el el-price" data-k="price" data-r={r}
                        style={elStyle(elements.price, fontFamilyCss, 'ltr', `${elements.price.fontSize}pt`)}>
                        {p.salePrice.toFixed(2)} ج.م
                      </div>
                    )}
                    {elements.barcode.visible && (
                      <div className="el el-barcode" data-k="barcode" data-r={r}
                        style={elStyle(elements.barcode, fontFamilyCss, 'ltr', `${elements.barcode.fontSize}pt`)}>
                        <svg id={`print-barcode-${p.id}-${i}-r${r}`} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
    </LabelErrorBoundary>
  );
};
