/**
 * Market-Hub ERP — Milling: grain grades & service agreements.
 *
 * Fase 0 (20261003000000) + Fase 1 (20261003010000) من
 * MILLING_SYSTEM_IMPROVEMENT_PLAN.md.
 *
 * -----------------------------------------------------------
 * نفصل هذا الملف عن `lib/milling/index.ts` عمداً:
 * ذاك طبقة الوصول المستقرة لRP الأربعة الأصلية (استلام/ أمر/ناتج/تسليم)،
 * وهذا امتدادات العقد والفحص. دمجهما كان سيعرّض وحدةً تعمل بالفعل.
 *
 * كل الكتابات عبر RPC — المتصفح لا يحمل INSERT على milling_* ولا على
 * milling_service_agreements إطلاقاً.
 * -----------------------------------------------------------
 */

import { supabase } from "@/integrations/supabase/client";
import { toLegacyPaymentValue } from "@/lib/payments/payment-methods";

/* الأنواع المولّدة لا تعرف مخطط `milling_*` بعد.
 * نفس الموقف الذي يأخذه `lib/milling/index.ts`: مخرج واحد موثّق. */
const db = supabase as any;

/* ------------------------------------------------------------------- tipos */

export interface GrainGrade {
  id: string;
  product_id: string;
  sku: string;
  product_name_ar: string;
  grade_code: string;
  grade_name_ar: string;
  origin: string | null;
  max_moisture: number;
  max_impurities: number;
  default_bag_size_kg: number;
  default_bag_type?: string | null;
  default_service_sku: string | null;
  is_active: boolean;
}

/** نتيجة `milling_match_grain_grade` — تنبيه لا منع. */
export interface GrainGradeCheck {
  grade_id: string | null;
  product_id?: string;
  grade_code?: string;
  grade_name_ar: string | null;
  max_moisture?: number;
  max_impurities?: number;
  default_bag_size_kg?: number;
  default_service_sku?: string | null;
  status: "OK" | "WARN" | "MISSING";
  severity: "success" | "warning" | "danger";
  message_ar: string;
}

/* --------------------------------------------------- 1. grados de medición */

