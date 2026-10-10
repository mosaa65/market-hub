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
 * قالب الإيصال الحراري الاحترافي (Professional Thermal Receipt).
 * المعرّف البرمجي القديم `thermal-milling` محفوظ كما هو للتوافق مع الإعدادات
 * المحفوظة. التخطيط مريح للعين، واضح التبويب، بطاقات منظمة، وتفاصيل مالية
 * محددة بدقة. يعمل مع أي مستند في النظام وبمقاسات 80 مم و 58 مم.
 */
export function renderThermalMillingTemplate(
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
    showBarcode: true,
    showQrCode: true,
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
    doc.title ||
    (doc.docType === "delivery_note"
      ? "سند تسليم وبضاعة"
      : doc.docType === "purchase_invoice"
        ? "فاتورة توريد ومشتريات"
        : "فاتورة مبيعات سريعة");

  const linesHtml = doc.lines
    .map(
      (l, idx) => `
    <div style="padding: 4px 0; border-bottom: ${idx < doc.lines.length - 1 ? "1px dashed #e2e8f0" : "none"};">
      <div style="font-weight: 700; font-size: 11.5px; color: #0f172a; line-height: 1.3;">${esc(l.product)}</div>
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-top: 2px;">
        <span style="color: #475569;">${l.qty} ${l.unit ? esc(l.unit) : ""} × ${money(l.price)}</span>
        <span style="font-weight: 700; font-family: monospace; color: #0f172a;">${money(l.total)}</span>
      </div>
      ${l.code ? `<div style="font-size: 9px; color: #94a3b8; font-family: monospace;">SKU: ${esc(l.code)}</div>` : ""}
    </div>`,
    )
    .join("");

  const qrPayload = [
    `Seller: ${companyName}`,
    `TaxNo: ${companyVat || "N/A"}`,
    `Invoice: ${doc.number}`,
    `Date: ${doc.date}`,
    `Total: ${doc.total || 0} ${c}`,
  ].join("\n");

  const qrHtml = opts.showQrCode !== false ? generateQrCodeSvg(qrPayload, 100) : "";
  const barcodeHtml =
    opts.showBarcode !== false && doc.number ? generateBarcodeSvg(doc.number, 36) : "";

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
      padding: 6mm 4mm;
      font-size: 11px;
      line-height: 1.4;
    }
    .text-center { text-align: center; }
    .font-bold { font-weight: 700; }
    .font-mono { font-family: ui-monospace, 'Courier New', monospace; }
    .dashed-divider { border-bottom: 1px dashed #64748b; margin: 7px 0; }
    .solid-divider { border-bottom: 1px solid #cbd5e1; margin: 7px 0; }
    .flex-between { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3.5px; }
    .pill-badge {
      display: inline-block;
      border: 1px solid #0f172a;
      border-radius: 99px;
      padding: 2px 10px;
      font-weight: 800;
      font-size: 10.5px;
      margin: 4px auto;
      background: #f8fafc;
    }
    .details-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 6px 8px;
      margin: 6px 0;
    }
    .totals-banner {
      border-top: 1.5px solid #0f172a;
      border-bottom: 1.5px solid #0f172a;
      padding: 5px 0;
      margin: 6px 0;
    }
    .grand-total {
      font-size: 14px;
      font-weight: 900;
      color: #0f172a;
    }
    .barcode-wrap {
      text-align: center;
      margin: 8px 0 4px;
    }
    .footer-note {
      text-align: center;
      font-size: 9.5px;
      color: #64748b;
      margin-top: 8px;
      line-height: 1.35;
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
        <div style="font-size: 15px; font-weight: 900; letter-spacing: -0.2px; color: #0f172a;">${esc(companyName)}</div>
        ${companyAddress ? `<div style="font-size: 10px; color: #475569; margin-top: 1px;">${esc(companyAddress)}</div>` : ""}
        ${companyPhone ? `<div style="font-size: 10px; color: #475569; font-family: monospace;">هاتف: ${esc(companyPhone)}</div>` : ""}
        ${companyVat ? `<div style="font-size: 9.5px; color: #64748b;">الرقم الضريبي: ${esc(companyVat)}</div>` : ""}
      `
          : ""
      }
      <div class="pill-badge">${esc(docTitle)}</div>
    </div>

    <div class="dashed-divider"></div>

    <!-- Meta Info -->
    <div style="font-size: 11px;">
      ${
        opts.showDocNumberDate
          ? `
        <div class="flex-between">
          <span style="color: #64748b;">رقم المستند:</span>
          <span class="font-bold font-mono">#${esc(doc.number)}</span>
        </div>
        <div class="flex-between">
          <span style="color: #64748b;">التاريخ:</span>
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
        opts.showMovementInfo && doc.warehouse
          ? `
        <div class="flex-between">
          <span style="color: #64748b;">المستودع:</span>
          <span>${esc(doc.warehouse)}</span>
        </div>
      `
          : ""
      }
      ${
        opts.showPaymentInfo && doc.payment
          ? `
        <div class="flex-between">
          <span style="color: #64748b;">طريقة السداد:</span>
          <span class="font-bold">${esc(doc.payment)}</span>
        </div>
      `
          : ""
      }
    </div>

    <!-- Items Details Box -->
    <div style="margin: 6px 0 2px;">
      <div style="font-size: 11px; font-weight: 800; color: #334155; margin-bottom: 3px;">بنود وتفاصيل العملية:</div>
      <div class="details-box">
        ${linesHtml || `<div style="text-align:center; color:#94a3b8; font-size:10px;">لا توجد بنود</div>`}
      </div>
    </div>

    <!-- Financial Breakdown -->
    ${
      opts.showFinancialDetails
        ? `
      <div style="padding-top: 3px;">
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
            <span>الخصم الممنوح:</span>
            <span class="font-mono">-${money(doc.discount)}</span>
          </div>
        `
            : ""
        }

        <!-- Grand Total Banner -->
        <div class="totals-banner">
          <div class="flex-between grand-total" style="margin-bottom: 0;">
            <span>${esc(L.grandTotal)}:</span>
            <span class="font-mono" style="font-size: 15px;">${money(doc.total)}</span>
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
            <span>${esc(L.balance)} (متبقي):</span>
            <span class="font-mono">${money(doc.balance)}</span>
          </div>
        `
            : ""
        }
      </div>
    `
        : ""
    }

    ${
      opts.showNotes && doc.notes
        ? `
      <div class="solid-divider"></div>
      <div style="font-size: 10px; color: #475569;">
        <span class="font-bold">ملاحظات:</span> ${esc(doc.notes)}
      </div>
    `
        : ""
    }

    <!-- QR Code & Barcode -->
    ${
      qrHtml
        ? `
      <div style="text-align: center; margin: 8px 0 4px;">
        ${qrHtml}
      </div>
    `
        : ""
    }
    ${
      barcodeHtml
        ? `
      <div class="barcode-wrap">
        ${barcodeHtml}
      </div>
    `
        : ""
    }

    <div class="dashed-divider"></div>

    <!-- Polite Footer -->
    <div class="footer-note">
      <div style="font-weight: 700; color: #0f172a;">${esc(L.thanks)}</div>
      <div>نسعد بخدمتكم دائماً — تم استلام المستند بنجاح</div>
      ${opts.showFooter ? renderUniversalFooter(company, true, true) : ""}
    </div>
  </div>
</body>
</html>`;
}
