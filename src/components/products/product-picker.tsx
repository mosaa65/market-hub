"use client";

/**
 * ProductPicker — one searchable, coloured, keyboard-driven product selector.
 *
 * لماذا لم يبقَ `<select>`؟
 * ─────────────────────────
 * شاشات الاستلام والطحن والتسليم كانت تعرض كل الأصناف في قائمة منسدلة أصلية.
 * مع عشرين صنفًا هذا مقبول؛ مع مئة لا يمكن العثور على شيء: لا بحث، ولا وزن
 * عبوة ظاهر، ولا تمييز بين حبوب ومنتج نهائي وناتج ثانوي، ولا سياق للرصيد.
 *
 * بنية هذا المكوّن مأخوذة من دليل العملاء في شاشة التحصيل — نفس الحسّ البصري:
 *   • متجر بحث ثابت أعلى القائمة، لا يتحرك مع التمرير.
 *   • كل صنف صفٌّ كامل يعرض: أيقونة العائلة بلونها، الاسم، الكود، وسعة العبوة.
 *   • تجميع بالتصنيف بعنوان صغير لكل مجموعة.
 *   • عدّاد «متبقي» يظهر فقط حين يمرّر المستدعي رصيداً (`balanceKg`).
 *   • لوحة مفاتيح كاملة: ↑/↓، Enter، Esc، وكتابة للبحث المباشر.
 *
 * قواعد ثابتة:
 *   1. هذا المكوّن لا يقرأ قاعدة البيانات. يستقبل `items` جاهزة من الشاشة.
 *      ولهذا يخدم الأمانات والمنتجات التجارية وأي قائمة أخرى.
 *   2. لا يخترع خيارًا غير موجود: القيمة غير المعروفة تُعرض كـ«غير محدد».
 *   3. الألوان مشتقة من `item_class` لا من اسم الصنف.
 */

import * as React from "react";
import { Check, ChevronDown, Package, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { toSystemDigits } from "@/lib/format-preferences";
import { productClassTone, type ProductClassTone } from "@/components/products/product-class-meta";
import { AnchoredPanel } from "@/components/ui/anchored-panel";

/* ------------------------------------------------------------------ types */

/** الشكل الأدنى الذي يتقبّله المنتقي — كل حقول أخرى اختيارية. */
export interface ProductPickerItem {
  id: string;
  /**
   * الاسم الذي يُعرض. اختياري عن قصد: قوائم الأمانات تجلب `name_ar` من
   * استعلام آخر، وقد تكون سليمة الشكل بأسماء مختلفة. `productLabel()` أدناه
   * تعرف كيف تقرأ كل شكل. لكن المكوّن لا يستطيع التحقق من ذلك وقت الترجمة،
   * فيُطلب `nameAr` صراحةً في كل موضع يستخدمه.
   */
  nameAr: string;
  name?: string | null;
  sku?: string | null;
  /** `RAW_MATERIAL` | `FINISHED_GOOD` | `BY_PRODUCT` | أي تصنيف آخر. */
  item_class?: string | null;
  /** سعة العبوة بالكجم — تُعرض كسطر ثانوي وتُستخدم لمضاعفة الأكياس. */
  package_weight_kg?: number | null;
  /** الرصيد المتاح بالكجم، إن كان للصنف رصيد. */
  balanceKg?: number | null;
  /** الرصيد بالأكياس، يُعرض بجانب الكجم حين يكون متاحًا. */
  balanceBags?: number | null;
  /** سعر/تكلفة اختيارية للعرض في سياق الفاتورة. */
  price?: number | null;
  /** تعطيل اختيار صنف (مثلاً رصيده صفر). */
  disabled?: boolean;
}

export interface ProductPickerProps<T extends ProductPickerItem = ProductPickerItem> {
  value: string | null | undefined;
  onChange: (item: T) => void;
  items: readonly T[];
  /** فلتر تصنيفات مسموحة في هذه الشاشة (حبوب فقط، نواتج فقط…). */
  classes?: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** يُعرض داخل الزر كما هو (مثل «كيس / كجم») — لا يغيّر الوظيفة. */
  hint?: string;
  /** عرض الرصيد في الصفوف. يُشغَّل تلقائيًا إن وُجد `balanceKg` في أي عنصر. */
  showBalance?: boolean;
  className?: string;
  ariaLabel?: string;
  id?: string;
}

/* ------------------------------------------------------------- appearance */

/**
 * الألوان تأتي من `product-class-meta` مباشرة.
 *
 * كان هنا `const toneOf = productClassTone` — مُستعار واحد على مستوى الوحدة.
 * وكسر هذا النمط الوحيد أثناء تطوير ساخن ظهر كـ
 *
 *     ReferenceError: productClassTone is not defined
 *
 * لأن الوحدة المعاد بناؤها استُدعت قبل أن ينهي Vite تقييم الاستيراد. الاسم
 * المستعار لا يضيف شيئًا: الحذف يلغي الطبقة التي قد يبقى فيها اسم فارغ.
 */

/** «بر بلدي — 50 كجم» وليس رقماً عارياً بلا وحدة. */
function productSecondaryLabel(item: ProductPickerItem): string {
  const parts: string[] = [];
  if (item.sku) parts.push(item.sku);
  if (item.package_weight_kg && item.package_weight_kg > 0) {
    parts.push(`${toSystemDigits(item.package_weight_kg)} كجم / عبوة`);
  }
  return parts.join(" · ");
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u0652]/g, "")
    .trim();
}

