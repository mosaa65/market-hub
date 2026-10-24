import { renderUnifiedDocument } from "../src/lib/printing/engine";
import { cacheCompanyProfile } from "../src/lib/printing/company-profile";
cacheCompanyProfile({
  name: "شركة النور للتجارة",
  name_ar: "شركة النور",
  phone: "771111",
  address: "صنعاء - شارع تعز",
  currency_symbol: "ر.ي",
});
const html = renderUnifiedDocument({
  doc: {
    docType: "customer_invoice",
    title: "فاتورة مبيعات",
    number: "INV-1",
    date: "2026-10-05",
    partyName: "عميل",
    lines: [{ product: "صنف", qty: 1, price: 10, total: 10 }],
    total: 10,
    currency: "ر.ي",
  },
  rtl: true,
  paperId: "a4",
  templateId: "standard",
  theme: "standard",
} as any);
console.log("company:", html.includes("شركة النور للتجارة"));
console.log("address:", html.includes("صنعاء - شارع تعز"));
const idx = html.lastIndexOf("corporate-brand-block");
console.log(html.slice(idx, idx + 600));
