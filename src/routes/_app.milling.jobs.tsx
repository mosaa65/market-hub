import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Cog,
  Plus,
  Printer,
  CheckCircle2,
  Receipt,
  Layers,
  AlertTriangle,
  X,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import {
  addOutput,
  completeJob,
  cancelJob,
  invoiceJob,
  fetchJobs,
  fetchOutputs,
  fetchIntakes,
  fetchPackagingItems,
  outputLabel,
  BAG_SIZES_KG,
  type MillingJob,
  type MillingOutput,
  type MillingOutputType,
  type JobCompletionSummary,
} from "@/lib/milling";
import {
  createAgreement,
  createJobFromAgreement,
  invoiceJobV2,
  fetchAgreements,
  AGREEMENT_OUTPUT_LABELS,
  type AgreementOutputType,
} from "@/lib/milling/agreements";
import { printMillingJobTicket } from "@/lib/milling/print";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingField,
  MillingInput,
  MillingSelect,
  MillingTextarea,
  StatusBadge,
  OutputBadge,
  Mono,
  Pill,
  MillingEmpty,
  LossWarning,
  Cell,
  QueryErrorGuard,
} from "@/components/milling/milling-ui";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import type { PageGuideConfig } from "@/components/page-guide";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/milling/jobs")({
  head: () => ({ meta: [{ title: "صالة التشغيل وأوامر الطحن — فورتكس ERP" }] }),
  component: MillingJobsPage,
});

const guide: PageGuideConfig = {
  title: "دليل صالة التشغيل وأوامر الطحن",
  subtitle: "كيف تفتح أمر طحن، تسجّل نواتجه، تُقفله بحساب الفاقد، ثم تُصدر أجور الطحن.",
  badge: "التشغيل والتصنيع",
  icon: <Cog className="h-5 w-5 text-orange-500" />,
  summaryText:
    "أمر الطحن مستند تشغيلي بحت: يسحب حبوب العميل من أماناته ويعيدها ему دقيقاً ونخالة، مع احتساب الفاقد آلياً. لا يُنشئ أي قيد مالي. الفاتورة هي ما يُنشئ الإيراد.",
  overviewCards: [
    {
      title: "نسبة الاستخراج",
      description: "نسبة الدقيق المتوقعة من الوزن الداخل — مؤشر أداء للمطحن.",
      icon: <Layers className="h-4 w-4" />,
      color: "blue",
    },
    {
      title: "الهدر المسموح",
      description: "نسبة الفاقد التعاقدية. تجاوزها يُسجَّل ولا يُمنع.",
      icon: <AlertTriangle className="h-4 w-4" />,
      color: "amber",
    },
    {
      title: "أكياس العميل أو المطحنة",
      description: "إن أحضر العميل أكياسه فلا أثر مالي، وإلا تُصرف من مخزونك وتُفوتر.",
      icon: <Boxes className="h-4 w-4" />,
      color: "purple",
    },
  ],
  matrixTitle: "متى يحدث كل أثر؟",
  matrixDescription: "تسلسل الأحداث من الاستلام حتى التحصيل.",
  impactMatrix: {
    columns: [
      { key: "step", label: "الحدث", className: "w-[28%]" },
      { key: "effect", label: "ما الذي يتغيّر", className: "w-[40%]" },
      { key: "nothing", label: "ما الذي لا يتغيّر إطلاقاً", className: "w-[32%]" },
    ],
    rows: [
      {
        badge: { label: "فتح أمر", variant: "blue" },
        fields: {
          step: "فتح أمر طحن من سند استلام",
          effect: "يُسجَّل سحب من رصيد أمانات العميل",
          nothing: "لا مخزون، لا إيراد، لا ذمة",
        },
      },
      {
        badge: { label: "نواتج", variant: "amber" },
        fields: {
          step: "تسجيل الدقيق والنخالة",
          effect: "يضيف نواتج العميل برصيدها العيني",
          nothing: "لا مخزون تجاري (حتى لو كانت الأكياس من المطحنة)",
        },
      },
      {
        badge: { label: "إقفال", variant: "emerald" },
        fields: {
          step: "إقفال الأمر",
          effect: "يُحتسب الفاقد والفاقد الزائد ويوثَّقان",
          nothing: "لا إيراد، لا ضريبة، لا ذمة",
        },
      },
      {
        badge: { label: "فوترة", variant: "purple" },
        fields: {
          step: "فاتورة أجور الطحن",
          effect: "إيراد خدمة + مديونية + صرف أكياس المطحنة (إن وجدت)",
          nothing: "لا يمس الحبوب ولا الدقيق ولا النخالة في المخزون",
        },
      },
    ],
  },
  stepsTitle: "مثال تطبيقي مختصر (400 كيس × 50 كجم)",
  steps: [
    { number: "1", title: "الاستلام", description: "20,000 كجم قمح أمانة → سند استلام IR-101." },
    { number: "2", title: "أمر الطحن", description: "فتح أمر طحن للـ 400 كيس على السند نفسه." },
    {
      number: "3",
      title: "النواتج",
      description: "312 كيس دقيق (15,600 كجم) + 100 كيس نخالة (4,000 كجم).",
    },
    {
      number: "4",
      title: "الإقفال والفوترة",
      description: "الفاقد 400 كجم (2%) ضمن المسموح. الفاتورة 400 × 6 = 2,400 + ضريبة.",
    },
  ],
  rulesTitle: "قواعد صريحة",
  rules: [
    {
      type: "danger",
      title: "الناتج لا يزيد عن الداخل",
      description: "يمنع الخادم تسجيل ناتج أكبر من وزن الدخول — خطأ إدخال، لا خطأ فيزيائي.",
    },
    {
      type: "warning",
      title: "تجاوز الهدر لا يمنع الإقفال",
      description: "يُسجَّل الفاقد الزائد ويظهر تحذير فوري، والقرار عن التسوية للمشغّل.",
    },
    {
      type: "info",
      title: "فاتورة واحدة لكل أمر",
      description: "لا يمكن إصدار فاتورتين لنفس أمر الطحن — حماية من الازدواج.",
    },
  ],
  footerTip: "نصيحة: أغلق الأمر قبل الفوترة دائماً، حتى تُمنع فاتورة على تشغيل لم ينتج بعد.",
};

