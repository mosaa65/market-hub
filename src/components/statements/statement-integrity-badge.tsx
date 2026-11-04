/**
 * StatementIntegrityBadge — شارة فرق التسوية
 *
 * قرار المستخدم #1: شارة تحذير واضحة.
 * تُظهر الفرق بين رصيد الدفتر (مصدر الحقيقة) والرصيد المخزَّن في الجدول،
 * مع تفسير السبب المرجّح (مرتجعات/تسويات لم تُقيَّد في الدفتر).
 *
 * ⚠️ عرض فقط — لا حساب. تقرأ StatementIntegrity من StatementResult.
 *
 * لا يختفي التحذير عند تشغيل المطابقة: زر «إعادة احتساب» يستدعي دالة قاعدة
 * البيانات (مصدر الحقيقة) ثم يُعيد قراءة الكشف. إن بقى الفرق ظاهرًا بعدها،
 * فسببه مستند مالي مفقود لا رقم مخزَّن، ولا يُصلح بزر.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtAmount } from "@/lib/statements/format";
import type { StatementIntegrity } from "@/lib/statements/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface StatementIntegrityBadgeProps {
  integrity: StatementIntegrity;
  /** مدمج: شارة صغيرة للسطور · موسّع: بطاقة تحذير كاملة */
  variant?: "inline" | "panel";
  className?: string;
  /** عميل الكشف — عند تمريره يظهر زر إعادة الاحتساب في البطاقة */
  customerId?: string;
  /** يُستدعى بعد نجاح المطابقة لإعادة قراءة الكشف */
  onReconciled?: () => void;
}

export function StatementIntegrityBadge({
  integrity,
  variant = "inline",
  className,
  customerId,
  onReconciled,
}: StatementIntegrityBadgeProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [reconciling, setReconciling] = useState(false);

  async function reconcile() {
    if (!customerId || reconciling) return;
    setReconciling(true);
    try {
      const { data, error } = await (supabase.rpc as any)("recalculate_customer_balance", {
        p_customer_id: customerId,
        p_reason: ar ? "مطابقة من كشف الحساب" : "Reconciliation from account statement",
        p_type: "recalculation",
      });
      if (error) throw error;
      const result = (data ?? {}) as { difference?: number; changed?: boolean; status?: string };
      if (result.status === "broken_documents") {
        toast.warning(
          ar
            ? "تمّت المطابقة، لكن هناك مستند مالي مفقود وراء الفرق — يحتاج مراجعة محاسبية"
            : "Reconciled, but a missing financial document explains the gap — needs accountant review",
        );
      } else if (result.changed) {
        toast.success(
          ar
            ? "تمت مطابقة الرصيد المخزَّن مع دفتر العميل"
            : "Cached balance reconciled with the customer ledger",
        );
      } else {
        toast.info(ar ? "الرصيد مطابق أصلًا" : "Balance already reconciled");
      }
      onReconciled?.();
    } catch (error) {
      toast.error((error as Error)?.message ?? (ar ? "تعذّرت المطابقة" : "Reconciliation failed"));
    } finally {
      setReconciling(false);
    }
  }

  // لا فرق → لا شيء يُعرض في النمط المدمج، وتأكيد صغير في النمط الموسّع
  if (!integrity.hasGap) {
    if (variant === "inline") return null;
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5 text-xs text-emerald-600",
          className,
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>
          {ar
            ? "مطابقة تامة: رصيد الدفتر يساوي الرصيد المخزَّن"
            : "Fully reconciled: ledger matches cached balance"}
        </span>
      </div>
    );
  }

  const difference = integrity.difference ?? 0;
  const absDiff = fmtAmount(Math.abs(difference));
  const ledger = fmtAmount(integrity.ledgerBalance);
  const cached = fmtAmount(integrity.cachedBalance ?? 0);

  const tooltipText = ar
    ? `رصيد الدفتر: ${ledger} · الرصيد المخزَّن: ${cached} · الفرق: ${absDiff}`
    : `Ledger: ${ledger} · Cached: ${cached} · Difference: ${absDiff}`;

  const reason = ar
    ? "السبب المرجّح: مرتجعات أو تسويات لم تُقيَّد في دفتر العميل. يُنصح بمراجعة تقرير المطابقة قبل الاعتماد على الرصيد المخزَّن."
    : "Likely cause: returns or adjustments not posted to the customer ledger. Review the reconciliation report before trusting the cached balance.";

  if (variant === "inline") {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex cursor-help items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600",
                className,
              )}
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {ar ? `فرق ${absDiff}` : `Gap ${absDiff}`}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5 text-xs",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 space-y-1">
          <div className="font-semibold text-amber-700">
            {ar
              ? "تنبيه تسوية: يوجد فرق بين رصيد الدفتر والرصيد المخزَّن"
              : "Reconciliation warning: ledger and cached balance differ"}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-amber-700/90">
            <span>
              {ar ? "رصيد الدفتر" : "Ledger"}: <b>{ledger}</b>
            </span>
            <span className="opacity-40">|</span>
            <span>
              {ar ? "المخزَّن" : "Cached"}: <b>{cached}</b>
            </span>
            <span className="opacity-40">|</span>
            <span>
              {ar ? "الفرق" : "Difference"}: <b>{absDiff}</b>
            </span>
          </div>
          <div className="flex items-start gap-1.5 pt-0.5 text-[11px] text-amber-700/80">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{reason}</span>
          </div>
          {customerId && (
            <button
              type="button"
              onClick={reconcile}
              disabled={reconciling}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-500/20 disabled:opacity-60"
            >
              {reconciling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {ar ? "إعادة احتساب من دفتر العميل" : "Recalculate from ledger"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * شارة اشتقاق البيانات — تظهر لكشف المورد (قرار المستخدم #2: وسم واضح).
 * تُوضّح أن حركات السداد مُشتقّة من purchase_invoices.paid بلا تاريخ سداد مستقل.
 */
export function DerivedDataBadge({ className }: { className?: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex cursor-help items-center gap-1 rounded-full border border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-600",
              className,
            )}
          >
            <Info className="h-3 w-3 shrink-0" />
            {ar ? "بيانات مُشتقّة" : "Derived data"}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {ar
            ? "لا يوجد دفتر موردين في النظام، لذلك تُشتقّ الحركات من فواتير التوريد ومرتجعات المشتريات. حركات السداد مُعلَّمة بـ «سداد مرافق للفاتورة» لأن قيمة السداد مخزَّنة داخل الفاتورة بلا تاريخ سداد مستقل."
            : "No supplier ledger exists; entries are derived from purchase invoices and returns. Payments are tagged as bundled with the invoice."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * شارة نوع المصدر — تُوضّح من أين جاءت الأرقام.
 */
export function SourceBadge({
  derived,
  hasSourceData,
  className,
}: {
  derived: boolean;
  hasSourceData: boolean;
  className?: string;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  if (!hasSourceData) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-muted-foreground/25 bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground",
          className,
        )}
      >
        <Info className="h-3 w-3 shrink-0" />
        {ar ? "لا توجد حركات" : "No movements"}
      </span>
    );
  }

  return derived ? (
    <DerivedDataBadge className={className} />
  ) : (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600",
        className,
      )}
    >
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      {ar ? "من دفتر الحساب" : "From ledger"}
    </span>
  );
}
