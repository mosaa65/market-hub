/**
 * useFormKeyboardNavigation — التنقل بين حقول النموذج بلوحة المفاتيح وحدها.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا هذا الملف
 * ════════════════════════════════════════════════════════════════════════════
 * في المحلات الحقيقية، الكاشير لا يستعمل الفأرة: يمسك لوحة المفاتيح ويترك يده
 * على الأرقام. الأسهم و Tab يجب أن تنقله من (العميل) إلى (المستودع) إلى
 * (طريقة الدفع) إلى (المدفوع) إلى (الملاحظة) بترتيب منطقي، وأن تبقى القيمة
 * في الحقل المحسوب حتى يغادرها.
 *
 * المشكلة القديمة: التنقل بالأسهم كان يعمل في بعض الحقول ولا يعمل في غيرها —
 * لأن كل شاشة كانت تكتب `onKeyDown` بنفسها (أو لا تكتبه). وحقل الأرقام هو
 * الأسوأ: فيه الأسهم تعدّل القيمة فعلاً، فلو أخذناها للانتقال بين الحقول
 * لكان الكاشير عدّل الكمية أو المبلغ دون أن يقصد.
 *
 * القواعد المعتمدة هنا — واحدة على كل الشاشات:
 *
 *   1. Tab / Shift+Tab (and Enter / Shift+Enter) تنتقل بين الحقول دائماً.
 *   2. الأسهم ←/→: في الحقول النصية تبقى للمؤشر (تحرير النص)، وفي الأزرار
 *      والقوائم والتبويبات تنتقل — فمن لا يستخدم الفأرة يصل لطريقة الدفع
 *      ثم للحقل التالي بلا رفع يده.
 *   3. الأسهم ↑/↓ في حقل NUMBER تعدّل القيمة كما هي العادة — لا نسرقها.
 *   4. Enter = "تالٍ": يثبّت القيمة وينتقل. على زر أو رابط، يتركه للمتصفح.
 *   5. Shift+Enter = "سابق".
 *   6. Escape = مغادرة الحقل بلا انتقال.
 *
 * ⚠️ الأتوباص الأهم: لا شيء يعمل أثناء الكتابة:
 *   • داخل حقل إدخال: الأسهم الأفقية تبقى للمؤشر (تحرير النص).
 *   • أثناء تركيب حرف عربي (IME) نترك كل شيء للنظام.
 *   • الاختصارات العامة في التطبيق (F2/F4/F9 في الكاشير) لا تُعطَّل — هذا
 *     الملف لا يمسها، و`shouldHandleFormKey` يرفض فقط المفاتيح المتحركة.
 *
 * الطريقة: طبقة واحدة على مستوى الشاشة (event delegation) بدل عشرات
 * `onKeyDown` — فحقل يُضاف لاحقاً يدخل الترتيب تلقائياً بلا نسخ كود.
 */

export const FORM_NAVIGATION_ATTRIBUTE = "data-form-nav";

/** العناصر التي تُعتبر حقولاً قابلة للتنقل، بترتيب ظهورها في الصفحة. */
const FIELD_SELECTOR = [
  `input[${FORM_NAVIGATION_ATTRIBUTE}]`,
  `select[${FORM_NAVIGATION_ATTRIBUTE}]`,
  `textarea[${FORM_NAVIGATION_ATTRIBUTE}]`,
  `button[${FORM_NAVIGATION_ATTRIBUTE}]`,
].join(",");

/** عناصر لا يقفز إليها التنقل حتى لو وُسمت: معطّلة أو مخفية. */
function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (el.getAttribute("tabindex") === "-1" && el.tagName !== "INPUT") return false;
  // offsetParent === null means display:none (or a detached node). A field the
  // operator cannot see must not swallow the next keystroke.
  if (el.offsetParent === null && el.tagName !== "BODY") return false;
  return true;
}

/** The navigable fields of ONE form — never of the whole page. */
export function formFields(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(isFocusable);
}

/**
 * The nearest element that marks a navigation scope.
 *
 * Scoped rather than page-wide on purpose: the POS renders the product grid,
 * the cart and the payment panel at once. Arrow keys in the search box must
 * walk the checkout block, not thirty product cards.
 */