const outputTypes: MillingOutputType[] = [
  "FLOUR_GRADE_1",
  "FLOUR_GRADE_2",
  "BRAN",
  "SEMOLINA",
  "WASTE",
];

const nf = (v: number, d = 0) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });

function MillingJobsPage() {
  const qc = useQueryClient();

  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [showNewJob, setShowNewJob] = useState(false);
  const [completion, setCompletion] = useState<JobCompletionSummary | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const {
    data: warehouses,
    isError: warehousesError,
    error: warehousesDetail,
    refetch: warehousesRefetch,
  } = useQuery({
    queryKey: ["milling", "warehouses"],
    queryFn: async () => {
      const { data } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, is_default")
        .eq("is_active", true)
        .order("is_default", { ascending: false });
      return (data ?? []) as {
        id: string;
        name: string;
        name_ar: string | null;
        is_default: boolean;
      }[];
    },
  });

  const {
    data: customers,
    isError: customersError,
    error: customersDetail,
    refetch: customersRefetch,
  } = useQuery({
    queryKey: ["milling", "customers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const storeId = useMemo(
    () => warehouses?.find((w) => w.is_default)?.id ?? warehouses?.[0]?.id ?? "",
    [warehouses],
  );

  const {
    data: jobs,
    isError: jobsError,
    error: jobsDetail,
    refetch: jobsRefetch,
  } = useQuery({
    queryKey: ["milling", "jobs", storeId],
    queryFn: () => fetchJobs(storeId),
    enabled: Boolean(storeId),
  });

  const {
    data: intakes,
    isError: intakesError,
    error: intakesDetail,
    refetch: intakesRefetch,
  } = useQuery({
    queryKey: ["milling", "intakes", storeId],
    queryFn: () => fetchIntakes(storeId),
    enabled: Boolean(storeId),
  });

  const {
    data: packaging,
    isError: packagingError,
    error: packagingDetail,
    refetch: packagingRefetch,
  } = useQuery({
    queryKey: ["milling", "packaging"],
    queryFn: fetchPackagingItems,
  });

  // Default to the first open job so the screen is useful on arrival.
  useEffect(() => {
    if (selectedJobId || !jobs) return;
    // `openJob` rather than `open`: the latter shadows the browser global.
    const openJob = jobs.find((j) => j.status === "PROCESSING" || j.status === "RECEIVED");
    if (openJob) setSelectedJobId(openJob.id);
  }, [jobs, selectedJobId]);

  const selectedJob = (jobs ?? []).find((j) => j.id === selectedJobId) ?? null;

  // عقد الطحن الذي ينفذه هذا الأمر — يعرض ما اتفق عليه وقت الاستلام.
  // الأوامر القديمة (قبل نظام العقود) agreement_id = NULL، فنُخفي البانر.
  const agreementId = selectedJob?.agreement_id ?? null;
  const {
    data: agreements,
    isError: agreementsError,
    error: agreementsDetail,
    refetch: agreementsRefetch,
  } = useQuery({
    queryKey: ["milling", "agreement", agreementId],
    queryFn: () => fetchAgreements(),
    enabled: !!agreementId,
  });
  const agreement = (agreements ?? []).find((a) => a.id === agreementId) ?? null;

  const {
    data: outputs,
    isError: outputsError,
    error: outputsDetail,
    refetch: outputsRefetch,
  } = useQuery({
    queryKey: ["milling", "outputs", selectedJobId],
    queryFn: () => fetchOutputs(selectedJobId),
    enabled: Boolean(selectedJobId),
  });

  const intakeNumber = (id: string) =>
    (intakes ?? []).find((i) => i.id === id)?.receipt_number ?? "—";

  const customerName = (id: string) => customers?.find((c) => c.id === id)?.name ?? "—";

  const refresh = () => qc.invalidateQueries({ queryKey: ["milling"] });

  const completeMutation = useMutation({
    mutationFn: (jobId: string) => completeJob(jobId),
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.message ?? "تعذّر إقفال الأمر");
      setCompletion(res.data ?? null);
      toast.success("تم إقفال أمر الطحن واحتساب الفاقد");
      void refresh();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ jobId, reason }: { jobId: string; reason: string }) => cancelJob(jobId, reason),
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.message ?? "تعذّر إلغاء أمر الطحن");
      toast.success("تم إلغاء أمر الطحن وإعادة الكمية لسند الاستلام");
      setSelectedJobId("");
      setCompletion(null);
      void refresh();
    },
  });

  // المرحلة 2: نستخدم الفاتورة v2 — سطر واحد (أساس واحد) وبند تعبئة.
  // القديمة تُصدر شطرين وتقرأ السعر من products.sale_price لا من الأمر.
  const invoiceMutation = useMutation({
    mutationFn: invoiceJobV2,
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.message ?? "تعذّر إصدار الفاتورة");
      toast.success("تم إصدار فاتورة أجور الطحن");
      setInvoiceOpen(false);
      void refresh();
    },
  });

  // Live totals so the loss guard rail reflects reality while the operator types.
  const producedKg = (outputs ?? []).reduce((s, o) => s + Number(o.produced_weight_kg ?? 0), 0);
  const producedBags = (outputs ?? []).reduce((s, o) => s + Number(o.produced_bag_count ?? 0), 0);

  const isOpen = selectedJob?.status === "PROCESSING" || selectedJob?.status === "RECEIVED";
  /*
   * The service invoice is deliberately gated the opposite way from the output
   * form: `issue_milling_service_invoice` only bills a COMPLETED/DELIVERED job,
   * because billing a run that is still in the mill would charge the customer
   * for grain the mill has not finished. The button used to render only while
   * `isOpen` — the exact state the engine rejects — so invoicing was impossible
   * from the UI even though the engine supported it.
   */
  const isInvoiceable = selectedJob?.status === "COMPLETED" || selectedJob?.status === "DELIVERED";

  /*
   * These 7 queries feed the tables and the counters below. A failed
   * one used to render as an empty table or a row of zeros, which reads as a
   * quiet day rather than a broken connection. The guard below turns any
   * failure into a stated error.
   */
  const queryStates = [
    { isError: warehousesError, error: warehousesDetail, refetch: warehousesRefetch },
    { isError: customersError, error: customersDetail, refetch: customersRefetch },
    { isError: jobsError, error: jobsDetail, refetch: jobsRefetch },
    { isError: intakesError, error: intakesDetail, refetch: intakesRefetch },
    { isError: packagingError, error: packagingDetail, refetch: packagingRefetch },
    { isError: agreementsError, error: agreementsDetail, refetch: agreementsRefetch },
    { isError: outputsError, error: outputsDetail, refetch: outputsRefetch },
  ];

  if (queryStates.some((q) => q.isError)) {
    return <QueryErrorGuard what="أوامر الطحن" queries={queryStates} />;
  }

  return (
    <ModuleGuard moduleId="milling_operations">
      <PageHeader
        title="صالة التشغيل وأوامر الطحن"
        subtitle="تابع أوامر التشغيل، سجّل نواتج كل دفعة، وأغلقها بحساب الفاقد الفعلي"
        guide={guide}
        actions={
          <button
            type="button"
            onClick={() => setShowNewJob((v) => !v)}
            className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            {showNewJob ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showNewJob ? "إلغاء" : "أمر طحن جديد"}
          </button>
        }
      />

      {showNewJob && (
        <NewJobForm
          intakes={(intakes ?? []).filter((i) => i.status === "RECEIVED")}
          customerName={customerName}
          onDone={(id) => {
            setShowNewJob(false);
            void refresh();
            if (id) setSelectedJobId(id);
          }}
        />
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ------------------------------------------------- job list (kanban) */}
        <MillingPanel className="self-start">
          <MillingSectionTitle
            icon={<Cog className="h-4 w-4" />}
            title="أوامر الطحن"
            subtitle={`${jobs?.length ?? 0} أمر`}
          />
          {(!jobs || jobs.length === 0) && (
            <MillingEmpty title="لا توجد أوامر" description="افتح أمر طحن جديد من سند استلام." />
          )}
          <ul className="max-h-[560px] divide-y divide-border/50 overflow-y-auto">
            {(jobs ?? []).map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedJobId(j.id);
                    setCompletion(null);
                  }}
                  className={cn(
                    "w-full px-4 py-3 text-start transition",
                    j.id === selectedJobId ? "bg-amber-500/10" : "hover:bg-surface-2/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Mono className="font-bold text-foreground">{j.job_number}</Mono>
                    <StatusBadge status={j.status} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {customerName(j.customer_id)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                    {nf(j.input_bag_count)} كيس · {nf(j.input_weight_kg)} كجم
                  </p>
                  {Number(j.loss_excess_kg) > 0 && (
                    <Pill tone="rose">فاقد زائد {nf(j.loss_excess_kg)} كجم</Pill>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </MillingPanel>

        {/* ------------------------------------------------------ job detail */}
        {!selectedJob ? (
          <MillingPanel>
            <MillingEmpty
              title="اختر أمر طحن"
              description="اختر أمراً من القائمة لعرض تفاصيله وتسجيل نواتجه."
            />
          </MillingPanel>
        ) : (
          <div className="space-y-4">
            {/* header card */}
            <MillingPanel>
              <MillingSectionTitle
                icon={<Cog className="h-4 w-4" />}
                title={`أمر الطحن ${selectedJob.job_number}`}
                subtitle={`${customerName(selectedJob.customer_id)} · من سند ${intakeNumber(selectedJob.intake_receipt_id)}`}
                action={
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        printMillingJobTicket({
                          job: selectedJob,
                          customerName: customerName(selectedJob.customer_id),
                          intakeNumber: intakeNumber(selectedJob.intake_receipt_id),
                          outputs: outputs ?? [],
                        })
                      }
                      className="grid h-8 w-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:border-amber-500/40 hover:text-amber-500"
                      title="طباعة أمر التشغيل"
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </button>
                    {isInvoiceable && (
                      <button
                        type="button"
                        onClick={() => setInvoiceOpen(true)}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-[11px] font-bold text-emerald-600 dark:text-emerald-400"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        إصدار فاتورة أجور
                      </button>
                    )}
                    {isOpen && (outputs ?? []).length === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const reason = window.prompt("سبب إلغاء أمر الطحن:");
                          if (reason) cancelMutation.mutate({ jobId: selectedJob.id, reason });
                        }}
                        disabled={cancelMutation.isPending}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 text-[11px] font-bold text-rose-600 dark:text-rose-400 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        إلغاء الأمر
                      </button>
                    )}
                  </div>
                }
              />

              {/* عقد الطحن — يوثّق ما طلبه العميل وقت الاتفاق. */}
              {agreement && (
                <div className="grid gap-3 border-b border-border/60 bg-surface-2/20 p-4 sm:grid-cols-4">
                  <div>
                    <p className="text-[11px] text-muted-foreground">الدرجة المطلوبة</p>
                    <p className="mt-0.5 text-xs font-bold text-foreground">
                      {(() => {
                        const t = agreement.requested_output_type;
                        return t ? AGREEMENT_OUTPUT_LABELS[t] : "—";
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">درجة الحبوب</p>
                    <p className="mt-0.5 text-xs font-bold text-foreground">
                      {agreement.grade_name_ar ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">الأكياس من</p>
                    <p className="mt-0.5 text-xs font-bold text-foreground">
                      {agreement.bags_source === "MILL" ? "المطحنة" : "العميل"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">طريقة التسليم</p>
                    <p className="mt-0.5 text-xs font-bold text-foreground">
                      {agreement.delivery_mode === "PARTIAL" ? "على دفعات" : "كلي"}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { l: "الكمية المسحوبة", v: `${nf(selectedJob.input_bag_count)} كيس` },
                  { l: "الوزن الداخل", v: `${nf(selectedJob.input_weight_kg)} كجم` },
                  { l: "مجموع النواتج", v: `${nf(producedKg)} كجم` },
                  { l: "أكياس منتجة", v: `${nf(producedBags)} كيس` },
                ].map((x) => (
                  <div key={x.l} className="rounded-xl bg-surface-2/40 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">{x.l}</p>
                    <Mono className="mt-0.5 block font-bold">{x.v}</Mono>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 border-t border-border/60 p-4 sm:grid-cols-3">
                <div className="rounded-xl bg-surface-2/40 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">أجرة الطحن</p>
                  {/* المرحلة 2: أساس واحد فقط. عرض الكيس والطن معًا كان يُوهم
                      بوجود أجرة مزدوجة، وهو ما سبّب الفاتورة المشوّهة. */}
                  <Mono className="mt-0.5 block font-bold">
                    {selectedJob.milling_fee_per_bag > 0
                      ? `${nf(selectedJob.milling_fee_per_bag, 2)} / كيس`
                      : selectedJob.milling_fee_per_ton > 0
                        ? `${nf(selectedJob.milling_fee_per_ton, 2)} / طن`
                        : "—"}
                  </Mono>
                </div>
                <div className="rounded-xl bg-surface-2/40 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">الاستخراج المتوقع</p>
                  <Mono className="mt-0.5 block font-bold">
                    {nf(selectedJob.expected_extraction_rate, 2)}%
                  </Mono>
                </div>
                <div className="rounded-xl bg-surface-2/40 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">الهدر المسموح</p>
                  <Mono className="mt-0.5 block font-bold">
                    {nf(selectedJob.allowed_loss_percentage, 2)}%
                  </Mono>
                </div>
              </div>

              {isOpen && (
                <div className="space-y-3 border-t border-border/60 p-4">
                  <LossWarning
                    inputKg={Number(selectedJob.input_weight_kg)}
                    outputKg={producedKg}
                    allowedPct={Number(selectedJob.allowed_loss_percentage)}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-muted-foreground">
                      إقفال الأمر يحسب الفاقد ويقارنه بالنسبة التعاقدية، ويوثّق الاثنين.
                    </p>
                    <button
                      type="button"
                      onClick={() => completeMutation.mutate(selectedJob.id)}
                      disabled={completeMutation.isPending || producedKg <= 0}
                      className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      إقفال أمر الطحن
                    </button>
                  </div>
                </div>
              )}

              {completion && (
                <div className="border-t border-border/60 bg-emerald-500/5 p-4">
                  <p className="mb-2.5 flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    نتيجة الإقفال
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { l: "الفاقد الفعلي", v: `${nf(completion.actual_loss_kg)} كجم` },
                      { l: "الهدر المسموح", v: `${nf(completion.allowed_loss_kg)} كجم` },
                      {
                        l: "الفاقد الزائد",
                        v: `${nf(completion.loss_excess_kg)} كجم`,
                        tone: completion.loss_exceeds_allowance ? "rose" : "emerald",
                      },
                      {
                        l: "نسبة الاستخراج الفعلية",
                        v: `${nf(completion.actual_extraction_rate, 2)}%`,
                      },
                      { l: "المتوقعة", v: `${nf(completion.expected_extraction_rate, 2)}%` },
                      { l: "إجمالي الأكياس", v: `${nf(completion.total_output_bags)} كيس` },
                    ].map((x) => (
                      <div key={x.l} className="rounded-xl bg-surface/60 px-3 py-2">
                        <p className="text-[11px] text-muted-foreground">{x.l}</p>
                        <Mono
                          className={cn(
                            "mt-0.5 block font-bold",
                            x.tone === "rose" && "text-rose-600 dark:text-rose-400",
                          )}
                        >
                          {x.v}
                        </Mono>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </MillingPanel>

            {/* outputs */}
            <MillingPanel>
              <MillingSectionTitle
                icon={<Layers className="h-4 w-4" />}
                title="النواتج"
                subtitle="دقيق ونخالة وسميد — مسجّلة بالعدد والوزن"
              />

              {(!outputs || outputs.length === 0) && (
                <MillingEmpty
                  title="لم تُسجَّل نواتج بعد"
                  description="سجّل الدفع والنخالة الناتجة عن هذه الدفعة بالأسفل."
                />
              )}

              {outputs && outputs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2.5 text-start font-medium">الناتج</th>
                        <th className="px-4 py-2.5 text-end font-medium">سعة الكيس</th>
                        <th className="px-4 py-2.5 text-end font-medium">الأكياس</th>
                        <th className="px-4 py-2.5 text-end font-medium">الوزن (كجم)</th>
                        <th className="px-4 py-2.5 text-start font-medium">مصدر الأكياس</th>
                        <th className="px-4 py-2.5 text-end font-medium">المسلّم</th>
                        <th className="px-4 py-2.5 text-end font-medium">المتبقي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outputs.map((o) => (
                        <tr
                          key={o.id}
                          className="border-b border-border/50 last:border-0 hover:bg-surface-2/40"
                        >
                          <Cell>
                            <OutputBadge type={o.output_type} label={outputLabel(o.output_type)} />
                          </Cell>
                          <Cell align="end">
                            <Mono>{nf(o.bag_size_kg, 2)}</Mono>
                          </Cell>
                          <Cell align="end">
                            <Mono className="font-bold">{nf(o.produced_bag_count)}</Mono>
                          </Cell>
                          <Cell align="end">
                            <Mono>{nf(o.produced_weight_kg)}</Mono>
                          </Cell>
                          <Cell>
                            <Pill tone={o.bags_source === "MILL" ? "amber" : "slate"}>
                              {o.bags_source === "MILL"
                                ? `مخزون المطحنة (${nf(o.mill_bags_used)})`
                                : "أكياس العميل"}
                            </Pill>
                          </Cell>
                          <Cell align="end">
                            <Mono className="text-muted-foreground">
                              {nf(o.delivered_bag_count)}
                            </Mono>
                          </Cell>
                          <Cell align="end">
                            <Mono className="font-bold text-emerald-600 dark:text-emerald-400">
                              {nf(o.produced_bag_count - o.delivered_bag_count)}
                            </Mono>
                          </Cell>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {isOpen && (
                <OutputForm
                  jobId={selectedJob.id}
                  packaging={packaging ?? []}
                  existing={outputs ?? []}
                  onDone={() => void refresh()}
                />
              )}
            </MillingPanel>
          </div>
        )}
      </div>

      {invoiceOpen && selectedJob && (
        <InvoiceDialog
          job={selectedJob}
          outputs={outputs ?? []}
          packagingName={(id: string | null) =>
            packaging?.find((p) => p.id === id)?.name_ar ??
            packaging?.find((p) => p.id === id)?.name ??
            "—"
          }
          busy={invoiceMutation.isPending}
          onClose={() => setInvoiceOpen(false)}
          onSubmit={(payload) => invoiceMutation.mutate(payload)}
        />
      )}
    </ModuleGuard>
  );
}

/* ------------------------------------------------------- new job form */

function NewJobForm({
  intakes,
  customerName,
  onDone,
}: {
  intakes: {
    id: string;
    receipt_number: string;
    customer_id: string;
    net_weight_kg: number;
    intake_bag_count: number;
    bag_size_kg: number;
  }[];
  customerName: (id: string) => string;
  onDone: (jobId?: string) => void;
}) {
  const [intakeId, setIntakeId] = useState("");
  const [bags, setBags] = useState(0);
  const [bagSize, setBagSize] = useState(50);
  const [weight, setWeight] = useState(0);
  const [extraction, setExtraction] = useState(80);
  const [loss, setLoss] = useState(2);
  const [notes, setNotes] = useState("");

  // ── عقد الطحن (المرحلة 1) ─────────────────────────────────────────────────
  // المشكلة التي تحلها: النموذج القديم كان يسأل عن الأجر فقط، ولا يسأل
  // «ماذا يريد العميل؟» — فيُنشأ أمر وسعر دون بيانات واضحة. الآن التجاوز
  // يبدأ بالعقد: درجة الطلب + أساس تسعير واحد + مصدر الأكياس.
  const [outputType, setOutputType] = useState<AgreementOutputType>("FLOUR_GRADE_1");
  const [outputNote, setOutputNote] = useState("");
  const [priceBasis, setPriceBasis] = useState<"BAG" | "TON">("BAG");
  const [agreedPrice, setAgreedPrice] = useState(0);
  const [bagsSource, setBagsSource] = useState<"CUSTOMER" | "MILL">("CUSTOMER");
  const [deliveryMode, setDeliveryMode] = useState<"FULL" | "PARTIAL">("FULL");

  // بطاقة الخدمة: SRV-MILL-* تطابق أساس التسعير (كيس → BAG، طن → TON).
  // الربط التلقائي يمنع تمرير null فينزلق النظام إلى البطاقة الافتراضية.
  const [services, setServices] = useState<{ id: string; name_ar: string; sku: string }[]>([]);

  // الأنواع المولّدة لا تُحدَّث تلقائياً مع كل migration؛ نستخدم as any
  // هنا فقط، تماماً كما يفعل lib/milling/agreements.ts.
  useEffect(() => {
    let alive = true;
    void supabase
      .from("products")
      .select("id, name_ar, sku")
      .eq("is_active", true)
      .then(({ data }) => {
        if (!alive) return;
        const rows = (data ?? []) as {
          id: string;
          name_ar: string;
          sku: string;
        }[];
        setServices(rows.filter((r) => r.sku.startsWith("SRV-")));
      });
    return () => {
      alive = false;
    };
  }, []);

  const selectedServiceId =
    services.find((s) => (priceBasis === "TON" ? s.sku.includes("TON") : s.sku.includes("BAG")))
      ?.id ?? null;

  // الأجر يُشتق من العقد — إدخال واحد فقط، وأثره يظهر فوراً.
  const estimatedTotal = priceBasis === "BAG" ? bags * agreedPrice : (weight / 1000) * agreedPrice;

  const receipt = intakes.find((i) => i.id === intakeId);

  useEffect(() => {
    if (!receipt) return;
    setBags(receipt.intake_bag_count);
    setBagSize(receipt.bag_size_kg);
    setWeight(receipt.net_weight_kg);
  }, [receipt]);

  // المرحلة 1: أمر واحد = عقد واحد + تنفيذ. ننشئ العقد أولاً (يثبت الاتفاق
  // وسعره)، ثم نفتح الأمر منه فيرث التسعير. لو فشل أيٌّ منهما لا يُكتب الآخر.
  const mutation = useMutation({
    mutationFn: async () => {
      const agreement = await createAgreement({
        intakeReceiptId: intakeId,
        // الفحص يأتي من السند نفسه — لا يُخترع في شاشة الأمر.
        grainGradeId: (receipt as { grain_grade_id?: string | null })?.grain_grade_id ?? "",
        requestedOutputType: outputType,
        requestedOutputNote: outputNote,
        outputBagSizeKg: bagSize,
        bagsSource,
        deliveryMode,
        serviceProductId: selectedServiceId,
        priceBasis,
        agreedPrice,
        expectedExtractionRate: extraction,
        allowedLossPercentage: loss,
        notes,
      });

      if (!agreement.ok || !agreement.id) {
        return { ok: false, message: agreement.message ?? "تعذّر إنشاء عقد الطحن" };
      }

      return await createJobFromAgreement({
        agreementId: agreement.id,
        intakeReceiptId: intakeId,
        inputBagCount: bags,
        inputBagSizeKg: bagSize,
        inputWeightKg: weight,
        notes,
      });
    },
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.message ?? "تعذّر فتح أمر الطحن");
      toast.success("تم إنشاء عقد الطحن وفتح أمر الطحن");
      onDone(res.id);
    },
  });

  return (
    <MillingPanel>
      <MillingSectionTitle
        icon={<Plus className="h-4 w-4" />}
        title="فتح أمر طحن جديد"
        subtitle="الكمية تُسحَب من رصيد أمانات سند الاستلام — لا يمكن تجاوز المتاح"
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <MillingField label="سند الاستلام *" className="sm:col-span-2">
          <MillingSelect value={intakeId} onChange={(e) => setIntakeId(e.target.value)}>
            <option value="">— اختر سند الاستلام —</option>
            {intakes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.receipt_number} — {customerName(i.customer_id)} ({nf(i.net_weight_kg)} كجم)
              </option>
            ))}
          </MillingSelect>
        </MillingField>

        <MillingField label="عدد الأكياس المسحوبة">
          <MillingInput
            type="number"
            min={0}
            value={bags || ""}
            onChange={(e) => setBags(Number(e.target.value))}
          />
        </MillingField>

        <MillingField label="سعة الكيس (كجم)">
          <MillingSelect
            value={String(bagSize)}
            onChange={(e) => setBagSize(Number(e.target.value))}
          >
            {BAG_SIZES_KG.map((s) => (
              <option key={s} value={s}>
                {s} كجم
              </option>
            ))}
          </MillingSelect>
        </MillingField>

        <MillingField label="الوزن المسحوب (كجم) *" hint="متاح من السند: راجع الحد الأعلى">
          <MillingInput
            type="number"
            step="0.001"
            min={0}
            value={weight || ""}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </MillingField>

        {/* ── عقد الطحن: ماذا يريد العميل، وبأي شروم ─────────────────── */}
        <MillingField
          label="الدرجة المطلوبة *"
          hint="ما يطلبه العميل بالضبط"
          className="sm:col-span-2"
        >
          <MillingSelect
            value={outputType}
            onChange={(e) => setOutputType(e.target.value as AgreementOutputType)}
          >
            {(Object.keys(AGREEMENT_OUTPUT_LABELS) as AgreementOutputType[]).map((t) => (
              <option key={t} value={t}>
                {AGREEMENT_OUTPUT_LABELS[t]}
              </option>
            ))}
          </MillingSelect>
        </MillingField>

        <MillingField label="وصف الطلب" className="sm:col-span-2">
          <MillingInput
            value={outputNote}
            onChange={(e) => setOutputNote(e.target.value)}
            placeholder="مثال: نمرة 1 خشن للمخبز"
          />
        </MillingField>

        <MillingField label="من يوفّر الأكياس">
          <MillingSelect
            value={bagsSource}
            onChange={(e) => setBagsSource(e.target.value as "CUSTOMER" | "MILL")}
          >
            <option value="CUSTOMER">العميل (بلا تكلفة)</option>
            <option value="MILL">المطحنة (تُفوتَر وتُستنزف من المخزون)</option>
          </MillingSelect>
        </MillingField>

        <MillingField label="طريقة التسليم">
          <MillingSelect
            value={deliveryMode}
            onChange={(e) => setDeliveryMode(e.target.value as "FULL" | "PARTIAL")}
          >
            <option value="FULL">كلي عند الإقفال</option>
            <option value="PARTIAL">على دفعات</option>
          </MillingSelect>
        </MillingField>

        <MillingField label="أساس التسعير *">
          <MillingSelect
            value={priceBasis}
            onChange={(e) => setPriceBasis(e.target.value as "BAG" | "TON")}
          >
            <option value="BAG">أجرة الكيس</option>
            <option value="TON">أجرة الطن</option>
          </MillingSelect>
        </MillingField>

        <MillingField
          label={`السعر المتفق عليه (${priceBasis === "BAG" ? "لكل كيس" : "لكل طن"}) *`}
        >
          <MillingInput
            type="number"
            step="0.01"
            min={0}
            value={agreedPrice || ""}
            onChange={(e) => setAgreedPrice(Number(e.target.value))}
          />
        </MillingField>

        {agreedPrice > 0 && (
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-[11.5px] text-muted-foreground">
              الأجرة التقديرية:{" "}
              <span className="font-bold text-foreground">{nf(estimatedTotal, 2)} ريال</span>{" "}
              {priceBasis === "BAG"
                ? `(${nf(bags)} كيس × ${nf(agreedPrice, 2)})`
                : `(${nf(weight / 1000, 3)} طن × ${nf(agreedPrice, 2)})`}
              {" — تُثبَّت الآن بالعقد ولا تتغير بأمر الطحن."}
            </p>
          </div>
        )}

        <MillingField label="الهدر المسموح %">
          <MillingInput
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={loss || ""}
            onChange={(e) => setLoss(Number(e.target.value))}
          />
        </MillingField>

        <MillingField label="نسبة الاستخراج المتوقعة %">
          <MillingInput
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={extraction || ""}
            onChange={(e) => setExtraction(Number(e.target.value))}
          />
        </MillingField>

        <MillingField label="ملاحظات" className="sm:col-span-2 lg:col-span-4">
          <MillingTextarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </MillingField>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 p-4">
        <p className="text-[11px] text-muted-foreground">
          إن كان العقد بالأTON فاضبط أجرة الكيس على صفر.
        </p>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending || !intakeId || weight <= 0 || agreedPrice <= 0 || !outputType
          }
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          فتح أمر الطحن
        </button>
      </div>
    </MillingPanel>
  );
}

/* --------------------------------------------------------- output form */

function OutputForm({
  jobId,
  packaging,
  existing,
  onDone,
}: {
  jobId: string;
  packaging: {
    id: string;
    sku: string;
    name: string;
    name_ar: string | null;
    sale_price: number;
  }[];
  existing: MillingOutput[];
  onDone: () => void;
}) {
  const [type, setType] = useState<MillingOutputType>("FLOUR_GRADE_1");
  const [bagSize, setBagSize] = useState(50);
  const [bags, setBags] = useState(0);
  const [weight, setWeight] = useState(0);
  const [source, setSource] = useState<"CUSTOMER" | "MILL">("CUSTOMER");
  const [bagProduct, setBagProduct] = useState("");
  const [millBags, setMillBags] = useState(0);

  useEffect(() => {
    const current = existing.find((o) => o.output_type === type);
    if (current) {
      setBagSize(current.bag_size_kg);
      setBags(current.produced_bag_count);
      setWeight(current.produced_weight_kg);
      setSource(current.bags_source);
      setBagProduct(current.mill_bag_product_id ?? "");
      setMillBags(current.mill_bags_used);
    } else {
      setBags(0);
      setWeight(0);
      setSource("CUSTOMER");
      setBagProduct("");
      setMillBags(0);
    }
  }, [type, existing]);

  // Auto-derive weight from bags × size while the operator types bags, but let
  // them override it — real scale readings differ from nominal.
  useEffect(() => {
    if (bags > 0 && weight === 0) setWeight(bags * bagSize);
  }, [bags, bagSize, weight]);

  const mutation = useMutation({
    mutationFn: addOutput,
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.message ?? "تعذّر تسجيل الناتج");
      toast.success("تم تسجيل الناتج");
      onDone();
    },
  });

  return (
    <div className="border-t border-border/60 bg-surface-2/20 p-4">
      <p className="mb-3 flex items-center gap-2 text-xs font-bold text-foreground">
        <Boxes className="h-4 w-4 text-orange-500" />
        تسجيل / تصحيح ناتج
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MillingField label="نوع الناتج">
          <MillingSelect
            value={type}
            onChange={(e) => setType(e.target.value as MillingOutputType)}
          >
            {outputTypes.map((t) => (
              <option key={t} value={t}>
                {outputLabel(t)}
              </option>
            ))}
          </MillingSelect>
        </MillingField>

        <MillingField label="سعة الكيس (كجم)">
          <MillingSelect
            value={String(bagSize)}
            onChange={(e) => setBagSize(Number(e.target.value))}
          >
            {BAG_SIZES_KG.map((s) => (
              <option key={s} value={s}>
                {s} كجم
              </option>
            ))}
          </MillingSelect>
        </MillingField>

        <MillingField label="عدد الأكياس المنتجة">
          <MillingInput
            type="number"
            min={0}
            value={bags || ""}
            onChange={(e) => setBags(Number(e.target.value))}
          />
        </MillingField>

        <MillingField label="الوزن الإجمالي (كجم)">
          <MillingInput
            type="number"
            step="0.001"
            min={0}
            value={weight || ""}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </MillingField>

        <MillingField label="مصدر الأكياس">
          <MillingSelect
            value={source}
            onChange={(e) => setSource(e.target.value as "CUSTOMER" | "MILL")}
          >
            <option value="CUSTOMER">أكياس العميل (لا أثر مالي)</option>
            <option value="MILL">من مخزون المطحنة (تُفوتر)</option>
          </MillingSelect>
        </MillingField>

        {source === "MILL" && (
          <>
            <MillingField label="صنف الأكياس">
              <MillingSelect value={bagProduct} onChange={(e) => setBagProduct(e.target.value)}>
                <option value="">— اختر الصنف —</option>
                {packaging.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_ar || p.name} ({p.sku})
                  </option>
                ))}
              </MillingSelect>
            </MillingField>
            <MillingField label="عدد الأكياس المصروفة">
              <MillingInput
                type="number"
                min={0}
                value={millBags || ""}
                onChange={(e) => setMillBags(Number(e.target.value))}
              />
            </MillingField>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() =>
            mutation.mutate({
              jobId,
              outputType: type,
              bagSizeKg: bagSize,
              producedBagCount: bags,
              producedWeightKg: weight,
              bagsSource: source,
              millBagProductId: source === "MILL" ? bagProduct : null,
              millBagsUsed: source === "MILL" ? millBags : 0,
            })
          }
          disabled={mutation.isPending || (bags <= 0 && weight <= 0)}
          className="flex h-10 items-center gap-2 rounded-xl bg-orange-600 px-5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          {existing.some((o) => o.output_type === type) ? "تحديث الناتج" : "تسجيل الناتج"}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- invoice dialog */

function InvoiceDialog({
  job,
  outputs,
  packagingName,
  busy,
  onClose,
  onSubmit,
}: {
  job: MillingJob;
  outputs: MillingOutput[];
  packagingName: (id: string | null) => string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    jobId: string;
    paymentMethod: string;
    paid: number;
    discount: number;
    note: string;
    includePackaging: boolean;
    includeSewing: boolean;
    sewingPrice: number;
  }) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paid, setPaid] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState("");
  const [includePackaging, setIncludePackaging] = useState(true);
  // قرار Q3 (2026-10-03): بند التعبئة مستقل عن أجرة الطحن، ويظهر فقط
  // عندما تكون الأكياس من المطحنة — عندها فقط يوجد ما يُعبَّأ ويُفوتر.
  const [includeSewing, setIncludeSewing] = useState(false);
  const [sewingPrice, setSewingPrice] = useState(1);

  const millBags = outputs.filter((o) => o.bags_source === "MILL");
  const packagingTotal = millBags.reduce((s, o) => s + o.mill_bags_used, 0);

  // The server rejects a job with two fee bases.  Keep the preview on the
  // same single-basis rule so the amount shown to the operator cannot imply
  // that bag and ton fees will be charged together.
  const isPricedPerBag = Number(job.milling_fee_per_bag) > 0;
  const serviceFee = isPricedPerBag
    ? Number(job.input_bag_count) * Number(job.milling_fee_per_bag)
    : (Number(job.input_weight_kg) / 1000) * Number(job.milling_fee_per_ton);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-border/80 bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Receipt className="h-4 w-4 text-emerald-500" />
            فاتورة أجور الطحن — {job.job_number}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 space-y-2 rounded-2xl bg-surface-2/40 p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">أجرة الطحن</span>
            <Mono className="font-bold">{nf(serviceFee, 2)}</Mono>
          </div>
          {packagingTotal > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                أكياس ({packagingTotal} حبة) — تُخصم من المخزون
              </span>
              <Mono className="font-bold">{nf(packagingTotal, 0)}</Mono>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border/60 pt-2 text-xs">
            <span className="font-bold">قبل الضريبة</span>
            <Mono className="font-bold">{nf(serviceFee - discount, 2)}</Mono>
          </div>
        </div>

        <div className="space-y-3">
          <MillingField label="طريقة الدفع">
            {/* Same catalogue, sales context — milling invoices are sales. */}
            <PaymentMethodPicker
              context="sales"
              value={paymentMethod}
              onChange={setPaymentMethod}
              variant="select"
              ensureIds={[paymentMethod]}
              ariaLabel="طريقة الدفع"
              lang="ar"
            />
          </MillingField>

          <div className="grid grid-cols-2 gap-3">
            <MillingField label="المدفوع">
              <MillingInput
                type="number"
                step="0.01"
                min={0}
                value={paid || ""}
                onChange={(e) => setPaid(Number(e.target.value))}
              />
            </MillingField>
            <MillingField label="خصم">
              <MillingInput
                type="number"
                step="0.01"
                min={0}
                value={discount || ""}
                onChange={(e) => setDiscount(Number(e.target.value))}
              />
            </MillingField>
          </div>

          {packagingTotal > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includePackaging}
                onChange={(e) => setIncludePackaging(e.target.checked)}
                className="h-4 w-4 rounded border-border/70"
              />
              فوترة الأكياس التي وفّرتها المطحنة
              <span className="text-[10.5px]">
                ({packagingName(millBags[0]?.mill_bag_product_id ?? null)})
              </span>
            </label>
          )}

          {/* بند أجرة التعبئة والحياكة — مستقل، ولا يخصم مخزوناً. */}
          {millBags.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeSewing}
                  onChange={(e) => setIncludeSewing(e.target.checked)}
                  className="h-4 w-4 rounded border-border/70"
                />
                إضافة أجرة تعبئة وحياكة
              </label>
              {includeSewing && (
                <div className="flex items-center gap-1">
                  <span className="text-[10.5px]">لكل كيس</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={sewingPrice || ""}
                    onChange={(e) => setSewingPrice(Number(e.target.value))}
                    className="h-8 w-20 rounded-lg border border-border/70 bg-background px-2 text-xs"
                  />
                  <span className="text-[10.5px]">
                    = {nf(sewingPrice * (millBags[0]?.mill_bags_used ?? 0), 2)}
                  </span>
                </div>
              )}
            </div>
          )}

          <MillingField label="ملاحظات">
            <MillingTextarea value={note} onChange={(e) => setNote(e.target.value)} />
          </MillingField>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-border/70 px-4 text-xs font-bold text-muted-foreground transition hover:bg-surface-2/50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() =>
              onSubmit({
                jobId: job.id,
                paymentMethod,
                paid,
                discount,
                note,
                includePackaging,
                includeSewing,
                sewingPrice,
              })
            }
            disabled={busy || job.status === "PROCESSING"}
            className="flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <Receipt className="h-4 w-4" />
            {busy ? "جارٍ الإصدار…" : "إصدار الفاتورة"}
          </button>
        </div>

        {job.status === "PROCESSING" && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            يجب إقفال أمر الطحن قبل إصدار الفاتورة.
          </p>
        )}
      </div>
    </div>
  );
}
