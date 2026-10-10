import { Trash2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuantityStepper } from "./quantity-stepper";
import { PriceField } from "./price-field";

export interface CartLineData {
  /** Unique cart-line key. In POS this is the product id (or `service-<uuid>`). */
  id: string;
  name: string;
  quantity: number;
  /** Unit price (sale price in POS, unit cost in Purchase POS). */
  unitPrice: number;
  /** Tax rate as a percentage, used for the line total display. */
  taxRate: number;
  /** Marks an ad-hoc / catalogue service line (violet treatment, no stock cap). */
  isService?: boolean;
  /** True when the operator overrode the product's default price. */
  priceModified?: boolean;
  /** Available stock, shown as the stepper ceiling for physical items. */
  stock?: number;
}

export interface CartLineLabels {
  /** e.g. "السعر" */
  price: string;
  /** e.g. "الكمية" */
  quantity: string;
  /** e.g. "حذف" */
  remove: string;
  /** e.g. "سعر معدّل" */
  priceModified?: string;
  /** e.g. "المخزون المتاح" */
  stockLabel?: string;
}

export interface CartLineProps {
  line: CartLineData;
  labels: CartLineLabels;
  /** Formats a subtotal/amount. */
  formatMoney: (n: number) => string;
  onQuantityCommit: (next: number | null) => void;
  onPriceChange: (next: number) => void;
  onRemove: () => void;
}

/**
 * CartLine — the shared cart row for POS and Purchase POS.
 *
 * Layout intent:
 *  - Desktop: a compact, dense row (name | qty | price | total | remove).
 *  - Narrow widths: the same DOM wraps into two comfortable rows rather than
 *    crushing the controls, via `flex-wrap` + a `min-w-0` name column.
 *
 * Every value that can grow (long product name, big quantity, long price) is
 * contained by `min-w-0` + `truncate`, so one long line can never stretch the
 * cart or push the remove button off screen.
 */
export function CartLine({
  line,
  labels,
  formatMoney,
  onQuantityCommit,
  onPriceChange,
  onRemove,
}: CartLineProps) {
  const lineTotal = line.unitPrice * line.quantity * (1 + (line.taxRate || 0) / 100);

  return (
    <div
      className={cn(
        "group relative rounded-xl border px-2.5 py-2 transition-colors",
        line.isService
          ? "border-violet-500/30 bg-violet-500/5 hover:border-violet-500/50"
          : "border-border/70 bg-surface-2/40 hover:border-primary/40 hover:bg-surface-2/70",
      )}
    >
      {/* A dedicated title row gives long Arabic names their own reading space,
          so they never compete with quantity, price or deletion controls. */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {line.isService ? <Wrench className="h-3 w-3 shrink-0 text-violet-500" /> : null}
            <span
              className="line-clamp-2 text-sm font-semibold leading-4 text-foreground"
              title={line.name}
            >
              {line.name}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            {line.taxRate > 0 ? (
              <span className="text-[9px] text-muted-foreground/70">(+{line.taxRate}%)</span>
            ) : null}
            {line.priceModified && labels.priceModified ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                {labels.priceModified}
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          title={labels.remove}
          aria-label={labels.remove}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground/60 transition hover:bg-destructive/10 hover:text-destructive active:scale-90"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* One calm control row: quantity, the only visible unit price, then total. */}
      <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-1.5 border-t border-border/50 pt-1.5">
        <div>
          <span className="mb-0.5 block text-[9px] font-medium text-muted-foreground">
            {labels.quantity}
          </span>
          <QuantityStepper
            value={line.quantity}
            onCommit={onQuantityCommit}
            max={line.stock}
            unbounded={line.isService}
            ariaLabel={labels.quantity}
          />
        </div>
        <div className="min-w-0" title={labels.price}>
          <span className="mb-0.5 block text-[9px] font-medium text-muted-foreground">
            {labels.price}
          </span>
          <PriceField
            value={line.unitPrice}
            onChange={onPriceChange}
            modified={line.priceModified}
            ariaLabel={labels.price}
            className="h-7 px-1.5 text-[11px]"
          />
        </div>
        <div className="min-w-[4.75rem] text-end">
          <span className="mb-0.5 block text-[9px] font-medium text-muted-foreground">
            الإجمالي
          </span>
          <div className="h-7 whitespace-nowrap rounded-lg bg-primary/8 px-1.5 py-1 font-mono text-[11px] font-extrabold tabular-nums text-primary [unicode-bidi:isolate]">
            {formatMoney(lineTotal)}
          </div>
        </div>
      </div>

      {line.stock != null && !line.isService && labels.stockLabel ? (
        <div className="mt-0.5 text-[9px] text-muted-foreground/70">
          {labels.stockLabel}: <span className="font-mono">{line.stock}</span>
        </div>
      ) : null}
    </div>
  );
}
