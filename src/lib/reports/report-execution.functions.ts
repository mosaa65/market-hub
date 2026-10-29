/**
 * حدود التنفيذ الخادمية للتقارير.
 *
 * لا تستدعي الواجهة Supabase مباشرةً: تمر كل الفلاتر عبر Zod هنا، ويُنفذ
 * الاستعلام باستخدام جلسة المستخدم الموثقة حتى تبقى سياسات RLS نافذة.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  InventoryMovementsFilterSchema,
  PurchaseRegisterFilterSchema,
  SalesRegisterFilterSchema,
} from "./data-providers/filter-schemas";
import {
  calculateGrossMargin,
  calculateMarginPercentage,
  calculateRunningInventoryMovements,
  classifyCostBasis,
  isInboundMovement,
  mapDbMovementTypeToKind,
  resolveDateRangeBoundaries,
  resolvePreviousPeriodBoundaries,
  round2,
  round3,
  type RawStockMovement,
} from "./rules";

const paginationSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(1000).default(50),
  })
  .optional();
const sortSchema = z
  .object({ field: z.string().max(64), order: z.enum(["asc", "desc"]) })
  .optional();
const salesRequestSchema = z.object({
  reportId: z.string().min(1),
  filters: SalesRegisterFilterSchema,
  pagination: paginationSchema,
  sort: sortSchema,
});
const purchasesRequestSchema = z.object({
  reportId: z.string().min(1),
  filters: PurchaseRegisterFilterSchema,
  pagination: paginationSchema,
  sort: sortSchema,
});
const inventoryRequestSchema = z.object({
  reportId: z.string().min(1),
  filters: InventoryMovementsFilterSchema,
  pagination: paginationSchema,
});
const productOptionsSchema = z.object({ search: z.string().trim().max(80).optional() });
const filterOptionsSchema = z.object({
  source: z.enum(["customers", "suppliers", "warehouses", "products", "branches"]),
  search: z.string().trim().max(80).optional(),
});
const groupedSalesRequestSchema = z.object({
  reportId: z.string().min(1),
  filters: SalesRegisterFilterSchema,
  pagination: paginationSchema,
  sort: sortSchema,
  groupBy: z.enum(["product", "customer", "branch", "warehouse", "payment_method"]).optional(),
  dimensions: z
    .array(z.enum(["product", "customer", "branch", "warehouse", "payment_method"]))
    .optional(),
});
const groupedPurchasesRequestSchema = z.object({
  reportId: z.string().min(1),
  filters: PurchaseRegisterFilterSchema,
  pagination: paginationSchema,
  sort: sortSchema,
  groupBy: z.enum(["supplier", "product", "warehouse", "payment_method"]).optional(),
  dimensions: z.array(z.enum(["supplier", "product", "warehouse", "payment_method"])).optional(),
});

const SALES_SORT_FIELDS = new Set([
  "created_at",
  "total",
  "quantity",
  "unit_price",
  "invoice_number",
]);
const PURCHASE_SORT_FIELDS = new Set([
  "created_at",
  "total",
  "quantity",
  "unit_cost",
  "invoice_number",
]);

function searchTerm(value?: string) {
  // PostgREST uses a mini-language in `.or()`. Remove its control characters
  // rather than interpolating an attacker-controlled expression into it.
  return value?.trim().replace(/[(),]/g, " ") || "";
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const REPORT_QUERY_CHUNK_SIZE = 500;

async function fetchAllReportRows<T>(createQuery: () => any, errorContext: string): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error, count } = await createQuery().range(
      offset,
      offset + REPORT_QUERY_CHUNK_SIZE - 1,
    );
    if (error) throw new Error(`[${errorContext}] ${error.message}`);

    const page = (data ?? []) as T[];
    if (page.length === 0) break;
    rows.push(...page);
    offset += page.length;

    if (count != null ? offset >= count : page.length < REPORT_QUERY_CHUNK_SIZE) break;
  }

  return rows;
}

export const executeSalesRegisterReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => salesRequestSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const { filters } = data;
    const page = data.pagination?.page ?? 1;
    const pageSize = data.pagination?.pageSize ?? 50;
    const sortField = SALES_SORT_FIELDS.has(data.sort?.field ?? "")
      ? data.sort!.field
      : "created_at";
    const ascending = (data.sort?.order ?? "desc") === "asc";
    const boundaries = resolveDateRangeBoundaries(filters.startDate, filters.endDate);
    const supabase: any = (context as any).supabase;

    let pageQuery = supabase.from("sales_register").select("*", { count: "exact" });
    const metricsQuery = supabase
      .from("sales_register")
      .select("quantity,unit_price,discount,tax,total,line_cost");
    const applyFilters = (query: any) => {
      if (filters.startDate) query = query.gte("created_at", boundaries.startIso);
      if (filters.endDate) query = query.lte("created_at", boundaries.endIso);
      if (filters.customerIds && filters.customerIds.length > 0) {
        query = query.in("customer_id", filters.customerIds);
      } else if (filters.customerId) {
        query = query.eq("customer_id", filters.customerId);
      }
      if (filters.productIds && filters.productIds.length > 0) {
        query = query.in("product_id", filters.productIds);
      } else if (filters.productId) {
        query = query.eq("product_id", filters.productId);
      }
      if (filters.statuses && filters.statuses.length > 0) {
        query = query.in("status", filters.statuses);
      } else if (filters.status) {
        query = query.eq("status", filters.status);
      } else {
        query = query.neq("status", "cancelled");
      }
      if (filters.paymentMethods && filters.paymentMethods.length > 0) {
        query = query.in("payment_method", filters.paymentMethods);
      } else if (filters.paymentMethod) {
        query = query.eq("payment_method", filters.paymentMethod);
      }
      const term = searchTerm(filters.search);
      if (term)
        query = query.or(
          `invoice_number.ilike.%${term}%,item_name.ilike.%${term}%,sku.ilike.%${term}%`,
        );
      return query;
    };

    pageQuery = applyFilters(pageQuery)
      .order(sortField, { ascending })
      .range((page - 1) * pageSize, page * pageSize - 1);
    let pageResult: any;
    let metricsResult: any;
    try {
      [pageResult, metricsResult] = await Promise.all([pageQuery, metricsQuery]);
    } catch {
      pageResult = { data: null, error: true };
      metricsResult = { data: null, error: true };
    }

    if (pageResult.error || !pageResult.data) {
      pageResult = { data: [], count: 0 };
      metricsResult = { data: [] };
    }

    let grossSales = 0,
      itemDiscounts = 0,
      netSales = 0,
      totalTax = 0,
      totalCost = 0,
      totalQuantity = 0,
      actualCostRows = 0;
    for (const row of metricsResult.data ?? []) {
      const quantity = toNumber(row.quantity);
      grossSales += quantity * toNumber(row.unit_price);
      itemDiscounts += toNumber(row.discount);
      netSales += toNumber(row.total);
      totalTax += toNumber(row.tax);
      totalCost += toNumber(row.line_cost);
      totalQuantity += quantity;
      if (toNumber(row.line_cost) > 0) actualCostRows += 1;
    }
    const pageRows = (pageResult.data ?? []) as Array<Record<string, any>>;
    const customerIds = [...new Set(pageRows.map((row) => row.customer_id).filter(Boolean))];
    const customersResult = customerIds.length
      ? await supabase.from("customers").select("id,name").in("id", customerIds)
      : { data: [], error: null };
    if (customersResult.error)
      throw new Error(`[SalesRegister customers] ${customersResult.error.message}`);
    const customerNames = new Map(
      (customersResult.data ?? []).map((customer: any) => [customer.id, customer.name]),
    );
    const rows = pageRows.map((row) => ({
      ...row,
      customer_name: row.customer_id ? (customerNames.get(row.customer_id) ?? null) : null,
    }));
    const totalRowCount = pageResult.count ?? 0;
    grossSales = round2(grossSales);
    itemDiscounts = round2(itemDiscounts);
    netSales = round2(netSales);
    totalTax = round2(totalTax);
    totalCost = round2(totalCost);
    totalQuantity = round2(totalQuantity);

    return {
      reportId: data.reportId,
      executedAt: new Date().toISOString(),
      totalRowCount,
      rows,
      metrics: {
        totalRowCount,
        totalQuantity,
        grossSales,
        itemDiscounts,
        netSales,
        totalTax,
        totalCost,
        grossMargin: calculateGrossMargin(netSales, totalCost),
        marginPercentage: calculateMarginPercentage(
          calculateGrossMargin(netSales, totalCost),
          netSales,
        ),
      },
      meta: {
        appliedFilters: filters,
        costBasisNotice: classifyCostBasis(actualCostRows, false),
        currencySymbol: "ر.ي",
        page,
        pageSize,
        totalPages: Math.ceil(totalRowCount / pageSize) || 1,
      },
    };
  });

export const executePurchaseRegisterReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => purchasesRequestSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const { filters } = data;
    const page = data.pagination?.page ?? 1;
    const pageSize = data.pagination?.pageSize ?? 50;
    const sortField = PURCHASE_SORT_FIELDS.has(data.sort?.field ?? "")
      ? data.sort!.field
      : "created_at";
    const ascending = (data.sort?.order ?? "desc") === "asc";
    const boundaries = resolveDateRangeBoundaries(filters.startDate, filters.endDate);
    const supabase: any = (context as any).supabase;

    let pageQuery = supabase.from("purchase_register").select("*", { count: "exact" });
    let metricsQuery = supabase
      .from("purchase_register")
      .select("quantity,unit_cost,discount,tax,total");
    const applyFilters = (query: any) => {
      if (filters.startDate) query = query.gte("created_at", boundaries.startIso);
      if (filters.endDate) query = query.lte("created_at", boundaries.endIso);
      if (filters.supplierIds && filters.supplierIds.length > 0) {
        query = query.in("supplier_id", filters.supplierIds);
      } else if (filters.supplierId) {
        query = query.eq("supplier_id", filters.supplierId);
      }
      if (filters.productIds && filters.productIds.length > 0) {
        query = query.in("product_id", filters.productIds);
      } else if (filters.productId) {
        query = query.eq("product_id", filters.productId);
      }
      if (filters.statuses && filters.statuses.length > 0) {
        query = query.in("status", filters.statuses);
      } else if (filters.status) {
        query = query.eq("status", filters.status);
      } else {
        query = query.neq("status", "cancelled");
      }
      if (filters.paymentMethods && filters.paymentMethods.length > 0) {
        query = query.in("payment_method", filters.paymentMethods);
      } else if (filters.paymentMethod) {
        query = query.eq("payment_method", filters.paymentMethod);
      }
      const term = searchTerm(filters.search);
      if (term)
        query = query.or(
          `invoice_number.ilike.%${term}%,item_name.ilike.%${term}%,sku.ilike.%${term}%`,
        );
      return query;
    };
    pageQuery = applyFilters(pageQuery)
      .order(sortField, { ascending })
      .range((page - 1) * pageSize, page * pageSize - 1);
    metricsQuery = applyFilters(metricsQuery);
    const [pageResult, metricsResult] = await Promise.all([pageQuery, metricsQuery]);
    if (pageResult.error) throw new Error(`[PurchaseRegister] ${pageResult.error.message}`);
    if (metricsResult.error)
      throw new Error(`[PurchaseRegister metrics] ${metricsResult.error.message}`);

    let grossPurchases = 0,
      itemDiscounts = 0,
      netPurchases = 0,
      totalTax = 0,
      totalQuantity = 0;
    for (const row of metricsResult.data ?? []) {
      const quantity = toNumber(row.quantity);
      grossPurchases += quantity * toNumber(row.unit_cost);
      itemDiscounts += toNumber(row.discount);
      netPurchases += toNumber(row.total);
      totalTax += toNumber(row.tax);
      totalQuantity += quantity;
    }
    const totalRowCount = pageResult.count ?? 0;
    return {
      reportId: data.reportId,
      executedAt: new Date().toISOString(),
      totalRowCount,
      rows: pageResult.data ?? [],
      metrics: {
        totalRowCount,
        totalQuantity: round2(totalQuantity),
        grossPurchases: round2(grossPurchases),
        itemDiscounts: round2(itemDiscounts),
        netPurchases: round2(netPurchases),
        totalTax: round2(totalTax),
      },
      meta: {
        appliedFilters: filters,
        currencySymbol: "ر.ي",
        page,
        pageSize,
        totalPages: Math.ceil(totalRowCount / pageSize) || 1,
      },
    };
  });

/** يجمع سجلات المبيعات في الخادم حتى لا تنتقل بيانات التجميع الخام إلى المتصفح. */
export const executeSalesGroupedReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => groupedSalesRequestSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const { filters, groupBy, dimensions } = data;
    const activeDimensions: Array<
      "product" | "customer" | "branch" | "warehouse" | "payment_method"
    > = dimensions && dimensions.length > 0 ? dimensions : [groupBy || "product"];

    const page = data.pagination?.page ?? 1;
    const pageSize = data.pagination?.pageSize ?? 50;
    const boundaries = resolveDateRangeBoundaries(filters.startDate, filters.endDate);
    const supabase: any = (context as any).supabase;

    let query = supabase
      .from("sales_register")
      .select(
        "invoice_id,customer_id,product_id,sku,item_name,item_name_ar,quantity,unit_price,discount,tax,total,line_cost,payment_method,base_uom_name_ar",
      );
    if (filters.startDate) query = query.gte("created_at", boundaries.startIso);
    if (filters.endDate) query = query.lte("created_at", boundaries.endIso);
    if (filters.customerIds && filters.customerIds.length > 0) {
      query = query.in("customer_id", filters.customerIds);
    } else if (filters.customerId) {
      query = query.eq("customer_id", filters.customerId);
    }
    if (filters.productIds && filters.productIds.length > 0) {
      query = query.in("product_id", filters.productIds);
    } else if (filters.productId) {
      query = query.eq("product_id", filters.productId);
    }
    if (filters.statuses && filters.statuses.length > 0) {
      query = query.in("status", filters.statuses);
    } else if (filters.status) {
      query = query.eq("status", filters.status);
    } else {
      query = query.neq("status", "cancelled");
    }
    if (filters.paymentMethods && filters.paymentMethods.length > 0) {
      query = query.in("payment_method", filters.paymentMethods);
    } else if (filters.paymentMethod) {
      query = query.eq("payment_method", filters.paymentMethod);
    }
    const term = searchTerm(filters.search);
    if (term)
      query = query.or(
        `invoice_number.ilike.%${term}%,item_name.ilike.%${term}%,sku.ilike.%${term}%`,
      );

    let sourceRows: any;
    let queryError: any;
    try {
      const res = await query;
      sourceRows = res.data;
      queryError = res.error;
    } catch {
      queryError = true;
    }

    if (queryError || !sourceRows || sourceRows.length === 0) {
      sourceRows = [];
    }
    const rawRows = (sourceRows ?? []) as Array<Record<string, any>>;
    const customerIds = [...new Set(rawRows.map((row) => row.customer_id).filter(Boolean))];
    let customersResult: any;
    try {
      customersResult = customerIds.length
        ? await supabase.from("customers").select("id,name").in("id", customerIds)
        : { data: [], error: null };
    } catch {
      customersResult = { data: [], error: null };
    }
    const customerNames = new Map(
      (customersResult?.data ?? []).map((customer: any) => [customer.id, customer.name]),
    );

    const pmLabels: Record<string, string> = {
      cash: "نقدي",
      card: "شبكة / بطاقة",
      bank_transfer: "تحويل بنكي",
      credit: "آجل",
    };

    let grossSales = 0,
      itemDiscounts = 0,
      netSales = 0,
      totalTax = 0,
      totalCost = 0,
      totalQuantity = 0,
      actualCostRows = 0;
    const groups = new Map<string, any>();

    for (const row of rawRows) {
      const quantity = toNumber(row.quantity);
      const unitPrice = toNumber(row.unit_price);
      const discount = toNumber(row.discount);
      const total = toNumber(row.total);
      const cost = toNumber(row.line_cost);
      grossSales += quantity * unitPrice;
      itemDiscounts += discount;
      netSales += total;
      totalTax += toNumber(row.tax);
      totalCost += cost;
      totalQuantity += quantity;
      if (cost > 0) actualCostRows += 1;

      // بناء مفتاح تجميع مركب يضم كل الأبعاد المفعلة
      const compositeParts = activeDimensions.map((dim) => {
        if (dim === "customer") return row.customer_id || "walk-in";
        if (dim === "branch") return row.branch_id || "main";
        if (dim === "warehouse") return row.warehouse_id || "main";
        if (dim === "payment_method") return row.payment_method || "cash";
        return row.product_id || row.item_name_ar || row.item_name || "other";
      });
      const key = compositeParts.join("::");

      const existing =
        groups.get(key) ??
        (() => {
          const base: Record<string, any> = {
            id: key,
            invoice_ids: new Set<string>(),
            quantity: 0,
            gross_sales: 0,
            discounts: 0,
            net_sales: 0,
            total_cost: 0,
          };

          if (activeDimensions.includes("customer")) {
            base.customer_id = row.customer_id;
            base.customer_name = row.customer_id
              ? (customerNames.get(row.customer_id) ?? "عميل غير محدد")
              : "عميل نقدي / غير محدد";
          }
          if (activeDimensions.includes("product")) {
            base.product_id = row.product_id;
            base.sku = row.sku || "—";
            base.product_name = row.item_name_ar || row.item_name || "صنف غير محدد";
            base.item_name_ar = base.product_name;
            base.base_uom_name_ar = row.base_uom_name_ar ?? null;
          }
          if (activeDimensions.includes("payment_method")) {
            base.payment_method = row.payment_method || "cash";
            base.payment_method_name = pmLabels[row.payment_method] || row.payment_method || "نقدي";
          }
          if (activeDimensions.includes("branch")) {
            base.branch_id = row.branch_id || "main";
            base.branch_name = "الفرع الرئيسي";
          }
          if (activeDimensions.includes("warehouse")) {
            base.warehouse_id = row.warehouse_id || "main";
            base.warehouse_name = "المستودع الرئيسي";
          }

          return base;
        })();

      existing.quantity += quantity;
      existing.gross_sales += quantity * unitPrice;
      existing.discounts += discount;
      existing.net_sales += total;
      existing.total_cost += cost;
      if (row.invoice_id) existing.invoice_ids.add(row.invoice_id);

      groups.set(key, existing);
    }

    const rows = Array.from(groups.values()).map((group) => {
      const groupedNetSales = round2(group.net_sales);
      const groupedCost = round2(group.total_cost);
      const grossMargin = calculateGrossMargin(groupedNetSales, groupedCost);
      return {
        ...group,
        invoice_count: group.invoice_ids ? group.invoice_ids.size : 0,
        quantity: round2(group.quantity),
        gross_sales: round2(group.gross_sales),
        discounts: round2(group.discounts),
        net_sales: groupedNetSales,
        total_cost: groupedCost,
        gross_margin: grossMargin,
        margin_percentage: calculateMarginPercentage(grossMargin, groupedNetSales),
      };
    });

    const sortField = data.sort?.field ?? "net_sales";
    const sortOrder = data.sort?.order ?? "desc";
    rows.sort((a: any, b: any) => {
      const left = a[sortField] ?? 0;
      const right = b[sortField] ?? 0;
      return left < right
        ? sortOrder === "asc"
          ? -1
          : 1
        : left > right
          ? sortOrder === "asc"
            ? 1
            : -1
          : 0;
    });

    const totalRowCount = rows.length;
    const roundedNetSales = round2(netSales);
    const roundedTotalCost = round2(totalCost);
    const grossMargin = calculateGrossMargin(roundedNetSales, roundedTotalCost);
    return {
      reportId: data.reportId,
      executedAt: new Date().toISOString(),
      totalRowCount,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      metrics: {
        totalRowCount,
        totalQuantity: round2(totalQuantity),
        grossSales: round2(grossSales),
        itemDiscounts: round2(itemDiscounts),
        netSales: roundedNetSales,
        totalTax: round2(totalTax),
        totalCost: roundedTotalCost,
        grossMargin,
        marginPercentage: calculateMarginPercentage(grossMargin, roundedNetSales),
      },
      meta: {
        appliedFilters: filters,
        costBasisNotice: classifyCostBasis(actualCostRows, false),
        currencySymbol: "ر.ي",
        page,
        pageSize,
        totalPages: Math.ceil(totalRowCount / pageSize) || 1,
      },
    };
  });

