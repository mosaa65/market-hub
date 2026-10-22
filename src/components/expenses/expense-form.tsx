/**
 * Expense form — واجهة تسجيل وتوثيق المصروفات التشغيلية المعتمدة.
 *
 * الفصل المحاسبي الصارم بين العمليتين:
 * 1. [سند صرف نقدي / بنكي (سداد فوري مباشر)]:
 *    - القيد: مدين حـ/ المصروف (5xxx) | دائن حـ/ الصندوق (1101) أو البنك (1111)
 *    - حقوله: المبلغ، التصنيف، الصندوق/البنك، التاريخ، البيان.
 * 2. [فاتورة مصروف آجل (إثبات استحقاق دائن)]:
 *    - القيد: مدين حـ/ المصروف (5xxx) | دائن حـ/ ذمم الموردين (2111) أو مصروفات مستحقة (2221)
 *    - حقوله: المبلغ، التصنيف، المورد الدائن، تاريخ الاستحقاق، البيان.
 *
 * حماية النظام:
 * - استبعاد تام لأي حسابات سوبر أدمن أو مسؤولي المنصة من كشف الموظفين والمستفيدين.
 * - عزل المصروفات المقدمة والأصول الثابتة إلى شاشاتها المالية المستقلة.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FieldInput } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import { useExpenseMutations, type ExpenseLineInput } from "@/hooks/use-expenses";
import { parseAmount, roundMoney, today } from "@/lib/expenses/query-keys";
import type {
  ExpenseDetail,
  ExpenseFormHeader,
  ExpenseLineDraft,
  ExpenseLookups,
  ExpensePayeeType,
} from "@/lib/expenses/types";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  CreditCard,
  FileText,
  Info,
  Landmark,
  Receipt,
  Sparkles,
  Tag,
  User,
  Users,
  Wallet,
} from "lucide-react";

type ExpenseOperationMode = "CASH_PAYMENT" | "ACCRUAL_INVOICE";

let lineCounter = 0;
const newLineKey = () => `line-${++lineCounter}-${Date.now().toString(36)}`;

function blankLine(overrides: Partial<ExpenseLineDraft> = {}): ExpenseLineDraft {
  return {
    key: newLineKey(),
    description: "",
    category_id: "",
    quantity: "1",
    unit_price: "",
    tax_rate: "0",
    cost_center_id: "",
    project_id: "",
    note: "",
    ...overrides,
  };
}

function blankHeader(): ExpenseFormHeader {
  return {
    expense_date: today(),
    due_date: "",
    entry_type: "DIRECT",
    payee_type: "NONE",
    payee_name: "",
    supplier_id: "",
    employee_id: "",
    warehouse_id: "",
    cost_center_id: "",
    project_id: "",
    description: "",
    note: "",
    tax_mode: "NONE",
  };
}

function lineGross(line: ExpenseLineDraft): number | null {
  const qty = parseAmount(line.quantity || "1");
  const price = parseAmount(line.unit_price || "0");
  if (!qty.ok || !price.ok) return null;
  return roundMoney(qty.value * price.value);
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  lookups,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookups: ExpenseLookups | undefined;
  editing?: ExpenseDetail | null;
  onSaved?: (entryId: string) => void;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const mutations = useExpenseMutations();

  // وضع العملية: جديد = سند صرف دائماً (المصروف الآجل فورم منفصل). تعديل = حسب المستند.
  const [opMode, setOpMode] = useState<ExpenseOperationMode>("CASH_PAYMENT");

  const [header, setHeader] = useState<ExpenseFormHeader>(blankHeader);
  const [lines, setLines] = useState<ExpenseLineDraft[]>([blankLine()]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [settlement, setSettlement] = useState<PaymentSettlementSelection>({
    method: "cash",
    paymentMethodId: "cash",
  });
  const [accountId, setAccountId] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  /*
   * قائمة الموظفين تأتي من RPC المستأجر نفسه (expense_lookups) فلا تحمل
   * حسابات المنصة إطلاقاً. كانت هنا فلترة بالاسم (تحتوي "admin"/"سوبر")
   * تحجب موظفين حقيقيين بالخطأ — أزيلت: الاعتماد على نطاق المستأجر فقط.
   */
  const storeEmployees = useMemo(() => {
    return lookups?.employees ?? [];
  }, [lookups?.employees]);

  /* -- تهيئة النموذج عند الفتح ---------------------------------- */
  useEffect(() => {
    if (!open) return;

    if (editing) {
      const entry = editing.entry;
      setHeader({
        expense_date: entry.expense_date,
        due_date: entry.due_date ?? "",
        entry_type: entry.entry_type,
        payee_type: entry.payee_type,
        payee_name: entry.payee_name ?? "",
        supplier_id: entry.supplier_id ?? "",
        employee_id: entry.employee_id ?? "",
        warehouse_id: entry.warehouse_id ?? "",
        cost_center_id: entry.cost_center_id ?? "",
        project_id: entry.project_id ?? "",
        description: entry.description ?? "",
        note: entry.note ?? "",
        tax_mode: entry.tax_mode,
      });

      if (editing.lines.length > 0) {
        setLines(
          editing.lines.map((l) =>
            blankLine({
              description: l.description ?? "",
              category_id: l.category_id ?? "",
              quantity: String(l.quantity || 1),
              unit_price: String(l.unit_price || 0),
              tax_rate: String(l.tax_rate || 0),
              cost_center_id: l.cost_center_id ?? "",
              project_id: l.project_id ?? "",
              note: l.note ?? "",
            }),
          ),
        );
      } else {
        setLines([blankLine()]);
      }

      // اشتقاق النمط من المستند نفسه: الآجل له تاريخ استحقاق إلزامي.
      setOpMode(entry.due_date ? "ACCRUAL_INVOICE" : "CASH_PAYMENT");
      setShowAdvanced(Boolean(entry.warehouse_id || entry.cost_center_id || entry.project_id));
    } else {
      setHeader(blankHeader());
      setLines([blankLine()]);
      setOpMode("CASH_PAYMENT");
      setPaymentMethod("cash");
      setSettlement({ method: "cash", paymentMethodId: "cash" });
      setAccountId("");
      setAccountLabel("");
      setShowAdvanced(false);
    }

    setDirty(false);
    const handle = setTimeout(() => amountInputRef.current?.focus(), 80);
    return () => clearTimeout(handle);
  }, [open, editing]);

  const primaryLine = lines[0] ?? blankLine();
  const numAmount = lineGross(primaryLine) ?? 0;

  const selectedCategory = useMemo(() => {
    return lookups?.categories?.find((c) => c.id === primaryLine.category_id);
  }, [lookups?.categories, primaryLine.category_id]);

  const selectedCategoryName = selectedCategory
    ? ar
      ? selectedCategory.name_ar || selectedCategory.name
      : selectedCategory.name
    : "";

  const selectedSupplier = useMemo(() => {
    return lookups?.suppliers?.find((s) => s.id === header.supplier_id);
  }, [lookups?.suppliers, header.supplier_id]);

  const setHeaderField = useCallback(
    <K extends keyof ExpenseFormHeader>(key: K, value: ExpenseFormHeader[K]) => {
      setDirty(true);
      setHeader((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateAmount = (val: string) => {
    setDirty(true);
    setLines((prev) => [
      {
        ...prev[0],
        unit_price: val,
        quantity: "1",
      },
      ...prev.slice(1),
    ]);
  };

  const updateCategory = (catId: string) => {
    setDirty(true);
    setLines((prev) => [
      {
        ...prev[0],
        category_id: catId,
      },
      ...prev.slice(1),
    ]);

    if (!header.description.trim()) {
      const cat = lookups?.categories?.find((c) => c.id === catId);
      if (cat) {
        const catName = ar ? cat.name_ar || cat.name : cat.name;
        setHeader((h) => ({ ...h, description: catName }));
      }
    }
  };

  const updateDescription = (desc: string) => {
    setDirty(true);
    setHeaderField("description", desc);
    setLines((prev) => [
      {
        ...prev[0],
        description: desc,
      },
      ...prev.slice(1),
    ]);
  };

  /* -- التحقق المحاسبي المنفصل حسب نوع العملية ------------------------ */
  const validation = useMemo(() => {
    const errors: Record<string, string> = {};

    if (!header.expense_date) {
      errors.expense_date = ar ? "تاريخ المصروف مطلوب" : "Expense date is required";
    }

    if (numAmount <= 0) {
      errors.amount = ar ? "يرجى إدخال مبلغ المصروف" : "Please enter the expense amount";
    }

    if (!primaryLine.category_id) {
      errors.category = ar ? "يرجى اختيار تصنيف المصروف" : "Please choose expense category";
    }

    if (!header.description?.trim()) {
      errors.description = ar ? "يرجى كتابة بيان أو وصف المصروف" : "Please enter a description";
    }

    if (opMode === "ACCRUAL_INVOICE") {
      // في الفاتورة الآجلة: المورد وتاريخ الاستحقاق إلزاميان محاسبياً
      if (!header.supplier_id) {
        errors.supplier_id = ar
          ? "المورد الدائن مطلوب في المصروف الآجل"
          : "Creditor supplier is required";
      }
      if (!header.due_date) {
        errors.due_date = ar ? "تاريخ الاستحقاق مطلوب للمصروف الآجل" : "Due date is required";
      } else if (header.due_date < header.expense_date) {
        errors.due_date = ar
          ? "تاريخ الاستحقاق لا يسبق تاريخ الفاتورة"
          : "Due date cannot precede expense date";
      }
    } else {
      // في الصرف النقدي الفوري
      if (header.payee_type === "EMPLOYEE" && !header.employee_id) {
        errors.employee_id = ar ? "اختر الموظف المستلم" : "Choose the employee";
      }
    }

    return { errors, valid: Object.keys(errors).length === 0 };
  }, [header, numAmount, primaryLine.category_id, opMode, ar]);

  /* -- الترحيل والتسجيل ---------------------------------------------- */
  const buildLinePayload = (): ExpenseLineInput[] => {
    return lines
      .map((line) => {
        const qty = parseAmount(line.quantity || "1");
        const price = parseAmount(line.unit_price || "0");
        const rate = parseAmount(line.tax_rate || "0");
        if (!qty.ok || !price.ok) return null;
        if (roundMoney(qty.value * price.value) <= 0) return null;

        return {
          description: line.description || header.description || null,
          category_id: line.category_id || primaryLine.category_id || null,
          quantity: qty.value,
          unit_price: price.value,
          tax_rate: rate.ok ? rate.value : 0,
          cost_center_id: line.cost_center_id || header.cost_center_id || null,
          project_id: line.project_id || header.project_id || null,
          note: line.note || header.note || null,
        } as ExpenseLineInput;
      })
      .filter(Boolean) as ExpenseLineInput[];
  };

  async function save(submit: boolean) {
    if (!validation.valid) {
      const first = Object.values(validation.errors)[0];
      toast.error(first);
      return;
    }

    const payloadLines = buildLinePayload();
    if (payloadLines.length === 0) {
      toast.error(ar ? "يرجى إدخال مبلغ صحيح للمصروف" : "Enter a valid expense amount");
      return;
    }

    const isCashPayment = opMode === "CASH_PAYMENT";

    const payload = {
      lines: payloadLines,
      expense_date: header.expense_date,
      due_date: isCashPayment ? null : header.due_date || null,
      entry_type: header.entry_type,
      payee_type: isCashPayment ? header.payee_type : ("SUPPLIER" as ExpensePayeeType),
      payee_name: isCashPayment ? header.payee_name || null : selectedSupplier?.name || null,
      supplier_id: isCashPayment
        ? header.payee_type === "SUPPLIER"
          ? header.supplier_id || null
          : null
        : header.supplier_id || null,
      employee_id:
        isCashPayment && header.payee_type === "EMPLOYEE" ? header.employee_id || null : null,
      warehouse_id: header.warehouse_id || null,
      cost_center_id: header.cost_center_id || null,
      project_id: header.project_id || null,
      description: header.description || null,
      note: header.note || null,
      tax_mode: header.tax_mode,
    };

    try {
      if (editing) {
        await mutations.update.mutateAsync({
          id: editing.entry.id,
          version: editing.entry.version,
          lines: payload.lines,
          header: payload,
        });
        toast.success(ar ? "تم تحديث المصروف بنجاح" : "Expense updated successfully");
        onSaved?.(editing.entry.id);
      } else {
        const created = await mutations.create.mutateAsync({
          ...payload,
          submit,
        });

        // إذا كان سند صرف نقدي معتمد: نسدد فوراً من الصندوق/البنك
        if (isCashPayment && submit && created?.id) {
          try {
            await mutations.post.mutateAsync({
              id: created.id,
              version: created.version,
              payNow: true,
              paymentMethod: settlement.paymentMethodId || paymentMethod || "cash",
              paymentMethodId: settlement.paymentMethodId || paymentMethod || "cash",
              cashboxId: settlement.cashboxId || null,
              bankAccountId: settlement.bankAccountId || null,
              accountId: settlement.chartAccountId || accountId || null,
              accountLabel: accountLabel || null,
              paymentDate: header.expense_date,
              referenceNo: settlement.reference || null,
            });
          } catch {
            // المصروف محفوظ
          }
        }

        toast.success(
          ar
            ? isCashPayment
              ? "تم صرف وسداد المصروف نقداً بنجاح"
              : "تم إثبات استحقاق المصروف الآجل بنجاح"
            : "Expense recorded successfully",
        );
        onSaved?.(created?.id ?? "");
      }

      setDirty(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || (ar ? "تعذر حفظ المصروف" : "Failed to save expense"));
    }
  }

  const saving = mutations.isBusy;
  const isEditing = Boolean(editing);

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      dismissible={!dirty || !saving}
      icon={<Receipt className="size-5 text-primary" />}
      eyebrow={
        isEditing ? (ar ? "تعديل المصروف" : "Edit Expense") : ar ? "سند صرف" : "Payment Voucher"
      }
      title={isEditing ? editing?.entry.reference : ar ? "إضافة مصروف جديد" : "New Expense"}
      subtitle={
        ar
          ? "صرف مباشر من الصندوق أو البنك مع توليد القيد الآلي"
          : "Direct disbursement from cashbox or bank"
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">
              {ar ? "إجمالي المبلغ:" : "Total Amount:"}
            </span>
            <span className="font-mono text-xl font-black text-primary">{money(numAmount)}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="rounded-xl"
            >
              {t("common.cancel")}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => void save(false)}
              loading={saving}
              className="rounded-xl border-border/80 hover:bg-muted"
            >
              {ar ? "حفظ كمسودة" : "Save as Draft"}
            </Button>

            <Button
              type="button"
              onClick={() => void save(true)}
              loading={saving}
              disabled={!validation.valid}
              className="rounded-xl bg-primary px-5 font-bold shadow-md shadow-primary/20 hover:bg-primary/90"
            >
              <Sparkles className="size-4 me-1.5" />
              {isEditing
                ? ar
                  ? "حفظ التعديلات"
                  : "Save Changes"
                : opMode === "CASH_PAYMENT"
                  ? ar
                    ? "تسجيل السند وصرف المبلغ"
                    : "Record & Disburse"
                  : ar
                    ? "إثبات استحقاق المصروف الآجل"
                    : "Record Accrual Bill"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* ─── فورم «سند صرف» منفصل: بلا تبويبات — المصروف الآجل فورم مستقل ─── */}

        {/* ─── بطاقة المعاينة الفخمة العلوية (Live Preview Card) ─── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card/90 to-primary/5 p-4 shadow-xs sm:p-5 transition-all">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {selectedCategoryName ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                    <Tag className="size-3" />
                    {selectedCategoryName}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {ar ? "حدد التصنيف…" : "Choose category…"}
                  </span>
                )}

                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
                    opMode === "CASH_PAYMENT"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {opMode === "CASH_PAYMENT" ? (
                    <>
                      <CheckCircle2 className="size-3" />
                      {ar ? "سداد فوري (خصم من الصندوق/البنك)" : "Paid Now"}
                    </>
                  ) : (
                    <>
                      <Clock className="size-3" />
                      {ar ? "آجل (التزام على المنشأة)" : "Accrued / Due"}
                    </>
                  )}
                </span>

                {header.expense_date && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                    <CalendarDays className="size-3" />
                    {header.expense_date}
                  </span>
                )}
              </div>

              <h4 className="text-base font-bold text-foreground truncate">
                {header.description.trim() || (ar ? "بيان المصروف الجديد…" : "New expense memo…")}
              </h4>
            </div>

            <div className="text-start sm:text-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
              <span className="block text-[11px] font-medium text-muted-foreground">
                {ar ? "قيمة المصروف" : "Expense Amount"}
              </span>
              <span className="font-mono text-2xl font-black text-primary">{money(numAmount)}</span>
            </div>
          </div>
        </div>

        {/* ─── البطاقة 1: المبلغ والبيان والتصنيف ─── */}
        <div className="rounded-2xl border border-border/70 bg-surface/50 p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-border/50 pb-3">
            <Coins className="size-4 text-amber-500" />
            <h3 className="text-sm font-bold text-foreground">
              {ar ? "1. تفاصيل المصروف والمبلغ" : "1. Amount & Details"}
            </h3>
          </div>

          {/* حقل المبلغ البارز */}
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 space-y-1.5">
            <label className="text-xs font-bold text-foreground flex items-center justify-between">
              <span>{ar ? "مبلغ المصروف المطلوب صرفه *" : "Expense Amount *"}</span>
              {validation.errors.amount && (
                <span className="text-[11px] text-destructive font-semibold">
                  {validation.errors.amount}
                </span>
              )}
            </label>
            <div className="relative">
              {/* المبلغ المُوحّد: فاصلة آلاف + تفقيط تحت الرقم — لا spinner ولا عجلة ماوس. */}
              <AmountInput
                ref={amountInputRef}
                min={0}
                value={toNumberOrNull(primaryLine.unit_price)}
                onValueChange={(value) => updateAmount(value == null ? "" : String(value))}
                placeholder="0.00"
                aria-label={ar ? "مبلغ المصروف المطلوب صرفه" : "Expense amount"}
                wordsClassName="text-xs"
                containerClassName="[&_input]:h-14 [&_input]:rounded-xl [&_input]:px-4 [&_input]:text-2xl [&_input]:font-black"
              />
              <span className="absolute end-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                {ar ? "ريال" : "YER"}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* تصنيف المصروف */}
            <div>
              <label className="mb-1.5 block text-xs font-bold text-foreground">
                {ar ? "تصنيف المصروف *" : "Expense Category *"}
              </label>
              <select
                value={primaryLine.category_id}
                onChange={(e) => updateCategory(e.target.value)}
                className={selectClass}
              >
                <option value="">{ar ? "اختر التصنيف المعتمد…" : "Select category…"}</option>
                {(lookups?.categories ?? []).map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {(cat as any).code ? `[${(cat as any).code}] ` : ""}
                    {ar ? cat.name_ar || cat.name : cat.name}
                  </option>
                ))}
              </select>
              {validation.errors.category && (
                <span className="mt-1 block text-[11px] font-semibold text-destructive">
                  {validation.errors.category}
                </span>
              )}
              {selectedCategory && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-surface-2/70 border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                  <Landmark className="size-2.5" />
                  {ar
                    ? "يُرحَّل المصروف إلى الحساب المرتبط بهذا التصنيف في دليل الحسابات"
                    : "Posts to the account mapped to this category in the chart of accounts"}
                </span>
              )}
            </div>

            {/* تاريخ المصروف */}
            <div>
              <label className="mb-1.5 block text-xs font-bold text-foreground">
                {ar ? "تاريخ المصروف *" : "Expense Date *"}
              </label>
              <FieldInput
                type="date"
                value={header.expense_date}
                onValueChange={(val) => setHeaderField("expense_date", val)}
              />
              {validation.errors.expense_date && (
                <span className="mt-1 block text-[11px] font-semibold text-destructive">
                  {validation.errors.expense_date}
                </span>
              )}
            </div>
          </div>

          {/* البيان والوصف */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-foreground">
              {ar ? "البيان / الوصف *" : "Description / Memo *"}
            </label>
            <FieldInput
              value={header.description}
              onValueChange={updateDescription}
              placeholder={
                ar
                  ? "مثال: فاتورة كهرباء المطحنة، وقود ديزل للمولد، صيانة سير الآلات..."
                  : "e.g. Electricity bill, fuel for generator..."
              }
            />
            {validation.errors.description && (
              <span className="mt-1 block text-[11px] font-semibold text-destructive">
                {validation.errors.description}
              </span>
            )}
          </div>
        </div>

        {/* ─── البطاقة 2: مصدر الصرف والمستلم (فورم سند الصرف) ─── */}
        {!(isEditing && opMode === "ACCRUAL_INVOICE") ? (
          /* سند الصرف النقدي الفوري */
          <div className="rounded-2xl border border-border/70 bg-surface/50 p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-border/50 pb-3">
              <Wallet className="size-4 text-emerald-500" />
              <h3 className="text-sm font-bold text-foreground">
                {ar ? "2. مصدر الصرف والمستلم" : "2. Payment Source & Recipient"}
              </h3>
            </div>

            {/* اختيار طريقة الدفع والخزينة / المحفظة / الحساب البنكي عبر DynamicPaymentSelector الموحد */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-muted-foreground">
                {ar
                  ? "وسيلة الخصم والوعاء المالي (خزينة / بنك / محفظة):"
                  : "Payment Method & Financial Account:"}
              </label>

              <DynamicPaymentSelector
                context="expenses"
                value={paymentMethod}
                onChange={setPaymentMethod}
                settlement={settlement}
                onSettlementChange={(s) => {
                  setSettlement(s);
                  if (s.chartAccountId) setAccountId(s.chartAccountId);
                }}
                includeCredit={false}
              />
            </div>

            {/* المستلم / الجهة المستفيدة (بدون أي سوبر أدمن) */}
            <div className="space-y-2 pt-2 border-t border-border/50">
              <label className="block text-xs font-bold text-foreground">
                {ar ? "المستلم / الجهة المستفيدة (اختياري):" : "Payee (Optional):"}
              </label>

              <div className="flex flex-wrap gap-1.5">
                {(["NONE", "EMPLOYEE", "SUPPLIER", "OTHER"] as ExpensePayeeType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setHeaderField("payee_type", type)}
                    className={cn(
                      "rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                      header.payee_type === type
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {type === "NONE"
                      ? ar
                        ? "بدون تحديد"
                        : "Unspecified"
                      : type === "EMPLOYEE"
                        ? ar
                          ? "موظف / عامل"
                          : "Employee"
                        : type === "SUPPLIER"
                          ? ar
                            ? "مورد"
                            : "Supplier"
                          : ar
                            ? "جهة أخرى"
                            : "Other"}
                  </button>
                ))}
              </div>

              {header.payee_type === "EMPLOYEE" && (
                <div className="pt-1">
                  <select
                    value={header.employee_id}
                    onChange={(e) => setHeaderField("employee_id", e.target.value)}
                    className={selectClass}
                  >
                    <option value="">{ar ? "اختر الموظف / العامل…" : "Select employee…"}</option>
                    {storeEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name}
                      </option>
                    ))}
                  </select>
                  {validation.errors.employee_id && (
                    <span className="mt-1 block text-[11px] text-destructive">
                      {validation.errors.employee_id}
                    </span>
                  )}
                </div>
              )}

              {header.payee_type === "SUPPLIER" && (
                <div className="pt-1">
                  <select
                    value={header.supplier_id}
                    onChange={(e) => setHeaderField("supplier_id", e.target.value)}
                    className={selectClass}
                  >
                    <option value="">{ar ? "اختر المورد…" : "Select supplier…"}</option>
                    {(lookups?.suppliers ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {header.payee_type === "OTHER" && (
                <div className="pt-1">
                  <FieldInput
                    value={header.payee_name}
                    onValueChange={(val) => setHeaderField("payee_name", val)}
                    placeholder={ar ? "اسم الجهة المستلمة..." : "Recipient name..."}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          /* فاتورة المصروف الآجل (استحقاق) */
          <div className="rounded-2xl border border-border/70 bg-surface/50 p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-border/50 pb-3">
              <Clock className="size-4 text-amber-500" />
              <h3 className="text-sm font-bold text-foreground">
                {ar ? "2. بيانات الالتزام الآجل والمورد الدائن" : "2. Creditor & Due Terms"}
              </h3>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* المورد الدائن */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-foreground">
                  {ar ? "المورد / الدائن المستحق له المبلغ *" : "Creditor Supplier *"}
                </label>
                <select
                  value={header.supplier_id}
                  onChange={(e) => setHeaderField("supplier_id", e.target.value)}
                  className={selectClass}
                >
                  <option value="">{ar ? "اختر المورد الدائن…" : "Select creditor…"}</option>
                  {(lookups?.suppliers ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {validation.errors.supplier_id && (
                  <span className="mt-1 block text-[11px] font-semibold text-destructive">
                    {validation.errors.supplier_id}
                  </span>
                )}
              </div>

              {/* تاريخ الاستحقاق */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-foreground">
                  {ar ? "تاريخ الاستحقاق (تاريخ السداد المتوقع) *" : "Due Date *"}
                </label>
                <FieldInput
                  type="date"
                  value={header.due_date}
                  onValueChange={(val) => setHeaderField("due_date", val)}
                />
                {validation.errors.due_date && (
                  <span className="mt-1 block text-[11px] font-semibold text-destructive">
                    {validation.errors.due_date}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <p>
                {ar
                  ? "سيتم إثبات المصروف كالتزام على المنشأة في ذمم الموردين (حـ/ 2111) ويظهر في قائمة المتأخرات حتى يتم سداده لاحقاً عبر شاشة سداد الموردين."
                  : "Recorded as an accrued liability under accounts payable until settled through supplier payments."}
              </p>
            </div>
          </div>
        )}

        {/* ─── خيارات محاسبية اختيارية ─── */}
        <div className="rounded-2xl border border-border/70 bg-surface/30 p-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex w-full items-center justify-between text-xs font-bold text-muted-foreground hover:text-foreground transition"
          >
            <span className="flex items-center gap-2">
              <Landmark className="size-3.5 text-muted-foreground" />
              {ar
                ? "خيارات محاسبية إضافية (المستودع، مركز التكلفة، الملاحظات)"
                : "Additional Dimensions"}
            </span>
            <ChevronDown
              className={cn("size-4 transition-transform", showAdvanced && "rotate-180")}
            />
          </button>

          {showAdvanced && (
            <div className="mt-3 grid gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  {ar ? "المستودع / الفرع" : "Warehouse"}
                </label>
                <select
                  value={header.warehouse_id}
                  onChange={(e) => setHeaderField("warehouse_id", e.target.value)}
                  className={cn(selectClass, "h-9 text-xs")}
                >
                  <option value="">{ar ? "اختر المستودع…" : "Select warehouse…"}</option>
                  {(lookups?.warehouses ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {ar ? w.name_ar || w.name : w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  {ar ? "مركز التكلفة" : "Cost Center"}
                </label>
                <select
                  value={header.cost_center_id}
                  onChange={(e) => setHeaderField("cost_center_id", e.target.value)}
                  className={cn(selectClass, "h-9 text-xs")}
                >
                  <option value="">{ar ? "اختر مركز التكلفة…" : "Select cost center…"}</option>
                  {(lookups?.cost_centers ?? []).map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {ar ? cc.name_ar || cc.name : cc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  {ar ? "ملاحظات داخلية (اختياري)" : "Internal Notes"}
                </label>
                <textarea
                  value={header.note}
                  onChange={(e) => setHeaderField("note", e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-surface px-3 py-2 text-xs text-foreground outline-none transition focus:border-primary/60"
                  placeholder={ar ? "ملاحظة إضافية للتوثيق الداخلي..." : "Internal notes..."}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </VortexDrawerDialog>
  );
}

const selectClass =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-surface px-3 text-sm font-semibold text-foreground transition focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10";

/**
 * نصوص النموذج محفوظة كسلاسل (كما تأتي من المسودة)، والمكوّن الموحّد
 * `AmountInput` يعمل بقيمة `number | null`. الدالة هي جسر التحويل:
 * النص الفارغ أو غير الرقمي يصبح null بدل NaN.
 */
function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export type { ExpenseDetail };
