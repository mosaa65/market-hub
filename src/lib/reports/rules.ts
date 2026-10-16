/**
 * Vortex ERP — القواعد الحسابية الموحدة لمحرك التقارير (Pure Calculation Rules)
 *
 * ⚠️ مبادئ معمارية صارمة:
 *  1. دوال نقية (Pure Functions) خالية من أي side-effects أو اتصال بالشبكة أو React.
 *  2. تمنع أخطاء الفاصلة العائمة (Floating Point Precision) عبر التقريب المالي الموحد round2.
 *  3. تمنع الازدواج الحسابي في الخصومات والضرائب والمرتجعات.
 *  4. تحقق الفرز الحتمي والترتيب المنطقي لحركات المخزون لحساب الرصيد اللحظي.
 */

export const EPSILON = 0.005;
export const DECIMALS = 2;

/**
 * تقريب مالي آمن إلى منزلتين عشريتين.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * تقريب كميات المخزون إلى 3 منازل عشرية.
 */
export function round3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/* ------------------------------------------------------------------ */
/*  قواعد المبيعات وهوامش الربح                                       */
/* ------------------------------------------------------------------ */

/**
 * احتساب صافي المبيعات التشغيلية (Net Sales).
 *
 * القاعدة المعتمدة:
 *   Net Sales = Gross Subtotal - Invoice Discounts - Returns Total
 *
 * ⚠️ تنبيه: عمود sales_invoices.total يتضمن الضريبة ومخصوم منه الخصم بالفعل.
 * لذا عند استخدام subtotal، يُخصم الخصم والمرتجع فقط دون مضاعفة الخصم.
 */
export function calculateNetSales(
  grossSubtotal: number,
  invoiceDiscount: number,
  returnsTotal: number,
): number {
  const sub = Math.max(0, round2(grossSubtotal));
  const disc = Math.max(0, round2(invoiceDiscount));
  const ret = Math.max(0, round2(returnsTotal));
  return round2(Math.max(0, sub - disc - ret));
}

/**
 * احتساب هامش المساهمة التشغيلي (Gross Margin).
 *
 * Margin = Net Sales - Cost of Goods Sold (COGS)
 */
export function calculateGrossMargin(netSales: number, cogs: number): number {
  const sales = round2(netSales);
  const cost = round2(cogs);
  return round2(sales - cost);
}

/**
 * احتساب نسبة هامش المساهمة (Margin Percentage %).
 *
 * Margin % = (Gross Margin / Net Sales) * 100
 * إذا كانت المبيعات صفراً، فالنسبة صفر.
 */
export function calculateMarginPercentage(netSales: number, cogs: number): number {
  const sales = round2(netSales);
  if (sales <= 0) return 0;
  const margin = calculateGrossMargin(sales, cogs);
  return round2((margin / sales) * 100);
}

/**
 * احتساب المبلغ المتبقي الآجل للتحصيل أو السداد (Outstanding Balance).
 *
 * Outstanding = max(0, Total - Paid)
 */
export function calculateOutstanding(total: number, paid: number): number {
  const tot = Math.max(0, round2(total));
  const pd = Math.max(0, round2(paid));
  return round2(Math.max(0, tot - pd));
}

/**
 * تصنيف أساس تكلفة الصنف:
 * - ACTUAL: إذا كان الصنف يمتلك طبقات تكلفة فعلية محتسبة (item_cost_layers).
 * - STANDARD: إذا كان للصنف تكلفة معيارية معتمدة (standard_cost).
 * - REFERENCE_ONLY: إذا تم الاعتماد على سعر الكتالوج كقيمة تقريبية.
 */
export function classifyCostBasis(
  valuedLayersCount: number | null | undefined,
  hasStandardCost: boolean,
): "ACTUAL" | "STANDARD" | "REFERENCE_ONLY" {
  if (valuedLayersCount && valuedLayersCount > 0) return "ACTUAL";
  if (hasStandardCost) return "STANDARD";
  return "REFERENCE_ONLY";
}

/* ------------------------------------------------------------------ */
/*  قواعد حركة المخزون والرصيد المتسلسل (Movement Statement)          */
/* ------------------------------------------------------------------ */

export type StockDeltaKind =
  | "receipt"      // إدخال مشتريات أو استلام (+ وارد)
  | "issue"        // إخراج بيع أو صرف (- صادر)
  | "return_in"    // مرتجع مبيعات (+ وارد)
  | "return_out"   // مرتجع مشتريات (- صادر)
  | "adjustment_in" // تسوية جرد موجبة (+ وارد)
  | "adjustment_out"// تسوية جرد سالبة (- صادر)
  | "transfer_in"  // تحويل مستودعي وارد (+ وارد)
  | "transfer_out" // تحويل مستودعي صادر (- صادر)
  | "opening";     // رصيد افتتاحي (+ وارد)

export interface RawStockMovement {
  id: string;
  createdAt: string;
  kind: StockDeltaKind;
  quantity: number;
}

export interface CalculatedStockMovementRow extends RawStockMovement {
  inQty: number;
  outQty: number;
  runningBalance: number;
}

/**
 * تحديد ما إذا كانت الحركة إدخالاً أم إخراجاً.
 */
