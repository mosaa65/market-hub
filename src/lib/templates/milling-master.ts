import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  formatMoney,
  productNameWithoutUnit,
  CustomFieldOptions,
} from "./types";
import { getCachedCompanyProfile } from "@/lib/printing/company-profile";
import {
  COMPANY_RIGHTS_TEXT,
  renderUniversalFooter,
  UNIVERSAL_FOOTER_CSS,
} from "@/lib/printing/footer";
import { formatPrintedDateTime } from "@/lib/printing/date-time";
import { generateBarcodeSvg, generateQrCodeSvg } from "@/lib/printing/barcode-qr";
import { numberToArabicWords } from "./tafqeet";

/**
 * Milling Service Master Template (A4 / A5 Luxury Format)
 * القالب الرسمي الأنيق لخدمات المطحنة، الاستلام، الفواتير، وسندات التسليم.
 * مستعاد من النسخة المعتمدة والمطورة بفواصل Hairline أنيقة وصندوق بيانات مالي وهيكل توقيع معتمد.
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
  const companyProfile = getCachedCompanyProfile();

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
    showQrCode: false,
    ...doc.options,
    ...options,
  };

  const isDelivery = doc.docType === "delivery_note";
  const title = esc(
    doc.title || (isDelivery ? "سند تسليم أمانات عميل" : "فاتورة وسند استلام وخدمات طحن"),
  );

  const compName = esc(
    doc.company?.arabicName ||
      doc.company?.name ||
      companyProfile.arabicName ||
      companyProfile.name ||
      "",
  );
  const compAddress = esc(doc.company?.address || companyProfile.address || "");
  const compPhone = esc(
    doc.company?.phone || companyProfile.phone || companyProfile.contacts[0] || "",
  );
  const compVat = esc(doc.company?.vat || companyProfile.taxNumber || "");
  const logoUrl = doc.company?.logo || companyProfile.logoUrl;
  const logoHtml = opts.showLogo && logoUrl
    ? `<img class="company-logo" src="${esc(logoUrl)}" alt="${compName}" />`
    : "";

  // Barcode & QR Svg
  const barcodeSvg = opts.showBarcode && doc.number ? generateBarcodeSvg(doc.number, 42) : "";
  const qrSvg =
    opts.showQrCode && doc.number
      ? generateQrCodeSvg(
          `${compName}\nرقم: ${doc.number}\nالتاريخ: ${formatPrintedDateTime(doc.date)}\nالإجمالي: ${doc.total || 0} ${c}`,
          75,
        )
      : "";

  // Build table lines or item rows with hairline dividers
  const hasLines = doc.lines && doc.lines.length > 0;
  const lineRowsHtml = hasLines
    ? doc.lines
        .map(
          (l, i) => `
        <tr style="${i < doc.lines.length - 1 ? "border-bottom: 1px solid rgba(0, 0, 0, 0.08);" : ""}">
          <td style="padding: 10px 8px; font-weight: bold; color: #0f172a;">${esc(productNameWithoutUnit(l.product, l.unit))}</td>
          ${
            isDelivery
              ? `<td style="padding: 10px 8px; text-align: center; font-weight: 600; color: #475569;">${
                  l.previousQty !== undefined
                    ? `${l.previousQty} ${esc(l.unit || "كيس")}${l.previousKg ? ` (${l.previousKg} كجم)` : ""}`
                    : "—"
                }</td>
                 <td style="padding: 10px 8px; text-align: center; font-weight: 800; color: #059669;">${l.qty} ${esc(l.unit || "كيس")}${l.currentKg ? ` (${l.currentKg} كجم)` : ""}</td>
                 <td style="padding: 10px 8px; text-align: center; font-weight: 700; color: ${Number(l.remainingQty ?? 0) > 0 ? "#d97706" : "#059669"};">${
                   l.remainingQty !== undefined
                     ? `${l.remainingQty} ${esc(l.unit || "كيس")}${l.remainingKg ? ` (${l.remainingKg} كجم)` : ""}`
                     : "0 كيس"
                 }</td>
                 <td style="padding: 10px 8px; text-align: left; font-size: 11px; color: #64748b;">${esc(l.note || "تسليم دفعة")}</td>`
              : `<td style="padding: 10px 8px; color: #475569;">${esc(l.note || l.unit || "—")}</td>
                 <td style="padding: 10px 8px; text-align: center; font-weight: 700; color: #0f172a;">${l.qty} ${esc(l.unit || "")}</td>
                 <td style="padding: 10px 8px; text-align: left; font-weight: 600; color: #0f172a;">${money(l.price)}</td>
                 <td style="padding: 10px 8px; text-align: left; font-weight: bold; color: #0f172a;">${money(l.total)}</td>`
          }
        </tr>`,
        )
        .join("")
    : "";

  const tafqeetText = doc.total ? numberToArabicWords(doc.total, c) : "";

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
      max-width: 820px;
      margin: 0 auto;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
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
    .company-title { font-size: 21px; font-weight: 900; color: #0f172a; margin: 0; }
    .company-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
    .company-logo { display:block; max-width:32mm; max-height:18mm; object-fit:contain; margin:0 auto 6px; }
    .doc-badge {
      text-align: ${rtl ? "left" : "right"};
    }
    .doc-badge h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      color: #d97706;
    }
    .doc-badge .doc-num {
      font-family: monospace;
      font-weight: 800;
      font-size: 15px;
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
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }
    .meta-label { font-size: 11px; color: #64748b; font-weight: 600; }
    .meta-val { font-size: 13px; color: #0f172a; font-weight: 800; }

    .hairline-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    .hairline-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: ${rtl ? "right" : "left"};
      padding: 10px 8px;
      font-size: 12px;
      border-bottom: 2px solid #cbd5e1;
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
      justify-content: space-between;
      align-items: flex-start;
      margin-top: 16px;
      gap: 16px;
    }
    .tafqeet-box {
      flex: 1;
      padding: 10px 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      font-size: 12px;
      color: #334155;
    }
    .totals-box {
      width: 300px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 12px 16px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 12.5px;
    }
    .totals-row.grand {
      font-size: 14.5px;
      font-weight: 900;
      color: #0f172a;
      border-top: 2px solid #cbd5e1;
      border-bottom: 2px solid #cbd5e1;
      padding: 6px 0;
      margin: 6px 0;
    }

    .sig-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-top: 36px;
      padding-top: 16px;
      border-top: 1px dashed #cbd5e1;
      text-align: center;
    }
    .sig-line {
      margin-top: 40px;
      border-bottom: 1px solid #94a3b8;
    }

    .inama-footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #64748b;
    }
    .inama-badge {
      display: inline-block;
      font-weight: 700;
      color: #0284c7;
      letter-spacing: 0.2px;
    }
  </style>
</head>
<body onload="window.print()">
  <div class="milling-card">
    <!-- Header -->
    <div class="header-bar">
      <div>
        ${logoHtml}
        ${opts.showCompanyInfo ? `<h1 class="company-title">${compName}</h1>` : ""}
        ${opts.showCompanyInfo && compAddress ? `<div class="company-sub">${compAddress}</div>` : ""}
        ${opts.showCompanyInfo && compPhone ? `<div class="company-sub">هاتف: ${compPhone}</div>` : ""}
        ${opts.showCompanyInfo && compVat ? `<div class="company-sub">الرقم الضريبي: ${compVat}</div>` : ""}
      </div>
      <div class="doc-badge">
        <h2>${title}</h2>
        ${opts.showDocNumberDate ? `<div class="doc-num">${esc(doc.number)}</div>` : ""}
        ${qrSvg ? `<div style="margin-top: 6px;">${qrSvg}</div>` : ""}
      </div>
    </div>

    <!-- Metadata Box -->
    <div class="meta-box">
      ${
        opts.showDocNumberDate
          ? `
      <div class="meta-item">
        <span class="meta-label">تاريخ ووقت المعاملة:</span>
        <span class="meta-val">${esc(formatPrintedDateTime(doc.date))}</span>
      </div>`
          : ""
      }
      ${
        opts.showCustomerInfo && doc.partyName
          ? `
      <div class="meta-item">
        <span class="meta-label">${esc(doc.partyLabel || "العميل المستفيد")}:</span>
        <span class="meta-val">${esc(doc.partyName)}</span>
      </div>
      ${
        doc.partyPhone
          ? `
      <div class="meta-item">
        <span class="meta-label">هاتف العميل:</span>
        <span class="meta-val">${esc(doc.partyPhone)}</span>
      </div>`
          : ""
      }`
          : ""
      }
      ${
        doc.warehouse
          ? `
      <div class="meta-item">
        <span class="meta-label">المستودع / الصالة:</span>
        <span class="meta-val">${esc(doc.warehouse)}</span>
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
      ${doc.operatorName ? `<div class="meta-item"><span class="meta-label">البائع / المستخدم:</span><span class="meta-val">${esc(doc.operatorName)}</span></div>` : ""}
    </div>

    <!-- Table of Lines -->
    ${
      hasLines
        ? `
    <table class="hairline-table">
      <thead>
        <tr>
          <th>الصنف / بيان الخدمة</th>
          ${
            isDelivery
              ? `<th style="text-align: center;">الرصيد السابق</th>
                 <th style="text-align: center;">المسلَّم الآن</th>
                 <th style="text-align: center;">المتبقي بذمة المطحنة</th>
                 <th style="text-align: left;">بيان التسليم والملاحظات</th>`
              : `<th>المواصفات / العبوة</th>
                 <th style="text-align: center;">الكمية / الأكياس</th>
                 <th style="text-align: left;">سعر الوحدة</th>
                 <th style="text-align: left;">الإجمالي</th>`
          }
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
        <span class="hairline-row-val">${esc(doc.movementType || "طحن وخدمات أمانات")}</span>
      </div>
      <div class="hairline-row">
        <span class="hairline-row-label">إجمالي العمليات:</span>
        <span class="hairline-row-val">${money(doc.total)}</span>
      </div>
    </div>`
    }

    <!-- Financial Totals (Hidden if delivery without charges) -->
    ${
      opts.showFinancialDetails && !isDelivery
        ? `
    <div class="totals-wrapper">
      <div class="tafqeet-box">
        <strong>المبلغ كتابة:</strong>
        <p style="margin: 4px 0 0; font-weight: 600; color: #0f172a;">${tafqeetText || "—"}</p>
        ${barcodeSvg ? `<div style="margin-top: 10px;">${barcodeSvg}</div>` : ""}
      </div>

      <div class="totals-box">
        <div class="totals-row">
          <span>المجموع الفرعي:</span>
          <span>${money(doc.subtotal || doc.total)}</span>
        </div>
        ${
          (doc.discount || 0) > 0
            ? `
        <div class="totals-row" style="color: #16a34a; font-weight: 600;">
          <span>الخصم الممنوح:</span>
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
        <div class="totals-row" style="color: #0284c7; font-weight: 700;">
          <span>المدفوع نقداً/تحويل:</span>
          <span>${money(doc.paid)}</span>
        </div>`
            : ""
        }
        ${
          (doc.balance || 0) > 0
            ? `
        <div class="totals-row" style="color: #dc2626; font-weight: 800;">
          <span>المتبقي ذمة (آجل):</span>
          <span>${money(doc.balance)}</span>
        </div>`
            : ""
        }
      </div>
    </div>`
        : ""
    }

    <!-- Notes -->
    ${
      opts.showNotes && doc.notes
        ? `
    <div style="margin-top: 16px; padding: 10px 14px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; font-size: 12px; color: #92400e;">
      <strong>ملاحظات وبيان العملية:</strong> ${esc(doc.notes)}
    </div>`
        : ""
    }

    <!-- Signatures -->
    ${
      opts.showSignatures
        ? `
    <div class="sig-section">
      <div>
        <p style="margin: 0; font-weight: 700; color: #0f172a;">توقيع العميل / المستلم</p>
        <div class="sig-line"></div>
      </div>
      <div>
        <p style="margin: 0; font-weight: 700; color: #0f172a;">مشرف صالة المطحنة والتسليم</p>
        <div class="sig-line"></div>
      </div>
    </div>`
        : ""
    }

    ${
      opts.showFooter
        ? `
    <div class="inama-footer">
      <span>تاريخ الطباعة: ${formatPrintedDateTime(new Date())}</span>
      ${L.poweredBy ? `<span class="inama-badge">${esc(L.poweredBy)}</span>` : ""}
    </div>`
        : ""
    }
    <div style="text-align:center;font-size:7.5px;color:#9ca3af;padding:2px 0">${COMPANY_RIGHTS_TEXT}</div>
  </div>
</body>
</html>`;
}

/**
 * Milling Thermal Template (POS 80mm / 58mm Format)
 * الإيصال الحراري الفاخر بنمط المطحنة وفواصل hairline الدقيقة.
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
  const companyProfile = getCachedCompanyProfile();

  const opts = {
    showLogo: true,
    showCompanyInfo: true,
    showCustomerInfo: true,
    showDocNumberDate: true,
    showFinancialDetails: true,
    showFooter: false,
    showBarcode: true,
    showQrCode: false,
    ...doc.options,
    ...options,
  };

  const isDelivery = doc.docType === "delivery_note";
  const title = esc(
    doc.title || (isDelivery ? "سند تسليم نواتج الأمانة" : "سند استلام أمانة وفاتورة أجور"),
  );

  const rawCompanyName =
    doc.company?.arabicName ||
    doc.company?.name ||
    companyProfile.arabicName ||
    companyProfile.name ||
    "";
  const compName = esc(rawCompanyName);
  const compAddress = esc(doc.company?.address || companyProfile.address || "");
  const compPhone = esc(
    doc.company?.phone || companyProfile.phone || companyProfile.contacts[0] || "",
  );
  const logoUrl = doc.company?.logo || companyProfile.logoUrl;
  const logoHtml = opts.showLogo && logoUrl
    ? `<img class="company-logo" src="${esc(logoUrl)}" alt="${compName}" />`
    : "";
  const barcodeHtml = opts.showBarcode && doc.number ? generateBarcodeSvg(doc.number, 38) : "";
  const qrPayload = [
    `Seller: ${rawCompanyName}`,
    `Invoice: ${doc.number}`,
    `Date: ${formatPrintedDateTime(doc.date)}`,
    `Total: ${doc.total ?? 0} ${c}`,
  ].join("\n");
  const qrHtml = opts.showQrCode && doc.number ? generateQrCodeSvg(qrPayload, 72) : "";

  const linesHtml = doc.lines
    ? doc.lines
        .map((l, idx) => {
          const isCustody =
            (l.price === 0 || l.price === undefined) && (l.total === 0 || l.total === undefined);
          return `
      <div class="hairline-row" style="${idx < doc.lines.length - 1 ? "border-bottom: 1px solid rgba(0, 0, 0, 0.08);" : ""}">
        <div style="font-weight: 800; font-size: 12px; color: #000;">${esc(productNameWithoutUnit(l.product, l.unit))}</div>
        <div style="display:flex; justify-content:space-between; font-size: 11px; margin-top: 2px;">
          <span>${l.qty} ${esc(l.unit || "")}${!isCustody && !isDelivery ? ` × ${money(l.price)}` : ""}</span>
          <span style="font-weight:800; color: ${isCustody ? "#059669" : "#000"};">
            ${isCustody ? (isDelivery ? "تسليم أمانة" : "أمانة عينية") : !isDelivery ? money(l.total) : "تسليم"}
          </span>
        </div>
        ${
          l.previousQty !== undefined
            ? `<div style="display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-top: 2px;">
                <span>السابق: ${l.previousQty} ${esc(l.unit || "")}</span>
                <span style="color: #b45309; font-weight: bold;">المتبقي: ${l.remainingQty ?? 0} ${esc(l.unit || "")}</span>
              </div>`
            : ""
        }
        ${l.note ? `<div style="font-size: 10px; color: #555; margin-top: 1px;">${esc(l.note)}</div>` : ""}
      </div>`;
        })
        .join("")
    : "";

  const intakeGrains = doc.lines.filter((line) =>
    line.product.trim().startsWith("حبوب مستلمة:"),
  );
  const hasMillingOutputs = doc.lines.some((line) => line.product.trim().startsWith("ناتج طحن:"));
  const isMillingIntake =
    doc.docType === "mill_document" && intakeGrains.length > 0 && !hasMillingOutputs;
  const isMillingOperation = ["mill_document", "delivery_note", "daily_ticket"].includes(
    String(doc.docType),
  );
  const useCompactReceiptLayout = isMillingIntake || !isMillingOperation;
  const formatReceiptNumber = (value: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);

  if (useCompactReceiptLayout) {
    const metadataRow = (label: string, value: string, dir = "auto") =>
      `<div class="receipt-meta-row"><span class="receipt-meta-label">${esc(label)}</span><strong class="receipt-meta-value" dir="${dir}">${esc(value)}</strong></div>`;

    const grainCards = intakeGrains
      .map((line) => {
        const grainName = line.product.replace(/^حبوب مستلمة:\s*/i, "");
        const quantity = Number(line.qty) || 0;
        const weight = Number(line.remainingKg ?? line.currentKg ?? 0);
        const isBagQuantity = line.unit === "كيس";
        const bagSize = isBagQuantity && quantity > 0 && weight > 0 ? weight / quantity : 0;
        const quantityText = isBagQuantity
          ? `${formatReceiptNumber(quantity)} كيس${bagSize ? ` × ${formatReceiptNumber(bagSize)} كجم` : ""}`
          : `${formatReceiptNumber(quantity)} ${esc(line.unit || "كجم")}`;
        const weightText = `${formatReceiptNumber(weight || (line.unit === "كجم" ? quantity : 0))} كجم`;

        return `<div class="grain-card">
          <div class="grain-detail-row"><span>نوع الحبوب:</span><strong>${esc(grainName)}</strong></div>
          <div class="grain-detail-row"><span>الكمية والأكياس:</span><strong dir="auto">${quantityText}</strong></div>
          <div class="grain-detail-row"><span>الوزن الصافي:</span><strong dir="auto">${weightText}</strong></div>
        </div>`;
      })
      .join("");

    const otherLines = isMillingIntake
      ? doc.lines.filter((line) => !intakeGrains.includes(line))
      : [];
    const serviceRows = otherLines
      .map(
        (line) => `<div class="receipt-meta-row service-row">
          <span>${esc(line.product)}</span>
          <strong dir="auto">${money(line.total ?? (line.qty * (line.price ?? 0)))}</strong>
        </div>${opts.showNotes && line.note ? `<div class="receipt-note">${esc(line.note)}</div>` : ""}`,
      )
      .join("");
    const invoiceItemCards = isMillingIntake
      ? ""
      : doc.lines
          .map((line) => {
            const quantity = `${formatReceiptNumber(Number(line.qty) || 0)} ${line.unit ? esc(line.unit) : ""}`.trim();
            const details = line.price !== undefined ? `${quantity} × ${money(line.price)}` : quantity;
            const lineTotal = line.total ?? (line.qty * (line.price ?? 0));
            return `<div class="grain-card invoice-item-card">
              <div class="invoice-item-heading"><strong>${esc(productNameWithoutUnit(line.product, line.unit))}</strong><strong dir="auto">${money(lineTotal)}</strong></div>
              <div class="grain-detail-row"><span>الكمية والسعر:</span><strong dir="auto">${details}</strong></div>
              ${opts.showNotes && line.note ? `<div class="receipt-note">${esc(line.note)}</div>` : ""}
            </div>`;
          })
          .join("");
    const relatedInvoice = doc.relatedRef?.replace(/^\s*فاتورة\s+(?:رسمية|الأجور)\s*/i, "").trim();
    const logoUrl = doc.company?.logo || companyProfile.logoUrl;
    const receiptLogo = opts.showLogo && logoUrl
      ? `<img class="receipt-logo" src="${esc(logoUrl)}" alt="${esc(doc.company?.arabicName || doc.company?.name || companyProfile.arabicName || companyProfile.name)}" />`
      : "";
    const note = opts.showNotes && doc.notes ? `<div class="receipt-note"><strong>ملاحظة:</strong> ${esc(doc.notes)}</div>` : "";
    const companyHeader = !isMillingIntake
      ? `<header class="receipt-company">
          ${opts.showLogo && logoUrl ? `<img class="receipt-logo" src="${esc(logoUrl)}" alt="${esc(compName)}" />` : ""}
          ${opts.showCompanyInfo && compName ? `<strong class="receipt-company-name">${compName}</strong>` : ""}
          ${opts.showCompanyInfo && compAddress ? `<div>${compAddress}</div>` : ""}
          ${opts.showCompanyInfo && compPhone ? `<div dir="ltr">${compPhone}</div>` : ""}
          <div class="receipt-document-title">${title}</div>
        </header>`
      : "";
    const financialRows = opts.showFinancialDetails
      ? `<section class="receipt-financials">
          ${!isMillingIntake && doc.subtotal !== undefined ? `<div class="receipt-meta-row"><span>المجموع:</span><strong dir="auto">${money(doc.subtotal)}</strong></div>` : ""}
          ${!isMillingIntake && (doc.discount || 0) > 0 ? `<div class="receipt-meta-row"><span>الخصم:</span><strong dir="auto">-${money(doc.discount)}</strong></div>` : ""}
          ${!isMillingIntake && (doc.tax || 0) > 0 ? `<div class="receipt-meta-row"><span>الضريبة:</span><strong dir="auto">${money(doc.tax)}</strong></div>` : ""}
          <div class="receipt-meta-row"><span>الإجمالي:</span><strong dir="auto">${money(doc.total)}</strong></div>
          ${doc.paid !== undefined ? `<div class="receipt-meta-row"><span>المدفوع:</span><strong dir="auto">${money(doc.paid)}</strong></div>` : ""}
          ${(doc.balance || 0) > 0 ? `<div class="receipt-meta-row balance-row"><span>المتبقي:</span><strong dir="auto">${money(doc.balance)}</strong></div>` : ""}
        </section>`
      : "";

    return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>${esc(doc.number || title)}</title>
  <style>
    @page { size: var(--print-paper-width, 80mm) auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111827; font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .milling-intake-receipt { width: var(--print-paper-width, 80mm); margin: 0 auto; padding: 5mm 4mm; font-size: 11px; line-height: 1.4; }
    .receipt-logo { display:block; max-width:30mm; max-height:14mm; object-fit:contain; margin:0 auto 5px; }
    .receipt-company { margin-bottom:7px; padding-bottom:6px; border-bottom:1px dashed #cbd5e1; text-align:center; color:#475467; font-size:10px; }
    .receipt-company-name { display:block; color:#111827; font-size:14px; font-weight:900; }
    .receipt-document-title { display:inline-block; margin-top:4px; padding:2px 9px; border:1px solid #111827; border-radius:999px; color:#111827; font-weight:800; }
    .receipt-meta { padding: 0 1px 5px; }
    .receipt-meta-row, .grain-detail-row { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:2px 0; }
    .receipt-meta-label, .grain-detail-row > span { flex:0 0 29%; color:#667085; text-align:right; }
    .receipt-meta-value, .grain-detail-row > strong { flex:1; min-width:0; color:#111827; font-weight:800; text-align:left; overflow-wrap:anywhere; }
    .receipt-divider { border:0; border-top:1px dashed #cbd5e1; margin:7px 0; }
    .grain-heading { display:flex; justify-content:space-between; align-items:center; gap:8px; margin:5px 0; }
    .grain-heading h1 { margin:0; font-size:12px; font-weight:900; color:#111827; }
    .custody-badge { flex:0 0 auto; border-radius:999px; padding:2px 8px; background:#fff1c2; color:#7a4b00; font-size:9.5px; font-weight:900; }
    .grain-card { margin:5px 0; padding:7px 9px; border:1px solid #e4e7ec; border-radius:14px; background:#f8fafc; }
    .invoice-item-heading { display:flex; justify-content:space-between; gap:8px; padding-bottom:3px; color:#111827; font-weight:800; }
    .receipt-section-heading { margin:5px 0; font-weight:900; }
    .grain-detail-row { padding:1.5px 0; }
    .service-section, .receipt-financials { margin-top:7px; padding-top:5px; border-top:1px dashed #cbd5e1; }
    .service-row { font-size:10.5px; }
    .balance-row { color:#b42318; }
    .receipt-note { margin-top:4px; color:#475467; font-size:9.5px; overflow-wrap:anywhere; }
    .code-wrap { margin:6px auto; text-align:center; max-width:100%; overflow:hidden; }
    ${UNIVERSAL_FOOTER_CSS}
    @media screen { body { background:#f2f4f7; padding:14px 0; } .milling-intake-receipt { background:#fff; box-shadow:0 2px 16px rgba(16,24,40,.12); } }
  </style>
</head>
<body>
  <main class="milling-intake-receipt">
    ${isMillingIntake ? receiptLogo : companyHeader}
    <section class="receipt-meta">
      ${opts.showDocNumberDate ? metadataRow(isMillingIntake ? "رقم السند:" : "رقم المستند:", doc.number, "ltr") : ""}
      ${opts.showDocNumberDate && relatedInvoice ? metadataRow(isMillingIntake ? "فاتورة الأجور:" : "المرجع:", relatedInvoice, "ltr") : ""}
      ${opts.showDocNumberDate && doc.date ? metadataRow("التاريخ:", formatPrintedDateTime(doc.date), "ltr") : ""}
      ${opts.showCustomerInfo && doc.partyName ? metadataRow(doc.partyLabel || "العميل:", doc.partyName) : ""}
      ${opts.showCustomerInfo && doc.partyPhone ? metadataRow("الهاتف:", doc.partyPhone, "ltr") : ""}
      ${!isMillingIntake && opts.showMovementInfo && doc.warehouse ? metadataRow("المستودع:", doc.warehouse) : ""}
      ${!isMillingIntake && opts.showPaymentInfo && doc.payment ? metadataRow("طريقة الدفع:", doc.payment) : ""}
      ${!isMillingIntake && doc.operatorName ? metadataRow("البائع / المستخدم:", doc.operatorName) : ""}
    </section>
    <hr class="receipt-divider" />
    ${isMillingIntake
      ? `<section class="grain-section">
          <div class="grain-heading"><h1>تفاصيل الحبوب المستلمة:</h1><span class="custody-badge">أمانة عينية</span></div>
          ${grainCards}
        </section>`
      : `<section class="invoice-items-section"><div class="receipt-section-heading">تفاصيل البنود:</div>${invoiceItemCards || `<div class="grain-card">لا توجد بنود</div>`}</section>`}
    ${serviceRows ? `<section class="service-section">${serviceRows}</section>` : ""}
    ${financialRows}
    ${note}
    ${barcodeHtml ? `<div class="code-wrap barcode-wrap">${barcodeHtml}</div>` : ""}
    ${qrHtml ? `<div class="code-wrap qr-wrap">${qrHtml}</div>` : ""}
    ${opts.showFooter ? renderUniversalFooter(companyProfile, rtl, true) : ""}
    <div style="text-align:center;font-size:7.5px;color:#9ca3af;padding:2px 0">${COMPANY_RIGHTS_TEXT}</div>
  </main>
</body>
</html>`;
  }

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
      border-bottom: 1px solid rgba(0, 0, 0, 0.12);
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
      font-weight: 800;
      font-size: 11.5px;
      margin: 4px 0;
    }
    .company-logo { display:block; max-width:28mm; max-height:14mm; object-fit:contain; margin:0 auto 4px; }
    .code-wrap { text-align:center; margin:6px auto; max-width:100%; overflow:hidden; }
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
      font-weight: 800;
      color: #333;
      margin-top: 10px;
      padding-top: 6px;
      border-top: 1px solid rgba(0, 0, 0, 0.12);
    }
  </style>
</head>
<body onload="window.print()">
  <div class="center">
    ${logoHtml}
    ${opts.showCompanyInfo ? `<div style="font-size: 16px; font-weight: 900;">${compName}</div>` : ""}
    ${opts.showCompanyInfo && compAddress ? `<div>${compAddress}</div>` : ""}
    ${opts.showCompanyInfo && compPhone ? `<div>هاتف: ${compPhone}</div>` : ""}
    <div class="badge">${title}</div>
  </div>

  <div class="hairline-divider"></div>

  ${
    opts.showDocNumberDate
      ? `
  <div class="flex-row"><span>رقم المستند:</span><span class="bold">${esc(doc.number)}</span></div>
  <div class="flex-row"><span>التاريخ:</span><span>${esc(formatPrintedDateTime(doc.date))}</span></div>`
      : ""
  }

  ${
    opts.showCustomerInfo && doc.partyName
      ? `
  <div class="flex-row"><span>العميل:</span><span class="bold">${esc(doc.partyName)}</span></div>
  ${doc.partyPhone ? `<div class="flex-row"><span>الهاتف:</span><span>${esc(doc.partyPhone)}</span></div>` : ""}`
      : ""
  }
  ${doc.operatorName ? `<div class="flex-row"><span>البائع / المستخدم:</span><span class="bold">${esc(doc.operatorName)}</span></div>` : ""}

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
    opts.showFinancialDetails && !isDelivery
      ? `
  <div class="flex-row"><span>المجموع:</span><span>${money(doc.subtotal || doc.total)}</span></div>
  ${(doc.discount || 0) > 0 ? `<div class="flex-row"><span>الخصم:</span><span>-${money(doc.discount)}</span></div>` : ""}
  <div class="hairline-divider"></div>
  <div class="flex-row" style="font-size: 13.5px; font-weight: 900;"><span>الإجمالي النهائي:</span><span>${money(doc.total)}</span></div>
  ${doc.paid !== undefined ? `<div class="flex-row"><span>المدفوع:</span><span class="bold">${money(doc.paid)}</span></div>` : ""}
  ${(doc.balance || 0) > 0 ? `<div class="flex-row" style="color: #dc2626; font-weight: bold;"><span>المتبقي ذمة:</span><span>${money(doc.balance)}</span></div>` : ""}`
      : ""
  }

  ${
    opts.showNotes && doc.notes
      ? `
  <div style="font-size: 10.5px; margin: 4px 0; color: #444; border-top: 1px dashed #ccc; padding-top: 3px;">
    <strong>ملاحظة:</strong> ${esc(doc.notes)}
  </div>`
      : ""
  }

  ${barcodeHtml ? `<div class="code-wrap barcode-wrap">${barcodeHtml}</div>` : ""}
  ${qrHtml ? `<div class="code-wrap qr-wrap">${qrHtml}</div>` : ""}

  ${
    opts.showFooter
      ? renderUniversalFooter(companyProfile, rtl, true)
      : ""
  }
  <div style="text-align:center;font-size:7.5px;color:#9ca3af;padding:2px 0">${COMPANY_RIGHTS_TEXT}</div>
</body>
</html>`;
}
