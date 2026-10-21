/**
 * Market-Hub ERP — Milling terms, one field set for both counters.
 *
 * WHY THIS IS A COMPONENT AND NOT A FUNCTION
 * ------------------------------------------
 * The immediate-cash counter and the custody counter used to declare their own
 * fields inline, and they drifted. One grew the fee basis and extraction rate;
 * the other grew truck plate and gross/tare weights. An operator learned two
 * different forms for what is physically the same decision — "what are these
 * terms?" — and a merchant's grain could be deposited with terms the cashier
 * had never seen.
 *
 * So the terms live here once, and both counters mount the same component. If a
 * field is added, both counters gain it; if the fee arithmetic changes, there is
 * exactly one place it can be wrong.
 *
 * THE FEE IS READ OUT LOUD AT THE SCALE
 * --------------------------------------
 * That is the whole reason these fields sit on the deposit receipt. A merchant
 * standing at the gate should hear the price per bag now, not argue about it on
 * a later visit. So the basis is explicit (per sack, per ton, or a lump sum
 * agreed once) and the agreed total is shown before anything is saved.
 */
import { useMemo } from "react";
import { AmountInput } from "@/components/ui/amount-input";
import { QuantityInput } from "@/components/ui/quantity-input";

export type MillingFeeBasis = "BAG" | "TON" | "LUMP_SUM";
export type BagSource = "CUSTOMER" | "MILL";
export type MillingOutputChoice = "FLOUR_GRADE_1" | "FLOUR_GRADE_2" | "SEMOLINA" | "BRAN";

/** The sack sizes the module uses everywhere, biggest first. */
export const MILLING_BAG_SIZES = [
  { kg: 50, ar: "شوال 50 كجم", en: "Sack 50 kg" },
  { kg: 40, ar: "كيس 40 كجم", en: "Bag 40 kg" },
  { kg: 25, ar: "كيس 25 كجم", en: "Bag 25 kg" },
  { kg: 10, ar: "كيس 10 كجم", en: "Bag 10 kg" },
] as const;

export const MILLING_OUTPUT_OPTIONS: {
  value: MillingOutputChoice;
  ar: string;
  en: string;
}[] = [
  { value: "FLOUR_GRADE_1", ar: "طحن ناعم (دقيق نمرة 1)", en: "Fine — flour grade 1" },
  { value: "FLOUR_GRADE_2", ar: "طحن بر (دقيق بلدي كامل)", en: "Whole grain — grade 2" },
  { value: "SEMOLINA", ar: "سميد فاخر", en: "Semolina" },
  { value: "BRAN", ar: "جرش نخالة", en: "Bran" },
];

export const MILLING_FEE_BASES: { value: MillingFeeBasis; ar: string; en: string }[] = [
  { value: "BAG", ar: "لكل شوال", en: "Per sack" },
  { value: "TON", ar: "لكل طن", en: "Per ton" },
  { value: "LUMP_SUM", ar: "مبلغ مقطوع", en: "Lump sum" },
];

export interface MillingTermsValue {
  millingType: MillingOutputChoice;
  feeBasis: MillingFeeBasis;
  /** Per-sack fee. Only read when basis is BAG. */
  feePerBag: number;
  /** Per-ton fee. Only read when basis is TON. */
  feePerTon: number;
  /** Whole-agreed amount. Only read when basis is LUMP_SUM. */
  lumpSum: number;
  bagsSource: BagSource;
  bagType: string;
  bagCondition: string;
  extractionRate: string;
  allowedLoss: string;
}

export const EMPTY_MILLING_TERMS: MillingTermsValue = {
  millingType: "FLOUR_GRADE_1",
  feeBasis: "BAG",
  feePerBag: 0,
  feePerTon: 0,
  lumpSum: 0,
  bagsSource: "CUSTOMER",
  bagType: "",
  bagCondition: "سليم",
  extractionRate: "",
  allowedLoss: "",
};

/**
 * The agreed fee, from the basis the operator chose.
 *
 * PER_TON converts through the sack count and the sack size, because that is
 * the only place the total weight is known. A per-ton fee on an empty
 * cartouche is silently zero rather than an error, so the caller passes the
 * same numbers it displays.
 */
