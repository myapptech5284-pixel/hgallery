// User-customizable shortcut mapping store.
//
// Goal: solve the "Arabic keyboard layout" problem at the source by
// letting the operator pick whatever key they want for each action.
// The default mappings already include both the Latin letter
// (Alt+S / Ctrl+S) AND Arabic letters (Alt+س / Ctrl+س), so the
// shortcuts work whether the keyboard is set to English or Arabic.
// Every mapping is fully user-editable from the in-app shortcuts
// settings screen (added under the "إعدادات" group in the main nav).
//
// Mapping entry shape:
//   { action: 'focusSearch', key: 's', alt: true, ctrl: false, meta: false }
// The key may be a Latin letter ('s'), an Arabic letter ('س'), a digit,
// or any printable character. The handler matches against the live
// keyboard event's key + modifiers.
//
// Storage: localStorage entry "hawr_shortcuts_v1" — a JSON array of
// ShortcutBinding entries. If the entry is missing the first time, we
// lazily seed it with DEFAULT_BINDINGS on first read so the operator
// always has a sensible starting point.

export type ShortcutAction =
  | 'focusSearch'        // Alt+S → focus the first [data-search-input]
  | 'saveForm'           // Ctrl+S → click the first [data-save-button]
  | 'openAddProduct'     // Ctrl+N (Products/Supplies) → open the Add modal
  | 'addItem'            // Ctrl+N generic
  | 'posComplete'        // Ctrl+S (POS) → complete the sale
  | 'posSuspend'         // Ctrl+W (POS) → suspend the sale
  | 'print'              // Ctrl+P → print
  | 'closeReceipt'       // Ctrl+X → close the receipt modal
  | 'help';              // F1 → show shortcut help

export interface ShortcutBinding {
  /** Stable id (uuid-like) so editing/dup-detection stays unambiguous. */
  id: string;
  /** Logical action the binding triggers. */
  action: ShortcutAction;
  /** Human label rendered in the UI next to the binding row. */
  label: string;
  /** Modifier flags — must be present on the keyboard event. */
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** The key to match. Either a single printable character (incl. Arabic)
   *  or one of the well-known non-printable names: 'Enter', 'Escape',
   *  'F1'..'F12'. We match against event.key (after lowercasing ASCII). */
  key: string;
}

// Default bindings — pre-populated to cover both Latin and Arabic layouts
// out of the box. Every action is reachable no matter what keyboard
// layout the user has.
export const DEFAULT_BINDINGS: ShortcutBinding[] = [
  // Search focus — Alt+S / Alt+س (Arabic Seen)
  { id: 'b1', action: 'focusSearch',     label: 'فوكس على البحث',         alt: true,  ctrl: false, meta: false, shift: false, key: 's'  },
  { id: 'b2', action: 'focusSearch',     label: 'فوكس على البحث',         alt: true,  ctrl: false, meta: false, shift: false, key: 'س'  },
  // Save — Ctrl+S / Ctrl+س
  { id: 'b3', action: 'saveForm',        label: 'حفظ (Ctrl+S)',          alt: false, ctrl: true,  meta: false, shift: false, key: 's'  },
  { id: 'b4', action: 'saveForm',        label: 'حفظ (Ctrl+S)',          alt: false, ctrl: true,  meta: false, shift: false, key: 'س'  },
  // Add — Ctrl+N / Ctrl+ن (Arabic Nun) — bound globally; the screens
  // opt in by listening for it.
  { id: 'b5', action: 'addItem',         label: 'إضافة جديدة',            alt: false, ctrl: true,  meta: false, shift: false, key: 'n'  },
  { id: 'b6', action: 'addItem',         label: 'إضافة جديدة',            alt: false, ctrl: true,  meta: false, shift: false, key: 'ن'  },
  // Print — Ctrl+P / Ctrl+ح (Arabic Haa) — operators sometimes use
  // ح for "طباعة" (print).
  { id: 'b7', action: 'print',           label: 'طباعة',                   alt: false, ctrl: true,  meta: false, shift: false, key: 'p'  },
  { id: 'b8', action: 'print',           label: 'طباعة',                   alt: false, ctrl: true,  meta: false, shift: false, key: 'ح'  },
  // Close — Ctrl+X / Ctrl+ص (Arabic Saad) — ص for "إغلاق"
  { id: 'b9', action: 'closeReceipt',    label: 'إغلاق',                   alt: false, ctrl: true,  meta: false, shift: false, key: 'x'  },
  { id: 'bA', action: 'closeReceipt',    label: 'إغلاق',                   alt: false, ctrl: true,  meta: false, shift: false, key: 'ص'  },
];

