/**
 * /milling/custody-delivery — أمانات التسليم (الواجهة الثانية المنفصلة).
 *
 * تُعرض فقط نواتج الطحن الجاهزة للتسليم (OUTPUT) لكل عميل، مع أزرار التسليم
 * وسند التسليم الرسمي. الواجهة الأولى المنفصلة لأمانات الطحن هي
 * /milling/customer-statement — نفس المحرك، منفصلتان بصرياً وتشغيلياً.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CustomerCustodyPageBase } from "./_app.milling.customer-statement";

export const Route = createFileRoute("/_app/milling/custody-delivery")({
  validateSearch: (search: Record<string, unknown>): { customerId?: string } => ({
    customerId: typeof search.customerId === "string" ? search.customerId : undefined,
  }),
  head: () => ({ meta: [{ title: "أمانات التسليم — فورتكس ERP" }] }),
  component: () => <CustomerCustodyPageBase mode="delivery" />,
});
