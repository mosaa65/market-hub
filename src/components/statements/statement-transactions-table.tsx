/**
 * StatementTransactionsTable — جدول حركات الكشف
 *
 * ⚠️ عرض فقط. الأعمدة وترتيبها وتسمياتها تأتي جاهزة من StatementLayout
 * (أي من resolveStatementLayout + إعدادات المستخدم). لا منطق حسابي هنا.
 *
 * الأداء: عند عدد كبير من الحركات نعرض أول N صف مع «تحميل المزيد»،
 * بينما تبقى المجاميع والأرصدة محسوبة على كل الحركات (كما هو مقرر في Phase 12).
 */

import { useMemo, useState } from "react";
import { ChevronDown, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtAmount, fmtOrDash } from "@/lib/statements/format";
import { kindLabel } from "@/lib/statements/engine";
import type {
  StatementLayout,
  StatementResult,
  StatementTransaction,
} from "@/lib/statements/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface StatementTransactionsTableProps {
  result: StatementResult;
  layout: StatementLayout;
  loading?: boolean;
  /** عدد الصفوف المعروضة في الدفعة الأولى */
  pageSize?: number;
  className?: string;
}

export function StatementTransactionsTable({
  result,
  layout,
  loading = false,
  pageSize = 200,
  className,
}: StatementTransactionsTableProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [visible, setVisible] = useState(pageSize);

  const rows = useMemo(() => result.transactions.slice(0, visible), [result.transactions, visible]);
  const hasMore = result.transactions.length > visible;

  const columns = layout.columns;

  const alignClass = (align: "start" | "center" | "end") =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";

  return (
    <div className={cn("panel-elevated overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap text-xs font-semibold",
                    alignClass(col.align),
                    col.key === "debit" && "text-rose-500",
                    col.key === "credit" && "text-emerald-500",
                  )}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : result.transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-14 text-center">
                  <Inbox className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                  <div className="text-sm text-muted-foreground">
                    {ar
                      ? "لا توجد حركات مسجَّلة خلال الفترة المحددة"
                      : "No movements recorded in the selected period"}
                  </div>
                  {result.integrity.ledgerBalance !== 0 && (
                    <div className="mt-1 text-[11px] text-muted-foreground/70">
                      {ar
                        ? `يوجد رصيد سابق للفترة بمقدار ${fmtAmount(result.openingBalance)}`
                        : `Opening balance carried: ${fmtAmount(result.openingBalance)}`}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {/* سطر الرصيد الافتتاحي — قرار التصميم: يظهر كأول سطر */}
                {layout.showOpeningRow && (
                  <TableRow className="bg-surface/70 hover:bg-surface/70">
                    {columns.map((col) => {
                      let content: React.ReactNode = "";
                      if (col.key === "index") {
                        content = (
                          <span className="font-mono text-xs text-muted-foreground">—</span>
                        );
                      } else if (col.key === "kind") {
                        content = (
                          <span className="text-xs font-medium italic text-muted-foreground">
                            {kindLabel("opening", result.entityType, lang)}
                          </span>
                        );
                      } else if (col.key === "description") {
                        content = (
                          <span className="text-xs italic text-muted-foreground">
                            {ar ? "رصيد ما قبل بداية الفترة" : "Balance before period start"}
                          </span>
                        );
                      } else if (col.key === "date") {
                        content = (
                          <span className="font-mono text-xs text-muted-foreground">
                            {result.period.from ?? "—"}
                          </span>
                        );
                      } else if (col.key === "balance") {
                        content = (
                          <span className="font-mono text-xs font-bold">
                            {fmtAmount(result.openingBalance)}
                          </span>
                        );
                      } else {
                        content = <span className="text-xs text-muted-foreground">—</span>;
                      }
                      return (
                        <TableCell key={col.key} className={alignClass(col.align)}>
                          {content}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                )}

                {rows.map((row) => (
                  <StatementRow key={row.id} row={row} result={result} layout={layout} />
                ))}
              </>
            )}

            {/* سطر الإجماليات */}
            {layout.showTotalsRow && result.transactions.length > 0 && (
              <TableRow className="border-t-2 border-border bg-surface-2/60 font-bold hover:bg-surface-2/60">
                {columns.map((col) => {
                  let content: React.ReactNode = "";
                  if (col.key === "kind") {
                    content = <span className="text-sm">{ar ? "الإجمالي" : "Total"}</span>;
                  } else if (col.key === "debit") {
                    content = (
                      <span className="font-mono text-rose-500">
                        {fmtAmount(result.totalDebit)}
                      </span>
                    );
                  } else if (col.key === "credit") {
                    content = (
                      <span className="font-mono text-emerald-500">
                        {fmtOrDash(result.totalCredit)}
                      </span>
                    );
                  } else if (col.key === "balance") {
                    content = (
                      <span className="font-mono text-primary">
                        {fmtAmount(result.closingBalance)}
                      </span>
                    );
                  }
                  return (
                    <TableCell key={col.key} className={cn(alignClass(col.align), "text-sm")}>
                      {content}
                    </TableCell>
                  );
                })}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <div className="flex items-center justify-center border-t border-border/60 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setVisible((v) => v + pageSize)}
          >
            <ChevronDown className="h-3.5 w-3.5" />
            {ar
              ? `تحميل المزيد (${result.transactions.length - visible} متبقية)`
              : `Load more (${result.transactions.length - visible} remaining)`}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// صف واحد
// ---------------------------------------------------------------------------

function StatementRow({
  row,
  result,
  layout,
}: {
  row: StatementTransaction;
  result: StatementResult;
  layout: StatementLayout;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  const alignClass = (align: "start" | "center" | "end") =>
    align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";

  const kindTone: Record<string, string> = {
    sale: "text-rose-500",
    payment: "text-emerald-500",
    return: "text-amber-500",
    adjustment: "text-sky-500",
    expense: "text-orange-500",
  };

  return (
    <TableRow className="hover:bg-surface-2/50">
      {layout.columns.map((col) => {
        let content: React.ReactNode = "—";

        switch (col.key) {
          case "index":
            content = <span className="font-mono text-xs text-muted-foreground">{row.index}</span>;
            break;
          case "date":
            content = (
              <span className="font-mono whitespace-nowrap text-xs text-muted-foreground">
                {new Date(row.occurredAt).toLocaleDateString(ar ? "ar-YE" : "en-GB")}
              </span>
            );
            break;
          case "reference":
            content = row.reference ? (
              <span className="font-mono text-xs text-primary">{row.reference}</span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            );
            break;
          case "kind":
            content = (
              <span className={cn("text-xs font-semibold", kindTone[row.kind])}>
                {kindLabel(row.kind, result.entityType, lang)}
              </span>
            );
            break;
          case "description":
            content = (
              <span className="text-xs text-muted-foreground">{row.description ?? "—"}</span>
            );
            break;
          case "debit":
            content = (
              <span className="font-mono text-xs text-rose-500">{fmtOrDash(row.debit)}</span>
            );
            break;
          case "credit":
            content = (
              <span className="font-mono text-xs text-emerald-500">{fmtOrDash(row.credit)}</span>
            );
            break;
          case "balance":
            content = (
              <span className="font-mono text-xs font-bold">{fmtAmount(row.runningBalance)}</span>
            );
            break;
          case "paymentMethod":
            content = (
              <span className="text-xs text-muted-foreground">
                {String(row.meta?.paymentMethod ?? "—")}
              </span>
            );
            break;
          default:
            content = "—";
        }

        return (
          <TableCell key={col.key} className={alignClass(col.align)}>
            {content}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
