import { renderElegantTemplate } from "../src/lib/templates/elegant";
const COMPANY = { name: "x", contacts: [] } as any;
const doc: any = {
  docType: "customer_invoice", title: "t", number: "T-001", date: "2026-10-04",
  partyName: "p", warehouse: "w", payment: "n", status: "s",
  lines: [{ product: "a", qty: 2, unit: "u", price: 5, total: 10 }],
  subtotal: 10, tax: 0, discount: 0, total: 10, paid: 10, balance: 0,
  currency: "ر.ي", company: { name: "x" },
};
const html = renderElegantTemplate(doc, {} as any, true, { company: COMPANY });
console.log("hasQRbox:", /class="luxury-qr-box"/.test(html));
console.log("hasRightsFooter:", html.includes("772217218"));
console.log("isLuxury branch:", /luxury-header-wrap/.test(html));
