import type { UnifiedDocumentData, InvoiceLabels, CustomFieldOptions } from "@/lib/templates/types";
import { escapeHtml, formatMoney } from "@/lib/templates/types";
import type { CompanyProfile } from "./company-profile";
import { getCachedCompanyProfile } from "./company-profile";
import { renderUniversalFooter, UNIVERSAL_FOOTER_CSS } from "./footer";

export function renderFormalTemplate(
  doc: UnifiedDocumentData,
  labels: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions & { company?: CompanyProfile },
  company: CompanyProfile = getCachedCompanyProfile(),
): string {
  const e = escapeHtml;
  const opts = {
    showCompanyInfo: true,
    showCustomerInfo: true,
    showDocNumberDate: true,
    showFinancialDetails: true,
    showNotes: true,
    showFooter: true,
    showLogo: true,
    ...options,
    ...doc.options,
  };
  // `doc.options` must not re-enable a footer the caller disabled.
  if (options?.showFooter === false) opts.showFooter = false;
  // An explicit `options.company` (or the 5th argument) wins over the cache.
  const resolvedCompany = options?.company ?? company;
  // `money` يُعرّف بعد resolvedCompany لأنه يعتمد عليها.
  const money = (n?: number) => formatMoney(n ?? 0, doc.currency ?? resolvedCompany.currency ?? "");
  const companyName = resolvedCompany.name || doc.company?.name || "";
  const rows = doc.lines
    .map(
      (line, i) =>
        `<tr><td>${i + 1}</td><td><strong>${e(line.product)}</strong>${line.code ? `<small>${e(line.code)}</small>` : ""}</td><td dir="ltr">${e(line.qty)} ${e(line.unit || "")}</td><td dir="ltr">${money(line.price)}</td><td dir="ltr">${money(line.total ?? line.qty * (line.price ?? 0))}</td></tr>`,
    )
    .join("");
  const footer = opts.showFooter ? renderUniversalFooter(resolvedCompany, rtl) : "";
  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8"><title>${e(doc.title)} #${e(doc.number)}</title><style>
  @page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}html,body{margin:0;background:#e5e7eb;color:#111827;font-family:Cairo,"Segoe UI",sans-serif;font-size:11px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:100%;min-height:273mm;background:#fff;display:flex;flex-direction:column;padding:0}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111827;padding-bottom:12px}.identity{display:flex;gap:10px;align-items:flex-start}.logo{width:48px;height:48px;object-fit:contain}.company{font-size:16px;font-weight:800}.muted{color:#4b5563;font-size:10px}.meta{text-align:${rtl ? "left" : "right"}}h1{font-size:20px;margin:0 0 5px} .info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}.box{border:1px solid #9ca3af;padding:8px;min-height:44px}.label{font-size:9px;color:#4b5563;margin-bottom:2px}table{width:100%;border-collapse:collapse;margin-top:8px}thead{display:table-header-group}th{background:#111827;color:#fff;padding:7px;text-align:${rtl ? "right" : "left"};font-weight:700}td{border-bottom:1px solid #d1d5db;padding:7px;vertical-align:top}td small{display:block;color:#6b7280;font-size:9px}tbody tr{break-inside:avoid}.totals{margin-inline-start:auto;width:45%;margin-top:16px}.total-row{display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #d1d5db}.grand{font-size:14px;font-weight:800;border:2px solid #111827;margin-top:5px}.notes{border:1px solid #d1d5db;padding:8px;margin-top:14px;white-space:pre-wrap}.signatures{display:flex;gap:20px;margin-top:28px}.signature{flex:1;border-top:1px solid #111827;padding-top:5px;text-align:center;font-size:10px}@media screen{body{padding:18px}.page{max-width:210mm;margin:auto;box-shadow:0 8px 32px #0002}}${UNIVERSAL_FOOTER_CSS}</style></head><body><main class="page"><header class="head"><div class="identity">${opts.showLogo && company.logoUrl ? `<img class="logo" src="${e(company.logoUrl)}" alt="${e(companyName)}">` : ""}<div>${opts.showCompanyInfo ? `<div class="company">${e(companyName)}</div><div class="muted">${e(company.legalName || "")}</div><div class="muted">${e(company.address || "")}</div><div class="muted">${e(company.phone || "")}</div>` : ""}</div></div><div class="meta"><h1>${e(doc.title)}</h1>${opts.showDocNumberDate ? `<div>${e(labels.invoice)}: <b dir="ltr">${e(doc.number)}</b></div><div>${e(labels.date)}: ${e(doc.date)}</div>` : ""}</div></header>${opts.showCustomerInfo && (doc.partyName || doc.partyPhone) ? `<section class="info"><div class="box"><div class="label">${e(labels.billTo)}</div><strong>${e(doc.partyName || "—")}</strong><div class="muted">${e(doc.partyPhone || "")}</div><div class="muted">${e(doc.partyAddress || "")}</div></div><div class="box"><div class="label">${e(labels.status)}</div><strong>${e(doc.status || "—")}</strong><div class="muted">${e(doc.payment || "")}</div></div></section>` : ""}<table><thead><tr><th>#</th><th>${e(labels.product)}</th><th>${e(labels.qty)}</th><th>${e(labels.price)}</th><th>${e(labels.total)}</th></tr></thead><tbody>${rows || `<tr><td colspan="5">—</td></tr>`}</tbody></table>${opts.showFinancialDetails ? `<section class="totals"><div class="total-row"><span>${e(labels.subtotal)}</span><b dir="ltr">${money(doc.subtotal)}</b></div><div class="total-row"><span>${e(labels.tax)}</span><b dir="ltr">${money(doc.tax)}</b></div><div class="total-row"><span>${e(labels.discount)}</span><b dir="ltr">${money(doc.discount)}</b></div><div class="total-row grand"><span>${e(labels.grandTotal)}</span><b dir="ltr">${money(doc.total)}</b></div></section>` : ""}${opts.showNotes && doc.notes ? `<div class="notes"><b>${e(labels.notes || "Notes")}</b><br>${e(doc.notes)}</div>` : ""}${opts.showSignatures ? `<div class="signatures"><div class="signature">${e(labels.recipientSignature || "Recipient")}</div><div class="signature">${e(labels.authorizedSignature || "Authorized")}</div></div>` : ""}${footer}</main></body></html>`;
}
