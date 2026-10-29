/**
 * payment-rules.ts — قواعد الدفع المشتركة، بلا React وبلا DOM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY A SEPARATE MODULE FROM THE PANEL
 * ════════════════════════════════════════════════════════════════════════════
 * The arithmetic is the part that must be identical on every screen, and the
 * part worth testing without a browser. `usePaymentPanel` is a thin React
 * wrapper around `resolvePayment`, and the tests import this file directly.
 *
 * Every branch here mirrors a rule the database also enforces, so the operator
 * sees the same sentence the server would have raised:
 *
 *   create_sale          "A customer is required when the sale has an unpaid amount"
 *   create_sale  (P1-6)  "The system cash customer cannot carry credit"
 *   create_sale          "Credit limit exceeded: current balance …, limit …"
 *   post_sales_invoice   "a payment cannot exceed the invoice"
 */

import {
  getPaymentMethodDefinition,
  requiresPaymentReference,
  type PaymentMethodDefinition,
} from "./payment-methods";

export interface PaymentCustomer {
  id: string;
  name: string;
  balance?: number | null;
  credit_limit?: number | null;
  /** `customers.is_system` — the seeded cash customer, which must never owe. */
  is_system?: boolean | null;
}

export type PaymentBlockingReason =
  | "overpaid"
  | "credit_method_requires_zero_paid"
  | "customer_required_for_credit"
  | "credit_customer_locked"
  | "credit_limit";

export interface PaymentResolution {
  definition: PaymentMethodDefinition | undefined;
  isCredit: boolean;
  isCash: boolean;
  total: number;
  paid: number;
  remaining: number;
  /** Cash handed over above the total. */
  change: number;
  isOverpaid: boolean;
  isPaidEmpty: boolean;
  needsReference: boolean;
  customer: PaymentCustomer | undefined;
  isSystemCustomer: boolean;
  debtOnSystemCustomer: boolean;
  debtWithoutCustomer: boolean;
  exceedsCreditLimit: boolean;
  projectedBalance: number;
  creditLimit: number | null;
  /** Remaining > 0 on a customer that may carry it. */
  booksAsDebt: boolean;
  /** Answer already rounded to the fils/piaster the ledger stores. */
  payable: boolean;
  blockingReason: PaymentBlockingReason | null;
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export interface ResolvePaymentInput {
  total: number;
  /** Catalogue id (e.g. "kuraimi_bank") or a residual ENUM value. */
  method: string;
  /** What the operator typed. Empty means "not decided yet". */
  paidRaw: string;
  customerId: string | null | undefined;
  customers?: PaymentCustomer[];
}

export function resolvePaidAmount(
  total: number,
  method: string,
  paidRaw: string,
  paidManuallyEdited: boolean,
): number {
  const totalN = Math.max(0, roundMoney(total));
  if (method === "credit") return 0;
  if (!paidManuallyEdited) return totalN;

  const trimmed = paidRaw.trim();
  if (trimmed === "") return 0;
  const typed = Number(trimmed);
  return Math.max(0, Number.isFinite(typed) ? typed : 0);
}

export function resolvePayment({
  total,
  method,
  paidRaw,
  customerId,
  customers,
}: ResolvePaymentInput): PaymentResolution {
  const definition = getPaymentMethodDefinition(method);
  const isCredit = Boolean(definition?.isCreditTerm) || method === "credit";
  const isCash = definition?.ledgerKind === "CASH" || method === "cash";
  const totalN = Math.max(0, roundMoney(total));

  const isPaidEmpty = paidRaw.trim() === "";
  const typed = isPaidEmpty ? NaN : Number(paidRaw);
  const paidAmount = resolvePaidAmount(totalN, method, paidRaw, !isPaidEmpty);
  const creditMethodHasPayment = isCredit && !isPaidEmpty && Number.isFinite(typed) && typed > 0;

  // 1. A credit term collects nothing now. Anything else defaults to "paid in
  //    full" when the field is left empty — the counter's usual case.
  const paid = isCredit ? 0 : Math.min(paidAmount, totalN);

  // 2. Above the total is CHANGE on cash, and an error on anything else.
  const overTender = !isCredit && !isPaidEmpty && Number.isFinite(typed) && typed > totalN;
  const change = isCash && overTender ? roundMoney(typed - totalN) : 0;
  const isOverpaid = overTender && !isCash;

  const remaining = Math.max(0, roundMoney(totalN - paid));

  const customer = customers?.find((c) => c.id === customerId);
  const isSystemCustomer = Boolean(customer?.is_system);
  const debtWithoutCustomer = remaining > 0 && !customer;
  const debtOnSystemCustomer = remaining > 0 && isSystemCustomer;

  const projectedBalance = roundMoney(Number(customer?.balance ?? 0) + remaining);
  const rawLimit = customer?.credit_limit;
  const creditLimit =
    rawLimit === null || rawLimit === undefined || Number(rawLimit) <= 0 ? null : Number(rawLimit);
  const exceedsCreditLimit =
    remaining > 0 &&
    !debtOnSystemCustomer &&
    creditLimit !== null &&
    projectedBalance > creditLimit;

  // 3. One reason at a time, in the order the operator can act on it.
  const blockingReason: PaymentBlockingReason | null = isOverpaid
    ? "overpaid"
    : creditMethodHasPayment
      ? "credit_method_requires_zero_paid"
      : debtWithoutCustomer
        ? "customer_required_for_credit"
        : debtOnSystemCustomer
          ? "credit_customer_locked"
          : exceedsCreditLimit
            ? "credit_limit"
            : null;

  return {
    definition,
    isCredit,
    isCash,
    total: totalN,
    paid,
    remaining,
    change,
    isOverpaid,
    isPaidEmpty,
    needsReference: requiresPaymentReference(method),
    customer,
    isSystemCustomer,
    debtOnSystemCustomer,
    debtWithoutCustomer,
    exceedsCreditLimit,
    projectedBalance,
    creditLimit,
    booksAsDebt: remaining > 0 && Boolean(customer) && !isSystemCustomer,
    payable: blockingReason === null,
    blockingReason,
  };
}
