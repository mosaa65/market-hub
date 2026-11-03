/**
 * Market-Hub ERP - Offline Inventory Movements & Transfers Service Engine
 */

import { generateUUIDv7, generateLocalDocRef, getOrCreateDeviceId } from "../idempotency";
import { globalSyncEngine } from "../sync-engine";
import { inventoryRepo } from "../repositories/inventory-repository";
import { getOfflineStorageAdapter } from "../storage-adapter";

export interface CreateOfflineStockTransferPayload {
  source_warehouse_id: string;
  target_warehouse_id: string;
  items: Array<{
    product_id: string;
    quantity: number;
  }>;
  notes?: string;
}

export interface CreateOfflineStockAdjustmentPayload {
  warehouse_id: string;
  product_id: string;
  actual_quantity: number;
  reason?: string;
}

export class InventoryOfflineService {
  private adapter = getOfflineStorageAdapter();
  private deviceId = getOrCreateDeviceId();
  private localSeq = 1;

  async processStockTransfer(payload: CreateOfflineStockTransferPayload) {
    const transferId = generateUUIDv7();
    const localRef = generateLocalDocRef("TRF", this.deviceId, this.localSeq++);
    const timestamp = new Date().toISOString();

    const record = {
      id: transferId,
      local_document_ref: localRef,
      source_warehouse_id: payload.source_warehouse_id,
      target_warehouse_id: payload.target_warehouse_id,
      items: payload.items,
      notes: payload.notes || null,
      created_at: timestamp,
    };

    await this.adapter.setItem("stock_transfers", transferId, record);

    // Deduct source, add target locally
    for (const item of payload.items) {
      await inventoryRepo.updateStockLocal(
        item.product_id,
        payload.source_warehouse_id,
        -item.quantity,
      );
      await inventoryRepo.updateStockLocal(
        item.product_id,
        payload.target_warehouse_id,
        item.quantity,
      );
    }

    await globalSyncEngine.enqueue({
      entity_name: "create_stock_transfer",
      operation_type: "RPC",
      payload: record,
      priority: "high",
      local_document_ref: localRef,
    });

    return record;
  }

  async processStockAdjustment(payload: CreateOfflineStockAdjustmentPayload) {
    const adjId = generateUUIDv7();
    const currentQty = await inventoryRepo.getStockQuantity(
      payload.product_id,
      payload.warehouse_id,
    );
    const diff = payload.actual_quantity - currentQty;

    const record = {
      id: adjId,
      warehouse_id: payload.warehouse_id,
      product_id: payload.product_id,
      previous_quantity: currentQty,
      actual_quantity: payload.actual_quantity,
      difference: diff,
      reason: payload.reason || null,
      created_at: new Date().toISOString(),
    };

    await this.adapter.setItem("stock_adjustments", adjId, record);
    await inventoryRepo.updateStockLocal(payload.product_id, payload.warehouse_id, diff);

    await globalSyncEngine.enqueue({
      entity_name: "create_stock_adjustment",
      operation_type: "RPC",
      payload: record,
      priority: "medium",
    });

    return record;
  }
}

export const inventoryOfflineService = new InventoryOfflineService();
