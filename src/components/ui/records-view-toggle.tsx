import { LayoutGrid, List, TableProperties } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RecordsViewMode } from "@/components/ui/records-view";
import { useI18n } from "@/lib/i18n";

/**
 * View-mode switcher — cards / list / table (plan §2).
 *
 * تصميم موحّد على كل الأجهزة (جوال/لابتوب): زر دائري صغير أنيق يعرض أيقونة
 * الوضع الحالي، وكل نقرة تنتقل للوضع التالي — نفس نمط أزرار نقطة البيع
 * (صغير، لا يأخذ مساحة، ويعرض التلميح عند التمرير).
 */
export interface RecordsViewToggleProps {
  value: RecordsViewMode;
  onChange: (mode: RecordsViewMode) => void;
  /** Modes a screen does not support are not offered at all. */
  modes?: RecordsViewMode[];
  /** Kept for API compatibility — the compact circular style is now the default. */
  cycle?: boolean;
  className?: string;
}

const ICONS: Record<RecordsViewMode, typeof LayoutGrid> = {
  cards: LayoutGrid,
  list: List,
  table: TableProperties,
};

const LABEL_KEYS: Record<RecordsViewMode, string> = {
  cards: "records.view.cards",
  list: "records.view.list",
  table: "records.view.table",
};

export function RecordsViewToggle({
  value,
  onChange,
  modes = ["cards", "list", "table"],
  className,
}: RecordsViewToggleProps) {
  const { t } = useI18n();

  if (modes.length <= 1) return null;

  const currentIndex = modes.indexOf(value);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + 1) % modes.length;
  const nextMode = modes[nextIndex];

  const CurrentIcon = ICONS[value] || LayoutGrid;
  const currentLabel = t(LABEL_KEYS[value]) || value;
  const nextLabel = t(LABEL_KEYS[nextMode]) || nextMode;

  // زر دائري صغير موحّد — نفس نمط أزرار نقطة البيع على الجوال واللابتوب:
  // أيقونة الوضع الحالي، ونقرة واحدة تنتقل للوضع التالي مع تلميح وصفي.
  return (
    <button
      type="button"
      onClick={() => onChange(nextMode)}
      aria-label={`${currentLabel} — ${t("records.view.switch_hint")}: ${nextLabel}`}
      title={`${currentLabel} → ${nextLabel}`}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full border border-border/70 bg-surface/80 text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95",
        className,
      )}
    >
      <CurrentIcon className="size-4.5 text-primary" aria-hidden />
    </button>
  );
}