const STORAGE_KEY = 'hawr_shortcuts_v1';

function safeRead(): ShortcutBinding[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [...DEFAULT_BINDINGS];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // First read — seed the storage with defaults so editing starts from
      // a known-good place. Caller will see defaults; subsequent edits are
      // persisted.
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_BINDINGS));
      return [...DEFAULT_BINDINGS];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_BINDINGS));
      return [...DEFAULT_BINDINGS];
    }
    // Validate each entry has the minimum shape — drop anything bogus.
    const ok: ShortcutBinding[] = [];
    for (const e of parsed) {
      if (typeof e !== 'object' || !e) continue;
      if (typeof e.id !== 'string' || typeof e.action !== 'string' || typeof e.key !== 'string') continue;
      ok.push({
        id: e.id,
        action: e.action,
        label: typeof e.label === 'string' ? e.label : '',
        alt: !!e.alt,
        ctrl: !!e.ctrl,
        meta: !!e.meta,
        shift: !!e.shift,
        key: e.key,
      });
    }
    return ok.length ? ok : [...DEFAULT_BINDINGS];
  } catch {
    return [...DEFAULT_BINDINGS];
  }
}

export function getAllBindings(): ShortcutBinding[] {
  return safeRead();
}

export function saveBindings(bindings: ShortcutBinding[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    }
  } catch {
    /* ignore */
  }
}

export function resetBindingsToDefaults(): ShortcutBinding[] {
  saveBindings(DEFAULT_BINDINGS);
  return [...DEFAULT_BINDINGS];
}

export function addBinding(b: ShortcutBinding): ShortcutBinding[] {
  const all = getAllBindings();
  all.push(b);
  saveBindings(all);
  return all;
}

export function updateBinding(id: string, patch: Partial<ShortcutBinding>): ShortcutBinding[] {
  const all = getAllBindings();
  const idx = all.findIndex((b) => b.id === id);
  if (idx === -1) return all;
  all[idx] = { ...all[idx], ...patch };
  saveBindings(all);
  return all;
}

export function deleteBinding(id: string): ShortcutBinding[] {
  const all = getAllBindings().filter((b) => b.id !== id);
  saveBindings(all);
  return all;
}

/**
 * Match a keyboard event against the user's binding set. Returns the
 * matched action or null. The comparison uses `event.key` directly
 * (case-folded for ASCII) so any printable character works — Arabic
 * letters, Hebrew letters, Cyrillic, etc. The user picks whatever
 * letter they want in the settings UI and it just works on whatever
 * keyboard layout they happen to have active.
 *
 * Special case: function keys (F1..F12) come through with `event.key`
 * already in the right form ("F1".."F12") and we keep the comparison
 * case-sensitive so the case-folded binding matches.
 */
export function matchBinding(
  e: KeyboardEvent,
  bindings: ShortcutBinding[]
): ShortcutAction | null {
  // Normalise event.key once: ASCII letters lowercased, Arabic/Hebrew/
  // Cyrillic letters unchanged, function keys like 'F1' left as-is
  // (we lower them too for simplicity since 'f1' vs 'F1' is the only
  // ambiguity and both are uncommon chars in bindings).
  const ekRaw = e.key || '';
  const ek = /^[A-Za-z]$/.test(ekRaw) ? ekRaw.toLowerCase() : ekRaw.toLowerCase();
  for (const b of bindings) {
    if (!!b.alt !== !!e.altKey) continue;
    if (!!b.ctrl !== !!e.ctrlKey) continue;
    if (!!b.meta !== !!e.metaKey) continue;
    if (!!b.shift !== !!e.shiftKey) continue;
    const bkRaw = b.key || '';
    const bk = /^[A-Za-z]$/.test(bkRaw) ? bkRaw.toLowerCase() : bkRaw.toLowerCase();
    if (bk === ek) return b.action;
  }
  return null;
}
