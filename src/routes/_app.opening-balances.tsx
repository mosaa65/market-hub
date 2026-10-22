/**
 * /opening-balances — إدارة وترحيل الأرصدة الافتتاحية.
 *
 * مراجعة وإصلاح شامل طبقاً لخطة الماستر بلان (DOC-MILLING-ERP-MASTER-2026-V2-AUDITED):
 * 1. دعم إدخال أرصدة المخزون بالأكياس وسعة الكيس أو بالكيلو مع الحساب التلقائي للوزن والتكلفة.
 * 2. الحساب التلقائي لمبلغ البند (الكمية × التكلفة) لمنع أخطاء الإدخال اليدوي.
 * 3. زر موازنة القيد التلقائي برأس المال (حـ/ 3111) بنقرة واحدة لتسوية الفرق فوراً وتسهيل الترحيل.
 * 4. إمكانية حذف أي سطر من المسودة بنقرة واحدة.
 * 5. ربط دقيق مع دليل الحسابات لحسابات الصندوق، البنوك، والأصول الثابتة.
 * 6. تصميم فخم يتماشى مع لغة تصميم كروت وبطاقات وأزرار المنتجات الحديثة.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import {
  BookOpen,
  CheckCircle2,
  Scale,
  TriangleAlert,
  Undo2,
  Trash2,
  Plus,
  Pencil,
  Sparkles,
  Package,
  Layers,
  Landmark,
  ArrowRightLeft,
  Building2,
  Wallet,
  Coins,
  ShieldCheck,
  FileCheck,
} from "lucide-react";

import { ModuleGuard } from "@/lib/modules";
import {
  OPENING_SECTIONS,
  createOpeningDocument,
  fetchCustomers,
  fetchOpeningDocuments,
  fetchOpeningLines,
  fetchStockableItems,
  fetchSuppliers,
  fetchWarehouses,
  fetchAccounts,
  postOpeningDocument,
  reverseOpeningDocument,
  yer,
  type OpeningLineDraft,
  type OpeningSection,
  type OpeningSummary,
  updateOpeningDocument,
} from "@/lib/opening-balances";
import { PageHeader } from "@/components/page-header";
import { AmountInput } from "@/components/ui/amount-input";
import { QuantityInput } from "@/components/ui/quantity-input";
import {
  Cell,
  MillingEmpty,
  MillingPanel,
  MillingRow,
  MillingSectionTitle,
  MillingTable,
  Mono,
  Pill,
  QueryErrorGuard,
  StatTile,
} from "@/components/milling/milling-ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/opening-balances")({
  component: OpeningBalancesPage,
});

export function OpeningBalancesPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<OpeningLineDraft[]>([]);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [section, setSection] = useState<OpeningSection>("STOCK");
  const [amount, setAmount] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [refId, setRefId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [selectedAccountCode, setSelectedAccountCode] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));

  // إدارة الأكياس للمخزون
  const [stockInputMode, setStockInputMode] = useState<"bags" | "kg">("bags");
  const [bagsCount, setBagsCount] = useState("");
  const [bagCapacityKg, setBagCapacityKg] = useState("50");
  const [bagCost, setBagCost] = useState("");

  const documents = useQuery({
    queryKey: ["opening", "documents"],
    queryFn: fetchOpeningDocuments,
  });
  const items = useQuery({ queryKey: ["opening", "items"], queryFn: fetchStockableItems });
  const customers = useQuery({ queryKey: ["opening", "customers"], queryFn: fetchCustomers });
  const suppliers = useQuery({ queryKey: ["opening", "suppliers"], queryFn: fetchSuppliers });
  const warehouses = useQuery({ queryKey: ["opening", "warehouses"], queryFn: fetchWarehouses });
  const accounts = useQuery({ queryKey: ["opening", "accounts"], queryFn: fetchAccounts });

  const lines = useQuery({
    queryKey: ["opening", "lines", selectedId],
    queryFn: () => fetchOpeningLines(selectedId!),
    enabled: Boolean(selectedId),
  });

  const selected = documents.data?.find((d) => d.id === selectedId) ?? null;
  const meta = OPENING_SECTIONS.find((s) => s.value === section)!;
  const selectedItem = items.data?.find((i) => i.id === refId);

  // تعيين المستودع الافتراضي تلقائياً
  useEffect(() => {
    if (!warehouseId && warehouses.data?.length) {
      setWarehouseId(warehouses.data[0].id);
    }
  }, [warehouses.data, warehouseId]);

  // تحديث سعة الكيس التلقائية عند اختيار الصنف
  useEffect(() => {
    if (selectedItem?.package_weight_kg) {
      setBagCapacityKg(String(selectedItem.package_weight_kg));
    }
    if (selectedItem?.cost_price && !unitCost) {
      setUnitCost(String(selectedItem.cost_price));
    }
  }, [selectedItem]);

  // احتساب كمية وتكلفة المخزون تلقائياً عند تغيير الأكياس
  useEffect(() => {
    if (section !== "STOCK" || stockInputMode !== "bags") return;
    const bags = Number(bagsCount) || 0;
    const cap = Number(bagCapacityKg) || 50;
    const bCost = Number(bagCost) || 0;

    if (bags > 0 && cap > 0) {
      const calculatedKg = bags * cap;
      setQty(String(calculatedKg));

      if (bCost > 0) {
        const costPerKg = bCost / cap;
        setUnitCost(String(roundNum(costPerKg)));
        setAmount(String(roundNum(bags * bCost)));
      }
    }
  }, [bagsCount, bagCapacityKg, bagCost, section, stockInputMode]);

  // احتساب المبلغ التلقائي عند تغيير الكمية والتكلفة المباشرة
  const handleQtyOrCostChange = (newQty: string, newCost: string) => {
    setQty(newQty);
    setUnitCost(newCost);
    const q = Number(newQty) || 0;
    const c = Number(newCost) || 0;
    if (q > 0 && c > 0) {
      setAmount(String(roundNum(q * c)));
    }
  };

  const draftTotals = useMemo(() => {
    const debitSections: OpeningSection[] = ["STOCK", "RECEIVABLE", "CASH", "BANK", "ASSET"];
    const debit = draft
      .filter((l) => debitSections.includes(l.section))
      .reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const credit = draft
      .filter((l) => !debitSections.includes(l.section))
      .reduce((s, l) => s + (Number(l.amount) || 0), 0);
    return { debit, credit, diff: debit - credit };
  }, [draft]);

  const run = <TData, TVars>(
    fn: (v: TVars) => Promise<TData>,
    okMessage: string,
    afterSuccess?: (data: TData) => void,
  ) => ({
    mutationFn: fn,
    onSuccess: (data: TData) => {
      setError(null);
      setNotice(okMessage);
      afterSuccess?.(data);
      void qc.invalidateQueries({ queryKey: ["opening"] });
    },
    onError: (e: Error) => {
      setNotice(null);
      setError(e.message);
    },
  });

  const save = useMutation(
    run<string, void>(async () => {
      if (draft.length === 0) throw new Error("أضف بنداً واحداً على الأقل إلى القيد الافتتاحي");
      if (editingDocumentId) {
        return updateOpeningDocument({
          documentId: editingDocumentId,
          effectiveDate,
          lines: draft,
        });
      }
      return createOpeningDocument({ effectiveDate, lines: draft });
    }, "تم حفظ مسودة القيد الافتتاحي بنجاح", () => {
      setDraft([]);
      setEditingDocumentId(null);
      setAmount("");
      setQty("");
      setUnitCost("");
      setBagsCount("");
      setBagCost("");
      setRefId("");
      setSelectedAccountCode("");
      setSelectedId(null);
    }),
  );

  const editDraft = async (document: OpeningSummary) => {
    try {
      setError(null);
      const savedLines = await fetchOpeningLines(document.id);
      setDraft(savedLines.map((line) => ({
        section: line.section,
        description: line.description,
        amount: Number(line.amount),
        product_id: line.product_id,
        warehouse_id: line.warehouse_id,
        customer_id: line.customer_id,
        supplier_id: line.supplier_id,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        ledger_account_code: line.ledger_account_code,
      })));
      setEffectiveDate(document.effective_date);
      setEditingDocumentId(document.id);
      setSelectedId(document.id);
      setNotice(`تعديل مسودة ${document.document_number}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر تحميل المسودة للتعديل");
    }
  };

  const cancelDraftEdit = () => {
    setDraft([]);
    setEditingDocumentId(null);
    setSelectedId(null);
    setError(null);
    setNotice("تم إلغاء تعديل المسودة");
  };

  const post = useMutation(
    run<void, string>(
      async (id) => postOpeningDocument(id),
      "تم ترحيل القيد الافتتاحي بنجاح إلى دفتر الأستاذ والمخازن",
    ),
  );

  const reverse = useMutation(
    run<void, { id: string; reason: string }>(
      async (v) => reverseOpeningDocument(v.id, v.reason),
      "تم عكس القيد الافتتاحي بنجاح",
    ),
  );

  // إضافة سطر جديد للمسودة
  const addLine = () => {
    const val = Number(amount);
    if (!val || val <= 0) {
      setError("المبلغ يجب أن يكون أكبر من صفر");
      return;
    }
    if (meta.needsRef === "item" && (!refId || !warehouseId)) {
      setError("بند المخزون يتطلب تحديد الصنف والمستودع");
      return;
    }
    if (meta.needsRef === "customer" && !refId) {
      setError("بند ذمم العملاء يتطلب اختيار العميل");
      return;
    }
    if (meta.needsRef === "supplier" && !refId) {
      setError("بند ذمم الموردين يتطلب اختيار المورد");
      return;
    }

    const q = Number(qty) || null;
    const uc = Number(unitCost) || null;

    let desc = meta.label;
    if (section === "STOCK" && selectedItem) {
      const itemTitle = selectedItem.name_ar || selectedItem.name || selectedItem.sku;
      if (stockInputMode === "bags" && Number(bagsCount) > 0) {
        desc = `مخزون افتتاحي: ${bagsCount} كيس سعة ${bagCapacityKg} كجم — ${itemTitle}`;
      } else {
        desc = `مخزون افتتاحي: ${q} كجم — ${itemTitle}`;
      }
    } else if (section === "RECEIVABLE") {
      const c = customers.data?.find((x) => x.id === refId);
      desc = `رصيد افتتاحي عميل: ${c?.name ?? ""}`;
    } else if (section === "PAYABLE") {
      const s = suppliers.data?.find((x) => x.id === refId);
      desc = `رصيد افتتاحي مورد: ${s?.name ?? ""}`;
    } else if (section === "CASH") {
      desc = "رصيد نقدية الصندوق الافتتاحي (حـ/ 1101)";
    } else if (section === "BANK") {
      const acct = accounts.data?.find((a) => a.code === selectedAccountCode);
      desc = `رصيد بنكي / محفظة: ${acct ? `${acct.name_ar} (${acct.code})` : "حـ/ 1111"}`;
    } else if (section === "ASSET") {
      const acct = accounts.data?.find((a) => a.code === selectedAccountCode);
      desc = `أصول ثابتة: ${acct ? `${acct.name_ar} (${acct.code})` : "حـ/ 1411"}`;
    }

    setDraft((d) => [
      ...d,
      {
        section,
        description: desc,
        amount: val,
        quantity: q,
        unit_cost: uc,
        product_id: meta.needsRef === "item" ? refId : null,
        warehouse_id: meta.needsRef === "item" ? warehouseId : null,
        customer_id: meta.needsRef === "customer" ? refId : null,
        supplier_id: meta.needsRef === "supplier" ? refId : null,
        ledger_account_code: selectedAccountCode || meta.defaultAccountCode,
      },
    ]);

    setError(null);
    setAmount("");
    setQty("");
    setUnitCost("");
    setBagsCount("");
    setBagCost("");
    setRefId("");
    setSelectedAccountCode("");
  };

  // زر الموازنة التلقائية السريعة برأس المال
  const handleAutoBalanceCapital = () => {
    if (draftTotals.diff <= 0) return;
    const balanceAmount = draftTotals.diff;

    setDraft((d) => [
      ...d,
      {
        section: "CAPITAL",
        description: "رأس المال الافتتاحي الموازن للقيد (حـ/ 3111)",
        amount: balanceAmount,
        ledger_account_code: "3111",
      },
    ]);
    setNotice("تمت موازنة القيد الافتتاحي برأس المال بنجاح");
  };

  const removeDraftLine = (index: number) => {
    setDraft((d) => d.filter((_, i) => i !== index));
  };

  // فلترة الحسابات حسب القسم
  const relevantAccounts = useMemo(() => {
    if (!accounts.data) return [];
    if (section === "BANK") {
      return accounts.data.filter(
        (a) => a.code.startsWith("111") || a.code.startsWith("112") || a.code.startsWith("113"),
      );
    }
    if (section === "ASSET") {
      return accounts.data.filter((a) => a.code.startsWith("14"));
    }
    if (section === "LIABILITY") {
      return accounts.data.filter((a) => a.code.startsWith("21") || a.code.startsWith("22"));
    }
    return [];
  }, [accounts.data, section]);

  return (
    <ModuleGuard moduleId="expenses">
      <div className="mx-auto max-w-6xl space-y-5 p-3 sm:p-5">
        <PageHeader
          title="الأرصدة الافتتاحية للمنشأة"
          subtitle="تسجيل وموازنة قيد افتتاح الدفاتر المحاسبية والمخازن لضبط الجرد المستمر وحسابات الأستاذ العام."
        />

        <QueryErrorGuard
          error={
            documents.error ?? items.error ?? customers.error ?? suppliers.error ?? warehouses.error
          }
        />

        {/* ─── البطاقة العلوية: إضافة بند جديد ─── */}
        <MillingPanel>
          <div className="border-b border-border/70 p-4 sm:p-5">
            <MillingSectionTitle
              icon={<BookOpen className="h-4 w-4 text-primary" />}
              title="إعداد القيد الافتتاحي وإضافة البنود"
              subtitle="اختر القسم ثم أدخل الأرصدة (المخزون يدعم الأكياس والكيلو وحساب التكلفة تلقائياً)"
            />
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            {/* الصف الأول: التاريخ والقسم */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-foreground">
                  تاريخ سريان القيد الافتتاحي *
                </label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-foreground">
                  قسم الرصيد الافتتاحي *
                </label>
                <select
                  value={section}
                  onChange={(e) => {
                    const next = e.target.value as OpeningSection;
                    setSection(next);
                    setRefId("");
                    setAmount("");
                    setQty("");
                    setUnitCost("");
                    setSelectedAccountCode("");
                  }}
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60"
                >
                  {OPENING_SECTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label} ({s.defaultAccountCode})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col justify-end text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-xl border border-border/60">
                <span className="font-semibold text-foreground">التوجيه المحاسبي:</span>
                <span className="text-[11px] leading-relaxed mt-0.5">{meta.hint}</span>
              </div>
            </div>

            {/* تفاصيل بند المخزون (أكياس وسعة وكيلو) */}
            {section === "STOCK" && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/15 pb-3">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">
                      بيانات مخزون الصنف والمستودع
                    </span>
                  </div>

                  {/* تبديل نمط الإدخال: أكياس أو كجم */}
                  <div className="flex items-center rounded-xl border border-border bg-surface p-1">
                    <button
                      type="button"
                      onClick={() => setStockInputMode("bags")}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-bold transition",
                        stockInputMode === "bags"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      بالأكياس والسعة
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockInputMode("kg")}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-bold transition",
                        stockInputMode === "kg"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      بالكيلوجرام مباشر
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-foreground">
                      صنف المخزون *
                    </label>
                    <select
                      value={refId}
                      onChange={(e) => setRefId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60"
                    >
                      <option value="">— اختر الصنف —</option>
                      {(items.data ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.sku} · {i.name_ar || i.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-foreground">
                      المستودع المستلم *
                    </label>
                    <select
                      value={warehouseId}
                      onChange={(e) => setWarehouseId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60"
                    >
                      <option value="">— اختر المستودع —</option>
                      {(warehouses.data ?? []).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name_ar || w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {stockInputMode === "bags" ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-foreground">
                        عدد الأكياس *
                      </label>
                      <QuantityInput
                        min={0}
                        decimals={0}
                        placeholder="مثال: 100"
                        aria-label="عدد الأكياس"
                        value={toNumberOrNull(bagsCount)}
                        onValueChange={(v) => setBagsCount(v == null ? "" : String(v))}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-foreground">
                        سعة الكيس (كجم) *
                      </label>
                      <QuantityInput
                        min={0}
                        decimals={3}
                        unit="kg"
                        placeholder="50"
                        aria-label="سعة الكيس (كجم)"
                        value={toNumberOrNull(bagCapacityKg)}
                        onValueChange={(v) => setBagCapacityKg(v == null ? "" : String(v))}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-foreground">
                        تكلفة الكيس الواحد *
                      </label>
                      <AmountInput
                        min={0}
                        placeholder="مثال: 22000"
                        aria-label="تكلفة الكيس الواحد"
                        value={toNumberOrNull(bagCost)}
                        onValueChange={(v) => setBagCost(v == null ? "" : String(v))}
                        wordsClassName="text-[10px] leading-3"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-foreground">
                        الوزن الإجمالي (كجم) *
                      </label>
                      <QuantityInput
                        min={0}
                        decimals={3}
                        placeholder="مثال: 5000"
                        aria-label="الوزن الإجمالي (كجم)"
                        value={toNumberOrNull(qty)}
                        onValueChange={(v) =>
                          handleQtyOrCostChange(v == null ? "" : String(v), unitCost)
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-foreground">
                        تكلفة الكيلوجرام الواحد *
                      </label>
                      <AmountInput
                        min={0}
                        placeholder="مثال: 440"
                        aria-label="تكلفة الكيلوجرام الواحد"
                        value={toNumberOrNull(unitCost)}
                        onValueChange={(v) =>
                          handleQtyOrCostChange(qty, v == null ? "" : String(v))
                        }
                        wordsClassName="text-[10px] leading-3"
                      />
                    </div>
                  </div>
                )}

                {/* شريط الإيضاح المخزني اللحظي */}
                {Number(qty) > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface/80 p-2.5 text-xs text-muted-foreground border border-border/60">
                    <span>
                      إجمالي الوزن المخزني:{" "}
                      <strong className="text-foreground">
                        <Mono>{qty}</Mono> كجم
                      </strong>
                      {unitCost && (
                        <span>
                          {" "}
                          (تكلفة الكيلو:{" "}
                          <strong className="text-foreground">
                            <Mono>{unitCost}</Mono>
                          </strong>
                          )
                        </span>
                      )}
                    </span>
                    <span>
                      القيمة الإجمالية:{" "}
                      <strong className="text-primary font-mono text-sm">
                        {yer(Number(amount))}
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* تفاصيل العملاء والموردين والبنوك والأصول */}
            {section !== "STOCK" && (
              <div className="grid gap-4 sm:grid-cols-2">
                {meta.needsRef === "customer" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      العميل المستحق عليه *
                    </label>
                    <select
                      value={refId}
                      onChange={(e) => setRefId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60"
                    >
                      <option value="">— اختر العميل —</option>
                      {(customers.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {meta.needsRef === "supplier" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      المورد الدائن *
                    </label>
                    <select
                      value={refId}
                      onChange={(e) => setRefId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60"
                    >
                      <option value="">— اختر المورد —</option>
                      {(suppliers.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {relevantAccounts.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      تحديد الحساب المالي المحدد من دليل الحسابات
                    </label>
                    <select
                      value={selectedAccountCode}
                      onChange={(e) => setSelectedAccountCode(e.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60"
                    >
                      <option value="">— الحساب الافتراضي ({meta.defaultAccountCode}) —</option>
                      {relevantAccounts.map((a) => (
                        <option key={a.id} value={a.code}>
                          {a.code} — {a.name_ar}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* صف المبلغ النهائي وزر الإضافة */}
            <div className="flex flex-col sm:flex-row items-end justify-between gap-3 pt-2">
              <div className="w-full sm:w-72">
                <label className="mb-1 block text-xs font-bold text-foreground">
                  المبلغ المالي للبند (ر.ي) *
                </label>
                {/* المبلغ المُوحّد: فاصلة آلاف + تفقيط + رمز العملة من الإعدادات. */}
                <AmountInput
                  min={0}
                  aria-label="المبلغ المالي للبند"
                  value={toNumberOrNull(amount)}
                  onValueChange={(v) => setAmount(v == null ? "" : String(v))}
                  placeholder="0.00"
                  wordsClassName="text-xs"
                  containerClassName="[&_input]:h-12 [&_input]:rounded-xl [&_input]:px-4 [&_input]:text-lg [&_input]:font-black"
                />
              </div>

              <button
                type="button"
                onClick={addLine}
                className="w-full sm:w-auto h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground shadow-md shadow-primary/20 transition hover:bg-primary/90 active:scale-95"
              >
                <Plus className="h-4 w-4" /> إضافة البند إلى مسودة القيد
              </button>
            </div>
          </div>

          {/* ── جدول المسودة والتوازن ── */}
          {draft.length > 0 && (
            <div className="border-t border-border/70 p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  بنود مسودة القيد الحالية ({draft.length})
                </h4>
                {draftTotals.diff > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoBalanceCapital}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition active:scale-95"
                    title="إضافة بند رأس المال لموازنة القيد فوراً"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    <span>
                      ⚡ موازنة القيد آلياً برأس المال (حـ/ 3111: {yer(Math.abs(draftTotals.diff))})
                    </span>
                  </button>
                )}
              </div>
              {draftTotals.diff < 0 && (
                <p className="text-xs font-semibold text-rose-600" role="status">
                  الأرصدة الدائنة تتجاوز المدينة بمقدار {yer(Math.abs(draftTotals.diff))}. صحّح بندًا دائنًا قبل الموازنة؛ إضافة رأس المال ستزيد الفرق.
                </p>
              )}

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-surface/40">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/70 bg-muted/30 text-start text-muted-foreground">
                      <th className="p-3 text-start font-semibold">القسم</th>
                      <th className="p-3 text-start font-semibold">الحساب</th>
                      <th className="p-3 text-start font-semibold">البيان والتفاصيل</th>
                      <th className="p-3 text-end font-semibold">المبلغ (ر.ي)</th>
                      <th className="p-3 text-center w-12">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {draft.map((l, i) => {
                      const isDebit = ["STOCK", "RECEIVABLE", "CASH", "BANK", "ASSET"].includes(
                        l.section,
                      );
                      return (
                        <tr key={i} className="hover:bg-muted/30 transition">
                          <td className="p-3">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold",
                                isDebit
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                  : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                              )}
                            >
                              {OPENING_SECTIONS.find((s) => s.value === l.section)?.label} (
                              {isDebit ? "مدين" : "دائن"})
                            </span>
                          </td>
                          <td className="p-3 font-mono text-muted-foreground">
                            {l.ledger_account_code || "—"}
                          </td>
                          <td className="p-3 text-foreground font-medium">
                            {l.quantity ? `${l.quantity} كجم × ${l.unit_cost} — ` : ""}
                            {l.description}
                          </td>
                          <td className="p-3 text-end font-mono font-bold text-foreground">
                            {yer(l.amount)}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => removeDraftLine(i)}
                              className="grid h-7 w-7 place-items-center rounded-lg text-rose-500 hover:bg-rose-500/10 transition"
                              title="حذف البند"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* بطاقة ملخص توازن القيد */}
              <div className="grid gap-3 rounded-2xl border border-border/80 bg-surface/70 p-4 sm:grid-cols-4 items-center">
                <div>
                  <span className="text-[11px] text-muted-foreground block">
                    إجمالي المدين (الأصول)
                  </span>
                  <Mono className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {yer(draftTotals.debit)}
                  </Mono>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">
                    إجمالي الدائن (الخصوم والالتزامات)
                  </span>
                  <Mono className="text-base font-bold text-foreground">
                    {yer(draftTotals.credit)}
                  </Mono>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground block">
                    فرق التوازن الحسابي
                  </span>
                  <Mono
                    className={cn(
                      "text-base font-bold",
                      draftTotals.diff === 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600",
                    )}
                  >
                    {draftTotals.diff === 0 ? "✓ متوازن تماماً" : yer(draftTotals.diff)}
                  </Mono>
                </div>
                <div className="flex justify-end">
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    {editingDocumentId && (
                      <button
                        type="button"
                        onClick={cancelDraftEdit}
                        disabled={save.isPending}
                        className="h-11 rounded-xl border border-border px-5 text-xs font-bold text-muted-foreground transition hover:bg-muted disabled:opacity-50"
                      >
                        إلغاء التعديل
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => save.mutate(undefined)}
                      disabled={save.isPending || draft.length === 0}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground shadow-md shadow-primary/20 transition hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
                    >
                      <FileCheck className="h-4 w-4" />
                      {save.isPending
                        ? "جارٍ الحفظ…"
                        : editingDocumentId
                          ? "حفظ تعديلات المسودة"
                          : "حفظ القيد الافتتاحي كمسودة"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </MillingPanel>

        {/* تنبيهات ورسائل النجاح والخطأ */}
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-bold text-rose-700 dark:text-rose-300">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            <p>{error}</p>
          </div>
        )}

        {notice && !error && (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <p>{notice}</p>
          </div>
        )}

        {/* ─── بطاقة القيود المسجلة والمرحلة ─── */}
        <MillingPanel>
          <div className="border-b border-border/70 p-4 sm:p-5">
            <MillingSectionTitle
              icon={<Scale className="h-4 w-4 text-emerald-500" />}
              title="سجل قيود الأرصدة الافتتاحية"
              subtitle="يمكن ترحيل القيد فور توازنه، أو عكسه للمراجعة المحاسبية"
            />
          </div>

          {documents.isLoading ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              جارٍ تحميل القيود الافتتاحية…
            </p>
          ) : !documents.data?.length ? (
            <MillingEmpty
              title="لا توجد قيود افتتاحية مسجلة"
              hint="سجل قيدك الافتتاحي الأول من النموذج أعلاه."
            />
          ) : (
            <div className="overflow-x-auto p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/30 text-start text-muted-foreground">
                    <th className="p-3 text-start font-semibold">رقم المستند</th>
                    <th className="p-3 text-start font-semibold">التاريخ</th>
                    <th className="p-3 text-start font-semibold">الحالة</th>
                    <th className="p-3 text-end font-semibold">إجمالي المدين</th>
                    <th className="p-3 text-end font-semibold">إجمالي الدائن</th>
                    <th className="p-3 text-center font-semibold">حالة التوازن</th>
                    <th className="p-3 text-center font-semibold w-24">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {documents.data.map((d: OpeningSummary) => (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      className={cn(
                        "hover:bg-muted/40 transition cursor-pointer",
                        d.id === selectedId && "bg-muted/60",
                      )}
                    >
                      <td className="p-3 font-bold font-mono text-foreground">
                        {d.document_number}
                      </td>
                      <td className="p-3 text-muted-foreground">{d.effective_date}</td>
                      <td className="p-3">
                        <Pill
                          tone={
                            d.status === "POSTED"
                              ? "emerald"
                              : d.status === "REVERSED"
                                ? "rose"
                                : "amber"
                          }
                        >
                          {d.status === "POSTED"
                            ? "مرحَّل"
                            : d.status === "REVERSED"
                              ? "معكوس"
                              : "مسودة"}
                        </Pill>
                      </td>
                      <td className="p-3 text-end font-mono font-bold text-foreground">
                        {yer(d.total_debits)}
                      </td>
                      <td className="p-3 text-end font-mono font-bold text-foreground">
                        {yer(d.total_credits)}
                      </td>
                      <td className="p-3 text-center">
                        {d.status === "DRAFT" ? (
                          <Pill tone={d.is_balanced ? "emerald" : "rose"}>
                            {d.is_balanced ? "✓ متوازن" : `ناقص ${yer(d.capital_required_now)}`}
                          </Pill>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        {d.status === "DRAFT" && (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void editDraft(d)}
                              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                              title="تعديل المسودة"
                            >
                              <Pencil className="h-3 w-3" /> تعديل
                            </button>
                            <button
                              type="button"
                              onClick={() => post.mutate(d.id)}
                              disabled={!d.is_balanced || post.isPending}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-30"
                              title={d.is_balanced ? "ترحيل إلى الأستاذ والمخازن" : "القيد غير متوازن"}
                            >
                              ترحيل
                            </button>
                          </div>
                        )}
                        {d.status === "POSTED" && (
                          <button
                            type="button"
                            onClick={() => {
                              const reason = window.prompt("سبب عكس القيد الافتتاحي؟");
                              if (reason && reason.trim()) reverse.mutate({ id: d.id, reason });
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition"
                          >
                            <Undo2 className="h-3 w-3" /> عكس
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MillingPanel>

        {/* ─── تفاصيل بنود المستند المختار ─── */}
        {selected && (
          <MillingPanel>
            <div className="border-b border-border/70 p-4 sm:p-5">
              <MillingSectionTitle
                icon={<BookOpen className="h-4 w-4 text-primary" />}
                title={`بنود مستند ${selected.document_number}`}
                subtitle="تفاصيل الأسطر المسجلة وأطراف القيد المحاسبي"
              />
            </div>

            {lines.isLoading ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                جارٍ تحميل بنود المستند…
              </p>
            ) : !lines.data?.length ? (
              <MillingEmpty title="لا توجد بنود لهذا المستند" hint="" />
            ) : (
              <div className="overflow-x-auto p-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/70 bg-muted/30 text-start text-muted-foreground">
                      <th className="p-3 text-start font-semibold">القسم</th>
                      <th className="p-3 text-start font-semibold">طرف القيد</th>
                      <th className="p-3 text-start font-semibold">الحساب</th>
                      <th className="p-3 text-start font-semibold">البيان</th>
                      <th className="p-3 text-end font-semibold">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {lines.data.map((l) => (
                      <tr key={l.id} className="hover:bg-muted/30 transition">
                        <td className="p-3 font-semibold text-foreground">
                          {OPENING_SECTIONS.find((s) => s.value === l.section)?.label ?? l.section}
                        </td>
                        <td className="p-3">
                          <Pill tone={l.side === "DEBIT" ? "emerald" : "rose"}>
                            {l.side === "DEBIT" ? "مدين" : "دائن"}
                          </Pill>
                        </td>
                        <td className="p-3 font-mono text-muted-foreground">
                          {l.ledger_account_code || "—"}
                        </td>
                        <td className="p-3 text-muted-foreground">{l.description}</td>
                        <td className="p-3 text-end font-mono font-bold text-foreground">
                          {yer(l.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </MillingPanel>
        )}

        {/* بطاقات الإحصاء السفلية */}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            title="إجمالي القيود الافتتاحية"
            value={documents.data?.length ?? 0}
            tone="sky"
          />
          <StatTile
            title="قيود مرحَّلة نهائياً"
            value={(documents.data ?? []).filter((d) => d.status === "POSTED").length}
            tone="emerald"
          />
          <StatTile
            title="مسودات قيد غير متوازنة"
            value={
              (documents.data ?? []).filter((d) => d.status === "DRAFT" && !d.is_balanced).length
            }
            tone="amber"
          />
        </div>
      </div>
    </ModuleGuard>
  );
}

function roundNum(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * حالة النموذج تحتفظ بالمبلغ كسلسلة (تُرسل للدالة كما هي)، بينما `AmountInput`
 * يعمل بقيمة `number | null`. النص الفارغ أو غير الرقمي يصبح null بدل NaN.
 */
function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
