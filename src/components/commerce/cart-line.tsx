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
  unitId?: string | null;
  unitOptions?: { id: string; label: string }[];
  quantityStep?: number;
  priceEditable?: boolean;
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
  onUnitChange?: (unitId: string) => void;
  onRemove: () => void;
}

export function CartLine({
  line,
  labels,
  formatMoney,
  onQuantityCommit,
  onPriceChange,
  onUnitChange,
  onRemove,
}: CartLineProps) {
  const lineTotal = line.quantity * line.unitPrice;

  return (
    <div className="group relative flex flex-col justify-between gap-1 rounded-xl border border-border/80 bg-card p-2 text-card-foreground shadow-2xs transition-all duration-150 hover:border-primary/40 hover:bg-card/90">
      {/* سطر 1: اسم الصنف والبادجات مع إجمالي السطر المدمج في الحافة وزر الحذف الملون */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {line.isService ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400"
              title="خدمة / تركيب"
            >
              <Wrench className="h-2.5 w-2.5" />
              خدمة
            </span>
          ) : null}

          <span
            className="truncate text-xs font-bold leading-tight text-foreground transition-colors group-hover:text-primary"
            title={line.name}
          >
            {line.name}
          </span>

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

        {/* الجانب الأيسر: الإجمالي محفور بين الحواف وبجانبه زر الحذف الملون */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* الإجمالي بشكل بارز وأنيق في تصميم مدمج */}
          <span className="inline-flex items-center rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-extrabold tabular-nums text-primary [unicode-bidi:isolate] shadow-2xs">
            {formatMoney(lineTotal)}
          </span>

          {/* زر الحذف الأنيق والملون */}
          <button
            type="button"
            onClick={onRemove}
            aria-label={labels.remove}
            title={labels.remove}
            className="grid size-6 shrink-0 place-items-center rounded-full border border-destructive/25 bg-destructive/10 text-destructive transition-all hover:border-destructive/40 hover:bg-destructive hover:text-destructive-foreground active:scale-90"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* سطر 2: متحكمات الكمية والسعر والوحدة والمخزون في شريط أفقي مدمج ومريح */}
      <div className="flex items-center justify-between gap-1.5 border-t border-border/50 pt-1 text-[11px]">
        {/* معلومات الوحدة والمخزون المتوفر */}
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {line.unitOptions && line.unitOptions.length > 1 && onUnitChange ? (
            <select
              aria-label={line.unit || "Unit"}
              value={line.unitId ?? ""}
              onChange={(event) => onUnitChange(event.target.value)}
              className="h-6 max-w-[85px] truncate rounded-md border border-border/70 bg-card px-1 text-[10px] font-medium text-foreground outline-none transition focus:border-primary"
            >
              {line.unitOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : line.unit ? (
            <span className="inline-flex items-center rounded bg-muted/60 px-1 py-0.2 text-[10px] font-semibold text-muted-foreground">
              {line.unit}
            </span>
          ) : null}

          {line.stock != null && !line.isService ? (
            <span className="truncate text-[10px] font-medium text-muted-foreground/80">
              {labels.stockLabel || "المتوفر"}:{" "}
              <span className="font-mono font-semibold text-foreground/80">{line.stock}</span>
            </span>
          ) : null}
        </div>

        {/* إدخال الكمية والسعر */}
        <div className="flex shrink-0 items-center gap-1">
          <QuantityStepper
            value={line.quantity}
            onCommit={onQuantityCommit}
            max={line.stock}
            min={1}
            step={Math.max(1, Math.round(line.quantityStep ?? 1))}
            unbounded={line.isService || line.unboundedQuantity}
            ariaLabel={labels.quantity}
          />
          <span className="text-[10px] font-bold text-muted-foreground/60">×</span>
          {line.priceEditable === false ? (
            <span className="min-w-[3.5rem] rounded-md border border-border/60 bg-muted/40 px-1.5 py-1 text-center font-mono text-[11px] font-semibold tabular-nums text-foreground [unicode-bidi:isolate]">
              {formatMoney(line.unitPrice)}
            </span>
          ) : (
            <PriceField
              value={line.unitPrice}
              onChange={onPriceChange}
              modified={line.priceModified}
              ariaLabel={labels.price}
              className="h-6.5 w-[3.75rem] px-1 text-[11px]"
            />
          )}
        </div>
      </div>
    </div>
  );
}
