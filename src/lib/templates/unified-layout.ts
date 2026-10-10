/**
 * Unified Modern Layout — القالب الموحد لكل المستندات.
 *
 * المبدأ المعماري:
 *   نفس HTML structure + نفس Data Mapping + نفس Header + نفس جدول البنود +
 *   نفس الإجماليات + نفس Footer + نفس التوقيعات.
 *   الاختلاف الوحيد بين الأنماط هو الألوان والحدود والخلفيات والكثافة — وهذا
 *   يُدار عبر `PrintTheme` (standard / luxury / formal) وليس بقالب HTML منفصل.
 *
 * `renderStandardTemplate` و`renderElegantTemplate` أصبحا واجهتين رفيعتين
 * تستدعيان هذه الدالة بنفس التركيب وtheme مختلف — لا تكرار HTML.
 *
 * البيانات تُترجم من `UnifiedDocumentData` فقط؛ هذا الملف لا يستعلم عن أي شيء
 * ولا يعيد حساب أي رقم.
 */

import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  formatMoney,
  DEFAULT_COMPANY_LOGO,
  getCompanyLogo,
  CustomFieldOptions,
} from "./types";
import { numberToArabicWords } from "./tafqeet";
import { PRINT_THEMES, type PrintTheme } from "@/lib/printing/themes";
import { renderUniversalFooter, UNIVERSAL_FOOTER_CSS } from "@/lib/printing/footer";
import { getCachedCompanyProfile, type CompanyProfile } from "@/lib/printing/company-profile";
import { generateBarcodeSvg, generateQrCodeSvg } from "@/lib/printing/barcode-qr";

export interface UnifiedLayoutOptions extends CustomFieldOptions {
  /** نمط المستند — يغيّر الألوان والحدود فقط. */
  theme?: PrintTheme;
  /** بيانات الشركة؛ إن لم تُمرَّر تُقرأ من كاش Company Profile. */
  company?: CompanyProfile;
}

