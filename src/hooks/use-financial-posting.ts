import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { toLegacyPaymentValue } from "@/lib/payments/payment-methods";

export type FinancialOperationType = "customer_collection" | "supplier_payment";

/**
 * The method this hook accepts is a CATALOGUE ID, exactly like every picker in
 * the application produces. The old `"transfer"` member is gone with the map
 * that used to translate it: the map defaulted anything it did not recognise to
 * `cash`, so a wallet the operator chose was recorded as cash and credited the
 * till — the same class of bug the catalogue was built to remove.
 */
export type PaymentMethodType = string;

export interface PostFinancialPaymentParams {
  type?: FinancialOperationType;
  partyId: string;
  partyType?: "customer" | "supplier";
  amount: number;
  method: PaymentMethodType;
  invoiceId?: string | null;
  paymentDate?: string;
  reference?: string | null;
  cashboxId?: string | null;
  bankAccountId?: string | null;
  paymentMethodId?: string | null;
  accountId?: string | null;
  note?: string | null;
  chequeNumber?: string | null;
  chequeBank?: string | null;
  chequeDueDate?: string | null;
  chequeDrawer?: string | null;
  /** An advance is explicit; ordinary collections are never allowed to exceed debt. */
  collectionMode?: "receivable" | "advance";
}

export interface PostFinancialPaymentResult {
  success: boolean;
  paymentId?: string;
  receiptNumber: string;
  amount: number;
  date: string;
}

