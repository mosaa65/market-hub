"use client";

/**
 * QuickAddButton — زر «إضافة» دائريّ بأيقونة فقط.
 *
 * كان في شاشات الأجر والعميل زرٌّ نصي «+ جديد» يأخذ عرضًا من صفّ العميل في
 * كل شاشة، فيضيق حقل العميل — وهو الحقل الذي يُكتب فيه فعلًا. ولأن الزرّ
 * يُستخدم مرّات قليلة في العملية، فإن عرضه الثابت تكلفة تُدفع في كل فتح.
 *
 * الشكل: دائرة 40px (مقاس لمس مريح) بأيقونة وحدها، و`aria-label` نصّي حتى
 * لا يبقى الزرّ بلا اسم لقارئ الشاشة أو مفتاح اختصار. واللقب (tooltip) يشرح
 * وظيفته لمن لا يعرف الأيقونة.
 *
 * 40px لا 36: معيار أدنى مساحة لمس في الجوال 44px للعناصر المتجاورة، و40
 * مقبولة لزرّ منفرد على حافة حقل ارتفاعه 40–44. أصغر من ذلك يصير الخطأ واردًا
 * على من يعمل بيد واحدة.
 */

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface QuickAddButtonProps {
  /** وصف كامل للوصولية — لا يعرض على الشاشة. */
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** لون للسياق: neutرal افتراضيًا، primary حين يكون الإجراء رئيسيًا. */
  tone?: "primary" | "amber" | "emerald" | "neutral";
  size?: "sm" | "md";
  className?: string;
}

const TONES: Record<NonNullable<QuickAddButtonProps["tone"]>, string> = {
  primary:
    "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/30",
  amber:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 focus-visible:ring-amber-500/30",
  emerald:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 focus-visible:ring-emerald-500/30",
  neutral:
    "border-border/70 bg-surface text-muted-foreground hover:border-primary/30 hover:text-primary focus-visible:ring-primary/30",
};

export function QuickAddButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  tone = "primary",
  size = "md",
  className,
}: QuickAddButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "active:scale-95 disabled:pointer-events-none disabled:opacity-40",
        size === "md" ? "size-10" : "size-8",
        TONES[tone],
        className,
      )}
    >
      <Icon className={size === "md" ? "size-4" : "size-3.5"} aria-hidden="true" />
    </button>
  );
}
