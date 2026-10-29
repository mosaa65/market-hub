import * as React from "react";
import { GripVertical, Package, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { QuantityInput } from "@/components/ui/quantity-input";
import { AmountInput } from "@/components/ui/amount-input";
import type { PosCartLine } from "@/components/sales/invoice-pos-types";

/**
 * InvoiceLinesGrid — جدول بنود المستند، لا بطاقات.
 *
 * الجدول هو الشكل الصحيح لمستند: الأعمدة ثابتة (البيان • الكمية • السعر •
 * الإجمالي)، فالعين تقارن بندًا ببند عموديًا، وتسلسل الأسطر يعكس ترتيب الطباعة.
 *
 * ════════════════════════════════════════════
 * المفاتيح (تُدار هنا لأنها داخل نطاق التنقل العام، فتمنعه من سحبها)
 * ════════════════════════════════════════════
 *   ↑ / ↓            التنقل بين البنود (الصف النشط)
 *   Enter            حفظ القيمة والانتقال للخلية التالية (الكمية ← السعر ← بند جديد)
 *   Shift+Enter      الرجوع للخلية السابقة
 *   Alt+↑ / Alt+↓    تحريك البند أعلى/أسفل في المستند
 *   Delete (فارغ)    حذف الصف النشط
 *
 * لا يفقد المستخدم التركيز أبدًا: Enter على السعر يفتح بندًا جديدًا ويضع المؤشر
 * في الكمية، لأن الإدخال المتسلسل هو الحالة الغالبة في الفاتورة.
 */

export interface InvoiceLinesGridProps {
  lines: PosCartLine[];
  isRtl: boolean;
  currencySymbol: string;
  onUpdate: (index: number, patch: Partial<PosCartLine>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onAppend: () => void;
  /** يُركّز البحث لإضافة بند أوّل عندما يكون المستند فارغًا. */
  onRequestAdd?: () => void;
}

interface CellHandle {
  row: number;
  field: "qty" | "price";
  el: HTMLInputElement | null;
}

export function InvoiceLinesGrid({
  lines,
  isRtl,
  currencySymbol,
  onUpdate,
  onRemove,
  onMove,
  onAppend,
  onRequestAdd,
}: InvoiceLinesGridProps) {
  const cellRefs = React.useRef<Map<string, CellHandle>>(new Map());
  const [activeRow, setActiveRow] = React.useState<number | null>(null);

  const register = (row: number, field: "qty" | "price") => (el: HTMLInputElement | null) => {
    const key = `${row}:${field}`;
    if (el) cellRefs.current.set(key, { row, field, el });
    else cellRefs.current.delete(key);
  };

  function focusCell(row: number, field: "qty" | "price") {
    const handle = cellRefs.current.get(`${row}:${field}`);
    if (!handle?.el) return;
    handle.el.focus();
    try {
      handle.el.select();
    } catch {
      /* بعض عناصر الإدخال لا تدعم التحديد */
    }
    setActiveRow(row);
  }

  /** Enter داخل خلية: التالي منطقيًا (كمية ← سعر ← بند جديد/بحث). */
  function handleAdvance(row: number, field: "qty" | "price", backwards: boolean) {
    if (!backwards) {
      if (field === "qty") return focusCell(row, "price");
      if (row + 1 < lines.length) return focusCell(row + 1, "qty");
      if (row + 1 === lines.length) {
        // نهاية المستند: البند التالي يُضاف من البحث، فلا نضيف سطرًا فارغًا.
        onRequestAdd?.();
        return;
      }
    } else {
      if (field === "price") return focusCell(row, "qty");
      if (row - 1 >= 0) return focusCell(row - 1, "price");
    }
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    row: number,
    field: "qty" | "price",
  ) {
    const { key, altKey, shiftKey } = event;

    if (key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      handleAdvance(row, field, shiftKey);
      return;
    }

    if (altKey && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      event.stopPropagation();
      const direction = key === "ArrowUp" ? -1 : 1;
      const next = row + direction;
      if (next < 0 || next >= lines.length) return;
      onMove(row, direction);
      // التركيز يتبع الصف بعد إعادة الترتيب
      requestAnimationFrame(() => focusCell(next, field));
      return;
    }

    if ((key === "ArrowDown" || key === "ArrowUp") && !altKey) {
      // داخل خلية رقمية: الأسهم عموديًا تُحرّر القيمة في المتصفح للأرقام فقط،
      // وعندنا الإدخال نصي، فالأسهم هنا تنقل بين البنود — أوضح للمستند ذي
      // الأعمدة ويمنع "القفز العشوائي".
      event.preventDefault();
      event.stopPropagation();
      const next = key === "ArrowDown" ? row + 1 : row - 1;
      if (next >= 0 && next < lines.length) focusCell(next, field);
      return;
    }

    if (key === "Backspace" || key === "Delete") {
      const empty = (event.currentTarget.value ?? "").trim() === "";
      if (empty && lines.length > 0 && !event.currentTarget.selectionStart) {
        event.preventDefault();
        event.stopPropagation();
        onRemove(row);
        const fallback = row > 0 ? row - 1 : 0;
        requestAnimationFrame(() => {
          if (lines.length > 1) focusCell(Math.min(fallback, lines.length - 2), field);
          else onRequestAdd?.();
        });
      }
    }
  }

  const totals = React.useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const qty = Number(line.quantity) || 0;
        const price = Number(line.unitPrice) || 0;
        return {
          qty: acc.qty + qty,
          amount: acc.amount + qty * price,
        };
      },
      { qty: 0, amount: 0 },
    );
  }, [lines]);

  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-surface/40">
        <button
          type="button"
          onClick={onRequestAdd}
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl px-4 py-10 text-center transition hover:bg-surface/70"
        >
          <span className="grid size-11 place-items-center rounded-2xl border border-border/70 bg-surface text-muted-foreground">
            <Package className="size-5" />
          </span>
          <span className="text-sm font-semibold text-foreground">
            {isRtl ? "لا توجد بنود بعد" : "No lines yet"}
          </span>
          <span className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
            {isRtl
              ? "ابدأ الكتابة في حقل البحث أعلاه — الأسهم ↑/↓ للتنقل، و Enter لإضافة البند."
              : "Start typing in the search field above — ↑/↓ to move, Enter to add."}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/70 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-8 px-2 py-2.5 text-center font-semibold">#</th>
              <th className="px-3 py-2.5 text-start font-semibold">
                {isRtl ? "البيان" : "Description"}
              </th>
              <th className="w-[92px] px-2 py-2.5 text-center font-semibold">
                {isRtl ? "الكمية" : "Qty"}
              </th>
              <th className="w-[120px] px-2 py-2.5 text-center font-semibold">
                {isRtl ? "السعر" : "Price"}
              </th>
              <th className="w-[120px] px-3 py-2.5 text-end font-semibold">
                {isRtl ? "الإجمالي" : "Amount"}
              </th>
              <th className="w-9 px-1" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const lineAmount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
              const active = activeRow === index;
              return (
                <tr
                  key={line.key ?? `${line.product.id}-${index}`}
                  onFocusCapture={() => setActiveRow(index)}
                  className={cn(
                    "group border-b border-border/40 transition-colors last:border-0",
                    active ? "bg-primary/[0.045]" : "hover:bg-muted/25",
                  )}
                >
                  <td className="px-2 py-1.5 text-center align-middle">
                    <span className="inline-flex items-center gap-0.5">
                      <span className="w-4 text-center font-mono text-[11px] text-muted-foreground">
                        {toSystemDigits(index + 1)}
                      </span>
                      <span className="text-muted-foreground/25 group-hover:text-muted-foreground/60">
                        <GripVertical className="size-3" aria-hidden />
                      </span>
                    </span>
                  </td>

                  <td className="px-3 py-1.5 align-middle">
                    <span className="block max-w-[34ch] truncate text-[13px] font-semibold text-foreground">
                      {line.product.name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      {(line.product.sku || line.product.barcode) && (
                        <span className="font-mono">
                          {line.product.sku || line.product.barcode}
                        </span>
                      )}
                      {line.spec && (
                        <span className="rounded border border-primary/20 bg-primary/[0.07] px-1 text-[9px] font-semibold text-primary">
                          {isRtl ? "مواصفات" : "Spec"}
                        </span>
                      )}
                      {Number(line.quantity) > Number(line.product.on_hand) && (
                        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                          {isRtl
                            ? `يتجاوز المتاح ${toSystemDigits(String(line.product.on_hand))}`
                            : `over stock ${toSystemDigits(String(line.product.on_hand))}`}
                        </span>
                      )}
                    </span>
                  </td>

                  <td className="px-2 py-1.5 align-middle">
                    <QuantityInput
                      ref={register(index, "qty")}
                      decimals={3}
                      min={0}
                      value={line.quantity === "" ? null : Number(line.quantity)}
                      onValueChange={(v) =>
                        onUpdate(index, { quantity: v == null ? "" : String(v) })
                      }
                      onFocus={(e) => {
                        setActiveRow(index);
                        e.currentTarget.select();
                      }}
                      onKeyDown={(e) => handleKeyDown(e, index, "qty")}
                      className="h-8 rounded-lg border-border/70 bg-surface text-center [direction:ltr]"
                      containerClassName="[&_input]:h-8"
                      aria-label={
                        isRtl ? `كمية البند ${index + 1}` : `Quantity of line ${index + 1}`
                      }
                    />
                  </td>

                  <td className="px-2 py-1.5 align-middle">
                    <AmountInput
                      ref={register(index, "price")}
                      min={0}
                      showInWords={false}
                      value={line.unitPrice === "" ? null : Number(line.unitPrice)}
                      onValueChange={(v) =>
                        onUpdate(index, { unitPrice: v == null ? "" : String(v) })
                      }
                      onFocus={(e) => {
                        setActiveRow(index);
                        e.currentTarget.select();
                      }}
                      onKeyDown={(e) => handleKeyDown(e, index, "price")}
                      className="h-8 rounded-lg border-border/70 bg-surface text-end"
                      containerClassName="[&_input]:h-8"
                      aria-label={isRtl ? `سعر البند ${index + 1}` : `Price of line ${index + 1}`}
                    />
                  </td>

                  <td className="px-3 py-1.5 align-middle text-end">
                    <span className="font-mono text-[13px] font-bold tabular-nums text-foreground">
                      {toSystemDigits(money(lineAmount))}
                    </span>
                  </td>

                  <td className="px-1 py-1.5 align-middle">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onRemove(index)}
                      title={isRtl ? "حذف البند" : "Remove line"}
                      aria-label={isRtl ? `حذف البند ${index + 1}` : `Remove line ${index + 1}`}
                      className="grid size-7 place-items-center rounded-lg text-muted-foreground/60 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-500 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border/70 bg-muted/30 text-xs">
              <td />
              <td className="px-3 py-2 font-semibold text-muted-foreground">
                {isRtl
                  ? `إجمالي ${toSystemDigits(lines.length)} بند`
                  : `${toSystemDigits(lines.length)} line(s)`}
              </td>
              <td className="px-2 py-2 text-center font-mono font-semibold text-foreground">
                {toSystemDigits(String(Math.round(totals.qty * 1000) / 1000))}
              </td>
              <td />
              <td className="px-3 py-2 text-end font-mono text-sm font-black text-foreground">
                {toSystemDigits(money(totals.amount))}
                <span className="ms-1 text-[9px] font-normal text-muted-foreground">
                  {currencySymbol}
                </span>
              </td>
              <td>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={onAppend}
                  title={isRtl ? "بند جديد (F2)" : "New line (F2)"}
                  aria-label={isRtl ? "بند جديد" : "New line"}
                  className="grid size-7 place-items-center rounded-lg text-primary transition hover:bg-primary/10"
                >
                  +
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
