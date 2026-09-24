import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  formatMoney,
  DEFAULT_BRANDING,
  CustomFieldOptions,
} from "./types";

export function renderStandardTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions,
): string {
  const c = doc.currency ?? "";
  const esc = escapeHtml;
  const money = (n?: number) => formatMoney(n ?? 0, c);
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
    .map((l, i) => {
      const itemPrice = l.price ?? 0;
      const itemTotal = l.total ?? l.qty * itemPrice;
      return `
    <tr>
      <td class="c">${i + 1}</td>
      <td>
        <span class="p-title">${esc(l.product)}</span>
        ${l.code ? `<span class="p-sku">(${esc(l.code)})</span>` : ""}
      </td>
      <td class="c">${l.qty} ${l.unit ? esc(l.unit) : ""}</td>
      <td class="num">${money(itemPrice)}</td>
      <td class="num bold">${money(itemTotal)}</td>
    </tr>`;
    })
    .join("");

  const numColumns = 5;

  return `<!doctype html>
<html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8">
  <title>${esc(doc.number)} - ${esc(doc.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background: #fff;
      color: #1e293b;
      font-family: ${rtl ? "'Cairo'," : ""} 'Inter', system-ui, sans-serif;
      font-size: 12px;
      direction: ${rtl ? "rtl" : "ltr"};
      text-align: ${rtl ? "right" : "left"};
    }
    .doc {
      max-width: 820px;
      margin: 0 auto;
      min-height: 95vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
    }
    .content { flex: 1; }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 16px;
      border-bottom: 2px solid #0f172a;
    }
    .co h1 {
      margin: 0 0 4px;
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
    }
    .co .sub-brand {
      color: #2563eb;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .co .info-line {
      color: #64748b;
      font-size: 11px;
      line-height: 1.5;
    }
    .inv {
      text-align: ${rtl ? "left" : "right"};
    }
    .inv h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
    }
    .inv .badge-num {
      display: inline-block;
      margin-top: 4px;
      font-family: ui-monospace, monospace;
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      background: #f1f5f9;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid #cbd5e1;
    }
    .inv .date-line {
      font-size: 11px;
      color: #64748b;
      margin-top: 4px;
    }

    .meta-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 16px 0;
    }
    .card {
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .card .k {
      font-size: 10px;
      color: #64748b;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: .5px;
    }
    .card .v {
      font-size: 13.5px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 2px;
    }
    .card .sub {
      font-size: 10.5px;
      color: #64748b;
      margin-top: 2px;
    }

    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    table.items thead th {
      background: #0f172a;
      color: #ffffff;
      padding: 9px 10px;
      font-size: 11px;
      font-weight: 700;
      text-align: ${rtl ? "right" : "left"};
    }
    table.items thead th.c { text-align: center; }
    table.items thead th.num { text-align: ${rtl ? "left" : "right"}; }
    table.items tbody td {
      padding: 9px 10px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 12px;
    }
    table.items tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .p-title { font-weight: 600; color: #0f172a; }
    .p-sku { color: #64748b; font-size: 10px; margin-${rtl ? "right" : "left"}: 4px; }
    .c { text-align: center; }
    .num { text-align: ${rtl ? "left" : "right"}; font-family: system-ui, sans-serif; }
    .bold { font-weight: 700; color: #0f172a; }

    .bottom-block {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-top: 16px;
    }
    .notes-section {
      flex: 1;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      background: #fafafa;
    }
    .notes-section .n-lbl {
      font-weight: 700;
      font-size: 11px;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .notes-section .n-txt {
      color: #475569;
      font-size: 11px;
      line-height: 1.5;
    }

    .totals {
      width: 280px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 14px;
      background: #f8fafc;
    }
    .totals .r {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      color: #334155;
      font-size: 12px;
    }
    .totals .g {
      border-top: 2px solid #0f172a;
      margin-top: 6px;
      padding-top: 8px;
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
    }

    .signatures-block {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-top: 35px;
      text-align: center;
    }
    .sig-item .sig-line {
      border-top: 1px solid #0f172a;
      padding-top: 6px;
      font-weight: 700;
      font-size: 11px;
      color: #0f172a;
    }

    footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      color: #64748b;
      font-size: 10.5px;
    }
    .branding {
      font-size: 10px;
      color: #2563eb;
      font-weight: 700;
      margin-top: 4px;
    }

    @media screen {
      body { background: #f1f5f9; padding: 20px; }
      .doc { background: #fff; padding: 25px 30px; box-shadow: 0 4px 20px rgba(0,0,0,.08); border-radius: 8px; }
    }
    @media print {
      body { background: #fff; }
      .doc { box-shadow: none; padding: 0; }
    }
  </style>
</head>
<body onload="window.print()">
<div class="doc">
  <div class="content">
    <header>
      <div class="co">
        ${opts.showCompanyInfo && doc.company?.name ? `<h1>${esc(doc.company.name)}</h1>` : `<h1>${esc(doc.title)}</h1>`}
        ${opts.showBranding ? `<div class="sub-brand">${esc(branding)}</div>` : ""}
        <div class="info-line">
          ${opts.showCompanyInfo && doc.company?.address ? `${esc(doc.company.address)}<br>` : ""}
          ${opts.showCompanyInfo && doc.company?.phone ? `${rtl ? "تلفون" : "Tel"}: ${esc(doc.company.phone)} ` : ""}
          ${opts.showCompanyInfo && doc.company?.vat ? `| ${rtl ? "الرقم الضريبي" : "VAT"}: ${esc(doc.company.vat)}` : ""}
        </div>
      </div>
      <div class="inv">
        <h2>${esc(doc.title)}</h2>
        ${opts.showDocNumberDate ? `
        <div class="badge-num">#${esc(doc.number)}</div>
        <div class="date-line">${L.date}: ${esc(doc.date)}</div>
        ${doc.dueDate ? `<div class="date-line">${L.dueDate || (rtl ? "الاستحقاق" : "Due")}: ${esc(doc.dueDate)}</div>` : ""}
        ` : ""}
      </div>
    </header>

    <div class="meta-cards">
      ${opts.showCustomerInfo && doc.partyName ? `
      <div class="card">
        <div class="k">${doc.partyLabel || L.billTo}</div>
        <div class="v">${esc(doc.partyName)}</div>
        ${doc.partyPhone ? `<div class="sub">${rtl ? "هاتف" : "Phone"}: ${esc(doc.partyPhone)}</div>` : ""}
        ${doc.partyVat ? `<div class="sub">${rtl ? "الرقم الضريبي" : "VAT"}: ${esc(doc.partyVat)}</div>` : ""}
      </div>` : ""}

      ${opts.showMovementInfo && doc.warehouse ? `
      <div class="card">
        <div class="k">${L.warehouse}</div>
        <div class="v">${esc(doc.warehouse)}</div>
        ${doc.destinationWarehouse ? `<div class="sub">${rtl ? "إلى" : "To"}: ${esc(doc.destinationWarehouse)}</div>` : ""}
        ${doc.operatorName ? `<div class="sub">${rtl ? "المسؤول" : "Operator"}: ${esc(doc.operatorName)}</div>` : ""}
      </div>` : ""}

      ${opts.showPaymentInfo ? `
      <div class="card">
        <div class="k">${L.payment} · ${L.status}</div>
        <div class="v">${esc(doc.payment ?? (rtl ? "نقداً" : "Cash"))}</div>
        <div class="sub">${rtl ? "الحالة" : "Status"}: ${esc(doc.status ?? (rtl ? "مكتمل" : "Completed"))}</div>
      </div>` : ""}
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="c" style="width: 40px">#</th>
          <th>${L.product}</th>
          <th class="c">${L.qty}</th>
          <th class="num">${L.price}</th>
          <th class="num">${L.total}</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="${numColumns}" class="c">${rtl ? "لا توجد عناصر" : "No items"}</td></tr>`}
      </tbody>
    </table>

    <div class="bottom-block">
      <div class="notes-section">
        ${opts.showNotes && doc.notes ? `
          <div class="n-lbl">${rtl ? "ملاحظات" : "Notes"}:</div>
          <div class="n-txt">${esc(doc.notes)}</div>
        ` : `
          <div class="n-lbl">${L.thanks}</div>
          <div class="n-txt">${rtl ? "نشكركم على اختياركم لنا ونتطلع لخدمتكم دائماً." : "Thank you for choosing us."}</div>
        `}
      </div>

      ${opts.showFinancialDetails ? `
      <div class="totals">
        <div class="r"><span>${L.subtotal}</span><span>${money(doc.subtotal)}</span></div>
        ${doc.discount ? `<div class="r"><span>${L.discount}</span><span>${money(doc.discount)}</span></div>` : ""}
        ${doc.tax ? `<div class="r"><span>${L.tax}</span><span>${money(doc.tax)}</span></div>` : ""}
        <div class="r g"><span>${L.grandTotal}</span><span>${money(doc.total)}</span></div>
        ${
          doc.paid !== undefined
            ? `
        <div class="r"><span>${L.paid}</span><span>${money(doc.paid)}</span></div>
        <div class="r"><span>${L.balance}</span><span>${money((doc.total ?? 0) - doc.paid)}</span></div>`
            : ""
        }
      </div>` : "<div></div>"}
    </div>

    ${opts.showSignatures ? `
    <div class="signatures-block">
      <div class="sig-item">
        <div style="height: 35px"></div>
        <div class="sig-line">${rtl ? "توقيع المستلم" : "Recipient Signature"}</div>
      </div>
      <div class="sig-item">
        <div style="height: 35px"></div>
        <div class="sig-line">${rtl ? "توقيع المصدر / التخيل" : "Authorized Signature"}</div>
      </div>
    </div>` : ""}
  </div>

  ${opts.showFooter ? `
  <footer>
    <div>${L.thanks}</div>
    ${opts.showBranding ? `<div class="branding">${esc(branding)}</div>` : ""}
  </footer>` : ""}
</div>
</body>
</html>`;
}
