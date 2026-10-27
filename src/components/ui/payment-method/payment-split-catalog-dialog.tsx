import { useEffect, useMemo, useState } from "react";
import { Plus, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SplitPaymentEditor, type SplitPaymentEditorLine } from "@/components/payments/split-payment-editor";
import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import { useI18n } from "@/lib/i18n";
import type { PaymentContext } from "@/lib/payments/payment-methods";
import { Button } from "@/components/ui/button";

export interface PaymentSplitTender {
  method: string;
  amount: number;
  payment_method_id: string;
  reference?: string;
}

interface PaymentSplitCatalogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  context: PaymentContext;
  initialLines?: SplitPaymentEditorLine[];
  onConfirm: (lines: PaymentSplitTender[]) => void;
}

/** Split editor that keeps the tenant's configured method IDs and reference rules. */
export function PaymentSplitCatalogDialog({
  open,
  onOpenChange,
  total,
  context,
  initialLines,
  onConfirm,
}: PaymentSplitCatalogDialogProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { methods } = usePaymentMethodsForContext(context, { includeCredit: false });
  const tenderMethods = useMemo(
    () => methods.filter((method) => ["cash", "bank_transfer", "mobile_money"].includes(method.legacyValue)),
    [methods],
  );
  const editorMethods = useMemo(
    () => tenderMethods.map((method) => ({
      id: method.id,
      nameAr: method.nameAr,
      nameEn: method.nameEn,
      legacyValue: method.legacyValue,
      requiresReference: method.requiresReference,
    })),
    [tenderMethods],
  );
  const [lines, setLines] = useState<SplitPaymentEditorLine[]>([]);

  useEffect(() => {
    if (!open) return;
    const validInitial = (initialLines ?? []).filter((line) => tenderMethods.some((method) => method.id === line.methodId));
    const firstMethod = tenderMethods.find((method) => method.legacyValue === "cash") ?? tenderMethods[0];
    setLines(validInitial.length ? validInitial : firstMethod ? [{ key: crypto.randomUUID(), methodId: firstMethod.id, amount: String(total) }] : []);
  }, [open, initialLines, tenderMethods, total]);

  const paid = lines.reduce((sum, line) => sum + Math.max(0, Number(line.amount) || 0), 0);
  const invalid = lines.length === 0 || lines.some((line) => {
    const method = tenderMethods.find((candidate) => candidate.id === line.methodId);
    return !method || Number(line.amount) <= 0 || (method.requiresReference && !line.reference?.trim());
  });
  const canConfirm = !invalid && paid <= total && paid > 0;

  const addLine = () => {
    const used = new Set(lines.map((line) => tenderMethods.find((method) => method.id === line.methodId)?.legacyValue));
    const next = tenderMethods.find((method) => !used.has(method.legacyValue));
    if (next) setLines((current) => [...current, { key: crypto.randomUUID(), methodId: next.id, amount: "" }]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" dir={isAr ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4 text-primary" />
            {isAr ? "توزيع الدفع على طرق المنشأة" : "Split across configured methods"}
          </DialogTitle>
        </DialogHeader>
        <SplitPaymentEditor
          total={total}
          lines={lines}
          methods={editorMethods}
          onChange={setLines}
          lang={isAr ? "ar" : "en"}
        />
        <button
          type="button"
          onClick={addLine}
          disabled={lines.length >= tenderMethods.length}
          className="inline-flex min-h-9 items-center gap-2 self-start rounded-lg border border-border px-3 text-xs font-semibold text-foreground disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          {isAr ? "إضافة طريقة" : "Add method"}
        </button>
        <p className="text-[11px] text-muted-foreground">
          {isAr ? "المبلغ غير الموزع يُسجل كرصيد مستحق على العميل." : "Any unallocated balance remains due from the customer."}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              onConfirm(lines.map((line) => {
                const method = tenderMethods.find((candidate) => candidate.id === line.methodId)!;
                return { method: method.legacyValue, amount: Math.round(Number(line.amount) * 100) / 100, payment_method_id: method.id, reference: line.reference?.trim() || undefined };
              }));
              onOpenChange(false);
            }}
          >
            {isAr ? "اعتماد التوزيع" : "Apply split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
