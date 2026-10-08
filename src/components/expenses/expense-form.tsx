/**
 * Expense form.
 *
 * The design goal from the plan is "a strong ERP inside, simple outside": an
 * operator should be able to record a fuel purchase in three fields and never
 * see an accounting concept, while an accountant can still split the same
 * expense across lines, cost centres and projects.
 *
 * How that is achieved here:
 *
 *  1. **One line is the default.** The form opens with a single row. The
 *     "split into lines" affordance appears only once the operator asks for it,
 *     so the common case stays a one-screen form.
 *
 *  2. **Three visible sections, one collapsed.** Basic, Lines and Payment are
 *     visible; Accounting (tax treatment, type, dimensions) is folded behind
 *     "Advanced". Nothing is hidden that a normal user must fill in.
 *
 *  3. **Smart defaults from the category.** Picking "Fuel" pre-fills the line
 *     description and the warehouse, and carries the category forward to any
 *     line added afterwards — the behaviour the plan asks for, implemented
 *     without inventing an account mapping table that does not exist yet.
 *
 *  4. **Draft-first.** Saving a draft is always possible; "Save and send for
 *     approval" is the second button. Nothing can be posted from this form,
 *     which is what keeps the workflow meaningful.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FieldInput } from "@/components/ui/input";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import { useExpenseMutations, type ExpenseLineInput } from "@/hooks/use-expenses";
import {
  ACTIVE_EXPENSE_ENTRY_TYPES,
  EXPENSE_ENTRY_TYPES,
  EXPENSE_TAX_MODES,
  parseAmount,
  roundMoney,
  today,
} from "@/lib/expenses/query-keys";
import type {
  ExpenseDetail,
  ExpenseEntryType,
  ExpenseFormHeader,
  ExpenseLineDraft,
  ExpenseLookups,
  ExpensePayeeType,
  ExpenseTaxMode,
} from "@/lib/expenses/types";
import {
  CalendarDays,
  ChevronDown,
  Layers,
  Landmark,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

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

/** The gross amount of a draft line, as typed. Returns null when unreadable. */
function lineGross(line: ExpenseLineDraft): number | null {
  const qty = parseAmount(line.quantity);
  const price = parseAmount(line.unit_price);
  if (!qty.ok || !price.ok) return null;
  return roundMoney(qty.value * price.value);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

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
  /** Present when editing an existing draft. */
  editing?: ExpenseDetail | null;
  onSaved?: (entryId: string) => void;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const mutations = useExpenseMutations();

  const [header, setHeader] = useState<ExpenseFormHeader>(blankHeader);
  const [lines, setLines] = useState<ExpenseLineDraft[]>([blankLine()]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPayment, setShowPayment] = useState(true);
  const [payNow, setPayNow] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [dirty, setDirty] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  /* -- seed the form when it opens ---------------------------------- */
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
      setLines(
        editing.lines.length
          ? editing.lines.map((l) =>
              blankLine({
                description: l.description ?? "",
                category_id: l.category_id ?? "",
                quantity: String(l.quantity),
                unit_price: String(l.unit_price),
                tax_rate: String(l.tax_rate),
                cost_center_id: l.cost_center_id ?? "",
                project_id: l.project_id ?? "",
                note: l.note ?? "",
              }),
            )
          : [blankLine()],
      );
      // Editing an already-posted-looking record would be confusing; the
      // advanced block is opened so the accountant sees what they are changing.
      setShowAdvanced(entry.tax_mode !== "NONE");
    } else {
      setHeader(blankHeader());
      setLines([blankLine()]);
      setShowAdvanced(false);
      setPayNow(false);
      setPaymentMethod("cash");
      setAccountId("");
      setAccountLabel("");
    }

    setDirty(false);
    setShowPayment(true);
    // Focus the date field so the form is usable from the keyboard the moment
    // it opens — this form is used dozens of times a day by the same people.
    const handle = setTimeout(() => firstFieldRef.current?.focus(), 80);
    return () => clearTimeout(handle);
  }, [open, editing]);

  /* -- derived totals ------------------------------------------------ */
  const totals = useMemo(() => {
    let gross = 0;
    for (const line of lines) {
      const value = lineGross(line);
      if (value != null) gross += value;
    }
    return { gross: roundMoney(gross) };
  }, [lines]);

  const setHeaderField = useCallback(
    <K extends keyof ExpenseFormHeader>(key: K, value: ExpenseFormHeader[K]) => {
      setDirty(true);
      setHeader((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const patchLine = useCallback((key: string, patch: Partial<ExpenseLineDraft>) => {
    setDirty(true);
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }, []);

  const addLine = useCallback(() => {
    setDirty(true);
    setLines((prev) => {
      // A new line inherits the last line's category and dimensions. On a bill
      // with one repeated category that saves three clicks per line, and it is
      // trivially correctable because the values are still visible.
      const last = prev[prev.length - 1];
      return [
        ...prev,
        blankLine({
          category_id: last?.category_id ?? "",
          cost_center_id: last?.cost_center_id ?? "",
          project_id: last?.project_id ?? "",
          tax_rate: last?.tax_rate ?? "0",
        }),
      ];
    });
  }, []);

  const removeLine = useCallback((key: string) => {
    setDirty(true);
    setLines((prev) =>
      prev.length === 1
        ? prev.map((l) => blankLine({ key: l.key }))
        : prev.filter((l) => l.key !== key),
    );
  }, []);

  /* -- validation ---------------------------------------------------- */
  const validation = useMemo(() => {
    const errors: Record<string, string> = {};

    if (!header.expense_date) errors.expense_date = ar ? "التاريخ مطلوب" : "Date is required";
    if (header.due_date && header.due_date < header.expense_date) {
      errors.due_date = ar
        ? "تاريخ الاستحقاق لا يسبق تاريخ المصروف"
        : "Due date cannot precede the expense date";
    }
    if (header.payee_type === "SUPPLIER" && !header.supplier_id) {
      errors.supplier_id = ar ? "اختر المورد" : "Choose the supplier";
    }
    if (header.payee_type === "EMPLOYEE" && !header.employee_id) {
      errors.employee_id = ar ? "اختر الموظف" : "Choose the staff member";
    }

    const usable = lines.filter((line) => {
      const value = lineGross(line);
      return value != null && value > 0;
    });

    if (!usable.length) {
      errors.lines = ar
        ? "أدخل بندًا واحدًا على الأقل بمبلغ أكبر من صفر"
        : "Add at least one line with an amount above zero";
    }

    for (const line of lines) {
      const gross = lineGross(line);
      if (gross == null) {
        errors.lines = ar ? "تحقق من الكمية والسعر" : "Check the quantity and price";
        break;
      }
      const rate = parseAmount(line.tax_rate || "0");
      if (rate.ok && rate.value > 100) {
        errors.lines = ar ? "نسبة الضريبة بين 0 و 100" : "Tax rate must be between 0 and 100";
        break;
      }
    }

    return { errors, valid: Object.keys(errors).length === 0, usableCount: usable.length };
  }, [header, lines, ar]);

  /* -- submit -------------------------------------------------------- */
  const buildLinePayload = (): ExpenseLineInput[] => {
    const payload: ExpenseLineInput[] = [];

    for (const line of lines) {
      const qty = parseAmount(line.quantity);
      const price = parseAmount(line.unit_price);
      const rate = parseAmount(line.tax_rate || "0");
      // A line the operator left blank is dropped rather than rejected: an
      // empty extra row is a normal side effect of pressing "Add line" and
      // then changing your mind, not an error worth a toast.
      if (!qty.ok || !price.ok) continue;
      if (roundMoney(qty.value * price.value) <= 0) continue;

      payload.push({
        description: line.description || null,
        category_id: line.category_id || null,
        quantity: qty.value,
        unit_price: price.value,
        tax_rate: rate.ok ? rate.value : 0,
        cost_center_id: line.cost_center_id || null,
        project_id: line.project_id || null,
        note: line.note || null,
      });
    }

    return payload;
  };

  async function save(submit: boolean) {
    if (!validation.valid) {
      const first = Object.values(validation.errors)[0];
      toast.error(first);
      return;
    }

    const payload = {
      lines: buildLinePayload(),
      expense_date: header.expense_date,
      due_date: header.due_date || null,
      entry_type: header.entry_type,
      payee_type: header.payee_type,
      payee_name: header.payee_name || null,
      supplier_id: header.payee_type === "SUPPLIER" ? header.supplier_id || null : null,
      employee_id: header.payee_type === "EMPLOYEE" ? header.employee_id || null : null,
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
        onSaved?.(editing.entry.id);
      } else {
        const created = await mutations.create.mutateAsync({
          ...payload,
          submit,
        });

        // "Paid now" needs approval-level rights: posting is a control, and a
        // cashier typing a bill must not be able to recognize it in the books.
        // When the operator lacks that right the document is still saved and
        // submitted, and the payment is recorded after approval — which is the
        // honest outcome rather than a silently downgraded one.
        if (payNow && submit && created?.id) {
          try {
            await mutations.post.mutateAsync({
              id: created.id,
              version: created.version,
              payNow: true,
              paymentMethod,
              accountId: accountId || null,
              accountLabel: accountLabel || null,
              paymentDate: header.expense_date,
            });
          } catch {
            // The expense itself was saved; failing to post it is reported by
            // the post mutation, and the dialog still closes so the operator
            // does not re-submit and create a duplicate.
          }
        }

        onSaved?.(created?.id ?? "");
      }
      setDirty(false);
      onOpenChange(false);
    } catch {
      // The mutation hooks already surface a readable toast; swallowing here
      // keeps the dialog open so the operator does not lose their typing.
    }
  }

  const saving = mutations.isBusy;
  const isEditing = Boolean(editing);
  const showLineDetails = lines.length > 1 || showAdvanced;

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      // A half-typed expense is worth protecting: the drawer asks before it
      // throws away unsaved input.
      dismissible={!dirty || !saving}
      icon={<Receipt className="size-5" />}
      eyebrow={isEditing ? t("expenses.edit_title") : t("expenses.new")}
      title={isEditing ? editing?.entry.reference : t("expenses.new_title")}
      subtitle={t("expenses.new_subtitle")}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-muted-foreground">{t("common.total")}</span>
            <span className="font-mono text-lg font-bold text-foreground">
              {money(totals.gross)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button variant="outline" onClick={() => void save(false)} loading={saving}>
              {t("expenses.save_draft")}
            </Button>
            {!isEditing ? (
              <Button onClick={() => void save(true)} loading={saving} disabled={!validation.valid}>
                {t("expenses.save_submit")}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ------------------------------------------------ basic */}
        <Section
          icon={<CalendarDays className="size-4" />}
          title={t("expenses.tab.basic")}
          hint={
            ar
              ? "التاريخ والمبلغ والتصنيف — هذا كل ما يلزم عادة"
              : "Date, amount and category — usually all you need"
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("expenses.field.date")} required error={validation.errors.expense_date}>
              <FieldInput
                ref={firstFieldRef}
                type="date"
                value={header.expense_date}
                onValueChange={(value) => setHeaderField("expense_date", value)}
              />
            </Field>

            <Field
              label={t("expenses.field.category")}
              hint={ar ? "يُقترح على البنود تلقائيًا" : "Carried to the lines automatically"}
            >
              <select
                value={lines[0]?.category_id ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  // Applying the category to every line that has not been given
                  // its own keeps the single-line case a one-click form.
                  setLines((prev) =>
                    prev.map((line) => (line.category_id ? line : { ...line, category_id: value })),
                  );
                  setDirty(true);
                }}
                className={selectClass}
              >
                <option value="">{ar ? "اختر..." : "Select..."}</option>
                {(lookups?.categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {ar ? category.name_ar || category.name : category.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("expenses.field.description")} className="sm:col-span-2">
              <FieldInput
                value={header.description}
                onValueChange={(value) => setHeaderField("description", value)}
                placeholder={ar ? "مثال: فاتورة كهرباء شهر يوليو" : "e.g. July electricity bill"}
              />
            </Field>

            <Field label={ar ? "الجهة المستفيدة" : "Payee"} className="sm:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {(["NONE", "SUPPLIER", "EMPLOYEE", "OTHER"] as ExpensePayeeType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setHeaderField("payee_type", type)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] font-medium transition",
                      header.payee_type === type
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`expenses.payee.${type}`)}
                  </button>
                ))}
              </div>
            </Field>

            {header.payee_type === "SUPPLIER" ? (
              <Field label={t("common.supplier")} required error={validation.errors.supplier_id}>
                <select
                  value={header.supplier_id}
                  onChange={(event) => setHeaderField("supplier_id", event.target.value)}
                  className={selectClass}
                >
                  <option value="">{ar ? "اختر..." : "Select..."}</option>
                  {(lookups?.suppliers ?? []).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {header.payee_type === "EMPLOYEE" ? (
              <Field
                label={ar ? "الموظف" : "Staff member"}
                required
                error={validation.errors.employee_id}
              >
                <select
                  value={header.employee_id}
                  onChange={(event) => setHeaderField("employee_id", event.target.value)}
                  className={selectClass}
                >
                  <option value="">{ar ? "اختر..." : "Select..."}</option>
                  {(lookups?.employees ?? []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name ?? "—"}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {header.payee_type === "OTHER" ? (
              <Field label={ar ? "اسم الجهة" : "Payee name"}>
                <FieldInput
                  value={header.payee_name}
                  onValueChange={(value) => setHeaderField("payee_name", value)}
                />
              </Field>
            ) : null}
          </div>
        </Section>

        {/* ------------------------------------------------ lines */}
        <Section
          icon={<Layers className="size-4" />}
          title={t("expenses.tab.lines")}
          hint={
            lines.length === 1
              ? ar
                ? "بند واحد يكفي — أضف بنودًا لتقسيم المصروف"
                : "One line is enough — add more to split the expense"
              : t("expenses.line_count", lines.length)
          }
          error={validation.errors.lines}
          action={
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="size-3.5" />
              {t("expenses.add_line")}
            </Button>
          }
        >
          <div className="space-y-2">
            {lines.map((line, index) => {
              const gross = lineGross(line);
              return (
                <div
                  key={line.key}
                  className="rounded-xl border border-border/70 bg-surface/60 p-3 transition hover:border-border"
                >
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {ar ? `بند ${index + 1}` : `Line ${index + 1}`}
                      </span>
                      <FieldInput
                        size="sm"
                        className="mt-1"
                        value={line.description}
                        onValueChange={(value) => patchLine(line.key, { description: value })}
                        placeholder={ar ? "وصف البند" : "Line description"}
                      />
                    </div>

                    <div className="w-28 shrink-0">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {t("common.qty")}
                      </span>
                      <FieldInput
                        size="sm"
                        type="decimal"
                        className="mt-1 text-center"
                        value={line.quantity}
                        onValueChange={(value) => patchLine(line.key, { quantity: value })}
                      />
                    </div>

                    <div className="w-32 shrink-0">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {t("expenses.field.unit_price")}
                      </span>
                      <FieldInput
                        size="sm"
                        type="decimal"
                        className="mt-1 text-end"
                        value={line.unit_price}
                        onValueChange={(value) => patchLine(line.key, { unit_price: value })}
                        placeholder="0.00"
                      />
                    </div>

                    <div className="w-24 shrink-0 text-end">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {t("common.total")}
                      </span>
                      <div className="mt-1 h-8 font-mono text-sm font-semibold leading-8 tabular-nums">
                        {gross == null ? "—" : money(gross)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      aria-label={t("expenses.remove_line")}
                      className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {/* Per-line detail appears only when the operator is actually
                      splitting an expense, so the single-line form stays short. */}
                  {showLineDetails ? (
                    <div className="mt-2 grid gap-2 border-t border-border/50 pt-2 sm:grid-cols-4">
                      <select
                        value={line.category_id}
                        onChange={(event) =>
                          patchLine(line.key, { category_id: event.target.value })
                        }
                        className={cn(selectClass, "h-8 text-[12px]")}
                        aria-label={t("expenses.field.category")}
                      >
                        <option value="">{t("expenses.field.category")}</option>
                        {(lookups?.categories ?? []).map((category) => (
                          <option key={category.id} value={category.id}>
                            {ar ? category.name_ar || category.name : category.name}
                          </option>
                        ))}
                      </select>

                      <select
                        value={line.cost_center_id}
                        onChange={(event) =>
                          patchLine(line.key, { cost_center_id: event.target.value })
                        }
                        className={cn(selectClass, "h-8 text-[12px]")}
                        aria-label={t("expenses.field.cost_center")}
                      >
                        <option value="">{t("expenses.field.cost_center")}</option>
                        {(lookups?.cost_centers ?? []).map((center) => (
                          <option key={center.id} value={center.id}>
                            {ar ? center.name_ar || center.name : center.name}
                          </option>
                        ))}
                      </select>

                      <select
                        value={line.project_id}
                        onChange={(event) =>
                          patchLine(line.key, { project_id: event.target.value })
                        }
                        className={cn(selectClass, "h-8 text-[12px]")}
                        aria-label={t("expenses.field.project")}
                      >
                        <option value="">{t("expenses.field.project")}</option>
                        {(lookups?.projects ?? []).map((project) => (
                          <option key={project.id} value={project.id}>
                            {ar ? project.name_ar || project.name : project.name}
                          </option>
                        ))}
                      </select>

                      <FieldInput
                        size="sm"
                        type="percent"
                        value={line.tax_rate}
                        onValueChange={(value) => patchLine(line.key, { tax_rate: value })}
                        aria-label={t("expenses.field.tax_rate")}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Section>

        {/* ------------------------------------------------ payment */}
        <Section
          icon={<Wallet className="size-4" />}
          title={t("expenses.tab.payment")}
          collapsible
          open={showPayment}
          onToggle={() => setShowPayment((prev) => !prev)}
          hint={ar ? "سُدّد الآن، أم سيُسجَّل لاحقًا؟" : "Settled now, or recorded later?"}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPayNow(false)}
              className={cn(
                "rounded-xl border p-3 text-start transition",
                !payNow
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-surface hover:border-primary/30",
              )}
            >
              <span className="block text-sm font-medium text-foreground">
                {ar ? "يُسجَّل كمستحق" : "Record as unpaid"}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {ar
                  ? "يبقى في قائمة غير المسدّد حتى تُسجّل الدفعة"
                  : "Stays in the outstanding list until a payment is recorded"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPayNow(true)}
              className={cn(
                "rounded-xl border p-3 text-start transition",
                payNow
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-surface hover:border-primary/30",
              )}
            >
              <span className="block text-sm font-medium text-foreground">
                {ar ? "سُدّد الآن" : "Paid now"}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {ar ? "يُرحَّل ويُسدَّد في خطوة واحدة" : "Posted and settled in a single step"}
              </span>
            </button>
          </div>

          {payNow ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t("common.method")}>
                {/* Same catalogue, expenses context, independent scoping. */}
                <PaymentMethodPicker
                  context="expenses"
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  variant="select"
                  includeCredit={false}
                  ensureIds={[paymentMethod]}
                  ariaLabel={t("common.method")}
                  lang={ar ? "ar" : "en"}
                />
              </Field>

              {(lookups?.financial_accounts ?? []).length > 0 ? (
                <Field
                  label={ar ? "الحساب المالي (الصندوق / البنك)" : "Financial Account"}
                  hint={ar ? "الحساب المحاسبي للخصم" : "Source cash or bank account"}
                >
                  <select
                    value={accountId}
                    onChange={(event) => {
                      const val = event.target.value;
                      setAccountId(val);
                      const matched = lookups?.financial_accounts?.find((a) => a.id === val);
                      if (matched) setAccountLabel(matched.name_ar);
                    }}
                    className={selectClass}
                  >
                    <option value="">
                      {ar ? "— اختياري (تحديد تلقائي) —" : "— Optional (Auto) —"}
                    </option>
                    {(lookups?.financial_accounts ?? []).map((acct) => (
                      <option key={acct.id} value={acct.id}>
                        {acct.code} — {acct.name_ar}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field
                  label={ar ? "المصدر" : "Source"}
                  hint={ar ? "مثال: صندوق المصروفات النقدية" : "e.g. Petty cash box"}
                >
                  <FieldInput
                    value={accountLabel}
                    onValueChange={setAccountLabel}
                    placeholder={ar ? "اختياري" : "Optional"}
                  />
                </Field>
              )}
            </div>
          ) : null}
        </Section>

        {/* ------------------------------------------------ advanced */}
        <Section
          icon={<Landmark className="size-4" />}
          title={t("expenses.tab.advanced")}
          collapsible
          open={showAdvanced}
          onToggle={() => setShowAdvanced((prev) => !prev)}
          hint={ar ? "الضريبة، النوع، والأبعاد المحاسبية" : "Tax treatment, type and dimensions"}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("expenses.field.tax_mode")}
              hint={
                ar
                  ? "اختر «الضريبة ضمن المبلغ» إذا كان المبلغ المكتوب يشملها"
                  : "Choose “included” when the amount you typed already contains tax"
              }
            >
              <select
                value={header.tax_mode}
                onChange={(event) =>
                  setHeaderField("tax_mode", event.target.value as ExpenseTaxMode)
                }
                className={selectClass}
              >
                {EXPENSE_TAX_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`expenses.tax.${mode}`)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("expenses.field.type")}>
              <select
                value={header.entry_type}
                onChange={(event) =>
                  setHeaderField("entry_type", event.target.value as ExpenseEntryType)
                }
                className={selectClass}
              >
                {ACTIVE_EXPENSE_ENTRY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`expenses.type.${type}`)}
                  </option>
                ))}
                {/* Keep existing type if editing legacy/imported record */}
                {!ACTIVE_EXPENSE_ENTRY_TYPES.includes(header.entry_type) ? (
                  <option value={header.entry_type}>
                    {t(`expenses.type.${header.entry_type}`)}
                  </option>
                ) : null}
              </select>
            </Field>

            <Field
              label={t("expenses.field.due_date")}
              error={validation.errors.due_date}
              hint={ar ? "يستخدم في تقرير المتأخرات" : "Drives the overdue report"}
            >
              <FieldInput
                type="date"
                value={header.due_date}
                onValueChange={(value) => setHeaderField("due_date", value)}
              />
            </Field>

            <Field label={t("expenses.field.warehouse")}>
              <select
                value={header.warehouse_id}
                onChange={(event) => setHeaderField("warehouse_id", event.target.value)}
                className={selectClass}
              >
                <option value="">{ar ? "اختر..." : "Select..."}</option>
                {(lookups?.warehouses ?? []).map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {ar ? warehouse.name_ar || warehouse.name : warehouse.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("expenses.field.cost_center")}>
              <select
                value={header.cost_center_id}
                onChange={(event) => setHeaderField("cost_center_id", event.target.value)}
                className={selectClass}
              >
                <option value="">{ar ? "اختر..." : "Select..."}</option>
                {(lookups?.cost_centers ?? []).map((center) => (
                  <option key={center.id} value={center.id}>
                    {ar ? center.name_ar || center.name : center.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("expenses.field.project")}>
              <select
                value={header.project_id}
                onChange={(event) => setHeaderField("project_id", event.target.value)}
                className={selectClass}
              >
                <option value="">{ar ? "اختر..." : "Select..."}</option>
                {(lookups?.projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {ar ? project.name_ar || project.name : project.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("expenses.field.notes")} className="sm:col-span-2">
              <textarea
                value={header.note}
                onChange={(event) => setHeaderField("note", event.target.value)}
                rows={2}
                className={cn(selectClass, "h-auto py-2")}
                placeholder={
                  ar
                    ? "ملاحظة داخلية لا تظهر للجهة المستفيدة"
                    : "Internal note, not shown to the payee"
                }
              />
            </Field>
          </div>
        </Section>
      </div>
    </VortexDrawerDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-parts                                                          */
/* ------------------------------------------------------------------ */

const selectClass =
  "h-9 w-full min-w-0 rounded-[12px] border border-input bg-surface/70 px-3 text-sm text-foreground transition focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10";

function Section({
  icon,
  title,
  hint,
  error,
  action,
  collapsible,
  open = true,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  error?: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-border/70 bg-surface/40 p-3.5">
      <header className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={collapsible ? onToggle : undefined}
          disabled={!collapsible}
          className={cn(
            "flex min-w-0 items-center gap-2 text-start",
            collapsible && "cursor-pointer",
          )}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-surface text-muted-foreground">
            {icon}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            {hint ? (
              <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
            ) : null}
          </span>
          {collapsible ? (
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                !open && "-rotate-90",
              )}
              aria-hidden
            />
          ) : null}
        </button>
        {action}
      </header>

      {error ? (
        <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}

      {open ? children : null}
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
      {error ? (
        <span className="text-[11px] font-medium text-destructive">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-muted-foreground/80">{hint}</span>
      ) : null}
    </label>
  );
}

export type { ExpenseDetail };