export function computeMillingFee(
  terms: Pick<MillingTermsValue, "feeBasis" | "feePerBag" | "feePerTon" | "lumpSum">,
  bagCount: number,
  bagSizeKg: number,
): number {
  const bags = Math.max(0, Number(bagCount) || 0);
  const rate = Math.max(0, Number(terms.feePerBag) || 0);
  switch (terms.feeBasis) {
    case "TON": {
      const tons = (bags * (Number(bagSizeKg) || 0)) / 1000;
      return round2(tons * Math.max(0, Number(terms.feePerTon) || 0));
    }
    case "LUMP_SUM":
      return round2(Math.max(0, Number(terms.lumpSum) || 0));
    default:
      return round2(bags * rate);
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

const FIELD =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:ring-2 focus:ring-primary/30";
const LABEL = "block text-xs font-bold text-foreground";

export interface MillingTermsFieldsProps {
  value: MillingTermsValue;
  onChange: (next: MillingTermsValue) => void;
  bagCount: number;
  bagSizeKg: number;
  /** Mill bag products, shown when the mill supplies the packaging. */
  packagingProducts?: { id: string; name: string; sale_price: number }[];
  millBagId?: string;
  millBagPrice?: number;
  onMillBagChange?: (id: string, price: number) => void;
  isRtl?: boolean;
  /** Compact spacing for the quick counter. */
  compact?: boolean;
}

/**
 * The terms block. Purely presentational: it owns no state, so the parent
 * document — an intake receipt, a direct ticket — decides what happens to the
 * value it reads back.
 */
export function MillingTermsFields({
  value,
  onChange,
  bagCount,
  bagSizeKg,
  packagingProducts = [],
  millBagId = "",
  millBagPrice = 0,
  onMillBagChange,
  isRtl = true,
  compact = false,
}: MillingTermsFieldsProps) {
  const fee = useMemo(
    () => computeMillingFee(value, bagCount, bagSizeKg),
    [value, bagCount, bagSizeKg],
  );

  const set = <K extends keyof MillingTermsValue>(key: K, v: MillingTermsValue[K]) =>
    onChange({ ...value, [key]: v });

  const gap = compact ? "gap-3" : "gap-4";

  return (
    <div className={`space-y-4 ${compact ? "p-3" : ""}`}>
      {/* What is being produced, and how the price is agreed. */}
      <div className={`grid gap-3 ${gap} sm:grid-cols-3`}>
        <div className="space-y-1.5">
          <label className={LABEL}>{isRtl ? "نوع الطحن المطلوب" : "Milling type"}</label>
          <select
            value={value.millingType}
            onChange={(e) => set("millingType", e.target.value as MillingOutputChoice)}
            className={`${FIELD} font-bold text-amber-600 dark:text-amber-400`}
          >
            {MILLING_OUTPUT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {isRtl ? o.ar : o.en}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className={LABEL}>{isRtl ? "أساس الأجر" : "Fee basis"}</label>
          <select
            value={value.feeBasis}
            onChange={(e) => set("feeBasis", e.target.value as MillingFeeBasis)}
            className={FIELD}
          >
            {MILLING_FEE_BASES.map((b) => (
              <option key={b.value} value={b.value}>
                {isRtl ? b.ar : b.en}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className={LABEL}>
            {value.feeBasis === "BAG"
              ? isRtl
                ? "أجرة الشوال (ر.ي)"
                : "Fee per sack"
              : value.feeBasis === "TON"
                ? isRtl
                  ? "أجرة الطن (ر.ي)"
                  : "Fee per ton"
                : isRtl
                  ? "مبلغ مقطوع (ر.ي)"
                  : "Lump sum"}
          </label>
          <AmountInput
            value={
              value.feeBasis === "BAG"
                ? value.feePerBag
                : value.feeBasis === "TON"
                  ? value.feePerTon
                  : value.lumpSum
            }
            onValueChange={(n) => {
              const amount = n ?? 0;
              if (value.feeBasis === "BAG") set("feePerBag", amount);
              else if (value.feeBasis === "TON") set("feePerTon", amount);
              else set("lumpSum", amount);
            }}
            min={0}
            className="h-[38px] text-xs"
          />
        </div>
      </div>

      {/* Packaging: whose sacks, what kind, and in what state they arrive. */}
      <div className={`grid gap-3 ${gap} sm:grid-cols-3`}>
        <div className="space-y-1.5">
          <label className={LABEL}>{isRtl ? "مصدر الأكياس" : "Bag source"}</label>
          <select
            value={value.bagsSource}
            onChange={(e) => set("bagsSource", e.target.value as BagSource)}
            className={FIELD}
          >
            <option value="CUSTOMER">{isRtl ? "أكياس العميل" : "Customer's bags"}</option>
            <option value="MILL">
              {isRtl ? "أكياس المطحنة (تُحتسب أجرة)" : "Mill's bags (charged)"}
            </option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className={LABEL}>{isRtl ? "نوع الكيس" : "Bag type"}</label>
          <input
            value={value.bagType}
            onChange={(e) => set("bagType", e.target.value)}
            placeholder={isRtl ? "خيش طبيعي / بلاستيك" : "Jute / plastic"}
            className={FIELD}
          />
        </div>

        <div className="space-y-1.5">
          <label className={LABEL}>{isRtl ? "حالة الأكياس" : "Bag condition"}</label>
          <input
            value={value.bagCondition}
            onChange={(e) => set("bagCondition", e.target.value)}
            placeholder={isRtl ? "سليم / ممزق جزئياً" : "Sound / partly torn"}
            className={FIELD}
          />
        </div>
      </div>

      {/* What the merchant expects back, and what loss he tolerates. */}
      <div className={`grid gap-3 ${gap} sm:grid-cols-2`}>
        <div className="space-y-1.5">
          <label className={LABEL}>
            {isRtl ? "الاستخلاص المتوقع (%)" : "Expected extraction (%)"}
          </label>
          <QuantityInput
            value={value.extractionRate === "" ? null : Number(value.extractionRate)}
            onValueChange={(v) => set("extractionRate", v == null ? "" : String(v))}
            decimals={2}
            min={0}
            max={100}
            unit="%"
            placeholder={isRtl ? "اختياري" : "optional"}
            className="h-[38px] text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <label className={LABEL}>{isRtl ? "الفاقد المسموح (%)" : "Allowed loss (%)"}</label>
          <QuantityInput
            value={value.allowedLoss === "" ? null : Number(value.allowedLoss)}
            onValueChange={(v) => set("allowedLoss", v == null ? "" : String(v))}
            decimals={2}
            min={0}
            max={100}
            unit="%"
            placeholder={isRtl ? "اختياري" : "optional"}
            className="h-[38px] text-xs"
          />
        </div>
      </div>

      {/* The mill supplying the sacks sells them, so they are a priced line. */}
      {value.bagsSource === "MILL" && packagingProducts.length > 0 && onMillBagChange && (
        <div className={`grid gap-3 ${gap} sm:grid-cols-2`}>
          <div className="space-y-1.5">
            <label className={LABEL}>{isRtl ? "صنف كيس المطحنة" : "Mill bag item"}</label>
            <select
              value={millBagId}
              onChange={(e) => {
                const item = packagingProducts.find((p) => p.id === e.target.value);
                onMillBagChange(e.target.value, Number(item?.sale_price) || 0);
              }}
              className={FIELD}
            >
              <option value="">{isRtl ? "— اختر صنف الكيس —" : "— Select bag item —"}</option>
              {packagingProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sale_price.toLocaleString()} {isRtl ? "ر.ي" : ""})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={LABEL}>{isRtl ? "سعر الكيس الواحد" : "Price per bag"}</label>
            <AmountInput
              value={millBagPrice}
              onValueChange={(n) => onMillBagChange(millBagId, n ?? 0)}
              min={0}
              className="h-[38px] text-xs"
            />
          </div>
        </div>
      )}

      {/* The number the merchant hears before the truck leaves. */}
      <div className="flex items-center justify-between rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2">
        <span className="text-xs font-bold text-foreground">
          {isRtl ? "أجرة الطحن المتفق عليها" : "Agreed milling fee"}
        </span>
        <span className="font-mono text-sm font-bold text-amber-700 dark:text-amber-300">
          {fee.toLocaleString()} {isRtl ? "ر.ي" : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * The bag-size select, shared so both counters offer the same sizes in the same
 * order. The custody form used to omit the 10 kg sack that the direct form
 * offered, which meant a merchant filling small sacks had no choice at that
 * counter.
 */
export function MillingBagSizeSelect({
  value,
  onChange,
  isRtl = true,
}: {
  value: number;
  onChange: (kg: number) => void;
  isRtl?: boolean;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`${FIELD} text-center font-mono font-bold`}
    >
      {MILLING_BAG_SIZES.map((b) => (
        <option key={b.kg} value={String(b.kg)}>
          {isRtl ? b.ar : b.en}
        </option>
      ))}
    </select>
  );
}
