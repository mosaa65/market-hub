import { UnifiedDocumentData, InvoiceLabels, escapeHtml, formatMoney, DEFAULT_BRANDING, CustomFieldOptions } from "./types";

export function renderStandardTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions
): string {
  const c = doc.currency ?? "";
  const esc = escapeHtml;
  const money = (n?: number) => formatMoney(n, c);
  const branding = doc.brandingText || DEFAULT_BRANDING;
  const opts = {
    showLogo: true,
    showCompanyInfo: true,
    showCustomerInfo: true,
    showDocNumberDate: true,
    showMovementInfo: true,
    showFinancialDetails: true,
    showPaymentInfo: true,
    showNotes: true,
    showSignatures: true,
    showFooter: true,
    showBranding: true,
    ...options,
    ...doc.options,
  };

  const rows = doc.lines
    .map(
      (l, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.product)}</td>
      <td class="e">${l.qty} ${l.unit ? esc(l.unit) : ""}</td>
      <td class="e">${money(l.price)}</td>
      <td class="e">${money(l.total)}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#fff; color:#111; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12px; }
  .doc { max-width: 800px; margin: 0 auto; position: relative; min-height: 90vh; display: flex; flex-direction: column; }
  .content { flex: 1; }
  header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:14px; border-bottom: 2px solid #111; }
  .co h1 { margin:0 0 4px; font-size: 22px; }
  .co div { color:#555; font-size: 11px; }
  .inv { text-align: ${rtl ? "left" : "right"}; }
  .inv h2 { margin:0; font-size: 20px; letter-spacing: 1px; color:#111; }
  .inv .n { font-family: ui-monospace, monospace; font-size: 12px; color:#555; }
  .meta { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 18px 0; }
  .card { border:1px solid #e5e5e5; border-radius: 6px; padding: 10px 12px; }
  .card .k { font-size: 10px; color:#666; text-transform: uppercase; letter-spacing: .8px; }
  .card .v { font-size: 13px; font-weight: 600; margin-top: 2px; }
  table { width:100%; border-collapse: collapse; margin-top: 8px; }
  thead th { background:#111; color:#fff; padding: 8px; font-size: 11px; text-align:${rtl ? "right" : "left"}; }
  tbody td { padding: 8px; border-bottom: 1px solid #eee; }
  .c { text-align:center; } .e { text-align:${rtl ? "left" : "right"}; }
  .totals { margin-top: 14px; margin-${rtl ? "right" : "left"}: auto; width: 300px; }
  .totals .r { display:flex; justify-content:space-between; padding: 4px 0; color:#444; }
  .totals .g { border-top: 2px solid #111; margin-top: 6px; padding-top: 8px; font-size: 15px; font-weight: 700; color:#111; }
  footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; text-align:center; color:#777; font-size: 10px; }
  .branding { font-size: 9.5px; color: #888; font-weight: 500; margin-top: 4px; }
  @media screen { body { background:#f3f4f6; padding: 20px; } .doc { background:#fff; padding: 30px; box-shadow: 0 4px 30px rgba(0,0,0,.1); border-radius: 8px; } }
</style></head><body onload="window.print()">
<div class="doc">
  <div class="content">
    <header>
      <div class="co">
        ${opts.showCompanyInfo && doc.company?.name ? `<h1>${esc(doc.company.name)}</h1>` : "<h1>الفاتورة</h1>"}
        ${opts.showCompanyInfo && doc.company?.address ? `<div>${esc(doc.company.address)}</div>` : ""}
        ${opts.showCompanyInfo && doc.company?.phone ? `<div>${esc(doc.company.phone)}</div>` : ""}
        ${opts.showCompanyInfo && doc.company?.vat ? `<div>VAT: ${esc(doc.company.vat)}</div>` : ""}
      </div>
      <div class="inv">
        <h2>${esc(doc.title)}</h2>
        ${opts.showDocNumberDate ? `
        <div class="n">#${esc(doc.number)}</div>
        <div class="n">${esc(doc.date)}</div>
        ` : ""}
      </div>
    </header>
    <div class="meta">
      ${opts.showCustomerInfo ? `<div class="card"><div class="k">${L.billTo}</div><div class="v">${esc(doc.partyName)}</div></div>` : ""}
      ${opts.showMovementInfo ? `<div class="card"><div class="k">${L.warehouse}</div><div class="v">${esc(doc.warehouse ?? "—")}</div></div>` : ""}
      ${opts.showPaymentInfo ? `<div class="card"><div class="k">${L.payment}</div><div class="v">${esc(doc.payment ?? "—")}</div></div>` : ""}
      <div class="card"><div class="k">${L.status}</div><div class="v">${esc(doc.status ?? "—")}</div></div>
    </div>
    <table>
      <thead><tr><th class="c">#</th><th>${L.product}</th><th class="e">${L.qty}</th><th class="e">${L.price}</th><th class="e">${L.total}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${opts.showFinancialDetails ? `
    <div class="totals">
      <div class="r"><span>${L.subtotal}</span><span>${money(doc.subtotal)}</span></div>
      <div class="r"><span>${L.tax}</span><span>${money(doc.tax)}</span></div>
      <div class="r"><span>${L.discount}</span><span>${money(doc.discount)}</span></div>
      <div class="r g"><span>${L.grandTotal}</span><span>${money(doc.total)}</span></div>
      ${
        doc.paid !== undefined
          ? `
      <div class="r"><span>${L.paid}</span><span>${money(doc.paid)}</span></div>
      <div class="r"><span>${L.balance}</span><span>${money((doc.total ?? 0) - doc.paid)}</span></div>`
          : ""
      }
    </div>
    ` : ""}
  </div>
  ${opts.showFooter ? `
  <footer>
    <div>${L.thanks}</div>
    ${opts.showBranding ? `<div class="branding">${esc(branding)}</div>` : ""}
  </footer>
  ` : ""}
</div></body></html>`;
}
