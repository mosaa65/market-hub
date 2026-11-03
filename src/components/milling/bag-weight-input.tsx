import React, { useState, useEffect } from "react";
import { Package, Scale, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mono, fmtNum } from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";
import { AmountInput } from "@/components/ui/amount-input";

export interface BagWeightValue {
  bags: number;
  capacityKg: number;
  totalKg: number;
  mode: "bags" | "kg";
}

export interface BagWeightInputProps {
  label?: string;
  mode?: "bags" | "kg";
  bags?: number | string;
  capacityKg?: number | string;
  totalKg?: number | string;
  defaultCapacity?: number;
  unitPriceBag?: number;
  unitPriceKg?: number;
  showPricing?: boolean;
  currencySymbol?: string;
  allowCustomCapacity?: boolean;
  className?: string;
  disabled?: boolean;
  onChange: (val: BagWeightValue) => void;
  onPriceChange?: (val: { unitPriceBag: number; unitPriceKg: number }) => void;
}

export const STANDARD_BAG_CAPACITIES = [50, 25, 10, 5];

export function BagWeightInput({
  label,
  mode: initialMode = "bags",
  bags: controlledBags,
  capacityKg: controlledCapacity,
  totalKg: controlledTotalKg,
  defaultCapacity = 50,
  unitPriceBag,
  unitPriceKg,
  showPricing = false,
  currencySymbol = "ريال",
  allowCustomCapacity = true,
  className,
  disabled = false,
  onChange,
  onPriceChange,
}: BagWeightInputProps) {
  const [mode, setMode] = useState<"bags" | "kg">(initialMode);
  const [internalBags, setInternalBags] = useState<string>(
    controlledBags !== undefined ? String(controlledBags) : "",
  );
  const [internalCapacity, setInternalCapacity] = useState<number>(
    Number(controlledCapacity) || defaultCapacity,
  );
  const [customCapacity, setCustomCapacity] = useState<string>("");
  const [isCustomCapacity, setIsCustomCapacity] = useState<boolean>(false);
  const [internalTotalKg, setInternalTotalKg] = useState<string>(
    controlledTotalKg !== undefined ? String(controlledTotalKg) : "",
  );

  // Sync incoming props
  useEffect(() => {
    if (controlledBags !== undefined && String(controlledBags) !== internalBags) {
      setInternalBags(controlledBags ? String(controlledBags) : "");
    }
  }, [controlledBags]);

  useEffect(() => {
    if (controlledTotalKg !== undefined && String(controlledTotalKg) !== internalTotalKg) {
      setInternalTotalKg(controlledTotalKg ? String(controlledTotalKg) : "");
    }
  }, [controlledTotalKg]);

  useEffect(() => {
    if (controlledCapacity !== undefined) {
      const cap = Number(controlledCapacity);
      if (cap > 0) {
        setInternalCapacity(cap);
        if (!STANDARD_BAG_CAPACITIES.includes(cap)) {
          setIsCustomCapacity(true);
          setCustomCapacity(String(cap));
        } else {
          setIsCustomCapacity(false);
        }
      }
    }
  }, [controlledCapacity]);

  const activeCapacity = isCustomCapacity ? Number(customCapacity) || 0 : internalCapacity;

  const handleBagsChange = (bagsStr: string) => {
    setInternalBags(bagsStr);
    const b = Number(bagsStr) || 0;
    const computedTotal = activeCapacity > 0 ? b * activeCapacity : 0;
    setInternalTotalKg(computedTotal > 0 ? String(computedTotal) : "");

    onChange({
      bags: b,
      capacityKg: activeCapacity,
      totalKg: computedTotal,
      mode: "bags",
    });
  };

  const handleCapacityChange = (cap: number, customVal?: string) => {
    if (cap === -1) {
      setIsCustomCapacity(true);
      const customNum = Number(customVal !== undefined ? customVal : customCapacity) || 0;
      setCustomCapacity(customVal !== undefined ? customVal : customCapacity);
      const b = Number(internalBags) || 0;
      const computedTotal = customNum > 0 ? b * customNum : 0;
      setInternalTotalKg(computedTotal > 0 ? String(computedTotal) : "");

      onChange({
        bags: b,
        capacityKg: customNum,
        totalKg: computedTotal,
        mode,
      });
      return;
    }

    setIsCustomCapacity(false);
    setInternalCapacity(cap);
    const b = Number(internalBags) || 0;
    const computedTotal = cap > 0 ? b * cap : 0;
    setInternalTotalKg(computedTotal > 0 ? String(computedTotal) : "");

    onChange({
      bags: b,
      capacityKg: cap,
      totalKg: computedTotal,
      mode,
    });
  };

  const handleTotalKgChange = (kgStr: string) => {
    setInternalTotalKg(kgStr);
    const kg = Number(kgStr) || 0;
    let b = 0;
    if (activeCapacity > 0) {
      b = kg / activeCapacity;
      setInternalBags(b > 0 ? (Number.isInteger(b) ? String(b) : b.toFixed(2)) : "");
    }

    onChange({
      bags: b,
      capacityKg: activeCapacity,
      totalKg: kg,
      mode: "kg",
    });
  };

  const toggleMode = () => {
    const nextMode = mode === "bags" ? "kg" : "bags";
    setMode(nextMode);
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-surface/50 p-3.5 space-y-3 transition",
        className,
      )}
    >
      {/* Header with Mode Toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
          {mode === "bags" ? (
            <Package className="h-4 w-4 text-amber-500" />
          ) : (
            <Scale className="h-4 w-4 text-sky-500" />
          )}
          <span>
            {label || (mode === "bags" ? "إدخال بالأكياس والسعة" : "إدخال بالوزن المباشر")}
          </span>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={toggleMode}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition active:scale-95 disabled:opacity-50"
          title="التبديل بين إدخال الأكياس والوزن المباشر"
        >
          <ArrowRightLeft className="h-3 w-3" />
          <span>{mode === "bags" ? "تحويل لكيلوجرام مباشر" : "تحويل للأكياس"}</span>
        </button>
      </div>

      {mode === "bags" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Bags Count */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                عدد الأكياس *
              </label>
              <QuantityInput
                min={0}
                decimals={0}
                disabled={disabled}
                placeholder="0"
                aria-label="عدد الأكياس"
                value={toNumOrNull(internalBags)}
                onValueChange={(v) => handleBagsChange(v == null ? "" : String(v))}
              />
            </div>

            {/* Bag Capacity Selection */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                سعة الكيس (كجم) *
              </label>
              <div className="flex gap-1">
                <select
                  disabled={disabled}
                  value={isCustomCapacity ? "custom" : String(internalCapacity)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "custom") {
                      handleCapacityChange(-1);
                    } else {
                      handleCapacityChange(Number(val));
                    }
                  }}
                  className="h-10 flex-1 rounded-xl border border-border/80 bg-surface px-2.5 text-xs font-semibold text-foreground outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
                >
                  {STANDARD_BAG_CAPACITIES.map((cap) => (
                    <option key={cap} value={String(cap)}>
                      كيس {cap} كجم
                    </option>
                  ))}
                  {allowCustomCapacity && <option value="custom">سعة مخصصة...</option>}
                </select>

                {isCustomCapacity && (
                  <div className="w-24">
                    <QuantityInput
                      min={0}
                      decimals={1}
                      disabled={disabled}
                      placeholder="0.0"
                      aria-label="سعة الكيس المخصصة (كجم)"
                      value={toNumOrNull(customCapacity)}
                      onValueChange={(v) => handleCapacityChange(-1, v == null ? "" : String(v))}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Derivation summary strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs">
            <span className="text-amber-800 dark:text-amber-200 font-medium">
              إجمالي الوزن المحسوب:
            </span>
            <span className="font-bold text-amber-900 dark:text-amber-100">
              <Mono>{fmtNum(Number(internalTotalKg) || 0)}</Mono> كجم
            </span>
          </div>
        </div>
      ) : (
        /* Direct Kg Mode */
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                الوزن الإجمالي (كجم) *
              </label>
              <QuantityInput
                min={0}
                decimals={3}
                unit="kg"
                disabled={disabled}
                placeholder="0.00"
                aria-label="الوزن الإجمالي (كجم)"
                value={toNumOrNull(internalTotalKg)}
                onValueChange={(v) => handleTotalKgChange(v == null ? "" : String(v))}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                معيار سعة الكيس للتحويل (كجم)
              </label>
              <select
                disabled={disabled}
                value={isCustomCapacity ? "custom" : String(internalCapacity)}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "custom") {
                    handleCapacityChange(-1);
                  } else {
                    handleCapacityChange(Number(val));
                  }
                }}
                className="h-10 w-full rounded-xl border border-border/80 bg-surface px-2.5 text-xs font-semibold text-foreground outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
              >
                {STANDARD_BAG_CAPACITIES.map((cap) => (
                  <option key={cap} value={String(cap)}>
                    كيس {cap} كجم
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Derivation summary strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-500/10 border border-sky-500/20 px-3 py-2 text-xs">
            <span className="text-sky-800 dark:text-sky-200 font-medium">
              العدد المشتق من الأكياس:
            </span>
            <span className="font-bold text-sky-900 dark:text-sky-100">
              <Mono>{fmtNum(Number(internalBags) || 0)}</Mono> كيس سعة {activeCapacity} كجم
            </span>
          </div>
        </div>
      )}

      {/* Pricing Synchronization Section (Optional) */}
      {showPricing && (
        <div className="border-t border-border/60 pt-2.5 grid gap-3 sm:grid-cols-2 text-xs">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
              سعر الكيس ({currencySymbol})
            </label>
            <AmountInput
              min={0}
              disabled={disabled}
              placeholder="0.00"
              aria-label={`سعر الكيس (${currencySymbol})`}
              value={unitPriceBag ?? null}
              onValueChange={(v) => {
                const bagP = v ?? 0;
                const kgP = activeCapacity > 0 ? bagP / activeCapacity : 0;
                onPriceChange?.({ unitPriceBag: bagP, unitPriceKg: kgP });
              }}
              wordsClassName="text-[10px] leading-3"
              containerClassName="[&_input]:h-9 [&_input]:rounded-lg [&_input]:text-xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
              سعر الكيلو ({currencySymbol}/كجم)
            </label>
            <AmountInput
              min={0}
              disabled={disabled}
              placeholder="0.00"
              aria-label={`سعر الكيلو (${currencySymbol}/كجم)`}
              value={unitPriceKg ?? null}
              onValueChange={(v) => {
                const kgP = v ?? 0;
                const bagP = activeCapacity > 0 ? kgP * activeCapacity : 0;
                onPriceChange?.({ unitPriceBag: bagP, unitPriceKg: kgP });
              }}
              wordsClassName="text-[10px] leading-3"
              containerClassName="[&_input]:h-9 [&_input]:rounded-lg [&_input]:text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * القيم هنا محفوظة كنصوص (لأنها تصل من النموذج الأب)، والمكوّنان الموحّدان
 * يعملان بـ `number | null` — النص الفارغ أو غير الرقمي يصبح null بدل NaN.
 */
function toNumOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