export function isStockInbound(kind: StockDeltaKind): boolean {
  return (
    kind === "receipt" ||
    kind === "return_in" ||
    kind === "adjustment_in" ||
    kind === "transfer_in" ||
    kind === "opening"
  );
}

/**
 * تحويل نوع الحركة المخزنية من قاعدة البيانات إلى النوع الحسابي المعتمد.
 */
export function mapDbMovementTypeToKind(movementType: string, quantity = 0): StockDeltaKind {
  switch (movementType) {
    case "purchase":
      return "receipt";
    case "sale":
      return "issue";
    case "sale_return":
      return "return_in";
    case "purchase_return":
      return "return_out";
    case "transfer_in":
      return "transfer_in";
    case "transfer_out":
      return "transfer_out";
    case "opening":
      return "opening";
    case "adjustment":
      return quantity >= 0 ? "adjustment_in" : "adjustment_out";
    default:
      return quantity >= 0 ? "receipt" : "issue";
  }
}

/**
 * فحص ما إذا كانت الحركة إدخالاً لحساب الرصيد الافتتاحي وتجميع الوارد والصادر.
 */
export function isInboundMovement(movementType: string, quantity = 0): boolean {
  const kind = mapDbMovementTypeToKind(movementType, quantity);
  return isStockInbound(kind);
}


/**
 * الترتيب الحتمي لحركات المخزون عند تساوي الوقت.
 */
export function compareStockMovements(a: RawStockMovement, b: RawStockMovement): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt.localeCompare(b.createdAt);
  }
  return a.id.localeCompare(b.id);
}

/**
 * احتساب الرصيد اللحظي التراكمي لحركات المخزون (Running Stock Balance).
 *
 * المعادلة:
 *   runningBalance = openingBalance + sum(inQty) - sum(outQty)
 */
export function calculateRunningInventoryMovements(
  movements: RawStockMovement[],
  openingBalance = 0,
): CalculatedStockMovementRow[] {
  const sorted = [...movements].sort(compareStockMovements);
  let current = round3(openingBalance);

  return sorted.map((m) => {
    const qty = Math.abs(round3(m.quantity));
    const inbound = isStockInbound(m.kind);
    const inQty = inbound ? qty : 0;
    const outQty = inbound ? 0 : qty;

    current = round3(current + inQty - outQty);

    return {
      ...m,
      inQty,
      outQty,
      runningBalance: current,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  قواعد التواريخ ونهاية اليوم (Date Boundaries)                     */
/* ------------------------------------------------------------------ */

export interface DateRangeBoundaries {
  startIso: string;
  endIso: string;
}

/**
 * تحويل نطاق تاريخ اختياري (YYYY-MM-DD) إلى طوابع زمنية كاملة تشمل ثانية اليوم الأخيرة.
 *
 * مثال:
 *   from: "2026-10-01" -> "2026-10-01T00:00:00.000Z"
 *   to:   "2026-10-31" -> "2026-10-31T23:59:59.999Z"
 */
export function resolveDateRangeBoundaries(
  from?: string | null,
  to?: string | null,
): DateRangeBoundaries {
  const startIso = from ? `${from.trim()}T00:00:00.000Z` : "1970-01-01T00:00:00.000Z";
  const endIso = to ? `${to.trim()}T23:59:59.999Z` : "2099-12-31T23:59:59.999Z";
  return { startIso, endIso };
}

/**
 * التحقق مما إذا كان تاريخ الحركة يقع ضمن النطاق الزمني المحدد (شاملاً للطرفين).
 */
export function isDateWithinRange(
  isoDate: string,
  from?: string | null,
  to?: string | null,
): boolean {
  if (!isoDate) return false;
  const { startIso, endIso } = resolveDateRangeBoundaries(from, to);
  return isoDate >= startIso && isoDate <= endIso;
}

/* ------------------------------------------------------------------ */
/*  قواعد المقارنة بين الفترات (Period Comparison)                    */
/* ------------------------------------------------------------------ */

export interface ComparisonPeriod {
  startIso: string;
  endIso: string;
  startDate: string;
  endDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * اشتقاق الفترة المقارنة السابقة من نطاق الفترة الحالية.
 *
 * - previous_period: نفس عدد الأيام مباشرة قبل بداية الفترة الحالية.
 * - previous_year: نفس النطاق الزمني مطروحاً منه سنة كاملة.
 */
export function resolvePreviousPeriodBoundaries(
  from: string | null | undefined,
  to: string | null | undefined,
  mode: 'previous_period' | 'previous_year' = 'previous_period',
): ComparisonPeriod {
  const current = resolveDateRangeBoundaries(from, to);

  if (mode === 'previous_year') {
    const start = new Date(current.startIso);
    const end = new Date(current.endIso);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    end.setUTCFullYear(end.getUTCFullYear() - 1);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      startDate: toDateKey(start),
      endDate: toDateKey(end),
    };
  }

  const start = new Date(current.startIso);
  const end = new Date(current.endIso);
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - (spanDays - 1) * DAY_MS);

  return {
    startIso: previousStart.toISOString(),
    endIso: previousEnd.toISOString(),
    startDate: toDateKey(previousStart),
    endDate: toDateKey(previousEnd),
  };
}
