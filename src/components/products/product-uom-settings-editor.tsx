import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldSurfaceClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ProductUomDraft = {
  unit_id: string;
  factor_to_base: string;
  conversion_basis: "STANDARD" | "FIXED_PACKAGE" | "ITEM_SPECIFIC";
  conversion_note: string;
  quantity_increment: string;
  can_purchase: boolean;
  can_sell: boolean;
  sale_price: string;
  purchase_price: string;
  barcodes: string;
};

export type ProductUomChoice = {
  id: string;
  name: string;
  name_ar: string | null;
  short_name: string;
  dimension_code?: string;
  factor_to_reference?: number | null;
};

type Props = {
  lang: string;
  units: ProductUomChoice[];
  baseUnitId: string;
  rows: ProductUomDraft[];
  onRowsChange: (next: ProductUomDraft[]) => void;
  salesUnitId: string;
  onSalesUnitChange: (unitId: string) => void;
  purchaseUnitId: string;
  onPurchaseUnitChange: (unitId: string) => void;
  canSell: boolean;
  canPurchase: boolean;
  disabled?: boolean;
};

function initialConversion(unit: ProductUomChoice | undefined, base: ProductUomChoice | undefined) {
  const sameDimension =
    !!unit?.dimension_code && unit.dimension_code === base?.dimension_code &&
    unit.factor_to_reference != null && base.factor_to_reference != null;
  if (sameDimension) {
    return {
      conversion_basis: "STANDARD" as const,
      factor_to_base: String(Number(unit!.factor_to_reference) / Number(base!.factor_to_reference)),
    };
  }
  if (unit?.dimension_code === "PACKAGING" || base?.dimension_code === "PACKAGING") {
    return { conversion_basis: "FIXED_PACKAGE" as const, factor_to_base: "1" };
  }
  return { conversion_basis: "ITEM_SPECIFIC" as const, factor_to_base: "1" };
}

function defaultQuantityIncrement(
  unit: ProductUomChoice | undefined,
  conversionFactor: string,
) {
  if (["COUNT", "PACKAGING"].includes(unit?.dimension_code ?? "")) return "1";
  const factor = Number(conversionFactor);
  if (!Number.isFinite(factor) || factor <= 0) return "0.001";
  // Inventory and batch quantities currently retain three base-unit decimals.
  // A smaller transaction unit therefore needs a correspondingly larger step.
  // Transaction quantities are persisted to six decimals. Do not suggest a
  // smaller step that the invoice snapshot cannot represent.
  return String(Math.max(0.000001, 0.001 / factor));
}

