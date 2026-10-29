import { useEffect, useRef, useState, useMemo } from "react";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/ui/search-input";
import { useI18n } from "@/lib/i18n";

/**
 * MobileProductPicker — the on-demand product browser for phones.
 *
 * The mobile POS workspace is cart-first: the catalogue is NOT mounted behind
 * the cart. This drawer is the only place products are shown on a phone, opened
 * by the cart's "+ إضافة منتج" action.
 *
 * It deliberately owns no search logic of its own: the parent passes the current
 * search string, its setter and the already-filtered rows, so barcode/SKU/name
 * matching stays in the single existing implementation.
 */
export interface PickerProduct {
  id: string;
  name: string;
  /** Secondary line: SKU / barcode. */
  meta?: string | null;
  /** Right-hand value: price for POS, cost for Purchase POS. */
  value: string;
  /** Right-hand sub-line: stock label. */
  sub?: string | null;
  disabled?: boolean;
}

export interface MobileProductPickerProps {
  open: boolean;
  onClose: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  products: PickerProduct[];
  onSelect: (id: string) => void;
  title: string;
  searchPlaceholder: string;
  emptyLabel: string;
  searchIcon?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  pageSize?: number;
}

export function MobileProductPicker({
  open,
  onClose,
  search,
  onSearchChange,
  products,
  onSelect,
  title,
  searchPlaceholder,
  emptyLabel,
  inputRef,
  pageSize = 60,
}: MobileProductPickerProps) {
  const { lang } = useI18n();
  const fallbackRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? fallbackRef;

  const [visibleLimit, setVisibleLimit] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const resultsScrollRef = useRef<HTMLDivElement | null>(null);

  // Reset pagination when search changes or when drawer opens
  useEffect(() => {
    setVisibleLimit(pageSize);
  }, [search, open, pageSize]);

  // Infinite scroll trigger
  useEffect(() => {
    if (!open) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleLimit((prev) => Math.min(prev + pageSize, products.length));
        }
      },
      { root: resultsScrollRef.current, rootMargin: "250px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, pageSize, products.length, visibleLimit]);

  const visibleProducts = useMemo(() => products.slice(0, visibleLimit), [products, visibleLimit]);

  useEffect(() => {
    if (open) {
      // Focus the search field as soon as the picker appears — the operator
      // opens it to type or scan, not to browse by scrolling.
      const id = window.setTimeout(() => ref.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [open, ref]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md animate-in fade-in duration-150">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          {products.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-mono font-medium text-primary">
              {visibleProducts.length < products.length
                ? `${visibleProducts.length} / ${products.length}`
                : products.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={lang === "ar" ? "إغلاق" : "Close"}
          className="grid h-9 w-9 place-items-center rounded-full border border-border/70 bg-surface text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-4 py-3">
        <SearchInput
          ref={ref}
          value={search}
          onValueChange={onSearchChange}
          placeholder={searchPlaceholder}
          clearLabel={lang === "ar" ? "مسح البحث" : "Clear search"}
          searchLabel={searchPlaceholder}
          size="lg"
          onKeyDown={(event) => {
            // A barcode scanner usually finishes with Enter. When search has
            // narrowed to one result, Enter is the fastest safe add action.
            if (event.key === "Enter" && products.length === 1 && !products[0].disabled) {
              event.preventDefault();
              onSelect(products[0].id);
            }
          }}
        />
      </div>

      {/* Results */}
      <div ref={resultsScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {products.length === 0 ? (
          <div className="grid place-items-center py-16 text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={p.disabled}
                onClick={() => onSelect(p.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface px-3 py-2.5 text-start transition hover:border-primary/50 hover:bg-surface-2 disabled:opacity-40",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                  {p.meta ? (
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {p.meta}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-end">
                  <div className="font-mono text-xs font-semibold text-foreground [unicode-bidi:isolate]">
                    {p.value}
                  </div>
                  {p.sub ? <div className="text-[10px] text-muted-foreground">{p.sub}</div> : null}
                </div>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Plus className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}

            {/* Infinite scroll sentinel */}
            {visibleProducts.length < products.length && (
              <div ref={sentinelRef} className="py-2 text-center text-xs text-muted-foreground">
                {lang === "ar" ? "جارٍ تحميل المزيد..." : "Loading more..."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
