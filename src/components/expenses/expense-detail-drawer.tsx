/**
 * Expense detail drawer.
 *
 * The single place where a document's whole life is visible: its lines, its
 * payments, its approval trail and — most importantly — exactly which actions
 * the CURRENT user is allowed to take. Those permissions are computed by the
 * database (`expense_detail` returns `can_edit`, `can_approve`, `can_post`…),
 * so a button can never appear for an action the server would refuse.
 *
 * Structure:
 *   header    reference, amount, status, settlement, due-date warning
 *   actions   the workflow bar — only the transitions currently legal
 *   tabs      Lines · Payments · Timeline
 *
 * Modals for the three decisions that need input (payment amount, rejection
 * reason, reversal reason) live here rather than in a generic dialog component,
 * because each has a different shape and forcing them into one form would make
 * all three worse.
 */

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { money, moneyCell } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FieldInput } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import { ExpenseStatusBadge, ExpensePaymentBadge } from "./expense-status-badge";
import { useExpenseDetail, useExpenseLookups, useExpenseMutations } from "@/hooks/use-expenses";
import { isOverdue, paymentProgress, parseAmount, today } from "@/lib/expenses/query-keys";
import type { ExpenseApproval, ExpenseDetail } from "@/lib/expenses/types";
import {
  AlertTriangle,
  Ban,
  Check,
  CircleDollarSign,
  Clock,
  FileText,
  RotateCcw,
  Send,
  Undo2,
  Upload,
  X,
} from "lucide-react";

type TabKey = "lines" | "payments" | "timeline" | "files";

