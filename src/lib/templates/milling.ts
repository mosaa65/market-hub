import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  formatMoney,
  CustomFieldOptions,
} from "./types";

/**
 * Milling Master Template (A4 / A5 Luxury Format)
 * Designed for Milling Operations & Commercial Receipts with elegant hairline dividers
 * and Inama Soft footer attribution.
 */
export function renderMillingMasterTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions,
): string {
  const c = doc.currency ?? "ر.ي";
  const esc = escapeHtml;
  const money = (n?: number) => formatMoney(n, c);
  const opts = {
    showLogo: true,
    showCompanyInfo: true,
    showCustomerInfo: true,
    showDocNumberDate: true,
    showFinancialDetails: true,
    showPaymentInfo: true,
    showNotes: true,
    showSignatures: true,
    showFooter: true,
    ...options,
    ...doc.options,
  };

  const title = esc(doc.title || "فاتورة وسند طحن وتسليم");
  const compName = esc(doc.company?.name || "المطحنة الحديثة");
  const compAddress = esc(doc.company?.address || "المركز الرئيسي");
  const compPhone = esc(doc.company?.phone || "");

  // Build table lines or item rows with hairline dividers
  const hasLines = doc.lines && doc.lines.length > 0;
  const lineRowsHtml = hasLines
    ? doc.lines
        .map(
          (l, i) => `
        <tr style="${i < doc.lines.length - 1 ? 'border-bottom: 1px solid rgba(0, 0, 0, 0.08);' : ''}">
          <td style="padding: 10px 8px; font-weight: bold; color: #0f172a;">${esc(l.product)}</td>
          <td style="padding: 10px 8px; color: #475569;">${esc(l.note || l.unit || "—")}</td>
          <td style="padding: 10px 8px; text-align: center; font-weight: 600; color: #0f172a;">${l.qty} ${esc(l.unit || "")}</td>
          <td style="padding: 10px 8px; text-align: left; font-weight: 600; color: #0f172a;">${money(l.price)}</td>
          <td style="padding: 10px 8px; text-align: left; font-weight: bold; color: #0f172a;">${money(l.total)}</td>
        </tr>`,
        )
        .join("")
    : "";

  return `<!DOCTYPE html>
<html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${esc(doc.number)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #1e293b;
      background: #fff;
      margin: 0;
      padding: 16px;
    }
    .milling-card {
      max-width: 800px;
      margin: 0 auto;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 18px;
    }
    .company-title { font-size: 22px; font-weight: 800; color: #0f172a; margin: 0; }
    .company-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
    .doc-badge {
      text-align: left;
    }
    .doc-badge h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 700;
      color: #d97706;
    }
    .doc-badge .doc-num {
      font-family: monospace;
      font-weight: 700;
      font-size: 14px;
      margin-top: 4px;
      color: #0f172a;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }
    .meta-label { font-size: 11px; color: #64748b; font-weight: 500; }
    .meta-val { font-size: 13px; color: #0f172a; font-weight: 700; }
    
    .hairline-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    .hairline-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: right;
      padding: 10px 8px;
      font-size: 12px;
      border-bottom: 1px solid #cbd5e1;
    }
    .hairline-table td {
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    }

    .milling-details-box {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    .hairline-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    }
    .hairline-row:last-child {
      border-bottom: none;
    }
    .hairline-row-label { color: #475569; font-weight: 500; }
    .hairline-row-val { font-weight: 700; color: #0f172a; }

    .totals-wrapper {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .totals-box {
      width: 280px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 16px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      font-size: 13px;
    }
    .totals-row.grand {
      border-bottom: 2px solid #0f172a;
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
      padding-top: 8px;
    }

    .sig-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px dashed #cbd5e1;
      text-align: center;
      color: #64748b;
    }
    .sig-line {
      border-bottom: 1px dashed #94a3b8;
      width: 180px;
      margin: 28px auto 0;
    }

    .inama-footer {
      margin-top: 30px;
      padding-top: 12px;
      border-top: 1px solid rgba(0, 0, 0, 0.1);
      text-align: center;
      font-size: 11px;
      color: #475569;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-weight: 600;
    }
    .inama-badge {
      display: inline-block;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 99px;
      padding: 3px 12px;
      color: #0f172a;
    }

    @media print {
      body { padding: 0; }
      .milling-card { border: none; box-shadow: none; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="milling-card">
    <div class="header-bar">
      <div>
        <h1 class="company-title">${compName}</h1>
        ${compAddress ? `<div class="company-sub">${compAddress}</div>` : ""}
        ${compPhone ? `<div class="company-sub">هاتف: ${compPhone}</div>` : ""}
      </div>
      <div class="doc-badge">
        <h2>${title}</h2>
        <div class="doc-num">#${esc(doc.number)}</div>
        <div class="company-sub" style="margin-top: 4px;">التاريخ: ${esc(doc.date)}</div>
      </div>
    </div>

    ${
      opts.showCustomerInfo && doc.partyName
        ? `
    <div class="meta-box">
      <div class="meta-item">
        <span class="meta-label">العميل:</span>
        <span class="meta-val">${esc(doc.partyName)}</span>
      </div>
      ${
        doc.partyPhone
          ? `
      <div class="meta-item">
        <span class="meta-label">الهاتف:</span>
        <span class="meta-val">${esc(doc.partyPhone)}</span>
      </div>`
          : ""
      }
      ${
        doc.payment
          ? `
      <div class="meta-item">
        <span class="meta-label">طريقة الدفع:</span>
        <span class="meta-val">${esc(doc.payment)}</span>
      </div>`
          : ""
      }
      ${
        doc.warehouse
          ? `
      <div class="meta-item">
        <span class="meta-label">المستودع/الصالة:</span>
        <span class="meta-val">${esc(doc.warehouse)}</span>
      </div>`
          : ""
      }
    </div>`
        : ""
    }

    ${
      hasLines
        ? `
    <table class="hairline-table">
      <thead>
        <tr>
          <th>الصنف / نوع الحبوب</th>
          <th>درجة الطحن / البيان</th>
          <th style="text-align: center;">الكمية / الأكياس</th>
          <th style="text-align: left;">السعر</th>
          <th style="text-align: left;">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${lineRowsHtml}
      </tbody>
    </table>`
        : `
    <div class="milling-details-box">
      <div class="hairline-row">
        <span class="hairline-row-label">نوع الحركة:</span>
        <span class="hairline-row-val">${esc(doc.movementType || "طحن فوري")}</span>
      </div>
      <div class="hairline-row">
        <span class="hairline-row-label">إجمالي العمليات:</span>
        <span class="hairline-row-val">${money(doc.total)}</span>
      </div>
    </div>`
    }

    ${
      opts.showFinancialDetails
        ? `
    <div class="totals-wrapper">
      <div class="totals-box">
        <div class="totals-row">
          <span>المجموع الفرعي:</span>
          <span>${money(doc.subtotal || doc.total)}</span>
        </div>
        ${
          (doc.discount || 0) > 0
            ? `
        <div class="totals-row" style="color: #16a34a;">
          <span>الخصم:</span>
          <span>-${money(doc.discount)}</span>
        </div>`
            : ""
        }
        <div class="totals-row grand">
          <span>الإجمالي النهائي:</span>
          <span>${money(doc.total)}</span>
        </div>
        ${
          doc.paid !== undefined
            ? `
        <div class="totals-row" style="color: #0284c7; font-weight: 600;">
          <span>المدفوع:</span>
          <span>${money(doc.paid)}</span>
        </div>`
            : ""
        }
        ${
          (doc.balance || 0) > 0
            ? `
        <div class="totals-row" style="color: #dc2626; font-weight: bold;">
          <span>المتبقي:</span>
          <span>${money(doc.balance)}</span>
        </div>`
            : ""
        }
      </div>
    </div>`
        : ""
    }

    ${
      doc.notes
        ? `
    <div style="margin-top: 16px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; font-size: 12px; color: #92400e;">
      <strong>ملاحظات:</strong> ${esc(doc.notes)}
    </div>`
        : ""
    }

    ${
      opts.showSignatures
        ? `
    <div class="sig-section">
      <div>
        <p style="margin: 0; font-weight: 600;">توقيع العميل / المستلم</p>
        <div class="sig-line"></div>
      </div>
      <div>
        <p style="margin: 0; font-weight: 600;">توقيع مشرف صالة المطحنة</p>
        <div class="sig-line"></div>
      </div>
    </div>`
        : ""
    }

    ${
      opts.showFooter
        ? `
    <div class="inama-footer">
      <span class="inama-badge">عمل بواسطة شركة إنما سوفت - هاتف: 772217218</span>
    </div>`
        : ""
    }
  </div>
</body>
</html>`;
}

