/**
 * StatementEntryDetails — تفصيل القيد
 *
 * غرضه الوحيد: عند النقر على حركة داخل الكشف، نعرض ما تحمله من تفاصيل فعلية
 * (منتجات الفاتورة، الكميات، سعر الوحدة، الإجمالي، الملاحظة، طريقة الدفع...).
 *
 * مبدأ التصميم: لا اختراع بيانات.
 *   - كل ما يُعرض هنا موجود أصلًا في `entry.meta.items` (بنود الفاتورة).
 *   - الاحتياطيات (purchase_invoice_items) تعمل فقط للفواتير القادمة من
 *     قاعدة بيانات اشتُقّت بلا بنود — وإن لم يوجد شيء تظهر رسالة صريحة.
 */

import { useEffect, useState } from "react";
import { Loader2, PackageOpen } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { rawRest } from "@/lib/statements/untyped";
import { fmtAmount } from "@/lib/statements/format";
import { kindLabel } from "@/lib/statements/engine";
import type { StatementTransaction, StatementEntityType } from "@/lib/statements/types";

interface DetailItem {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  unitCost: number;
  total: number;
}

/** استخراج بنود الفاتورة من بيانات الحركة كما جهّزتها طبقة القراءة */
function itemsFromMeta(entry: StatementTransaction): DetailItem[] {
  const raw = entry.meta?.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      const row = item as Record<string, unknown>;
      const ar = (row.nameAr as string) || null;
      const en = (row.name as string) || null;
      return {
        id: String(row.id ?? `${entry.id}-${i}`),
        name: ar || en || "",
        sku: (row.sku as string) || null,
        quantity: Number(row.quantity ?? 0),
        unitCost: Number(row.unitCost ?? 0),
        total: Number(row.total ?? 0),
      };
    })
    .filter((item) => item.quantity > 0);
}

/** احتياطي: جلب بنود الفاتورة من قاعدة البيانات إن لم تكن مرفقة بالحركة */
async function fetchInvoiceItems(invoiceId: string): Promise<DetailItem[]> {
  const columns = "id,quantity,unit_cost,total,products(name,name_ar,sku)";
  const rows = await rawRest<Record<string, unknown>>("purchase_invoice_items", {
    columns,
    query: `select=${columns}&invoice_id=eq.${invoiceId}`,
  });
  return rows.map((row, i) => {
    const product = (row.products ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id ?? i),
      name: (product.name_ar as string) || (product.name as string) || "",
      sku: (product.sku as string) || null,
      quantity: Number(row.quantity ?? 0),
      unitCost: Number(row.unit_cost ?? 0),
      total: Number(row.total ?? 0),
    };
  });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}

export interface StatementEntryDetailsProps {
  entry: StatementTransaction | null;
  entityType: StatementEntityType;
  onClose: () => void;
}

