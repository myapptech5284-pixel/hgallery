import { useEffect, useRef, RefObject } from 'react';

/**
 * useFormShortcuts
 * ----------------
 * A small hook that wires a "shortcut key → action" map to the document's
 * keydown event while the hook is mounted (typically while a modal or a
 * particular screen is visible).
 *
 * Each shortcut is a key combination (e.g. "ctrl+n", "alt+c") that, when
 * detected, runs the matching action. By default the hook is mounted only
 * when `enabled` is true (e.g. when a modal is open).
 *
 * Keys are normalised to lowercase and use the "ctrl" / "alt" / "shift" /
 * "meta" tokens separated by "+" — the order is irrelevant.
 */
export type ShortcutAction = (e: KeyboardEvent) => void;
export type ShortcutMap = Record<string, ShortcutAction>;

function normalize(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  if (event.metaKey) parts.push('meta');
  // ALWAYS prefer `event.code` over `event.key` for letter/digit/numpad
  // physical keys — `event.code` is the physical key (KeyS, KeyB, KeyP,
  // Digit1..9, Numpad1..9, F1..F12) and is independent of the active
  // language layout, while `event.key` is what the OS produced (e.g. the
  // physical "B" key produces "لا" on a standard Arabic keyboard, U+FEFB,
  // a single-codepoint ligature — none of which match the user-supplied
  // 'b' shortcut). Trusting `event.code` makes every Alt/Ctrl+letter
  // shortcut layout-independent in one shot.
  let k = '';
  const code = event.code || '';
  const key = event.key || '';
  if (/^Key[A-Z]$/.test(code)) {
    // Physical letter: 'KeyS' → 's', 'KeyB' → 'b', 'KeyP' → 'p', etc.
    k = code.charAt(3).toLowerCase();
  } else if (/^Digit\d$/.test(code)) {
    // Top-row digit: 'Digit1' → '1'.
    k = code.charAt(5);
  } else if (/^Numpad\d$/.test(code)) {
    // Numpad digit: 'Numpad1' → '1'.
    k = code.charAt(6);
  } else if (/^F\d{1,2}$/.test(code)) {
    // Function keys: 'F5' → 'f5'.
    k = code.toLowerCase();
  } else {
    // Non-physical keys (Escape, Enter, Arrow*, Tab, Backspace, …) fall
    // back to event.key lowercased.
    k = key.toLowerCase();
  }
  if (k) parts.push(k);
  return parts.join('+');
}

export function useFormShortcuts(map: ShortcutMap, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const key = normalize(e);
      const action = map[key];
      if (!action) return;
      // Don't fire shortcuts while the user is typing into an input/textarea
      // unless the action explicitly opts in by checking `e`.
      const target = e.target as HTMLElement | null;
      const isInput =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      // For shortcuts that contain a modifier (ctrl/alt/meta), always allow
      // them — they are explicit user actions. For un-modified single keys
      // like "escape" or "enter", always allow as well. Otherwise skip.
      const hasModifier = e.ctrlKey || e.altKey || e.metaKey || e.shiftKey;
      if (isInput && !hasModifier) {
        // Let Escape and Enter pass through even when focused on an input.
        if (e.key !== 'Escape' && e.key !== 'Enter') return;
      }
      e.preventDefault();
      e.stopPropagation();
      action(e);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map, enabled]);
}

/**
 * focusRef
 * --------
 * Tiny helper to create a typed ref + a `.focus()` shortcut.
 *
 * Example:
 *   const skuRef = focusRef<HTMLInputElement>();
 *   ...
 *   <input ref={skuRef} ... />
 *   useFormShortcuts({ 'alt+c': () => skuRef.current?.focus() }, open);
 */
export function focusRef<T extends HTMLElement>(): RefObject<T> {
  return useRef<T>(null);
}
