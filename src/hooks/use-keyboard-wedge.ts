import { useEffect, useRef } from "react";

/**
 * Keyboard-Wedge barcode capture.
 *
 * USB / Bluetooth barcode scanners that operate in "keyboard wedge" mode type
 * the barcode as if it were a keyboard and usually finish with Enter. This hook
 * buffers those keystrokes at the window level and emits the captured code once
 * it looks like a scan.
 *
 * Important honesty note: a keyboard-wedge scanner is indistinguishable from a
 * human keyboard at the browser level. This hook therefore only decides whether
 * a key sequence *looks like* a scan; it never claims a device is "connected".
 *
 * Safety rules:
 * - Never capture keystrokes typed inside a real form field (input / textarea /
 *   select / contenteditable), so normal typing is never hijacked.
 * - Never capture while disabled (e.g. while a camera dialog is open).
 * - Only accept printable characters, ending on Enter.
 * - Reject sequences that are too short or too slow to be a scan.
 */

const MIN_LENGTH = 4;
const MAX_LENGTH = 64;
/** Max gap between two keystrokes that still counts as machine-typed. */
const MAX_KEY_GAP_MS = 50;
/** Max total time from the first key to Enter that still counts as a scan. */
const MAX_TOTAL_MS = 1500;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface UseKeyboardWedgeOptions {
  /** Called with the raw barcode when a scan-like sequence is completed. */
  onScan: (code: string) => void;
  /** When true, the listener is detached (e.g. camera dialog open, page hidden). */
  disabled?: boolean;
}

export function useKeyboardWedge({ onScan, disabled = false }: UseKeyboardWedgeOptions) {
  // Keep the latest callback so the listener effect does not need to re-bind.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (disabled) return;
    if (typeof window === "undefined") return;

    let buffer = "";
    let firstKeyAt = 0;
    let lastKeyAt = 0;

    const reset = () => {
      buffer = "";
      firstKeyAt = 0;
      lastKeyAt = 0;
    };

    const handler = (e: KeyboardEvent) => {
      // Never hijack typing inside real form fields.
      if (isEditableTarget(e.target)) return;

      const now = Date.now();

      // Enter / NumpadEnter commits the buffered sequence.
      if (e.key === "Enter" || e.key === "NumpadEnter") {
        if (
          buffer.length >= MIN_LENGTH &&
          buffer.length <= MAX_LENGTH &&
          now - firstKeyAt <= MAX_TOTAL_MS
        ) {
          const code = buffer;
          reset();
          onScanRef.current(code);
        } else {
          reset();
        }
        return;
      }

      // Only single printable characters build a barcode.
      if (e.key.length !== 1) {
        reset();
        return;
      }

      // A gap too large means the previous characters were human typing.
      if (firstKeyAt !== 0 && now - lastKeyAt > MAX_KEY_GAP_MS) {
        buffer = "";
        firstKeyAt = 0;
      }

      if (firstKeyAt === 0) firstKeyAt = now;
      lastKeyAt = now;
      buffer += e.key;

      if (buffer.length > MAX_LENGTH) reset();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [disabled]);
}
