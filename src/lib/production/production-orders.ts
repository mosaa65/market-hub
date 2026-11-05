import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export interface ProductionUnit {
  id: string;
  name_ar: string | null;
  short_name: string;
  dimension_code: string;
  factor_to_reference: number | null;
}

export interface ProductionProductUom {
  unit_id: string;
  factor_to_base: number;
  can_purchase: boolean;
  can_sell: boolean;
  is_active: boolean;
  is_base: boolean;
}

export interface ProductionProduct {
  id: string;
  sku: string | null;
  name_ar: string;
  name: string | null;
  item_class: string | null;
  item_nature: string;
  inventory_policy: string;
  tracking: string;
  track_expiry: boolean;
  is_sellable: boolean;
  is_custody_item: boolean;
  package_weight_kg: number | null;
  unit_id: string | null;
  base_uom_id: string | null;
  batch_dispatch_strategy: string | null;
  uoms: ProductionProductUom[];
}

export interface ProductionWarehouse {
  id: string;
  name: string;
  name_ar: string | null;
  is_default: boolean;
}

export interface ProductionCostCenter {
  id: string;
  code: string | null;
  name: string;
  name_ar: string | null;
}

export interface ProductionBatch {
  id: string;
  product_id: string;
  warehouse_id: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
  created_at: string;
}

export interface ProductionExpenseSource {
  expense_line_id: string;
  expense_entry_id: string;
  reference: string;
  expense_date: string;
  description: string;
  category_name: string;
  cost_center_id: string | null;
  account_code: string;
  net_amount: number;
  allocated_amount: number;
  available_amount: number;
}

export interface ProductionOrderSummary {
  id: string;
  order_number: string;
  production_date: string;
  status: string;
  warehouse_id: string;
  cost_center_id: string;
  material_cost: number;
  conversion_cost: number;
  total_cost: number;
  output_cost: number;
  abnormal_loss_cost: number;
  notes: string | null;
  completed_at: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
}

export async function loadProductionLookups() {
  const [warehouses, centers, products, units, productUoms, batches, inventory, costs] =
    await Promise.all([
      db.from("warehouses").select("id,name,name_ar,is_default").eq("is_active", true),
      db
        .from("expense_cost_centers")
        .select("id,code,name,name_ar")
        .eq("is_active", true)
        .order("name"),
      db
        .from("products")
        .select(
          "id,sku,name,name_ar,item_class,item_nature,inventory_policy,tracking,track_expiry,is_sellable,is_custody_item,package_weight_kg,unit_id,base_uom_id,batch_dispatch_strategy",
        )
        .eq("is_active", true)
        .order("name_ar"),
      db
        .from("units")
        .select("id,name_ar,short_name,dimension_code,factor_to_reference")
        .order("name_ar"),
      db
        .from("product_uoms")
        .select("product_id,unit_id,factor_to_base,can_purchase,can_sell,is_active,is_base")
        .eq("is_active", true),
      db
        .from("product_batches")
        .select("id,product_id,warehouse_id,batch_number,expiry_date,quantity,created_at")
        .gt("quantity", 0),
      db.from("inventory").select("product_id,warehouse_id,quantity").eq("owner_type", "COMPANY"),
      db.rpc("production_cost_sources"),
    ]);

  const result = [warehouses, centers, products, units, productUoms, batches, inventory, costs];
  const failure = result.find((item) => item.error);
  if (failure?.error) throw failure.error;

  const uomsByProduct = new Map<string, ProductionProductUom[]>();
  for (const uom of productUoms.data ?? []) {
    const list = uomsByProduct.get(uom.product_id) ?? [];
    list.push(uom);
    uomsByProduct.set(uom.product_id, list);
  }

  return {
    warehouses: (warehouses.data ?? []) as ProductionWarehouse[],
    centers: (centers.data ?? []) as ProductionCostCenter[],
    products: ((products.data ?? []) as Omit<ProductionProduct, "uoms">[]).map((product) => ({
      ...product,
      uoms: uomsByProduct.get(product.id) ?? [],
    })) as ProductionProduct[],
    units: (units.data ?? []) as ProductionUnit[],
    batches: (batches.data ?? []) as ProductionBatch[],
    inventory: (inventory.data ?? []) as {
      product_id: string;
      warehouse_id: string;
      quantity: number;
    }[],
    expenseSources: (costs.error ? [] : (costs.data ?? [])) as ProductionExpenseSource[],
    canAllocateExpenses: !costs.error,
    expenseSourcesError: costs.error?.message ?? null,
  };
}

export async function loadProductionOrderHistory() {
  // السجل يُقرأ من production_order_history (9918): عمود الصفوف الخفيفة فقط،
  // فإضافة عمود جديد على production_orders لا تكسر صفحة السجل بعد اليوم.
  const [orders, centers] = await Promise.all([
    db.rpc("production_order_history", { p_limit: 250 }),
    db.from("expense_cost_centers").select("id,name,name_ar").order("name"),
  ]);
  if (orders.error) throw orders.error;
  if (centers.error) throw centers.error;

  return {
    orders: (orders.data ?? []) as ProductionOrderSummary[],
    centers: (centers.data ?? []) as ProductionCostCenter[],
  };
}

export interface ProductionMaterialInput {
  product_id: string;
  quantity: number;
  uom_id: string | null;
  batch_id?: string | null;
}