/** يجمع سجلات المشتريات في الخادم ويدعم التجميع متعدد الأبعاد. */
export const executePurchasesGroupedReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => groupedPurchasesRequestSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const { filters, groupBy, dimensions } = data;
    const activeDimensions: Array<"supplier" | "product" | "warehouse" | "payment_method"> =
      dimensions && dimensions.length > 0 ? dimensions : [groupBy || "supplier"];

    const page = data.pagination?.page ?? 1;
    const pageSize = data.pagination?.pageSize ?? 50;
    const boundaries = resolveDateRangeBoundaries(filters.startDate, filters.endDate);
    const supabase: any = (context as any).supabase;

    let query = supabase
      .from("purchase_register")
      .select(
        "invoice_id,supplier_id,product_id,sku,item_name,item_name_ar,quantity,unit_cost,discount,tax,total,payment_method,base_uom_name_ar",
      );
    if (filters.startDate) query = query.gte("created_at", boundaries.startIso);
    if (filters.endDate) query = query.lte("created_at", boundaries.endIso);
    if (filters.supplierIds && filters.supplierIds.length > 0) {
      query = query.in("supplier_id", filters.supplierIds);
    } else if (filters.supplierId) {
      query = query.eq("supplier_id", filters.supplierId);
    }
    if (filters.productIds && filters.productIds.length > 0) {
      query = query.in("product_id", filters.productIds);
    } else if (filters.productId) {
      query = query.eq("product_id", filters.productId);
    }
    if (filters.statuses && filters.statuses.length > 0) {
      query = query.in("status", filters.statuses);
    } else if (filters.status) {
      query = query.eq("status", filters.status);
    } else {
      query = query.neq("status", "cancelled");
    }
    if (filters.paymentMethods && filters.paymentMethods.length > 0) {
      query = query.in("payment_method", filters.paymentMethods);
    } else if (filters.paymentMethod) {
      query = query.eq("payment_method", filters.paymentMethod);
    }
    const term = searchTerm(filters.search);
    if (term)
      query = query.or(
        `invoice_number.ilike.%${term}%,item_name.ilike.%${term}%,sku.ilike.%${term}%`,
      );

    let sourceRows: any;
    let queryError: any;
    try {
      const res = await query;
      sourceRows = res.data;
      queryError = res.error;
    } catch {
      queryError = true;
    }

    if (queryError || !sourceRows || sourceRows.length === 0) {
      sourceRows = [];
    }
    const rawRows = (sourceRows ?? []) as Array<Record<string, any>>;
    const supplierIds = [...new Set(rawRows.map((row) => row.supplier_id).filter(Boolean))];
    let suppliersResult: any;
    try {
      suppliersResult = supplierIds.length
        ? await supabase.from("suppliers").select("id,name").in("id", supplierIds)
        : { data: [], error: null };
    } catch {
      suppliersResult = { data: [], error: null };
    }
    const supplierNames = new Map(
      (suppliersResult?.data ?? []).map((supplier: any) => [supplier.id, supplier.name]),
    );

    const pmLabels: Record<string, string> = {
      cash: "نقدي",
      card: "شبكة / بطاقة",
      bank_transfer: "تحويل بنكي",
      credit: "آجل",
    };

    let grossPurchases = 0,
      itemDiscounts = 0,
      netPurchases = 0,
      totalTax = 0,
      totalQuantity = 0;
    const groups = new Map<string, any>();

    for (const row of rawRows) {
      const quantity = toNumber(row.quantity);
      const unitCost = toNumber(row.unit_cost);
      const discount = toNumber(row.discount);
      const total = toNumber(row.total);
      grossPurchases += quantity * unitCost;
      itemDiscounts += discount;
      netPurchases += total;
      totalTax += toNumber(row.tax);
      totalQuantity += quantity;

      // بناء مفتاح تجميع مركب يضم كل الأبعاد المفعلة
      const compositeParts = activeDimensions.map((dim) => {
        if (dim === "supplier") return row.supplier_id || "unknown";
        if (dim === "warehouse") return row.warehouse_id || "main";
        if (dim === "payment_method") return row.payment_method || "credit";
        return row.product_id || row.item_name_ar || row.item_name || "other";
      });
      const key = compositeParts.join("::");

      const existing =
        groups.get(key) ??
        (() => {
          const base: Record<string, any> = {
            id: key,
            invoice_ids: new Set<string>(),
            quantity: 0,
            gross_purchases: 0,
            discounts: 0,
            net_purchases: 0,
          };

          if (activeDimensions.includes("supplier")) {
            base.supplier_id = row.supplier_id;
            base.supplier_name = row.supplier_id
              ? (supplierNames.get(row.supplier_id) ?? "مورد غير محدد")
              : "مورد غير محدد";
          }
          if (activeDimensions.includes("product")) {
            base.product_id = row.product_id;
            base.sku = row.sku || "—";
            base.product_name = row.item_name_ar || row.item_name || "صنف غير محدد";
            base.item_name_ar = base.product_name;
            base.base_uom_name_ar = row.base_uom_name_ar ?? null;
          }
          if (activeDimensions.includes("payment_method")) {
            base.payment_method = row.payment_method || "credit";
            base.payment_method_name = pmLabels[row.payment_method] || row.payment_method || "آجل";
          }
          if (activeDimensions.includes("warehouse")) {
            base.warehouse_id = row.warehouse_id || "main";
            base.warehouse_name = "المستودع الرئيسي";
          }

          return base;
        })();

      existing.quantity += quantity;
      existing.gross_purchases += quantity * unitCost;
      existing.discounts += discount;
      existing.net_purchases += total;
      if (row.invoice_id) existing.invoice_ids.add(row.invoice_id);

      groups.set(key, existing);
    }

    const rows = Array.from(groups.values()).map((group) => {
      return {
        ...group,
        invoice_count: group.invoice_ids ? group.invoice_ids.size : 0,
        quantity: round2(group.quantity),
        gross_purchases: round2(group.gross_purchases),
        discounts: round2(group.discounts),
        net_purchases: round2(group.net_purchases),
      };
    });

    const sortField = data.sort?.field ?? "net_purchases";
    const sortOrder = data.sort?.order ?? "desc";
    rows.sort((a: any, b: any) => {
      const left = a[sortField] ?? 0;
      const right = b[sortField] ?? 0;
      return left < right
        ? sortOrder === "asc"
          ? -1
          : 1
        : left > right
          ? sortOrder === "asc"
            ? 1
            : -1
          : 0;
    });

    const totalRowCount = rows.length;
    return {
      reportId: data.reportId,
      executedAt: new Date().toISOString(),
      totalRowCount,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      metrics: {
        totalRowCount,
        totalQuantity: round2(totalQuantity),
        grossPurchases: round2(grossPurchases),
        itemDiscounts: round2(itemDiscounts),
        netPurchases: round2(netPurchases),
        totalTax: round2(totalTax),
      },
      meta: {
        appliedFilters: filters,
        currencySymbol: "ر.ي",
        page,
        pageSize,
        totalPages: Math.ceil(totalRowCount / pageSize) || 1,
      },
    };
  });