export function useFinancialPosting() {
  const { lang } = useI18n();
  const queryClient = useQueryClient();
  const [isPosting, setIsPosting] = useState(false);

  const postPayment = useCallback(
    async (params: PostFinancialPaymentParams): Promise<PostFinancialPaymentResult> => {
      setIsPosting(true);
      try {
        const {
          type = "customer_collection",
          partyId,
          amount,
          method,
          invoiceId,
          paymentDate = new Date().toISOString().slice(0, 10),
          reference,
          note,
          collectionMode = "receivable",
        } = params;

        if (!partyId) {
          throw new Error(
            lang === "ar" ? "يجب اختيار العميل أو الطرف المعني" : "Customer or party is required",
          );
        }

        if (!amount || amount <= 0) {
          throw new Error(
            lang === "ar"
              ? "يجب إدخال مبلغ صحيح أكبر من الصفر"
              : "Valid positive amount is required",
          );
        }

        const trimmedReference = reference?.trim();
        if (trimmedReference && /[\r\n]/.test(trimmedReference)) {
          throw new Error(
            lang === "ar"
              ? "رقم المرجع لا يمكن أن يحتوي على أسطر جديدة"
              : "Reference cannot contain line breaks",
          );
        }

        const fullNote = [
          trimmedReference ? `${lang === "ar" ? "مرجع:" : "Ref:"} ${trimmedReference}` : null,
          note ? note.trim() : null,
        ]
          .filter(Boolean)
          .join(" | ");

        let paymentId: string | undefined;
        let voucherNumber: string | undefined;

        if (type === "customer_collection" || params.partyType === "customer") {
          const rpcName =
            collectionMode === "advance"
              ? "record_customer_advance_payment"
              : "record_customer_payment";

          let data: any = null;
          let error: any = null;

          if (collectionMode === "advance") {
            const res = await (supabase as any).rpc(rpcName, {
              _customer_id: partyId,
              _amount: amount,
              _method: method,
              _payment_date: paymentDate,
              _note: fullNote || null,
            });
            data = res.data;
            error = res.error;
          } else {
            // Use the full signature so treasury routing and cheque details are
            // posted atomically with the customer receipt.
            const res = await (supabase as any).rpc("record_customer_payment", {
              _customer_id: partyId,
              _invoice_id: invoiceId || null,
              _amount: amount,
              _method: params.paymentMethodId || method,
              _payment_date: paymentDate,
              _note: fullNote || null,
              _cashbox_id: params.cashboxId || null,
              _bank_account_id: params.bankAccountId || null,
              _payment_method_id: params.paymentMethodId || method || null,
              _cheque_number: params.chequeNumber || null,
              _cheque_bank: params.chequeBank || null,
              _cheque_due_date: params.chequeDueDate || null,
              _cheque_drawer: params.chequeDrawer || null,
            });
            data = res.data;
            error = res.error;
          }

          if (error) {
            console.error("RPC record_customer_payment failed:", error);
            throw error;
          }
          paymentId = typeof data === "string" ? data : data?.id || undefined;
          if (!paymentId) {
            throw new Error(
              lang === "ar"
                ? "لم يرجع النظام رقم سند التحصيل؛ تحقق من سجل العميل قبل إعادة المحاولة."
                : "The collection returned no receipt ID. Verify the customer ledger before retrying.",
            );
          }

          // Persist treasury link into customer_payments row
          if (
            paymentId &&
            (params.cashboxId || params.bankAccountId || params.paymentMethodId || params.reference)
          ) {
            try {
              await (supabase as any)
                .from("customer_payments")
                .update({
                  cashbox_id: params.cashboxId || null,
                  bank_account_id: params.bankAccountId || null,
                  payment_method_id: params.paymentMethodId || params.method || null,
                  payment_reference: params.reference || null,
                })
                .eq("id", paymentId);
            } catch (e) {
              console.warn("Could not set treasury keys on customer_payments:", e);
            }
          }
        } else {
          if (type !== "supplier_payment") {
            throw new Error(
              lang === "ar"
                ? "نوع العملية المالية غير مدعوم"
                : "Unsupported financial operation type",
            );
          }

          // Use atomic record_supplier_payment RPC first (Dr 2111 / Cr cashbox/bank)
          try {
            const res = await (supabase as any).rpc("record_supplier_payment", {
              p_supplier_id: partyId,
              p_amount: amount,
              p_payment_method: toLegacyPaymentValue(method).toUpperCase(),
              p_account_code: params.accountId || null,
              p_payment_date: paymentDate,
              p_notes: fullNote || null,
              p_cashbox_id: params.cashboxId || null,
              p_bank_account_id: params.bankAccountId || null,
            });
            if (res.error) throw res.error;
            paymentId = res.data?.payment_id || res.data?.id;
            voucherNumber = res.data?.voucher_number;
          } catch (rpcErr) {
            console.warn("RPC record_supplier_payment fallback to direct insert:", rpcErr);
            const dbMethod = toLegacyPaymentValue(method);
            const { data, error } = await (supabase as any)
              .from("supplier_payments")
              .insert({
                supplier_id: partyId,
                amount: amount,
                payment_method: dbMethod,
                payment_date: paymentDate,
                notes: fullNote || null,
                cashbox_id: params.cashboxId || null,
                bank_account_id: params.bankAccountId || null,
                payment_method_id: params.paymentMethodId || params.method || null,
              })
              .select("id, voucher_number")
              .single();

            if (error) throw error;
            paymentId = data?.id;
            voucherNumber = data?.voucher_number;
          }
        }

        const receiptNumber = voucherNumber
          ? voucherNumber
          : paymentId
            ? paymentId.slice(0, 8).toUpperCase()
            : String(Date.now()).slice(-6);

        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ["customers"] }),
          queryClient.invalidateQueries({ queryKey: ["customer", partyId] }),
          queryClient.invalidateQueries({ queryKey: ["customer_ledger"] }),
          queryClient.invalidateQueries({ queryKey: ["customer-ledger"] }),
          queryClient.invalidateQueries({ queryKey: ["customer-payments"] }),
          queryClient.invalidateQueries({ queryKey: ["sales-invoices"] }),
          queryClient.invalidateQueries({ queryKey: ["sales"] }),
          queryClient.invalidateQueries({ queryKey: ["debts"] }),
          queryClient.invalidateQueries({ queryKey: ["payments"] }),
          queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
          queryClient.invalidateQueries({ queryKey: ["supplier-payments"] }),
        ]);

        toast.success(
          lang === "ar"
            ? `تم تسجيل السند رقم ${receiptNumber} بنجاح`
            : `Voucher #${receiptNumber} recorded successfully`,
        );

        return {
          success: true,
          paymentId,
          receiptNumber,
          amount,
          date: paymentDate,
        };
      } catch (err: any) {
        console.error("Financial posting error:", err);
        const errMsg =
          err?.message ||
          (lang === "ar" ? "فشلت عملية حفظ السند المالي" : "Failed to record payment");
        toast.error(errMsg);
        throw err;
      } finally {
        setIsPosting(false);
      }
    },
    [lang, queryClient],
  );

  return {
    postPayment,
    isPosting,
  };
}