function themeCss(theme: PrintTheme, rtl: boolean): string {
  const t = PRINT_THEMES[theme];
  const border = theme === "luxury" ? `1px solid ${t.line}` : `1px solid ${t.line}`;
  return `
    :root {
      --print-accent: ${t.accent};
      --print-accent-soft: ${t.accentSoft};
      --print-ink: ${t.ink};
      --print-muted: ${t.muted};
      --print-line: ${t.line};
      --print-surface: ${t.surface};
      --print-radius: ${t.radius};
    }
    html, body {
      margin: 0; padding: 0;
      background: ${t.surface};
      color: var(--print-ink);
      font-family: 'Cairo', 'Tajawal', system-ui, sans-serif;
      font-size: 12px;
      direction: ${rtl ? "rtl" : "ltr"};
      text-align: ${rtl ? "right" : "left"};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page-container {
      width: 210mm; min-height: 297mm; margin: 0 auto;
      background: #fff; position: relative;
      padding: 14mm 16mm;
      display: flex; flex-direction: column; justify-content: space-between;
      overflow: hidden;
    }
    header {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 16px; padding-bottom: 12px; border-bottom: ${border};
    }
    .brand-section { display: flex; align-items: center; gap: 12px; }
    .logo-container {
      width: 48px; height: 48px; border-radius: var(--print-radius);
      background: var(--print-accent-soft); border: ${border};
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; padding: 3px;
    }
    .company-logo-img { width: 100%; height: 100%; object-fit: contain; }
    .company-title-group h1 { font-size: 20px; font-weight: 800; color: var(--print-ink); margin: 0; }
    .company-title-group .brand-sub { color: var(--print-accent); font-size: 10px; font-weight: 700; }
    .company-contacts {
      display: flex; flex-direction: column; gap: 4px;
      font-size: 10.5px; color: var(--print-muted);
      text-align: ${rtl ? "left" : "right"};
    }
    .contact-item { display: flex; align-items: center; gap: 6px; }
    .contact-item svg { color: var(--print-accent); flex-shrink: 0; }
    .invoice-title-banner {
      margin: 12px 0 16px; background: var(--print-accent-soft);
      border: ${border}; border-radius: var(--print-radius);
      padding: 12px 18px;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
    }
    .inv-heading-title {
      font-size: 20px; font-weight: 900; color: var(--print-ink); margin: 0;
      display: flex; align-items: center; gap: 8px;
    }
    .inv-number-badge {
      background: var(--print-accent); color: #fff;
      font-family: ui-monospace, 'Courier New', monospace;
      font-weight: 800; font-size: 13.5px; padding: 5px 14px; border-radius: 20px;
    }
    .inv-date-tag { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--print-muted); font-weight: 700; }
    .cards-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
    .info-card {
      background: var(--print-surface); border: ${border};
      border-radius: var(--print-radius); padding: 10px 12px;
      display: flex; align-items: flex-start; gap: 10px;
    }
    .card-icon-circle {
      width: 32px; height: 32px; border-radius: var(--print-radius);
      background: var(--print-accent-soft); color: var(--print-accent);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .card-body-content { flex: 1; min-width: 0; }
    .card-label { font-size: 9.5px; font-weight: 800; color: var(--print-accent); margin-bottom: 2px; }
    .card-value { font-size: 12.5px; font-weight: 800; color: var(--print-ink); overflow: hidden; text-overflow: ellipsis; }
    .card-subtext { font-size: 10px; color: var(--print-muted); margin-top: 2px; }
    .table-container { border: ${border}; border-radius: var(--print-radius); overflow: hidden; margin-bottom: 16px; background: #fff; }
    table.items-table { width: 100%; border-collapse: collapse; }
    table.items-table thead tr { background: var(--print-accent); color: #fff; }
    table.items-table thead th { padding: 10px 12px; font-size: 11px; font-weight: 800; border: none; }
    .col-num { width: 40px; text-align: center; }
    .col-desc { text-align: ${rtl ? "right" : "left"}; }
    .col-qty { width: 85px; text-align: center; }
    .col-price { width: 110px; text-align: ${rtl ? "left" : "right"}; }
    .col-total { width: 120px; text-align: ${rtl ? "left" : "right"}; font-weight: 800; }
    table.items-table tbody td { padding: 9px 12px; border-bottom: 1px solid var(--print-line); font-size: 11.5px; vertical-align: middle; }
    table.items-table tbody tr:nth-child(even) { background: var(--print-surface); }
    table.items-table tbody tr { break-inside: avoid; }
    .p-title { font-weight: 700; color: var(--print-ink); }
    .p-code { font-size: 9.5px; color: var(--print-muted); margin-top: 1px; }
    .bottom-grid { display: grid; grid-template-columns: 1fr 310px; gap: 14px; margin-bottom: 16px; align-items: start; }
    .notes-card { background: var(--print-surface); border: ${border}; border-radius: var(--print-radius); padding: 12px 14px; height: 100%; }
    .tafqeet-banner {
      background: var(--print-accent-soft); border: ${border};
      border-radius: var(--print-radius); padding: 8px 12px; margin-bottom: 10px;
      font-size: 11px; font-weight: 700; color: var(--print-accent);
      display: flex; align-items: center; gap: 6px;
    }
    .notes-header-title { font-size: 11px; font-weight: 800; color: var(--print-accent); display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .notes-body-text { font-size: 11px; color: var(--print-muted); line-height: 1.6; white-space: pre-line; }
    .totals-card { background: var(--print-surface); border: ${border}; border-radius: var(--print-radius); padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
    .totals-row { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--print-ink); padding: 3px 0; }
    .totals-row.discount-row { color: #b91c1c; }
    .grand-total-banner {
      background: var(--print-accent); color: #fff;
      border-radius: var(--print-radius); padding: 10px 14px;
      display: flex; justify-content: space-between; align-items: center; margin-top: 4px;
    }
    .grand-total-banner .gt-label { font-size: 13px; font-weight: 900; }
    .grand-total-banner .gt-amount { font-size: 16px; font-weight: 900; font-family: system-ui, sans-serif; }
    .signatures-row { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin: 10px 0 12px; padding: 0 30px; }
    .sig-box { text-align: center; }
    .sig-graphic { height: 38px; display: flex; align-items: center; justify-content: center; color: var(--print-accent); opacity: 0.85; }
    .sig-title-line { border-top: 1.5px dashed var(--print-accent); padding-top: 6px; font-size: 11px; font-weight: 800; color: var(--print-ink); }
    .doc-footer { margin-top: auto; }
    @media screen {
      .page-container { box-shadow: 0 12px 40px rgba(0,0,0,0.1); border-radius: 8px; margin: 20px auto; }
    }
    @media print {
      body { background: #fff; }
      .page-container { box-shadow: none; padding: 10mm 12mm; width: 100%; min-height: 100vh; }
      tr, .info-card, .totals-card, .notes-card, .sig-box { break-inside: avoid; }
    }
    ${UNIVERSAL_FOOTER_CSS}
  `;
}