export function StatementEntryDetails({ entry, entityType, onClose }: StatementEntryDetailsProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [fallbackItems, setFallbackItems] = useState<DetailItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const invoiceId =
    entry?.referenceType === "purchase_invoice" && entry.referenceId ? entry.referenceId : null;

  useEffect(() => {
    setFallbackItems([]);
    const metaItems = entry ? itemsFromMeta(entry) : [];
    if (!entry || !invoiceId || metaItems.length > 0) return;

    let cancelled = false;
    setLoadingItems(true);
    fetchInvoiceItems(invoiceId)
      .then((items) => {
        if (!cancelled) setFallbackItems(items.filter((item) => item.quantity > 0));
      })
      .catch(() => {
        if (!cancelled) setFallbackItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entry, invoiceId]);

  const metaItems = entry ? itemsFromMeta(entry) : [];
  const items = metaItems.length > 0 ? metaItems : fallbackItems;
  const note = (entry?.meta?.note as string) || null;
  const paymentMethod = (entry?.meta?.paymentMethod as string) || null;
  const status = (entry?.meta?.status as string) || null;

  return (
    <Sheet open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-md">
        {entry && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-base">
                <span>{ar ? "تفاصيل القيد" : "Entry details"}</span>
                {entry.reference && (
                  <span className="font-mono text-xs text-primary">{entry.reference}</span>
                )}
              </SheetTitle>
              <SheetDescription>
                {kindLabel(entry.kind, entityType, lang)} ·{" "}
                {new Date(entry.occurredAt).toLocaleString(ar ? "ar-YE" : "en-GB")}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-border/70 bg-surface/60 p-3">
                <Row
                  label={ar ? "نوع الحركة" : "Type"}
                  value={kindLabel(entry.kind, entityType, lang)}
                />
                <Row
                  label={ar ? "التاريخ" : "Date"}
                  value={new Date(entry.occurredAt).toLocaleString(ar ? "ar-YE" : "en-GB")}
                />
                {entry.reference && (
                  <Row
                    label={ar ? "المرجع" : "Reference"}
                    value={<span className="font-mono">{entry.reference}</span>}
                  />
                )}
                <Row
                  label={ar ? "مدين" : "Debit"}
                  value={<span className="font-mono text-rose-500">{fmtAmount(entry.debit)}</span>}
                />
                <Row
                  label={ar ? "دائن" : "Credit"}
                  value={
                    <span className="font-mono text-emerald-500">{fmtAmount(entry.credit)}</span>
                  }
                />
                <Row
                  label={ar ? "الرصيد بعد الحركة" : "Running balance"}
                  value={
                    <span className="font-mono font-bold">{fmtAmount(entry.runningBalance)}</span>
                  }
                />
                {paymentMethod && (
                  <Row label={ar ? "طريقة الدفع" : "Payment method"} value={paymentMethod} />
                )}
                {status && <Row label={ar ? "حالة المستند" : "Document status"} value={status} />}
                {(entry.description || note) && (
                  <Row
                    label={ar ? "البيان" : "Description"}
                    value={
                      <span className="text-muted-foreground">{note || entry.description}</span>
                    }
                  />
                )}
              </div>

              {/* تفاصيل الفاتورة: ماذا اشترى وكم الكمية — تُعرض فقط إن توفّرت */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold">
                    {ar ? "تفاصيل الفاتورة (الأصناف)" : "Invoice items"}
                  </h4>
                  {items.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {items.length} {ar ? "صنف" : "items"}
                    </span>
                  )}
                </div>

                {loadingItems ? (
                  <div className="grid place-items-center rounded-lg border border-border/70 py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-4 text-[11px] text-muted-foreground">
                    <PackageOpen className="h-4 w-4 shrink-0" />
                    <span>
                      {ar
                        ? "لا توجد أصناف مسجّلة لهذه الحركة (متوفّرة لفواتير التوريد فقط)."
                        : "No item lines recorded for this entry (available for purchase invoices only)."}
                    </span>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border/70">
                    <table className="w-full text-xs">
                      <thead className="bg-surface-2 text-[10px] text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 text-start font-medium">
                            {ar ? "الصنف" : "Product"}
                          </th>
                          <th className="px-2 py-1.5 text-end font-medium">
                            {ar ? "الكمية" : "Qty"}
                          </th>
                          <th className="px-2 py-1.5 text-end font-medium">
                            {ar ? "سعر الوحدة" : "Unit"}
                          </th>
                          <th className="px-2 py-1.5 text-end font-medium">
                            {ar ? "الإجمالي" : "Total"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-t border-border/50">
                            <td className="px-2 py-1.5">
                              <div className="truncate font-medium">
                                {item.name || (ar ? "صنف بلا اسم" : "Unnamed item")}
                              </div>
                              {item.sku && (
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {item.sku}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-end font-mono">{item.quantity}</td>
                            <td className="px-2 py-1.5 text-end font-mono">
                              {money(item.unitCost)}
                            </td>
                            <td className="px-2 py-1.5 text-end font-mono font-semibold">
                              {money(item.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default StatementEntryDetails;
