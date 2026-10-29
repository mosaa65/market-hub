"use client";

import * as React from "react";
import { AlertCircle, Check, ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  LEDGER_KIND_ACCOUNT_CODE,
  ledgerKindLabel,
  paymentMethodIcon,
  paymentMethodIconAsset,
  paymentUiText,
  type PaymentContext,
} from "@/lib/payments/payment-methods";
import type { ResolvedPaymentMethod } from "@/hooks/use-payment-methods";
import { useCashboxes } from "@/hooks/use-cashboxes";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";

/**
 * PaymentMethodSelect — المكوّن الموحّد الوحيد لاختيار طريقة الدفع في النظام.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * الشكل: سطر واحد. القائمة تُفتح عند الحاجة فقط.
 * ════════════════════════════════════════════
 * الإصدار السابق (`DynamicPaymentSelector`) كان يعرض شبكة أزرار لكل طريقة ثم
 * لوحة ثانية للصندوق/البنك/المرجع تحت كل زر — أربع طبقات مرئية دائمًا، تأكل
 * نصف الشاشة قبل أن يُكتب أي مبلغ. هنا:
 *
 *   • **الصف الظاهر دائمًا**: ارتفاع 40px، أيقونة + اسم الطريقة + الحساب
 *     المرتبط + سهم. لا شيء آخر.
 *   • **عند الفتح فقط**: قائمة بها بحث (تظهر إذا كانت الطرق أكثر من 5)، ثم
 *     طريقة واحدة لكل سطر مع حسابها.
 *   • **صف تسوية رفيع** يظهر أسفل الحقل *فقط* إذا كانت الطريقة تحتاج تفصيلًا
 *     (صندوق / بنك / محفظة / مرجع). الطريقة النقدية بصندوق واحد لا تُظهر شيئًا.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا مكوّن واحد لكل الشاشات
 * ════════════════════════════════════════════════════════════════════════════
 * كانت هناك أربعة أشكال لنفس القرار، فيختلف شكل طريقة الدفع بين فاتورة ونقطة
 * بيع ومرتجع. الآن الشاشات ترسل `context` فقط، وهذا المكوّن يقرأ الكتالوج
 * والصلاحيات والخزائن بنفسه. تعديل هنا يظهر في النظام كله.
 *
 * ════════════════════════════════════════════
 * الكيبورد
 * ════════════════════════════════════════════
 *   Enter / Space / ↓ / ↑   فتح القائمة
 *   ↑ / ↓                    التنقل بين الطرق
 *   Enter                    اختيار
 *   Esc                      إغلاق بلا تغيير
 *   كتابة أي حرف             يبدأ البحث داخل القائمة
 */

export interface PaymentMethodSelectProps {
  context: PaymentContext;
  /** معرّف الكتالوج المختار (أو القيمة المخزّنة القديمة). */
  value: string;
  onChange: (method: ResolvedPaymentMethod) => void;
  settlement?: PaymentSettlementSelection;
  onSettlementChange?: (next: PaymentSettlementSelection) => void;
  /** إظهار آجل بين الخيارات. */
  includeCredit?: boolean;
  disabled?: boolean;
  /** صف التسوية الثانوي (صندوق/بنك/مرجع). إخفاؤه يجعل المكوّن سطرًا واحدًا فقط. */
  showSettlement?: boolean;
  className?: string;
  /** تُعرض كتسمية أعلى الحقل (تُخفى بصريًا إن كان الحقل داخل ترويسة قسم). */
  label?: string;
  /** معرّفات إضافية تُبقى متاحة (طريقة محفوظة على مستند قديم). */
  ensureIds?: string[];
  methods: ResolvedPaymentMethod[];
  loading?: boolean;
  id?: string;
  /** يمرَّر إلى حقل المرجع/الشيك ليأخذه التنقل العام. */
  navProps?: Record<string, unknown>;
}