export const executeInventoryMovementsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => inventoryRequestSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const { filters } = data;
    const page = data.pagination?.page ?? 1;
    const pageSize = data.pagination?.pageSize ?? 50;
    const boundaries = resolveDateRangeBoundaries(filters.startDate, filters.endDate);
    const supabase: any = (context as any).supabase;
    if (!filters.productId) {
      throw new Error("Select one item to view its inventory movement card.");
    }

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("base_uom_id,unit_id")
      .eq("id", filters.productId)
      .maybeSingle();
    if (productError) throw new Error(`[Inventory product unit] ${productError.message}`);
    const baseUomId = product?.base_uom_id ?? product?.unit_id ?? null;
    let baseUomName: string | null = null;
    let baseUomNameAr: string | null = null;
    if (baseUomId) {
      const { data: unit, error: unitError } = await supabase
        .from("units")
        .select("name,name_ar")
        .eq("id", baseUomId)
        .maybeSingle();
      if (unitError) throw new Error(`[Inventory base unit] ${unitError.message}`);
      baseUomName = unit?.name ?? null;
      baseUomNameAr = unit?.name_ar ?? baseUomName;
    }

    const openingByWarehouse = new Map<string, number>();

    if (filters.startDate && filters.productId) {
      const beforeRows = await fetchAllReportRows<Record<string, any>>(() => {
        let query = supabase
          .from("stock_movements")
          .select("movement_type,quantity,warehouse_id", { count: "exact" })
          .eq("product_id", filters.productId)
          .eq("owner_type", "COMPANY")
          .is("owner_id", null)
          .lt("created_at", boundaries.startIso)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });
        if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
        return query;
      }, "Inventory opening balance");
      for (const movement of beforeRows) {
        const quantity = Math.abs(toNumber(movement.quantity));
        const delta = isInboundMovement(movement.movement_type, quantity)
          ? quantity
          : -quantity;
        const warehouseId = movement.warehouse_id as string;
        openingByWarehouse.set(
          warehouseId,
          round3((openingByWarehouse.get(warehouseId) ?? 0) + delta),
        );
      }
    }

    const openingBalance = round3(
      [...openingByWarehouse.values()].reduce((sum, balance) => sum + balance, 0),
    );

    const rawRows = await fetchAllReportRows<Record<string, any>>(() => {
      let query = supabase
        .from("stock_movements")
        .select(
          "id,product_id,warehouse_id,movement_type,quantity,unit_cost,total_cost,reference,note,created_at,products(name,name_ar,sku),warehouses(name)",
          { count: "exact" },
        )
        .eq("owner_type", "COMPANY")
        .is("owner_id", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      query = query.eq("product_id", filters.productId);
      if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
      if (filters.startDate) query = query.gte("created_at", boundaries.startIso);
      if (filters.endDate) query = query.lte("created_at", boundaries.endIso);
      return query;
    }, "Inventory movements");
    const rowsByWarehouse = new Map<string, any[]>();
    for (const row of rawRows as Array<Record<string, any>>) {
      const warehouseRows = rowsByWarehouse.get(row.warehouse_id) ?? [];
      warehouseRows.push(row);
      rowsByWarehouse.set(row.warehouse_id, warehouseRows);
    }

    const calculatedByMovementId = new Map<
      string,
      ReturnType<typeof calculateRunningInventoryMovements>[number]
    >();
    const closingByWarehouse = new Map(openingByWarehouse);
    for (const [warehouseId, warehouseRows] of rowsByWarehouse) {
      const calculated = calculateRunningInventoryMovements(
        warehouseRows.map((row: any) => ({
          id: row.id,
          createdAt: row.created_at,
          kind: mapDbMovementTypeToKind(row.movement_type, toNumber(row.quantity)),
          quantity: toNumber(row.quantity),
        })) as RawStockMovement[],
        round3(openingByWarehouse.get(warehouseId) ?? 0),
      );
      for (const movement of calculated) calculatedByMovementId.set(movement.id, movement);
      if (calculated.length > 0) {
        closingByWarehouse.set(warehouseId, calculated.at(-1)!.runningBalance);
      }
    }

    const rows = (rawRows as Array<Record<string, any>>).map((source) => {
      const movement = calculatedByMovementId.get(source.id)!;
      return {
        id: movement.id,
        product_id: source.product_id,
        warehouse_id: source.warehouse_id,
        movement_type: source.movement_type,
        quantity: Math.abs(movement.quantity),
        inbound_quantity: movement.inQty,
        outbound_quantity: movement.outQty,
        running_balance: movement.runningBalance,
        unit_cost: source.unit_cost == null ? null : toNumber(source.unit_cost),
        total_cost: source.total_cost == null ? null : toNumber(source.total_cost),
        reference: source.reference ?? null,
        note: source.note ?? null,
        created_at: movement.createdAt,
        product_name: source.products?.name,
        product_name_ar: source.products?.name_ar,
        sku: source.products?.sku,
        base_uom_id: baseUomId,
        base_uom_name: baseUomName,
        base_uom_name_ar: baseUomNameAr,
        warehouse_name: source.warehouses?.name,
      };
    });
    const reportRows = filters.movementType
      ? rows.filter((row) => row.movement_type === filters.movementType)
      : rows;
    const totalRowCount = reportRows.length;
    const totalInbound = reportRows.reduce((sum, row) => sum + row.inbound_quantity, 0);
    const totalOutbound = reportRows.reduce((sum, row) => sum + row.outbound_quantity, 0);
    const closingBalance = round3(
      [...closingByWarehouse.values()].reduce((sum, balance) => sum + balance, 0),
    );
    return {
      reportId: data.reportId,
      executedAt: new Date().toISOString(),
      totalRowCount,
      rows: reportRows.slice((page - 1) * pageSize, page * pageSize),
      metrics: {
        openingBalance: round3(openingBalance),
        totalInbound: round3(totalInbound),
        totalOutbound: round3(totalOutbound),
        closingBalance,
        totalRowCount,
      },
      meta: {
        appliedFilters: filters,
        currencySymbol: "ر.ي",
        page,
        pageSize,
        totalPages: Math.ceil(totalRowCount / pageSize) || 1,
      },
    };
  });

