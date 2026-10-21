import { Trash2, Wrench, Sparkles } from "lucide-react";
import { QuantityStepper } from "./quantity-stepper";
import { PriceField } from "./price-field";
import { cn } from "@/lib/utils";

export interface CartLineData {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  isService?: boolean;
  unboundedQuantity?: boolean;
  priceModified?: boolean;
  stock?: number;
  barcode?: string;
  unit?: string;
}

export interface CartLineLabels {
  price: string;
  quantity: string;
  remove: string;
  priceModified?: string;
  stockLabel?: string;
}

export interface CartLineProps {
  line: CartLineData;
  labels: CartLineLabels;
  formatMoney: (n: number) => string;
  onQuantityCommit: (next: number | null) => void;
  onPriceChange: (next: number) => void;
  onRemove: () => void;
}

export function CartLine({
  line,
  labels,
  formatMoney,
  onQuantityCommit,
  onPriceChange,
  onRemove,
}: CartLineProps) {
  const lineTotal = line.quantity * line.unitPrice;

  return (
    <div className="group relative grid grid-cols-[minmax(0,1fr)_auto_auto_1.75rem] items-center gap-1 rounded-md border-b border-border/60 bg-transparent px-1.5 py-1 transition-colors hover:bg-primary/[0.035] sm:gap-1.5 sm:px-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {line.isService ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
            title="خدمة / تركيب"
          >
            <Wrench className="h-2.5 w-2.5" />
            خدمة
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          <span
            className="block truncate text-[11px] font-semibold leading-4 text-foreground/90 transition-colors group-hover:text-foreground sm:text-xs"
            title={line.name}
          >
            {line.name}
          </span>
          {line.stock != null && !line.isService ? (
            <span className="block truncate text-[10px] leading-3 text-muted-foreground">
              {labels.stockLabel || "المتوفر"}: {line.stock}
              {line.unit ? ` · ${line.unit}` : ""}
            </span>
          ) : null}
        </div>

        {line.priceModified ? (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.2 text-[9px] font-medium text-primary"
            title={labels.priceModified || "سعر معدّل"}
          >
            <Sparkles className="h-2 w-2" />
            معدّل
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <QuantityStepper
          value={line.quantity}
          onCommit={onQuantityCommit}
          max={line.stock}
          unbounded={line.isService || line.unboundedQuantity}
          ariaLabel={labels.quantity}
        />
        <span className="text-[10px] text-muted-foreground">×</span>
        <PriceField
          value={line.unitPrice}
          onChange={onPriceChange}
          modified={line.priceModified}
          ariaLabel={labels.price}
          className="h-7 w-[3.5rem] px-1 text-[11px]"
        />
      </div>

      <span className="min-w-[3.25rem] text-end font-mono text-[11px] font-bold tabular-nums text-primary [unicode-bidi:isolate] sm:min-w-[4rem] sm:text-xs">
        {formatMoney(lineTotal)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={labels.remove}
        title={labels.remove}
        className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground/60 transition hover:bg-destructive/15 hover:text-destructive active:scale-90"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
