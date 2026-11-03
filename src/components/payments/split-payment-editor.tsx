import { Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { AmountInput } from "@/components/ui/amount-input";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";

export interface SplitPaymentMethodOption {
  id: string;
  nameAr: string;
  nameEn?: string | null;
  legacyValue: string;
  requiresReference?: boolean;
}

export interface SplitPaymentEditorLine {
  key: string;
  methodId: string;
  amount: string;
  reference?: string;
  autoAmount?: boolean;
}

interface SplitPaymentEditorProps {
  total: number;
  lines: SplitPaymentEditorLine[];
  methods: SplitPaymentMethodOption[];
  onChange: (lines: SplitPaymentEditorLine[]) => void;
  lang?: "ar" | "en";
  disabled?: boolean;
  className?: string;
}

export function SplitPaymentEditor({
  total,
  lines,
  methods,
  onChange,
  lang = "ar",
  disabled,
  className,
}: SplitPaymentEditorProps) {
  const isAr = lang === "ar";
  const rows = lines.map((line) => ({
    ...line,
    method: methods.find((method) => method.id === line.methodId),
    amountNumber: Math.max(0, Number(line.amount) || 0),
  }));
  const paid = Math.round(rows.reduce((sum, row) => sum + row.amountNumber, 0) * 100) / 100;
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);
  const overpaid = paid > total;
  const invalid = rows.some(
    (row) =>
      !row.method ||
      row.amountNumber <= 0 ||
      (row.method.requiresReference && !row.reference?.trim()),
  );
  const used = new Set(rows.map((row) => row.method?.legacyValue).filter(Boolean));

  const update = (key: string, patch: Partial<SplitPaymentEditorLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const add = () => {
    const method = methods.find((candidate) => !used.has(candidate.legacyValue));
    if (!method) return;
    onChange([...lines, { key: crypto.randomUUID(), methodId: method.id, amount: "" }]);
  };

  return (
    <section
      className={cn(
        "space-y-3 rounded-2xl border border-primary/20 bg-primary/[0.03] p-3",
        className,
      )}
      dir={isAr ? "rtl" : "ltr"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">
            {isAr ? "توزيع ذكي للدفعة" : "Smart split payment"}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {isAr
              ? "أضف أي عدد من طرق الدفع، وسيتم احتساب المتبقي تلقائياً."
              : "Add multiple tenders and the balance is calculated automatically."}
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">
          {rows.length} {isAr ? "طرق" : "tenders"}
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => {
          const choices = methods.filter(
            (method) => method.id === row.methodId || !used.has(method.legacyValue),
          );
          return (
            <div
              key={row.key}
              className="grid gap-2 rounded-xl border border-border/70 bg-card p-2 sm:grid-cols-[minmax(0,1fr)_8rem_2.5rem]"
            >
              <select
                value={row.methodId}
                disabled={disabled}
                onChange={(event) =>
                  update(row.key, { methodId: event.target.value, reference: "" })
                }
                aria-label={isAr ? "طريقة الدفع" : "Payment method"}
                className="h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-xs font-semibold outline-none focus:border-primary"
              >
                {choices.map((method) => (
                  <option key={method.id} value={method.id}>
                    {isAr ? method.nameAr : method.nameEn || method.nameAr}
                  </option>
                ))}
              </select>
              <AmountInput
                aria-label={isAr ? "المبلغ" : "Amount"}
                value={row.amount === "" ? null : Number(row.amount)}
                onValueChange={(amount) =>
                  update(row.key, {
                    amount: amount == null ? "" : String(amount),
                    autoAmount: false,
                  })
                }
                invalid={overpaid}
                placeholder="0.00"
                className="h-10 rounded-lg"
              />
              <button
                type="button"
                disabled={disabled || rows.length <= 1}
                onClick={() => onChange(lines.filter((line) => line.key !== row.key))}
                className="grid h-10 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                aria-label={isAr ? "حذف طريقة الدفع" : "Remove tender"}
              >
                <Trash2 className="size-4" />
              </button>
              {row.method?.requiresReference && (
                <input
                  value={row.reference ?? ""}
                  disabled={disabled}
                  onChange={(event) => update(row.key, { reference: event.target.value })}
                  placeholder={isAr ? "رقم المرجع / العملية" : "Reference number"}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary sm:col-span-3"
                />
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        disabled={disabled || used.size >= methods.length}
        onClick={add}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-background px-3 text-xs font-bold text-primary hover:bg-primary/5 disabled:opacity-40"
      >
        <Plus className="size-4" />
        {isAr ? "إضافة طريقة دفع" : "Add tender"}
      </button>
      <div className="grid gap-2 rounded-xl border border-border/70 bg-card p-3 text-xs sm:grid-cols-3">
        <Summary label={isAr ? "الإجمالي" : "Total"} value={total} />
        <Summary label={isAr ? "المدفوع" : "Paid"} value={paid} />
        <Summary
          label={isAr ? "المتبقي" : "Remaining"}
          value={remaining}
          tone={remaining ? "warning" : "success"}
        />
      </div>
      {overpaid && (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-[11px] font-bold text-destructive"
        >
          <AlertCircle className="size-4" />
          {isAr ? "مجموع الدفعات يتجاوز الإجمالي." : "Payment total exceeds the total."}
        </p>
      )}
      {!overpaid && !invalid && remaining === 0 && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
          <CheckCircle2 className="size-4" />
          {isAr ? "التوزيع متوازن ومتحقق." : "Split is balanced and valid."}
        </p>
      )}
    </section>
  );
}

function Summary({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "success";
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono font-bold",
          tone === "warning" && "text-amber-600",
          tone === "success" && "text-emerald-600",
        )}
      >
        {money(value)}
      </span>
    </div>
  );
}
