/**
 * خطوات المستند الموحد داخل كاونتر المطحنة.
 * لا تنشئ هذه الواجهة فاتورة أو مخزوناً مستقلاً: كل حركة تمر برقم المستند
 * الذي أُنشئ في الاستلام مع فاتورة المبيعات الرسمية.
 */
import { useState, type Dispatch, type SetStateAction, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cog,
  PackageCheck,
  Plus,
  Trash2,
  Printer,
  Share2,
  Receipt,
  Scale,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  AlertCircle,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  deliverMillingServiceDocument,
  fetchMillingDocumentDetails,
  fetchOutputItems,
  processMillingServiceDocument,
  buildMillingDocumentUnifiedDoc,
  type CustodyLine,
  type MillingServiceDocumentCreated,
  type MillingDocumentDetails,
} from "@/lib/milling";
import {
  MillingField,
  MillingPanel,
  MillingSectionTitle,
  MillingSelect,
  MillingTextarea,
  Pill,
  Mono,
  fmtNum,
} from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";
import { UniversalPrintPreview } from "@/components/universal-print-preview";
import {
  UnifiedPrintModal,
  type MillingTicketStage,
} from "@/components/milling/unified-print-modal";
import { DocumentShareDialog } from "@/components/communication/document-share-dialog";
import type { PrintRequest } from "@/lib/printing";

