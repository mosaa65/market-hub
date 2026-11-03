import * as React from "react";
import { Hash, Layers, Receipt, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";

/**
 * InvoiceStatusStrip — شريط مستند أفقي رقيق فوق لوحة البنود.
 *
 * لماذا شريط لا بطاقات: الأرقام الأربعة (البنود • المجموع • المدفوع • المتبقي)
 * يحتاجها المستخدم *أثناء* التمرير داخل الجدول الطويل. أربع بطاقات تتطلّب
 * مساحة رأسية لا تُستردّ، بينما صف واحد بارتفاع ~44px يُبقيها في العين دائمًا
 * ويسمح لبقية الشاشة أن تكون للبنود.
 *
 * كل خلية مستقلة بصريًا بفاصل شعري، لا بإطار — أي كثافة أعلى وضوضاء أقل
 * (مبدأ "كلوّن بالمعنى، لا بالحدود").
 */

export interface InvoiceStatusStripProps {
  isRtl: boolean;
  lineCount: number;
  quantity: number;
  subtotal: number;
  paid: number;
  remaining: number;
  currencySymbol: string;
  /** رقم آخر فاتورة صدرت في هذه الجلسة، للرجوع السريع. */
  lastInvoiceNumber?: string | null;
  onOpenLast?: () => void;
}

function Cell({
  icon,
  label,
  value,
  tone = "neutral",
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "primary" | "success" | "warning";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 px-3", className)}>
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-md",
          tone === "primary" && "bg-primary/10 text-primary",
          tone === "success" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          tone === "warning" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          tone === "neutral" && "bg-surface-2 text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <span className="block text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "block truncate font-mono text-sm font-black tabular-nums",
            tone === "primary" && "text-foreground",
            tone === "success" && "text-emerald-600 dark:text-emerald-400",
            tone === "warning" && "text-amber-600 dark:text-amber-400",
            tone === "neutral" && "text-foreground",
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

export function InvoiceStatusStrip({
  isRtl,
  lineCount,
  quantity,
  subtotal,
  paid,
  remaining,
  currencySymbol,
  lastInvoiceNumber,
  onOpenLast,
}: InvoiceStatusStripProps) {
  return (
    <div className="flex items-stretch overflow-x-auto rounded-xl border border-border/70 bg-card py-1.5 scrollbar-x-none">
      <Cell
        icon={<Layers className="size-3.5" />}
        label={isRtl ? "البنود" : "Lines"}
        value={`${toSystemDigits(lineCount)} · ${toSystemDigits(Math.round(quantity * 1000) / 1000)}`}
      />
      <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
      <Cell
        icon={<Receipt className="size-3.5" />}
        label={isRtl ? "المجموع" : "Subtotal"}
        value={`${toSystemDigits(money(subtotal))} ${currencySymbol}`}
        tone="primary"
      />
      <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
      <Cell
        icon={<Wallet className="size-3.5" />}
        label={isRtl ? "المدفوع" : "Paid"}
        value={`${toSystemDigits(money(paid))} ${currencySymbol}`}
        tone="success"
      />
      <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
      <Cell
        icon={<Hash className="size-3.5" />}
        label={isRtl ? "المتبقي" : "Due"}
        value={`${toSystemDigits(money(remaining))} ${currencySymbol}`}
        tone={remaining > 0 ? "warning" : "neutral"}
      />
      {lastInvoiceNumber && onOpenLast && (
        <>
          <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
          <button
            type="button"
            tabIndex={-1}
            onClick={onOpenLast}
            className="ms-auto flex shrink-0 items-center gap-1.5 px-3 text-[10px] font-semibold text-primary transition hover:opacity-80"
            title={isRtl ? "فتح آخر فاتورة" : "Open last invoice"}
          >
            <Receipt className="size-3" />
            {isRtl ? "آخر فاتورة" : "Last"}: #{toSystemDigits(lastInvoiceNumber)}
          </button>
        </>
      )}
    </div>
  );
}
