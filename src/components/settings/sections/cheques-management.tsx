import { useState } from "react";
import {
  FileCheck2,
  CheckCircle2,
  Check,
  XCircle,
  Clock,
  RotateCcw,
  Landmark,
  Search,
  Loader2,
  Calendar,
  AlertTriangle,
  User,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { useCheques, useClearCheque, useBounceCheque } from "@/hooks/use-cheques";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import type { ChequeRecord, ChequeStatus } from "@/lib/payments/treasury-types";
import { toast } from "sonner";

export function ChequesManagement() {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [statusFilter, setStatusFilter] = useState<ChequeStatus | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const { cheques, isLoading, refetch } = useCheques(
    statusFilter === "ALL" ? undefined : statusFilter,
  );
  const { banks } = useCompanyBankAccounts("BANK");
  const clearChequeMutation = useClearCheque();
  const bounceChequeMutation = useBounceCheque();

  // Modals state
  const [selectedCheque, setSelectedCheque] = useState<ChequeRecord | null>(null);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [bounceModalOpen, setBounceModalOpen] = useState(false);

  // Clear modal fields
  const [clearingBankAccountId, setClearingBankAccountId] = useState("");
  const [clearedDate, setClearedDate] = useState(new Date().toISOString().slice(0, 10));
  const [clearNotes, setClearNotes] = useState("");

  // Bounce modal fields
  const [bounceReason, setBounceReason] = useState("");
  const [bouncePenalty, setBouncePenalty] = useState("");

  const filteredCheques = cheques.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      c.cheque_number.toLowerCase().includes(q) ||
      c.bank_name.toLowerCase().includes(q) ||
      (c.drawer_name && c.drawer_name.toLowerCase().includes(q)) ||
      (c.customer?.name && c.customer.name.toLowerCase().includes(q))
    );
  });

  const handleOpenClear = (cheque: ChequeRecord) => {
    setSelectedCheque(cheque);
    setClearingBankAccountId(banks[0]?.id || "");
    setClearedDate(new Date().toISOString().slice(0, 10));
    setClearNotes("");
    setClearModalOpen(true);
  };

  const handleOpenBounce = (cheque: ChequeRecord) => {
    setSelectedCheque(cheque);
    setBounceReason("عدم كفاية الرصيد");
    setBouncePenalty("");
    setBounceModalOpen(true);
  };

  const handleExecuteClear = async () => {
    if (!selectedCheque) return;
    if (!clearingBankAccountId) {
      return toast.error(
        isAr
          ? "يرجى تحديد الحساب البنكي المودع فيه الشيك"
          : "Please select depositing bank account",
      );
    }

    try {
      await clearChequeMutation.mutateAsync({
        chequeId: selectedCheque.id,
        clearingBankAccountId,
        clearedDate,
        notes: clearNotes.trim() || undefined,
      });

      toast.success(
        isAr
          ? "تم تحصيل الشيك وإيداعه في الحساب البنكي بنجاح"
          : "Cheque cleared and deposited successfully",
      );
      setClearModalOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message || (isAr ? "فشل تحصيل الشيك" : "Failed to clear cheque"));
    }
  };

  const handleExecuteBounce = async () => {
    if (!selectedCheque) return;
    try {
      await bounceChequeMutation.mutateAsync({
        chequeId: selectedCheque.id,
        reason: bounceReason.trim() || "عدم كفاية الرصيد",
        penaltyAmount: Number(bouncePenalty) || 0,
      });

      toast.success(
        isAr ? "تم تسجيل ارتداد الشيك وإعادة المديونية للعميل" : "Cheque marked as bounced",
      );
      setBounceModalOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message || (isAr ? "فشل تسجيل ارتداد الشيك" : "Failed to bounce cheque"));
    }
  };

  const getStatusBadge = (status: ChequeStatus) => {
    switch (status) {
      case "UNDER_COLLECTION":
        return (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 gap-1 text-[11px]"
          >
            <Clock className="h-3 w-3" />
            <span>{isAr ? "برسم التحصيل" : "Under Collection"}</span>
          </Badge>
        );
      case "CLEARED":
        return (
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 gap-1 text-[11px]"
          >
            <CheckCircle2 className="h-3 w-3" />
            <span>{isAr ? "تم الصرف والإيداع" : "Cleared"}</span>
          </Badge>
        );
      case "BOUNCED":
        return (
          <Badge
            variant="outline"
            className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 gap-1 text-[11px]"
          >
            <XCircle className="h-3 w-3" />
            <span>{isAr ? "مرتد" : "Bounced"}</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[11px]">
            {status}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Filter Tabs and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-muted/30 p-1 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={cn(
              "px-3 py-1.5 rounded-lg font-medium transition",
              statusFilter === "ALL"
                ? "bg-background text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {isAr ? "كافة الشيكات" : "All Cheques"}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("UNDER_COLLECTION")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition",
              statusFilter === "UNDER_COLLECTION"
                ? "bg-background text-amber-800 dark:text-amber-200 shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <span>{isAr ? "برسم التحصيل" : "Under Collection"}</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("CLEARED")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition",
              statusFilter === "CLEARED"
                ? "bg-background text-emerald-800 dark:text-emerald-200 shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>{isAr ? "المحصلة" : "Cleared"}</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("BOUNCED")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition",
              statusFilter === "BOUNCED"
                ? "bg-background text-rose-800 dark:text-rose-200 shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <XCircle className="h-3.5 w-3.5 text-rose-600" />
            <span>{isAr ? "المرتدة" : "Bounced"}</span>
          </button>
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isAr ? "بحث برقم الشيك، العميل أو البنك..." : "Search cheques..."}
            className="h-9 w-full rounded-xl border border-input/80 bg-background ps-9 pe-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* Cheques Grid / Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredCheques.length === 0 ? (
        <div className="rounded-2xl border border-border/80 bg-card/60 p-8 text-center space-y-2">
          <FileCheck2 className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-semibold">
            {isAr ? "لا توجد شيكات مطابقة" : "No cheques found"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "الشيكات المقبوضة من العملاء تُسجل تلقائياً كأوراق قبض برسم التحصيل وتظهر هنا."
              : "Customer received cheques will appear here for collection or clearance."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredCheques.map((c) => {
            const isPending = c.status === "UNDER_COLLECTION";

            return (
              <div
                key={c.id}
                className={cn(
                  "rounded-2xl border p-4 transition-all space-y-3 bg-card/80",
                  isPending
                    ? "border-amber-500/35 hover:border-amber-500/60 shadow-xs"
                    : "border-border/70",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm font-mono text-foreground">
                        #{c.cheque_number}
                      </span>
                      {getStatusBadge(c.status)}
                    </div>
                    <p className="text-xs font-medium text-foreground truncate">{c.bank_name}</p>
                  </div>

                  <span className="font-mono text-base font-bold text-primary tabular-nums shrink-0">
                    {money(c.amount)}
                  </span>
                </div>

                {/* Drawer & Customer */}
                <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{isAr ? "العميل:" : "Customer:"}</span>
                    <span className="font-semibold text-foreground truncate">
                      {c.customer?.name ?? (isAr ? "عميل نقدي" : "Cash")}
                    </span>
                  </div>
                  {c.drawer_name && (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>{isAr ? "اسم الساحب:" : "Drawer:"}</span>
                      <span className="text-foreground truncate">{c.drawer_name}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-muted-foreground border-t border-border/40 pt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {isAr ? "تاريخ الاستحقاق:" : "Due Date:"}
                    </span>
                    <span className="font-mono font-medium text-foreground">{c.due_date}</span>
                  </div>
                </div>

                {/* Actions for Pending Cheques */}
                {isPending && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                    <Button
                      size="sm"
                      onClick={() => handleOpenClear(c)}
                      className="flex-1 h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{isAr ? "صرف وإيداع" : "Clear"}</span>
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenBounce(c)}
                      className="h-8 rounded-xl border-rose-500/40 text-rose-600 hover:bg-rose-500/10 gap-1 text-xs"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>{isAr ? "ارتداد" : "Bounce"}</span>
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Clear Cheque Modal */}
      <VortexDrawerDialog
        open={clearModalOpen}
        onOpenChange={setClearModalOpen}
        size="md"
        icon={<CheckCircle2 className="size-5 text-emerald-600" />}
        title={isAr ? "تحصيل الشيك وإيداعه في البنك" : "Clear & Deposit Cheque"}
        subtitle={
          isAr
            ? `شيك رقم #${selectedCheque?.cheque_number} بمبلغ ${money(selectedCheque?.amount || 0)}`
            : `Cheque #${selectedCheque?.cheque_number} with amount ${money(selectedCheque?.amount || 0)}`
        }
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => setClearModalOpen(false)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={handleExecuteClear}
              disabled={clearChequeMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              {clearChequeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>{isAr ? "تأكيد الصرف والترحيل للبنك" : "Confirm Clearance"}</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5 py-1 text-xs">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-900 dark:text-emerald-200">
            <p className="font-semibold text-xs mb-1">
              {isAr ? "الأثر المحاسبي التلقائي للتحصيل:" : "Automatic Accounting Effect:"}
            </p>
            <p className="text-[11px] leading-relaxed">
              {isAr
                ? "سيتم خصم أوراق القبض (1221) وإيداع المبلغ في حساب البنك المختار، مع تسجيل قيد يومية متزن آلياً."
                : "Dr Bank Account / Cr Notes Receivable (1221)."}
            </p>
          </div>

          <div>
            <label className="font-semibold block mb-1 text-foreground">
              {isAr ? "الحساب البنكي المودع فيه المبلغ *" : "Depositing Bank Account *"}
            </label>
            <select
              value={clearingBankAccountId}
              onChange={(e) => setClearingBankAccountId(e.target.value)}
              className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
              <option value="">{isAr ? "اختر الحساب البنكي..." : "Select bank account..."}</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name_ar} {b.account_number ? `(${b.account_number})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-semibold block mb-1 text-foreground">
              {isAr ? "تاريخ التحصيل الفعلي *" : "Clearance Date *"}
            </label>
            <input
              type="date"
              value={clearedDate}
              onChange={(e) => setClearedDate(e.target.value)}
              className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="font-semibold block mb-1 text-muted-foreground">
              {isAr ? "ملاحظات إضافية" : "Notes"}
            </label>
            <input
              type="text"
              value={clearNotes}
              onChange={(e) => setClearNotes(e.target.value)}
              placeholder={isAr ? "مثال: إشعار إيداع بنكي رقم..." : "Deposit advice number..."}
              className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
        </div>
      </VortexDrawerDialog>

      {/* Bounce Cheque Modal */}
      <VortexDrawerDialog
        open={bounceModalOpen}
        onOpenChange={setBounceModalOpen}
        size="md"
        icon={<AlertTriangle className="size-5 text-rose-600" />}
        title={isAr ? "إثبات ارتداد الشيك وإعادة المديونية" : "Mark Cheque as Bounced"}
        subtitle={
          isAr
            ? `شيك رقم #${selectedCheque?.cheque_number} للعميل ${selectedCheque?.customer?.name || ""}`
            : `Cheque #${selectedCheque?.cheque_number}`
        }
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => setBounceModalOpen(false)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={handleExecuteBounce}
              disabled={bounceChequeMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white gap-1.5"
            >
              {bounceChequeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <span>{isAr ? "تأكيد الارتداد وإعادة المديونية" : "Confirm Bounce"}</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5 py-1 text-xs">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-900 dark:text-rose-200">
            <p className="font-semibold text-xs mb-1">
              {isAr ? "الأثر المحاسبي لارتداد الشيك:" : "Accounting Impact:"}
            </p>
            <p className="text-[11px] leading-relaxed">
              {isAr
                ? "سيتم إلغاء ورقة القبض (1221) وإعادة مديونية الشيك بالكامل على كشف حساب العميل (1211) مع إنشاء قيد محاسبي عكسي آلي."
                : "Dr Accounts Receivable (1211) / Cr Notes Receivable (1221)."}
            </p>
          </div>

          <div>
            <label className="font-semibold block mb-1 text-foreground">
              {isAr ? "سبب الارتداد *" : "Bounce Reason *"}
            </label>
            <input
              type="text"
              value={bounceReason}
              onChange={(e) => setBounceReason(e.target.value)}
              placeholder={
                isAr ? "مثال: عدم كفاية الرصيد، عدم مطابقة التوقيع" : "e.g. Insufficient funds"
              }
              className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
            />
          </div>
        </div>
      </VortexDrawerDialog>
    </div>
  );
}
