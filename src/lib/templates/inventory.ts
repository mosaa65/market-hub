import {
  UnifiedDocumentData,
  InvoiceLabels,
  escapeHtml,
  DEFAULT_BRANDING,
  CustomFieldOptions,
} from "./types";

export function renderInventoryThermalTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions,
): string {
  const esc = escapeHtml;
  const branding = doc.brandingText || DEFAULT_BRANDING;
  const opts = { showLogo: true, showCompanyInfo: true, showDocNumberDate: true, showMovementInfo: true, showSignatures: true, showFooter: true, showBranding: true, ...options, ...doc.options };

  const rows = doc.lines
    .map(
      (l, i) => `
    <div class="li">
      <div class="ln">${i + 1}. ${esc(l.product)} ${l.code ? `<span class="code">(${esc(l.code)})</span>` : ""}</div>
      <div class="lr">
        <span>${L.qty}: <b>${l.qty} ${l.unit ? esc(l.unit) : ""}</b></span>
      </div>
    </div>`,
    )
    .join("");

  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#fff; color:#000; font-family: 'Courier New', ui-monospace, monospace; }
  .r { width: 80mm; padding: 6mm 5mm; font-size: 12px; line-height: 1.35; }
  .c { text-align: center; }
  .badge { display:inline-block; border: 1px solid #000; padding: 2px 8px; font-weight:700; font-size:12px; margin-bottom:4px; text-transform:uppercase; }
  h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .5px; }
  .muted { color:#333; font-size: 11px; }
  .hr { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display:flex; justify-content:space-between; gap:8px; font-size: 11px; }
  .li { margin: 5px 0; border-bottom: 1px dotted #ccc; padding-bottom: 3px; }
  .ln { font-weight: 700; font-size: 12px; }
  .code { font-size: 10px; color: #555; }
  .lr { display:flex; justify-content:space-between; font-size: 11.5px; margin-top: 2px; }
  .foot { text-align:center; font-size: 10px; margin-top: 8px; }
  .branding { text-align:center; font-size: 9px; color:#555; margin-top: 6px; border-top: 1px dotted #aaa; padding-top: 4px; font-weight: 500; }
  .sign-box { margin-top: 14px; border-top: 1px dashed #000; padding-top: 6px; font-size: 10px; text-align: center; }
  @media screen { body { background:#eee; padding: 20px 0; } .r { margin: 0 auto; background:#fff; box-shadow: 0 2px 20px rgba(0,0,0,.15); } }
</style></head><body onload="window.print()">
<div class="r">
  <div class="c">
    <div class="badge">${esc(doc.title || (rtl ? "مستند حركة مخزون" : "Stock Movement Document"))}</div>
    ${opts.showCompanyInfo && doc.company?.name ? `<h1>${esc(doc.company.name)}</h1>` : ""}
    ${opts.showCompanyInfo && doc.company?.address ? `<div class="muted">${esc(doc.company.address)}</div>` : ""}
  </div>
  <div class="hr"></div>
  ${opts.showDocNumberDate ? `
  <div class="row"><span>${rtl ? "رقم المستند" : "Doc No"}:</span><b>#${esc(doc.number)}</b></div>
  ${doc.relatedRef ? `<div class="row"><span>${rtl ? "العملية المرتبطة" : "Ref No"}:</span><span>#${esc(doc.relatedRef)}</span></div>` : ""}
  <div class="row"><span>${L.date}:</span><span>${esc(doc.date)}</span></div>
  ` : ""}
  
  ${opts.showMovementInfo ? `
  <div class="hr"></div>
  ${doc.movementType ? `<div class="row"><span>${rtl ? "نوع الحركة" : "Movement"}:</span><b>${esc(doc.movementType)}</b></div>` : ""}
  ${doc.warehouse ? `<div class="row"><span>${rtl ? "المستودع" : "Warehouse"}:</span><span>${esc(doc.warehouse)}</span></div>` : ""}
  ${doc.destinationWarehouse ? `<div class="row"><span>${rtl ? "المستودع الوجهة" : "Destination"}:</span><span>${esc(doc.destinationWarehouse)}</span></div>` : ""}
  ${doc.operatorName ? `<div class="row"><span>${rtl ? "المسؤول" : "Operator"}:</span><span>${esc(doc.operatorName)}</span></div>` : ""}
  ` : ""}

  <div class="hr"></div>
  <div style="font-weight:700; font-size:11px; margin-bottom:4px">${rtl ? "تفاصيل الاصناف والمخزون" : "Stock Items"}</div>
  ${rows}
  <div class="hr"></div>

  ${opts.showNotes && doc.notes ? `
  <div style="font-size:10.5px; margin: 4px 0;"><b>${rtl ? "ملاحظات" : "Notes"}:</b> ${esc(doc.notes)}</div>
  <div class="hr"></div>
  ` : ""}

  ${opts.showSignatures ? `
  <div class="sign-box">
    ${rtl ? "توقيع أمين المستودع / المستلم" : "Warehouse Keeper Signature"}
    <div style="height: 30px;"></div>
  </div>
  ` : ""}

  ${opts.showFooter ? `<div class="foot">${L.thanks || (rtl ? "مستند موثق مخزنياً" : "Verified Stock Record")}</div>` : ""}
  ${opts.showBranding ? `<div class="branding">${esc(branding)}</div>` : ""}
</div></body></html>`;
}

export function renderInventoryStandardTemplate(
  doc: UnifiedDocumentData,
  L: InvoiceLabels,
  rtl: boolean,
  options?: CustomFieldOptions,
): string {
  const esc = escapeHtml;
  const branding = doc.brandingText || DEFAULT_BRANDING;
  const opts = { showLogo: true, showCompanyInfo: true, showDocNumberDate: true, showMovementInfo: true, showSignatures: true, showFooter: true, showBranding: true, ...options, ...doc.options };

  const rows = doc.lines
    .map(
      (l, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td class="mono">${esc(l.code ?? "—")}</td>
      <td><b>${esc(l.product)}</b></td>
      <td class="c font-bold">${l.qty}</td>
      <td class="c">${esc(l.unit ?? "حبة")}</td>
      <td>${esc(l.note ?? "—")}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#fff; color:#0f172a; font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; font-size: 12px; }
  .doc { max-width: 820px; margin: 0 auto; position: relative; min-height: 90vh; display: flex; flex-direction: column; }
  .content { flex: 1; }
  header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:14px; border-bottom: 3px solid #0f172a; }
  .co h1 { margin:0 0 4px; font-size: 24px; font-weight: 800; color:#0f172a; }
  .co div { color:#475569; font-size: 11px; }
  .inv { text-align: ${rtl ? "left" : "right"}; }
  .inv .type-tag { display:inline-block; background:#0f172a; color:#fff; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
  .inv .n { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color:#334155; font-weight: 600; }
  .meta-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
  .card { border:1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
  .card .k { font-size: 10px; color:#64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
  .card .v { font-size: 13px; font-weight: 700; margin-top: 2px; color: #0f172a; }
  table { width:100%; border-collapse: collapse; margin-top: 12px; }
  thead th { background:#1e293b; color:#fff; padding: 10px 12px; font-size: 11px; text-align:${rtl ? "right" : "left"}; font-weight:700; }
  tbody td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 12.5px; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .c { text-align:center; } .e { text-align:${rtl ? "left" : "right"}; } .mono { font-family: 'IBM Plex Mono', monospace; }
  .font-bold { font-weight: 700; }
  .notes-box { margin-top: 20px; padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font-size: 11.5px; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 40px; text-align: center; }
  .sig-line { border-top: 1px solid #0f172a; padding-top: 6px; font-size: 11px; font-weight: 600; color: #475569; }
  footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #cbd5e1; text-align:center; color:#64748b; font-size: 10.5px; }
  .branding { font-size: 9.5px; color: #94a3b8; font-weight: 600; margin-top: 4px; }
  @media screen { body { background:#f1f5f9; padding: 20px; } .doc { background:#fff; padding: 30px; box-shadow: 0 4px 30px rgba(0,0,0,.08); border-radius: 12px; } }
</style></head><body onload="window.print()">
<div class="doc">
  <div class="content">
    <header>
      <div class="co">
        ${opts.showCompanyInfo && doc.company?.name ? `<h1>${esc(doc.company.name)}</h1>` : "<h1>مستند مخزني</h1>"}
        ${opts.showCompanyInfo && doc.company?.address ? `<div>${esc(doc.company.address)}</div>` : ""}
        ${opts.showCompanyInfo && doc.company?.phone ? `<div>هاتف: ${esc(doc.company.phone)}</div>` : ""}
      </div>
      <div class="inv">
        <div class="type-tag">${esc(doc.title || (rtl ? "مستند حركة مخزون" : "Stock Movement"))}</div>
        ${opts.showDocNumberDate ? `
        <div class="n">رقم المستند: #${esc(doc.number)}</div>
        ${doc.relatedRef ? `<div class="n">مرجع العملية: #${esc(doc.relatedRef)}</div>` : ""}
        <div class="n">التاريخ: ${esc(doc.date)}</div>
        ` : ""}
      </div>
    </header>

    ${opts.showMovementInfo ? `
    <div class="meta-grid">
      <div class="card"><div class="k">${rtl ? "نوع الحركة" : "Movement Type"}</div><div class="v">${esc(doc.movementType ?? "صرف / تحويل")}</div></div>
      <div class="card"><div class="k">${rtl ? "المستودع الرئيسي" : "Warehouse"}</div><div class="v">${esc(doc.warehouse ?? "—")}</div></div>
      <div class="card"><div class="k">${rtl ? "المستودع الوجهة" : "Destination"}</div><div class="v">${esc(doc.destinationWarehouse ?? "—")}</div></div>
      <div class="card"><div class="k">${rtl ? "المسؤول / المشغل" : "Operator"}</div><div class="v">${esc(doc.operatorName ?? "—")}</div></div>
    </div>
    ` : ""}

    <table>
      <thead>
        <tr>
          <th class="c" style="width:40px">#</th>
          <th style="width:130px">${rtl ? "الرمز / الباركود" : "SKU"}</th>
          <th>${rtl ? "اسم المنتج / الصنف" : "Product Description"}</th>
          <th class="c" style="width:90px">${rtl ? "الكمية" : "Qty"}</th>
          <th class="c" style="width:80px">${rtl ? "الوحدة" : "Unit"}</th>
          <th>${rtl ? "ملاحظات الصنف" : "Item Note"}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${opts.showNotes && doc.notes ? `
    <div class="notes-box">
      <b>${rtl ? "ملاحظات المستند:" : "Document Notes:"}</b> ${esc(doc.notes)}
    </div>
    ` : ""}

    ${opts.showSignatures ? `
    <div class="signatures">
      <div><div style="height:45px"></div><div class="sig-line">${rtl ? "توقيع المستلم" : "Recipient Signature"}</div></div>
      <div><div style="height:45px"></div><div class="sig-line">${rtl ? "أمين المستودع" : "Warehouse Keeper"}</div></div>
      <div><div style="height:45px"></div><div class="sig-line">${rtl ? "اعتماد الإدارة" : "Authorized"}</div></div>
    </div>
    ` : ""}
  </div>

  ${opts.showFooter ? `
  <footer>
    <div>${rtl ? "تم إنشاء وتوثيق هذا المستند عبر نظام فورتكس ERP للمخزون" : "System Generated Stock Movement Document"}</div>
    ${opts.showBranding ? `<div class="branding">${esc(branding)}</div>` : ""}
  </footer>
  ` : ""}
</div></body></html>`;
}