export function MillingDocumentWorkflow({
  document,
  onClose,
}: {
  document: MillingServiceDocumentCreated;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const [grainItemId, setGrainItemId] = useState("");
  const [bagsOut, setBagsOut] = useState("");
  const [kgOut, setKgOut] = useState("");
  const [outputs, setOutputs] = useState<CustodyLine[]>([{ itemId: "", bags: 0, kg: 0 }]);
  const [millingNotes, setMillingNotes] = useState("");
  const [deliveryLines, setDeliveryLines] = useState<CustodyLine[]>([
    { itemId: "", bags: 0, kg: 0 },
  ]);
  const [deliveryNotes, setDeliveryNotes] = useState("");

  // الطباعة والمشاركة
  const [printRequest, setPrintRequest] = useState<PrintRequest | null>(null);
  const [printStage, setPrintStage] = useState<MillingTicketStage>("intake");
  const [shareOpen, setShareOpen] = useState(false);

  const outputsCatalog = useQuery({
    queryKey: ["milling", "output-items"],
    queryFn: fetchOutputItems,
  });

  const docQuery = useQuery({
    queryKey: ["milling", "document-details", document.document_id],
    queryFn: () => fetchMillingDocumentDetails(document.document_id),
  });

  const details = docQuery.data;

  // الضبط التلقائي لصنف الحبوب المطحونة من حبوب المستند المستلمة
  useEffect(() => {
    if (details?.intakeGrain && !grainItemId) {
      setGrainItemId(details.intakeGrain.itemId);
      if (details.intakeGrain.bagsRemaining > 0) {
        setBagsOut(String(details.intakeGrain.bagsRemaining));
      }
      if (details.intakeGrain.kgRemaining > 0) {
        setKgOut(String(details.intakeGrain.kgRemaining));
      }
    }
  }, [details?.intakeGrain, grainItemId]);

  const process = useMutation({
    mutationFn: () =>
      processMillingServiceDocument({
        documentId: document.document_id,
        grainItemId,
        bagsOut: Number(bagsOut) || 0,
        kgOut: Number(kgOut) || 0,
        outputs,
        notes: millingNotes || undefined,
      }),
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.message || "تعذر تسجيل الطحن.");
      setBagsOut("");
      setKgOut("");
      setOutputs([{ itemId: "", bags: 0, kg: 0 }]);
      setMillingNotes("");
      void qc.invalidateQueries({ queryKey: ["milling"] });
      toast.success("تم تسجيل نواتج الطحن على المستند نفسه.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "خطأ غير متوقع"),
  });

  const deliver = useMutation({
    mutationFn: () =>
      deliverMillingServiceDocument({
        documentId: document.document_id,
        lines: deliveryLines,
        notes: deliveryNotes || undefined,
      }),
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.message || "تعذر تسجيل التسليم.");
      setDeliveryLines([{ itemId: "", bags: 0, kg: 0 }]);
      setDeliveryNotes("");
      void qc.invalidateQueries({ queryKey: ["milling"] });
      toast.success("تم تسجيل تسليم النواتج للعميل على المستند نفسه.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "خطأ غير متوقع"),
  });

  const hasGrainToProcess = Boolean(
    details?.intakeGrain &&
    (details.intakeGrain.bagsRemaining > 0 || details.intakeGrain.kgRemaining > 0),
  );

  const canProcess = Boolean(
    grainItemId &&
    (Number(bagsOut) > 0 || Number(kgOut) > 0) &&
    outputs.some((line) => line.itemId && (line.bags > 0 || line.kg > 0)),
  );

  const availableOutputsForDelivery = (details?.outputsSummary ?? []).filter(
    (o) => o.bagsRemaining > 0 || o.kgRemaining > 0,
  );

  const canDeliver =
    Boolean(details?.outputsSummary?.length) &&
    deliveryLines.some((line) => line.itemId && (line.bags > 0 || line.kg > 0));

  const handlePrint = (stage: "intake" | "milled" | "delivery") => {
    if (!details) return;
    setPrintStage(stage);
    const docData = buildMillingDocumentUnifiedDoc(details, stage);
    setPrintRequest({
      documentType: stage === "delivery" ? "delivery_note" : "mill_document",
      doc: docData,
    });
  };

  const invoice = details?.sales_invoices;
  const invTotal = Number(invoice?.total ?? 0);
  const invPaid = Number(invoice?.paid ?? 0);
  const invRemaining = Math.max(0, invTotal - invPaid);

  return (
    <section className="space-y-4">
      {/* شريط رأس المستند المفتوح */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">
                مستند المطحنة:{" "}
                <Mono className="text-primary font-bold">{document.document_number}</Mono>
              </h3>
              {details?.status === "DELIVERED" ? (
                <Pill tone="emerald">تم التسليم بالكامل</Pill>
              ) : details?.status === "PROCESSED" ? (
                <Pill tone="amber">تم الطحن — بانتظار التسليم</Pill>
              ) : (
                <Pill tone="neutral">مستلم — بانتظار الطحن</Pill>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              العميل: <strong className="text-foreground">{details?.customers?.name || "—"}</strong>
              {details?.customers?.phone ? ` (${details.customers.phone})` : ""} | المخزن:{" "}
              {details?.warehouses?.name_ar || details?.warehouses?.name || "—"}
            </p>
          </div>
        </div>

        {/* أزرار الإجراءات السريعة: طباعة ومشاركة */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              handlePrint(
                details?.status === "DELIVERED"
                  ? "delivery"
                  : details?.status === "PROCESSED"
                    ? "milled"
                    : "intake",
              )
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-xs transition hover:bg-muted"
          >
            <Printer className="h-3.5 w-3.5 text-primary" />
            طباعة المستند
          </button>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700"
          >
            <Share2 className="h-3.5 w-3.5" />
            واتساب ومشاركة
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              إغلاق المستند
            </button>
          )}
        </div>
      </div>

      {/* بطاقة الفاتورة الرسمية المرتبطة دائماً */}
      <div className="grid gap-3 sm:grid-cols-4 rounded-xl border border-border/80 bg-card p-3.5 text-xs">
        <div>
          <span className="text-muted-foreground block text-[11px]">الفاتورة الرسمية:</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Receipt className="h-3.5 w-3.5 text-amber-500" />
            <Mono className="font-bold">#{document.invoice_number}</Mono>
            <Link
              to="/sales"
              className="text-primary hover:underline text-[11px] inline-flex items-center gap-0.5"
            >
              عرض <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
        <div>
          <span className="text-muted-foreground block text-[11px]">إجمالي الأجور:</span>
          <span className="font-bold text-foreground text-sm">{fmtNum(invTotal)}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[11px]">المدفوع:</span>
          <span className="font-bold text-emerald-600">{fmtNum(invPaid)}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[11px]">المتبقي (ذمة):</span>
          {invRemaining > 0 ? (
            <span className="font-bold text-rose-600">{fmtNum(invRemaining)}</span>
          ) : (
            <span className="font-bold text-emerald-600">مسدد بالكامل</span>
          )}
        </div>
      </div>

      {/* الحبوب المستلمة في هذا المستند */}
      {details?.intakeGrain && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-blue-900 dark:text-blue-200">
              الحبوب المستلمة في هذا المستند: {details.intakeGrain.nameAr}
            </span>
            {details.intakeGrain.packageWeightKg && (
              <span className="text-muted-foreground">
                (سعة العبوة: {details.intakeGrain.packageWeightKg} كجم)
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 font-mono">
            <span>
              المستلم: {fmtNum(details.intakeGrain.bagsReceived)} كيس /{" "}
              {fmtNum(details.intakeGrain.kgReceived)} كجم
            </span>
            <span className="font-bold text-foreground">
              المتبقي للطحن: {fmtNum(details.intakeGrain.bagsRemaining)} كيس /{" "}
              {fmtNum(details.intakeGrain.kgRemaining)} كجم
            </span>
          </div>
        </div>
      )}

      {/* منطقتا الطحن والتسليم */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 2. عملية الطحن */}
        <MillingPanel>
          <MillingSectionTitle
            icon={<Cog className="h-4 w-4" />}
            title="2. عملية الطحن"
            subtitle="تسجيل الحبوب المطحونة ونواتجها تحت نفس المستند والفاتورة."
          />
          <div className="space-y-3 p-4">
            {!hasGrainToProcess ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                تم طحن جميع الحبوب المستلمة في هذا المستند بنجاح.
              </div>
            ) : (
              <>
                <MillingField
                  label="الحبوب المطحونة (خاصة بهذا المستند)"
                  hint="لا يُخلط رصيد مستند آخر مع هذا المستند."
                >
                  <MillingSelect
                    value={grainItemId}
                    onChange={(e) => setGrainItemId(e.target.value)}
                  >
                    {details?.intakeGrain && (
                      <option value={details.intakeGrain.itemId}>
                        {details.intakeGrain.nameAr} — المتبقي:{" "}
                        {fmtNum(details.intakeGrain.bagsRemaining)} كيس /{" "}
                        {fmtNum(details.intakeGrain.kgRemaining)} كجم
                      </option>
                    )}
                  </MillingSelect>
                </MillingField>

                <div className="grid grid-cols-2 gap-3">
                  <MillingField label="الأكياس المطحونة">
                    <QuantityInput
                      value={bagsOut === "" ? null : Number(bagsOut)}
                      onValueChange={(v) => setBagsOut(v == null ? "" : String(v))}
                      decimals={0}
                      min={0}
                      placeholder="0"
                    />
                  </MillingField>
                  <MillingField label="الوزن المطحون (كجم)">
                    <QuantityInput
                      value={kgOut === "" ? null : Number(kgOut)}
                      onValueChange={(v) => setKgOut(v == null ? "" : String(v))}
                      decimals={3}
                      min={0}
                      unit="kg"
                      placeholder="0"
                    />
                  </MillingField>
                </div>

                {details?.intakeGrain && (
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                    <span className="text-blue-900 dark:text-blue-200">
                      <strong>المتبقي كحبوب خام لم تُطحن:</strong>{" "}
                      {fmtNum(
                        Math.max(0, details.intakeGrain.bagsRemaining - (Number(bagsOut) || 0)),
                      )}{" "}
                      كيس (
                      {fmtNum(Math.max(0, details.intakeGrain.kgRemaining - (Number(kgOut) || 0)))}{" "}
                      كجم)
                    </span>
                    <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                      ✓ يبقى في رصيد العميل العيني ولا يُسجل كفاقد.
                    </span>
                  </div>
                )}

                <LinesEditor
                  lines={outputs}
                  setLines={setOutputs}
                  items={outputsCatalog.data ?? []}
                  label="نواتج الطحن المسجلة للعميل (دقيق / نخالة / إلخ)"
                />

                <MillingField label="ملاحظات الطحن">
                  <MillingTextarea
                    value={millingNotes}
                    onChange={(e) => setMillingNotes(e.target.value)}
                    placeholder="ملاحظات تشغيلية اختيارية…"
                  />
                </MillingField>

                <button
                  type="button"
                  disabled={!canProcess || process.isPending}
                  onClick={() => process.mutate()}
                  className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50"
                >
                  {process.isPending ? "جارٍ تسجيل الطحن…" : "تسجيل نواتج الطحن"}
                </button>
              </>
            )}

            {/* ملخص النواتج المسجلة */}
            {details?.outputsSummary && details.outputsSummary.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/70 pt-3">
                <span className="text-[11px] font-bold text-muted-foreground block">
                  النواتج المقيدة على هذا المستند:
                </span>
                {details.outputsSummary.map((out) => (
                  <div
                    key={out.itemId}
                    className="flex items-center justify-between rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-bold text-foreground">{out.nameAr}</span>
                    <Mono>
                      المسجل: {fmtNum(out.bagsProduced)} كيس ({fmtNum(out.kgProduced)} كجم) |
                      المتبقي: {fmtNum(out.bagsRemaining)} كيس
                    </Mono>
                  </div>
                ))}
              </div>
            )}
          </div>
        </MillingPanel>

        {/* 3. تسليم العميل */}
        <MillingPanel>
          <MillingSectionTitle
            icon={<PackageCheck className="h-4 w-4" />}
            title="3. تسليم العميل"
            subtitle="يسلم فقط ما تم طحنه وما تبقى من هذا المستند حصراً."
          />
          <div className="space-y-3 p-4">
            {availableOutputsForDelivery.length === 0 ? (
              <div className="rounded-xl bg-muted/60 p-4 text-center text-xs text-muted-foreground">
                {details?.status === "DELIVERED" ? (
                  <div className="flex items-center justify-center gap-2 font-bold text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                    تم تسليم كل نواتج المستند للعميل بالكامل.
                  </div>
                ) : (
                  "سجّل نواتج الطحن أولاً لتتمكن من تسليمها للعميل."
                )}
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs">
                  <span className="font-bold text-emerald-900 dark:text-emerald-200 block mb-1">
                    المتاح للتسليم من هذا المستند:
                  </span>
                  {availableOutputsForDelivery.map((o) => (
                    <div key={o.itemId} className="flex justify-between text-[11px]">
                      <span>{o.nameAr}</span>
                      <Mono>
                        {fmtNum(o.bagsRemaining)} كيس / {fmtNum(o.kgRemaining)} كجم
                      </Mono>
                    </div>
                  ))}
                </div>

                <LinesEditor
                  lines={deliveryLines}
                  setLines={setDeliveryLines}
                  items={availableOutputsForDelivery.map((b) => ({
                    id: b.itemId,
                    name: b.nameAr,
                    name_ar: b.nameAr,
                  }))}
                  label="الأصناف والكميات المسلّمة الآن"
                />

                <MillingField label="ملاحظات التسليم">
                  <MillingTextarea
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="اسم المستلم، رقم السند اليدوي، إلخ…"
                  />
                </MillingField>

                <button
                  type="button"
                  disabled={!canDeliver || deliver.isPending}
                  onClick={() => deliver.mutate()}
                  className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {deliver.isPending ? "جارٍ تسجيل التسليم…" : "تسجيل تسليم للعميل"}
                </button>
              </>
            )}
          </div>
        </MillingPanel>
      </div>

      {/* قالب فاتورة وإيصال المطحنة الموحد الأنيق */}
      {printRequest && details && (
        <UnifiedPrintModal
          open={Boolean(printRequest)}
          onClose={() => setPrintRequest(null)}
          details={details}
          doc={printRequest.doc}
          stage={printStage}
        />
      )}

      {/* نافذة مشاركة الواتساب الموحدة */}
      {shareOpen && details && (
        <DocumentShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title="مشاركة مستند المطحنة وفاتورة الأجور"
          documentType="milling_document"
          millingDocumentNumber={details.document_number}
          millingStatus={
            details.status === "DELIVERED"
              ? "تم التسليم بالكامل"
              : details.status === "PROCESSED"
                ? "تم الطحن"
                : "مستلم"
          }
          customer={{
            id: details.customer_id,
            name: details.customers?.name || "العميل",
            phone: details.customers?.phone || null,
            balance: invRemaining,
          }}
          invoice={{
            id: details.sales_invoice_id,
            invoiceNumber: document.invoice_number,
            date: details.received_at,
            subtotal: invTotal,
            total: invTotal,
            paid: invPaid,
            remaining: invRemaining,
          }}
        />
      )}
    </section>
  );
}

function LinesEditor({
  lines,
  setLines,
  items,
  label,
}: {
  lines: CustodyLine[];
  setLines: Dispatch<SetStateAction<CustodyLine[]>>;
  items: { id: string; name: string; name_ar: string | null }[];
  label: string;
}) {
  const update = (index: number, patch: Partial<CustodyLine>) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-muted-foreground">{label}</label>
        <button
          type="button"
          onClick={() => setLines((rows) => [...rows, { itemId: "", bags: 0, kg: 0 }])}
          className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          إضافة سطر
        </button>
      </div>
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-[1fr_72px_88px_28px] gap-2 items-center">
          <MillingSelect
            value={line.itemId}
            onChange={(e) => update(index, { itemId: e.target.value })}
          >
            <option value="">اختر الصنف…</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name_ar || item.name}
              </option>
            ))}
          </MillingSelect>
          <QuantityInput
            decimals={0}
            min={0}
            emptyAsZero
            placeholder="أكياس"
            aria-label="أكياس"
            value={line.bags || null}
            onValueChange={(v) => update(index, { bags: v ?? 0 })}
          />
          <QuantityInput
            decimals={3}
            min={0}
            emptyAsZero
            placeholder="كجم"
            aria-label="كجم"
            unit="kg"
            value={line.kg || null}
            onValueChange={(v) => update(index, { kg: v ?? 0 })}
          />
          <button
            type="button"
            disabled={lines.length === 1}
            onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
            className="text-rose-500 hover:text-rose-700 disabled:opacity-30"
            aria-label="حذف السطر"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
