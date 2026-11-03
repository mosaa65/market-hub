"use client";

import * as React from "react";
import { AlertCircle, Check, ChevronDown, Hash, Layers, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  LEDGER_KIND_ACCOUNT_CODE,
  ledgerKindLabel,
  paymentMethodIcon,
  paymentMethodIconAsset,
  paymentReferenceLabel,
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
  /**
   * يُضيف «توزيع الدفع على أكثر من طريقة» كخيار داخل القائمة نفسها.
   *
   * كان زرًّا منفصلًا تحت الحقل في كل شاشة، فيأخذ سطرًا كاملًا لِفعل تحدث
   * مرات قليلة. الخيار في القائمة يزيله من المساحة المرئية بالكلية ويضعه
   * مع بقية خيارات الدفع، حيث يبحث عنه المشغّل أصلًا.
   */
  onChooseSplit?: () => void;
  /** هذه الشاشة في وضع التوزيع بالفعل — يُبرز الخيار ويُظهر «رجوع». */
  isSplitMode?: boolean;
  /** ملخص التوزيع (عدد الطرق) يُعرض في الحقل حين يكون الوضع split. */
  splitSummary?: string;
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
  onChooseSplit,
  isSplitMode = false,
  splitSummary,
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
  /**
   * اتجاه فتح القائمة.
   *
   * كان `top-[calc(100%+4px)]` ثابتًا، فتُفتح دائمًا للأسفل. وفي شريط الدفع
   * السفلي (نقطة البيع والاستلام) لا مساحة تحت الحقل: القائمة تُدفن خلف زر
   * الفوتر وأزرار الطباعة، فلا تُرى الطرق ولا تُختار.
   *
   * الحساب يتم عند الفتح، لا عند الرسم: المساحة تتغيّر مع لوحة المفاتيح
   * وتمرير الشاشة. إن كان أسفل الحقل أقل من مساحة تكفي القائمة، تُفتح للأعلى.
   */
  const [placement, setPlacement] = React.useState<"bottom" | "top">("bottom");
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  /** أقل مساحة مقبولة للفتح للأسفل — مقاس القائمة نفسه تقريبًا. */
  const MIN_SPACE = 240;

  const measurePlacement = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    // الفتح للأعلى يتجاوَز أيضًا الفوتر الثابت في هذه الشاشات.
    const above = rect.top;
    setPlacement(below < MIN_SPACE && above > below ? "top" : "bottom");
  }, []);

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

  /**
   * الحساب المرتبط — مصدره الخزائن/البنوك الفعلية، لا نص مكتوب.
   *
   * ترتيب الأسبقية:
   *   1. ما اختاره المشغّل على هذه الفاتورة (`settlement`).
   *   2. الحساب الافتراضي الذي ربطته المنشأة بالطريقة في الإعدادات
   *      (`payment_method_settings.default_account_id`) — يُحلّ إلى صندوق أو
   *      بنك أو محفظة بالحساب نفسه، فقد يكون الحساب الفرعي موجودًا دون صف
   *      صندوق/بنك مقابل له في القوائم.
   *   3. الصندوق/البنك/المحفظة الافتراضية.
   *
   * الخطوة الثانية غائبة كانت، فاختيار «بنك التضامن» في الإعدادات لا يظهر في
   * الكاشير إلا إن اختاره المشغّل يدويًا في كل فاتورة.
   *
   * وإذا لم يوجد صف صندوق أو بنك أو محفظة أصلًا، يُعرض الحساب الافتراضي نفسه:
   * الترحيل يعمل معه (محرك الترحيل يقرأ `default_account_id` مباشرةً)، فلا معنى
   * لإعلان «بلا حساب في الدليل» وتخويف المشغّل والقيود تُرحَّل سليمة.
   */
  const accountFor = React.useCallback(
    (method: ResolvedPaymentMethod | null) => {
      if (!method) return null;
      const configured = method.defaultAccount;

      if (method.ledgerKind === "CASH") {
        const box =
          activeCashboxes.find((c) => c.id === settlement?.cashboxId) ??
          (configured ? activeCashboxes.find((c) => c.account_id === configured.id) : undefined) ??
          defaultCashbox ??
          null;
        if (box) return { id: box.id, name: box.name_ar, kind: "CASH" as const };
        return configured
          ? { id: configured.id, name: configured.nameAr, kind: "CASH" as const }
          : null;
      }
      if (method.ledgerKind === "BANK" || method.ledgerKind === "CARD") {
        const bank =
          banks.find((b) => b.id === settlement?.bankAccountId) ??
          (configured ? banks.find((b) => b.account_id === configured.id) : undefined) ??
          defaultBank ??
          null;
        if (bank) return { id: bank.id, name: bank.name_ar, kind: "BANK" as const };
        return configured
          ? { id: configured.id, name: configured.nameAr, kind: "BANK" as const }
          : null;
      }
      if (method.ledgerKind === "WALLET") {
        const wallet =
          wallets.find((w) => w.id === settlement?.bankAccountId) ??
          (configured ? wallets.find((w) => w.account_id === configured.id) : undefined) ??
          defaultWallet ??
          null;
        if (wallet) return { id: wallet.id, name: wallet.name_ar, kind: "WALLET" as const };
        return configured
          ? { id: configured.id, name: configured.nameAr, kind: "WALLET" as const }
          : null;
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
  // التحذير جزء من التفصيل: كان يظهر تحت حقل لا يُعرض، فلا يراه أحد ويُكتشف
  // النقص عند أول تحصيل يفشل.
  const needsDetail = !isCredit && (Boolean(selectedAccount) || needsReference || accountMissing);
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
    measurePlacement();
    if (showSearch) requestAnimationFrame(() => searchRef.current?.focus());
    // إعادة القياس عند تغيّر المساحة أثناء الفتح (لوحة المفاتيح، تمرير…).
    const onResize = () => measurePlacement();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
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
        ref={triggerRef}
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
              {isSplitMode
                ? (splitSummary ?? t("methodLabel"))
                : isCredit
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
        <div
          className={cn(
            "absolute inset-x-0 z-50 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl",
            placement === "bottom"
              ? "top-[calc(100%+4px)] animate-in fade-in-0 slide-in-from-top-1"
              : "bottom-[calc(100%+4px)] animate-in fade-in-0 slide-in-from-bottom-1",
          )}
        >
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
            className="max-h-[min(16rem,45vh)] overflow-y-auto p-1 custom-scrollbar"
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

            {/*
              خيار التوزيع: آخر عنصر في القائمة، مفصول بخط رقيق.

              ليس طريقة دفع، بل وضع: الفاتورة تُسدد بأكثر من طريقة، فيفتح
              محرر التوزيع. وجوده هنا يلغي الحاجة لزر دائم تحت الحقل.
            */}
            {onChooseSplit ? (
              <>
                <div className="my-1 border-t border-border/50" />
                <button
                  type="button"
                  role="option"
                  aria-selected={isSplitMode}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    onChooseSplit();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors",
                    isSplitMode ? "bg-primary/10" : "hover:bg-muted/50",
                  )}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    <Layers className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">
                      {isAr ? "توزيع الدفع" : "Split payment"}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {isSplitMode
                        ? isAr
                          ? "مُوزّع حاليًا — ارجع لتغيير الطريقة"
                          : "Currently split — reopen to change"
                        : isAr
                          ? "السداد بأكثر من طريقة واحدة"
                          : "Pay with more than one method"}
                    </span>
                  </span>
                  {isSplitMode ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
                </button>
              </>
            ) : null}
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

            {/*
              حقل المرجع.

              كان `input` عاريًا بعنوان مؤقت يُـختفي عند الكتابة، فلا يعرف
              المشغّل بعد إدخال الرقم ما الذي كتبه. الآن:
                • عنوان صغير ثابت فوق الحقل يختلف بحسب الطريقة
                  (رقم الحوالة / رقم عملية المحفظة / رقم الشيك).
                • أيقونة المرجع في البداية.
                • «مطلوب» ظاهرة بدل عنوان عام.
                • `inputMode="numeric"` على الجوال حين يكون الرقم رقميًا.
            */}
            {needsReference && (
              <label className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1 ps-0.5 text-[9px] font-bold text-muted-foreground">
                  <Hash className="size-2.5" />
                  {paymentReferenceLabel(selected, isAr ? "ar" : "en")}
                  <span className="font-normal text-destructive/80">
                    {isAr ? "مطلوب" : "required"}
                  </span>
                </span>
                <input
                  {...(navProps ?? {})}
                  data-form-nav
                  value={settlement.reference ?? ""}
                  onChange={(e) => onSettlementChange({ ...settlement, reference: e.target.value })}
                  placeholder={t("referencePlaceholder")}
                  aria-label={paymentReferenceLabel(selected, isAr ? "ar" : "en")}
                  aria-required
                  autoComplete="off"
                  dir="ltr"
                  className="h-7 min-w-0 rounded-md border border-border/70 bg-surface px-1.5 text-start font-mono text-[11px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary/60"
                />
              </label>
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
