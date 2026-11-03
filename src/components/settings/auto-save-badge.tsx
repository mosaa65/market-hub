import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

interface AutoSaveBadgeProps {
  lang: string;
  /**
   * عدّاد يتزايد عند كل تغيير محفوظ تلقائياً؛ كل زيادة تُظهر
   * الشارة لثانيتين ثم تُخفيها. القيمة الابتدائية (0) لا تُظهر شيئاً
   * حتى لا تومض الشارة عند فتح الشاشة.
   */
  trigger: number;
  className?: string;
}

/**
 * مؤشر «حُفظ تلقائياً» — معيار UX للتفضيلات التي تُطبق فوراً
 * (المظهر، نظام الأرقام، القائمة الجانبية…) بدل أزرار الحفظ اليدوي.
 */
export function AutoSaveBadge({ lang, trigger, className }: AutoSaveBadgeProps) {
  const [visible, setVisible] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(timer);
  }, [trigger]);

  if (!visible) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 transition-opacity duration-300 dark:text-emerald-400 ${className ?? ""}`}
    >
      <Check className="size-3" />
      {lang === "ar" ? "حُفظ تلقائياً" : "Auto-saved"}
    </span>
  );
}