/**
 * Milling Thermal Template (POS 80mm / 58mm Format)
 * Elegant thermal receipt with clear hairline borders between rows and Inama Soft footer.
 */
export function renderMillingThermalTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions,
): string {
  const c = doc.currency ?? "ر.ي";
  const esc = escapeHtml;
  const money = (n?: number) => formatMoney(n, c);
  const opts = {
    showCompanyInfo: true,
    showCustomerInfo: true,
    showDocNumberDate: true,
    showFinancialDetails: true,
    showFooter: true,
    ...options,
    ...doc.options,
  };

  const compName = esc(doc.company?.name || "المطحنة الحديثة");
  const compAddress = esc(doc.company?.address || "المركز الرئيسي");
  const compPhone = esc(doc.company?.phone || "");
  const title = esc(doc.title || "إيصال طحن فوري");

  const linesHtml = doc.lines
    ? doc.lines
        .map(
          (l, idx) => `
      <div class="hairline-row" style="${idx < doc.lines.length - 1 ? 'border-bottom: 1px solid rgba(0, 0, 0, 0.08);' : ''}">
        <div style="font-weight: 700; font-size: 12px; color: #000;">${esc(l.product)}</div>
        <div style="display:flex; justify-content:space-between; font-size: 11px; margin-top: 2px;">
          <span>${l.qty} ${esc(l.unit || "")} × ${money(l.price)}</span>
          <span style="font-weight:700;">${money(l.total)}</span>
        </div>
        ${l.note ? `<div style="font-size: 10px; color: #555;">${esc(l.note)}</div>` : ""}
      </div>`,
        )
        .join("")
    : "";

  return `<!DOCTYPE html>
<html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${esc(doc.number)}</title>
  <style>
    @page { size: var(--print-paper-width, 80mm) auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      width: var(--print-paper-width, 80mm);
      margin: 0 auto;
      padding: 8px 6px;
      font-size: 12px;
      color: #000;
      background: #fff;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .hairline-divider {
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      margin: 6px 0;
    }
    .hairline-row {
      padding: 4px 0;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    }
    .flex-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 3px 0;
    }
    .badge {
      display: inline-block;
      border: 1px solid #000;
      padding: 2px 8px;
      border-radius: 99px;
      font-weight: bold;
      font-size: 11px;
      margin: 4px 0;
    }
    .box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 6px 8px;
      margin: 6px 0;
    }
    .inama-footer {
      text-align: center;
      font-size: 9.5px;
      font-weight: 700;
      color: #333;
      margin-top: 10px;
      padding-top: 6px;
      border-top: 1px solid rgba(0, 0, 0, 0.12);
    }
  </style>
</head>
<body onload="window.print()">
  <div class="center">
    ${opts.showCompanyInfo ? `<div style="font-size: 16px; font-weight: 900;">${compName}</div>` : ""}
    ${opts.showCompanyInfo && compAddress ? `<div>${compAddress}</div>` : ""}
    ${opts.showCompanyInfo && compPhone ? `<div>هاتف: ${compPhone}</div>` : ""}
    <div class="badge">${title}</div>
  </div>

  <div class="hairline-divider"></div>

  ${
    opts.showDocNumberDate
      ? `
  <div class="flex-row"><span>رقم المستند:</span><span class="bold">#${esc(doc.number)}</span></div>
  <div class="flex-row"><span>التاريخ:</span><span>${esc(doc.date)}</span></div>`
      : ""
  }

  ${
    opts.showCustomerInfo && doc.partyName
      ? `
  <div class="flex-row"><span>العميل:</span><span class="bold">${esc(doc.partyName)}</span></div>
  ${doc.partyPhone ? `<div class="flex-row"><span>الهاتف:</span><span>${esc(doc.partyPhone)}</span></div>` : ""}`
      : ""
  }

  <div class="hairline-divider"></div>

  ${
    doc.lines && doc.lines.length > 0
      ? `<div class="box">${linesHtml}</div>`
      : `
  <div class="box">
    <div class="flex-row"><span>بيان العملية:</span><span class="bold">${esc(doc.title)}</span></div>
    <div class="flex-row"><span>المبلغ:</span><span class="bold">${money(doc.total)}</span></div>
  </div>`
  }

  <div class="hairline-divider"></div>

  ${
    opts.showFinancialDetails
      ? `
  <div class="flex-row"><span>المجموع:</span><span>${money(doc.subtotal || doc.total)}</span></div>
  ${(doc.discount || 0) > 0 ? `<div class="flex-row"><span>الخصم:</span><span>-${money(doc.discount)}</span></div>` : ""}
  <div class="hairline-divider"></div>
  <div class="flex-row" style="font-size: 14px; font-weight: 900;"><span>الإجمالي النهائي:</span><span>${money(doc.total)}</span></div>
  ${doc.paid !== undefined ? `<div class="flex-row"><span>المدفوع:</span><span class="bold">${money(doc.paid)}</span></div>` : ""}
  ${(doc.balance || 0) > 0 ? `<div class="flex-row" style="color: red; font-weight: bold;"><span>المتبقي:</span><span>${money(doc.balance)}</span></div>` : ""}`
      : ""
  }

  ${
    opts.showFooter
      ? `
  <div class="inama-footer">
    عمل بواسطة شركة إنما سوفت - 772217218
  </div>`
      : ""
  }
</body>
</html>`;
}