/**
 * قائمة أصناف خفيفة لاستخدامها في كشف حركة الصنف.
 *
 * تبقى القراءة في الخادم وتعيد أول 100 نتيجة فقط؛ لا تحمل الواجهة كتالوج
 * المنتجات كاملاً عند فتح التقرير.
 */
export const searchReportProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => productOptionsSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const term = searchTerm(data.search);
    const supabase: any = (context as any).supabase;
    let query = supabase
      .from("products")
      .select("id,name,name_ar,sku")
      .order("name_ar", { ascending: true })
      .limit(100);

    if (term) {
      query = query.or(`name_ar.ilike.%${term}%,name.ilike.%${term}%,sku.ilike.%${term}%`);
    }

    const { data: products, error } = await query;
    if (error) throw new Error(`[Report products] ${error.message}`);
    return products ?? [];
  });

/** خيارات الفلاتر المعروضة في الواجهة، من دالة خادم وبحد أقصى ثابت. */
export const searchReportFilterOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => filterOptionsSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const term = searchTerm(data.search);
    const supabase: any = (context as any).supabase;
    const config = {
      customers: { table: "customers", columns: "id,name", label: "name", searchColumns: ["name"] },
      suppliers: { table: "suppliers", columns: "id,name", label: "name", searchColumns: ["name"] },
      warehouses: {
        table: "warehouses",
        columns: "id,name",
        label: "name",
        searchColumns: ["name"],
      },
      products: {
        table: "products",
        columns: "id,name,name_ar,sku",
        label: "name_ar",
        searchColumns: ["name_ar", "name", "sku"],
      },
      branches: {
        table: "branches",
        columns: "id,name",
        label: "name",
        searchColumns: ["name"],
      },
    } as const;
    const source = (config as Record<string, any>)[data.source] ?? config.customers;
    let query = supabase
      .from(source.table)
      .select(source.columns)
      .order(source.label, { ascending: true })
      .limit(100);
    if (term) {
      query = query.or(
        source.searchColumns.map((column: string) => `${column}.ilike.%${term}%`).join(","),
      );
    }
    let options: any[] = [];
    try {
      const res = await query;
      if (!res.error && res.data) {
        options = res.data;
      }
    } catch {
      options = [];
    }
    return (options ?? []).map((option: any) => ({
      id: option.id,
      label: option.name_ar || option.name || option.sku || "—",
      secondaryLabel: option.sku || null,
    }));
  });

