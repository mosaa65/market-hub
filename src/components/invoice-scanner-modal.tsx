import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ScanBarcode,
  Search,
  Printer,
  Calendar,
  AlertCircle,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { Ltr } from "@/components/ltr-value";
import { printDocument, type UnifiedDocumentData } from "@/lib/templates";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectForReturn?: (invoice: any) => void;
}

export function parseInvoiceCode(rawCode: string): string {
  const code = rawCode.trim();
  if (!code) return "";

  // 1. Try JSON parsing
  if (code.startsWith("{") && code.endsWith("}")) {
    try {
      const obj = JSON.parse(code);
      if (obj.invoice_number) return String(obj.invoice_number).trim();
      if (obj.invoiceNumber) return String(obj.invoiceNumber).trim();
      if (obj.id) return String(obj.id).trim();
      if (obj.number) return String(obj.number).trim();
    } catch {
      /* ignore */
    }
  }

  // 2. Try URL parameter extraction
  if (code.includes("http://") || code.includes("https://") || code.includes("?")) {
    try {
      const url = new URL(code);
      const invParam = url.searchParams.get("invoice") || url.searchParams.get("id") || url.searchParams.get("inv");
      if (invParam) return invParam.trim();
      const segments = url.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) return last.trim();
    } catch {
      /* ignore */
    }
  }

  // 3. Prefix cleaning (e.g. INV:12345 or INVOICE#12345)
  const cleaned = code.replace(/^(INV:|INVOICE:|INV#|INVOICE#)/i, "").trim();
  return cleaned;
}

export function InvoiceScannerModal({ open, onClose, onSelectForReturn }: Props) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [invoice, setInvoice] = useState<any | null>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [docTypeFound, setDocTypeFound] = useState<"sales" | "purchase" | "milling">("sales");

  const resetState = () => {
    setInvoice(null);
    setReturns([]);
    setErrorMsg("");
    setManualCode("");
  };

  const handleClose = () => {
    resetState();
    setScannerOpen(false);
    onClose();
  };

  const fetchInvoiceDetails = useCallback(async (codeToSearch: string) => {
    const searchTerm = parseInvoiceCode(codeToSearch);
    if (!searchTerm) {
      setErrorMsg(isAr ? "الرجاء إدخال رقم الفاتورة أو مسح الكود" : "Please enter invoice number or scan code");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setInvoice(null);
    setReturns([]);

    try {
      // 1. Search Sales Invoices
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm);
      
      let salesQuery = supabase
        .from("sales_invoices")
        .select(
          `
          id, invoice_number, status, subtotal, discount, tax, total, paid, payment_method, note, created_at, customer_id, warehouse_id,
          customers(id, name, phone, tax_number),
          warehouses(name, name_ar),
          sales_invoice_items(id, product_id, quantity, unit_price, tax_rate, total, products(id, name, name_ar, sku))
        `,
        );

      if (isUuid) {
        salesQuery = salesQuery.or(`id.eq.${searchTerm},invoice_number.eq.${searchTerm}`);
      } else {
        salesQuery = salesQuery.or(`invoice_number.eq.${searchTerm},invoice_number.ilike.%${searchTerm}%`);
      }

      const { data: salesData, error: salesErr } = await salesQuery.limit(1).maybeSingle();

      if (salesErr) {
        console.error("Sales query error:", salesErr);
      }

      if (salesData) {
        setDocTypeFound("sales");
        setInvoice(salesData);

        // Fetch associated sales returns
        const { data: retData } = await supabase
          .from("sales_returns" as never)
          .select("id, return_number, total, status, created_at")
          .eq("sales_invoice_id" as never, salesData.id);

        if (retData) setReturns(retData);
        setLoading(false);
        return;
      }

      // 2. Search Purchase Invoices if not found in sales
      let purchQuery = supabase
        .from("purchase_invoices")
        .select(
          `
          id, invoice_number, status, subtotal, discount, tax, total, paid, payment_method, created_at, supplier_id, warehouse_id,
          suppliers(id, name, phone),
          warehouses(name, name_ar),
          purchase_invoice_items(id, product_id, quantity, unit_cost, tax_rate, total, products(id, name, name_ar, sku))
        `,
        );

      if (isUuid) {
        purchQuery = purchQuery.or(`id.eq.${searchTerm},invoice_number.eq.${searchTerm}`);
      } else {
        purchQuery = purchQuery.or(`invoice_number.eq.${searchTerm},invoice_number.ilike.%${searchTerm}%`);
      }

      const { data: purchData } = await purchQuery.limit(1).maybeSingle();

      if (purchData) {
        setDocTypeFound("purchase");
        setInvoice(purchData);
        setLoading(false);
        return;
      }

      // If neither sales nor purchase invoice was found:
      setErrorMsg(
        isAr
          ? `لم يتم العثور على فاتورة تطابق المعرف: (${searchTerm})`
          : `No invoice found matching: (${searchTerm})`,
      );
    } catch (err: any) {
      console.error("Failed to fetch invoice:", err);
      setErrorMsg(isAr ? "حدث خطأ أثناء الاستعلام عن الفاتورة" : "Error querying invoice");
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  const handleDetected = (code: string) => {
    setScannerOpen(false);
    setManualCode(code);
    void fetchInvoiceDetails(code);
  };

  const handlePrint = () => {
    if (!invoice) return;
    const isSales = docTypeFound === "sales";
    const party = isSales ? invoice.customers : invoice.suppliers;

    const doc: UnifiedDocumentData = {
      docType: isSales ? "customer_invoice" : "purchase_invoice",
      title: isSales ? (isAr ? "فاتورة مبيعات" : "Sales Invoice") : (isAr ? "فاتورة مشتريات" : "Purchase Invoice"),
      number: invoice.invoice_number,
      date: new Date(invoice.created_at).toLocaleDateString("ar-EG"),
      partyName: party?.name ?? (isAr ? "عميل عام" : "General Customer"),
      partyPhone: party?.phone,
      partyVat: party?.tax_number,
      warehouse: isAr ? invoice.warehouses?.name_ar || invoice.warehouses?.name : invoice.warehouses?.name,
      payment: invoice.payment_method,
      status: invoice.status,
      subtotal: Number(invoice.subtotal || 0),
      discount: Number(invoice.discount || 0),
      tax: Number(invoice.tax || 0),
      total: Number(invoice.total || 0),
      paid: Number(invoice.paid || 0),
      lines: (isSales ? invoice.sales_invoice_items : invoice.purchase_invoice_items || []).map((it: any) => ({
        product: isAr ? it.products?.name_ar || it.products?.name : it.products?.name || it.products?.name_ar,
        code: it.products?.sku,
        qty: Number(it.quantity || 0),
        price: Number(it.unit_price || it.unit_cost || 0),
        total: Number(it.total || 0),
      })),
    };

    printDocument(doc);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="max-w-2xl rounded-3xl border-primary/20 bg-card p-6 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
          <DialogHeader className="pb-3 border-b border-border/60 flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ScanBarcode className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">
                  {isAr ? "الاستعلام عن الفاتورة بالباركود / QR" : "Invoice QR & Barcode Lookup"}
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {isAr ? "صور الباركود بكاميرا الجهاز أو ادخل رقم الفاتورة" : "Scan invoice code or enter number manually"}
                </p>
              </div>
            </div>
          </DialogHeader>

          {/* Top Search Controls */}
          <div className="mt-4 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder={isAr ? "ادخل رقم الفاتورة أو امسح الكود..." : "Enter invoice number or scan..."}
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchInvoiceDetails(manualCode)}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 pe-10 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="button"
                onClick={() => fetchInvoiceDetails(manualCode)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
            <Button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="h-10 rounded-xl gap-2 bg-primary text-primary-foreground font-semibold px-4"
            >
              <ScanBarcode className="h-4 w-4" />
              {isAr ? "تشغيل الكاميرا" : "Open Camera"}
            </Button>
          </div>

          {/* Main Content View */}
          <div className="mt-4 flex-1 overflow-y-auto space-y-4 pr-1">
            {loading && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-xs">{isAr ? "جاري البحث عن الفاتورة..." : "Searching invoice..."}</span>
              </div>
            )}

            {errorMsg && !loading && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive flex flex-col items-center gap-2">
                <AlertCircle className="h-6 w-6" />
                <span>{errorMsg}</span>
              </div>
            )}

            {!invoice && !loading && !errorMsg && (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground border-2 border-dashed border-border/60 rounded-2xl p-6">
                <ScanBarcode className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-semibold">{isAr ? "لم يتم تحديد أي فاتورة بعد" : "No invoice selected yet"}</p>
                <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm">
                  {isAr
                    ? "انقر على زر 'تشغيل الكاميرا' لتصوير باركود الفاتورة المطبوع، أو اكتب رقم الفاتورة للوصول السريع."
                    : "Click 'Open Camera' to scan printed QR/barcode, or type the number manually."}
                </p>
              </div>
            )}

            {invoice && !loading && (
              <div className="space-y-4 rounded-2xl border border-border/80 bg-surface/40 p-4">
                {/* Invoice Header Badge Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-sm px-3 py-1 font-bold border-primary/40 text-primary">
                      #{invoice.invoice_number}
                    </Badge>
                    <Badge variant={invoice.status === "paid" ? "default" : "secondary"}>
                      {invoice.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1 me-2">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(invoice.created_at).toLocaleString(isAr ? "ar-EG" : "en-US")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {onSelectForReturn && (
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        onClick={() => {
                          onSelectForReturn(invoice);
                          handleClose();
                        }}
                        className="rounded-xl gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {isAr ? "إنشاء مرتجع لهذه الفاتورة" : "Return items"}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handlePrint}
                      className="rounded-xl gap-1.5 text-xs"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      {isAr ? "طباعة الفاتورة" : "Print Invoice"}
                    </Button>
                  </div>
                </div>

                {/* Details Summary Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="rounded-xl border border-border/50 bg-background p-2.5">
                    <span className="text-muted-foreground block text-[11px] mb-0.5">{isAr ? "العميل / المورد" : "Party"}</span>
                    <span className="font-bold text-foreground">
                      {(docTypeFound === "sales" ? invoice.customers?.name : invoice.suppliers?.name) || (isAr ? "عميل عام" : "General Customer")}
                    </span>
                    {(invoice.customers?.phone || invoice.suppliers?.phone) && (
                      <span className="block text-[10px] text-muted-foreground mt-0.5">
                        {invoice.customers?.phone || invoice.suppliers?.phone}
                      </span>
                    )}
                  </div>

                  <div className="rounded-xl border border-border/50 bg-background p-2.5">
                    <span className="text-muted-foreground block text-[11px] mb-0.5">{isAr ? "المستودع" : "Warehouse"}</span>
                    <span className="font-bold text-foreground">
                      {(isAr ? invoice.warehouses?.name_ar || invoice.warehouses?.name : invoice.warehouses?.name) || "-"}
                    </span>
                  </div>

                  <div className="rounded-xl border border-border/50 bg-background p-2.5">
                    <span className="text-muted-foreground block text-[11px] mb-0.5">{isAr ? "طريقة الدفع" : "Payment Method"}</span>
                    <span className="font-bold text-foreground capitalize">
                      {invoice.payment_method || "cash"}
                    </span>
                  </div>
                </div>

                {/* Items Table */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 font-semibold text-muted-foreground">
                      <tr>
                        <th className="p-2 text-start">#</th>
                        <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                        <th className="p-2 text-center">{isAr ? "الكمية" : "Qty"}</th>
                        <th className="p-2 text-end">{isAr ? "السعر" : "Price"}</th>
                        <th className="p-2 text-end">{isAr ? "الإجمالي" : "Total"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 bg-background">
                      {(
                        (docTypeFound === "sales"
                          ? invoice.sales_invoice_items
                          : invoice.purchase_invoice_items) || []
                      ).map((it: any, idx: number) => {
                        const pname = isAr
                          ? it.products?.name_ar || it.products?.name
                          : it.products?.name || it.products?.name_ar;
                        const price = Number(it.unit_price || it.unit_cost || 0);
                        const tot = Number(it.total || 0);

                        return (
                          <tr key={it.id || idx}>
                            <td className="p-2 font-mono text-muted-foreground">{idx + 1}</td>
                            <td className="p-2">
                              <div className="font-bold">{pname}</div>
                              {it.products?.sku && (
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  SKU: {it.products.sku}
                                </div>
                              )}
                            </td>
                            <td className="p-2 text-center font-mono">{it.quantity}</td>
                            <td className="p-2 text-end font-mono">{money(price)}</td>
                            <td className="p-2 text-end font-mono font-bold">{money(tot)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Totals Box */}
                <div className="rounded-xl border border-border/80 bg-background p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>{isAr ? "المجموع الفرعي" : "Subtotal"}</span>
                    <span className="font-mono"><Ltr>{money(Number(invoice.subtotal || 0))}</Ltr></span>
                  </div>

                  {Number(invoice.discount || 0) > 0 && (
                    <div className="flex justify-between text-rose-500">
                      <span>{isAr ? "الخصم" : "Discount"}</span>
                      <span className="font-mono"><Ltr>- {money(Number(invoice.discount))}</Ltr></span>
                    </div>
                  )}

                  {Number(invoice.tax || 0) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>{isAr ? "الضريبة" : "Tax"}</span>
                      <span className="font-mono"><Ltr>+ {money(Number(invoice.tax))}</Ltr></span>
                    </div>
                  )}

                  <div className="flex justify-between font-bold text-sm border-t border-border pt-2 text-foreground">
                    <span>{isAr ? "الإجمالي الكلي" : "Grand Total"}</span>
                    <span className="font-mono text-primary"><Ltr>{money(Number(invoice.total || 0))}</Ltr></span>
                  </div>

                  <div className="flex justify-between text-xs pt-1 border-t border-border/40">
                    <span className="text-muted-foreground">{isAr ? "المدفوع" : "Paid"}</span>
                    <span className="font-mono font-semibold text-emerald-600"><Ltr>{money(Number(invoice.paid || 0))}</Ltr></span>
                  </div>

                  {Number(invoice.total || 0) - Number(invoice.paid || 0) > 0 ? (
                    <div className="flex justify-between text-xs text-rose-600 font-bold">
                      <span>{isAr ? "المتبقي (دين على العميل)" : "Remaining Debt"}</span>
                      <span className="font-mono"><Ltr>{money(Number(invoice.total) - Number(invoice.paid))}</Ltr></span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{isAr ? "المتبقي" : "Remaining"}</span>
                      <span className="font-mono">0.00</span>
                    </div>
                  )}
                </div>

                {/* Returns section if any */}
                {returns.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-1.5">
                    <div className="font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <RotateCcw className="h-4 w-4" />
                      {isAr ? "المرتجعات المرتبطة بهذه الفاتورة" : "Associated Returns"}
                    </div>
                    {returns.map((ret: any) => (
                      <div key={ret.id} className="flex justify-between text-muted-foreground font-mono text-[11px]">
                        <span>#{ret.return_number}</span>
                        <span>{money(Number(ret.total))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Embedded Barcode Scanner Camera Popup */}
      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleDetected}
      />
    </>
  );
}
