import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, LocationType } from './types.ts';
import { api } from './services/api.ts';
import { AuthScreen } from './components/AuthScreen.tsx';
import { Header } from './components/Header.tsx';
import { PosScreen } from './components/PosScreen.tsx';
import { ProductsScreen } from './components/ProductsScreen.tsx';
import { SuppliesScreen } from './components/SuppliesScreen.tsx';
import { InstallmentsScreen } from './components/InstallmentsScreen.tsx';
import { CustomersScreen } from './components/CustomersScreen.tsx';
import { SuppliersScreen } from './components/SuppliersScreen.tsx';
import { ExpensesScreen } from './components/ExpensesScreen.tsx';
import { ReportsScreen } from './components/ReportsScreen.tsx';
import { InvoicesScreen } from './components/InvoicesScreen.tsx';
import { LabelPrintScreen } from './components/LabelPrintScreen.tsx';
import { EmployeesScreen } from './components/EmployeesScreen.tsx';
import { BackupScreen } from './components/BackupScreen.tsx';
import { ShortcutsSettingsScreen } from './components/ShortcutsSettingsScreen.tsx';
import { getAllBindings as getShortcutBindings, matchBinding as matchUserBinding, type ShortcutBinding } from './services/shortcutsStore';

// Global keyboard shortcuts
// ------------------------
// - Alt+S : focus the first visible search input on the active page.
// - Ctrl+S: click the first visible save / submit button on the active
//           page (or submit the first visible form if no save button).
//
// Screens opt-in to these by marking the relevant elements with
//   data-search-input  (for Alt+S)
//   data-save-button   (for Ctrl+S)
// If those markers are missing, the handler falls back to a heuristic
// (placeholder contains "ابحث"/"بحث" for search; button text contains
// "حفظ"/"إضافة"/"موافق" for save).
// Debug logging helper. Enable by setting localStorage.setItem('hawr_shortcut_debug','1')
// in DevTools, then reload. Helps diagnose why a shortcut didn't fire.
function shortcutLog(...args: any[]) {
  try {
    if (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('hawr_shortcut_debug') === '1') {
      // eslint-disable-next-line no-console
      console.log('[shortcut]', ...args);
    }
  } catch (_) { /* ignore */ }
}
function isVisible(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  // Walk the parent chain — an element with rect>0 can still be inside a
  // hidden container; the user won't actually see/focus it.
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const rect = cur.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(cur);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    cur = cur.parentElement;
  }
  return true;
}
function findSearchInput(): HTMLInputElement | null {
  // Trust the data-attribute path unconditionally — App.tsx mounts only
  // the active tab at a time, so a `[data-search-input]` element in the
  // DOM is by definition the right one for the current screen, even if
  // it is briefly hidden by a modal overlay. The previous version's
  // isVisible() check on this path was the cause of the "first press
  // works, then nothing" bug in some edge cases (parent container
  // toggled display:none -> flex mid-animation).
  const opted = document.querySelector<HTMLInputElement>('[data-search-input]');
  if (opted) return opted;
  // Fallback: any visible text/search input whose placeholder contains
  // بحث / ابحث / Search.
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="search"], input:not([type])'));
  for (const inp of inputs) {
    if (!isVisible(inp)) continue;
    const ph = (inp.placeholder || '').toLowerCase();
    if (ph.includes('ابحث') || ph.includes('بحث') || ph.includes('search')) return inp;
  }
  // Final fallback: first visible text/search input on the page (any).
  for (const inp of inputs) {
    if (isVisible(inp)) return inp;
  }
  // Absolute last-resort: first VISIBLE INPUT of ANY kind on the page
  // (date, number, select, textarea…). On tabs without a dedicated
  // search bar (Reports, Expenses, Employees) this means Alt+S still
  // focuses SOMETHING useful — usually the first filter/date input at
  // the top of the page — so the shortcut is never a silent no-op.
  const anyInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea'));
  for (const inp of anyInputs) {
    if (isVisible(inp) && !inp.disabled && inp.type !== 'hidden') return inp;
  }
  return null;
}
function findSaveButton(): HTMLButtonElement | null {
  // Trust the data-attribute path unconditionally (see findSearchInput
  // for rationale — the previous isVisible() check caused regressions).
  const opted = document.querySelector<HTMLButtonElement>('[data-save-button]');
  if (opted && !opted.disabled) return opted;
  // Fallback: any visible button whose text contains save keywords.
  // The list is intentionally generous — Arabic UI uses many synonyms.
  const keywords = [
    'حفظ التعديلات', 'حفظ الفاتورة', 'حفظ العميل', 'حفظ المورد', 'حفظ المنتج',
    'حفظ', 'إضافة', 'موافق', 'تسجيل', 'تأكيد', 'save', 'submit'
  ];
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  for (const btn of buttons) {
    if (!isVisible(btn) || btn.disabled) continue;
    if (btn.getAttribute('type') === 'button') continue; // skip non-submit type=button
    const txt = (btn.textContent || '').toLowerCase();
    if (keywords.some((k) => txt.includes(k))) return btn;
  }
  return null;
}
function findSaveForm(): HTMLFormElement | null {
  // First visible form on the page (forms are usually modal-scoped).
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form'));
  for (const f of forms) {
    if (isVisible(f)) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// MODULE-LEVEL SHORTCUT REGISTRATION — runs once when the bundle loads, BEFORE
// any React component mounts. The handler is attached directly to
// `document.documentElement` (the <html> root, the very top of the DOM tree)
// in BOTH capture AND bubble phase, with FOUR separate registrations so it
// cannot be lost.
//
// Why this is the root-cause fix:
//  1. Module-level code cannot be unmounted by React. Once it runs, the
//     handler stays attached for the entire lifetime of the renderer
//     process — even if the App component is unmounted and remounted by
//     a React error boundary, by a hot reload, or by a memory-pressure
//     re-render. The previous hook-based approach could in principle lose
//     its listeners if App's `useEffect(..., [])` ran into a quirk.
//  2. `document.documentElement` is the highest DOM node — any keyboard
//     event on any element MUST pass through it (capture and bubble
//     phases). Antivirus / IME / accessibility tools that hook at the
//     window or document level cannot intercept events before they reach
//     <html>.
//  3. Both capture AND bubble registrations — if a library somewhere
//     calls `e.stopImmediatePropagation()` on a sibling handler, we
//     still get at least one of our four dispatchers.
//  4. `e.code` fallback — on Arabic / AZERTY / Dvorak keyboards the
//     `event.key` for the physical "S" key may be the Arabic Seen "س" or
//     some other character that does not lowercase to 's'. Checking
//     `event.code === 'KeyS'` (always the physical key) makes the
//     shortcut layout-independent.
//  5. Self-healing — every animation frame, we re-assert all four
//     listener registrations. If anything somehow dropped one, it gets
//     re-attached within ~16ms.
//
// This handler reads the "logged in" state from a module-level mutable
// ref that `useGlobalShortcuts` updates whenever React renders. That way
// the module-level handler can stay outside React's lifecycle entirely.
// ---------------------------------------------------------------------------
type ShortcutCtx = { user: User | null; tab: string };
const shortcutCtxRef: { current: ShortcutCtx } = { current: { user: null, tab: 'pos' } };
let moduleHandlerInstalled = false;
function moduleShortcutHandler(e: KeyboardEvent) {
  try {
    const ctx = shortcutCtxRef.current;
    if (!ctx.user) { shortcutLog('mod-handler: skip — not logged in'); return; }
    // @ts-ignore — isComposing exists at runtime
    if (e.isComposing) { shortcutLog('mod-handler: skip — IME'); return; }
    // NOTE: We deliberately do NOT bail out for POS. The module-level
    // handler is responsible for Alt+S and Ctrl+S on EVERY tab. POS has
    // its own local handler for Ctrl+W/P/X (its own POS-specific
    // shortcuts); Alt+S and Ctrl+S are universal and are owned by this
    // handler. Removing the bail-out is what makes the shortcuts work
    // reliably on every machine — the previous code relied on a
    // per-screen hook that could be unmounted by React, leaving the
    // user with no shortcuts at all.

    const mod = e.ctrlKey || e.metaKey;
    // Layout-independent: accept either 's'/'S' OR Arabic Seen 'س' in
    // `event.key`, AND the physical 'KeyS' code regardless of layout.
    // Same pattern for F key (Alt+F is the additional shortcut requested
    // by user — Alt+F focuses the search/barcode input on every screen
    // that has a data-search-input). On Arabic keyboards the physical
    // F key produces the Arabic letter "ب" (not "ف") — that's why we
    // match 'ب' here, not 'ف'. The physical 'KeyF' code covers AZERTY,
    // Dvorak, and any other non-QWERTY layout.
    const key = (e.key || '').toLowerCase();
    const code = e.code || '';
    const isSKey = key === 's' || key === 'س' || code === 'KeyS';
    const isFKey = key === 'f' || key === 'ب' || code === 'KeyF';
    const isAltS = e.altKey && !mod && isSKey;
    const isAltF = e.altKey && !mod && isFKey;
    const isCtrlS = mod && !e.altKey && isSKey;
    if (!isAltS && !isAltF && !isCtrlS) return;

    shortcutLog('mod-handler matched', isAltS ? 'Alt+S' : isAltF ? 'Alt+F' : 'Ctrl+S', 'code=' + code, 'key=' + e.key, 'tab=' + ctx.tab);

    e.preventDefault();

    if (isAltS || isAltF) {
      const inp = findSearchInput();
      shortcutLog('mod-handler', isAltF ? 'Alt+F' : 'Alt+S', '→', inp ? (inp.placeholder || inp.tagName) : 'NOT FOUND');
      if (inp) {
        try { inp.focus({ preventScroll: false } as any); } catch (_) { /* ignore */ }
        try { inp.select(); } catch (_) { /* ignore */ }
      }
      return;
    }
    if (isCtrlS) {
      const btn = findSaveButton();
      shortcutLog('mod-handler Ctrl+S →', btn ? (btn.textContent || '').trim().slice(0, 40) : 'NOT FOUND');
      if (btn) { btn.click(); return; }
      const form = findSaveForm();
      if (form) {
        try {
          if (typeof (form as any).requestSubmit === 'function') {
            (form as any).requestSubmit();
          } else {
            (form as HTMLFormElement).submit();
          }
        } catch (_) { /* ignore */ }
      }
    }
  } catch (err) {
    // Never throw out of a keyboard handler — would break all subsequent keys.
    shortcutLog('mod-handler crashed:', String(err));
  }
}
function installModuleShortcutsOnce() {
  if (moduleHandlerInstalled) return;
  moduleHandlerInstalled = true;
  if (typeof document === 'undefined' || !document.documentElement) return;
  // Capture phase on <html>
  document.documentElement.addEventListener('keydown', moduleShortcutHandler, true);
  // Bubble phase on <html>
  document.documentElement.addEventListener('keydown', moduleShortcutHandler, false);
  // Capture phase on window (belt-and-suspenders)
  window.addEventListener('keydown', moduleShortcutHandler, true);
  // Bubble phase on window (belt-and-suspenders)
  window.addEventListener('keydown', moduleShortcutHandler, false);

  // Aggressive self-healing: re-assert every 100ms via setInterval.
  // We previously used requestAnimationFrame, but rAF pauses when the
  // window is hidden / minimised / the user is on another desktop.
  // setInterval keeps firing regardless of focus state — the listener
  // is therefore guaranteed to be present no matter what the user
  // does with the window.
  //
  // addEventListener is idempotent for the same (target, type, listener,
  // capture) tuple, so this is cheap and guarantees the listener is
  // always present.
  const heal = () => {
    try {
      document.documentElement.addEventListener('keydown', moduleShortcutHandler, true);
      document.documentElement.addEventListener('keydown', moduleShortcutHandler, false);
      window.addEventListener('keydown', moduleShortcutHandler, true);
      window.addEventListener('keydown', moduleShortcutHandler, false);
    } catch (_) { /* ignore */ }
  };
  const healInterval = setInterval(heal, 100);

  // Also re-assert on every focusin — same trick as the React-side hook.
  document.documentElement.addEventListener('focusin', heal, true);

  // Stash on window for diagnostics (visible in DevTools if needed).
  (window as any).__hawr_shortcut_heal = healInterval;
  shortcutLog('module-level shortcut handler installed (4 registrations + 100ms self-heal + focusin)');
}

// Install immediately when the bundle loads — runs once, before React.
// Wrapped in a try so SSR / non-DOM environments don't blow up.
try { installModuleShortcutsOnce(); } catch (_) { /* ignore */ }

/**
 * useGlobalShortcuts
 * ------------------
 * Attaches a single persistent keydown listener (capture phase, on
 * BOTH window AND document) that implements Alt+S (focus search) and
 * Ctrl+S (save) globally while the user is logged in. Implementation
 * notes:
 *
 *  - The hook attaches the listener EXACTLY ONCE for the lifetime of
 *    the component (empty dep array). The previous bug where the
 *    effect re-ran on `[active]` and re-bound the listener at every
 *    state change is now impossible.
 *  - The current "logged in" state is read through a ref so the
 *    handler always sees the latest value without re-binding.
 *  - The listener uses the capture phase so it fires before any
 *    nested component can stop propagation.
 *  - The listener is also bound on `document` (in addition to
 *    `window`) as belt-and-suspenders against any weird Electron /
 *    Chromium routing of keyboard events.
 *  - The handler does NOT call `stopPropagation` (only
 *    `preventDefault`) so a screen's own bubble-phase hook can
 *    still run if it wants to.
 *  - The focusin safety net on document.documentElement re-attaches
 *    the listener in case any library has removed it.
 *  - The opted-in path (`data-search-input` / `data-save-button`)
 *    intentionally does NOT check `isVisible()` — the active tab is
 *    the only one mounted at a time, so its marked element is the
 *    right target even during transient modal animations.
 *  - Enable debug logs by setting localStorage.setItem(
 *    'hawr_shortcut_debug','1') in DevTools and reloading.
 */
function useGlobalShortcuts(currentUser: User | null, activeTab: string) {
  const userRef = useRef<User | null>(currentUser);
  const tabRef = useRef<string>(activeTab);
  useEffect(() => { userRef.current = currentUser; }, [currentUser]);
  useEffect(() => { tabRef.current = activeTab; }, [activeTab]);

  // Keep the MODULE-LEVEL handler in sync. The module-level handler runs
  // outside React's lifecycle (installed at bundle-load time) but still
  // needs to know who's logged in and which tab is active. We push the
  // values into the shared ref on every render — the module-level handler
  // reads from that ref when a keydown arrives.
  shortcutCtxRef.current.user = currentUser;
  shortcutCtxRef.current.tab = activeTab;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only act when the user is logged in. Otherwise this hook is a no-op
      // (so the login screen's own Enter/Ctrl+Enter behaviour is unaffected).
      if (!userRef.current) {
        shortcutLog('skip — not logged in');
        return;
      }

      // Don't fire while the user is composing a character (IME).
      // @ts-ignore — `isComposing` exists on KeyboardEvent at runtime.
      if (e.isComposing) { shortcutLog('skip — IME composing'); return; }

      // NOTE: We deliberately do NOT bail out for POS — the global
      // Alt+S / Ctrl+S handler must fire on every tab including POS.
      // POS owns Ctrl+W/P/X (its local hook handles those), but the
      // universal Alt+S and Ctrl+S belong here.

      const mod = e.ctrlKey || e.metaKey;
      // Layout-independent: accept 's'/'S' OR Arabic Seen 'س' in event.key,
      // AND physical 'KeyS' code (covers AZERTY / Dvorak / any layout).
      // Same pattern for F key — Alt+F is the additional shortcut the user
      // asked for to focus the search/barcode input. On Arabic keyboards
      // the physical F key produces "ب" (not "ف"); the physical 'KeyF'
      // code covers all other layouts.
      const k = (e.key || '').toLowerCase();
      const isSKey = k === 's' || k === 'س' || e.code === 'KeyS';
      const isFKey = k === 'f' || k === 'ب' || e.code === 'KeyF';
      const isAltS = e.altKey && !mod && isSKey;
      const isAltF = e.altKey && !mod && isFKey;
      const isCtrlS = mod && !e.altKey && isSKey;
      if (!isAltS && !isAltF && !isCtrlS) return;

      shortcutLog('matched', isAltS ? 'Alt+S' : isAltF ? 'Alt+F' : 'Ctrl+S', 'on tab', tabRef.current);

      // Only preventDefault — do NOT call stopPropagation, so a screen's
      // own bubble-phase shortcut hook (e.g. POS) can still run if it
      // wants to. Belt-and-suspenders: we already bail out above on tabs
      // that own their own handler.
      e.preventDefault();

      if (isAltS || isAltF) {
        const inp = findSearchInput();
        shortcutLog((isAltF ? 'Alt+F' : 'Alt+S') + ' → search input:', inp ? (inp.placeholder || inp.tagName) : 'NOT FOUND');
        if (inp) {
          try { inp.focus({ preventScroll: false } as any); } catch (_) { /* ignore */ }
          try { inp.select(); } catch (_) { /* ignore */ }
        }
        return;
      }

      if (isCtrlS) {
        const btn = findSaveButton();
        shortcutLog('Ctrl+S → save button:', btn ? (btn.textContent || '').trim().slice(0, 40) : 'NOT FOUND');
        if (btn) { btn.click(); return; }
        const form = findSaveForm();
        if (form) {
          shortcutLog('Ctrl+S → submitting form (no save button found)');
          if (typeof (form as any).requestSubmit === 'function') {
            (form as any).requestSubmit();
          } else {
            (form as HTMLFormElement).submit();
          }
        }
        return;
      }
    };

    // Belt-and-suspenders: bind the listener on BOTH window AND document,
    // in CAPTURE phase. Whichever sees the event first runs the handler.
    // The handler is idempotent (focus, click, requestSubmit are all
    // safe to call once) so duplicate dispatch is harmless.
    window.addEventListener('keydown', handler, true);
    document.addEventListener('keydown', handler, true);

    // Paranoid safety net #1: re-assert the listener on every focusin, in
    // case a library somewhere removed it. Idempotent — same function ref.
    const reassert = () => {
      try { window.addEventListener('keydown', handler, true); } catch (_) { /* ignore */ }
      try { document.addEventListener('keydown', handler, true); } catch (_) { /* ignore */ }
    };
    document.documentElement.addEventListener('focusin', reassert, true);

    // Paranoid safety net #2: re-assert the listener every 30 seconds via
    // a polling interval. Some environments (especially Electron + certain
    // Windows accessibility tools, IMEs, or security software) can drop
    // window listeners behind the scenes without firing any focusin. The
    // 30s tick is short enough to recover within a couple of seconds if
    // the user reports the bug, and infrequent enough to be invisible.
    const pollReassert = setInterval(reassert, 30000);

    shortcutLog('global Alt+S/Ctrl+S handler attached (capture phase on window + document)');

    return () => {
      window.removeEventListener('keydown', handler, true);
      document.removeEventListener('keydown', handler, true);
      document.documentElement.removeEventListener('focusin', reassert, true);
      clearInterval(pollReassert);
    };
  }, []);
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('hawr_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [isInitialized, setIsInitialized] = useState<boolean>(true);
  const [checkingInit, setCheckingInit] = useState<boolean>(true);

  // Active operational location (gallery / stationery / electrical tools)
  const [activeLocation, setActiveLocation] = useState<LocationType>('gallery');

  // Navigation tab (defaults to pos - "أزل صفحة نظرة عامة واجعل التنقل يبدأ بالصفحات التشغيلية الأساسية")
  const [activeTab, setActiveTab] = useState<string>('pos');

  // The POS registers a callback here so the cart can be suspended as a draft
  // before the tab is left. Leaving POS used to discard whatever was in the
  // cart with no trace — the cashier returned to an empty sale.
  const posLeaveHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const registerPosLeaveHandler = useCallback((handler: (() => Promise<void>) | null) => {
    posLeaveHandlerRef.current = handler;
  }, []);

  const handleTabChange = async (tab: string) => {
    if (activeTab === 'pos' && tab !== 'pos' && posLeaveHandlerRef.current) {
      try {
        await posLeaveHandlerRef.current();
      } catch (err) {
        console.warn('[hawr] failed to suspend cart before leaving POS:', err);
      }
    }
    setActiveTab(tab);
  };

  const checkInitialization = async () => {
    setCheckingInit(true);
    try {
      const res = await api.getSystemInit();
      setIsInitialized(res.initialized);
      if (!res.initialized) {
        // No admin yet, wipe any stale session
        setCurrentUser(null);
        localStorage.removeItem('hawr_user');
      }
    } catch (err) {
      console.error('Failed to check initialization status:', err);
    } finally {
      setCheckingInit(false);
    }
  };

  useEffect(() => {
    checkInitialization();
  }, []);

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem('hawr_user', JSON.stringify(user));
    setIsInitialized(true);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('hawr_user');
  };

  // Wire the global Alt+S / Ctrl+S shortcuts while the user is logged in.
  // The handler in this file is a no-op when the user is on the
  // AuthScreen, so login (which also uses Ctrl+Enter / Enter) is unaffected.
  // Pass the raw `currentUser` (not just a boolean) so the hook's ref stays
  // in sync with the actual user object for any future per-user logic.
  // Pass `activeTab` so the hook can bow out on tabs (like POS) that own
  // their own Ctrl+S / Ctrl+W / Ctrl+P / Escape handling — otherwise the
  // global capture-phase listener would starv the local bubble-phase one.
  useGlobalShortcuts(currentUser, activeTab);

  const handleSystemResetSuccess = () => {
    setCurrentUser(null);
    localStorage.removeItem('hawr_user');
    setIsInitialized(false);
    setActiveTab('pos');
  };

  if (checkingInit) {
    return (
      <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center p-4 font-sans text-slate-800" dir="rtl">
        <div className="text-center text-slate-600 space-y-3 bg-white p-8 rounded-2xl border border-slate-200 shadow-xs">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold tracking-wide">جاري فحص حالة قاعدة بيانات معرض حور...</p>
        </div>
      </div>
    );
  }

  // If user is not authenticated or system needs first-boot admin creation
  if (!currentUser) {
    return (
      <AuthScreen
        isInitialized={isInitialized}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9] flex flex-col font-sans text-slate-800" dir="rtl">
      {/* Top Header & Navigation */}
      <Header
        currentUser={currentUser}
        activeLocation={activeLocation}
        onLocationChange={setActiveLocation}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onLogout={handleLogout}
      />

      {/* Main Workspace View */}
      <main className="flex-1 overflow-x-hidden">
        {activeTab === 'pos' && (
          <PosScreen
            currentUser={currentUser}
            activeLocation={activeLocation}
            onRegisterLeaveHandler={registerPosLeaveHandler}
          />
        )}

        {activeTab === 'products' && (
          <ProductsScreen
            currentUser={currentUser}
            activeLocation={activeLocation}
            onLocationChange={setActiveLocation}
          />
        )}

        {activeTab === 'supplies' && (
          <SuppliesScreen
            currentUser={currentUser}
            activeLocation={activeLocation}
            onLocationChange={setActiveLocation}
          />
        )}

        {activeTab === 'installments' && (
          <InstallmentsScreen
            currentUser={currentUser}
            activeLocation={activeLocation}
            onLocationChange={setActiveLocation}
          />
        )}

        {activeTab === 'customers' && (
          <CustomersScreen currentUser={currentUser} />
        )}

        {activeTab === 'suppliers' && (
          <SuppliersScreen currentUser={currentUser} />
        )}

        {activeTab === 'expenses' && (
          <ExpensesScreen
            currentUser={currentUser}
            activeLocation={activeLocation}
            onLocationChange={setActiveLocation}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsScreen
            currentUser={currentUser}
            activeLocation={activeLocation}
            onLocationChange={setActiveLocation}
          />
        )}

        {activeTab === 'invoices' && (
          <InvoicesScreen
            currentUser={currentUser}
          />
        )}

        {activeTab === 'labels' && (
          <LabelPrintScreen
            activeLocation={activeLocation}
          />
        )}

        {activeTab === 'employees' && (
          <EmployeesScreen
            currentUser={currentUser}
          />
        )}

        {activeTab === 'backup' && (
          <BackupScreen
            currentUser={currentUser}
            onSystemResetSuccess={handleSystemResetSuccess}
          />
        )}
      </main>
    </div>
  );
}
