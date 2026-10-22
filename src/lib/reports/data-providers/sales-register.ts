/** مزود سجل المبيعات — يستدعي حد التنفيذ الخادمي فقط. */
import type { IDataProvider, ReportExecutionRequest, ReportExecutionResult } from "./types";
import { SalesRegisterFilterSchema, type SalesRegisterFilters } from "./filter-schemas";
import { executeSalesRegisterReport } from "../report-execution.functions";

export interface SalesRegisterRow {
  invoice_item_id: string;
  invoice_id: string;
  invoice_number: string;
  created_at: string;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  payment_method: string | null;
  product_id: string | null;
  description: string | null;
  item_name: string | null;
  item_name_ar: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  tax: number;
  total: number;
  line_type: string;
  stock_effect: string;
  uom_id: string | null;
  line_cost: number | null;
}

export class SalesRegisterDataProvider implements IDataProvider<
  SalesRegisterFilters,
  SalesRegisterRow
> {
  id = "dp-sales-register";
  dataSourceName = "sales_register";

  async execute(
    request: ReportExecutionRequest<SalesRegisterFilters>,
  ): Promise<ReportExecutionResult<SalesRegisterRow>> {
    const validated = {
      ...request,
      filters: SalesRegisterFilterSchema.parse(request.filters || {}),
    };
    return (await executeSalesRegisterReport({
      data: validated,
    })) as unknown as ReportExecutionResult<SalesRegisterRow>;
  }
}