export interface ProductionOutputInput {
  product_id: string;
  quantity: number;
  uom_id: string | null;
  allocation_value_per_base?: number;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export interface ProductionExpenseInput {
  expense_line_id: string;
  amount: number;
  basis: string;
  note?: string | null;
}

export interface ProductionLossInput {
  loss_type: "NORMAL" | "ABNORMAL";
  /** الكمية بوحدة الكتلة المختارة (مسار الكتلة). */
  quantity: number;
  uom_id?: string | null;
  reason: string;
  /**
   * فاقد عددي بوحدة الصنف (كيس تالف مثلاً). عند إرساله تُحوَّل الكمية إلى
   * وحدة أساس الصنف في الخادم، ويُحسب مكافئ الكتلة من وزن العبوة أو وحدة
   * الكتلة. mass_kg اختياري عندما لا يعرف الصنف مكافئاً كتلياً.
   */
  product_id?: string | null;
  mass_kg?: number | null;
}

export async function createAndPostProductionOrder(input: {
  warehouse_id: string;
  cost_center_id: string;
  production_date: string;
  notes?: string | null;
  materials: ProductionMaterialInput[];
  outputs: ProductionOutputInput[];
  expenses: ProductionExpenseInput[];
  losses: ProductionLossInput[];
}): Promise<string> {
  const { data, error } = await db.rpc("create_and_post_production_order", {
    p_warehouse_id: input.warehouse_id,
    p_cost_center_id: input.cost_center_id,
    p_production_date: input.production_date,
    p_notes: input.notes ?? null,
    p_materials: input.materials,
    p_outputs: input.outputs,
    p_expenses: input.expenses,
    p_losses: input.losses,
  });
  if (error) throw error;
  return data as string;
}

export async function reverseProductionOrder(orderId: string, reason: string): Promise<string> {
  const { data, error } = await db.rpc("reverse_production_order", {
    p_order_id: orderId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as string;
}

/* ── تفاصيل تكلفة الأمر ─────────────────────────────────────────────────────
   تُقرأ من production_order_cost_detail (9917) لا من حساب في الواجهة، حتى
   تبقى الواجهة والمحرك على مصدر واحد للتكلفة. */
export interface ProductionCostMaterial {
  id: string;
  product_id: string;
  product_name: string | null;
  entered_quantity: number;
  entered_uom: string | null;
  base_quantity: number;
  base_uom: string | null;
  uom_conversion_factor: number;
  mass_kg: number | null;
  unit_cost: number;
  total_cost: number;
  inventory_account_code: string;
  stock_movement_id: string | null;
  batches: { batch_id: string; batch_number: string; base_quantity: number }[];
}

export interface ProductionCostSource {
  id: string;
  expense_line_id: string;
  expense_entry_id: string;
  reference: string | null;
  expense_date: string;
  category: string | null;
  expense_account_code: string;
  amount: number;
  allocation_basis: string;
  note: string | null;
  journal_entry_id: string | null;
}

export interface ProductionCostOutput {
  id: string;
  product_id: string;
  product_name: string | null;
  item_class: string | null;
  entered_quantity: number;
  entered_uom: string | null;
  base_quantity: number;
  base_uom: string | null;
  mass_kg: number | null;
  allocation_value_per_base: number;
  allocation_weight: number;
  allocated_cost: number;
  actual_stock_cost: number;
  unit_cost: number;
  inventory_account_code: string;
  batch_id: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  stock_movement_id: string | null;
}

export interface ProductionCostLoss {
  id: string;
  loss_type: "NORMAL" | "ABNORMAL";
  quantity: number;
  uom: string | null;
  mass_kg: number;
  reason: string;
  charged_cost: number;
}

export interface ProductionCostJournal {
  id: string;
  entry_number: string;
  entry_date: string;
  memo: string;
  source_type: string;
  status: string;
}

export interface ProductionExcludedExpense {
  expense_line_id: string;
  expense_entry_id: string;
  reference: string | null;
  expense_date: string;
  category: string | null;
  net_amount: number;
  tax_amount: number;
  tax_recoverable: boolean;
  cost_center_matches: boolean;
  category_eligible: boolean;
  reason: string | null;
}

export interface ProductionOrderCostDetail {
  order: ProductionOrderSummary & {
    warehouse_id: string;
    cost_center_id: string;
  };
  materials: ProductionCostMaterial[];
  cost_sources: ProductionCostSource[];
  outputs: ProductionCostOutput[];
  losses: ProductionCostLoss[];
  journals: ProductionCostJournal[];
  excluded_expenses: ProductionExcludedExpense[];
  summary: {
    wip_debit: number;
    wip_credit: number;
    conversion_from_expenses: number;
    unallocated_conversion: number;
    /** مجاميع من السجلات (9918): لا تحسبها الواجهة. */
    material_subtotal?: number;
    conversion_subtotal?: number;
    wip_total_from_parts?: number;
    rounding_variance?: number;
    wip_balanced?: boolean;
    allocation_basis: string;
  };
}

export async function loadProductionOrderCostDetail(
  orderId: string,
): Promise<ProductionOrderCostDetail> {
  const { data, error } = await db.rpc("production_order_cost_detail", {
    p_order_id: orderId,
  });
  if (error) throw error;
  return data as ProductionOrderCostDetail;
}
