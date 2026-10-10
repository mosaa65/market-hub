"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  Receipt,
  Printer,
  Copy,
  Check,
  FileDown,
  MessageSquare,
  Wallet,
  Building2,
  User,
  CreditCard,
  Banknote,
  Split,
  Calendar,
  Clock,
  Layers,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Phone,
  PhoneCall,
  FileText,
  AlertCircle,
  CheckCircle2,
  Package,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Hash,
  Share2,
} from "lucide-react";
import { VortexDrawerDialog } from "../form/vortex-drawer-dialog";
import { VortexDateBadge } from "../display/vortex-date-badge";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { useCompanyCurrency } from "@/hooks/use-company-currency";
import { toSystemDigits, formatSystemNumber } from "@/lib/format-preferences";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface VortexInvoiceItem {
  id: string;
  name: string;
  name_ar?: string | null;
  sku?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  total: number | string;
  line_type?: string | null;
}

export interface VortexInvoiceParty {
  name: string;
  phone?: string | null;
  roleLabel?: string;
}

export interface VortexInvoiceDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type?: "sale" | "purchase";
  invoice: {
    id: string;
    invoice_number: string;
    created_at: string;
    status: string;
    subtotal: number | string;
    discount: number | string;
    tax: number | string;
    total: number | string;
    paid: number | string;
    payment_method: string;
    note?: string | null;
    warehouseName?: string | null;
  } | null;
  party: VortexInvoiceParty;
  items: VortexInvoiceItem[];
  loadingItems?: boolean;
  hasMultiWarehouse?: boolean;
  pmLabel?: (method: string, note?: string | null) => string;
  statusLabel?: (status: string) => string;
  statusBadge?: (status: string) => React.ReactNode;
  onPrint?: () => void;
  onWhatsApp?: () => void;
  onSms?: () => void;
  onPdf?: () => void;
  onQuickCollect?: () => void;
  copyInvoiceNumber?: (invoiceNumber: string, id: string) => void;
  copiedInvoiceId?: string | null;
}