/**
 * القالب الموحد — يستخدمه `standard` و`luxury` (وعبرهما `elegant` القديم).
 */
export function renderUnifiedLayout(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: UnifiedLayoutOptions,
): string {
  const theme: PrintTheme = options?.theme ?? "standard";
  const c = doc.currency ?? "";
  const esc = escapeHtml;
  const money = (n?: number) => formatMoney(n ?? 0, c);
  const logoUrl = getCompanyLogo(doc);
  const company = options?.company ?? getCachedCompanyProfile();

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
    showBarcode: true,
    showQrCode: true,
    ...options,
    ...doc.options,
  };
  // `doc.options` must not be able to re-enable a footer the caller disabled.
  if (options?.showFooter === false) opts.showFooter = false;

  const qrPayload = [
    `Seller: ${options?.company?.name || getCachedCompanyProfile().name}`,
    `Invoice: ${doc.number}`,
    `Date: ${doc.date}`,
    `Total: ${doc.total || 0} ${c}`,
  ].join("\n");

  const barcodeSvg = (opts.showBarcode !== false && doc.number) ? generateBarcodeSvg(doc.number, 32) : "";
  const qrSvg = (opts.showQrCode !== false) ? generateQrCodeSvg(qrPayload, 80) : "";

  // Company Profile is the single source of company data — never a constant.
  // The document may carry a snapshot, but the profile is authoritative when
  // the snapshot has no name of its own.
  const companyName = company.name || doc.company?.name || "";
  const companyAddress = company.address || doc.company?.address || "";
  const companyPhone = company.phone || company.contacts.join(" · ") || doc.company?.phone || "";
  const companyVat = company.taxNumber || doc.company?.vat || "";

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
      <td class="col-qty">${l.qty} ${l.unit ? esc(l.unit) : rtl ? "حبة" : ""}</td>
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
  <style>${themeCss(theme, rtl)}</style>
</head>
<body>

