import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/lib/modules";
import { StandardInvoiceComposer } from "@/components/invoices/standard-invoice-composer";

export const Route = createFileRoute("/_app/purchase-invoice")({
  head: () => ({ meta: [{ title: "إنشاء فاتورة مشتريات — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="purchases">
      <StandardInvoiceComposer kind="purchase" />
    </ModuleGuard>
  ),
});
