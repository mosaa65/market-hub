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
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Phone,
  FileText,
  AlertCircle,
  Package,
  Sparkles,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
  unit?: string | null;
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

  const totalQuantity = useMemo(() => {
    return items.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
  }, [items]);

  if (!invoice) return null;

  const isSale = type === "sale";
  const total = Number(invoice.total) || 0;
  const paid = Number(invoice.paid) || 0;
  const subtotal = Number(invoice.subtotal) || 0;
  const discount = Number(invoice.discount) || 0;
  const tax = Number(invoice.tax) || 0;
  const remaining = Math.max(0, total - paid);

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

  const getPaymentMethodInfo = () => {
    const pm = (invoice.payment_method || "").toLowerCase();
    if (pm === "cash" || pm === "نقدي") {
      return {
        icon: <Banknote className="size-4 text-emerald-500 shrink-0" />,
        label: isRtl ? "نقدي (كاش)" : "Cash",
      };
    }
    if (pm === "card" || pm === "شبكة" || pm === "بطاقة") {
      return {
        icon: <CreditCard className="size-4 text-blue-500 shrink-0" />,
        label: isRtl ? "شبكة / بطاقة" : "Card / POS",
      };
    }
    if (pm === "bank" || pm === "تحويل" || pm === "حوالة") {
      return {
        icon: <Building2 className="size-4 text-purple-500 shrink-0" />,
        label: isRtl ? "تحويل بنكي" : "Bank Transfer",
      };
    }
    if (pm === "credit" || pm === "آجل") {
      return {
        icon: <Clock className="size-4 text-amber-500 shrink-0" />,
        label: isRtl ? "آجل (على الحساب)" : "Credit (Due)",
      };
    }
    if (pm === "split" || pm === "مقسم") {
      return {
        icon: <Split className="size-4 text-indigo-500 shrink-0" />,
        label: isRtl ? "دفع مقسم / متعدد" : "Split Payment",
      };
    }
    return {
      icon: <CreditCard className="size-4 text-muted-foreground shrink-0" />,
      label: pmLabel
        ? pmLabel(invoice.payment_method, invoice.note)
        : invoice.payment_method || "—",
    };
  };

  const pmInfo = getPaymentMethodInfo();

  const renderStatusBadge = () => {
    if (statusBadge) return statusBadge(invoice.status);

    const st = (invoice.status || "").toLowerCase();
    if (st === "paid" || st === "completed" || st === "مكتملة" || st === "مدفوعة") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {statusLabel ? statusLabel(invoice.status) : isRtl ? "مدفوعة بالكامل" : "Paid"}
        </span>
      );
    }
    if (st === "partial" || st === "جزئي" || st === "مدفوعة جزئياً") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/25">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {statusLabel ? statusLabel(invoice.status) : isRtl ? "مسددة جزئياً" : "Partially Paid"}
        </span>
      );
    }
    if (st === "cancelled" || st === "ملغاة") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground border border-border">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          {statusLabel ? statusLabel(invoice.status) : isRtl ? "ملغاة" : "Cancelled"}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-bold text-rose-600 dark:text-rose-400 border border-rose-500/25">
        <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
        {statusLabel ? statusLabel(invoice.status) : isRtl ? "غير مسددة (آجلة)" : "Unpaid"}
      </span>
    );
  };

  const defaultRoleLabel = isSale ? (isRtl ? "العميل" : "Customer") : isRtl ? "المورد" : "Supplier";
  const partyRole = party.roleLabel || defaultRoleLabel;
  const partyPhone = party.phone?.trim() || null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col h-full bg-background/95 backdrop-blur-xl border-s border-border/80 shadow-2xl overflow-hidden"
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Ambient top glow matching Customer & Audit styles */}
        <div className="absolute -top-12 -right-12 size-48 rounded-full bg-primary/15 blur-3xl pointer-events-none" />

        {/* ─── Header: Matching Customer & Audit Details ─── */}
        <div className="shrink-0 p-5 sm:p-6 border-b border-border/60 bg-muted/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "grid size-12 shrink-0 place-items-center rounded-2xl border shadow-xs",
                  isSale
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
                )}
              >
                <Receipt className="size-6 stroke-[2.2]" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <SheetTitle className="text-lg sm:text-xl font-black text-foreground tracking-tight font-mono">
                    {invoice.invoice_number}
                  </SheetTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyInvoiceNumber}
                    className="h-7 px-2 gap-1 text-[11px] rounded-lg"
                    title={isRtl ? "نسخ رقم الفاتورة" : "Copy invoice number"}
                  >
                    {isCopied ? (
                      <>
                        <Check className="size-3 text-emerald-500 stroke-[3]" />
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          {isRtl ? "تم النسخ" : "Copied"}
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3 text-muted-foreground" />
                        <span>{isRtl ? "نسخ" : "Copy"}</span>
                      </>
                    )}
                  </Button>
                </div>

                <SheetDescription className="text-xs text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                  <span className="font-semibold text-foreground">
                    {isSale
                      ? isRtl
                        ? "فاتورة مبيعات"
                        : "Sales Invoice"
                      : isRtl
                        ? "فاتورة مشتريات"
                        : "Purchase Invoice"}
                  </span>
                  <span>•</span>
                  <VortexDateBadge date={invoice.created_at} variant="formal" showTime />
                </SheetDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">{renderStatusBadge()}</div>
          </div>
        </div>

        {/* ─── Scrollable Body ─── */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 custom-scrollbar">
          {/* 1. Financial Overview Cards (MiniStats style) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="rounded-2xl border border-border/70 bg-card p-3.5 space-y-0.5">
              <span className="text-[11px] font-bold text-muted-foreground block">
                {isRtl ? "صافي الإجمالي" : "Total Amount"}
              </span>
              <p className="font-mono text-lg sm:text-xl font-black text-foreground">
                {toSystemDigits(formatSystemNumber(total))} {currencySymbol}
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card p-3.5 space-y-0.5">
              <span className="text-[11px] font-bold text-muted-foreground block">
                {isRtl ? "المدفوع نقداً" : "Amount Paid"}
              </span>
              <p className="font-mono text-lg sm:text-xl font-black text-emerald-500">
                {toSystemDigits(formatSystemNumber(paid))} {currencySymbol}
              </p>
            </div>

            <div className="col-span-2 sm:col-span-1 rounded-2xl border border-border/70 bg-card p-3.5 space-y-0.5">
              <span className="text-[11px] font-bold text-muted-foreground block">
                {isRtl ? "المتبقي المستحق" : "Remaining Due"}
              </span>
              <p
                className={cn(
                  "font-mono text-lg sm:text-xl font-black",
                  remaining > 0 ? "text-amber-500" : "text-muted-foreground",
                )}
              >
                {toSystemDigits(formatSystemNumber(remaining))} {currencySymbol}
              </p>
            </div>
          </div>

          {/* Subtotal / Discount / Tax breakdown */}
          <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl bg-muted/30 border border-border/60 text-xs text-center">
            <div>
              <span className="text-[10px] text-muted-foreground block font-medium">
                {isRtl ? "المجموع الفرعي" : "Subtotal"}
              </span>
              <span className="font-mono font-bold text-foreground">
                {toSystemDigits(formatSystemNumber(subtotal))} {currencySymbol}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground block font-medium">
                {isRtl ? "الخصم" : "Discount"}
              </span>
              <span
                className={cn(
                  "font-mono font-bold",
                  discount > 0 ? "text-emerald-500" : "text-muted-foreground",
                )}
              >
                {discount > 0 ? `-${toSystemDigits(formatSystemNumber(discount))}` : "٠"}{" "}
                {currencySymbol}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground block font-medium">
                {isRtl ? "الضريبة" : "Tax"}
              </span>
              <span className="font-mono font-bold text-foreground">
                {toSystemDigits(formatSystemNumber(tax))} {currencySymbol}
              </span>
            </div>
          </div>

          {/* 2. Party & Logistics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Party Card */}
            <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  {isSale ? (
                    <User className="size-4 text-primary" />
                  ) : (
                    <Building2 className="size-4 text-primary" />
                  )}
                  {partyRole}
                </span>
                {partyPhone && (
                  <span className="text-[10px] rounded-md bg-primary/10 text-primary px-1.5 py-0.5 font-bold">
                    {isRtl ? "مسجل" : "Registered"}
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-foreground truncate">{party.name}</p>
              {partyPhone ? (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-xs">
                  <a
                    href={`tel:${partyPhone}`}
                    className="flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground font-medium dir-ltr"
                  >
                    <Phone className="size-3.5" />
                    <span>{toSystemDigits(partyPhone)}</span>
                  </a>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleCopyPhone}
                      title={isRtl ? "نسخ الهاتف" : "Copy phone"}
                      className="p-1 rounded text-muted-foreground hover:text-foreground"
                    >
                      {copiedPhone ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                    {onWhatsApp && (
                      <button
                        type="button"
                        onClick={onWhatsApp}
                        title={isRtl ? "محادثة واتساب" : "WhatsApp"}
                        className="p-1 rounded text-emerald-600 hover:bg-emerald-500/10"
                      >
                        <WhatsAppIcon className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/60 pt-1.5 border-t border-border/40">
                  {isRtl ? "لا يوجد رقم هاتف مسجل" : "No phone registered"}
                </p>
              )}
            </div>

            {/* Payment & Warehouse Card */}
            <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <CreditCard className="size-4 text-primary" />
                  {isRtl ? "الدفع والمستودع" : "Payment & Branch"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {pmInfo.icon}
                <span className="text-xs font-bold text-foreground">{pmInfo.label}</span>
              </div>
              <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                <span>{isRtl ? "المستودع:" : "Warehouse:"}</span>
                <span className="font-semibold text-foreground truncate max-w-[150px]">
                  {invoice.warehouseName || (isRtl ? "المستودع الرئيسي" : "Main Warehouse")}
                </span>
              </div>
            </div>
          </div>

          {/* Notes Card */}
          {invoice.note && (
            <div className="p-3.5 rounded-2xl bg-card border border-border/70 text-xs space-y-1">
              <span className="font-bold text-foreground flex items-center gap-1.5">
                <FileText className="size-3.5 text-primary" />
                {isRtl ? "ملاحظات الفاتورة:" : "Notes:"}
              </span>
              <p className="text-muted-foreground ps-5 whitespace-pre-line leading-relaxed">
                {invoice.note}
              </p>
            </div>
          )}

          {/* 3. Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Package className="size-4 text-primary" />
                {isRtl ? "أصناف الفاتورة" : "Invoice Items"}
              </span>
              <span className="text-[11px] font-mono font-bold text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md border border-border/50">
                {toSystemDigits(items.length)} {isRtl ? "أصناف" : "items"} •{" "}
                {toSystemDigits(totalQuantity)} {isRtl ? "قطعة" : "units"}
              </span>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b border-border/60 text-muted-foreground">
                    <tr>
                      <th className="px-3.5 py-2.5 text-start font-semibold w-8">#</th>
                      <th className="px-3.5 py-2.5 text-start font-semibold">
                        {isRtl ? "الصنف" : "Item"}
                      </th>
                      <th className="px-3.5 py-2.5 text-center font-semibold w-16">
                        {isRtl ? "الكمية" : "Qty"}
                      </th>
                      <th className="px-3.5 py-2.5 text-end font-semibold w-24">
                        {isRtl ? "السعر" : "Price"}
                      </th>
                      <th className="px-3.5 py-2.5 text-end font-semibold w-28">
                        {isRtl ? "الإجمالي" : "Total"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {loadingItems ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          <RefreshCw className="mx-auto size-4 animate-spin mb-1.5 text-primary" />
                          <span>{isRtl ? "جاري جلب بنود الفاتورة..." : "Loading items..."}</span>
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          <Package className="mx-auto size-6 mb-1 opacity-40" />
                          <span>{isRtl ? "لا توجد بنود مسجلة" : "No items recorded"}</span>
                        </td>
                      </tr>
                    ) : (
                      items.map((item, idx) => {
                        const displayName = item.name_ar || item.name || "—";
                        const isService = item.line_type === "SERVICE";
                        return (
                          <tr key={item.id || idx} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3.5 py-2.5 font-mono text-muted-foreground">
                              {toSystemDigits(idx + 1)}
                            </td>
                            <td className="px-3.5 py-2.5">
                              <span className="font-bold text-foreground block">{displayName}</span>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {item.sku && (
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    SKU: {item.sku}
                                  </span>
                                )}
                                {isService && (
                                  <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-1 rounded">
                                    {isRtl ? "خدمة" : "Service"}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3.5 py-2.5 text-center font-mono font-bold text-foreground">
                              {toSystemDigits(item.quantity.toString())}
                              {item.unit && <span className="ms-1 text-xs font-normal text-muted-foreground">{item.unit}</span>}
                            </td>
                            <td className="px-3.5 py-2.5 text-end font-mono text-muted-foreground">
                              {toSystemDigits(formatSystemNumber(Number(item.unitPrice)))}
                            </td>
                            <td className="px-3.5 py-2.5 text-end font-mono font-bold text-foreground">
                              {toSystemDigits(formatSystemNumber(Number(item.total)))}
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

        {/* ─── Adaptive Action Footer: Consistent & Responsive ─── */}
        <div className="shrink-0 p-4 border-t border-border/60 bg-muted/20">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            {/* Communication & Document Export */}
            <div className="grid grid-cols-3 sm:flex items-center gap-2">
              {onWhatsApp && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!partyPhone}
                  onClick={onWhatsApp}
                  className="rounded-xl h-9 gap-1.5 text-xs border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                >
                  <WhatsAppIcon className="size-3.5 shrink-0" />
                  <span>{isRtl ? "واتساب" : "WhatsApp"}</span>
                </Button>
              )}

              {onSms && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!partyPhone}
                  onClick={onSms}
                  className="rounded-xl h-9 gap-1.5 text-xs border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
                >
                  <MessageSquare className="size-3.5 shrink-0" />
                  <span>{isRtl ? "رسالة" : "SMS"}</span>
                </Button>
              )}

              {onPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPdf}
                  className="rounded-xl h-9 gap-1.5 text-xs"
                >
                  <FileDown className="size-3.5 text-primary shrink-0" />
                  <span>PDF</span>
                </Button>
              )}
            </div>

            {/* Primary Actions: Print, Collect, Close */}
            <div className="flex items-center gap-2 justify-end">
              {onQuickCollect && remaining > 0 && invoice.status !== "cancelled" && (
                <Button
                  size="sm"
                  onClick={onQuickCollect}
                  className="rounded-xl h-9 gap-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white flex-1 sm:flex-initial"
                >
                  <Wallet className="size-3.5 shrink-0" />
                  <span>{isRtl ? "تحصيل دفعة" : "Collect"}</span>
                </Button>
              )}

              {onPrint && (
                <Button
                  size="sm"
                  onClick={onPrint}
                  className="rounded-xl h-9 gap-1.5 text-xs font-bold flex-1 sm:flex-initial"
                >
                  <Printer className="size-3.5 shrink-0" />
                  <span>{isRtl ? "طباعة" : "Print"}</span>
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="rounded-xl h-9 text-xs"
              >
                {t("common.close") || (isRtl ? "إغلاق" : "Close")}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
