import { useState } from "react";
import {
  Landmark,
  Smartphone,
  Plus,
  Star,
  Check,
  Building2,
  CheckCircle2,
  Loader2,
  Search,
  Wallet,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import {
  useCompanyBankAccounts,
  useCreateCompanyBankAccount,
  useUpdateCompanyBankAccount,
} from "@/hooks/use-company-bank-accounts";
import { usePostableAssetAccounts } from "@/hooks/use-chart-accounts";
import type { BankAccountKind } from "@/lib/payments/treasury-types";
import { toast } from "sonner";

export function BankAccountsManagement() {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const { accounts, banks, wallets, isLoading, refetch } = useCompanyBankAccounts();
  const { data: chartAccounts = [] } = usePostableAssetAccounts();
  const createAccount = useCreateCompanyBankAccount();
  const updateAccount = useUpdateCompanyBankAccount();

  const [activeTab, setActiveTab] = useState<"ALL" | "BANK" | "WALLET">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Form State
  const [kind, setKind] = useState<BankAccountKind>("BANK");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [iban, setIban] = useState("");
  const [currency, setCurrency] = useState("YER");
  const [accountId, setAccountId] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [notes, setNotes] = useState("");

  const filteredAccounts = accounts.filter((a) => {
    if (activeTab !== "ALL" && a.kind !== activeTab) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      a.name_ar.toLowerCase().includes(q) ||
      a.bank_name.toLowerCase().includes(q) ||
      (a.account_number && a.account_number.toLowerCase().includes(q))
    );
  });

  const handleOpenAdd = (defaultKind: BankAccountKind = "BANK") => {
    setKind(defaultKind);
    setNameAr("");
    setNameEn("");
    setBankName(defaultKind === "BANK" ? "بنك الكريمي للتمويل الأصغر" : "محفظة جيب");
    setAccountNumber("");
    setIban("");
    setCurrency("YER");
    // Pre-select account 1111 for bank or 1131 for wallet
    const targetCode = defaultKind === "BANK" ? "1111" : "1131";
    const foundAcc = chartAccounts.find((c) => c.code === targetCode) || chartAccounts[0];
    setAccountId(foundAcc ? foundAcc.id : "");
    setIsDefault(false);
    setNotes("");
    setAddModalOpen(true);
  };

  const handleCreate = async () => {
    if (!nameAr.trim()) {
      return toast.error(isAr ? "يرجى كتابة اسم الحساب بالعربية" : "Please enter the account name");
    }
    if (!bankName.trim()) {
      return toast.error(
        isAr
          ? "يرجى تحديد اسم البنك أو مزود المحفظة"
          : "Please enter the bank or wallet provider name",
      );
    }
    if (!accountId) {
      return toast.error(
        isAr
          ? "يرجى تحديد الحساب المحاسبي المرتبط"
          : "Please link a chart of accounts ledger account",
      );
    }

    try {
      await createAccount.mutateAsync({
        kind,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        bank_name: bankName.trim(),
        account_number: accountNumber.trim() || null,
        iban: iban.trim() || null,
        currency: currency.trim() || "YER",
        account_id: accountId,
        is_default: isDefault,
        notes: notes.trim() || null,
      });

      toast.success(
        kind === "BANK"
          ? isAr
            ? "تم إنشاء الحساب البنكي بنجاح"
            : "Bank account created"
          : isAr
            ? "تم إضافة المحفظة الإلكترونية بنجاح"
            : "Mobile wallet added",
      );
      setAddModalOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message || (isAr ? "تعذر إنشاء الحساب" : "Failed to create account"));
    }
  };

  const handleToggleDefault = async (
    accountItemId: string,
    currentDefault: boolean,
    itemKind: BankAccountKind,
  ) => {
    if (currentDefault) return;
    try {
      await updateAccount.mutateAsync({
        id: accountItemId,
        kind: itemKind,
        is_default: true,
      });
      toast.success(isAr ? "تم تعيين الحساب كافتراضي" : "Account set as default");
      refetch();
    } catch (err: any) {
      toast.error(err.message || (isAr ? "تعذر تعيين الافتراضي" : "Failed to set default"));
    }
  };

  const handleToggleActive = async (accountItemId: string, currentActive: boolean) => {
    try {
      await updateAccount.mutateAsync({
        id: accountItemId,
        is_active: !currentActive,
      });
      toast.success(isAr ? "تم تحديث حالة الحساب" : "Account status updated");
      refetch();
    } catch (err: any) {
      toast.error(err.message || (isAr ? "تعذر تغيير الحالة" : "Failed to update status"));
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-muted/30 p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("ALL")}
            className={cn(
              "px-3 py-1.5 rounded-lg font-medium transition",
              activeTab === "ALL"
                ? "bg-background text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {isAr ? `الكل (${accounts.length})` : `All (${accounts.length})`}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("BANK")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition",
              activeTab === "BANK"
                ? "bg-background text-indigo-900 dark:text-indigo-200 shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Landmark className="h-3.5 w-3.5 text-indigo-600" />
            <span>{isAr ? `بنوك (${banks.length})` : `Banks (${banks.length})`}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("WALLET")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition",
              activeTab === "WALLET"
                ? "bg-background text-sky-900 dark:text-sky-200 shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Smartphone className="h-3.5 w-3.5 text-sky-600" />
            <span>{isAr ? `محافظ (${wallets.length})` : `Wallets (${wallets.length})`}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-60">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? "بحث بالاسم أو الرقم..." : "Search accounts..."}
              className="h-9 w-full rounded-xl border border-input/80 bg-background ps-9 pe-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-[11px] font-medium text-primary">
            {isAr
              ? "الحسابات والمحافظ الافتراضية المرتبطة بالدليل المحاسبي"
              : "Default accounts and wallets linked to the chart of accounts"}
          </div>
        </div>
      </div>

      {/* Grid of Bank Accounts & Wallets */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="rounded-2xl border border-border/80 bg-card/60 p-8 text-center space-y-2">
          <Landmark className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-semibold">
            {isAr ? "لا توجد حسابات أو محافظ مطابقة" : "No accounts found"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "أضف حساباتك البنكية (الكريمي، اليمن الدولي...) أو محافظك (جيب، ون كاش، فلوسك...)"
              : "Add bank accounts and electronic wallets to enable accurate settlement."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredAccounts.map((acc) => {
            const isWallet = acc.kind === "WALLET";
            const isDef = acc.is_default;

            return (
              <div
                key={acc.id}
                className={cn(
                  "rounded-2xl border p-4 transition-all space-y-3 bg-card/80",
                  isDef
                    ? isWallet
                      ? "border-sky-500/40 shadow-xs ring-1 ring-sky-500/20"
                      : "border-indigo-500/40 shadow-xs ring-1 ring-indigo-500/20"
                    : "border-border/70 hover:border-primary/40",
                  !acc.is_active && "opacity-60 bg-muted/30",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div
                      className={cn(
                        "rounded-xl p-2 shrink-0 border",
                        isWallet
                          ? "bg-sky-500/10 border-sky-500/25 text-sky-600"
                          : "bg-indigo-500/10 border-indigo-500/25 text-indigo-600",
                      )}
                    >
                      {isWallet ? (
                        <Smartphone className="h-5 w-5" />
                      ) : (
                        <Landmark className="h-5 w-5" />
                      )}
                    </div>

                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-sm text-foreground truncate">
                          {acc.name_ar}
                        </span>
                        {isDef && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              isWallet
                                ? "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300"
                                : "border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
                            )}
                          >
                            {isAr ? "افتراضي" : "Default"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{acc.bank_name}</p>
                    </div>
                  </div>

                  <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                    {acc.currency}
                  </Badge>
                </div>

                {/* Account / Wallet Identification */}
                {acc.account_number && (
                  <div className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-muted/40 font-mono">
                    <span className="text-muted-foreground">
                      {isWallet
                        ? isAr
                          ? "رقم المحفظة:"
                          : "Wallet No:"
                        : isAr
                          ? "رقم الحساب:"
                          : "Account No:"}
                    </span>
                    <span className="font-bold">{acc.account_number}</span>
                  </div>
                )}

                {/* Linked Ledger Account Info */}
                <div className="rounded-xl border border-border/60 bg-muted/30 p-2 text-xs space-y-0.5">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{isAr ? "الحساب المحاسبي المرتبط:" : "Linked Ledger Account:"}</span>
                    <span className="font-mono font-semibold text-primary">
                      {acc.account?.code ?? "1111"}
                    </span>
                  </div>
                  <p className="truncate text-xs font-medium text-foreground">
                    {acc.account?.name_ar ?? "حساب البنوك والمحافظ"}
                  </p>
                </div>

                {/* Action Controls */}
                <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={acc.is_active}
                      onCheckedChange={() => handleToggleActive(acc.id, acc.is_active)}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {acc.is_active ? (isAr ? "مفعّل" : "Active") : isAr ? "متوقف" : "Inactive"}
                    </span>
                  </div>

                  {!isDef && acc.is_active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleDefault(acc.id, acc.is_default, acc.kind)}
                      className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-primary hover:bg-primary/10"
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

      {/* Add Bank Account / Wallet Modal */}
      <VortexDrawerDialog
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        size="md"
        icon={
          kind === "WALLET" ? <Smartphone className="size-5" /> : <Landmark className="size-5" />
        }
        title={
          kind === "WALLET"
            ? isAr
              ? "إضافة محفظة إلكترونية للمنشأة"
              : "Add Mobile Wallet"
            : isAr
              ? "إضافة حساب بنكي للمنشأة"
              : "Add Bank Account"
        }
        subtitle={
          isAr
            ? "ربط الحساب البنكي أو المحفظة مباشرة بحساب الأصول في الدليل المحاسبي"
            : "Link bank or wallet to the appropriate asset account in chart of accounts"
        }
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={handleCreate} disabled={createAccount.isPending} className="gap-1.5">
              {createAccount.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span>{isAr ? "حفظ الحساب" : "Save Account"}</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5 py-1 text-xs">
          {/* Kind Toggle */}
          <div>
            <label className="font-semibold block mb-1 text-foreground">
              {isAr ? "نوع الحساب" : "Account Nature"}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setKind("BANK");
                  if (nameAr.includes("محفظة")) setNameAr("");
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border p-2.5 font-medium transition",
                  kind === "BANK"
                    ? "border-indigo-600 bg-indigo-500/15 text-indigo-900 dark:text-indigo-200 font-bold shadow-2xs"
                    : "border-border/70 bg-card text-muted-foreground hover:bg-muted/40",
                )}
              >
                <Landmark className="h-4 w-4 text-indigo-600" />
                <span>{isAr ? "حساب بنكي جاري" : "Bank Account"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setKind("WALLET");
                  if (!nameAr) setNameAr("محفظة جيب");
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border p-2.5 font-medium transition",
                  kind === "WALLET"
                    ? "border-sky-500 bg-sky-500/15 text-sky-950 dark:text-sky-200 font-bold shadow-2xs"
                    : "border-border/70 bg-card text-muted-foreground hover:bg-muted/40",
                )}
              >
                <Smartphone className="h-4 w-4 text-sky-600" />
                <span>{isAr ? "محفظة إلكترونية" : "Electronic Wallet"}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1 text-foreground">
                {isAr ? "اسم الحساب في النظام *" : "Account Label *"}
              </label>
              <input
                type="text"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder={
                  kind === "WALLET"
                    ? isAr
                      ? "مثال: محفظة جيب الرئيسية"
                      : "e.g. Main Jaib Wallet"
                    : isAr
                      ? "مثال: بنك الكريمي — جاري"
                      : "e.g. Kuraimi Current Account"
                }
                className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1 text-foreground">
                {kind === "WALLET"
                  ? isAr
                    ? "الشركة المزودة للمحفظة *"
                    : "Wallet Provider *"
                  : isAr
                    ? "اسم البنك *"
                    : "Bank Name *"}
              </label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder={
                  kind === "WALLET"
                    ? isAr
                      ? "مثال: شركة الأهدل (جيب)"
                      : "e.g. Jaib"
                    : isAr
                      ? "مثال: بنك الكريمي"
                      : "e.g. Al-Kuraimi Bank"
                }
                className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="font-semibold block mb-1 text-foreground">
                {kind === "WALLET"
                  ? isAr
                    ? "رقم هاتف / حساب المحفظة"
                    : "Wallet Account/Phone"
                  : isAr
                    ? "رقم الحساب البنكي"
                    : "Account Number"}
              </label>
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder={kind === "WALLET" ? "777xxxxxx" : "300xxxxxxx"}
                className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1 text-foreground">
                {isAr ? "العملة *" : "Currency *"}
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-10 w-full rounded-xl border border-input/80 bg-background px-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              >
                <option value="YER">YER (ريال يمني)</option>
                <option value="SAR">SAR (ريال سعودي)</option>
                <option value="USD">USD (دولار أمريكي)</option>
              </select>
            </div>
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
              <option value="">{isAr ? "اختر الحساب المحاسبي..." : "Select account..."}</option>
              {chartAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.code} — {acc.name_ar}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} id="set-default-bank" />
            <label htmlFor="set-default-bank" className="cursor-pointer text-xs font-medium">
              {kind === "WALLET"
                ? isAr
                  ? "تعيين كمحفظة إلكترونية افتراضية"
                  : "Set as default wallet"
                : isAr
                  ? "تعيين كحساب بنكي افتراضي للتحويلات"
                  : "Set as default bank account"}
            </label>
          </div>
        </div>
      </VortexDrawerDialog>
    </div>
  );
}