export function navigationScope(from: HTMLElement | null): HTMLElement | null {
  const explicit = from?.closest<HTMLElement>("[data-form-nav-scope]");
  if (explicit) return explicit;
  return from?.closest<HTMLElement>("form") ?? null;
}

type Direction = "next" | "previous";

/** Move focus by one field inside the scope, wrapping at the ends. */
export function moveFieldFocus(from: HTMLElement, direction: Direction): boolean {
  const scope = navigationScope(from);
  if (!scope) return false;
  const fields = formFields(scope);
  if (fields.length === 0) return false;
  const index = fields.indexOf(from);
  if (index === -1) return false;
  const nextIndex = direction === "next" ? index + 1 : index - 1;
  if (nextIndex < 0 || nextIndex >= fields.length) return false;
  const target = fields[nextIndex];
  target.focus();
  // A text field selects its content so the next keystroke replaces the value
  // instead of appending to it — this is what makes "type the amount" work
  // when the operator lands on a prefilled field.
  if (target instanceof HTMLInputElement && target.type !== "number") target.select();
  return true;
}

/** First text field of the scope, for "start typing anywhere" recovery. */
export function firstTextField(from: HTMLElement): HTMLElement | null {
  const scope = navigationScope(from);
  if (!scope) return null;
  return (
    formFields(scope).find(
      (el) =>
        el instanceof HTMLInputElement &&
        ["text", "number", "search", "tel", "email", "date"].includes(el.type),
    ) ?? null
  );
}

/**
 * Is this key press meant for TEXT ENTRY rather than navigation?
 *
 * Everything the hook must ignore is listed here and nowhere else, so the
 * rule is auditable: modifier combinations, F-keys, IME composition, and the
 * horizontal arrows while the caret is inside an editable field.
 */
export function shouldHandleFormKey(
  event: KeyboardEvent,
  active: HTMLElement | null,
  scope?: HTMLElement | null,
): boolean {
  if (event.isComposing || event.keyCode === 229) return false; // IME mid-composition
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (/^F\d{1,2}$/.test(event.key)) return false;

  const isEditable =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active !== null && active.isContentEditable);

  switch (event.key) {
    case "Enter":
    case "Escape":
      return isEditable;
    case "ArrowLeft":
    case "ArrowRight": {
      // In a text field both horizontal arrows move the caret (RTL or LTR), so
      // neither may navigate there. In a SELECT, button or tab they navigate.
      return !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
    }
    case "ArrowUp":
    case "ArrowDown":
      // A number input uses the vertical arrows to step its value; a select
      // uses them to change the option. Both are the browser's job.
      return false;
    default:
      return false;
  }
}

/**
 * Attach the form-navigation layer to a scope for the lifetime of a screen.
 *
 * Returns a detach function. The listener is on the CAPTURE phase so the POS
 * page's own global F-key handler (a bubble listener on `window`) is never
 * affected and Enter on the submit button still submits.
 */
export function attachFormNavigation(scope: HTMLElement): () => void {
  const handler = (event: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !scope.contains(active)) return;

    if (event.key === "Escape" && active instanceof HTMLElement) {
      if (active.matches(FIELD_SELECTOR)) {
        active.blur();
        event.preventDefault();
      }
      return;
    }

    if (!shouldHandleFormKey(event, active, scope)) return;

    if (event.key === "Enter") {
      // A button or link must keep its native activation.
      if (active.tagName === "BUTTON" || active.tagName === "A") return;
      const moved = moveFieldFocus(active, event.shiftKey ? "previous" : "next");
      if (moved) event.preventDefault();
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const isRtlScope = getComputedStyle(scope).direction === "rtl";
      const forward = isRtlScope ? event.key === "ArrowLeft" : event.key === "ArrowRight";
      const moved = moveFieldFocus(active, forward ? "next" : "previous");
      if (moved) event.preventDefault();
    }
  };

  scope.addEventListener("keydown", handler, true);
  return () => scope.removeEventListener("keydown", handler, true);
}