export async function fetchGrainGrades(activeOnly = true): Promise<GrainGrade[]> {
  const { data, error } = await db
    .from("milling_grain_grades_view")
    .select("*")
    .order("grade_name_ar", { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as GrainGrade[];
  return activeOnly ? rows.filter((r) => r.is_active) : rows;
}

/**
 * يفحص الرطوبة والشوائب مقابل الحد الفني للدرجة.
 *
 * قرار المستخدم (2026-10-03): التجاوز يُعرض كتنبيه ولا يمنع التسجيل.
 * لذلك الدالة تُرجع حالة بدل أن ترمي استثناء.
 */
export async function checkGrainGrade(
  gradeId: string | null,
  moisture?: number | null,
  impurities?: number | null,
): Promise<GrainGradeCheck> {
  const { data, error } = await db.rpc("milling_match_grain_grade", {
    _grade_id: gradeId,
    _moisture: moisture ?? null,
    _impurities: impurities ?? null,
  });

  if (error) {
    return {
      grade_id: gradeId,
      grade_name_ar: null,
      status: "MISSING",
      severity: "danger",
      message_ar: error.message,
    };
  }

  return data as GrainGradeCheck;
}

/* -------------------------------------------- 2. عقود الطحن */

export type AgreementOutputType = "FLOUR_GRADE_1" | "FLOUR_GRADE_2" | "BRAN" | "SEMOLINA" | "WASTE";

export const AGREEMENT_OUTPUT_LABELS: Record<AgreementOutputType, string> = {
  FLOUR_GRADE_1: "دقيق نمرة 1 (فاخر)",
  FLOUR_GRADE_2: "دقيق نمرة 2 (بر)",
  BRAN: "نخالة (ردة مواشي)",
  SEMOLINA: "سميد",
  WASTE: "فاقد / شوائب",
};

export interface MillingAgreement {
  id: string;
  store_id: string;
  customer_id: string;
  customer_name_ar: string | null;
  intake_receipt_id: string;
  receipt_number: string;
  grain_grade_id: string | null;
  grade_name_ar: string | null;
  requested_output_type: AgreementOutputType | null;
  requested_output_note: string | null;
  output_bag_size_kg: number;
  bags_source: "CUSTOMER" | "MILL";
  delivery_mode: "FULL" | "PARTIAL";
  service_product_id: string | null;
  service_name_ar: string | null;
  price_basis: "BAG" | "TON";
  agreed_price: number;
  expected_extraction_rate: number;
  allowed_loss_percentage: number;
  status: "DRAFT" | "AGREED" | "CONSUMED" | "CANCELLED";
  agreed_at: string;
  notes: string | null;
}

export interface CreateAgreementInput {
  intakeReceiptId: string;
  /** مرجع فحص الحبوب. يجب أن يطابق درجة سند الاستلام. */
  grainGradeId: string;
  /** ما طلبه العميل. أصبح إلزامياً — كانت هذه الفجوة المركزية. */
  requestedOutputType: AgreementOutputType;
  requestedOutputNote?: string;
  outputBagSizeKg: number;
  bagsSource: "CUSTOMER" | "MILL";
  deliveryMode: "FULL" | "PARTIAL";
  serviceProductId?: string | null;
  /** أحدهما فقط. الاحتساب المزدوج مُنع في المرحلة 2. */
  priceBasis: "BAG" | "TON";
  agreedPrice: number;
  expectedExtractionRate: number;
  allowedLossPercentage: number;
  notes?: string;
}

export interface OpResult {
  ok: boolean;
  id?: string;
  message?: string;
}

/** بند تعبئة اختياري يُضاف إلى فاتورة الطحن (قرار Q3: الخياران معاً). */
export interface InvoiceJobV2Input {
  jobId: string;
  paymentMethod: string;
  paid?: number;
  discount?: number;
  note?: string;
  includePackaging?: boolean;
  /** بند أجور التعبئة والحياكة — مستقل عن أجرة الطحن. */
  includeSewing?: boolean;
  sewingPrice?: number;
}

/**
 * ينشئ عقد الطحن قبل الأمر.
 *
 * RPC يفرض: درجة الطلب إلزامية (وهذا هو الشرط الذي يعالج شكواك الأصلية)،
 * أساس سعر واحد، سعر أكبر من صفر، والخدمة يجب أن تكون صنف `SERVICE`.
 */
export async function createAgreement(input: CreateAgreementInput): Promise<OpResult> {
  if (!input.intakeReceiptId) {
    return { ok: false, message: "سند الاستلام مطلوب لإنشاء العقد." };
  }
  if (!input.grainGradeId) {
    return { ok: false, message: "نوع الحبوب (الفحص) مطلوب — سجّله في سند الاستلام أولاً." };
  }
  if (!input.requestedOutputType) {
    return { ok: false, message: "اختر درجة الدقيق التي طلبها العميل." };
  }
  if (input.outputBagSizeKg <= 0) {
    return { ok: false, message: "سعة الكيس يجب أن تكون أكبر من صفر." };
  }
  if (input.agreedPrice <= 0) {
    return { ok: false, message: "حدّد سعراً متفقاً عليه أكبر من صفر — بلا سعر لا يوجد عقد." };
  }

  const { data, error } = await db.rpc("create_milling_agreement", {
    _intake_receipt_id: input.intakeReceiptId,
    _grain_grade_id: input.grainGradeId,
    _requested_output_type: input.requestedOutputType,
    _requested_output_note: input.requestedOutputNote ?? null,
    _output_bag_size_kg: input.outputBagSizeKg,
    _bags_source: input.bagsSource,
    _delivery_mode: input.deliveryMode,
    _service_product_id: input.serviceProductId ?? null,
    _price_basis: input.priceBasis,
    _agreed_price: input.agreedPrice,
    _expected_extraction_rate: input.expectedExtractionRate,
    _allowed_loss_percentage: input.allowedLossPercentage,
    _notes: input.notes ?? null,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string };
}

export async function fetchAgreements(
  status?: MillingAgreement["status"],
): Promise<MillingAgreement[]> {
  let q = db.from("milling_agreements_view").select("*");
  if (status) q = q.eq("status", status);

  const { data, error } = await q.order("agreed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MillingAgreement[];
}

/* ------------------------------------------------ 3. أوامر من العقد */

export interface CreateJobFromAgreementInput {
  agreementId: string;
  intakeReceiptId?: string;
  inputBagCount: number;
  inputBagSizeKg?: number;
  inputWeightKg: number;
  notes?: string;
}

/**
 * ينشئ أمر طحن من عقد ويرث تسعيره. يُقفل العقد كـ CONSUMED.
 *
 * `create_milling_job_v2` يعيد استخدام محرك سحب الأمانات من v1 بلا تغيير:
 * `FOR UPDATE` على السند، الرصيد المُجمَّع للأوامر السابقة، وصفر أثر مخزون.
 */
export async function createJobFromAgreement(
  input: CreateJobFromAgreementInput,
): Promise<OpResult> {
  if (!input.agreementId) {
    return { ok: false, message: "عقد الطحن مطلوب — أنشئ العقد أولاً." };
  }
  if (input.inputWeightKg <= 0) {
    return { ok: false, message: "الوزن الداخل يجب أن يكون أكبر من صفر." };
  }

  const { data, error } = await db.rpc("create_milling_job_v2", {
    _agreement_id: input.agreementId,
    _intake_receipt_id: input.intakeReceiptId ?? null,
    _input_bag_count: input.inputBagCount ?? 0,
    _input_bag_size_kg: input.inputBagSizeKg ?? null,
    _input_weight_kg: input.inputWeightKg,
    _notes: input.notes ?? null,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string };
}

/* ------------------------------------------------------------- 5. الفوترة */

/**
 * فاتورة أجور الطحن — سطر واحد (أساس واحد) + بند تعبئة + بند أكياس.
 *
 * تحل `invoiceJob` القديمة التي كانت تُصدر سطرين عند وجود أساسين،
 * وتقرأ السعر من products.sale_price بدل سعر الأمر.
 */
export async function invoiceJobV2(input: InvoiceJobV2Input): Promise<OpResult> {
  if (!input.jobId) {
    return { ok: false, message: "أمر الطحن مطلوب." };
  }
  if (!input.paymentMethod) {
    return { ok: false, message: "طريقة الدفع مطلوبة." };
  }

  const { data, error } = await db.rpc("issue_milling_service_invoice_v2", {
    _job_id: input.jobId,
    // The picker hands back a catalogue id ('kuraimi_bank', 'jaib', …). Convert
    // it to the value the document stores HERE, at the boundary — the same thing
    // every other screen does. It happens to work without the conversion today,
    // because the database resolves a catalogue id too, but relying on that
    // makes this the one call site with a different contract from all the rest.
    _payment_method: toLegacyPaymentValue(input.paymentMethod),
    _paid: input.paid ?? 0,
    _discount: input.discount ?? 0,
    _note: input.note ?? null,
    _include_packaging: input.includePackaging ?? true,
    _include_sewing: input.includeSewing ?? false,
    _sewing_price: input.sewingPrice ?? null,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string };
}

/* ------------------------------------------------------------ 4. تقارير */

export interface EfficiencyRow {
  job_number: string;
  customer_name_ar: string | null;
  grain_grade: string | null;
  agreement_id: string | null;
  requested_output_type: string | null;
  bags_source: string | null;
  delivery_mode: string | null;
  price_basis: string | null;
  agreed_price: number | null;
  status: string;
  input_weight_kg: number;
  total_output_kg: number;
  actual_loss_kg: number;
  loss_excess_kg: number;
  actual_extraction_rate: number;
  expected_extraction_rate: number;
  loss_status: "EXCEEDS" | "WITHIN";
  invoice_number: string | null;
  invoiced_total: number | null;
}

export async function fetchEfficiencyReport(): Promise<EfficiencyRow[]> {
  const { data, error } = await db
    .from("milling_efficiency_report")
    .select("*")
    .order("job_number", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EfficiencyRow[];
}

export interface IntakeHealthRow {
  id: string;
  receipt_number: string;
  customer_id: string;
  customer_name_ar: string | null;
  store_id: string;
  status: string;
  grain_type: string;
  grain_product_id: string | null;
  grain_grade_id: string | null;
  grade_name_ar: string | null;
  /** true = سند بلا درجة مرتبطة، يحتاج ربطاً يدوياً. */
  needs_grade_link: boolean;
  bag_size_kg: number;
  intake_bag_count: number;
  net_weight_kg: number;
  nominal_weight_kg: number;
  /** فرق الوزن الصافي عن الاسمي — يكشف عجز أوزان الأكياس. */
  bag_weight_gap_kg: number;
  moisture_percentage: number;
  max_moisture: number | null;
  moisture_status: "OK" | "ABOVE_LIMIT";
  created_at: string;
}

export interface PricingDiagnosticRow {
  job_number: string;
  status: string;
  milling_fee_per_bag: number;
  milling_fee_per_ton: number;
  /** DUAL_BASIS_ERROR = أساسان — يحتاج repair. */
  pricing_health: "DUAL_BASIS_ERROR" | "OK_BAG" | "OK_TON" | "NO_FEE";
  invoice_number: string | null;
  invoiced_total: number | null;
}

export async function fetchIntakeHealth(): Promise<IntakeHealthRow[]> {
  const { data, error } = await db
    .from("milling_intake_health")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as IntakeHealthRow[];
}

export async function fetchPricingDiagnostics(): Promise<PricingDiagnosticRow[]> {
  const { data, error } = await db
    .from("milling_pricing_diagnostics")
    .select("*")
    .order("job_number", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PricingDiagnosticRow[];
}