const comparisonRequestSchema = z.object({
  reportId: z.string().min(1),
  filters: SalesRegisterFilterSchema,
  metricKey: z.string().min(1).max(64),
  comparisonMode: z.enum(["previous_period", "previous_year"]).default("previous_period"),
});

/**
 * يحسب كتلة المقارنة بين فترتين على الخادم.
 *
 * تُشتق الفترة السابقة من طول الفترة الحالية، ثم تُجمع القيم مرتين على الخادم،
 * فلا يصل أي تجميع خام إلى المتصفح.
 */
export const executeComparisonReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => comparisonRequestSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const { filters } = data;
    const supabase: any = (context as any).supabase;
    const current = resolveDateRangeBoundaries(filters.startDate, filters.endDate);
    const previous = resolvePreviousPeriodBoundaries(
      filters.startDate,
      filters.endDate,
      data.comparisonMode,
    );

    const buildQuery = (startIso: string, endIso: string) => {
      let query = supabase
        .from("sales_register")
        .select("quantity,unit_price,discount,tax,total,line_cost");
      query = query.gte("created_at", startIso).lte("created_at", endIso);
      if (filters.customerId) query = query.eq("customer_id", filters.customerId);
      if (filters.productId) query = query.eq("product_id", filters.productId);
      query = filters.status
        ? query.eq("status", filters.status)
        : query.neq("status", "cancelled");
      if (filters.paymentMethod) query = query.eq("payment_method", filters.paymentMethod);
      return query;
    };

    const [currentResult, previousResult] = await Promise.all([
      buildQuery(current.startIso, current.endIso),
      buildQuery(previous.startIso, previous.endIso),
    ]);
    if (currentResult.error) throw new Error(`[Comparison current] ${currentResult.error.message}`);
    if (previousResult.error)
      throw new Error(`[Comparison previous] ${previousResult.error.message}`);

    const aggregate = (rows: Array<Record<string, any>>) => {
      let grossSales = 0;
      let itemDiscounts = 0;
      let netSales = 0;
      let totalCost = 0;
      for (const row of rows) {
        const quantity = toNumber(row.quantity);
        grossSales += quantity * toNumber(row.unit_price);
        itemDiscounts += toNumber(row.discount);
        netSales += toNumber(row.total);
        totalCost += toNumber(row.line_cost);
      }
      const margin = calculateGrossMargin(round2(netSales), round2(totalCost));
      return {
        grossSales: round2(grossSales),
        itemDiscounts: round2(itemDiscounts),
        netSales: round2(netSales),
        totalCost: round2(totalCost),
        grossMargin: margin,
        marginPercentage: calculateMarginPercentage(margin, round2(netSales)),
      };
    };

    const currentAggregate = aggregate((currentResult.data ?? []) as Array<Record<string, any>>);
    const previousAggregate = aggregate((previousResult.data ?? []) as Array<Record<string, any>>);

    const metricKey = data.metricKey;
    const metricLabels: Record<
      string,
      { labelAr: string; format: "money" | "quantity" | "percentage" | "integer" }
    > = {
      grossSales: { labelAr: "إجمالي المبيعات", format: "money" },
      netSales: { labelAr: "صافي المبيعات", format: "money" },
      itemDiscounts: { labelAr: "الخصومات", format: "money" },
      totalCost: { labelAr: "إجمالي التكلفة", format: "money" },
      grossMargin: { labelAr: "هامش الربح الإجمالي", format: "money" },
      marginPercentage: { labelAr: "نسبة هامش الربح", format: "percentage" },
    };
    const meta = metricLabels[metricKey] ?? { labelAr: metricKey, format: "money" as const };

    const currentValue = toNumber((currentAggregate as any)[metricKey]);
    const previousValue = toNumber((previousAggregate as any)[metricKey]);
    const absoluteDelta = round2(currentValue - previousValue);
    const percentChange =
      previousValue === 0 ? null : round2((absoluteDelta / Math.abs(previousValue)) * 100);

    return {
      reportId: data.reportId,
      executedAt: new Date().toISOString(),
      comparison: {
        metricKey,
        metricLabelAr: meta.labelAr,
        currentValue,
        previousValue,
        absoluteDelta,
        percentChange,
        previousStartDate: filters.startDate ? previous.startDate : null,
        previousEndDate: filters.endDate ? previous.endDate : null,
        format: meta.format,
      },
    };
  });

const exceptionsFilterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  customerId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.string().optional(),
  paymentMethod: z.string().optional(),
  search: z.string().optional(),
});

const exceptionsRequestSchema = z.object({
  reportId: z.string().min(1),
  filters: exceptionsFilterSchema,
  pagination: paginationSchema,
  sort: sortSchema,
  source: z.enum([
    "sales_register",
    "purchase_register",
    "inventory_low_stock",
    "inventory_slow_moving",
    "item_classification_gaps",
  ]),
});

/**
 * يجلب صفوف الاستثناءات والحالات غير الطبيعية على الخادم.
 *
 * كل مصدر يُستعلم عنه مباشرة من العرض المخصص له في قاعدة البيانات (RLS نافذة)،
 * والفرز والعدّ يحدثان في الخادم قبل إعادة صفحة واحدة للواجهة.
 */
export const executeExceptionsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => exceptionsRequestSchema.parse(data))
  .handler(async ({ data, context }: any) => {
    const { filters } = data;
    const page = data.pagination?.page ?? 1;
    const pageSize = data.pagination?.pageSize ?? 50;
    const supabase: any = (context as any).supabase;
    const boundaries = resolveDateRangeBoundaries(filters.startDate, filters.endDate);

    if (data.source === "item_classification_gaps") {
      const { data: gaps, error } = await supabase
        .from("item_classification_gaps")
        .select("id,sku,name_ar,item_nature,item_class,inventory_policy,reason");
      if (error) throw new Error(`[Exceptions classification gaps] ${error.message}`);
      const allRows = (gaps ?? []) as Array<Record<string, any>>;
      const totalRowCount = allRows.length;
      return {
        reportId: data.reportId,
        executedAt: new Date().toISOString(),
        totalRowCount,
        rows: allRows.slice((page - 1) * pageSize, page * pageSize),
        metrics: { totalRowCount, gapCount: totalRowCount },
        meta: {
          appliedFilters: filters,
          currencySymbol: "ر.ي",
          page,
          pageSize,
          totalPages: Math.ceil(totalRowCount / pageSize) || 1,
        },
      };
    }

    if (data.source === "inventory_low_stock" || data.source === "inventory_slow_moving") {
      const valuation = await fetchAllReportRows<Record<string, any>>(() => {
        let query = supabase
          .from("inventory_valuation")
          .select(
            "item_id,item_name,item_name_ar,sku,warehouse_id,warehouse_name,quantity,costing_method,reference_unit_cost,reference_valuation,valuation_is_reference_based,base_uom_id,base_uom_name,base_uom_name_ar,min_stock",
            { count: "exact" },
          )
          .order("item_id", { ascending: true })
          .order("warehouse_id", { ascending: true });
        if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
        if (filters.productId) query = query.eq("item_id", filters.productId);
        if (data.source === "inventory_slow_moving") query = query.gt("quantity", 0);
        return query;
      }, "Exceptions inventory");

      let allRows: Array<Record<string, any>> = valuation.map((row) => ({
        ...row,
        quantity: toNumber(row.quantity),
        reference_valuation: toNumber(row.reference_valuation),
        min_stock: toNumber(row.min_stock),
        base_uom_name_ar: row.base_uom_name_ar ?? row.base_uom_name ?? null,
      }));
      const term = searchTerm(filters.search).toLowerCase();
      if (term) {
        allRows = allRows.filter((row) =>
          [row.sku, row.item_name_ar, row.item_name].some((value) =>
            String(value ?? "")
              .toLowerCase()
              .includes(term),
          ),
        );
      }

      if (data.source === "inventory_low_stock") {
        allRows = allRows.filter((row) => row.quantity <= row.min_stock);
      } else {
        // الأصناف الراكدة: رصيد قائم دون أي حركة صادرة خلال الفترة المحددة.
        const movements = await fetchAllReportRows<Record<string, any>>(
          () =>
            supabase
              .from("stock_movements")
              .select("product_id,warehouse_id", { count: "exact" })
              .eq("owner_type", "COMPANY")
              .is("owner_id", null)
              .gte("created_at", boundaries.startIso)
              .lte("created_at", boundaries.endIso)
              .lt("quantity", 0)
              .order("id", { ascending: true }),
          "Exceptions slow moving",
        );
        const activeStockPositions = new Set(
          movements
            .filter((movement) => movement.product_id && movement.warehouse_id)
            .map((movement) => `${movement.product_id}:${movement.warehouse_id}`),
        );
        allRows = allRows.filter(
          (row) => !activeStockPositions.has(`${row.item_id}:${row.warehouse_id}`),
        );
      }

      const totalRowCount = allRows.length;
      const totalValue = round2(
        allRows.reduce((sum, row) => sum + toNumber(row.reference_valuation), 0),
      );
      return {
        reportId: data.reportId,
        executedAt: new Date().toISOString(),
        totalRowCount,
        rows: allRows.slice((page - 1) * pageSize, page * pageSize),
        metrics: { totalRowCount, totalValue, exceptionCount: totalRowCount },
        meta: {
          appliedFilters: filters,
          currencySymbol: "ر.ي",
          page,
          pageSize,
          totalPages: Math.ceil(totalRowCount / pageSize) || 1,
        },
      };
    }

    const sourceView = data.source === "purchase_register" ? "purchase_register" : "sales_register";
    const applyExceptionFilters = (query: any) => {
      query = query.in("status", ["cancelled", "returned", "draft"]);
      if (filters.startDate) query = query.gte("created_at", boundaries.startIso);
      if (filters.endDate) query = query.lte("created_at", boundaries.endIso);
      if (sourceView === "sales_register" && filters.customerId)
        query = query.eq("customer_id", filters.customerId);
      if (sourceView === "purchase_register" && filters.supplierId)
        query = query.eq("supplier_id", filters.supplierId);
      const term = searchTerm(filters.search);
      if (term)
        query = query.or(
          `invoice_number.ilike.%${term}%,item_name.ilike.%${term}%,sku.ilike.%${term}%`,
        );
      return query;
    };
    let query = applyExceptionFilters(supabase.from(sourceView).select("*", { count: "exact" }));
    const metricsQuery = applyExceptionFilters(supabase.from(sourceView).select("status,total"));

    const sortField = ["created_at", "total", "quantity"].includes(data.sort?.field ?? "")
      ? data.sort!.field
      : "created_at";
    query = query
      .order(sortField, { ascending: (data.sort?.order ?? "desc") === "asc" })
      .range((page - 1) * pageSize, page * pageSize - 1);

    const [pageResult, metricsResult] = await Promise.all([query, metricsQuery]);
    if (pageResult.error) throw new Error(`[Exceptions ${sourceView}] ${pageResult.error.message}`);
    if (metricsResult.error)
      throw new Error(`[Exceptions metrics ${sourceView}] ${metricsResult.error.message}`);

    const rows = pageResult.data ?? [];
    const metricRows = (metricsResult.data ?? []) as Array<Record<string, any>>;
    const totalRowCount = pageResult.count ?? metricRows.length;
    const cancelledCount = metricRows.filter((row) => row.status === "cancelled").length;
    const returnedCount = metricRows.filter((row) => row.status === "returned").length;

    return {
      reportId: data.reportId,
      executedAt: new Date().toISOString(),
      totalRowCount,
      rows,
      metrics: {
        totalRowCount,
        cancelledCount,
        returnedCount,
        exceptionCount: totalRowCount,
        exceptionValue: round2(metricRows.reduce((sum, row) => sum + toNumber(row.total), 0)),
      },
      meta: {
        appliedFilters: filters,
        currencySymbol: "ر.ي",
        page,
        pageSize,
        totalPages: Math.ceil(totalRowCount / pageSize) || 1,
      },
    };
  });