export function VortexInvoiceDetailsSheet({
  open,
  onOpenChange,
  type = "sale",
  invoice,
  party,
  items,
  loadingItems = false,
  hasMultiWarehouse = false,
  pmLabel,
  statusLabel,
  statusBadge,
  onPrint,
  onWhatsApp,
  onSms,
  onPdf,
  onQuickCollect,
  copyInvoiceNumber,
  copiedInvoiceId,
}: VortexInvoiceDetailsSheetProps) {
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";
  const { currencySymbol } = useCompanyCurrency();

  const [localCopied, setLocalCopied] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  if (!invoice) return null;

  const isSale = type === "sale";
  const total = Number(invoice.total) || 0;
  const paid = Number(invoice.paid) || 0;
  const subtotal = Number(invoice.subtotal) || 0;
  const discount = Number(invoice.discount) || 0;
  const tax = Number(invoice.tax) || 0;
  const remaining = Math.max(0, total - paid);

  const totalQuantity = useMemo(() => {
    return items.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
  }, [items]);

  const handleCopyInvoiceNumber = () => {
    if (copyInvoiceNumber) {
      copyInvoiceNumber(invoice.invoice_number, invoice.id);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(invoice.invoice_number);
      setLocalCopied(true);
      setTimeout(() => setLocalCopied(false), 2000);
    }
  };

  const handleCopyPhone = () => {
    if (!party.phone) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(party.phone);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    }
  };

  const isCopied = copiedInvoiceId ? copiedInvoiceId === invoice.id : localCopied;

  // Default payment method icon & label
  const getPaymentMethodInfo = () => {
    const pm = (invoice.payment_method || "").toLowerCase();
    if (pm === "cash" || pm === "نقدي") {
      return {
        icon: <Banknote className="h-4 w-4 text-emerald-500 shrink-0" />,
        label: isRtl ? "نقدي (كاش)" : "Cash",
      };
    }
    if (pm === "card" || pm === "شبكة" || pm === "بطاقة") {
      return {
        icon: <CreditCard className="h-4 w-4 text-blue-500 shrink-0" />,
        label: isRtl ? "شبكة / بطاقة" : "Card / POS",
      };
    }
    if (pm === "bank" || pm === "تحويل" || pm === "حوالة") {
      return {
        icon: <Building2 className="h-4 w-4 text-purple-500 shrink-0" />,
        label: isRtl ? "تحويل بنكي" : "Bank Transfer",
      };
    }
    if (pm === "credit" || pm === "آجل") {
      return {
        icon: <Clock className="h-4 w-4 text-amber-500 shrink-0" />,
        label: isRtl ? "آجل (على الحساب)" : "Credit (Due)",
      };
    }
    if (pm === "split" || pm === "مقسم") {
      return {
        icon: <Split className="h-4 w-4 text-indigo-500 shrink-0" />,
        label: isRtl ? "دفع مقسم / متعدد" : "Split Payment",
      };
    }
    return {
      icon: <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />,
      label: pmLabel ? pmLabel(invoice.payment_method, invoice.note) : invoice.payment_method || "—",
    };
  };

  const pmInfo = getPaymentMethodInfo();

  // Status badge fallback if not passed
  const renderStatusBadge = () => {
    if (statusBadge) return statusBadge(invoice.status);

    const st = (invoice.status || "").toLowerCase();
    if (st === "paid" || st === "completed" || st === "مكتملة" || st === "مدفوعة") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 shadow-xs">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {statusLabel ? statusLabel(invoice.status) : isRtl ? "مدفوعة بالكامل" : "Paid"}
        </span>
      );
    }
    if (st === "partial" || st === "جزئي" || st === "مدفوعة جزئياً") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/25 shadow-xs">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {statusLabel ? statusLabel(invoice.status) : isRtl ? "مسددة جزئياً" : "Partially Paid"}
        </span>
      );
    }
    if (st === "cancelled" || st === "ملغاة") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs font-semibold text-muted-foreground border border-border shadow-xs">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          {statusLabel ? statusLabel(invoice.status) : isRtl ? "ملغاة" : "Cancelled"}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-600 dark:text-rose-400 border border-rose-500/25 shadow-xs">
        <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
        {statusLabel ? statusLabel(invoice.status) : isRtl ? "غير مسددة (آجلة)" : "Unpaid"}
      </span>
    );
  };

  const defaultRoleLabel = isSale
    ? isRtl
      ? "العميل"
      : "Customer"
    : isRtl
      ? "المورد"
      : "Supplier";

  const partyRole = party.roleLabel || defaultRoleLabel;
  const partyPhone = party.phone?.trim() || null;

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      className="max-w-4xl p-0 overflow-hidden border-border/80 shadow-2xl"
      hideClose
    >
      <div className="flex flex-col h-full" dir={isRtl ? "rtl" : "ltr"}>
        {/* Ambient Top Glow */}
        <div className="absolute -top-24 -right-24 size-72 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 size-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        {/* ─── Luxury Modal Header ─── */}
        <div className="shrink-0 flex items-center justify-between border-b border-border/70 bg-surface-2/50 backdrop-blur-md px-6 py-4.5 gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* Type Icon Container */}
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-sm transition-transform duration-200",
                isSale
                  ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent text-emerald-600 dark:text-emerald-400 shadow-emerald-500/10"
                  : "border-blue-500/30 bg-gradient-to-br from-blue-500/20 via-blue-500/10 to-transparent text-blue-600 dark:text-blue-400 shadow-blue-500/10",
              )}
            >
              <Receipt className="h-6 w-6 stroke-[2.2]" />
            </div>

            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                  {isSale
                    ? isRtl
                      ? "فاتورة مبيعات رقمية"
                      : "Sales Invoice"
                    : isRtl
                      ? "فاتورة مشتريات وتوريد"
                      : "Purchase Invoice"}
                </span>
                <span className="text-muted-foreground/40 text-xs">•</span>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-mono text-lg sm:text-xl font-black text-foreground tracking-tight">
                    {invoice.invoice_number}
                  </h3>
                  {/* Copy Button */}
                  <button
                    type="button"
                    onClick={handleCopyInvoiceNumber}
                    title={isRtl ? "نسخ رقم الفاتورة" : "Copy invoice number"}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium border transition-all duration-200 cursor-pointer",
                      isCopied
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs"
                        : "border-border/60 bg-surface/60 text-muted-foreground hover:bg-surface hover:text-foreground hover:border-primary/40",
                    )}
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-500 stroke-[3]" />
                        <span className="text-[10px] font-bold">{isRtl ? "تم النسخ" : "Copied"}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span className="text-[10px]">{isRtl ? "نسخ" : "Copy"}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <VortexDateBadge
                  date={invoice.created_at}
                  variant="formal"
                  showTime
                  className="text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div>{renderStatusBadge()}</div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl border border-border/70 bg-surface/80 p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground hover:border-border transition-colors cursor-pointer"
              aria-label={isRtl ? "إغلاق النافذة" : "Close"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ─── Scrollable Modal Body (Spacious & Clean) ─── */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-5 custom-scrollbar">
          {/* 1. Spacious Party & Logistics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {/* Party Card */}
            <div className="rounded-2xl border border-border/80 bg-surface-2/40 p-4 transition-all duration-200 hover:border-primary/30">
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {isSale ? (
                    <User className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Building2 className="h-3.5 w-3.5 text-primary" />
                  )}
                  {partyRole}
                </span>
                {partyPhone && (
                  <span className="text-[10px] rounded-md bg-primary/10 text-primary px-1.5 py-0.5 font-medium">
                    {isRtl ? "هاتف مسجل" : "Registered Phone"}
                  </span>
                )}
              </div>

              <p className="text-base font-bold text-foreground truncate">
                {party.name}
              </p>

              {partyPhone ? (
                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs">
                  <a
                    href={`tel:${partyPhone}`}
                    className="flex items-center gap-1.5 font-mono text-foreground/90 hover:text-primary transition-colors dir-ltr font-medium"
                    title={isRtl ? "اتصال بالطرف" : "Call"}
                  >
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{toSystemDigits(partyPhone)}</span>
                  </a>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleCopyPhone}
                      title={isRtl ? "نسخ رقم الهاتف" : "Copy phone"}
                      className="rounded p-1 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
                    >
                      {copiedPhone ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500 stroke-[3]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {onWhatsApp && (
                      <button
                        type="button"
                        onClick={onWhatsApp}
                        title={isRtl ? "محادثة واتساب سريعة" : "Quick WhatsApp"}
                        className="rounded p-1 text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                      >
                        <WhatsAppIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground/60 border-t border-border/40 pt-1.5">
                  {isRtl ? "لا يوجد رقم هاتف مسجل" : "No phone registered"}
                </p>
              )}
            </div>

            {/* Payment & Logistics Card */}
            <div className="rounded-2xl border border-border/80 bg-surface-2/40 p-4 transition-all duration-200 hover:border-primary/30">
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <CreditCard className="h-3.5 w-3.5 text-primary" />
                  {isRtl ? "طريقة وسداد الفاتورة" : "Payment & Settlement"}
                </span>
                <span className="text-[10px] rounded-md bg-surface px-1.5 py-0.5 text-muted-foreground border border-border/60">
                  {isRtl ? "طريقة الدفع" : "Method"}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <div className="p-1 rounded-lg bg-surface border border-border/60">
                  {pmInfo.icon}
                </div>
                <p className="text-sm font-bold text-foreground">
                  {pmInfo.label}
                </p>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                <span className="text-[11px] font-medium">{isRtl ? "حالة التسوية:" : "Settlement:"}</span>
                <span className="font-semibold text-foreground">
                  {statusLabel ? statusLabel(invoice.status) : invoice.status}
                </span>
              </div>
            </div>

            {/* Warehouse / Branch Card */}
            <div
              className={cn(
                "rounded-2xl border border-border/80 bg-surface-2/40 p-4 transition-all duration-200 hover:border-primary/30",
                !hasMultiWarehouse && !invoice.warehouseName && "md:col-span-2 lg:col-span-1",
              )}
            >
              <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  {isRtl ? "المستودع / نقطة التوريد" : "Warehouse / Branch"}
                </span>
              </div>

              <p className="text-sm font-bold text-foreground mt-1 truncate">
                {invoice.warehouseName || (isRtl ? "المستودع الرئيسي" : "Main Warehouse")}
              </p>

              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                <span className="text-[11px] font-medium">{isRtl ? "طبيعة الحركة:" : "Movement:"}</span>
                <span className="font-semibold text-foreground">
                  {isSale
                    ? isRtl
                      ? "صرف من المخزن"
                      : "Stock Issue"
                    : isRtl
                      ? "توريد إلى المخزن"
                      : "Stock Receipt"}
                </span>
              </div>
            </div>
          </div>

          {/* Note or Payment Split Callout (if present) */}
          {invoice.note && (
            <div className="rounded-2xl border border-border/80 bg-surface-2/60 p-4 text-xs">
              <div className="flex items-center gap-2 font-bold text-foreground mb-1">
                <FileText className="h-4 w-4 text-primary" />
                <span>{isRtl ? "الملاحظات وتفاصيل الدفع والشروط:" : "Notes & Terms:"}</span>
              </div>
              <p className="text-muted-foreground leading-relaxed ps-6 whitespace-pre-line">
                {invoice.note}
              </p>
            </div>
          )}

          {/* 2. Financial Highlight Hero Banner (The Crown Jewel) */}
          <div className="relative overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-surface-2/90 via-surface-2/50 to-surface-3/40 p-5 sm:p-6 shadow-sm">
            {/* Subtle background pattern glow */}
            <div className="absolute top-0 right-0 h-32 w-32 bg-primary/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/60">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {isRtl ? "صافي إجمالي الفاتورة" : "Grand Total Due"}
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-mono text-3xl sm:text-4xl font-black text-foreground tracking-tight">
                    {toSystemDigits(formatSystemNumber(total))}
                  </span>
                  <span className="text-sm font-bold text-primary">{currencySymbol}</span>
                </div>
              </div>

              {/* Status pill or quick badge */}
              <div className="flex items-center gap-2">
                {remaining <= 0 ? (
                  <div className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-5 w-5 shrink-0 stroke-[2.2]" />
                    <div>
                      <p className="text-xs font-bold">{isRtl ? "مسددة بالكامل" : "Fully Settled"}</p>
                      <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">
                        {isRtl ? "لا توجد ذمم معلقة" : "No outstanding balance"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-2xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2 text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-5 w-5 shrink-0 stroke-[2.2]" />
                    <div>
                      <p className="text-xs font-bold">
                        {isSale
                          ? isRtl
                            ? "متبقي في ذمة العميل"
                            : "Due from Customer"
                          : isRtl
                            ? "متبقي للمورد"
                            : "Due to Supplier"}
                      </p>
                      <p className="text-xs font-mono font-bold text-amber-700 dark:text-amber-300">
                        {toSystemDigits(formatSystemNumber(remaining))} {currencySymbol}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sub-breakdown 4-col metric strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 text-xs">
              <div className="space-y-0.5">
                <span className="text-[11px] text-muted-foreground font-medium">
                  {isRtl ? "المجموع الفرعي (قبل الضريبة):" : "Subtotal:"}
                </span>
                <p className="font-mono text-sm font-bold text-foreground">
                  {toSystemDigits(formatSystemNumber(subtotal))} {currencySymbol}
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="text-[11px] text-muted-foreground font-medium">
                  {isSale
                    ? isRtl
                      ? "الخصم الممنوح:"
                      : "Discount:"
                    : isRtl
                      ? "الخصم المكتسب:"
                      : "Discount:"}
                </span>
                <p
                  className={cn(
                    "font-mono text-sm font-bold",
                    discount > 0 ? "text-emerald-500" : "text-muted-foreground",
                  )}
                >
                  {discount > 0 ? `-${toSystemDigits(formatSystemNumber(discount))}` : "٠٫٠٠"}{" "}
                  {currencySymbol}
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="text-[11px] text-muted-foreground font-medium">
                  {isRtl ? "ضريبة القيمة المضافة:" : "VAT / Tax:"}
                </span>
                <p className="font-mono text-sm font-bold text-foreground">
                  {toSystemDigits(formatSystemNumber(tax))} {currencySymbol}
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="text-[11px] text-muted-foreground font-medium">
                  {isSale
                    ? isRtl
                      ? "المسدد نقداً / مدفوع:"
                      : "Amount Paid:"
                    : isRtl
                      ? "المسدد للمورد:"
                      : "Paid to Supplier:"}
                </span>
                <p className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {toSystemDigits(formatSystemNumber(paid))} {currencySymbol}
                </p>
              </div>
            </div>
          </div>

          {/* 3. Items & Products Table (Roomy & Never Cramped) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {isRtl ? "أصناف وبنود الفاتورة" : "Invoice Items"}
                </h4>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-full bg-surface-2 border border-border/80 px-2.5 py-0.5 font-mono text-[11px] font-bold text-muted-foreground">
                  {isRtl ? `${toSystemDigits(items.length)} أصناف` : `${items.length} items`}
                </span>
                <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 font-mono text-[11px] font-bold text-primary">
                  {isRtl ? `${toSystemDigits(totalQuantity)} قطعة` : `${totalQuantity} units`}
                </span>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface/40 shadow-xs">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="bg-surface-2/80 border-b border-border/80 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-start font-semibold w-10">#</th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {isRtl ? "الصنف / المنتج" : "Product / Item"}
                      </th>
                      <th className="px-4 py-3 text-center font-semibold w-24">
                        {isRtl ? "الكمية" : "Qty"}
                      </th>
                      <th className="px-4 py-3 text-end font-semibold w-32">
                        {isSale
                          ? isRtl
                            ? "سعر الوحدة"
                            : "Unit Price"
                          : isRtl
                            ? "تكلفة الوحدة"
                            : "Unit Cost"}
                      </th>
                      <th className="px-4 py-3 text-end font-semibold w-36">
                        {isRtl ? "الإجمالي" : "Total"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {loadingItems ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-muted-foreground">
                          <RefreshCw className="mx-auto h-5 w-5 animate-spin mb-2 text-primary" />
                          <p className="font-medium">
                            {isRtl ? "جاري جلب تفاصيل الأصناف والبنود..." : "Loading items..."}
                          </p>
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-muted-foreground">
                          <Package className="mx-auto h-8 w-8 mb-2 opacity-30" />
                          <p className="font-medium">
                            {isRtl
                              ? "لا توجد بنود مسجلة لهذه الفاتورة"
                              : "No items recorded on this invoice"}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      items.map((item, index) => {
                        const displayName = item.name_ar || item.name || "—";
                        const isService = item.line_type === "SERVICE";

                        return (
                          <tr
                            key={item.id || index}
                            className="hover:bg-surface-2/50 transition-colors"
                          >
                            <td className="px-4 py-3 font-mono text-muted-foreground">
                              {toSystemDigits(index + 1)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-bold text-foreground text-sm">
                                {displayName}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {item.sku && (
                                  <span className="font-mono text-[10px] text-muted-foreground bg-surface px-1.5 py-0.2 rounded border border-border/50">
                                    SKU: {item.sku}
                                  </span>
                                )}
                                {isService && (
                                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                    <Sparkles className="size-2.5" />
                                    {isRtl
                                      ? "بند خدمة — لا يخصم مخزوناً"
                                      : "Service line — no stock impact"}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-block rounded-lg bg-surface-2 border border-border/70 px-2.5 py-1 font-mono font-bold text-foreground text-xs shadow-2xs">
                                {toSystemDigits(item.quantity.toString())}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-end font-mono text-muted-foreground font-medium">
                              {toSystemDigits(formatSystemNumber(Number(item.unitPrice)))} {currencySymbol}
                            </td>
                            <td className="px-4 py-3 text-end font-mono font-black text-foreground text-sm">
                              {toSystemDigits(formatSystemNumber(Number(item.total)))} {currencySymbol}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Luxury Action Toolbar ("مكونات ملك أزرار فخمة") ─── */}
        <div className="shrink-0 border-t border-border/80 bg-surface-2/60 backdrop-blur-md px-5 sm:px-7 py-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Secondary / Communication Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* WhatsApp Button */}
              {onWhatsApp && (
                <button
                  type="button"
                  disabled={!partyPhone}
                  onClick={onWhatsApp}
                  title={
                    !partyPhone
                      ? isRtl
                        ? "هذا الطرف لا يملك رقم هاتف مسجل في النظام"
                        : "No registered phone number"
                      : isRtl
                        ? "مشاركة عبر واتساب"
                        : "WhatsApp"
                  }
                  className={cn(
                    "relative group overflow-hidden rounded-xl px-3.5 py-2.2 text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 select-none",
                    partyPhone
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shadow-xs hover:shadow-md hover:shadow-emerald-500/25 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                      : "border border-border/50 bg-muted/30 text-muted-foreground/40 cursor-not-allowed opacity-50",
                  )}
                >
                  <WhatsAppIcon className="h-4 w-4 shrink-0" />
                  <span>{isRtl ? "واتساب" : "WhatsApp"}</span>
                </button>
              )}

              {/* SMS Button */}
              {onSms && (
                <button
                  type="button"
                  disabled={!partyPhone}
                  onClick={onSms}
                  title={
                    !partyPhone
                      ? isRtl
                        ? "هذا الطرف لا يملك رقم هاتف مسجل في النظام"
                        : "No registered phone number"
                      : isRtl
                        ? "مشاركة عبر رسالة SMS"
                        : "SMS"
                  }
                  className={cn(
                    "relative group overflow-hidden rounded-xl px-3.5 py-2.2 text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 select-none",
                    partyPhone
                      ? "border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white hover:border-blue-600 shadow-xs hover:shadow-md hover:shadow-blue-500/25 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                      : "border border-border/50 bg-muted/30 text-muted-foreground/40 cursor-not-allowed opacity-50",
                  )}
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span>{isRtl ? "رسالة SMS" : "SMS"}</span>
                </button>
              )}

              {/* PDF Button */}
              {onPdf && (
                <button
                  type="button"
                  onClick={onPdf}
                  className="relative group overflow-hidden rounded-xl border border-border/80 bg-surface/90 hover:bg-surface-2 text-foreground px-3.5 py-2.2 text-xs font-semibold shadow-xs hover:border-primary/40 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer select-none"
                >
                  <FileDown className="h-4 w-4 text-primary shrink-0" />
                  <span>{isRtl ? "تحميل PDF" : "PDF"}</span>
                </button>
              )}
            </div>

            {/* Primary Command Actions */}
            <div className="flex items-center gap-2.5 justify-end">
              {/* Quick Collect Payment (Golden Royal Button) */}
              {onQuickCollect && remaining > 0 && invoice.status !== "cancelled" && (
                <button
                  type="button"
                  onClick={onQuickCollect}
                  className="relative group overflow-hidden rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 text-white px-4.5 py-2.2 text-xs font-bold shadow-md shadow-amber-500/25 hover:shadow-lg hover:shadow-amber-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer border border-amber-400/40 select-none"
                >
                  <Wallet className="h-4 w-4 shrink-0 stroke-[2.2]" />
                  <span>{isRtl ? "تحصيل الدفعة الآن" : "Collect Payment"}</span>
                </button>
              )}

              {/* Royal Print Button */}
              {onPrint && (
                <button
                  type="button"
                  onClick={onPrint}
                  className="relative group overflow-hidden rounded-xl bg-gradient-to-r from-primary via-primary/95 to-primary text-primary-foreground px-5 py-2.2 text-xs font-bold shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/35 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer border border-primary/30 select-none"
                >
                  <Printer className="h-4 w-4 shrink-0 stroke-[2.2]" />
                  <span>{isRtl ? "طباعة الفاتورة" : "Print Invoice"}</span>
                </button>
              )}

              {/* Close Button */}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-xl border border-border/80 bg-surface/90 hover:bg-surface-2 text-muted-foreground hover:text-foreground px-4 py-2.2 text-xs font-semibold transition-all duration-200 cursor-pointer select-none"
              >
                {t("common.close") || (isRtl ? "إغلاق" : "Close")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </VortexDrawerDialog>
  );
}
