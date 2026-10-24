import { renderUnifiedLayout } from "../src/lib/templates/unified-layout";
import { cacheCompanyProfile } from "../src/lib/printing/company-profile";
cacheCompanyProfile({
  name: "شركة النور للتجارة",
  name_ar: "شركة النور",
  phone: "771111",
  address: "صنعاء - شارع تعز",
});
const html = renderUnifiedLayout(
  {
    docType: "customer_invoice",
    number: "INV-1",
    date: "2026-10-05",
    lines: [{ product: "صنف", qty: 1, price: 10, total: 10 }],
    total: 10,
    currency: "ر.ي",
  } as any,
  {} as any,
  true,
  { theme: "standard" } as any,
);
const idx = html.indexOf("<header");
console.log(html.slice(idx, idx + 900));
