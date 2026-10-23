import { useState } from "react";
import {
  Banknote,
  Plus,
  Star,
  Check,
  Building2,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import {
  useCashboxes,
  useCreateCashbox,
  useUpdateCashbox,
  type CreateCashboxInput,
} from "@/hooks/use-cashboxes";
import { usePostableAssetAccounts } from "@/hooks/use-chart-accounts";
import { toast } from "sonner";

export function CashboxesManagement() {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const { cashboxes, defaultCashbox, isLoading, refetch } = useCashboxes();
  const { data: accounts = [] } = usePostableAssetAccounts();
  const createCashbox = useCreateCashbox();
  const updateCashbox = useUpdateCashbox();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Form State
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [code, setCode] = useState("");
  const [accountId, setAccountId] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [notes, setNotes] = useState("");

  const filteredCashboxes = cashboxes.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name_ar.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.name_en && c.name_en.toLowerCase().includes(q))
    );
  });

  const handleOpenAdd = () => {
    setNameAr("");
    setNameEn("");
    setCode(`CASH-0${cashboxes.length + 1}`);
    // Auto-select cash account 1101 if exists
    const defaultAcc = accounts.find((a) => a.code === "1101") || accounts[0];
    setAccountId(defaultAcc ? defaultAcc.id : "");
    setIsDefault(cashboxes.length === 0);
    setNotes("");
    setAddModalOpen(true);
  };

  const handleCreate = async () => {
    if (!nameAr.trim()) {
      return toast.error(
        isAr ? "يرجى إدخال اسم الصندوق بالعربية" : "Please enter the cashbox Arabic name",
      );
    }
    if (!code.trim()) {
      return toast.error(isAr ? "يرجى إدخال كود الصندوق" : "Please enter the cashbox code");
    }
    if (!accountId) {
      return toast.error(
        isAr ? "يرجى تحديد الحساب المحاسبي المرتبط" : "Please link an accounting ledger account",
      );
    }

    try {
      await createCashbox.mutateAsync({
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        code: code.trim().toUpperCase(),
        account_id: accountId,
        is_default: isDefault,
        notes: notes.trim() || null,
      });

      toast.success(isAr ? "تم إنشاء الصندوق بنجاح" : "Cashbox created successfully");
      setAddModalOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message || (isAr ? "فشل إنشاء الصندوق" : "Failed to create cashbox"));
    }
  };

  const handleToggleDefault = async (cashboxId: string, currentDefault: boolean) => {
    if (currentDefault) return; // already default
    try {
      await updateCashbox.mutateAsync({
        id: cashboxId,
        is_default: true,
      });
      toast.success(isAr ? "تم تعيين الصندوق كصندوق افتراضي" : "Cashbox set as default");
      refetch();
    } catch (err: any) {
      toast.error(err.message || (isAr ? "تعذر تحديث الصندوق" : "Failed to update cashbox"));
    }
  };

  const handleToggleActive = async (cashboxId: string, currentActive: boolean) => {
    try {
      await updateCashbox.mutateAsync({
        id: cashboxId,
        is_active: !currentActive,
      });
      toast.success(isAr ? "تم تحديث حالة الصندوق" : "Cashbox status updated");
      refetch();
    } catch (err: any) {
      toast.error(err.message || (isAr ? "تعذر تغيير حالة الصندوق" : "Failed to change status"));
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isAr ? "البحث في الصناديق والخزائن..." : "Search cashboxes..."}
            className="h-9 w-full rounded-xl border border-input/80 bg-background ps-9 pe-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>

        <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-[11px] font-medium text-primary">
          {isAr ? "الصناديق الافتراضية المرتبطة بالدليل المحاسبي" : "Default cashboxes linked to the chart of accounts"}
        </div>
      </div>

      {/* Cashboxes Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredCashboxes.length === 0 ? (
        <div className="rounded-2xl border border-border/80 bg-card/60 p-8 text-center space-y-2">
          <Banknote className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-semibold">
            {isAr ? "لا توجد صناديق مطابقة" : "No cashboxes found"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "أنشئ صناديق لنقاط البيع المختلفة أو الخزائن الرئيسية والفرعية."
              : "Create cashboxes for different counters or tills."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredCashboxes.map((box) => {
            const isDef = box.is_default;
            return (
              <div
                key={box.id}
                className={cn(
                  "rounded-2xl border p-4 transition-all space-y-3 bg-card/80",
                  isDef
                    ? "border-emerald-500/40 shadow-xs ring-1 ring-emerald-500/20"
                    : "border-border/70 hover:border-primary/40",
                  !box.is_active && "opacity-60 bg-muted/30",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm text-foreground">{box.name_ar}</span>
                      {isDef && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 text-[10px]"
                        >
                          {isAr ? "افتراضي" : "Default"}
                        </Badge>
                      )}
                      {!box.is_active && (
                        <Badge variant="outline" className="text-muted-foreground text-[10px]">
                          {isAr ? "معطّل" : "Disabled"}
                        </Badge>
                      )}
                    </div>
                    {box.name_en && <p className="text-xs text-muted-foreground">{box.name_en}</p>}
                  </div>

                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                    {box.code}
                  </span>
                </div>

                {/* Linked Ledger Account Info */}
                <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{isAr ? "الحساب المحاسبي المرتبط:" : "Linked Ledger Account:"}</span>
                    <span className="font-mono font-semibold text-primary">
                      {box.account?.code ?? "1101"}
                    </span>
                  </div>
                  <p className="truncate font-medium text-foreground">
                    {box.account?.name_ar ??
                      (isAr ? "الصندوق — النقدية في الخزينة" : "Cash on Hand")}
                  </p>
                </div>

                {/* Action Controls */}
                <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={box.is_active}
                      onCheckedChange={() => handleToggleActive(box.id, box.is_active)}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {box.is_active ? (isAr ? "مفعّل" : "Active") : isAr ? "متوقف" : "Inactive"}
                    </span>
                  </div>

                  {!isDef && box.is_active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleDefault(box.id, box.is_default)}
                      className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-emerald-700 hover:bg-emerald-500/10"
                    >
                      <Star className="h-3.5 w-3.5" />
                      <span>{isAr ? "تعيين كافتراضي" : "Set Default"}</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Cashbox Modal */}
      <VortexDrawerDialog
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        size="md"
        icon={<Banknote className="size-5" />}
        title={isAr ? "إضافة صندوق أو خزينة جديدة" : "Add New Cashbox"}
        subtitle={
          isAr
            ? "تحديد اسم الصندوق، كوده وربطه المباشر بحساب الأصول النقدية في الدليل المحاسبي"
            : "Define cashbox and link directly to a chart of accounts ledger account"
        }
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={handleCreate} disabled={createCashbox.isPending} className="gap-1.5">
              {createCashbox.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span>{isAr ? "حفظ الصندوق" : "Save Cashbox"}</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5 py-1 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1 text-foreground">
                {isAr ? "اسم الصندوق (بالعربية) *" : "Cashbox Name (Arabic) *"}
              </label>
              <input
                type="text"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder={isAr ? "مثال: صندوق الكاونتر رقم 2" : "e.g. Till #2"}
                className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1 text-muted-foreground">
                {isAr ? "الاسم بالإنجليزية (اختياري)" : "English Name (Optional)"}
              </label>
              <input
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="e.g. Counter 2 Cashbox"
                className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1 text-foreground">
                {isAr ? "كود الصندوق الفريد *" : "Unique Code *"}
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CASH-02"
                className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1 text-foreground">
                {isAr ? "الحساب المحاسبي في الدليل *" : "Chart of Accounts Ledger Account *"}
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              >
                <option value="">{isAr ? "اختر الحساب..." : "Select account..."}</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.code} — {acc.name_ar}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} id="set-default-box" />
            <label htmlFor="set-default-box" className="cursor-pointer text-xs font-medium">
              {isAr
                ? "تعيين كصندوق افتراضي لنقاط البيع وفواتير المبيعات"
                : "Set as default till for POS and sales"}
            </label>
          </div>

          <div>
            <label className="font-semibold block mb-1 text-muted-foreground">
              {isAr ? "ملاحظات إضافية" : "Notes"}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isAr ? "ملاحظات حول موقع الصندوق أو الكاشير المسؤول..." : "Notes..."}
              className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
        </div>
      </VortexDrawerDialog>
    </div>
  );
}
