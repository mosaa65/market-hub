import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  formatMoney,
  DEFAULT_BRANDING,
  CustomFieldOptions,
} from "./types";

export function renderElegantTemplate(
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
      <td class="c muted">${String(i + 1).padStart(2, "0")}</td>
      <td>
        <div class="p-name">${esc(l.product)}</div>
        ${l.code ? `<div class="p-code">${rtl ? "كود" : "SKU"}: ${esc(l.code)}</div>` : ""}
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
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Amiri:ital,wght@0,400;0,700;1,400&family=Cinzel:wght@600;700&family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    :root {
      --navy: #0e1e38;
      --gold: #c59b27;
      --gold-light: #f7f3e6;
      --gold-dark: #997413;
      --line: #e2ded4;
      --muted: #64748b;
      --bg-soft: #faf9f6;
    }
    html, body {
      margin: 0; padding: 0;
      background: #fff;
      color: var(--navy);
      font-family: ${rtl ? "'Cairo', 'Tajawal'," : ""} 'Inter', system-ui, sans-serif;
      font-size: 12px;
      direction: ${rtl ? "rtl" : "ltr"};
      text-align: ${rtl ? "right" : "left"};
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 18mm 16mm 16mm 16mm;
      margin: 0 auto;
      position: relative;
      background:
        radial-gradient(1000px 300px at ${rtl ? "0%" : "100%"} 0%, rgba(197,155,39,.05), transparent 70%),
        radial-gradient(800px 300px at ${rtl ? "100%" : "0%"} 100%, rgba(14,30,56,.04), transparent 70%),
        #fff;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .frame {
      position: absolute;
      inset: 8mm;
      border: 1px solid var(--line);
      border-radius: 4px;
      pointer-events: none;
    }
    .frame::before, .frame::after {
      content: "";
      position: absolute;
      width: 28px;
      height: 28px;
      border: 2px solid var(--gold);
    }
    .frame::before {
      top: -1px;
      ${rtl ? "right" : "left"}: -1px;
      border-${rtl ? "left" : "right"}: 0;
      border-bottom: 0;
    }
    .frame::after {
      bottom: -1px;
      ${rtl ? "left" : "right"}: -1px;
      border-${rtl ? "right" : "left"}: 0;
      border-top: 0;
    }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 16px;
      border-bottom: 2px solid var(--navy);
      position: relative;
      z-index: 1;
    }
    .brand { flex: 1; }
    .brand h1 {
      font-family: ${rtl ? "'Cairo', serif" : "'Cinzel', serif"};
      font-weight: 800;
      font-size: 26px;
      margin: 0 0 4px 0;
      color: var(--navy);
      letter-spacing: ${rtl ? "0" : "1px"};
    }
    .brand .sub {
      color: var(--gold-dark);
      font-weight: 700;
      font-size: 11px;
      margin-bottom: 6px;
    }
    .brand .info {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }

    .doc-stamp {
      text-align: ${rtl ? "left" : "right"};
      min-width: 180px;
    }
    .doc-stamp .t-title {
      font-size: 22px;
      font-weight: 800;
      color: var(--navy);
      letter-spacing: ${rtl ? "0" : "2px"};
      text-transform: uppercase;
    }
    .doc-stamp .line {
      width: 60px;
      height: 3px;
      background: linear-gradient(90deg, var(--gold), var(--gold-dark));
      margin: 6px 0;
      ${rtl ? "margin-right: auto;" : "margin-left: auto;"}
    }
    .doc-stamp .n-num {
      font-family: ui-monospace, monospace;
      font-weight: 700;
      font-size: 13px;
      color: var(--navy);
      background: var(--gold-light);
      padding: 3px 8px;
      border-radius: 4px;
      display: inline-block;
      margin-top: 2px;
      border: 1px solid rgba(197,155,39,.3);
    }
    .doc-stamp .d-date {
      color: var(--muted);
      font-size: 11px;
      margin-top: 4px;
    }

    .parties-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin: 18px 0;
    }
    .card {
      background: var(--bg-soft);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 14px;
      border-${rtl ? "right" : "left"}: 4px solid var(--gold);
    }
    .card .k {
      color: var(--gold-dark);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .5px;
      margin-bottom: 3px;
    }
    .card .v {
      font-size: 14px;
      font-weight: 700;
      color: var(--navy);
    }
    .card .sub-detail {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
    }

    table.items-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      box-shadow: 0 1px 3px rgba(0,0,0,.03);
    }
    table.items-table thead th {
      background: var(--navy);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 10px 12px;
      text-align: ${rtl ? "right" : "left"};
      border: none;
    }
    table.items-table thead th.c { text-align: center; }
    table.items-table thead th.num { text-align: ${rtl ? "left" : "right"}; }
    table.items-table tbody td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      font-size: 12px;
      vertical-align: middle;
    }
    table.items-table tbody tr:nth-child(even) {
      background: rgba(250,249,246,.5);
    }
    .p-name { font-weight: 700; color: var(--navy); }
    .p-code { font-size: 10px; color: var(--muted); margin-top: 2px; }
    .c { text-align: center; }
    .num { text-align: ${rtl ? "left" : "right"}; font-family: system-ui, sans-serif; }
    .bold { font-weight: 700; }
    .muted { color: var(--muted); }

    .bottom-section {
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 20px;
      margin-top: 20px;
      align-items: start;
    }
    @media print {
      .bottom-section { display: flex; justify-content: space-between; }
      .totals-box { width: 300px; }
    }
    
    .notes-box {
      border: 1px dashed var(--line);
      border-radius: 6px;
      padding: 12px;
      background: #fafafa;
    }
    .notes-box .n-title { font-weight: 700; font-size: 11px; color: var(--navy); margin-bottom: 4px; }
    .notes-box .n-body { color: var(--muted); font-size: 11px; line-height: 1.5; white-space: pre-line; }

    .totals-box {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px 16px;
      background: var(--gold-light);
    }
    .totals-box .r {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      color: var(--navy);
      font-size: 12px;
      border-bottom: 1px dotted rgba(0,0,0,.08);
    }
    .totals-box .r:last-child { border-bottom: none; }
    .totals-box .grand-total {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 2px solid var(--navy) !important;
      font-size: 16px;
      font-weight: 800;
      color: var(--navy);
    }
    .totals-box .grand-total span:last-child {
      color: var(--gold-dark);
    }

    .signatures {
      margin-top: 35px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      text-align: center;
    }
    .sig-line {
      border-top: 1.5px dashed var(--navy);
      padding-top: 6px;
      color: var(--navy);
      font-size: 11px;
      font-weight: 700;
    }

    footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
      text-align: center;
      color: var(--muted);
      font-size: 10.5px;
    }
    .branding-text {
      color: var(--gold-dark);
      font-weight: 700;
      margin-top: 4px;
      font-size: 10px;
    }

    @media screen {
      body { background: #e2e8f0; padding: 25px 0; }
      .page { box-shadow: 0 15px 35px rgba(0,0,0,.15); border-radius: 4px; }
    }
    @media print {
      body { background: #fff; }
      .page { box-shadow: none; padding: 12mm 10mm; }
      .frame { inset: 4mm; }
    }
  </style>
</head>
<body onload="setTimeout(()=>window.print(), 300)">
<div class="page">
  <div class="frame"></div>
  <div class="main-content">
    <header>
      <div class="brand">
        ${opts.showCompanyInfo && doc.company?.name ? `<h1>${esc(doc.company.name)}</h1>` : `<h1>${esc(doc.title)}</h1>`}
        ${opts.showBranding ? `<div class="sub">${esc(branding)}</div>` : ""}
        <div class="info">
          ${opts.showCompanyInfo && doc.company?.address ? `${esc(doc.company.address)}<br>` : ""}
          ${opts.showCompanyInfo && doc.company?.phone ? `${rtl ? "تلفون" : "Tel"}: ${esc(doc.company.phone)} ` : ""}
          ${opts.showCompanyInfo && doc.company?.vat ? `| ${rtl ? "الرقم الضريبي" : "VAT"}: ${esc(doc.company.vat)}` : ""}
        </div>
      </div>
      <div class="doc-stamp">
        <div class="t-title">${esc(doc.title)}</div>
        <div class="line"></div>
        ${opts.showDocNumberDate ? `
        <div class="n-num">#${esc(doc.number)}</div>
        <div class="d-date">${L.date}: ${esc(doc.date)}</div>
        ${doc.dueDate ? `<div class="d-date">${L.dueDate || (rtl ? "تاريخ الاستحقاق" : "Due Date")}: ${esc(doc.dueDate)}</div>` : ""}
        ` : ""}
      </div>
    </header>

    <div class="parties-grid">
      ${opts.showCustomerInfo && doc.partyName ? `
      <div class="card">
        <div class="k">${doc.partyLabel || L.billTo}</div>
        <div class="v">${esc(doc.partyName)}</div>
        ${doc.partyPhone ? `<div class="sub-detail">${rtl ? "هاتف" : "Phone"}: ${esc(doc.partyPhone)}</div>` : ""}
        ${doc.partyVat ? `<div class="sub-detail">${rtl ? "الرقم الضريبي" : "VAT"}: ${esc(doc.partyVat)}</div>` : ""}
      </div>` : ""}

      ${opts.showMovementInfo && doc.warehouse ? `
      <div class="card">
        <div class="k">${L.warehouse}</div>
        <div class="v">${esc(doc.warehouse)}</div>
        ${doc.destinationWarehouse ? `<div class="sub-detail">${rtl ? "إلى مستودع" : "To"}: ${esc(doc.destinationWarehouse)}</div>` : ""}
        ${doc.operatorName ? `<div class="sub-detail">${rtl ? "المسؤول" : "Operator"}: ${esc(doc.operatorName)}</div>` : ""}
      </div>` : ""}

      ${opts.showPaymentInfo ? `
      <div class="card">
        <div class="k">${L.payment} · ${L.status}</div>
        <div class="v">${esc(doc.payment ?? (rtl ? "نقداً" : "Cash"))}</div>
        <div class="sub-detail">${rtl ? "حالة المستند" : "Status"}: ${esc(doc.status ?? (rtl ? "مكتمل" : "Completed"))}</div>
      </div>` : ""}
    </div>

    <table class="items-table">
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
        ${rows || `<tr><td colspan="${numColumns}" class="c muted">${rtl ? "لا توجد عناصر" : "No items"}</td></tr>`}
      </tbody>
    </table>

    <div class="bottom-section">
      <div class="notes-box">
        ${opts.showNotes && doc.notes ? `
          <div class="n-title">${rtl ? "ملاحظات وتوجيهات" : "Notes & Instructions"}:</div>
          <div class="n-body">${esc(doc.notes)}</div>
        ` : `
          <div class="n-title">${L.thanks}</div>
          <div class="n-body">${rtl ? "يسعدنا دائماً تقديم أفضل الخدمات والحلول المتكاملة لكم." : "We appreciate your business."}</div>
        `}
      </div>

      ${opts.showFinancialDetails ? `
      <div class="totals-box">
        <div class="r"><span>${L.subtotal}</span><span>${money(doc.subtotal)}</span></div>
        ${doc.discount ? `<div class="r"><span>${L.discount}</span><span>${money(doc.discount)}</span></div>` : ""}
        ${doc.tax ? `<div class="r"><span>${L.tax}</span><span>${money(doc.tax)}</span></div>` : ""}
        <div class="r grand-total"><span>${L.grandTotal}</span><span>${money(doc.total)}</span></div>
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
    <div class="signatures">
      <div>
        <div style="height: 35px"></div>
        <div class="sig-line">${rtl ? "توقيع المستلم" : "Recipient Signature"}</div>
      </div>
      <div>
        <div style="height: 35px"></div>
        <div class="sig-line">${rtl ? "توقيع المبيعات / المحاسب" : "Authorized Signature"}</div>
      </div>
      <div>
        <div style="height: 35px"></div>
        <div class="sig-line">${rtl ? "ختم المؤسسة / الشركة" : "Official Stamp"}</div>
      </div>
    </div>` : ""}
  </div>

  ${opts.showFooter ? `
  <footer>
    <div>${L.thanks}</div>
    ${opts.showBranding ? `<div class="branding-text">${esc(branding)}</div>` : ""}
  </footer>` : ""}
</div>
</body>
</html>`;
}
