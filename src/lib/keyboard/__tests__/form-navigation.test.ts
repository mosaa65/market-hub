/**
 * How to run:
 *   npx tsx src/lib/keyboard/__tests__/form-navigation.test.ts
 *
 * The audit's open item was: "لم أتحقق من أن الاختصارات لا تُنفَّذ أثناء الكتابة
 * في الحقول، ولا من تطابقها بين الشاشات." This test pins the decision table so
 * it cannot drift between screens again.
 *
 * Only the pure predicates are exercised here (`shouldHandleFormKey`); the DOM
 * traversal in the same module is a thin wrapper around `querySelectorAll`.
 */

import assert from "node:assert/strict";
import { shouldHandleFormKey } from "../form-navigation";

/** A KeyboardEvent-shaped object: the predicate reads only these fields. */
function key(k: string, extra: Partial<KeyboardEvent> = {}) {
  return {
    key: k,
    keyCode: 0,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...extra,
  } as KeyboardEvent;
}

/** Minimal stand-ins — the predicate only uses `instanceof`. */
class FakeInput { }
class FakeTextarea { }

// The predicate checks real DOM classes; provide them for this process.
const g = globalThis as unknown as Record<string, unknown>;
g.HTMLInputElement = FakeInput;
g.HTMLTextAreaElement = FakeTextarea;

function input(extra: Record<string, unknown> = {}) {
  return Object.assign(new FakeInput(), extra) as unknown as HTMLElement;
}
function textarea() {
  return new FakeTextarea() as unknown as HTMLElement;
}
function button() {
  return { tagName: "BUTTON" } as unknown as HTMLElement;
}

/* ── 1. Typing is never intercepted ─────────────────────────────────────── */
{
  // Letters, digits, space: the hook has no opinion, the field keeps them.
  for (const k of ["a", "5", " ", "،", "ة"]) {
    assert.equal(shouldHandleFormKey(key(k), input()), false, `"${k}" must not navigate`);
  }
}

/* ── 2. Modifier combos belong to the browser / the app, not the form ───── */
{
  assert.equal(shouldHandleFormKey(key("Enter", { ctrlKey: true }), input()), false);
  assert.equal(shouldHandleFormKey(key("Enter", { metaKey: true }), input()), false);
  assert.equal(shouldHandleFormKey(key("ArrowRight", { altKey: true }), button()), false);
}

/* ── 3. Function keys stay with the screen's own shortcuts (F2/F4/F9) ───── */
{
  for (const k of ["F1", "F2", "F4", "F9", "F12"]) {
    assert.equal(shouldHandleFormKey(key(k), input()), false, `${k} must not navigate`);
  }
}

/* ── 4. Horizontal arrows inside a text field move the caret ────────────── */
{
  assert.equal(shouldHandleFormKey(key("ArrowRight"), input()), false);
  assert.equal(shouldHandleFormKey(key("ArrowLeft"), input()), false);
  assert.equal(shouldHandleFormKey(key("ArrowRight"), textarea()), false);
  assert.equal(shouldHandleFormKey(key("ArrowLeft"), textarea()), false);
}

/* ── 5. …but they DO navigate away from a button / tab ──────────────────── */
{
  assert.equal(shouldHandleFormKey(key("ArrowRight"), button()), true);
  assert.equal(shouldHandleFormKey(key("ArrowLeft"), button()), true);
}

/* ── 6. Vertical arrows are the field's own (number stepper / select) ───── */
{
  assert.equal(shouldHandleFormKey(key("ArrowUp"), input()), false);
  assert.equal(shouldHandleFormKey(key("ArrowDown"), input()), false);
  assert.equal(shouldHandleFormKey(key("ArrowUp"), button()), false);
}

/* ── 7. Enter / Escape advance and leave a field, but not an on-screen ──── */
{
  assert.equal(shouldHandleFormKey(key("Enter"), input()), true);
  assert.equal(shouldHandleFormKey(key("Enter", { shiftKey: true }), input()), true);
  assert.equal(shouldHandleFormKey(key("Escape"), input()), true);
  // Nothing to "advance" from when focus is nowhere.
  assert.equal(shouldHandleFormKey(key("Enter"), null), false);
}

/* ── 8. An IME composition in progress is untouchable (Arabic typing) ───── */
{
  assert.equal(shouldHandleFormKey(key("Enter", { isComposing: true }), input()), false);
  assert.equal(shouldHandleFormKey(key("Enter", { keyCode: 229 }), input()), false);
  assert.equal(shouldHandleFormKey(key("ArrowRight", { keyCode: 229 }), button()), false);
}

console.log("form-navigation: all assertions passed");