/* ------------------------------------------------------------- component */

export function ProductPicker<T extends ProductPickerItem = ProductPickerItem>({
  value,
  onChange,
  items,
  classes,
  placeholder = "اختر الصنف…",
  disabled = false,
  loading = false,
  hint,
  showBalance,
  className,
  ariaLabel = "اختيار الصنف",
  id,
}: ProductPickerProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const visible = React.useMemo(
    () =>
      classes?.length ? items.filter((i) => i.item_class && classes.includes(i.item_class)) : items,
    [items, classes],
  );

  const selected = React.useMemo(
    () => visible.find((i) => i.id === value) ?? null,
    [visible, value],
  );

  const withBalance = showBalance ?? visible.some((i) => i.balanceKg != null);

  /** بحث + تجميع بالتصنيف في تمريرة واحدة. */
  const groups = React.useMemo(() => {
    const q = normalize(query);
    const matches = q
      ? visible.filter((item) =>
          normalize(
            [
              item.nameAr,
              item.name ?? "",
              item.sku ?? "",
              productClassTone(item.item_class).label,
            ].join(" "),
          ).includes(q),
        )
      : visible;

    const byClass = new Map<string, T[]>();
    for (const item of matches) {
      const key = item.item_class ?? "";
      const list = byClass.get(key);
      if (list) list.push(item);
      else byClass.set(key, [item]);
    }
    // الترتيب يتبع ترتيب `classes` إن مُرّر، ثم بقية التصنيفات.
    const order = (classes?.length ? [...classes] : []) as string[];
    for (const key of byClass.keys()) if (!order.includes(key)) order.push(key);

    const result: { key: string; tone: ProductClassTone; items: T[] }[] = [];
    for (const key of order) {
      const list = byClass.get(key);
      if (list && list.length > 0) result.push({ key, tone: productClassTone(key), items: list });
    }
    return result;
  }, [visible, query, classes]);

  /** القائمة المسطّحة — للتنقل بالمفاتيح عبر مجموعات. */
  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  React.useEffect(() => {
    if (!open) return;
    const index = flat.findIndex((item) => item.id === value);
    setActiveIndex(index >= 0 ? index : 0);
    setQuery("");
    // التركيز بعد الرسم حتى لا يسرق النقرُ الأول الفتح.
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (activeIndex > flat.length - 1) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);

  /** يُبقي الصف النشط مرئيًا أثناء التنقل بالمفاتيح. */
  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const choose = React.useCallback(
    (item: T) => {
      if (item.disabled) return;
      onChange(item);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled || loading) return;
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = flat[activeIndex];
      if (target) choose(target);
    }
  }

  const SelectedTone = selected ? productClassTone(selected.item_class) : null;
  const SelectedIcon = SelectedTone?.icon;

  /*
   * اتجاه فتح القائمة — نفس منطق منتقي الدفع.
   *
   * أسطر الأصناف تُضاف في أسفل الشاشات المزدحمة (الاستلام، التسليم، نقاط
   * البيع)، فالقائمة التي تُفتح للأسفل تُدفن تحت الفوتر. القياس الفعلي
   * والقلب للأعلى يقوم به `AnchoredPanel` الآن — بعد أن كانت القائمة
   * `absolute` داخل النموذج فتُقصّ عند حاوية `MillingPanel` ذات
   * `overflow-hidden` ويختفي نصّها. لا حاجة لقياس محلي هنا.
   */
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  return (
    <div className={cn("relative min-w-0", className)}>
      {/* ── الحقل الظاهر ── */}
      <button
        id={id}
        ref={triggerRef}
        type="button"
        data-form-nav
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "group flex h-11 w-full items-center gap-2.5 rounded-xl border bg-surface px-2.5 text-start transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          open
            ? "border-primary/60 ring-2 ring-primary/15"
            : "border-border/80 hover:border-border",
          (disabled || loading) && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            SelectedTone?.iconClass ?? "bg-muted/60 text-muted-foreground",
          )}
        >
          {SelectedIcon ? <SelectedIcon className="size-4" /> : <Package className="size-4" />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-foreground">
            {loading ? "جارٍ التحميل…" : (selected?.nameAr ?? placeholder)}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {loading
              ? " "
              : selected
                ? [SelectedTone?.label, productSecondaryLabel(selected)].filter(Boolean).join(" · ")
                : (hint ?? `${visible.length} صنف متاح`)}
          </span>
        </span>

        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* ── القائمة: لوحة عائمة على `document.body`، لا تُقصّ ولا تختفي ── */}
      <AnchoredPanel
        anchorRef={triggerRef}
        open={open}
        onDismiss={() => setOpen(false)}
        preferredHeight={320}
        minHeight={180}
        minWidth={280}
        className="overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl"
      >
        <div className="flex h-full max-h-[inherit] flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onListKeyDown}
              placeholder="ابحث بالاسم أو الكود…"
              className="h-6 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {flat.length}
            </span>
          </div>

          <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            onKeyDown={onListKeyDown}
            className="min-h-0 flex-1 overflow-y-auto p-1 custom-scrollbar"
          >
            {flat.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                لا يوجد صنف مطابق
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.key || "unclassified"} className="mb-1 last:mb-0">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                    {group.tone.label}
                  </div>
                  {group.items.map((item) => {
                    const globalIndex = flat.indexOf(item);
                    const isActive = globalIndex === activeIndex;
                    const isSelected = item.id === value;
                    const tone = productClassTone(item.item_class);
                    const Icon = tone.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        data-index={globalIndex}
                        aria-selected={isSelected}
                        disabled={item.disabled}
                        onMouseEnter={() => setActiveIndex(globalIndex)}
                        onMouseDown={(event) => {
                          // القائمة في Portal خارج زر الاختيار؛ امنع مستمعات
                          // النقر الخارجي من إغلاقها قبل وصول حدث الاختيار.
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={() => choose(item)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-start transition-colors",
                          isActive && tone.activeClass,
                          !isActive && "hover:bg-muted/50",
                          item.disabled && "cursor-not-allowed opacity-45",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-7 shrink-0 place-items-center rounded-lg",
                            tone.iconClass,
                          )}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-foreground">
                            {item.nameAr}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {productSecondaryLabel(item) || "—"}
                          </span>
                        </span>
                        {withBalance && (
                          <span className="shrink-0 rounded-md bg-muted/60 px-1.5 py-0.5 text-end font-mono text-[10px] tabular-nums text-muted-foreground">
                            {toSystemDigits(Math.round(item.balanceKg ?? 0))} كجم
                            {item.balanceBags != null ? (
                              <span className="ms-1 opacity-70">
                                / {toSystemDigits(Math.round(item.balanceBags))} كيس
                              </span>
                            ) : null}
                          </span>
                        )}
                        {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </AnchoredPanel>
    </div>
  );
}
