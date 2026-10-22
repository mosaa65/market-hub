/**
 * Market-Hub ERP - Inventory Positions & Stock Movements Offline Repository
 */

import { BaseRepository } from "./base-repository";

export interface InventoryPosition {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  updated_at?: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  warehouse_id: string;
  movement_type: "sale" | "purchase" | "transfer_in" | "transfer_out" | "adjustment";
  quantity: number; // Positive for additions, negative for deductions
  reference_id?: string | null;
  created_at: string;
}

export class InventoryRepository extends BaseRepository<InventoryPosition> {
  constructor() {
    super("inventory");
  }

  /**
   * Retrieves stock balance for a specific product and warehouse offline.
   */
  async getStockQuantity(productId: string, warehouseId: string): Promise<number> {
    const items = await this.getAll(
      (i) => i.product_id === productId && i.warehouse_id === warehouseId,
    );
    return items.length > 0 ? items[0].quantity : 0;
  }

  /**
   * Atomic local stock deduction/addition for offline operations.
   */
  async updateStockLocal(
    productId: string,
    warehouseId: string,
    deltaQty: number,
  ): Promise<number> {
    const items = await this.getAll(
      (i) => i.product_id === productId && i.warehouse_id === warehouseId,
    );

    let position: InventoryPosition;
    if (items.length > 0) {
      position = items[0];
      position.quantity += deltaQty;
      await this.adapter.setItem(this.tableName, position.id, position);
    } else {
      position = {
        id: `inv-${productId}-${warehouseId}`,
        product_id: productId,
        warehouse_id: warehouseId,
        quantity: deltaQty,
        updated_at: new Date().toISOString(),
      };
      await this.adapter.setItem(this.tableName, position.id, position);
    }

    return position.quantity;
  }
}

export const inventoryRepo = new InventoryRepository();
