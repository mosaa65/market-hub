/**
 * PosMethodDialog — the counter's payment-method picker that keeps the form open.
 *
 * Two steps, never one:
 *
 *   1. النوع      نقدًا · بنك · محفظة · شبكة · شيك · آجل
 *   2. الحساب     the cashboxes / bank accounts / wallets this business actually
 *                 has, read live from the treasury hooks. One click confirms and
 *                 closes. Types that need no second decision (شبكة، شيك، آجل)
 *                 close on the type click itself.
 *
 * That is the fix for "I picked محفظة and the form locked before I chose the
 * wallet": the type is not the decision, the account is.
 */

import { useMemo, useState } from "react";
import {
  Banknote,
  Check,
  CreditCard,
  FileCheck2,
  Landmark,
  Layers,
  Smartphone,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { PaymentMethodIcon } from "@/components/ui/payment-method/payment-method-icon";
import { paymentMethodIconAsset } from "@/lib/payments/payment-methods";
import { useCashboxes } from "@/hooks/use-cashboxes";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import {
  tenderKindOf,
  TENDER_KINDS,
  type PosTenderKind,
  type WalletAccountChoice,
} from "./pos-payment-fields";
import type { ResolvedPaymentMethod } from "@/hooks/use-payment-methods";
import type {
  Cashbox,
  CompanyBankAccount,
  PaymentSettlementSelection,
} from "@/lib/payments/treasury-types";

/** Known Yemeni wallets, offered when the business has not linked an account yet. */
const KNOWN_WALLETS = [
  { id: "jaib", labelAr: "محفظة جيب", labelEn: "Jaib", match: "جيب" },
  { id: "floosak", labelAr: "محفظة فلوسك", labelEn: "Floosak", match: "فلوسك" },
  { id: "one_cash", labelAr: "محفظة ون كاش", labelEn: "One Cash", match: "ون كاش" },
  { id: "jawali", labelAr: "محفظة جوالي", labelEn: "Jawali", match: "جوالي" },
] as const;

/** Which known wallet a company account represents, by its own name. */
export function walletIdOfAccount(account: CompanyBankAccount): string {
  const name = `${account.name_ar} ${account.name_en ?? ""} ${account.bank_name ?? ""}`;
  if (/جيب|jaib/i.test(name)) return "jaib";
  if (/فلوسك|floosak/i.test(name)) return "floosak";
  if (/ون كاش|one ?cash/i.test(name)) return "one_cash";
  return "jawali";
}

/** The catalogue id for a bank account: a named bank when one matches, else the generic value. */
export function bankMethodIdFor(
  account: CompanyBankAccount,
  methods: readonly ResolvedPaymentMethod[],
): string {
  const name = `${account.name_ar} ${account.bank_name ?? ""}`;
  const named = methods.find(
    (method) =>
      method.ledgerKind === "BANK" &&
      method.id !== "bank_transfer" &&
      (name.includes(method.nameAr) || (method.nameEn ? name.includes(method.nameEn) : false)),
  );
  if (named) return named.id;
  return /كريمي|kuraimi/i.test(name) ? "kuraimi_bank" : "bank_transfer";
}

/** A catalogue method that needs no receiving account, built for the fallback card. */
function pseudoMethod(
  id: string,
  nameAr: string,
  nameEn: string,
  legacyValue: string,
  ledgerKind: "CASH" | "BANK" | "WALLET" | "OTHER",
  requiresReference = false,
): ResolvedPaymentMethod {
  return {
    id,
    nameAr,
    nameEn,
    iconKey: id,
    isActive: true,
    sortOrder: 0,
    allowedContexts: [],
    ledgerKind,
    legacyValue,
    requiresReference,
    enabled: true,
    effectiveSortOrder: 0,
    effectiveContexts: [],
    isConfigured: false,
    isSystem: true,
    isAuthored: false,
  } as unknown as ResolvedPaymentMethod;
}

function ChoiceCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string | null;
  tone: "primary" | "emerald" | "indigo" | "sky";
}) {
  const activeTone = {
    primary: "border-primary/60 bg-primary/[0.07] ring-primary/25",
    emerald: "border-emerald-500/60 bg-emerald-500/[0.07] ring-emerald-500/25",
    indigo: "border-indigo-500/60 bg-indigo-500/[0.07] ring-indigo-500/25",
    sky: "border-sky-500/60 bg-sky-500/[0.07] ring-sky-500/25",
  }[tone];

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-start transition",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        active
          ? cn(activeTone, "ring-1")
          : "border-border/70 bg-card hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/60">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12px] font-bold text-foreground">{title}</span>
        {subtitle ? (
          <span className="truncate text-[10px] font-medium text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

export interface PosMethodDialogProps {
  methods: ResolvedPaymentMethod[];
  settlement: PaymentSettlementSelection;
  initialKind: PosTenderKind;
  onClose: () => void;
  onSettlementChange: (next: PaymentSettlementSelection) => void;
}

export function PosMethodDialog({
  methods,
  settlement,
  initialKind,
  onClose,
  onSettlementChange,
}: PosMethodDialogProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [kind, setKind] = useState<PosTenderKind>(initialKind);

  const { activeCashboxes, defaultCashbox } = useCashboxes();
  const { banks, wallets } = useCompanyBankAccounts();

  const availableKinds = useMemo(() => {
    const present = new Set<PosTenderKind>(methods.map((method) => tenderKindOf(method)));
    return TENDER_KINDS.filter((tender) => present.has(tender.id));
  }, [methods]);

  const orderedCashboxes = useMemo(
    () =>
      [...activeCashboxes].sort(
        (a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)),
      ),
    [activeCashboxes],
  );

  const plainMethods = useMemo(
    () => methods.filter((method) => tenderKindOf(method) === kind),
    [methods, kind],
  );

  const walletAccounts = useMemo<WalletAccountChoice[]>(
    () =>
      wallets.map((account) => ({
        account,
        walletId: walletIdOfAccount(account),
      })),
    [wallets],
  );

  const unlinkedWallets = useMemo(
    () =>
      KNOWN_WALLETS.filter(
        (wallet) =>
          !walletAccounts.some(
            (choice) =>
              choice.walletId === wallet.id ||
              (choice.account.name_ar ?? "").includes(wallet.match),
          ),
      ),
    [walletAccounts],
  );

  function commit(next: PaymentSettlementSelection) {
    onSettlementChange(next);
    onClose();
  }

  function chooseCashbox(box: Cashbox) {
    commit({
      ...settlement,
      method: "cash",
      paymentMethodId: "cash",
      cashboxId: box.id,
      cashboxName: box.name_ar,
      chartAccountId: box.account_id,
      bankAccountId: null,
      bankAccountName: null,
    });
  }

  function chooseBank(account: CompanyBankAccount) {
    commit({
      ...settlement,
      method: "bank_transfer",
      paymentMethodId: bankMethodIdFor(account, methods),
      bankAccountId: account.id,
      bankAccountName: account.name_ar,
      chartAccountId: account.account_id,
      cashboxId: null,
      cashboxName: null,
    });
  }

  function chooseWallet(account: CompanyBankAccount) {
    commit({
      ...settlement,
      method: "mobile_money",
      paymentMethodId: walletIdOfAccount(account),
      bankAccountId: account.id,
      bankAccountName: account.name_ar,
      chartAccountId: account.account_id,
      cashboxId: null,
      cashboxName: null,
    });
  }

  function chooseWalletWithoutAccount(walletId: string) {
    const known = KNOWN_WALLETS.find((wallet) => wallet.id === walletId)!;
    commit({
      ...settlement,
      method: "mobile_money",
      paymentMethodId: walletId,
      bankAccountName: isAr ? known.labelAr : known.labelEn,
      bankAccountId: null,
      cashboxId: null,
      cashboxName: null,
    });
  }

  function choosePlain(method: ResolvedPaymentMethod) {
    commit({
      ...settlement,
      method: method.legacyValue,
      paymentMethodId: method.id,
      cashboxId: null,
      cashboxName: null,
      bankAccountId: null,
      bankAccountName: null,
      chartAccountId: null,
    });
  }

  const stepTitle =
    kind === "CASH"
      ? isAr
        ? "اختر الصندوق المستلم"
        : "Choose the receiving till"
      : kind === "BANK"
        ? isAr
          ? "اختر الحساب البنكي"
          : "Choose the bank account"
        : kind === "WALLET"
          ? isAr
            ? "اختر المحفظة المستلمة"
            : "Choose the receiving wallet"
          : isAr
            ? "أكمل طريقة الدفع"
            : "Complete the method";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isAr ? "اختيار طريقة الدفع" : "Choose payment method"}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-2 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        dir={isAr ? "rtl" : "ltr"}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-2xl"
      >
        {/* Step 1 — tender type. Picking here never closes the dialog. */}
        <div className="border-b border-border/70 bg-gradient-to-b from-primary/[0.07] via-primary/[0.03] to-transparent px-3 pb-2.5 pt-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                <span className="grid size-5 place-items-center rounded-md bg-primary/15 text-primary">
                  <Wallet className="size-3" />
                </span>
                {isAr ? "طريقة الدفع" : "Payment method"}
              </h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {isAr
                  ? "١ النوع · ٢ الحساب المستلم — لا يُغلق النموذج قبل التأكيد"
                  : "1 type · 2 receiving account — the form stays open until you confirm"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 shrink-0 rounded-lg px-2 text-[11px] font-semibold text-muted-foreground"
            >
              {isAr ? "إغلاق" : "Close"}
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {TENDER_KINDS.filter(
              (tender) =>
                availableKinds.some((entry) => entry.id === tender.id) ||
                tender.id === kind ||
                tender.id === "CREDIT",
            ).map((tender) => {
              const Icon = tender.icon;
              const active = tender.id === kind;
              return (
                <button
                  key={tender.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setKind(tender.id);
                    if (tender.id === "CREDIT") {
                      const credit =
                        methods.find((method) => tenderKindOf(method) === "CREDIT") ??
                        pseudoMethod("credit", "آجل", "Credit", "credit", "OTHER");
                      choosePlain(credit);
                    }
                  }}
                  className={cn(
                    "flex min-h-10 items-center justify-center gap-1.5 rounded-xl border px-1 text-[11px] font-bold transition",
                    active
                      ? tender.activeClassName
                      : "border-border/60 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-3.5 shrink-0", !active && tender.iconClassName)} />
                  <span className="truncate">{isAr ? tender.labelAr : tender.labelEn}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2 — the system's own accounts for that type. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          <SectionLabel>{stepTitle}</SectionLabel>

          <div role="radiogroup" className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {kind === "CASH" && (
              <>
                {orderedCashboxes.length === 0 ? (
                  <ChoiceCard
                    active={settlement.method === "cash"}
                    onClick={() =>
                      choosePlain(pseudoMethod("cash", "نقدًا", "Cash", "cash", "CASH"))
                    }
                    icon={<Banknote className="size-4 text-emerald-600" />}
                    title={isAr ? "الصندوق الرئيسي" : "Main till"}
                    subtitle={isAr ? "لا يوجد صندوق مُعرّف" : "No till configured"}
                    tone="emerald"
                  />
                ) : (
                  orderedCashboxes.map((box) => (
                    <ChoiceCard
                      key={box.id}
                      active={settlement.cashboxId === box.id && settlement.method === "cash"}
                      onClick={() => chooseCashbox(box)}
                      icon={<Banknote className="size-4 text-emerald-600" />}
                      title={box.name_ar}
                      subtitle={[box.code, box.is_default ? (isAr ? "افتراضي" : "Default") : null]
                        .filter(Boolean)
                        .join(" · ")}
                      tone="emerald"
                    />
                  ))
                )}
                {orderedCashboxes.length > 0 && settlement.cashboxId !== (defaultCashbox?.id ?? "") && (
                  <p className="col-span-full px-0.5 text-[10px] text-muted-foreground">
                    {isAr
                      ? "يُقيَّد المبلغ في الصندوق المختار ويظهر في تقرير الصندوق."
                      : "The amount is posted to the selected till."}
                  </p>
                )}
              </>
            )}

            {kind === "BANK" && (
              <>
                {banks.length === 0 ? (
                  <ChoiceCard
                    active={settlement.method === "bank_transfer"}
                    onClick={() =>
                      choosePlain(
                        pseudoMethod(
                          "bank_transfer",
                          "تحويل بنكي",
                          "Bank transfer",
                          "bank_transfer",
                          "BANK",
                          true,
                        ),
                      )
                    }
                    icon={<Landmark className="size-4 text-indigo-600" />}
                    title={isAr ? "تحويل بنكي (عام)" : "Bank transfer (generic)"}
                    subtitle={isAr ? "لا يوجد حساب بنكي مُعرّف" : "No bank account configured"}
                    tone="indigo"
                  />
                ) : (
                  banks.map((account) => (
                    <ChoiceCard
                      key={account.id}
                      active={
                        settlement.bankAccountId === account.id &&
                        settlement.method === "bank_transfer"
                      }
                      onClick={() => chooseBank(account)}
                      icon={<Landmark className="size-4 text-indigo-600" />}
                      title={account.name_ar}
                      subtitle={
                        [account.bank_name, account.account_number].filter(Boolean).join(" · ") ||
                        null
                      }
                      tone="indigo"
                    />
                  ))
                )}
              </>
            )}

            {kind === "WALLET" && (
              <>
                {walletAccounts.map(({ account, walletId }) => {
                  const asset = paymentMethodIconAsset(walletId);
                  return (
                    <ChoiceCard
                      key={account.id}
                      active={settlement.bankAccountId === account.id}
                      onClick={() => chooseWallet(account)}
                      icon={
                        asset ? (
                          <img src={asset.src} alt={asset.alt} className="size-5 object-contain" />
                        ) : (
                          <Smartphone className="size-4 text-sky-600" />
                        )
                      }
                      title={account.name_ar}
                      subtitle={account.account_number || (isAr ? "حساب محفظة" : "Wallet account")}
                      tone="sky"
                    />
                  );
                })}
                {unlinkedWallets.map((wallet) => {
                  const asset = paymentMethodIconAsset(wallet.id);
                  return (
                    <ChoiceCard
                      key={wallet.id}
                      active={settlement.paymentMethodId === wallet.id && !settlement.bankAccountId}
                      onClick={() => chooseWalletWithoutAccount(wallet.id)}
                      icon={
                        asset ? (
                          <img src={asset.src} alt={asset.alt} className="size-5 object-contain" />
                        ) : (
                          <Smartphone className="size-4 text-sky-600" />
                        )
                      }
                      title={isAr ? wallet.labelAr : wallet.labelEn}
                      subtitle={isAr ? "غير مرتبط بحساب مالي" : "No linked account"}
                      tone="sky"
                    />
                  );
                })}
                {walletAccounts.length > 0 && (
                  <p className="col-span-full px-0.5 text-[10px] text-muted-foreground">
                    {isAr
                      ? "المحافظ المرتبطة بحسابات تظهر أولاً. اختر المحفظة التي وصل عليها المبلغ."
                      : "Wallets linked to accounts are listed first."}
                  </p>
                )}
              </>
            )}

            {(kind === "CARD" || kind === "CHEQUE" || kind === "CREDIT") &&
              (plainMethods.length > 0 ? (
                plainMethods.map((method) => (
                  <ChoiceCard
                    key={method.id}
                    active={settlement.paymentMethodId === method.id}
                    onClick={() => choosePlain(method)}
                    icon={
                      <PaymentMethodIcon
                        iconKey={method.iconKey}
                        methodId={method.id}
                        ledgerKind={method.ledgerKind}
                        className="size-4"
                      />
                    }
                    title={isAr ? method.nameAr : (method.nameEn ?? method.nameAr)}
                    subtitle={
                      method.isCreditTerm ? (isAr ? "لا يُحصَّل مبلغ الآن" : "Nothing collected") : null
                    }
                    tone="primary"
                  />
                ))
              ) : (
                <ChoiceCard
                  active={false}
                  onClick={() =>
                    choosePlain(
                      pseudoMethod(
                        kind.toLowerCase(),
                        kind === "CARD" ? "بطاقة / شبكة" : kind === "CHEQUE" ? "شيك" : "آجل",
                        kind === "CARD" ? "Card" : kind === "CHEQUE" ? "Cheque" : "Credit",
                        kind === "CARD" ? "card" : kind === "CHEQUE" ? "cheque" : "credit",
                        "OTHER",
                      ),
                    )
                  }
                  icon={
                    kind === "CARD" ? (
                      <CreditCard className="size-4 text-violet-600" />
                    ) : kind === "CHEQUE" ? (
                      <FileCheck2 className="size-4 text-amber-600" />
                    ) : (
                      <Layers className="size-4 text-slate-600" />
                    )
                  }
                  title={isAr ? "متابعة بهذه الطريقة" : "Continue with this method"}
                  tone="primary"
                />
              ))}
          </div>
        </div>

        <div className="border-t border-border/70 bg-muted/30 px-3 py-2 text-center text-[10px] text-muted-foreground">
          {isAr
            ? "اختيار النوع لا يُغلق النموذج — اختر الحساب المستلم لإتمام طريقة الدفع."
            : "Choosing a type never closes this dialog — pick the account to confirm."}
        </div>
      </div>
    </div>
  );
}
