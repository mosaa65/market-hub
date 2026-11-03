import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  CalendarClock,
  Check,
  Sparkles,
  AlertCircle,
  ShieldAlert,
  PackageCheck,
} from "lucide-react";
import { useBatchSettings } from "@/hooks/use-batch-settings";

interface BatchItem {
  id: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
}

interface PosBatchSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  warehouseId: string;
  dispatchStrategy?: "FEFO" | "FIFO" | "MANUAL" | null;
  currentBatchId?: string | null;
  onSelectBatch: (
    batch: { id: string; batch_number: string; expiry_date: string | null } | null,
  ) => void;
}

function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function PosBatchSelectorModal({
  open,
  onOpenChange,
  productId,
  productName,
  warehouseId,
  dispatchStrategy,
  currentBatchId,
  onSelectBatch,
}: PosBatchSelectorModalProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { settings } = useBatchSettings();

  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(currentBatchId || null);

  const todayStr = getLocalDateString();
  const effectiveStrategy = dispatchStrategy ?? settings.dispatch_strategy;
  const manualSelectionRequired =
    effectiveStrategy === "MANUAL" || settings.enforce_batch_selection_on_pos;

  useEffect(() => {
    if (!open || !productId || !warehouseId) return;
    setLoading(true);
    setSelectedId(currentBatchId || null);

    void Promise.resolve(
      supabase
        .from("product_batches")
        .select("id, batch_number, expiry_date, quantity")
        .eq("product_id", productId)
        .eq("warehouse_id", warehouseId)
        .gt("quantity", 0)
        .or(
          settings.prevent_selling_expired
            ? `expiry_date.is.null,expiry_date.gt.${todayStr}`
            : "quantity.gt.0",
        )
        .order(effectiveStrategy === "FEFO" ? "expiry_date" : "created_at", {
          ascending: true,
          nullsFirst: false,
        }),
    )
      .then(({ data, error }) => {
        if (!error && data) {
          setBatches(data as BatchItem[]);
        }
      })
      .finally(() => setLoading(false));
  }, [
    open,
    productId,
    warehouseId,
    currentBatchId,
    effectiveStrategy,
    dispatchStrategy,
    settings.enforce_batch_selection_on_pos,
    settings.prevent_selling_expired,
    todayStr,
  ]);

  const handleConfirm = () => {
    if (!selectedId) {
      onSelectBatch(null); // Auto allocation (FEFO/FIFO)
    } else {
      const b = batches.find((item) => item.id === selectedId);
      if (b) {
        onSelectBatch({
          id: b.id,
          batch_number: b.batch_number,
          expiry_date: b.expiry_date,
        });
      }
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-0 gap-0 border-border bg-background shadow-2xl">
        <DialogHeader className="p-5 pb-3 border-b border-border/80 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <CalendarClock className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                {isAr ? "اختيار دفعة الصرف" : "Select Batch"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
                {productName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-3">
          {/* Default Auto Allocation Option */}
          <button
            type="button"
            disabled={manualSelectionRequired}
            onClick={() => setSelectedId(null)}
            className={`w-full text-start p-3 rounded-xl border transition flex items-center justify-between ${
              manualSelectionRequired
                ? "cursor-not-allowed border-border/60 opacity-50"
                : selectedId === null
                ? "border-primary bg-primary/10 shadow-sm"
                : "border-border/80 bg-surface hover:border-border"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Sparkles className="size-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <span>{isAr ? "الصرف التلقائي الذكي" : "Smart Auto-Dispatch"}</span>
                  <Badge
                    variant="outline"
                    className="text-[9px] py-0 border-primary/40 text-primary"
                  >
                    {effectiveStrategy}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {isAr
                    ? manualSelectionRequired
                      ? "اختيار دفعة محددة مطلوب حسب إعداد نقطة البيع."
                      : effectiveStrategy === "FIFO"
                        ? "يخصم أقدم دفعة استلاماً أولاً، ويمكن توزيع الكمية على عدة دفعات."
                        : "يخصم الدفعة الأقرب انتهاءً أولاً، ويمكن توزيع الكمية على عدة دفعات."
                    : manualSelectionRequired
                      ? "Select a batch below; the POS settings require a specific batch."
                      : effectiveStrategy === "FIFO"
                        ? "Uses the oldest received batch first and can split the quantity across batches."
                        : "Uses the earliest-expiring batch first and can split the quantity across batches."}
                </div>
              </div>
            </div>

            {selectedId === null && <Check className="size-4 text-primary shrink-0" />}
          </button>

          <div className="text-[11px] font-semibold text-muted-foreground px-1 pt-1">
            {isAr ? "الدفعات المتوفرة بالمستودع:" : "Available Batches in Warehouse:"}
          </div>

          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {isAr ? "جاري تحميل الدفعات..." : "Loading batches..."}
            </div>
          ) : batches.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground border border-dashed rounded-xl p-4">
              <AlertCircle className="size-5 mx-auto mb-1 text-muted-foreground/60" />
              {isAr
                ? "لا توجد دفعات مسجلة برصيد متاح في هذا المستودع."
                : "No available batches found in this warehouse."}
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pe-1">
              {batches.map((b) => {
                const isExpired = Boolean(b.expiry_date && b.expiry_date.slice(0, 10) <= todayStr);
                const isDisabled = isExpired && settings.prevent_selling_expired;
                const isSelected = selectedId === b.id;

                return (
                  <button
                    key={b.id}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => setSelectedId(b.id)}
                    className={`w-full text-start p-3 rounded-xl border transition flex items-center justify-between ${
                      isDisabled
                        ? "opacity-50 cursor-not-allowed bg-rose-500/5 border-rose-500/20"
                        : isSelected
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-border/80 bg-surface hover:border-border"
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground">
                          {b.batch_number}
                        </span>
                        {isExpired ? (
                          <Badge variant="destructive" className="text-[9px] py-0">
                            {isAr ? "منتهي" : "Expired"}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 border-emerald-500/30 text-emerald-500"
                          >
                            {isAr ? "صالح" : "Valid"}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>
                          {isAr ? "الرصيد: " : "Stock: "}
                          <span className="font-mono font-semibold text-foreground">
                            {b.quantity}
                          </span>
                        </span>
                        <span>
                          {isAr ? "الانتهاء: " : "Exp: "}
                          <span className="font-mono">{b.expiry_date ?? "—"}</span>
                        </span>
                      </div>
                    </div>

                    {isSelected && <Check className="size-4 text-primary shrink-0 ms-2" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-border/80 bg-muted/20 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={manualSelectionRequired && !selectedId}
            className="text-xs px-4 font-bold"
          >
            {isAr ? "تأكيد الاختيار" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
