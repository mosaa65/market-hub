"use client";

/**
 * AnchoredPanel — the one popup that never gets buried.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا وُجد
 * ════════════════════════════════════════════════════════════════════════════
 * منتقي الصنف في شاشات الأمانات كان يرسم قائمته بـ`position: absolute` داخل
 * النموذج نفسه. ولوحة الطحن (`MillingPanel`) ذات `overflow-hidden`، فهي سياق
 * قصّ: القائمة تُمتدّ داخل الصندوق فقط، فيختفي نصفها ونصّها خلف حدّ اللوحة —
 * ويبدو النموذج «غبيًا» لأنه يعرض قائمة لا تُرى.
 *
 * الحلّ ثلاثة أشياء معًا، ولا واحد منها يكفي وحده:
 *
 *   1. `createPortal` على `document.body` — يخرج من أي سياق قصّ (`overflow`,
 *      `transform`, `filter`) مهما كان الآباء.
 *   2. قياس المساحة الفعلية عند الفتح (أسفل/أعلى/يمين/يسار) وتثبيت `top/left`
 *      على الإحداثيات المقيسة — فلا يعتمد على الحاوية أن تفسح له مكانًا.
 *   3. **قرار ذكي للاتجاه**: إن ضاق الأسفل ولم يتّسع إلا لأقلّ من ارتفاع أدنى،
 *      يُقلب للأعلى، ويُقصّ الارتفاع على المساحة المتاحة فعلًا في كل اتجاه
 *      (مع هامش ٨px للفوتر والنافذة). النتيجة: القائمة تُفتح دائمًا في مكان
 *      يظهر فيه نصّها كاملًا.
 *
 * العرض يُطابق عرض العنصر المرساة (أو حدًّا أدنى)، ويُعاد القياس عند التمرير
 * وتغيير حجم النافذة ليبقى ملتصقًا بزرّه.
 */

import * as React from "react";
import { createPortal } from "react-dom";

export type PanelPlacement = "bottom" | "top";

export interface AnchoredPanelProps {
  /** العنصر الذي تُمحاذى إليه اللوحة. */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  /** الارتفاع المفضّل قبل القصّ — يُقصّ على المساحة المتاحة. */
  preferredHeight?: number;
  /** أقلّ ارتفاع مقبول قبل قلب الاتجاه للأعلى. */
  minHeight?: number;
  /** الحدّ الأدنى للعرض، حين تكون المرساة أضيق من المحتوى. */
  minWidth?: number;
  /** أقصى عرض، لتجنّب لوحة تفيض عن الشاشة على الجوّال. */
  maxWidth?: number;
  /** يُنادى عند النقر خارج اللوحة أو ضغط Escape — المستدعي يملك حالة الفتح. */
  onDismiss?: () => void;
  className?: string;
  children: React.ReactNode;
}

const GAP = 6; // المسافة بين الحقل واللوحة
const VIEWPORT_MARGIN = 8; // لا تلتصق اللوحة بحافة الشاشة

export function AnchoredPanel({
  anchorRef,
  open,
  preferredHeight = 320,
  minHeight = 180,
  minWidth = 0,
  maxWidth = 460,
  onDismiss,
  className,
  children,
}: AnchoredPanelProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null);

  const measure = React.useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const spaceBelow = viewportH - rect.bottom - GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN;

    /*
     * القرار: نفضّل الأسفل، لكن إن لم يتّسع للحدّ الأدنى وأعلى منه مساحة
     * أكبر بكثير، نقلب للأعلى. المقارنة صارمة قليلًا (`spaceAbove > spaceBelow`)
     * حتى لا نُقلب اللوحة في حالة متكافئة، فيبقى المسار المتوقّع هو الأسفل.
     */
    const placement: PanelPlacement =
      spaceBelow < minHeight && spaceAbove > spaceBelow ? "top" : "bottom";

    const available = placement === "bottom" ? spaceBelow : spaceAbove;
    const height = Math.max(120, Math.min(preferredHeight, available));

    const width = Math.max(
      minWidth,
      Math.min(Math.max(rect.width, minWidth), maxWidth, viewportW - VIEWPORT_MARGIN * 2),
    );

    /*
     * المحاذاة أفقية: نلتصق بحافة المرساة اليمنى في RTL (بداية القراءة) أو
     * اليسرى في LTR، ثم نُزحزح داخل الشاشة كي لا تخرج عن حدّها.
     */
    const rtl = document.documentElement.getAttribute("dir") === "rtl";
    let left = rtl ? rect.right - width : rect.left;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportW - width - VIEWPORT_MARGIN));

    setStyle({
      position: "fixed",
      left: Math.round(left),
      width: Math.round(width),
      ...(placement === "bottom"
        ? { top: Math.round(rect.bottom + GAP) }
        : { bottom: Math.round(viewportH - rect.top + GAP) }),
      maxHeight: Math.round(height),
      zIndex: 60,
    });
  }, [anchorRef, preferredHeight, minHeight, minWidth, maxWidth]);

  React.useEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    measure();

    const onScrollOrResize = () => measure();
    window.addEventListener("resize", onScrollOrResize);
    // `capture` يلتقط تمرير أي حاوية داخلية (لوح النموذج نفسها) لا النافذة فقط.
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, measure]);

  /* إغلاق بالنقر خارج اللوحة وبمفتاح Escape — كما يتوقّع أي منبثقة. */
  React.useEffect(() => {
    if (!open || !onDismiss) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchorRef, onDismiss]);

  if (!open || !style) return null;

  return createPortal(
    <div
      ref={panelRef}
      data-anchored-panel=""
      style={style}
      className={className}
      // لوحة عائمة على الشاشة: لا تُقصّ من مكوّن أب.
    >
      {children}
    </div>,
    document.body,
  );
}
