import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/lib/modules";
import { SalesInvoiceComposer } from "@/components/sales/sales-invoice-composer";

/**
 * صفحة «إنشاء فاتورة مبيعات» — ملف مسار رفيع عن قصد.
 *
 * الواجهة نفسها تعيش في `components/sales/sales-invoice-composer.tsx` حتى
 * يمكن تركيبها في أي مكان (صفحة مستقلة، درج، أو داخل حاوية أخرى) دون نسخ.
 * المسار هنا لا يحمل إلا الترويسة والحراسة.
 */
export const Route = createFileRoute("/_app/sales-invoice")({
  head: () => ({ meta: [{ title: "إنشاء فاتورة مبيعات — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="core">
      <SalesInvoiceComposer />
    </ModuleGuard>
  ),
});
