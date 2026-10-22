import { Link } from "@tanstack/react-router";
import { FilePlus2, ListChecks } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type InvoiceKind = "sales" | "purchase";

export function InvoiceSectionTabs({
  kind,
  active,
}: {
  kind: InvoiceKind;
  active: "list" | "create";
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const listLabel =
    kind === "sales"
      ? ar
        ? "فواتير المبيعات"
        : "Sales invoices"
      : ar
        ? "فواتير المشتريات"
        : "Purchase invoices";
  const createLabel =
    kind === "sales"
      ? ar
        ? "إنشاء فاتورة مبيعات"
        : "Create sales invoice"
      : ar
        ? "إنشاء فاتورة مشتريات"
        : "Create purchase invoice";

  return (
    <nav
      aria-label={ar ? "التنقل بين الفواتير" : "Invoice navigation"}
      className="flex w-full gap-1 rounded-2xl border border-border/70 bg-surface-2/35 p-1 sm:w-fit"
    >
      {kind === "sales" ? (
        <>
          <Link
            to="/sales"
            aria-current={active === "list" ? "page" : undefined}
            className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition sm:flex-none sm:px-4 ${active === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}
          >
            <ListChecks className="size-4" />
            {listLabel}
          </Link>
          <Link
            to="/sales-invoice/new"
            aria-current={active === "create" ? "page" : undefined}
            className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition sm:flex-none sm:px-4 ${active === "create" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}
          >
            <FilePlus2 className="size-4" />
            {createLabel}
          </Link>
        </>
      ) : (
        <>
          <Link
            to="/purchases"
            aria-current={active === "list" ? "page" : undefined}
            className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition sm:flex-none sm:px-4 ${active === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}
          >
            <ListChecks className="size-4" />
            {listLabel}
          </Link>
          <Link
            to="/purchase-invoice"
            aria-current={active === "create" ? "page" : undefined}
            className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition sm:flex-none sm:px-4 ${active === "create" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}
          >
            <FilePlus2 className="size-4" />
            {createLabel}
          </Link>
        </>
      )}
    </nav>
  );
}
