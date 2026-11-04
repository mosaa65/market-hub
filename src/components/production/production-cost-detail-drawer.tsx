import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Calculator, FileText, Scale, Wrench } from "lucide-react";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import {
  loadProductionOrderCostDetail,
  type ProductionOrderCostDetail,
  type ProductionOrderSummary,
} from "@/lib/production/production-orders";
import { cn } from "@/lib/utils";

/**
 * تفاصيل تكلفة أمر الإنتاج — تقرأ من production_order_cost_detail (9917).
 * لا تحسب أي تكلفة هنا؛ كل رقم معروض مصدره الخادم:
 *   • مصادر التكلفة: المواد + المصروفات المؤهلة المحمّلة (بحسابها وأساسها).
 *   • التوزيع: نصيب كل ناتج من التكلفة المشتركة ووزن التوزيع (قيمة بيع/وحدة أساس).
 *   • الفاقد: الطبيعي يظل تكلفة الناتج، وغير الطبيعي إلى 5911.
 *   • القيود: صرف المواد، تحميل المصروف، إقفال WIP.
 *   • المصروفات المستبعدة مع سبب الاستبعاد.
 */
type TabKey = "sources" | "distribution" | "losses" | "journals";

export function ProductionCostDetailDrawer({
  order,
  open,
  onOpenChange,
}: {
  order: ProductionOrderSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<TabKey>("sources");
  const query = useQuery({
    queryKey: ["production-order-cost-detail", order?.id],
    queryFn: () => loadProductionOrderCostDetail(order!.id),
    enabled: Boolean(open && order?.id),
  });

  const detail: ProductionOrderCostDetail | undefined = query.data;
  const money = (value: number | string | null | undefined) =>
    new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 2 }).format(Number(value) || 0);
  const qty = (value: number | string | null | undefined) =>
    new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 3 }).format(Number(value) || 0);

  /** مجموعة الحقائق المعروضة أعلى النافذة — كل قيمة من الخادم. */
  const totals = useMemo(() => {
    if (!detail) return null;
    const { order: header, summary } = detail;
    const materials = Number(header.material_cost) || 0;
    const conversion = Number(header.conversion_cost) || 0;
    const wip = Number(header.total_cost) || 0;
    const outputs = Number(header.output_cost) || 0;
    const abnormal = Number(header.abnormal_loss_cost) || 0;
    // يفضَّل فرق التقريب الذي يقيّمه الخادم (summary.rounding_variance) إن وصَل،
    // وإلا فالفرق الحسابي من رؤوس الأرقام — لا ربط منطقي إضافي هنا.
    const variance =
      summary?.rounding_variance === undefined || summary.rounding_variance === null
        ? Math.round((wip - outputs - abnormal) * 100) / 100
        : Number(summary.rounding_variance);
    return {
      materials,
      conversion,
      wip,
      outputs,
      abnormal,
      variance,
      wipBalanced: summary?.wip_balanced ?? Math.abs(variance) < 0.01,
      wipDebit: Number(summary?.wip_debit) || 0,
      wipCredit: Number(summary?.wip_credit) || 0,
      conversionAllocated: Number(summary?.conversion_from_expenses) || 0,
    };
  }, [detail]);

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "sources", label: "مصادر التكلفة", icon: <Wrench className="size-4" /> },
    { key: "distribution", label: "توزيع التكلفة", icon: <Boxes className="size-4" /> },
    { key: "losses", label: "الفاقد", icon: <Scale className="size-4" /> },
    { key: "journals", label: "القيود", icon: <FileText className="size-4" /> },
  ];

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`تفاصيل تكلفة التشغيلة ${order?.order_number ?? ""}`}
      subtitle="مصادر التكلفة، توزيعها على المخرجات، الفاقد، والقيود المرتبطة."
      icon={<Calculator className="size-5" />}
      size="lg"
    >
      {query.isLoading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          جارٍ تحميل تفاصيل التكلفة…
        </div>
      ) : query.error ? (
        <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          تعذر تحميل تفاصيل التكلفة. {String(query.error)}
        </div>
      ) : !detail || !totals ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          لا توجد تفاصيل لهذه التشغيلة.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard label="مواد مصروفة" value={money(totals.materials)} />
            <SummaryCard label="تحويل محمّل" value={money(totals.conversion)} />
            <SummaryCard label="إجمالي WIP" value={money(totals.wip)} strong />
            <SummaryCard label="تكلفة النواتج" value={money(totals.outputs)} />
            <SummaryCard
              label="فاقد غير طبيعي"
              value={money(totals.abnormal)}
              tone={totals.abnormal > 0 ? "warn" : undefined}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition",
                  tab === item.key
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-surface text-foreground hover:bg-muted",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          {tab === "sources" && (
            <div className="space-y-4">
              <Section title="المواد المصروفة" icon={<Boxes className="size-4" />}>
                {detail.materials.length === 0 ? (
                  <EmptyRow text="لا توجد مواد مسجلة." />
                ) : (
                  <Table
                    head={[
                      "الصنف",
                      "الكمية المدخلة",
                      "كمية الأساس",
                      "الكتلة (كجم)",
                      "تكلفة الوحدة",
                      "التكلفة",
                    ]}
                    rows={detail.materials.map((m) => [
                      m.product_name ?? m.product_id,
                      `${qty(m.entered_quantity)} ${m.entered_uom ?? ""}`.trim(),
                      `${qty(m.base_quantity)} ${m.base_uom ?? ""}`.trim(),
                      m.mass_kg === null ? "—" : qty(m.mass_kg),
                      money(m.unit_cost),
                      money(m.total_cost),
                    ])}
                    footer={["الإجمالي", "", "", "", "", money(totals.materials)]}
                  />
                )}
              </Section>

              <Section title="مصروفات التحويل المحمّلة" icon={<Wrench className="size-4" />}>
                {detail.cost_sources.length === 0 ? (
                  <EmptyRow text="لم يُحمَّل أي مصروف على هذه التشغيلة." />
                ) : (
                  <Table
                    head={["المرجع", "التصنيف", "الحساب", "المبلغ", "أساس التوزيع"]}
                    rows={detail.cost_sources.map((s) => [
                      `${s.reference ?? "—"} · ${s.expense_date}`,
                      s.category ?? "—",
                      s.expense_account_code,
                      money(s.amount),
                      s.allocation_basis,
                    ])}
                    footer={["الإجمالي", "", "", money(totals.conversionAllocated), ""]}
                  />
                )}
              </Section>

              {detail.excluded_expenses.length > 0 && (
                <Section
                  title="مصروفات لم تُحمَّل"
                  icon={<AlertTriangle className="size-4 text-amber-600" />}
                  note="تُعرض للتفسير فقط، ولا تدخل تكلفة هذه التشغيلة."
                >
                  <Table
                    head={["المرجع", "التصنيف", "الصافي", "الضريبة", "السبب"]}
                    rows={detail.excluded_expenses.map((e) => [
                      `${e.reference ?? "—"} · ${e.expense_date}`,
                      e.category ?? "—",
                      money(e.net_amount),
                      e.tax_recoverable
                        ? `${money(e.tax_amount)} (قابلة للاسترداد)`
                        : money(e.tax_amount),
                      e.reason ?? "—",
                    ])}
                  />
                </Section>
              )}
            </div>
          )}

          {tab === "distribution" && (
            <Section
              title="توزيع التكلفة المشتركة"
              icon={<Boxes className="size-4" />}
              note="الأساس: قيمة البيع التقديرية لوحدة الأساس (RELATIVE_SALES_VALUE)."
            >
              {detail.outputs.length === 0 ? (
                <EmptyRow text="لا توجد مخرجات." />
              ) : (
                <Table
                  head={[
                    "الناتج",
                    "الكمية",
                    "الكتلة (كجم)",
                    "قيمة/وحدة أساس",
                    "وزن التوزيع",
                    "التكلفة الموزعة",
                    "التكلفة الفعلية",
                    "تكلفة الوحدة",
                  ]}
                  rows={detail.outputs.map((o) => [
                    `${o.product_name ?? o.product_id}${o.item_class === "BY_PRODUCT" ? " (ناتج جانبي)" : ""}`,
                    `${qty(o.base_quantity)} ${o.base_uom ?? ""}`.trim(),
                    o.mass_kg === null ? "—" : qty(o.mass_kg),
                    money(o.allocation_value_per_base),
                    money(o.allocation_weight),
                    money(o.allocated_cost),
                    money(o.actual_stock_cost),
                    money(o.unit_cost),
                  ])}
                  footer={[
                    "الإجمالي",
                    "",
                    "",
                    "",
                    "",
                    money(detail.outputs.reduce((s, o) => s + Number(o.allocated_cost || 0), 0)),
                    money(totals.outputs),
                    "",
                  ]}
                />
              )}
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                فرق التقريب بين WIP والنواتج:{" "}
                <span className="font-bold">{money(totals.variance)}</span> — يُحمَّل على حساب فروق
                التكلفة عند الاستلام ولا يبقى WIP مفتوحاً.
              </p>
              <p
                className={cn(
                  "mt-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold",
                  totals.wipBalanced
                    ? "bg-emerald-500/10 text-emerald-700"
                    : "bg-amber-500/10 text-amber-700",
                )}
              >
                {totals.wipBalanced ? "توازن WIP مطابق للسجلات" : "توازن WIP يحتاج مراجعة محاسبية"}
              </p>
            </Section>
          )}

          {tab === "losses" && (
            <Section
              title="الفاقد الإنتاجي"
              icon={<Scale className="size-4" />}
              note="الطبيعي يبقى ضمن تكلفة النواتج، وغير الطبيعي يُحمَّل على حساب الفاقد 5911."
            >
              {detail.losses.length === 0 ? (
                <EmptyRow text="لم يُسجل فاقد لهذه التشغيلة." />
              ) : (
                <Table
                  head={["النوع", "الكمية", "الكتلة (كجم)", "التكلفة المحمّلة", "السبب"]}
                  rows={detail.losses.map((l) => [
                    l.loss_type === "ABNORMAL" ? "غير طبيعي" : "طبيعي",
                    `${qty(l.quantity)} ${l.uom ?? ""}`.trim(),
                    qty(l.mass_kg),
                    money(l.charged_cost),
                    l.reason,
                  ])}
                  footer={["الإجمالي", "", "", money(totals.abnormal), ""]}
                />
              )}
            </Section>
          )}

          {tab === "journals" && (
            <div className="space-y-4">
              <Section title="القيود المرتبطة" icon={<FileText className="size-4" />}>
                {detail.journals.length === 0 ? (
                  <EmptyRow text="لا توجد قيود مرتبطة." />
                ) : (
                  <Table
                    head={["رقم القيد", "التاريخ", "النوع", "الحالة", "البيان"]}
                    rows={detail.journals.map((j) => [
                      j.entry_number,
                      j.entry_date,
                      j.source_type === "production_completion"
                        ? "إقفال الإنتاج"
                        : j.source_type === "production_material_issue"
                          ? "صرف مواد"
                          : "تحميل مصروف",
                      j.status,
                      j.memo,
                    ])}
                  />
                )}
              </Section>
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard label="مدين الإنتاج تحت التنفيذ 1312" value={money(totals.wipDebit)} />
                <SummaryCard
                  label="دائن الإنتاج تحت التنفيذ 1312"
                  value={money(totals.wipCredit)}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </VortexDrawerDialog>
  );
}

function SummaryCard({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-surface-1/80 p-3",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm tabular-nums", strong && "text-base font-black")}>{value}</p>
    </div>
  );
}

function Section({
  title,
  icon,
  note,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-surface-1/60">
      <header className="flex items-start gap-2 border-b border-border/60 px-4 py-3">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          {note ? (
            <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{note}</p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function Table({
  head,
  rows,
  footer,
}: {
  head: string[];
  rows: (string | number)[][];
  footer?: (string | number)[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-start text-xs">
        <thead>
          <tr className="bg-muted/40 text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap p-2.5 text-start font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border/50">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn("p-2.5", cellIndex === 0 ? "font-semibold" : "tabular-nums")}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot>
            <tr className="border-t border-border bg-muted/30 font-bold">
              {footer.map((cell, index) => (
                <td key={index} className="p-2.5 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="p-4 text-xs text-muted-foreground">{text}</p>;
}
