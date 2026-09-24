import { UnifiedInvoiceData, InvoiceLabels, escapeHtml, formatMoney, DEFAULT_BRANDING } from "./types";

export function renderThermalTemplate(doc: UnifiedInvoiceData, L: InvoiceLabels, rtl: boolean): string {
  const c = doc.currency ?? "";
  const esc = escapeHtml;
  const money = (n: number) => formatMoney(n, c);
  const branding = doc.brandingText || DEFAULT_BRANDING;

  const rows = doc.lines
    .map(
      (l) => `
    <div class="li">
      <div class="ln">${esc(l.product)}</div>
      <div class="lr"><span>${l.qty} × ${money(l.price)}</span><span>${money(l.total)}</span></div>
    </div>`,
    )
    .join("");

  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#fff; color:#000; font-family: 'Courier New', ui-monospace, monospace; }
  .r { width: 80mm; padding: 6mm 5mm; font-size: 12px; line-height: 1.35; }
  .c { text-align: center; }
  h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .5px; }
  .muted { color:#333; font-size: 11px; }
  .hr { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display:flex; justify-content:space-between; gap:8px; font-size: 11px; }
  .li { margin: 4px 0; }
  .ln { font-weight: 600; font-size: 12px; }
  .lr { display:flex; justify-content:space-between; font-size: 11px; }
  .tot { display:flex; justify-content:space-between; font-size: 12px; margin: 2px 0; }
  .grand { font-size: 15px; font-weight: 700; margin-top: 4px; }
  .foot { text-align:center; font-size: 10px; margin-top: 8px; }
  .branding { text-align:center; font-size: 9px; color:#555; margin-top: 6px; border-top: 1px dotted #aaa; padding-top: 4px; font-weight: 500; }
  @media screen { body { background:#eee; padding: 20px 0; } .r { margin: 0 auto; background:#fff; box-shadow: 0 2px 20px rgba(0,0,0,.15); } }
</style></head><body onload="window.print()">
<div class="r">
  <div class="c">
    <h1>${esc(doc.company?.name ?? "")}</h1>
    ${doc.company?.address ? `<div class="muted">${esc(doc.company.address)}</div>` : ""}
    ${doc.company?.phone ? `<div class="muted">${esc(doc.company.phone)}</div>` : ""}
    ${doc.company?.vat ? `<div class="muted">VAT: ${esc(doc.company.vat)}</div>` : ""}
  </div>
  <div class="hr"></div>
  <div class="row"><span>${L.invoice}</span><b>${esc(doc.number)}</b></div>
  <div class="row"><span>${L.date}</span><span>${esc(doc.date)}</span></div>
  <div class="row"><span>${L.billTo}</span><span>${esc(doc.partyName)}</span></div>
  ${doc.payment ? `<div class="row"><span>${L.payment}</span><span>${esc(doc.payment)}</span></div>` : ""}
  <div class="hr"></div>
  ${rows}
  <div class="hr"></div>
  <div class="tot"><span>${L.subtotal}</span><span>${money(doc.subtotal)}</span></div>
  <div class="tot"><span>${L.tax}</span><span>${money(doc.tax)}</span></div>
  <div class="tot"><span>${L.discount}</span><span>${money(doc.discount)}</span></div>
  <div class="hr"></div>
  <div class="tot grand"><span>${L.grandTotal}</span><span>${money(doc.total)}</span></div>
  ${
    doc.paid !== undefined
      ? `
  <div class="tot"><span>${L.paid}</span><span>${money(doc.paid)}</span></div>
  <div class="tot"><span>${L.balance}</span><span>${money(doc.total - doc.paid)}</span></div>`
      : ""
  }
  <div class="hr"></div>
  <div class="foot">${L.thanks}</div>
  <div class="branding">${esc(branding)}</div>
</div></body></html>`;
}
