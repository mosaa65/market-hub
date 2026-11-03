/** مزود حركة المخزون — الحساب والقراءة ينفذان على الخادم. */
import type { IDataProvider, ReportExecutionRequest, ReportExecutionResult } from "./types";
import { InventoryMovementsFilterSchema, type InventoryMovementsFilters } from "./filter-schemas";
import { executeInventoryMovementsReport } from "../report-execution.functions";

export interface InventoryMovementRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  movement_type: string;
  quantity: number;
  inbound_quantity: number;
  outbound_quantity: number;
  running_balance: number;
  unit_cost: number | null;
  total_cost: number | null;
  reference: string | null;
  note: string | null;
  created_at: string;
  product_name?: string;
  product_name_ar?: string;
  sku?: string;
  base_uom_id: string | null;
  base_uom_name: string | null;
  base_uom_name_ar: string | null;
  warehouse_name?: string;
}

export class InventoryMovementsDataProvider implements IDataProvider<
  InventoryMovementsFilters,
  InventoryMovementRow
> {
  id = "dp-inventory-movements";
  dataSourceName = "stock_movements";

  async execute(
    request: ReportExecutionRequest<InventoryMovementsFilters>,
  ): Promise<ReportExecutionResult<InventoryMovementRow>> {
    const validated = {
      ...request,
      filters: InventoryMovementsFilterSchema.parse(request.filters || {}),
    };
    return (await executeInventoryMovementsReport({
      data: validated,
    })) as ReportExecutionResult<InventoryMovementRow>;
  }
}
