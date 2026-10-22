import { useCallback, useEffect, useRef, useState } from "react";

/**
 * شاشة البداية.
 *
 * كانت مؤقتين داخل useEffect وحدها. إن لم يُشغَّل التأثير إطلاقاً — أو حُجز
 * التبويب فلم تُنفَّذ المؤقتات في وقتها — تبقى الطبقة بلون الخلفية فوق كل
 * شيء بـ z-[99999]، وهي طبقة تمنع النقر: لا زر يعمل، ولا حقل يُضغط، لأن
 * عنصراً غيره هو الذي يستقبل النقرة. ولأن غيابها هو الافتراض، فالحراسة
 * هنا لا تُترك للمؤقت.
 */
export function VortexSplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const dismissed = useRef(false);

  // تُعرَّف قبل التأثير: استدعاؤها من داخل setTimeout قبل تعريف const
  // يرمي ReferenceError، فيموت التأثير كله وتبقى طبقة البداية تغطي الشاشة.
  const dismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    // إزالة فورية بدل انتظار انتقال CSS: الغرض هو تحرير الشاشة للنقر، لا
    // إظهار تلاشٍ جميل.
    setFading(true);
    setVisible(false);
    try {
      sessionStorage.setItem("vortex_splash_shown", "true");
    } catch {
      /* لا شيء: الغرض إخفاء الشاشة، لا الكتابة */
    }
  }, []);

  useEffect(() => {
    let hidden = false;
    try {
      hidden = sessionStorage.getItem("vortex_splash_shown") === "true";
    } catch {
      // التخزين محظور (تصفح خاص أو سياسة صرامة): اعرض الشاشة، فالوقت القصير
      // أفضل من تعطيل التطبيق.
    }
    if (hidden) {
      dismissed.current = true;
      setVisible(false);
      return;
    }

    const fadeTimer = setTimeout(() => setFading(true), 1100);
    const removeTimer = setTimeout(dismiss, 1500);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-background transition-opacity duration-300 ease-out ${
        fading ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      aria-hidden="true"
      onClick={dismiss}
      onPointerDown={dismiss}
    >
      <div className="flex flex-col items-center justify-center space-y-4 px-4 text-center">
        <img
          src="/vortex-erp-wordmark.png"
          alt="Vortex ERP"
          className="h-20 sm:h-24 w-auto object-contain select-none animate-in fade-in zoom-in-95 duration-500"
        />
        <div className="h-1 w-24 overflow-hidden rounded-full bg-muted/60">
          <div className="h-full w-full rounded-full bg-primary/80 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
