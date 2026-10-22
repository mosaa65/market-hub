/** مزود سجل المشتريات — يستدعي حد التنفيذ الخادمي فقط. */
import type { IDataProvider, ReportExecutionRequest, ReportExecutionResult } from "./types";
import { PurchaseRegisterFilterSchema, type PurchaseRegisterFilters } from "./filter-schemas";
import { executePurchaseRegisterReport } from "../report-execution.functions";

export interface PurchaseRegisterRow {
  purchase_item_id: string;
  invoice_id: string;
  invoice_number: string;
  created_at: string;
  supplier_id: string | null;
  status: string;
  product_id: string | null;
  item_name: string | null;
  item_name_ar: string | null;
  sku: string | null;
  quantity: number;
  unit_cost: number;
  discount: number;
  tax: number;
  total: number;
  line_type: string;
  stock_effect: string;
  increases_inventory: boolean;
}

export class PurchaseRegisterDataProvider implements IDataProvider<
  PurchaseRegisterFilters,
  PurchaseRegisterRow
> {
  id = "dp-purchase-register";
  dataSourceName = "purchase_register";

  async execute(
    request: ReportExecutionRequest<PurchaseRegisterFilters>,
  ): Promise<ReportExecutionResult<PurchaseRegisterRow>> {
    const validated = {
      ...request,
      filters: PurchaseRegisterFilterSchema.parse(request.filters || {}),
    };
    return (await executePurchaseRegisterReport({
      data: validated,
    })) as unknown as ReportExecutionResult<PurchaseRegisterRow>;
  }
}
