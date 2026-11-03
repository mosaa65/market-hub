/**
 * Market-Hub ERP - Offline POS contract placeholder.
 *
 * Offline POS is deliberately fail-closed until the catalogue cache, UoM-aware
 * stock ledger, and idempotent server posting RPC are implemented together.
 */
import type { LegacyPaymentValue } from "@/lib/payments/payment-methods";

export interface POSCartItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface CreateOfflinePOSSalePayload {
  customer_id?: string | null;
  warehouse_id: string;
  items: POSCartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  // This is the STORED ENUM value, already converted from the catalogue id at
  // the call site — the queue replays the same RPC the online path calls.
  /**
   * Typed as `LegacyPaymentValue` rather than a hand-written literal union: the
   * previous union omitted `cheque`, which the unified catalogue shipped, so a
   * cheque rung up offline could not be represented at all.
   */
  payment_method: LegacyPaymentValue;
  notes?: string;
}

export interface OfflinePOSSaleResult {
  invoice_id: string;
  local_document_ref: string;
  status: "pending_sync";
  created_at: string;
  total: number;
}

export class POSOfflineService {
  async processOfflineSale(_payload: CreateOfflinePOSSalePayload): Promise<OfflinePOSSaleResult> {
    throw new Error(
      "Offline POS is unavailable until unit-aware stock reservation and an idempotent sale-posting RPC are implemented.",
    );
  }
}

export const posOfflineService = new POSOfflineService();
