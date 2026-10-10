import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  formatMoney,
  CustomFieldOptions,
} from "./types";
import { getCachedCompanyProfile } from "@/lib/printing/company-profile";
import { renderUniversalFooter, UNIVERSAL_FOOTER_CSS } from "@/lib/printing/footer";
import { numberToArabicWords } from "./tafqeet";
import { generateBarcodeSvg, generateQrCodeSvg } from "@/lib/printing/barcode-qr";

/**
 * قالب الكاونتر المبسط والأنيق (Milling Clean Minimalist Layout A4 / A5).
 * مستوحى مباشرة من واجهة كاونتر المطحنة: هادئ، شديد الأناقة، غير معقد،
 * وخالٍ تماماً من الألوان المشوشة والتدرجات الزائدة.
 * مناسب لجميع أقسام وفواتير النظام ومصمم لطباعة A4 و A5 بدقة عالية.
 */
export function renderMillingCleanTemplate(
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
    showSignatures: true,
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
    "المركز التجاري المتقدم";
  const companyAddress = doc.company?.address || company.address || "";
  const companyPhone = doc.company?.phone || company.phone || company.contacts[0] || "";
  const companyVat = doc.company?.vat || company.taxNumber || "";

  const docTitle =
    doc.title ||
    (doc.docType === "delivery_note"
      ? "سند تسليم وإذن استلام"
      : doc.docType === "purchase_invoice"
        ? "فاتورة مشتريات وتوريد"
        : "فاتورة مبيعات معتمدة");

  const tafqeetText = doc.total ? numberToArabicWords(doc.total, c) : "";

  const rowsHtml = doc.lines
    .map(
      (l, idx) => `
    <tr>
      <td style="text-align: center; font-family: monospace; color: #64748b;">${idx + 1}</td>
      <td>
        <div style="font-weight: 700; color: #0f172a;">${esc(l.product)}</div>
        ${l.code ? `<div style="font-size: 10px; color: #94a3b8; font-family: monospace;">SKU: ${esc(l.code)}</div>` : ""}
      </td>
      <td style="text-align: center; font-family: monospace; font-weight: 600;">
        ${l.qty} ${l.unit ? `<span style="font-size: 10.5px; color: #64748b;">${esc(l.unit)}</span>` : ""}
      </td>
      <td style="text-align: ${rtl ? "left" : "right"}; font-family: monospace;">${money(l.price)}</td>
      <td style="text-align: ${rtl ? "left" : "right"}; font-family: monospace; font-weight: 700; color: #0f172a;">${money(l.total)}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html>
<html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8"/>
  <title>${esc(doc.title || doc.number)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; background: #fff; color: #1e293b;
      font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, system-ui, sans-serif;
      font-size: 12px; line-height: 1.5;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .sheet-wrapper {
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
      padding: 12mm 15mm;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .header-box {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .party-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
    }
    table.data-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 800;
      font-size: 11.5px;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      text-align: ${rtl ? "right" : "left"};
    }
    table.data-table td {
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      font-size: 11.5px;
      vertical-align: middle;
    }
    table.data-table tbody tr:nth-child(even) {
      background: #fafafa;
    }
    .totals-wrapper {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 20px;
    }
    .totals-box {
      width: 280px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      padding: 10px 14px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 5px;
      font-size: 11.5px;
      color: #475569;
    }
    .grand-total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1.5px solid #0f172a;
      padding-top: 6px;
      margin-top: 6px;
      font-size: 14.5px;
      font-weight: 900;
      color: #0f172a;
    }
    .signatures-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 36px;
      margin-top: 36px;
      text-align: center;
      color: #64748b;
      font-size: 11.5px;
    }
    .signature-line {
      border-bottom: 1px dashed #94a3b8;
      width: 170px;
      margin: 28px auto 0;
    }
    .badge-doc {
      display: inline-block;
      border-radius: 99px;
      background: #0f172a;
      color: #fff;
      padding: 3px 12px;
      font-weight: 800;
      font-size: 11.5px;
      margin-bottom: 4px;
    }
    @media screen {
      body { background: #f1f5f9; padding: 24px 0; }
      .sheet-wrapper {
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 24px -4px rgba(0,0,0,0.15);
      }
    }
    ${UNIVERSAL_FOOTER_CSS}
  </style>
</head>
<body>
  <div class="sheet-wrapper">
    <div>
      <!-- Header -->
      <div class="header-box">
        <div>
          ${
            opts.showCompanyInfo
              ? `
            <h1 style="margin: 0; font-size: 21px; font-weight: 900; color: #0f172a; letter-spacing: -0.3px;">
              ${esc(companyName)}
            </h1>
            ${companyAddress ? `<p style="margin: 4px 0 0 0; color: #64748b; font-size: 11.5px;">${esc(companyAddress)}</p>` : ""}
            ${companyPhone ? `<p style="margin: 2px 0 0 0; color: #64748b; font-size: 11.5px; font-family: monospace;">هاتف: ${esc(companyPhone)}</p>` : ""}
            ${companyVat ? `<p style="margin: 2px 0 0 0; color: #64748b; font-size: 11px;">الرقم الضريبي: ${esc(companyVat)}</p>` : ""}
          `
              : ""
          }
        </div>

        <div style="text-align: ${rtl ? "left" : "right"};">
          <div class="badge-doc">${esc(docTitle)}</div>
          ${
            opts.showDocNumberDate
              ? `
            <div style="font-weight: 800; font-family: monospace; font-size: 13px; color: #0f172a; margin-top: 2px;">
              #${esc(doc.number)}
            </div>
            <div style="color: #64748b; font-size: 11px; margin-top: 1px;">
              ${esc(doc.date)}
            </div>
          `
              : ""
          }
        </div>
      </div>

      <!-- Party Box -->
      ${
        opts.showCustomerInfo && (doc.partyName || doc.warehouse || doc.payment)
          ? `
        <div class="party-box">
          <div>
            <span style="color: #64748b;">${esc(doc.partyLabel || L.billTo)}:</span>
            <strong style="margin-right: 6px; margin-left: 6px; color: #0f172a;">${esc(doc.partyName || "عميل نقدي")}</strong>
            ${doc.partyPhone ? `<div style="color: #64748b; font-size: 11px; margin-top: 3px; font-family: monospace;">هاتف: ${esc(doc.partyPhone)}</div>` : ""}
          </div>
          <div>
            ${
              doc.warehouse
                ? `
              <div>
                <span style="color: #64748b;">المستودع / الفرع:</span>
                <strong style="margin-right: 6px; margin-left: 6px; color: #0f172a;">${esc(doc.warehouse)}</strong>
              </div>
            `
                : ""
            }
            ${
              doc.payment
                ? `
              <div style="margin-top: 3px;">
                <span style="color: #64748b;">طريقة السداد:</span>
                <span style="margin-right: 6px; margin-left: 6px; font-weight: 700; color: #0f172a;">${esc(doc.payment)}</span>
              </div>
            `
                : ""
            }
          </div>
        </div>
      `
          : ""
      }

      <!-- Items Table -->
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 36px; text-align: center;">م</th>
            <th>البيان والصنف</th>
            <th style="width: 90px; text-align: center;">الكمية</th>
            <th style="width: 100px; text-align: ${rtl ? "left" : "right"};">السعر</th>
            <th style="width: 110px; text-align: ${rtl ? "left" : "right"};">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 16px;">لا توجد أصناف</td></tr>`}
        </tbody>
      </table>

      <!-- Bottom Layout: Tafqeet/Notes + Totals -->
      <div style="display: grid; grid-template-columns: 1fr 280px; gap: 16px; align-items: start;">
        <div>
          ${
            tafqeetText
              ? `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 11px; color: #334155; margin-bottom: 8px;">
              <span style="font-weight: 700; color: #0f172a;">المبلغ كتابة:</span> ${esc(tafqeetText)}
            </div>
          `
              : ""
          }
          ${
            opts.showNotes && doc.notes
              ? `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 11px; color: #64748b;">
              <strong style="color: #0f172a;">ملاحظات:</strong> ${esc(doc.notes)}
            </div>
          `
              : ""
          }
        </div>

        <!-- Totals Box -->
        ${
          opts.showFinancialDetails
            ? `
          <div class="totals-box">
            ${
              doc.subtotal !== undefined
                ? `
              <div class="total-row">
                <span>المجموع الفرعي:</span>
                <span style="font-family: monospace; font-weight: 700;">${money(doc.subtotal)}</span>
              </div>
            `
                : ""
            }
            ${
              (doc.tax || 0) > 0
                ? `
              <div class="total-row">
                <span>الضريبة:</span>
                <span style="font-family: monospace;">${money(doc.tax)}</span>
              </div>
            `
                : ""
            }
            ${
              (doc.discount || 0) > 0
                ? `
              <div class="total-row" style="color: #15803d; font-weight: 700;">
                <span>الخصم الممنوح:</span>
                <span style="font-family: monospace;">-${money(doc.discount)}</span>
              </div>
            `
                : ""
            }

            <div class="grand-total-row">
              <span>الصافي النهائي:</span>
              <span style="font-family: monospace;">${money(doc.total)}</span>
            </div>

            ${
              doc.paid !== undefined
                ? `
              <div class="total-row" style="margin-top: 6px; color: #047857; font-weight: 700;">
                <span>المدفوع:</span>
                <span style="font-family: monospace;">${money(doc.paid)}</span>
              </div>
            `
                : ""
            }
            ${
              (doc.balance || 0) > 0
                ? `
              <div class="total-row" style="color: #b91c1c; font-weight: 800;">
                <span>المتبقي:</span>
                <span style="font-family: monospace;">${money(doc.balance)}</span>
              </div>
            `
                : ""
            }
          </div>
        `
            : `<div></div>`
        }
      </div>

      <!-- Signatures -->
      ${
        opts.showSignatures
          ? `
        <div class="signatures-grid">
          <div>
            <p>توقيع العميل / المستلم</p>
            <div class="signature-line"></div>
          </div>
          <div>
            <p>المسؤول المالي / أمين الصندوق</p>
            <div class="signature-line"></div>
          </div>
        </div>
      `
          : ""
      }
    </div>

    <!-- Footer -->
    <div style="margin-top: 24px;">
      ${opts.showFooter ? renderUniversalFooter(company, true, false) : ""}
    </div>
  </div>
</body>
</html>`;
}
