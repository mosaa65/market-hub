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

  const companyName = doc.company?.name || "مؤسسة فورتكس للتجارة والمحركات";
  const companyAddress = doc.company?.address || "صنعاء - اليمن";
  const companyPhone = doc.company?.phone || "772217218 / 734567-01";
  const companyVat = doc.company?.vat || "1009826764";

  const rows = doc.lines
    .map((l, i) => {
      const itemPrice = l.price ?? 0;
      const itemTotal = l.total ?? l.qty * itemPrice;
      return `
    <tr>
      <td class="col-num">${i + 1}</td>
      <td class="col-desc">
        <div class="p-title">${esc(l.product)}</div>
        ${l.code ? `<div class="p-code">${rtl ? "كود" : "SKU"}: ${esc(l.code)}</div>` : ""}
      </td>
      <td class="col-qty">${l.qty} ${l.unit ? esc(l.unit) : (rtl ? "حبة" : "")}</td>
      <td class="col-price">${money(itemPrice)}</td>
      <td class="col-total">${money(itemTotal)}</td>
    </tr>`;
    })
    .join("");

  const numColumns = 5;

  return `<!doctype html>
<html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8">
  <title>${esc(doc.title || (rtl ? "فاتورة مبيعات" : "Sales Invoice"))} - #${esc(doc.number)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    
    :root {
      --blue-primary: #1d4ed8;
      --blue-dark: #0f2942;
      --blue-light: #f0f6ff;
      --blue-border: #cbd5e1;
      --blue-accent-bg: #eef4fc;
      --text-main: #0f172a;
      --text-muted: #475569;
      --bg-page: #ffffff;
    }

    html, body {
      margin: 0; padding: 0;
      background: #f1f5f9;
      color: var(--text-main);
      font-family: 'Cairo', 'Tajawal', system-ui, sans-serif;
      font-size: 12px;
      direction: ${rtl ? "rtl" : "ltr"};
      text-align: ${rtl ? "right" : "left"};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page-container {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: var(--bg-page);
      position: relative;
      padding: 14mm 16mm 14mm 16mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
    }

    /* Top Corner Graphic Accent */
    .top-blue-corner-accent {
      position: absolute;
      top: 0;
      ${rtl ? "right: 0;" : "left: 0;"}
      width: 180px;
      height: 120px;
      pointer-events: none;
      z-index: 1;
      opacity: 0.85;
    }

    /* Header Structure */
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      position: relative;
      z-index: 3;
      padding-bottom: 12px;
      border-bottom: 1px solid #e2e8f0;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-badge {
      width: 46px;
      height: 46px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--blue-dark), var(--blue-primary));
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      box-shadow: 0 4px 10px rgba(29, 78, 216, 0.25);
    }

    .company-title-group h1 {
      font-size: 20px;
      font-weight: 800;
      color: var(--blue-dark);
      margin: 0 0 2px 0;
      letter-spacing: -0.2px;
    }
    .company-title-group .brand-sub {
      color: var(--blue-primary);
      font-size: 10px;
      font-weight: 700;
    }

    .company-contacts {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 10.5px;
      color: var(--text-muted);
      text-align: ${rtl ? "left" : "right"};
    }
    .contact-item {
      display: flex;
      align-items: center;
      gap: 6px;
      justify-content: ${rtl ? "flex-end" : "flex-start"};
    }
    .contact-item svg {
      color: var(--blue-primary);
      flex-shrink: 0;
    }

    /* Banner / Title & Number Badge */
    .invoice-title-banner {
      position: relative;
      z-index: 3;
      margin: 12px 0 16px 0;
      background: var(--blue-light);
      border: 1px solid #dbeafe;
      border-radius: 12px;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .inv-heading-title {
      font-size: 20px;
      font-weight: 900;
      color: var(--blue-dark);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .inv-number-badge {
      background: var(--blue-primary);
      color: #ffffff;
      font-family: ui-monospace, 'Courier New', monospace;
      font-weight: 800;
      font-size: 13.5px;
      padding: 5px 14px;
      border-radius: 20px;
      letter-spacing: 0.5px;
      box-shadow: 0 2px 6px rgba(29, 78, 216, 0.3);
    }

    .inv-date-tag {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: var(--text-muted);
      font-weight: 700;
    }

    /* 3 Info Cards Grid */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      position: relative;
      z-index: 3;
      margin-bottom: 16px;
    }

    .info-card {
      background: var(--blue-accent-bg);
      border: 1px solid #dbeafe;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .card-icon-circle {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #dbeafe;
      color: var(--blue-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .card-body-content {
      flex: 1;
      min-width: 0;
    }

    .card-label {
      font-size: 9.5px;
      font-weight: 800;
      color: var(--blue-primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    .card-value {
      font-size: 12.5px;
      font-weight: 800;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card-subtext {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* Product Table */
    .table-container {
      position: relative;
      z-index: 3;
      border: 1px solid var(--blue-border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 16px;
      background: #fff;
    }

    table.items-table {
      width: 100%;
      border-collapse: collapse;
    }

    table.items-table thead tr {
      background: var(--blue-dark);
      color: #ffffff;
    }

    table.items-table thead th {
      padding: 10px 12px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.3px;
      border: none;
    }

    .col-num { width: 40px; text-align: center; }
    .col-desc { text-align: ${rtl ? "right" : "left"}; }
    .col-qty { width: 85px; text-align: center; }
    .col-price { width: 110px; text-align: ${rtl ? "left" : "right"}; }
    .col-total { width: 120px; text-align: ${rtl ? "left" : "right"}; font-weight: 800; }

    table.items-table tbody td {
      padding: 9px 12px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 11.5px;
      vertical-align: middle;
    }

    table.items-table tbody tr:nth-child(even) {
      background: #f8fafc;
    }

    table.items-table tbody tr:last-child td {
      border-bottom: none;
    }

    .p-title { font-weight: 700; color: var(--text-main); }
    .p-code { font-size: 9.5px; color: var(--text-muted); margin-top: 1px; }

    /* Bottom Section: Notes & Totals */
    .bottom-grid {
      display: grid;
      grid-template-columns: 1fr 310px;
      gap: 14px;
      position: relative;
      z-index: 3;
      margin-bottom: 16px;
      align-items: start;
    }

    .notes-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      height: 100%;
    }

    .notes-header-title {
      font-size: 11px;
      font-weight: 800;
      color: var(--blue-primary);
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .notes-body-text {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.6;
      white-space: pre-line;
    }

    .totals-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      color: var(--text-main);
      padding: 3px 0;
    }

    .totals-row.discount-row {
      color: #dc2626;
    }

    .grand-total-banner {
      background: linear-gradient(135deg, var(--blue-primary), #1e40af);
      color: #ffffff;
      border-radius: 8px;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 4px;
      box-shadow: 0 3px 8px rgba(29, 78, 216, 0.25);
    }

    .grand-total-banner .gt-label {
      font-size: 13px;
      font-weight: 900;
    }

    .grand-total-banner .gt-amount {
      font-size: 16px;
      font-weight: 900;
      font-family: system-ui, sans-serif;
    }

    /* Signatures Block */
    .signatures-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      position: relative;
      z-index: 3;
      margin-top: 10px;
      margin-bottom: 12px;
      padding: 0 30px;
    }

    .sig-box {
      text-align: center;
    }

    .sig-graphic {
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--blue-primary);
      opacity: 0.85;
    }

    .sig-title-line {
      border-top: 1.5px dashed var(--blue-primary);
      padding-top: 6px;
      font-size: 11px;
      font-weight: 800;
      color: var(--text-main);
    }

    /* Footer Banner / Wave */
    footer {
      position: relative;
      z-index: 3;
      text-align: center;
    }

    .footer-banner-container {
      background: var(--blue-dark);
      color: #ffffff;
      border-radius: 8px;
      padding: 10px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      position: relative;
      overflow: hidden;
    }

    .footer-company-name {
      font-weight: 800;
      font-size: 11.5px;
      color: #ffffff;
    }

    .footer-branding-line {
      font-size: 10px;
      font-weight: 600;
      color: #93c5fd;
    }

    @media screen {
      .page-container {
        box-shadow: 0 12px 40px rgba(0,0,0,0.1);
        border-radius: 8px;
        margin: 20px auto;
      }
    }

    @media print {
      body { background: #fff; }
      .page-container {
        box-shadow: none;
        padding: 10mm 12mm;
        width: 100%;
        min-height: 100vh;
      }
    }
  </style>
</head>
<body onload="setTimeout(()=>window.print(), 300)">

<div class="page-container">
  <!-- Top Blue Accent Decorative SVG -->
  <svg class="top-blue-corner-accent" viewBox="0 0 180 120" fill="none">
    <path d="M0 0 H180 V40 L100 120 H0 Z" fill="url(#blue-top-grad)" opacity="0.15"/>
    <defs>
      <linearGradient id="blue-top-grad" x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#1d4ed8" />
        <stop offset="100%" stop-color="#0f2942" />
      </linearGradient>
    </defs>
  </svg>

  <!-- Content Wrapper -->
  <div>
    <!-- Top Header -->
    <header>
      <div class="brand-section">
        ${opts.showLogo ? `
        <div class="logo-badge">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>
            <circle cx="7" cy="17" r="2"/>
            <path d="M9 17h6"/>
            <circle cx="17" cy="17" r="2"/>
          </svg>
        </div>` : ""}
        <div class="company-title-group">
          <h1>${esc(companyName)}</h1>
          ${opts.showBranding ? `<div class="brand-sub">${esc(branding)}</div>` : ""}
        </div>
      </div>

      ${opts.showCompanyInfo ? `
      <div class="company-contacts">
        <div class="contact-item">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${esc(companyAddress)}</span>
        </div>
        <div class="contact-item">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <span>${esc(companyPhone)}</span>
        </div>
        ${companyVat ? `
        <div class="contact-item">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10M7 12h10M7 17h6"/></svg>
          <span>${rtl ? "الرقم الضريبي" : "Tax ID"}: ${esc(companyVat)}</span>
        </div>` : ""}
      </div>` : "<div></div>"}
    </header>

    <!-- Invoice Title & Date Banner -->
    <div class="invoice-title-banner">
      <h2 class="inv-heading-title">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        ${esc(doc.title || L.invoice)}
      </h2>

      ${opts.showDocNumberDate ? `
      <div class="inv-number-badge">#${esc(doc.number)}</div>

      <div class="inv-date-tag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>${L.date}: ${esc(doc.date)}</span>
      </div>` : ""}
    </div>

    <!-- 3 Info Cards Grid -->
    <div class="cards-grid">
      <!-- Card 1: Customer -->
      ${opts.showCustomerInfo && doc.partyName ? `
      <div class="info-card">
        <div class="card-icon-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="card-body-content">
          <div class="card-label">${doc.partyLabel || L.billTo}</div>
          <div class="card-value">${esc(doc.partyName)}</div>
          ${doc.partyVat ? `<div class="card-subtext">${rtl ? "الرقم الضريبي" : "VAT"}: ${esc(doc.partyVat)}</div>` : ""}
          ${doc.partyPhone ? `<div class="card-subtext">${rtl ? "هاتف" : "Tel"}: ${esc(doc.partyPhone)}</div>` : ""}
        </div>
      </div>` : `
      <div class="info-card">
        <div class="card-icon-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="card-body-content">
          <div class="card-label">${L.billTo}</div>
          <div class="card-value">${rtl ? "عميل عام" : "General Customer"}</div>
        </div>
      </div>`}

      <!-- Card 2: Warehouse -->
      ${opts.showMovementInfo ? `
      <div class="info-card">
        <div class="card-icon-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div class="card-body-content">
          <div class="card-label">${L.warehouse}</div>
          <div class="card-value">${esc(doc.warehouse || (rtl ? "المستودع الرئيسي" : "Main Warehouse"))}</div>
          ${doc.destinationWarehouse ? `<div class="card-subtext">${rtl ? "إلى" : "To"}: ${esc(doc.destinationWarehouse)}</div>` : ""}
        </div>
      </div>` : `<div></div>`}

      <!-- Card 3: Payment Method -->
      ${opts.showPaymentInfo ? `
      <div class="info-card">
        <div class="card-icon-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </div>
        <div class="card-body-content">
          <div class="card-label">${L.payment}</div>
          <div class="card-value">${esc(doc.payment || (rtl ? "نقداً (Cash)" : "Cash"))}</div>
          <div class="card-subtext">${L.status}: ${esc(doc.status || (rtl ? "مدفوعة" : "Paid"))}</div>
        </div>
      </div>` : `<div></div>`}
    </div>

    <!-- Items Table -->
    <div class="table-container">
      <table class="items-table">
        <thead>
          <tr>
            <th class="col-num">م</th>
            <th class="col-desc">${L.product}</th>
            <th class="col-qty">${L.qty}</th>
            <th class="col-price">${L.price}</th>
            <th class="col-total">${L.total}</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="${numColumns}" style="text-align:center; padding: 16px; color: var(--text-muted);">${rtl ? "لا توجد عناصر" : "No Items"}</td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- Bottom Section: Notes & Totals -->
    <div class="bottom-grid">
      <!-- Notes Box -->
      <div class="notes-card">
        ${opts.showNotes && doc.notes ? `
        <div class="notes-header-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          <span>${rtl ? "ملاحظات" : "Notes"}</span>
        </div>
        <div class="notes-body-text">${esc(doc.notes)}</div>
        ` : `
        <div class="notes-header-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          <span>${L.thanks}</span>
        </div>
        <div class="notes-body-text">${rtl ? "نشكركم على اختياركم ونتطلع دائماً لخدمتكم." : "We appreciate your business and look forward to serving you."}</div>
        `}
      </div>

      <!-- Financial Totals Box -->
      ${opts.showFinancialDetails ? `
      <div class="totals-card">
        <div class="totals-row">
          <span>${L.subtotal}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">${money(doc.subtotal)}</span>
        </div>

        ${doc.discount ? `
        <div class="totals-row discount-row">
          <span>${L.discount}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">- ${money(doc.discount)}</span>
        </div>` : ""}

        ${doc.tax ? `
        <div class="totals-row">
          <span>${L.tax}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">+ ${money(doc.tax)}</span>
        </div>` : ""}

        <!-- Grand Total Royal Blue Box -->
        <div class="grand-total-banner">
          <span class="gt-label">${L.grandTotal}</span>
          <span class="gt-amount">${money(doc.total)}</span>
        </div>

        ${doc.paid !== undefined ? `
        <div class="totals-row" style="margin-top: 4px;">
          <span>${L.paid}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">${money(doc.paid)}</span>
        </div>
        <div class="totals-row">
          <span>${L.balance}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">${money((doc.total ?? 0) - doc.paid)}</span>
        </div>` : ""}
      </div>` : "<div></div>"}
    </div>

    <!-- Signatures -->
    ${opts.showSignatures ? `
    <div class="signatures-row">
      <div class="sig-box">
        <div class="sig-graphic">
          <svg width="100" height="32" viewBox="0 0 160 45" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 32 C 30 10, 45 40, 70 20 C 85 8, 100 35, 125 15 C 140 5, 150 25, 155 35" />
            <path d="M40 25 Q 70 5, 95 38" />
          </svg>
        </div>
        <div class="sig-title-line">${rtl ? "توقيع المستلم" : "Recipient Signature"}</div>
      </div>

      <div class="sig-box">
        <div class="sig-graphic">
          <svg width="100" height="32" viewBox="0 0 160 45" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 20 Q 35 5, 60 30 T 110 15 T 145 28" />
            <path d="M30 35 C 50 15, 80 40, 130 10" />
          </svg>
        </div>
        <div class="sig-title-line">${rtl ? "توقيع المدير / المخزن" : "Manager / Warehouse Signature"}</div>
      </div>
    </div>` : ""}
  </div>

  <!-- Footer Banner Block -->
  ${opts.showFooter ? `
  <footer>
    <div class="footer-banner-container">
      <div class="footer-company-name">${esc(companyName)}</div>
      ${opts.showBranding ? `<div class="footer-branding-line">${esc(branding)}</div>` : ""}
    </div>
  </footer>` : ""}
</div>

</body>
</html>`;
}
