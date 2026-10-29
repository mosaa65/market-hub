import * as React from "react";
import { ArrowDown, ArrowUp, CornerDownLeft, Hash, Package, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { money, getCompanyCurrencySymbol } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { useCompanyCurrency } from "@/hooks/use-company-currency";
import type { SellableProduct } from "@/lib/sales-invoice";

/**
 * InvoiceProductFinder — إضافة بنود الفاتورة بالبحث، لا بشبكة منتجات.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا ليس شبكة بطاقات (كما في نقطة البيع)
 * ════════════════════════════════════════════
 * شاشة إنشاء الفاتورة شاشة مستند رسمي: المستخدم يعرف الصنف الذي يريده (بالاسم أو
 * الكود/الباركود) ويثبّت العين على مستند قائم ينمو، لا على رفّ بضاعة يتصفّحه.
 * الشبكة تحتاج تحريكًا بالعين والفأرة بين عشرات البطاقات، وهذا بالضبط ما نريد
 * تجنّبه. هنا: حقل واحد دائم في المقدمة، وأسفله **أقرب خمس نتائج فقط**، تتحرك
 * بينها الأسهم ↑/↓ وتُضاف بـ Enter — بدون فأرة أبدًا.
 *
 * الطريقة من نمط الـ combobox في ARIA: للحقل قيمة (النص) وعنصر نشط منفصل
 * (`aria-activedescendant`)، فلا تفقد مؤشر النص حين تحرّك التحديد.
 *
 * الثقة والمحرر: `attachFormNavigation` في الشاشة يلتقط Enter والأسهم على
 * مستوى النطاق كله، فيجب أن يترك هذا المكوّن مفاتيحه لنفسه — ولذلك نوقف
 * التعامل العام عبر `data-form-nav-skip` في الطبقة الملتقطة.
 */

export interface InvoiceProductFinderProps {
  products: SellableProduct[];
  isRtl: boolean;
  disabled?: boolean;
  /** يُستدعى عند اختيار صنف (Enter أو نقرة) */
  onPick: (product: SellableProduct, uomId?: string) => void;
  /** Tab من البحث: ينتقل إلى أول بند في المستند بدل الخروج من الشاشة. */
  onTabForward?: () => void;
  /** الحد الأقصى لعدد النتائج المعروضة */
  limit?: number;
  className?: string;
}

/** بحث بسيط في الاسم والكود والباركود — الأسرع للأرقام الكبيرة. */
function filterProducts(products: SellableProduct[], query: string, limit: number) {
  const q = query.trim().toLowerCase();
  if (!q) return products.slice(0, limit);
  return products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q) ||
        (p.sale_uoms ?? []).some((uom) =>
          uom.barcodes.some((code) => code.toLowerCase().includes(q)),
        ),
    )
    .slice(0, limit);
}

