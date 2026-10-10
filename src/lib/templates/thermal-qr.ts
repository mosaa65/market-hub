import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  formatMoney,
  CustomFieldOptions,
} from "./types";
import { generateBarcodeSvg, generateQrCodeSvg } from "@/lib/printing/barcode-qr";
import { getCachedCompanyProfile } from "@/lib/printing/company-profile";
import { renderUniversalFooter, UNIVERSAL_FOOTER_CSS } from "@/lib/printing/footer";

/**
 * قالب الإيصال الحراري مع باركود و QR (Thermal QR & Electronic Receipt).
 * يدعم الفاتورة الإلكترونية، رمز QR للمسح السريع بالجوال، وباركود مباشر للماسحات.
 */
export function renderThermalQrTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions,
): string {
  const c = doc.currency ?? "ر.ي";
  const esc = escapeHtml;
  const money = (n?: number) => formatMoney(n, c);
  const company = getCachedCompanyProfile();

  const opts = {
    showLogo: true,
    showCompanyInfo: true,
    showCustomerInfo: true,
    showDocNumberDate: true,
    showMovementInfo: true,
    showFinancialDetails: true,
    showPaymentInfo: true,
    showNotes: true,
    showSignatures: false,
    showFooter: true,
    ...options,
    ...doc.options,
  };

  const companyName =
    doc.company?.legalName ||
    doc.company?.name ||
    company.legalName ||
    company.name ||
    "المركز التجاري";
  const companyAddress = doc.company?.address || company.address || "";
  const companyPhone = doc.company?.phone || company.phone || company.contacts[0] || "";
  const companyVat = doc.company?.vat || company.taxNumber || "";

  const docTitle =
    doc.title || (doc.docType === "delivery_note" ? "سند تسليم" : "فاتورة إلكترونية معتمدة");

  const linesHtml = doc.lines
    .map(
      (l, idx) => `
    <div style="padding: 3.5px 0; border-bottom: ${idx < doc.lines.length - 1 ? "1px dotted #cbd5e1" : "none"};">
      <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 11.5px; color: #0f172a;">
        <span>${esc(l.product)}</span>
        <span class="font-mono">${money(l.total)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: #64748b; margin-top: 1px;">
        <span>${l.qty} ${l.unit ? esc(l.unit) : ""} × ${money(l.price)}</span>
        ${l.code ? `<span class="font-mono" style="font-size: 9px;">${esc(l.code)}</span>` : ""}
      </div>
    </div>`,
    )
    .join("");

  // Build electronic verification QR payload
  const qrPayload = [
    `Seller: ${companyName}`,
    `TaxNo: ${companyVat || "N/A"}`,
    `Invoice: ${doc.number}`,
    `Date: ${doc.date}`,
    `Total: ${doc.total || 0} ${c}`,
    `Tax: ${doc.tax || 0} ${c}`,
  ].join("\n");

  const qrSvg = (opts.showQrCode !== false) ? generateQrCodeSvg(qrPayload, 115) : "";
  const barcodeSvg = (opts.showBarcode !== false && doc.number) ? generateBarcodeSvg(doc.number, 32) : "";

  return `<!doctype html>
<html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8"/>
  <title>${esc(doc.title || doc.number)}</title>
  <style>
    @page { size: var(--print-paper-width, 80mm) auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; background: #fff; color: #0f172a;
      font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, system-ui, sans-serif;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .receipt-container {
      width: var(--print-paper-width, 80mm);
      margin: 0 auto;
      padding: 5mm 3.5mm;
      font-size: 11px;
      line-height: 1.35;
    }
    .text-center { text-align: center; }
    .font-bold { font-weight: 700; }
    .font-mono { font-family: ui-monospace, 'Courier New', monospace; }
    .divider { border-bottom: 1px dashed #64748b; margin: 6px 0; }
    .flex-between { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
    .qr-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 6px 0;
      margin: 6px 0;
    }
    .grand-box {
      border: 1.5px solid #0f172a;
      border-radius: 8px;
      padding: 6px 8px;
      background: #f8fafc;
      margin: 6px 0;
    }
    @media screen {
      body { background: #f1f5f9; padding: 16px 0; }
      .receipt-container {
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.12);
      }
    }
    ${UNIVERSAL_FOOTER_CSS}
  </style>
</head>
<body>
  <div class="receipt-container">
    <!-- Header -->
    <div class="text-center">
      ${
        opts.showCompanyInfo
          ? `
        <div style="font-size: 15px; font-weight: 900; color: #0f172a;">${esc(companyName)}</div>
        ${companyAddress ? `<div style="font-size: 10px; color: #475569;">${esc(companyAddress)}</div>` : ""}
        ${companyPhone ? `<div style="font-size: 10px; color: #475569; font-family: monospace;">هاتف: ${esc(companyPhone)}</div>` : ""}
        ${companyVat ? `<div style="font-size: 9.5px; color: #64748b;">الرقم الضريبي: ${esc(companyVat)}</div>` : ""}
      `
          : ""
      }
      <div style="font-size: 11px; font-weight: 800; margin-top: 3px; color: #0f172a;">
        ${esc(docTitle)}
      </div>
    </div>

    <div class="divider"></div>

    <!-- Metadata -->
    ${
      opts.showDocNumberDate
        ? `
      <div class="flex-between">
        <span style="color: #64748b;">رقم الفاتورة:</span>
        <span class="font-bold font-mono">#${esc(doc.number)}</span>
      </div>
      <div class="flex-between">
        <span style="color: #64748b;">التاريخ والوقت:</span>
        <span class="font-mono">${esc(doc.date)}</span>
      </div>
    `
        : ""
    }
    ${
      opts.showCustomerInfo && doc.partyName
        ? `
      <div class="flex-between">
        <span style="color: #64748b;">${esc(doc.partyLabel || L.billTo)}:</span>
        <span class="font-bold">${esc(doc.partyName)}</span>
      </div>
    `
        : ""
    }
    ${
      opts.showCustomerInfo && doc.partyPhone
        ? `
      <div class="flex-between">
        <span style="color: #64748b;">الهاتف:</span>
        <span class="font-mono">${esc(doc.partyPhone)}</span>
      </div>
    `
        : ""
    }
    ${
      opts.showPaymentInfo && doc.payment
        ? `
      <div class="flex-between">
        <span style="color: #64748b;">طريقة الدفع:</span>
        <span class="font-bold">${esc(doc.payment)}</span>
      </div>
    `
        : ""
    }

    <div class="divider"></div>

    <!-- Lines -->
    <div style="margin: 4px 0;">
      ${linesHtml || `<div style="text-align:center; color:#94a3b8;">لا توجد بنود</div>`}
    </div>

    <div class="divider"></div>

    <!-- Totals -->
    ${
      opts.showFinancialDetails
        ? `
      ${
        doc.subtotal !== undefined
          ? `
        <div class="flex-between" style="color: #475569;">
          <span>${esc(L.subtotal)}:</span>
          <span class="font-mono font-bold">${money(doc.subtotal)}</span>
        </div>
      `
          : ""
      }
      ${
        (doc.tax || 0) > 0
          ? `
        <div class="flex-between" style="color: #475569;">
          <span>${esc(L.tax)}:</span>
          <span class="font-mono">${money(doc.tax)}</span>
        </div>
      `
          : ""
      }
      ${
        (doc.discount || 0) > 0
          ? `
        <div class="flex-between" style="color: #15803d; font-weight: 700;">
          <span>الخصم:</span>
          <span class="font-mono">-${money(doc.discount)}</span>
        </div>
      `
          : ""
      }

      <div class="grand-box">
        <div class="flex-between" style="margin-bottom: 0;">
          <span style="font-size: 13px; font-weight: 900;">${esc(L.grandTotal)}:</span>
          <span class="font-mono" style="font-size: 15px; font-weight: 900;">${money(doc.total)}</span>
        </div>
      </div>

      ${
        doc.paid !== undefined
          ? `
        <div class="flex-between" style="color: #047857; font-weight: 700;">
          <span>${esc(L.paid)}:</span>
          <span class="font-mono">${money(doc.paid)}</span>
        </div>
      `
          : ""
      }
      ${
        (doc.balance || 0) > 0
          ? `
        <div class="flex-between" style="color: #b91c1c; font-weight: 800;">
          <span>${esc(L.balance)}:</span>
          <span class="font-mono">${money(doc.balance)}</span>
        </div>
      `
          : ""
      }
    `
        : ""
    }

    <!-- QR Code Section -->
    ${
      qrSvg
        ? `
      <div class="qr-box">
        ${qrSvg}
        <div style="font-size: 8.5px; color: #64748b; margin-top: 4px;">امسح للتحقق من صحة الفاتورة الإلكترونية</div>
      </div>
    `
        : ""
    }

    <!-- Barcode Section -->
    ${
      barcodeSvg
        ? `
      <div style="text-align: center; margin: 4px 0;">
        ${barcodeSvg}
      </div>
    `
        : ""
    }

    <div class="divider"></div>

    <div class="text-center" style="font-size: 9.5px; color: #64748b;">
      <div style="font-weight: 700; color: #0f172a;">${esc(L.thanks)}</div>
      ${opts.showFooter ? renderUniversalFooter(company, true, true) : ""}
    </div>
  </div>
</body>
</html>`;
}
