import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { postOpeningStock } from "@/lib/items/stock-operations";
import { toast } from "sonner";
import { X, PackagePlus, Plus, Loader2 } from "lucide-react";

type OpeningItem = {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
};

type OpeningLine = { productId: string; quantity: string; unitCost: string };

interface OpeningStockDialogProps {
  warehouseId: string;
  onClose: () => void;
  onSaved: () => void;
}

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none";

/**
 * Opening stock — a standing balance, deliberately NOT a purchase.
 *
 * It is posted through `post_opening_stock` so the position, its ledger entry
 * and its own document are created together; the design keeps it out of the
 * purchase report on purpose. Nothing here writes stock tables by hand.
 */
export function OpeningStockDialog({ warehouseId, onClose, onSaved }: OpeningStockDialogProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<OpeningLine[]>([
    { productId: "", quantity: "", unitCost: "" },
  ]);

  // Only TRACKED goods can hold a balance, so only they are offered here.
  const { data: items } = useQuery<OpeningItem[]>({
    queryKey: ["tracked-items-for-opening"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, name_ar, sku")
        .eq("inventory_policy" as never, "TRACKED" as never)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as OpeningItem[];
    },
  });

  function updateLine(index: number, patch: Partial<OpeningLine>) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const valid = lines.filter((line) => line.productId && Number(line.quantity) > 0);
    if (valid.length === 0) {
      toast.error(
        ar
          ? "أضف بندًا واحدًا على الأقل بكمية موجبة"
          : "Add at least one line with a positive quantity",
      );
      return;
    }

    setSaving(true);
    const result = await postOpeningStock({
      warehouseId,
      effectiveDate,
      note: note.trim() || undefined,
      lines: valid.map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost) || 0,
      })),
    });
    setSaving(false);

    if (!result.ok) {
      toast.error(
        result.message ?? (ar ? "فشل ترحيل رصيد أول المدة" : "Failed to post opening stock"),
      );
      return;
    }
    toast.success(ar ? "تم ترحيل رصيد أول المدة" : "Opening stock posted");
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-3xl border border-border/80 bg-surface shadow-2xl overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/80 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {ar ? "رصيد أول المدة" : "Opening stock"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {ar
                ? "مستند مستقل عن المشتريات — لا يظهر في تقرير المشتريات."
                : "An independent document — it never appears in the purchase report."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3.5 p-5 text-sm custom-scrollbar">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {ar ? "التاريخ" : "Date"}
              </span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
                className={fieldClass}
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {ar ? "ملاحظة" : "Note"}
              </span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={fieldClass}
                placeholder={ar ? "مثال: جرد افتتاحي" : "e.g. initial stocktake"}
              />
            </label>
          </div>

          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 gap-2">
                <select
                  value={line.productId}
                  onChange={(event) => updateLine(index, { productId: event.target.value })}
                  className={`${fieldClass} col-span-6`}
                >
                  <option value="">{ar ? "اختر الصنف" : "Select item"}</option>
                  {(items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {ar ? item.name_ar || item.name : item.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={line.quantity}
                  onChange={(event) => updateLine(index, { quantity: event.target.value })}
                  placeholder={ar ? "الكمية" : "Qty"}
                  className={`${fieldClass} col-span-3`}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.unitCost}
                  onChange={(event) => updateLine(index, { unitCost: event.target.value })}
                  placeholder={ar ? "تكلفة الوحدة" : "Unit cost"}
                  className={`${fieldClass} col-span-3`}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setLines((current) => [...current, { productId: "", quantity: "", unitCost: "" }])
            }
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            <Plus className="h-3 w-3" /> {ar ? "إضافة بند" : "Add line"}
          </button>

          <p className="rounded-md border border-border bg-surface/60 p-2.5 text-[11px] text-muted-foreground">
            {ar
              ? "تكلفة الوحدة هنا هي قيمة تقييم الرصيد الافتتاحي، وليست سعر شراء من مورد."
              : "The unit cost here values the opening balance; it is not a supplier purchase price."}
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/80 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            {ar ? "إلغاء" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{ar ? "جاري الترحيل..." : "Posting..."}</span>
              </>
            ) : (
              <>
                <PackagePlus className="h-3.5 w-3.5" />
                <span>{ar ? "ترحيل الرصيد" : "Post balance"}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