export function PaymentMethodSelect({
  context,
  value,
  onChange,
  settlement,
  onSettlementChange,
  includeCredit = true,
  disabled = false,
  showSettlement = true,
  className,
  label,
  ensureIds,
  methods,
  loading = false,
  id,
  navProps,
}: PaymentMethodSelectProps) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const t = (key: keyof typeof import("@/lib/payments/payment-methods").PAYMENT_UI_TEXT) =>
    paymentUiText(key, isAr ? "ar" : "en");

  const { activeCashboxes, defaultCashbox } = useCashboxes();
  const { banks, wallets, defaultBank, defaultWallet } = useCompanyBankAccounts();

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  /** طرق هذا القسم، مع ضمان بقاء أي طريقة محفوظة على المستند. */
  const options = React.useMemo(() => {
    const seen = new Set<string>();
    const list: ResolvedPaymentMethod[] = [];
    for (const method of methods) {
      if (method.isCreditTerm && !includeCredit) continue;
      if (seen.has(method.id)) continue;
      seen.add(method.id);
      list.push(method);
    }
    for (const extraId of ensureIds ?? []) {
      if (seen.has(extraId)) continue;
      const found = methods.find((m) => m.id === extraId);
      if (found) {
        list.push(found);
        seen.add(extraId);
      }
    }
    return list;
  }, [methods, includeCredit, ensureIds]);

  const selected =
    options.find((m) => m.id === value || m.legacyValue === value) ?? options[0] ?? null;

  /** الحساب المرتبط — مصدره الخزائن/البنوك الفعلية، لا نص مكتوب. */
  const accountFor = React.useCallback(
    (method: ResolvedPaymentMethod | null) => {
      if (!method) return null;
      if (method.ledgerKind === "CASH") {
        const box =
          activeCashboxes.find((c) => c.id === settlement?.cashboxId) ?? defaultCashbox ?? null;
        return box ? { id: box.id, name: box.name_ar, kind: "CASH" as const } : null;
      }
      if (method.ledgerKind === "BANK" || method.ledgerKind === "CARD") {
        const bank = banks.find((b) => b.id === settlement?.bankAccountId) ?? defaultBank ?? null;
        return bank ? { id: bank.id, name: bank.name_ar, kind: "BANK" as const } : null;
      }
      if (method.ledgerKind === "WALLET") {
        const wallet =
          wallets.find((w) => w.id === settlement?.bankAccountId) ?? defaultWallet ?? null;
        return wallet ? { id: wallet.id, name: wallet.name_ar, kind: "WALLET" as const } : null;
      }
      return null;
    },
    [activeCashboxes, defaultCashbox, banks, defaultBank, wallets, defaultWallet, settlement],
  );

  const selectedAccount = accountFor(selected);
  const needsReference = Boolean(selected?.requiresReference);
  const isCredit = Boolean(selected?.isCreditTerm) || selected?.ledgerKind === "CREDIT";

  /**
   * هل تفتقد هذه الطريقة حسابًا فعليًا في الدليل؟
   *
   * آجل لا يُحصِّل الآن، فهو مستثنى. أما كل طريقة تُدخل مالًا فيجب أن ينتهي
   * بها المطاف إلى صندوق أو حساب بنكي/محفظة — وإن لم يوجد، فإن الترحيل سيفشل
   * أو يسقط على حساب افتراضي غير مقصود. التحقق السابق كان يفحص *وجود كود
   * افتراضي للعائلة* بدل *وجود الحساب نفسه*، فمرّت حالات بلا حساب بصمت.
   */
  const accountMissing =
    !isCredit &&
    (selected?.ledgerKind === "CASH" ||
      selected?.ledgerKind === "BANK" ||
      selected?.ledgerKind === "CARD" ||
      selected?.ledgerKind === "WALLET") &&
    !selectedAccount;
  const needsDetail = !isCredit && (Boolean(selectedAccount) || needsReference);
  const showSearch = options.length > 5;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((m) => {
      const account = accountFor(m);
      return (
        m.nameAr.toLowerCase().includes(q) ||
        (m.nameEn ?? "").toLowerCase().includes(q) ||
        ledgerKindLabel(m.ledgerKind, isAr ? "ar" : "en")
          .toLowerCase()
          .includes(q) ||
        (account?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [options, query, accountFor, isAr]);

  /** اختيار طريقة: يضبط الحساب الافتراضي فورًا كما كانت الشاشات تفعل. */
  const choose = React.useCallback(
    (method: ResolvedPaymentMethod) => {
      onChange(method);
      if (onSettlementChange && settlement) {
        const cashbox =
          method.ledgerKind === "CASH"
            ? (activeCashboxes.find((c) => c.id === settlement.cashboxId) ?? defaultCashbox)
            : null;
        const bankOrWallet =
          method.ledgerKind === "WALLET"
            ? (wallets.find((w) => w.id === settlement.bankAccountId) ?? defaultWallet)
            : method.ledgerKind === "BANK" || method.ledgerKind === "CARD"
              ? (banks.find((b) => b.id === settlement.bankAccountId) ?? defaultBank)
              : null;
        onSettlementChange({
          ...settlement,
          method: method.legacyValue,
          paymentMethodId: method.id,
          cashboxId: cashbox?.id ?? null,
          cashboxName: cashbox?.name_ar ?? null,
          bankAccountId: bankOrWallet?.id ?? null,
          bankAccountName: bankOrWallet?.name_ar ?? null,
          chartAccountId: cashbox?.account_id ?? bankOrWallet?.account_id ?? null,
          reference: settlement.reference ?? "",
          cheque:
            method.legacyValue === "cheque"
              ? (settlement.cheque ?? {
                  chequeNumber: "",
                  bankName: "",
                  dueDate: new Date().toISOString().slice(0, 10),
                })
              : null,
        });
      }
      setOpen(false);
      setQuery("");
      setActiveIndex(0);
      rootRef.current?.querySelector<HTMLElement>("[data-pm-trigger]")?.focus();
    },
    [
      onChange,
      onSettlementChange,
      settlement,
      activeCashboxes,
      defaultCashbox,
      wallets,
      defaultWallet,
      banks,
      defaultBank,
    ],
  );

  // إغلاق عند النقر خارج المكوّن
  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // عند الفتح: تركيز البحث إن وُجد، وإلا فهرس الطريقة الحالية
  React.useEffect(() => {
    if (!open) return;
    const index = filtered.findIndex((m) => m.id === selected?.id);
    setActiveIndex(index >= 0 ? index : 0);
    if (showSearch) requestAnimationFrame(() => searchRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (activeIndex > filtered.length - 1) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIndex]);

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>("[data-pm-trigger]")?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[activeIndex] ?? filtered[0];
      if (target) choose(target);
    }
  }

  const SelectedIcon = selected ? paymentMethodIcon(selected.iconKey, selected.ledgerKind) : null;
  const selectedAsset = selected ? paymentMethodIconAsset(selected.id) : null;

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </label>
      )}

      {/* ── الحقل الظاهر: سطر واحد ── */}
      <button
        id={id}
        type="button"
        data-pm-trigger
        data-form-nav
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("methodLabel")}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-xl border bg-surface px-2.5 text-start transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          open
            ? "border-primary/60 ring-2 ring-primary/15"
            : "border-border/80 hover:border-border",
          (disabled || loading) && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted/60">
          {selectedAsset ? (
            <img src={selectedAsset.src} alt="" className="size-4 object-contain" />
          ) : SelectedIcon ? (
            <SelectedIcon className="size-4 text-primary" />
          ) : null}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-foreground">
            {loading
              ? isAr
                ? "جارٍ التحميل…"
                : "Loading…"
              : selected
                ? isAr
                  ? selected.nameAr
                  : (selected.nameEn ?? selected.nameAr)
                : t("methodLabel")}
          </span>
          {selected && (
            <span className="block truncate text-[10px] text-muted-foreground">
              {isCredit
                ? t("customerReceivable")
                : selectedAccount
                  ? selectedAccount.name
                  : t("notLinked")}
            </span>
          )}
        </span>

        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* ── القائمة ── */}
      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl">
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onListKeyDown}
                placeholder={t("search")}
                className="h-6 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
              />
            </div>
          )}

          <div
            role="listbox"
            aria-label={t("methodLabel")}
            onKeyDown={onListKeyDown}
            className="max-h-64 overflow-y-auto p-1 custom-scrollbar"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                {t("noResults")}
              </p>
            ) : (
              filtered.map((method, index) => {
                const Icon = paymentMethodIcon(method.iconKey, method.ledgerKind);
                const asset = paymentMethodIconAsset(method.id);
                const account = accountFor(method);
                const isSelected = method.id === selected?.id;
                const isActive = index === activeIndex;
                return (
                  <button
                    key={method.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(method)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors",
                      isActive ? "bg-primary/10" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted/60">
                      {asset ? (
                        <img src={asset.src} alt="" className="size-3.5 object-contain" />
                      ) : (
                        <Icon className="size-3.5 text-primary" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">
                        {isAr ? method.nameAr : (method.nameEn ?? method.nameAr)}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {method.isCreditTerm
                          ? ledgerKindLabel(method.ledgerKind, isAr ? "ar" : "en")
                          : account
                            ? account.name
                            : t("notLinked")}
                      </span>
                    </span>
                    {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── صف التسوية: يظهر فقط إن كانت الطريقة تحتاج تفصيلًا ── */}
      {showSettlement &&
        selected &&
        !isCredit &&
        needsDetail &&
        onSettlementChange &&
        settlement && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {selected.ledgerKind === "CASH" && activeCashboxes.length > 1 && (
              <select
                {...(navProps ?? {})}
                data-form-nav
                value={settlement.cashboxId ?? ""}
                onChange={(e) => {
                  const box = activeCashboxes.find((c) => c.id === e.target.value);
                  onSettlementChange({
                    ...settlement,
                    cashboxId: box?.id ?? null,
                    cashboxName: box?.name_ar ?? null,
                    chartAccountId: box?.account_id ?? null,
                  });
                }}
                aria-label={t("receivingCashbox")}
                className="h-7 min-w-0 flex-1 rounded-md border border-border/70 bg-surface px-1.5 text-[11px] text-foreground outline-none focus:border-primary/60"
              >
                {activeCashboxes.map((box) => (
                  <option key={box.id} value={box.id}>
                    {t("receivingCashbox")}: {box.name_ar}
                  </option>
                ))}
              </select>
            )}

            {(selected.ledgerKind === "BANK" || selected.ledgerKind === "CARD") &&
              banks.length > 1 && (
                <select
                  {...(navProps ?? {})}
                  data-form-nav
                  value={settlement.bankAccountId ?? ""}
                  onChange={(e) => {
                    const bank = banks.find((b) => b.id === e.target.value);
                    onSettlementChange({
                      ...settlement,
                      bankAccountId: bank?.id ?? null,
                      bankAccountName: bank?.name_ar ?? null,
                      chartAccountId: bank?.account_id ?? null,
                    });
                  }}
                  aria-label={t("depositBank")}
                  className="h-7 min-w-0 flex-1 rounded-md border border-border/70 bg-surface px-1.5 text-[11px] text-foreground outline-none focus:border-primary/60"
                >
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {t("depositBank")}: {bank.name_ar}
                    </option>
                  ))}
                </select>
              )}

            {selected.ledgerKind === "WALLET" && wallets.length > 1 && (
              <select
                {...(navProps ?? {})}
                data-form-nav
                value={settlement.bankAccountId ?? ""}
                onChange={(e) => {
                  const wallet = wallets.find((w) => w.id === e.target.value);
                  onSettlementChange({
                    ...settlement,
                    bankAccountId: wallet?.id ?? null,
                    bankAccountName: wallet?.name_ar ?? null,
                    chartAccountId: wallet?.account_id ?? null,
                  });
                }}
                aria-label={t("receivingWallet")}
                className="h-7 min-w-0 flex-1 rounded-md border border-border/70 bg-surface px-1.5 text-[11px] text-foreground outline-none focus:border-primary/60"
              >
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {t("receivingWallet")}: {wallet.name_ar}
                  </option>
                ))}
              </select>
            )}

            {needsReference && (
              <input
                {...(navProps ?? {})}
                data-form-nav
                value={settlement.reference ?? ""}
                onChange={(e) => onSettlementChange({ ...settlement, reference: e.target.value })}
                placeholder={t("referencePlaceholder")}
                aria-label={t("reference")}
                className="h-7 min-w-0 flex-1 rounded-md border border-border/70 bg-surface px-1.5 text-[11px] text-foreground outline-none focus:border-primary/60"
              />
            )}

            {/* تحذير الحساب المفقود — لا يظهر إلا إذا لم يوجد رابط فعلي */}
            {accountMissing && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
              >
                <AlertCircle className="size-3 shrink-0" />
                {t("notLinkedHelp")}
                {LEDGER_KIND_ACCOUNT_CODE[selected.ledgerKind] && (
                  <span className="font-mono font-normal opacity-80">
                    ({ledgerKindLabel(selected.ledgerKind, isAr ? "ar" : "en")})
                  </span>
                )}
              </span>
            )}
          </div>
        )}
    </div>
  );
}
