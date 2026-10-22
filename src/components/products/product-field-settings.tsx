import { Check, RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  PRODUCT_FIELDS,
  type ProductFieldKey,
  type ProductFieldSurface,
} from "@/lib/product-field-visibility";

interface ProductFieldSettingsProps {
  isVisible: (surface: ProductFieldSurface, key: ProductFieldKey) => boolean;
  toggle: (surface: ProductFieldSurface, key: ProductFieldKey) => void;
  reset: () => void;
  isRtl: boolean;
}

const SURFACES: { id: ProductFieldSurface; ar: string; en: string }[] = [
  { id: "view", ar: "شاشة المنتجات", en: "Products screen" },
  { id: "detail", ar: "لوحة التفاصيل", en: "Detail panel" },
  { id: "form", ar: "فورم الإضافة والتعديل", en: "Add / edit form" },
];

/**
 * إعدادات إظهار الحقول. كل سطح مستقل عمداً: إخفاء الباركود من البطاقة
 * لا يعني أنك لا تريد إدخاله عند إنشاء صنف جديد.
 */
export function ProductFieldSettings({
  isVisible,
  toggle,
  reset,
  isRtl,
}: ProductFieldSettingsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">
            {isRtl ? "الحقول المعروضة" : "Visible fields"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[290px] p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <span className="text-xs font-bold">{isRtl ? "الحقول المعروضة" : "Visible fields"}</span>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition hover:text-primary"
          >
            <RotateCcw className="h-3 w-3" />
            {isRtl ? "استعادة الافتراضي" : "Reset"}
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto scrollbar-y-none p-1.5">
          {SURFACES.map((surface) => (
            <div key={surface.id} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {isRtl ? surface.ar : surface.en}
              </div>
              <div className="space-y-0.5">
                {PRODUCT_FIELDS.map((field) => {
                  const visible = isVisible(surface.id, field.key);
                  return (
                    <button
                      key={`${surface.id}-${field.key}`}
                      type="button"
                      disabled={field.locked}
                      onClick={() => toggle(surface.id, field.key)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded border border-border">
                        {visible && <Check className="h-3 w-3 text-primary" />}
                      </span>
                      <span className="min-w-0 truncate">
                        {isRtl ? field.labelAr : field.labelEn}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