export function InvoiceProductFinder({
  products,
  isRtl,
  disabled,
  onPick,
  onTabForward,
  limit = 5,
  className,
}: InvoiceProductFinderProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  /** تُفتح النتائج عند الكتابة فقط — لا قائمة مفتوحة دائمة تشتّت المستخدم. */
  const [open, setOpen] = React.useState(false);
  const { currencySymbol } = useCompanyCurrency();

  const results = React.useMemo(
    () => filterProducts(products, query, limit),
    [products, query, limit],
  );

  // إبقاء التحديد داخل النطاق بعد كل تغيير في النتائج
  React.useEffect(() => {
    setActiveIndex((current) =>
      current >= results.length ? Math.max(0, results.length - 1) : current,
    );
  }, [results.length]);

  const optionId = (index: number) => `invoice-product-option-${index}`;

  function pick(product: SellableProduct) {
    const exactCode = query.trim().toLowerCase();
    const scannedUom = product.sale_uoms?.find((uom) =>
      uom.barcodes.some((code) => code.toLowerCase() === exactCode),
    );
    onPick(product, scannedUom?.unit_id);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
    // التركيز يعود للبحث فورًا: بند تلو الآخر بلا رفع اليد.
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // المفاتيح التي يملكها هذا المكوّن وحده. يُوقفها عن طبقة التنقل العامة.
    if (["Enter", "ArrowDown", "ArrowUp", "Escape"].includes(event.key)) {
      event.stopPropagation();
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else {
        setQuery("");
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = results[activeIndex] ?? results[0];
      if (target) pick(target);
      return;
    }

    // Tab: لا يخرج من النموذج — يكمل إلى البنود ثم إلى عمود القرار.
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      setOpen(false);
      if (onTabForward) onTabForward();
      else inputRef.current?.blur();
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex h-11 items-center gap-2.5 rounded-xl border bg-surface px-3.5 transition",
          open
            ? "border-primary/60 ring-4 ring-primary/10"
            : "border-border/80 hover:border-border",
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          disabled={disabled}
          dir={isRtl ? "rtl" : "ltr"}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          onBlur={() => {
            // تأخير بسيط حتى يصل حدث نقرة العنصر قبل إغلاق القائمة
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          data-form-nav-skip
          role="combobox"
          aria-expanded={open}
          aria-controls="invoice-product-results"
          aria-autocomplete="list"
          aria-activedescendant={open && results[activeIndex] ? optionId(activeIndex) : undefined}
          aria-label={isRtl ? "ابحث عن صنف لإضافته" : "Search for an item to add"}
          placeholder={
            isRtl
              ? "ابحث بالاسم أو الكود أو امسح الباركود ثم Enter…"
              : "Search by name, SKU or scan…"
          }
          className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {query && (
          <span className="hidden shrink-0 rounded-md border border-border/60 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            {toSystemDigits(results.length)} / {toSystemDigits(limit)}
          </span>
        )}
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
          <CornerDownLeft className="size-2.5" />
          {isRtl ? "إضافة" : "add"}
        </kbd>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-border/80 bg-popover/98 shadow-2xl backdrop-blur-xl">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
              <Package className="size-5 text-muted-foreground/50" />
              <p className="text-xs font-semibold text-foreground">
                {isRtl ? "لا يوجد صنف مطابق" : "No matching item"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {isRtl ? "جرّب اسمًا آخر أو كود الصنف." : "Try another name or the item code."}
              </p>
            </div>
          ) : (
            <ul
              ref={listRef}
              id="invoice-product-results"
              role="listbox"
              aria-label={isRtl ? "نتائج البحث" : "Search results"}
              className="max-h-[min(18rem,40dvh)] overflow-y-auto p-1.5 custom-scrollbar"
            >
              {results.map((product, index) => {
                const active = index === activeIndex;
                const outOfStock = product.on_hand <= 0;
                return (
                  <li
                    key={product.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={active}
                    // كل نتيجة Tab-stop: من لا يستعمل الفأرة يجب أن يستطيع
                    // الوصول إلى الجدول دون العودة إلى حقل البحث.
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        pick(product);
                      }
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(product)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                      active ? "bg-primary/10" : "hover:bg-surface-2/70",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg border",
                        active
                          ? "border-primary/30 bg-primary/15 text-primary"
                          : "border-border/60 bg-surface-2 text-muted-foreground",
                      )}
                    >
                      <Package className="size-3.5" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">
                        {product.name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        {(product.sku || product.barcode) && (
                          <span className="inline-flex items-center gap-0.5 font-mono">
                            <Hash className="size-2.5" />
                            {product.sku || product.barcode}
                          </span>
                        )}
                        <span
                          className={
                            outOfStock ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          {isRtl ? "متاح" : "On hand"}:{" "}
                          {toSystemDigits(
                            String(
                              product.on_hand /
                                Math.max(product.default_sales_factor || 1, 0.000000001),
                            ),
                          )}{" "}
                          {product.default_unit_label || product.base_unit_label || ""}
                        </span>
                      </span>
                    </span>

                    <span className="shrink-0 text-end">
                      <span className="block font-mono text-xs font-bold text-foreground">
                        {toSystemDigits(money(product.sale_price))}
                      </span>
                      <span className="block text-[9px] text-muted-foreground">
                        {getCompanyCurrencySymbol() || currencySymbol}
                      </span>
                    </span>

                    {active && (
                      <CornerDownLeft className="size-3.5 shrink-0 text-primary" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="size-2.5" />
              <ArrowDown className="size-2.5" />
              {isRtl ? "تنقّل" : "move"}
            </span>
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft className="size-2.5" />
              {isRtl ? "إضافة البند" : "add line"}
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border/70 bg-surface px-1">Esc</kbd>
              {isRtl ? "إغلاق" : "close"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
