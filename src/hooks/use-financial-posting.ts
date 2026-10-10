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
  accountId?: string | null;
  note?: string | null;
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

        // Keep catalogue ids at the application boundary and translate only for
        // legacy ENUM columns. The original id is not persisted by these legacy
        // tables, so this adapter preserves compatibility but cannot distinguish
        // providers that share the same ENUM value.
        const dbMethod = toLegacyPaymentValue(method);

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

        if (type === "customer_collection" || params.partyType === "customer") {
          const { data, error } = await (supabase as any).rpc("record_customer_payment", {
            _customer_id: partyId,
            _invoice_id: invoiceId || null,
            _amount: amount,
            _method: dbMethod,
            _payment_date: paymentDate,
            _note: fullNote || null,
          });

          if (error) {
            console.error("RPC record_customer_payment failed:", error);
            throw error;
          }
          paymentId = typeof data === "string" ? data : data?.id || undefined;
        } else {
          if (type !== "supplier_payment") {
            throw new Error(
              lang === "ar"
                ? "نوع العملية المالية غير مدعوم"
                : "Unsupported financial operation type",
            );
          }

          const { data, error } = await (supabase as any)
            .from("supplier_payments")
            .insert({
              supplier_id: partyId,
              amount: amount,
              payment_method: dbMethod,
              payment_date: paymentDate,
              notes: fullNote || null,
            })
            .select("id")
            .single();

          if (error) throw error;
          paymentId = data?.id;
        }

        const receiptNumber = paymentId
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
