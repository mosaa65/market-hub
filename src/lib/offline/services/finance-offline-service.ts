/**
 * Market-Hub ERP - Offline Financial Operations & Payment Engine
 */

import { generateUUIDv7, generateLocalDocRef, getOrCreateDeviceId } from "../idempotency";
import { globalSyncEngine } from "../sync-engine";
import { customersRepo, suppliersRepo } from "../repositories/contacts-repository";
import { getOfflineStorageAdapter } from "../storage-adapter";
import type { LegacyPaymentValue } from "@/lib/payments/payment-methods";

/*
 * `payment_method` here is the STORED ENUM value, converted from the catalogue
 * id before the record is queued — the replay calls the same RPC the online path
 * calls, which enforces its own `resolve_writable_payment_method` guard.
 *
 * Both unions used to be narrow literals that omitted `mobile_money` and
 * `cheque`. A wallet collection taken while offline therefore could not be
 * represented, and the type said so only at the point of use.
 */
export interface CreateOfflineCustomerPaymentPayload {
  customer_id: string;
  amount: number;
  payment_method: LegacyPaymentValue;
  notes?: string;
}

export interface CreateOfflineExpensePayload {
  category_id: string;
  amount: number;
  payment_method: LegacyPaymentValue;
  notes?: string;
}

export class FinanceOfflineService {
  private adapter = getOfflineStorageAdapter();
  private deviceId = getOrCreateDeviceId();
  private localSeq = 1;

  async processCustomerPayment(payload: CreateOfflineCustomerPaymentPayload) {
    const paymentId = generateUUIDv7();
    const localRef = generateLocalDocRef("PAY", this.deviceId, this.localSeq++);
    const timestamp = new Date().toISOString();

    const record = {
      id: paymentId,
      local_document_ref: localRef,
      customer_id: payload.customer_id,
      amount: payload.amount,
      payment_method: payload.payment_method,
      notes: payload.notes || null,
      created_at: timestamp,
      status: "pending_sync",
    };

    await this.adapter.setItem("customer_payments", paymentId, record);

    // Update customer local balance
    const customer = await customersRepo.getById(payload.customer_id);
    if (customer) {
      await customersRepo.update(customer.id, {
        balance: customer.balance - payload.amount,
      });
    }

    await globalSyncEngine.enqueue({
      entity_name: "create_customer_payment",
      operation_type: "RPC",
      payload: record,
      priority: "high",
      local_document_ref: localRef,
    });

    return record;
  }

  async processExpense(payload: CreateOfflineExpensePayload) {
    const expenseId = generateUUIDv7();
    const timestamp = new Date().toISOString();

    const record = {
      id: expenseId,
      category_id: payload.category_id,
      amount: payload.amount,
      payment_method: payload.payment_method,
      notes: payload.notes || null,
      created_at: timestamp,
    };

    await this.adapter.setItem("expenses", expenseId, record);

    await globalSyncEngine.enqueue({
      entity_name: "expenses",
      operation_type: "INSERT",
      payload: record,
      priority: "medium",
    });

    return record;
  }
}

export const financeOfflineService = new FinanceOfflineService();
