import type { InvoiceDoc } from "./pdf";

export type InvoiceTemplate = "thermal" | "standard" | "elegant";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function money(n: number, cur = "") {
  return `${cur ? cur + " " : ""}${Number(n || 0).toFixed(2)}`;
}

interface Labels {
  invoice: string; date: string; billTo: string; warehouse: string; payment: string; status: string;
  product: string; qty: string; price: string; total: string;
  subtotal: string; tax: string; discount: string; grandTotal: string; paid: string; balance: string;
  thanks: string; poweredBy: string;
}

function thermalHTML(doc: InvoiceDoc, L: Labels, rtl: boolean) {
  const c = doc.currency ?? "";
  const rows = doc.lines.map(l => `
    <div class="li">
      <div class="ln">${esc(l.product)}</div>
      <div class="lr"><span>${l.qty} × ${money(l.price, c)}</span><span>${money(l.total, c)}</span></div>
    </div>`).join("");
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
  <div class="tot"><span>${L.subtotal}</span><span>${money(doc.subtotal, c)}</span></div>
  <div class="tot"><span>${L.tax}</span><span>${money(doc.tax, c)}</span></div>
  <div class="tot"><span>${L.discount}</span><span>${money(doc.discount, c)}</span></div>
  <div class="hr"></div>
  <div class="tot grand"><span>${L.grandTotal}</span><span>${money(doc.total, c)}</span></div>
  ${doc.paid !== undefined ? `
  <div class="tot"><span>${L.paid}</span><span>${money(doc.paid, c)}</span></div>
  <div class="tot"><span>${L.balance}</span><span>${money(doc.total - doc.paid, c)}</span></div>` : ""}
  <div class="hr"></div>
  <div class="foot">${L.thanks}<br>${L.poweredBy}</div>
</div></body></html>`;
}

function standardHTML(doc: InvoiceDoc, L: Labels, rtl: boolean) {
  const c = doc.currency ?? "";
  const rows = doc.lines.map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.product)}</td>
      <td class="e">${l.qty}</td>
      <td class="e">${money(l.price, c)}</td>
      <td class="e">${money(l.total, c)}</td>
    </tr>`).join("");
  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#fff; color:#111; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12px; }
  .doc { max-width: 800px; margin: 0 auto; }
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
  @media screen { body { background:#f3f4f6; padding: 20px; } .doc { background:#fff; padding: 30px; box-shadow: 0 4px 30px rgba(0,0,0,.1); border-radius: 8px; } }
</style></head><body onload="window.print()">
<div class="doc">
  <header>
    <div class="co">
      <h1>${esc(doc.company?.name ?? "")}</h1>
      ${doc.company?.address ? `<div>${esc(doc.company.address)}</div>` : ""}
      ${doc.company?.phone ? `<div>${esc(doc.company.phone)}</div>` : ""}
      ${doc.company?.vat ? `<div>VAT: ${esc(doc.company.vat)}</div>` : ""}
    </div>
    <div class="inv">
      <h2>${esc(doc.title)}</h2>
      <div class="n">#${esc(doc.number)}</div>
      <div class="n">${esc(doc.date)}</div>
    </div>
  </header>
  <div class="meta">
    <div class="card"><div class="k">${L.billTo}</div><div class="v">${esc(doc.partyName)}</div></div>
    <div class="card"><div class="k">${L.warehouse}</div><div class="v">${esc(doc.warehouse ?? "—")}</div></div>
    <div class="card"><div class="k">${L.payment}</div><div class="v">${esc(doc.payment ?? "—")}</div></div>
    <div class="card"><div class="k">${L.status}</div><div class="v">${esc(doc.status ?? "—")}</div></div>
  </div>
  <table>
    <thead><tr><th class="c">#</th><th>${L.product}</th><th class="e">${L.qty}</th><th class="e">${L.price}</th><th class="e">${L.total}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="r"><span>${L.subtotal}</span><span>${money(doc.subtotal, c)}</span></div>
    <div class="r"><span>${L.tax}</span><span>${money(doc.tax, c)}</span></div>
    <div class="r"><span>${L.discount}</span><span>${money(doc.discount, c)}</span></div>
    <div class="r g"><span>${L.grandTotal}</span><span>${money(doc.total, c)}</span></div>
    ${doc.paid !== undefined ? `
    <div class="r"><span>${L.paid}</span><span>${money(doc.paid, c)}</span></div>
    <div class="r"><span>${L.balance}</span><span>${money(doc.total - doc.paid, c)}</span></div>` : ""}
  </div>
  <footer>${L.thanks} — ${L.poweredBy}</footer>
</div></body></html>`;
}

function elegantHTML(doc: InvoiceDoc, L: Labels, rtl: boolean) {
  const c = doc.currency ?? "";
  const rows = doc.lines.map((l, i) => `
    <tr>
      <td class="c muted">${String(i + 1).padStart(2, "0")}</td>
      <td><b>${esc(l.product)}</b></td>
      <td class="e">${l.qty}</td>
      <td class="e">${money(l.price, c)}</td>
      <td class="e"><b>${money(l.total, c)}</b></td>
    </tr>`).join("");
  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=Inter:wght@300;400;600;700&family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  :root {
    --ink:#0a1128; --gold:#b8935a; --gold-2:#d4b483; --line:#e6e2d6; --muted:#7a7566;
  }
  html,body { margin:0; padding:0; background:#fff; color:var(--ink);
    font-family: ${rtl ? "'Cairo'," : ""} 'Inter', system-ui, sans-serif; font-size: 12px; }
  .page { width: 210mm; min-height: 297mm; padding: 22mm 20mm; margin: 0 auto; position: relative; background:
    radial-gradient(1200px 400px at 100% 0%, rgba(184,147,90,.06), transparent 60%),
    radial-gradient(900px 400px at 0% 100%, rgba(10,17,40,.05), transparent 60%), #fffdf9; }
  .frame { position:absolute; inset: 10mm; border: 1px solid var(--line); border-radius: 4px; pointer-events:none; }
  .frame::before, .frame::after { content:""; position:absolute; width:36px; height:36px; border: 2px solid var(--gold); }
  .frame::before { top:-1px; ${rtl ? "right" : "left"}:-1px; border-${rtl ? "left" : "right"}:0; border-bottom:0; }
  .frame::after { bottom:-1px; ${rtl ? "left" : "right"}:-1px; border-${rtl ? "right" : "left"}:0; border-top:0; }
  header { display:flex; justify-content:space-between; align-items:flex-end; padding-bottom: 18px; border-bottom: 1px solid var(--line); position:relative; z-index:1; }
  .brand h1 { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 34px; letter-spacing: 1px; margin: 0; color: var(--ink); }
  .brand .sub { color: var(--gold); letter-spacing: 4px; font-size: 10px; text-transform: uppercase; margin-top: 4px; }
  .brand .info { color: var(--muted); font-size: 10.5px; margin-top: 10px; line-height: 1.6; }
  .stamp { text-align: ${rtl ? "left" : "right"}; }
  .stamp .t { font-family: 'Cormorant Garamond', serif; font-size: 28px; font-weight: 700; color: var(--ink); letter-spacing: 6px; text-transform: uppercase; }
  .stamp .line { width: 60px; height: 2px; background: var(--gold); margin: 6px 0 6px auto; ${rtl ? "margin-left:0; margin-right:auto;" : ""} }
  .stamp .n { font-family: ui-monospace, monospace; color: var(--muted); font-size: 11px; }
  .parties { display:grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
  .party .k { color: var(--gold); font-size: 9.5px; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 6px; }
  .party .v { font-size: 15px; font-weight: 600; }
  .party .m { color: var(--muted); font-size: 11px; margin-top: 3px; }
  table { width:100%; border-collapse: collapse; margin-top: 8px; }
  thead th { color: var(--gold); font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase; text-align:${rtl ? "right" : "left"};
    padding: 10px 8px; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); font-weight: 600; }
  tbody td { padding: 12px 8px; border-bottom: 1px dashed var(--line); font-size: 12.5px; }
  .c { text-align:center; } .e { text-align:${rtl ? "left" : "right"}; } .muted { color: var(--muted); }
  .foot { display:grid; grid-template-columns: 1fr 320px; gap: 24px; margin-top: 22px; }
  .thanks { padding: 18px 0; }
  .thanks .g { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 20px; color: var(--ink); }
  .thanks .m { color: var(--muted); font-size: 10.5px; margin-top: 6px; max-width: 320px; }
  .totals { border: 1px solid var(--line); border-radius: 4px; padding: 14px 16px; background: rgba(255,253,247,.6); }
  .totals .r { display:flex; justify-content:space-between; padding: 5px 0; color:#3b3b3b; font-size: 12px; }
  .totals .g { margin-top: 8px; padding-top: 10px; border-top: 2px solid var(--ink);
    font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 700; color: var(--ink); }
  .sign { margin-top: 40px; display:flex; justify-content:space-between; gap: 40px; }
  .sign div { flex:1; text-align:center; }
  .sign .l { border-top: 1px solid var(--ink); padding-top: 6px; color: var(--muted); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; }
  footer { position:absolute; bottom: 12mm; left: 20mm; right: 20mm; text-align:center; color: var(--muted); font-size: 9.5px; letter-spacing: 2px; text-transform: uppercase; }
  @media screen { body { background: linear-gradient(180deg,#f5f2ea,#eee9dc); padding: 20px 0; } .page { box-shadow: 0 20px 60px rgba(0,0,0,.18); } }
  @media print { body { background:#fff; } .page { box-shadow:none; } }
</style></head><body onload="setTimeout(()=>window.print(),300)">
<div class="page">
  <div class="frame"></div>
  <header>
    <div class="brand">
      <h1>${esc(doc.company?.name ?? "")}</h1>
      <div class="sub">${L.poweredBy}</div>
      <div class="info">
        ${doc.company?.address ? `${esc(doc.company.address)}<br>` : ""}
        ${doc.company?.phone ? `${esc(doc.company.phone)}<br>` : ""}
        ${doc.company?.vat ? `VAT · ${esc(doc.company.vat)}` : ""}
      </div>
    </div>
    <div class="stamp">
      <div class="t">${esc(doc.title)}</div>
      <div class="line"></div>
      <div class="n">Nº ${esc(doc.number)}</div>
      <div class="n">${esc(doc.date)}</div>
    </div>
  </header>
  <div class="parties">
    <div class="party"><div class="k">${L.billTo}</div><div class="v">${esc(doc.partyName)}</div>
      <div class="m">${esc(doc.warehouse ? `${L.warehouse}: ${doc.warehouse}` : "")}</div></div>
    <div class="party" style="text-align:${rtl ? "left" : "right"}"><div class="k">${L.payment} · ${L.status}</div>
      <div class="v">${esc(doc.payment ?? "—")}</div><div class="m">${esc(doc.status ?? "")}</div></div>
  </div>
  <table>
    <thead><tr><th class="c" style="width:36px">#</th><th>${L.product}</th><th class="e">${L.qty}</th><th class="e">${L.price}</th><th class="e">${L.total}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot">
    <div class="thanks">
      <div class="g">${L.thanks}</div>
      <div class="m">${L.poweredBy}</div>
    </div>
    <div class="totals">
      <div class="r"><span>${L.subtotal}</span><span>${money(doc.subtotal, c)}</span></div>
      <div class="r"><span>${L.tax}</span><span>${money(doc.tax, c)}</span></div>
      <div class="r"><span>${L.discount}</span><span>${money(doc.discount, c)}</span></div>
      <div class="r g"><span>${L.grandTotal}</span><span>${money(doc.total, c)}</span></div>
      ${doc.paid !== undefined ? `
      <div class="r"><span>${L.paid}</span><span>${money(doc.paid, c)}</span></div>
      <div class="r"><span>${L.balance}</span><span>${money(doc.total - doc.paid, c)}</span></div>` : ""}
    </div>
  </div>
  <div class="sign">
    <div><div style="height:40px"></div><div class="l">${rtl ? "توقيع المستلم" : "Received By"}</div></div>
    <div><div style="height:40px"></div><div class="l">${rtl ? "توقيع المُصدر" : "Authorized"}</div></div>
  </div>
  <footer>${L.thanks} · ${L.poweredBy}</footer>
</div></body></html>`;
}

export function printInvoice(doc: InvoiceDoc, template: InvoiceTemplate, labels: Labels, rtl: boolean) {
  const html =
    template === "thermal" ? thermalHTML(doc, labels, rtl) :
    template === "elegant" ? elegantHTML(doc, labels, rtl) :
    standardHTML(doc, labels, rtl);

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    // popup blocked — fallback to iframe
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:9999;background:#000";
    document.body.appendChild(iframe);
    const cw = iframe.contentWindow!;
    cw.document.open(); cw.document.write(html); cw.document.close();
    setTimeout(() => {
      cw.focus(); cw.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 400);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