<div class="page-container">
  <div>
    <header>
      <div class="brand-section">
        ${
          opts.showLogo
            ? `
        <div class="logo-container">
          <img
            src="${esc(logoUrl)}"
            alt="${esc(companyName)}"
            class="company-logo-img"
            onerror="this.onerror=null; this.src='${DEFAULT_COMPANY_LOGO}';"
          />
        </div>`
            : ""
        }
        <div class="company-title-group">
          <h1>${esc(companyName)}</h1>
        </div>
      </div>

      ${
        opts.showCompanyInfo
          ? `
      <div class="company-contacts">
        ${
          companyAddress
            ? `<div class="contact-item">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${esc(companyAddress)}</span>
        </div>`
            : ""
        }
        ${
          companyPhone
            ? `<div class="contact-item">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <span dir="ltr">${esc(companyPhone)}</span>
        </div>`
            : ""
        }
        ${
          companyVat
            ? `<div class="contact-item">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10M7 12h10M7 17h6"/></svg>
          <span>${rtl ? "الرقم الضريبي" : "Tax ID"}: ${esc(companyVat)}</span>
        </div>`
            : ""
        }
      </div>`
          : "<div></div>"
      }
    </header>

    <div class="invoice-title-banner">
      <h2 class="inv-heading-title">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        ${esc(doc.title || L.invoice)}
      </h2>

      ${
        opts.showDocNumberDate
          ? `
      <div style="display: flex; align-items: center; gap: 10px;">
        ${qrSvg ? `<div style="display: flex; align-items: center; background: #fff; padding: 2px; border-radius: 4px;">${qrSvg}</div>` : ""}
        <div>
          <div class="inv-number-badge">#${esc(doc.number)}</div>
          ${barcodeSvg ? `<div style="margin-top: 3px; text-align: center;">${barcodeSvg}</div>` : ""}
        </div>
      </div>

      <div class="inv-date-tag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>${L.date}: ${esc(doc.date)}</span>
      </div>`
          : ""
      }
    </div>

    <div class="cards-grid">
      ${
        opts.showCustomerInfo && doc.partyName
          ? `
      <div class="info-card">
        <div class="card-icon-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="card-body-content">
          <div class="card-label">${esc(doc.partyLabel || L.billTo)}</div>
          <div class="card-value">${esc(doc.partyName)}</div>
          ${doc.partyVat ? `<div class="card-subtext">${rtl ? "الرقم الضريبي" : "VAT"}: ${esc(doc.partyVat)}</div>` : ""}
          ${doc.partyPhone ? `<div class="card-subtext">${rtl ? "هاتف" : "Tel"}: ${esc(doc.partyPhone)}</div>` : ""}
        </div>
      </div>`
          : `
      <div class="info-card">
        <div class="card-icon-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="card-body-content">
          <div class="card-label">${L.billTo}</div>
          <div class="card-value">${rtl ? "عميل عام" : "General Customer"}</div>
        </div>
      </div>`
      }

      ${
        opts.showMovementInfo
          ? `
      <div class="info-card">
        <div class="card-icon-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div class="card-body-content">
          <div class="card-label">${L.warehouse}</div>
          <div class="card-value">${esc(doc.warehouse || (rtl ? "المستودع الرئيسي" : "Main Warehouse"))}</div>
          ${doc.destinationWarehouse ? `<div class="card-subtext">${rtl ? "إلى" : "To"}: ${esc(doc.destinationWarehouse)}</div>` : ""}
        </div>
      </div>`
          : `<div></div>`
      }

      ${
        opts.showPaymentInfo
          ? `
      <div class="info-card">
        <div class="card-icon-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </div>
        <div class="card-body-content">
          <div class="card-label">${L.payment}</div>
          <div class="card-value">${esc(doc.payment || (rtl ? "نقداً (Cash)" : "Cash"))}</div>
          <div class="card-subtext">${L.status}: ${esc(doc.status || (rtl ? "مدفوعة" : "Paid"))}</div>
        </div>
      </div>`
          : `<div></div>`
      }
    </div>

    <div class="table-container">
      <table class="items-table">
        <thead>
          <tr>
            <th class="col-num">${rtl ? "م" : "#"}</th>
            <th class="col-desc">${L.product}</th>
            <th class="col-qty">${L.qty}</th>
            <th class="col-price">${L.price}</th>
            <th class="col-total">${L.total}</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="${numColumns}" style="text-align:center; padding: 16px; color: var(--print-muted);">${rtl ? "لا توجد عناصر" : "No Items"}</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="bottom-grid">
      <div class="notes-card">
        ${
          opts.showFinancialDetails
            ? `
        <div class="tafqeet-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M4 17v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/><rect width="20" height="10" x="2" y="7" rx="2"/><circle cx="12" cy="12" r="2"/></svg>
          <span><b>${rtl ? "المبلغ كتابةً" : "Amount in words"}:</b> ${esc(numberToArabicWords(doc.total ?? 0, doc.currency))}</span>
        </div>`
            : ""
        }

        ${
          opts.showNotes && doc.notes
            ? `
        <div class="notes-header-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          <span>${rtl ? "ملاحظات" : "Notes"}</span>
        </div>
        <div class="notes-body-text">${esc(doc.notes)}</div>
        `
            : `
        <div class="notes-header-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          <span>${L.thanks}</span>
        </div>
        <div class="notes-body-text">${rtl ? "نشكركم على اختياركم ونتطلع دائماً لخدمتكم." : "We appreciate your business and look forward to serving you."}</div>
        `
        }
      </div>

      ${
        opts.showFinancialDetails
          ? `
      <div class="totals-card">
        <div class="totals-row">
          <span>${L.subtotal}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">${money(doc.subtotal)}</span>
        </div>

        ${
          doc.discount
            ? `
        <div class="totals-row discount-row">
          <span>${L.discount}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">- ${money(doc.discount)}</span>
        </div>`
            : ""
        }

        ${
          doc.tax
            ? `
        <div class="totals-row">
          <span>${L.tax}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">+ ${money(doc.tax)}</span>
        </div>`
            : ""
        }

        <div class="grand-total-banner">
          <span class="gt-label">${L.grandTotal}</span>
          <span class="gt-amount">${money(doc.total)}</span>
        </div>

        ${
          doc.paid !== undefined
            ? `
        <div class="totals-row" style="margin-top: 4px;">
          <span>${L.paid}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">${money(doc.paid)}</span>
        </div>
        <div class="totals-row">
          <span>${L.balance}</span>
          <span style="font-family: system-ui, sans-serif; font-weight: 700;">${money((doc.total ?? 0) - doc.paid)}</span>
        </div>`
            : ""
        }
      </div>`
          : "<div></div>"
      }
    </div>

    ${
      opts.showSignatures
        ? `
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
    </div>`
        : ""
    }
  </div>

  ${opts.showFooter ? `<div class="doc-footer">${renderUniversalFooter(company, rtl)}</div>` : ""}
</div>

</body>
</html>`;
}