export function ExpenseDetailDrawer({
  entryId,
  open,
  onOpenChange,
  onEdit,
}: {
  entryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (detail: ExpenseDetail) => void;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { data, isLoading, error, refetch } = useExpenseDetail(open ? entryId : null);
  const mutations = useExpenseMutations();
  const lookups = useExpenseLookups();

  const [tab, setTab] = useState<TabKey>("lines");
  const [payOpen, setPayOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);

  const entry = data?.entry;

  const overdue = useMemo(
    () => (entry ? isOverdue(entry.due_date, Number(entry.remaining_amount), entry.status) : false),
    [entry],
  );

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      // The detail is refetched by the mutation's invalidation, but an immediate
      // refetch makes the drawer update on the same paint.
      void refetch();
    } catch {
      /* the hooks already raised a readable toast */
    }
  }

  return (
    <>
      <VortexDrawerDialog
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        icon={<FileText className="size-5" />}
        eyebrow={entry ? t(`expenses.type.${entry.entry_type}`) : undefined}
        title={entry?.reference ?? (ar ? "مصروف" : "Expense")}
        subtitle={entry?.description ?? undefined}
        footer={
          entry ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {entry.status === "DRAFT" || entry.status === "REJECTED" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!entry.can_submit || mutations.isBusy}
                    onClick={() =>
                      void run(() =>
                        mutations.submit.mutateAsync({ id: entry.id, version: entry.version }),
                      )
                    }
                  >
                    <Send className="size-3.5" />
                    {t("expenses.submit")}
                  </Button>
                ) : null}

                {entry.status === "SUBMITTED" ? (
                  <>
                    <Button
                      size="sm"
                      disabled={!entry.can_approve || mutations.isBusy}
                      onClick={() =>
                        void run(() =>
                          mutations.decide.mutateAsync({
                            id: entry.id,
                            approve: true,
                            version: entry.version,
                          }),
                        )
                      }
                    >
                      <Check className="size-3.5" />
                      {t("expenses.approve")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!entry.can_approve || mutations.isBusy}
                      onClick={() => setRejectOpen(true)}
                    >
                      <X className="size-3.5" />
                      {t("expenses.reject")}
                    </Button>
                  </>
                ) : null}

                {entry.status === "APPROVED" ? (
                  <>
                    <Button
                      size="sm"
                      disabled={!entry.can_post || mutations.isBusy}
                      onClick={() =>
                        void run(() =>
                          mutations.post.mutateAsync({
                            id: entry.id,
                            version: entry.version,
                            payNow: false,
                          }),
                        )
                      }
                    >
                      <Clock className="size-3.5" />
                      {ar ? "ترحيل كمستحق" : "Post as payable"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!entry.can_post || mutations.isBusy}
                      onClick={() =>
                        void run(() =>
                          mutations.post.mutateAsync({
                            id: entry.id,
                            version: entry.version,
                            payNow: true,
                          }),
                        )
                      }
                    >
                      <CircleDollarSign className="size-3.5" />
                      {ar ? "ترحيل وسداد" : "Post & settle"}
                    </Button>
                  </>
                ) : null}

                {entry.status === "POSTED" || entry.status === "PARTIALLY_PAID" ? (
                  <Button
                    size="sm"
                    disabled={!entry.can_pay || mutations.isBusy}
                    onClick={() => setPayOpen(true)}
                  >
                    <CircleDollarSign className="size-3.5" />
                    {t("expenses.pay")}
                  </Button>
                ) : null}

                {entry.status === "PAID" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!entry.can_post || mutations.isBusy}
                    onClick={() => void run(() => mutations.close.mutateAsync({ id: entry.id }))}
                  >
                    <Check className="size-3.5" />
                    {t("expenses.close")}
                  </Button>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {entry.can_edit && onEdit ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onEdit(data as ExpenseDetail);
                      onOpenChange(false);
                    }}
                  >
                    {t("common.edit")}
                  </Button>
                ) : null}

                {entry.can_reverse ? (
                  <Button variant="ghost" size="sm" onClick={() => setReverseOpen(true)}>
                    <RotateCcw className="size-3.5" />
                    {t("expenses.reverse")}
                  </Button>
                ) : null}

                {entry.can_cancel ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban className="size-3.5" />
                    {t("expenses.cancel_expense")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
      >
        {isLoading || !entry ? (
          error ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="size-8 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {ar ? "تعذّر تحميل المصروف." : "The expense could not be loaded."}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          )
        ) : (
          <div className="space-y-4">
            {/* ------------------------------------------ headline */}
            <div className="rounded-[14px] border border-border/70 bg-surface/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-2xl font-bold tracking-tight text-foreground">
                      {money(Number(entry.total_amount))}
                    </span>
                    <ExpenseStatusBadge status={entry.status} showLock />
                    <ExpensePaymentBadge
                      paid={Number(entry.paid_amount)}
                      total={Number(entry.total_amount)}
                      status={entry.status}
                    />
                    {entry.source_kind === "LEGACY" ? (
                      <span className="rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {t("expenses.legacy_badge")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {entry.expense_date}
                    {entry.due_date ? ` · ${ar ? "يستحق" : "due"} ${entry.due_date}` : ""}
                    {entry.posting_date
                      ? ` · ${ar ? "مُرحّل" : "posted"} ${entry.posting_date}`
                      : ""}
                  </p>
                </div>

                <div className="text-end">
                  <span className="block text-[11px] text-muted-foreground">
                    {t("expenses.payee")}
                  </span>
                  <span className="block text-sm font-medium text-foreground">
                    {entry.supplier_name ?? entry.employee_name ?? entry.payee_name ?? "—"}
                  </span>
                </div>
              </div>

              {/* Settlement progress. Rendered only when something is owed, so
                  a draft does not display a 0% bar that means nothing. */}
              {Number(entry.total_amount) > 0 &&
              (entry.status === "POSTED" ||
                entry.status === "PARTIALLY_PAID" ||
                entry.status === "PAID") ? (
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300",
                        entry.status === "PAID" ? "bg-tone-success-fg/70" : "bg-primary/70",
                      )}
                      style={{
                        width: `${paymentProgress(Number(entry.paid_amount), Number(entry.total_amount))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {t("common.paid")}: {moneyCell(entry.paid_amount)}
                    </span>
                    <span className={cn(Number(entry.remaining_amount) > 0 && "text-foreground")}>
                      {t("expenses.remaining")}: {moneyCell(entry.remaining_amount)}
                    </span>
                  </div>
                </div>
              ) : null}

              {overdue ? (
                <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="size-3.5" />
                  {ar
                    ? `متأخر عن تاريخ الاستحقاق (${entry.due_date})`
                    : `Overdue since ${entry.due_date}`}
                </p>
              ) : null}

              {entry.rejection_reason ? (
                <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                  {ar ? "سبب الرفض: " : "Rejection reason: "}
                  {entry.rejection_reason}
                </p>
              ) : null}

              {entry.cancel_reason ? (
                <p className="mt-3 rounded-lg border border-border/70 bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  {ar ? "سبب الإلغاء: " : "Cancellation reason: "}
                  {entry.cancel_reason}
                </p>
              ) : null}
            </div>

            {/* ------------------------------------------ dimensions */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Meta label={t("expenses.field.warehouse")} value={entry.warehouse_name} />
              <Meta label={t("expenses.field.cost_center")} value={entry.cost_center_name} />
              <Meta label={t("expenses.field.project")} value={entry.project_name} />
              <Meta label={ar ? "أنشأه" : "Created by"} value={entry.created_by_name ?? "—"} />
            </div>

            {/* ------------------------------------------ tabs */}
            <div className="flex gap-1 border-b border-border/60">
              {(
                [
                  [
                    "lines",
                    ar
                      ? `البنود (${data?.lines.length ?? 0})`
                      : `Lines (${data?.lines.length ?? 0})`,
                  ],
                  [
                    "payments",
                    ar
                      ? `الدفعات (${data?.payments.length ?? 0})`
                      : `Payments (${data?.payments.length ?? 0})`,
                  ],
                  ["timeline", ar ? "السجل" : "Timeline"],
                  ["files", ar ? "المرفقات" : "Attachments"],
                ] as [TabKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-[12px] font-medium transition",
                    tab === key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "lines" ? <LinesTab detail={data as ExpenseDetail} /> : null}
            {tab === "payments" ? (
              <PaymentsTab
                detail={data as ExpenseDetail}
                onReverse={(paymentId) =>
                  void run(() =>
                    mutations.reversePayment.mutateAsync({
                      paymentId,
                      entryId: entry.id,
                    }),
                  )
                }
                canReverse={entry.can_reverse || entry.can_pay}
              />
            ) : null}
            {tab === "timeline" ? <TimelineTab detail={data as ExpenseDetail} /> : null}
            {tab === "files" ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 py-10 text-center">
                <Upload className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {ar
                    ? "المرفقات تُفعَّل في المرحلة التالية"
                    : "Attachments are enabled in the next phase"}
                </p>
                <p className="max-w-sm text-[11px] text-muted-foreground/80">
                  {ar
                    ? "الجدول والسياسات جاهزة؛ يتبقى ربط مخزن الملفات الخاص."
                    : "The table and policies are ready; the private storage bucket is the remaining step."}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </VortexDrawerDialog>

      {/* ------------------------------------------ decision modals */}
      {entry ? (
        <>
          <PaymentModal
            open={payOpen}
            onOpenChange={setPayOpen}
            remaining={Number(entry.remaining_amount)}
            defaultDate={today()}
            busy={mutations.isBusy}
            financialAccounts={lookups.data?.financial_accounts}
            onSubmit={async (values) => {
              await run(() =>
                mutations.pay.mutateAsync({
                  id: entry.id,
                  amount: values.amount,
                  paymentDate: values.date,
                  paymentMethod: values.method,
                  accountId: values.accountId,
                  accountLabel: values.label,
                  note: values.note,
                }),
              );
              setPayOpen(false);
            }}
          />

          <ReasonModal
            open={rejectOpen}
            onOpenChange={setRejectOpen}
            title={t("expenses.reject")}
            busy={mutations.isBusy}
            destructive
            onSubmit={async (reason) => {
              await run(() =>
                mutations.decide.mutateAsync({
                  id: entry.id,
                  approve: false,
                  reason,
                  version: entry.version,
                }),
              );
              setRejectOpen(false);
            }}
          />

          <ReasonModal
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title={t("expenses.cancel_expense")}
            busy={mutations.isBusy}
            destructive
            onSubmit={async (reason) => {
              await run(() =>
                mutations.cancel.mutateAsync({
                  id: entry.id,
                  reason,
                  version: entry.version,
                }),
              );
              setCancelOpen(false);
            }}
          />

          <ReasonModal
            open={reverseOpen}
            onOpenChange={setReverseOpen}
            title={t("expenses.reverse")}
            busy={mutations.isBusy}
            hint={
              ar
                ? "يُنشئ مستندًا معاكسًا ويترك الأصل كما هو — لا يُحذف شيء."
                : "Creates a compensating document and leaves the original untouched."
            }
            onSubmit={async (reason) => {
              await run(() => mutations.reverse.mutateAsync({ id: entry.id, reason }));
              setReverseOpen(false);
            }}
          />
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

function LinesTab({ detail }: { detail: ExpenseDetail }) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";

  if (!detail.lines.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("expenses.lines_empty")}</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <table className="w-full text-sm">
        <thead className="bg-surface-2/60 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-start font-medium">{t("expenses.field.description")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("expenses.field.category")}</th>
            <th className="hidden px-3 py-2 text-start font-medium sm:table-cell">
              {t("expenses.field.cost_center")}
            </th>
            <th className="hidden px-3 py-2 text-end font-medium md:table-cell">
              {t("common.tax")}
            </th>
            <th className="px-3 py-2 text-end font-medium">{t("common.total")}</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id} className="border-t border-border/60">
              <td className="px-3 py-2">
                <span className="block text-foreground">{line.description || "—"}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {line.quantity} × {moneyCell(line.unit_price)}
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {ar
                  ? line.category_name_ar || line.category_name || "—"
                  : line.category_name || "—"}
              </td>
              <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                {line.cost_center_name ?? line.project_name ?? "—"}
              </td>
              <td className="hidden px-3 py-2 text-end tabular-nums text-muted-foreground md:table-cell">
                {Number(line.tax_amount) > 0 ? moneyCell(line.tax_amount) : "—"}
              </td>
              <td className="px-3 py-2 text-end font-mono tabular-nums text-foreground">
                {moneyCell(line.gross_amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-surface-2/40">
          <tr>
            <td
              colSpan={4}
              className="px-3 py-2 text-end text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              {t("common.total")}
            </td>
            <td className="px-3 py-2 text-end font-mono font-semibold tabular-nums text-foreground">
              {moneyCell(detail.entry.total_amount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PaymentsTab({
  detail,
  onReverse,
  canReverse,
}: {
  detail: ExpenseDetail;
  onReverse: (paymentId: string) => void;
  canReverse: boolean;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";

  if (!detail.payments.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("expenses.no_payments")}</p>
    );
  }

  return (
    <ul className="space-y-2">
      {detail.payments.map((payment) => {
        // A reversal row and a reversed row both stay visible: the pair is the
        // evidence, and hiding either half would make the balance look wrong.
        const isReversal = Boolean(payment.reversal_of);
        const isReversed = Boolean(payment.reversed_by);
        const netEffect = isReversal || isReversed ? 0 : 1;

        return (
          <li
            key={payment.id}
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/60 px-3 py-2.5",
              netEffect === 0 && "opacity-60",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-mono font-semibold tabular-nums",
                    isReversal ? "text-destructive line-through" : "text-foreground",
                  )}
                >
                  {moneyCell(payment.amount)}
                </span>
                <span className="rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {payment.payment_method}
                </span>
                {isReversed ? (
                  <span className="rounded-full bg-tone-danger px-2 py-0.5 text-[10px] text-tone-danger-fg">
                    {ar ? "معكوسة" : "reversed"}
                  </span>
                ) : null}
                {isReversal ? (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {ar ? "قيد عكسي" : "reversal"}
                  </span>
                ) : null}
              </div>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {payment.payment_date}
                {payment.account_label ? ` · ${payment.account_label}` : ""}
                {payment.created_by_name ? ` · ${payment.created_by_name}` : ""}
                {payment.note ? ` · ${payment.note}` : ""}
              </span>
            </div>

            {canReverse && netEffect === 1 ? (
              <Button variant="ghost" size="sm" onClick={() => onReverse(payment.id)}>
                <Undo2 className="size-3.5" />
                {ar ? "عكس" : "Reverse"}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function TimelineTab({ detail }: { detail: ExpenseDetail }) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";

  const ACTION_LABEL: Record<string, { ar: string; en: string }> = {
    created: { ar: "أُنشئ المستند", en: "Document created" },
    updated: { ar: "عُدّلت المسودة", en: "Draft edited" },
    submitted: { ar: "أُرسل للاعتماد", en: "Sent for approval" },
    approved: { ar: "اعتُمد", en: "Approved" },
    rejected: { ar: "رُفض", en: "Rejected" },
    posted: { ar: "رُحّل محاسبيًا", en: "Posted" },
    payment: { ar: "سُجّلت دفعة", en: "Payment recorded" },
    cancelled: { ar: "أُلغي", en: "Cancelled" },
    reversed: { ar: "أُنشئ قيد عكسي", en: "Reversed" },
    closed: { ar: "أُقفل", en: "Closed" },
  };

  if (!detail.approvals.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("common.no_data")}</p>;
  }

  return (
    <ol className="relative space-y-3 ps-5">
      {/* The rule is drawn on the list rather than on each item, so it is a
          single element regardless of how many entries there are. */}
      <span aria-hidden className="absolute inset-y-1 start-1.5 w-px bg-border" />
      {detail.approvals.map((item: ExpenseApproval) => {
        const label = ACTION_LABEL[item.action];
        return (
          <li key={item.id} className="relative">
            <span
              aria-hidden
              className="absolute -start-[13px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary"
            />
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium text-foreground">
                {label ? (ar ? label.ar : label.en) : item.action}
              </span>
              {item.from_status && item.from_status !== item.to_status ? (
                <span className="text-[11px] text-muted-foreground">
                  {item.from_status} → {item.to_status}
                </span>
              ) : null}
            </div>
            <span className="block text-[11px] text-muted-foreground">
              {new Date(item.created_at).toLocaleString(ar ? "ar" : "en-GB")}
              {item.actor_name ? ` · ${item.actor_name}` : ""}
            </span>
            {item.reason ? (
              <span className="mt-1 block rounded-lg bg-surface-2/70 px-2 py-1 text-[11px] text-muted-foreground">
                {item.reason}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/*  Modals                                                             */
/* ------------------------------------------------------------------ */

function PaymentModal({
  open,
  onOpenChange,
  remaining,
  defaultDate,
  busy,
  financialAccounts,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remaining: number;
  defaultDate: string;
  busy: boolean;
  financialAccounts?: { id: string; code: string; name_ar: string }[];
  onSubmit: (values: {
    amount: number;
    date: string;
    method: string;
    accountId?: string | null;
    label: string;
    note: string;
  }) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [amount, setAmount] = useState(String(remaining));
  const [date, setDate] = useState(defaultDate);
  const [method, setMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Re-seed the amount on open, and default it to the full remainder because
  // settling in full is what happens most of the time. An effect, not a memo:
  // a memo body must not call setState.
  useEffect(() => {
    if (open) {
      setAmount(String(remaining));
      setDate(defaultDate);
      setAccountId("");
      setLabel("");
      setError(null);
    }
  }, [open, remaining, defaultDate]);

  async function submit() {
    const parsed = parseAmount(amount);
    if (!parsed.ok || parsed.value <= 0) {
      setError(ar ? "أدخل مبلغًا صحيحًا" : "Enter a valid amount");
      return;
    }
    if (parsed.value > remaining + 0.005) {
      setError(
        ar
          ? `المبلغ يتجاوز المتبقي (${moneyCell(remaining)})`
          : `Amount exceeds the remaining ${moneyCell(remaining)}`,
      );
      return;
    }
    setError(null);
    await onSubmit({
      amount: parsed.value,
      date,
      method,
      accountId: accountId || null,
      label,
      note,
    });
  }

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<CircleDollarSign className="size-5" />}
      title={t("expenses.pay")}
      subtitle={`${t("expenses.remaining")}: ${money(remaining)}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("common.amount")}
            </span>
            <FieldInput
              type="decimal"
              value={amount}
              onValueChange={setAmount}
              invalid={Boolean(error)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("common.date")}
            </span>
            <FieldInput type="date" value={date} onValueChange={setDate} />
          </label>
        </div>

        {/* One tap to settle the whole thing — the overwhelmingly common case. */}
        <button
          type="button"
          onClick={() => setAmount(String(remaining))}
          className="w-full rounded-lg border border-border/70 bg-surface px-3 py-2 text-[11px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
        >
          {t("expenses.pay_full")} — {money(remaining)}
        </button>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("common.method")}
            </span>
            {/* Same catalogue, expenses context. */}
            <PaymentMethodPicker
              context="expenses"
              value={method}
              onChange={setMethod}
              variant="select"
              includeCredit={false}
              ensureIds={[method]}
              ariaLabel={t("common.method")}
              lang={ar ? "ar" : "en"}
              className="h-9"
            />
          </label>

          {(financialAccounts ?? []).length > 0 ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {ar ? "الحساب المالي" : "Financial Account"}
              </span>
              <select
                value={accountId}
                onChange={(event) => {
                  const val = event.target.value;
                  setAccountId(val);
                  const matched = financialAccounts?.find((a) => a.id === val);
                  if (matched) setLabel(matched.name_ar);
                }}
                className="h-9 rounded-[12px] border border-input bg-surface/70 px-3 text-sm text-foreground focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10"
              >
                <option value="">{ar ? "— اختياري (تلقائي) —" : "— Optional —"}</option>
                {(financialAccounts ?? []).map((acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.code} — {acct.name_ar}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {ar ? "المصدر" : "Source"}
              </span>
              <FieldInput value={label} onValueChange={setLabel} placeholder={t("common.optional")} />
            </label>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{t("common.note")}</span>
          <FieldInput value={note} onValueChange={setNote} placeholder={t("common.optional")} />
        </label>

        {error ? <p className="text-[11px] font-medium text-destructive">{error}</p> : null}
      </div>
    </VortexDrawerDialog>
  );
}

function ReasonModal({
  open,
  onOpenChange,
  title,
  hint,
  busy,
  destructive,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  hint?: string;
  busy: boolean;
  destructive?: boolean;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  async function submit() {
    if (!reason.trim()) {
      // Rejecting or cancelling without a reason produces an audit trail that
      // answers "who" but not "why", which is the half that matters later.
      setError(t("expenses.reason_required"));
      return;
    }
    setError(null);
    await onSubmit(reason.trim());
  }

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={destructive ? <Ban className="size-5" /> : <RotateCcw className="size-5" />}
      title={title}
      subtitle={hint}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => void submit()}
            loading={busy}
          >
            {t("common.confirm")}
          </Button>
        </div>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t("expenses.reason")}
        </span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          autoFocus
          className="w-full rounded-[12px] border border-input bg-surface/70 px-3 py-2 text-sm text-foreground focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10"
          placeholder={ar ? "اكتب السبب…" : "Write the reason…"}
        />
      </label>
      {error ? <p className="mt-2 text-[11px] font-medium text-destructive">{error}</p> : null}
    </VortexDrawerDialog>
  );
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface/40 px-2.5 py-2">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="mt-0.5 block truncate text-[12px] text-foreground">{value || "—"}</span>
    </div>
  );
}