export function ProductUomSettingsEditor({
  lang,
  units,
  baseUnitId,
  rows,
  onRowsChange,
  salesUnitId,
  onSalesUnitChange,
  purchaseUnitId,
  onPurchaseUnitChange,
  canSell,
  canPurchase,
  disabled = false,
}: Props) {
  const ar = lang === "ar";
  const baseUnit = units.find((unit) => unit.id === baseUnitId);
  const eligibleSalesUnits = [
    ...(canSell && baseUnit ? [baseUnit] : []),
    ...rows.filter((row) => canSell && row.can_sell).flatMap((row) => {
      const unit = units.find((candidate) => candidate.id === row.unit_id);
      return unit ? [unit] : [];
    }),
  ];
  const eligiblePurchaseUnits = [
    ...(canPurchase && baseUnit ? [baseUnit] : []),
    ...rows.filter((row) => canPurchase && row.can_purchase).flatMap((row) => {
      const unit = units.find((candidate) => candidate.id === row.unit_id);
      return unit ? [unit] : [];
    }),
  ];

  function addUnit() {
    const used = new Set([baseUnitId, ...rows.map((row) => row.unit_id)]);
    const nextUnit = units.find((unit) => !used.has(unit.id));
    const conversion = initialConversion(nextUnit, baseUnit);
    onRowsChange([
      ...rows,
      {
        unit_id: nextUnit?.id ?? "",
        factor_to_base: conversion.factor_to_base,
        conversion_basis: conversion.conversion_basis,
        conversion_note: "",
        quantity_increment: defaultQuantityIncrement(nextUnit, conversion.factor_to_base),
        can_purchase: canPurchase,
        can_sell: canSell,
        sale_price: "",
        purchase_price: "",
        barcodes: "",
      },
    ]);
  }

  function update(index: number, patch: Partial<ProductUomDraft>) {
    const current = rows[index];
    if (patch.can_sell === false && current?.unit_id === salesUnitId) onSalesUnitChange(baseUnitId);
    if (patch.can_purchase === false && current?.unit_id === purchaseUnitId) onPurchaseUnitChange(baseUnitId);
    onRowsChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function changeUnit(index: number, unitId: string) {
    const unit = units.find((candidate) => candidate.id === unitId);
    const conversion = initialConversion(unit, baseUnit);
    update(index, {
      unit_id: unitId,
      ...conversion,
      conversion_note: "",
      quantity_increment: defaultQuantityIncrement(unit, conversion.factor_to_base),
    });
  }

  const selectClass = cn(fieldSurfaceClass, "h-10 min-w-0 px-3 text-sm");
  const inputClass = cn(fieldSurfaceClass, "h-10 min-w-0 px-3 text-sm");

  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-card/80 p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {ar ? "وحدات الشراء والبيع والباركود" : "Purchase, sales units and barcodes"}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            {ar
              ? "الرصيد والدفعات والتكلفة تحفظ بوحدة الأساس. أدخل معامل كل عبوة وسعرها وباركودها؛ لا يُستنتج محتوى العبوة تلقائيًا."
              : "Stock, batches and valuation use the base unit. Set each package factor, price and barcode; package contents are never guessed."}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addUnit} disabled={disabled || !baseUnitId || units.length <= rows.length + 1}>
          <Plus className="me-1 size-4" />
          {ar ? "إضافة وحدة بديلة" : "Add alternate unit"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {canSell && (
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>{ar ? "وحدة البيع الافتراضية" : "Default sales unit"}</span>
            <select
              value={salesUnitId}
              onChange={(event) => onSalesUnitChange(event.target.value)}
              disabled={disabled}
              className={selectClass}
            >
              <option value="">{ar ? "اختر وحدة" : "Choose a unit"}</option>
              {eligibleSalesUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>{ar ? unit.name_ar || unit.name : unit.name}</option>
              ))}
            </select>
          </label>
        )}
        {canPurchase && (
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>{ar ? "وحدة الشراء الافتراضية" : "Default purchase unit"}</span>
            <select
              value={purchaseUnitId}
              onChange={(event) => onPurchaseUnitChange(event.target.value)}
              disabled={disabled}
              className={selectClass}
            >
              <option value="">{ar ? "اختر وحدة" : "Choose a unit"}</option>
              {eligiblePurchaseUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>{ar ? unit.name_ar || unit.name : unit.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!baseUnitId && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          {ar ? "اختر وحدة أساس أولًا لتحديد معاملات التحويل." : "Choose a base unit before defining conversions."}
        </p>
      )}

      {rows.map((row, index) => {
        const usedIds = new Set([baseUnitId, ...rows.filter((_, rowIndex) => rowIndex !== index).map((item) => item.unit_id)]);
        const selectedUnit = units.find((unit) => unit.id === row.unit_id);
        const hasStandardConversion =
          !!selectedUnit?.dimension_code && selectedUnit.dimension_code === baseUnit?.dimension_code &&
          selectedUnit.factor_to_reference != null && baseUnit?.factor_to_reference != null;
        return (
          <article key={`${row.unit_id || "new"}-${index}`} className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3 sm:p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.8fr)_auto]">
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span>{ar ? "الوحدة البديلة" : "Alternate unit"}</span>
                <select value={row.unit_id} onChange={(event) => changeUnit(index, event.target.value)} disabled={disabled} className={selectClass}>
                  <option value="">{ar ? "اختر وحدة" : "Choose a unit"}</option>
                  {units.filter((unit) => !usedIds.has(unit.id)).map((unit) => (
                    <option key={unit.id} value={unit.id}>{ar ? unit.name_ar || unit.name : unit.name} ({unit.short_name})</option>
                  ))}
                  {selectedUnit && <option value={selectedUnit.id}>{ar ? selectedUnit.name_ar || selectedUnit.name : selectedUnit.name} ({selectedUnit.short_name})</option>}
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span>{ar ? "كم وحدة أساس؟" : "Base units per unit"}</span>
                <input type="number" min="0.000000000001" step="any" value={row.factor_to_base} onChange={(event) => update(index, { factor_to_base: event.target.value })} disabled={disabled || row.conversion_basis === "STANDARD"} className={inputClass} dir="ltr" />
              </label>
              <div className="flex items-end justify-end">
                <Button type="button" variant="ghost" size="icon" aria-label={ar ? "حذف الوحدة" : "Remove unit"} onClick={() => onRowsChange(rows.filter((_, rowIndex) => rowIndex !== index))} disabled={disabled}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span>{ar ? "نوع التحويل" : "Conversion type"}</span>
                <select
                  value={row.conversion_basis}
                  onChange={(event) => {
                    const conversionBasis = event.target.value as ProductUomDraft["conversion_basis"];
                    const standard = initialConversion(selectedUnit, baseUnit);
                    update(index, {
                      conversion_basis: conversionBasis,
                      ...(conversionBasis === "STANDARD" ? { factor_to_base: standard.factor_to_base } : {}),
                    });
                  }}
                  disabled={disabled}
                  className={selectClass}
                >
                  <option value="STANDARD" disabled={!hasStandardConversion}>{ar ? "قياسي حسب البعد" : "Standard measurement"}</option>
                  <option value="FIXED_PACKAGE" disabled={selectedUnit?.dimension_code !== "PACKAGING" && baseUnit?.dimension_code !== "PACKAGING"}>{ar ? "محتوى عبوة ثابت" : "Fixed package contents"}</option>
                  <option value="ITEM_SPECIFIC" disabled={selectedUnit?.dimension_code !== "CUSTOM" && baseUnit?.dimension_code !== "CUSTOM"}>{ar ? "خاص بهذا الصنف" : "Item-specific"}</option>
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span>{ar ? "خطوة الكمية" : "Quantity increment"}</span>
                <input type="number" min="0.000001" step="0.000001" value={row.quantity_increment} onChange={(event) => update(index, { quantity_increment: event.target.value })} disabled={disabled} className={inputClass} dir="ltr" />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span>{ar ? "سعر البيع لهذه الوحدة" : "Sales price for this unit"}</span>
                <input type="number" min="0" step="0.0001" value={row.sale_price} onChange={(event) => update(index, { sale_price: event.target.value })} disabled={disabled || !row.can_sell} className={inputClass} dir="ltr" placeholder={ar ? "تناسبيا من سعر الأساس" : "Falls back to base price × factor"} />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span>{ar ? "سعر الشراء المرجعي" : "Reference purchase price"}</span>
                <input type="number" min="0" step="0.0001" value={row.purchase_price} onChange={(event) => update(index, { purchase_price: event.target.value })} disabled={disabled || !row.can_purchase} className={inputClass} dir="ltr" placeholder={ar ? "اختياري" : "Optional"} />
              </label>
            </div>

            {row.conversion_basis !== "STANDARD" && (
              <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                <span>{ar ? "بيان محتوى العبوة أو سبب التحويل الخاص" : "Package contents or item-specific conversion note"}</span>
                <input value={row.conversion_note} onChange={(event) => update(index, { conversion_note: event.target.value })} disabled={disabled} className={inputClass} placeholder={ar ? "مثال: الكرتونة تحتوي 24 حبة" : "e.g. carton contains 24 pieces"} />
              </label>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <fieldset className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-border/50 p-3 text-xs text-foreground">
                <legend className="px-1 text-[11px] text-muted-foreground">{ar ? "السماح باستخدام الوحدة" : "Use this unit for"}</legend>
                {canSell && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={row.can_sell} disabled={disabled} onChange={(event) => update(index, { can_sell: event.target.checked })} />{ar ? "البيع" : "Sales"}</label>}
                {canPurchase && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={row.can_purchase} disabled={disabled} onChange={(event) => update(index, { can_purchase: event.target.checked })} />{ar ? "الشراء" : "Purchases"}</label>}
              </fieldset>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span>{ar ? "باركودات هذه الوحدة (كل رمز في سطر)" : "Barcodes for this unit (one per line)"}</span>
                <textarea value={row.barcodes} onChange={(event) => update(index, { barcodes: event.target.value })} disabled={disabled} rows={2} dir="ltr" className={cn(fieldSurfaceClass, "min-h-16 resize-y px-3 py-2 text-sm")} />
              </label>
            </div>
          </article>
        );
      })}
    </section>
  );
}
