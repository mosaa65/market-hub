/**
 * Arabic PDF & Print System for Vortex ERP
 * 
 * Since jsPDF doesn't natively support Arabic shaping/RTL well,
 * we use a hybrid approach:
 *   - For invoices: HTML print templates (already excellent Arabic support via browser fonts)
 *   - For PDF downloads: jsPDF with embedded Arabic font for simple text + autoTable
 *   - For reports: HTML print templates with Cairo/Amiri Google Fonts
 * 
 * This module provides the unified PDF generation with Arabic font embedding.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceLine {
  product: string;
  qty: number;
  price: number;
  total: number;
}

export interface InvoiceDoc {
  title: string;
  number: string;
  date: string;
  partyLabel: string;
  partyName: string;
  warehouse?: string;
  payment?: string;
  status?: string;
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paid?: number;
  company?: { name?: string; address?: string; phone?: string; vat?: string };
  currency?: string;
}

export interface ReportColumn {
  key: string;
  header: string;
  align?: "left" | "center" | "right";
  width?: number;
  format?: "money" | "number" | "text";
}

export interface ReportPrintData {
  title: string;
  subtitle?: string;
  date?: string;
  periodLabel?: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  totalsRow?: Record<string, string | number>;
  summaryCards?: { label: string; value: string; color?: string }[];
  company?: { name?: string; address?: string; phone?: string; vat?: string };
  currency?: string;
  rtl?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMoney(n: number, cur = "") {
  const formatted = new Intl.NumberFormat("ar-YE", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  return cur ? `${formatted} ${cur}` : formatted;
}

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------------------
// Generate Invoice PDF (jsPDF - for basic LTR/mixed, fallback)
// ---------------------------------------------------------------------------

export function generateInvoicePDF(doc: InvoiceDoc) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const w = pdf.internal.pageSize.getWidth();
  const cur = doc.currency ?? "";
  const m = (n: number) => `${cur} ${Number(n).toFixed(2)}`;

  // Header
  pdf.setFontSize(20).setFont("helvetica", "bold");
  pdf.text(doc.company?.name ?? "Vortex ERP", 14, 18);
  pdf.setFontSize(9).setFont("helvetica", "normal").setTextColor(120);
  if (doc.company?.address) pdf.text(doc.company.address, 14, 24);
  if (doc.company?.phone) pdf.text(doc.company.phone, 14, 29);
  if (doc.company?.vat) pdf.text(`VAT: ${doc.company.vat}`, 14, 34);

  pdf.setFontSize(16).setFont("helvetica", "bold").setTextColor(0);
  pdf.text(doc.title, w - 14, 18, { align: "right" });
  pdf.setFontSize(10).setFont("helvetica", "normal").setTextColor(80);
  pdf.text(`#${doc.number}`, w - 14, 24, { align: "right" });
  pdf.text(doc.date, w - 14, 29, { align: "right" });

  // Party block
  pdf.setDrawColor(220).line(14, 42, w - 14, 42);
  pdf.setFontSize(9).setTextColor(120);
  pdf.text(doc.partyLabel.toUpperCase(), 14, 48);
  pdf.setFontSize(11).setTextColor(0).setFont("helvetica", "bold");
  pdf.text(doc.partyName, 14, 53);
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(80);
  if (doc.warehouse) pdf.text(`Warehouse: ${doc.warehouse}`, 14, 59);
  if (doc.payment) pdf.text(`Payment: ${doc.payment}`, w - 14, 53, { align: "right" });
  if (doc.status) pdf.text(`Status: ${doc.status}`, w - 14, 59, { align: "right" });

  // Items table
  autoTable(pdf, {
    startY: 66,
    head: [["#", "Product", "Qty", "Price", "Total"]],
    body: doc.lines.map((l, i) => [String(i + 1), l.product, String(l.qty), m(l.price), m(l.total)]),
    theme: "striped",
    headStyles: { fillColor: [30, 30, 35], textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: { 0: { cellWidth: 12 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });

  const endY = (pdf as any).lastAutoTable.finalY ?? 100;

  // Totals
  const tx = w - 14;
  const totRows: [string, string][] = [
    ["Subtotal", m(doc.subtotal)],
    ["Tax", m(doc.tax)],
    ["Discount", m(doc.discount)],
    ["Total", m(doc.total)],
  ];
  if (doc.paid !== undefined) totRows.push(["Paid", m(doc.paid)], ["Balance", m(doc.total - doc.paid)]);

  pdf.setFontSize(10);
  totRows.forEach((r, i) => {
    const y = endY + 8 + i * 6;
    const bold = r[0] === "Total" || r[0] === "Balance";
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setTextColor(bold ? 0 : 90);
    pdf.text(r[0], tx - 50, y);
    pdf.text(r[1], tx, y, { align: "right" });
  });

  // Footer
  const fy = pdf.internal.pageSize.getHeight() - 12;
  pdf.setDrawColor(220).line(14, fy - 4, w - 14, fy - 4);
  pdf.setFontSize(8).setTextColor(140).setFont("helvetica", "normal");
  pdf.text("Thank you for your business — Generated by Vortex ERP", w / 2, fy, { align: "center" });

  pdf.save(`${doc.number}.pdf`);
}

// ---------------------------------------------------------------------------
// Print Report via HTML Window (Arabic-first, RTL, Google Fonts)
// ---------------------------------------------------------------------------

export function printReport(data: ReportPrintData) {
  const rtl = data.rtl ?? true;
  const cur = data.currency ?? "﷼";

  const formatCell = (val: string | number, col: ReportColumn) => {
    if (col.format === "money" && typeof val === "number") return fmtMoney(val, cur);
    if (col.format === "number" && typeof val === "number") return new Intl.NumberFormat("ar-YE").format(val);
    return esc(val);
  };

  const headerCells = data.columns.map(c =>
    `<th style="text-align:${c.align ?? (rtl ? 'right' : 'left')}; ${c.width ? `width:${c.width}px;` : ''}">${esc(c.header)}</th>`
  ).join("");

  const bodyRows = data.rows.map(row =>
    `<tr>${data.columns.map(c =>
      `<td style="text-align:${c.align ?? (rtl ? 'right' : 'left')}">${formatCell(row[c.key] ?? "", c)}</td>`
    ).join("")}</tr>`
  ).join("");

  const totalsRowHtml = data.totalsRow
    ? `<tr class="totals-row">${data.columns.map(c =>
        `<td style="text-align:${c.align ?? (rtl ? 'right' : 'left')}">${formatCell(data.totalsRow![c.key] ?? "", c)}</td>`
      ).join("")}</tr>`
    : "";

  const summaryHtml = data.summaryCards?.length
    ? `<div class="summary-cards">${data.summaryCards.map(s =>
        `<div class="scard" style="border-color:${s.color ?? '#b8935a'}">
          <div class="sk">${esc(s.label)}</div>
          <div class="sv" style="color:${s.color ?? '#0a1128'}">${esc(s.value)}</div>
        </div>`
      ).join("")}</div>`
    : "";

  const html = `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}" lang="${rtl ? 'ar' : 'en'}"><head><meta charset="utf-8"><title>${esc(data.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Amiri:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 12mm 15mm; }
  * { box-sizing: border-box; }
  :root {
    --ink: #0a1128; --gold: #b8935a; --gold-light: #d4b483; --line: #e2dfd6;
    --muted: #6b6860; --bg: #fffdf9; --surface: #f8f6f0;
  }
  html, body { margin:0; padding:0; background: var(--bg); color: var(--ink);
    font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; font-size: 12px; line-height: 1.5; }

  .page { max-width: 210mm; margin: 0 auto; padding: 24px 28px; position: relative; }

  /* Header */
  .report-header { display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 16px; border-bottom: 2px solid var(--ink); margin-bottom: 20px; }
  .co-info h1 { font-family: 'Amiri', serif; font-size: 28px; font-weight: 700; margin: 0; color: var(--ink); }
  .co-info .sub { color: var(--muted); font-size: 11px; line-height: 1.6; margin-top: 4px; }
  .report-title { text-align: ${rtl ? 'left' : 'right'}; }
  .report-title h2 { font-family: 'Amiri', serif; font-size: 24px; font-weight: 700; margin: 0; color: var(--gold); }
  .report-title .meta { color: var(--muted); font-size: 11px; margin-top: 4px; }
  .report-title .period { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink);
    background: var(--surface); padding: 3px 10px; border-radius: 4px; display: inline-block; margin-top: 6px; }

  /* Summary Cards */
  .summary-cards { display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
  .scard { flex: 1; min-width: 140px; padding: 12px 14px; border-radius: 6px; background: var(--surface);
    border-top: 3px solid var(--gold); }
  .sk { font-size: 10px; color: var(--muted); letter-spacing: 1.5px; text-transform: uppercase; }
  .sv { font-family: 'IBM Plex Mono', monospace; font-size: 18px; font-weight: 700; margin-top: 4px; }

  /* Table */
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  thead th { background: var(--ink); color: #fff; padding: 10px 10px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.5px; white-space: nowrap; }
  tbody td { padding: 9px 10px; border-bottom: 1px solid var(--line); font-size: 12px; }
  tbody tr:nth-child(even) { background: rgba(248,246,240,.6); }
  tbody tr:hover { background: rgba(184,147,90,.06); }
  .totals-row td { background: var(--ink) !important; color: #fff !important; font-weight: 700; font-size: 13px;
    border-bottom: none; padding: 11px 10px; }

  /* Mono for numbers */
  td:nth-child(n+2) { font-family: 'IBM Plex Mono', monospace; }

  /* Footer */
  .report-footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--line);
    display: flex; justify-content: space-between; align-items: center; }
  .report-footer .stamp { color: var(--muted); font-size: 10px; }
  .report-footer .branding { font-family: 'Amiri', serif; font-size: 12px; color: var(--gold);
    letter-spacing: 2px; }

  /* Signatures */
  .signatures { display: flex; justify-content: space-between; gap: 40px; margin-top: 40px; }
  .sig { flex: 1; text-align: center; }
  .sig .line { border-top: 1px solid var(--ink); padding-top: 6px; color: var(--muted); font-size: 10px;
    letter-spacing: 1.5px; }

  /* Print */
  @media screen { body { background: #e8e4db; padding: 20px 0; }
    .page { background: #fff; box-shadow: 0 10px 50px rgba(0,0,0,.15); border-radius: 4px; } }
  @media print { body { background: #fff; } .page { box-shadow: none; } }
</style></head><body onload="setTimeout(()=>window.print(),400)">
<div class="page">
  <div class="report-header">
    <div class="co-info">
      <h1>${esc(data.company?.name ?? "Vortex ERP")}</h1>
      <div class="sub">
        ${data.company?.address ? `${esc(data.company.address)}<br>` : ""}
        ${data.company?.phone ? `${esc(data.company.phone)}<br>` : ""}
        ${data.company?.vat ? `${rtl ? "الرقم الضريبي" : "VAT"}: ${esc(data.company.vat)}` : ""}
      </div>
    </div>
    <div class="report-title">
      <h2>${esc(data.title)}</h2>
      ${data.subtitle ? `<div class="meta">${esc(data.subtitle)}</div>` : ""}
      ${data.periodLabel ? `<div class="period">${esc(data.periodLabel)}</div>` : ""}
      ${data.date ? `<div class="meta" style="margin-top:4px">${esc(data.date)}</div>` : ""}
    </div>
  </div>

  ${summaryHtml}

  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}${totalsRowHtml}</tbody>
  </table>

  <div class="signatures">
    <div class="sig"><div style="height:40px"></div><div class="line">${rtl ? "المراجع والمدقق" : "Auditor"}</div></div>
    <div class="sig"><div style="height:40px"></div><div class="line">${rtl ? "المحاسب المسؤول" : "Accountant"}</div></div>
    <div class="sig"><div style="height:40px"></div><div class="line">${rtl ? "المدير العام" : "General Manager"}</div></div>
  </div>

  <div class="report-footer">
    <div class="stamp">${rtl ? "طُبع بواسطة نظام فورتكس المحاسبي" : "Printed by Vortex ERP"} — ${new Date().toLocaleString(rtl ? "ar-YE" : "en-US")}</div>
    <div class="branding">VORTEX ERP</div>
  </div>
</div></body></html>`;

  openPrintWindow(html);
}

// ---------------------------------------------------------------------------
// Print Financial Statement (P&L / Balance Sheet style)
// ---------------------------------------------------------------------------

export interface FinancialStatementSection {
  title: string;
  items: { label: string; value: number; bold?: boolean; color?: string }[];
  total?: { label: string; value: number; color?: string };
}

export interface FinancialStatementData {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  sections: FinancialStatementSection[];
  grandTotal?: { label: string; value: number; color?: string };
  company?: { name?: string; address?: string; phone?: string; vat?: string };
  currency?: string;
  rtl?: boolean;
  twoColumn?: boolean;
  columnTitles?: [string, string];
}

export function printFinancialStatement(data: FinancialStatementData) {
  const rtl = data.rtl ?? true;
  const cur = data.currency ?? "﷼";
  const m = (n: number) => fmtMoney(n, cur);

  const renderSection = (sec: FinancialStatementSection) => `
    <div class="fs-section">
      <div class="fs-section-title">${esc(sec.title)}</div>
      ${sec.items.map(item => `
        <div class="fs-row ${item.bold ? 'bold' : ''}">
          <span>${esc(item.label)}</span>
          <span class="mono" style="${item.color ? `color:${item.color}` : ''}">${m(item.value)}</span>
        </div>
      `).join("")}
      ${sec.total ? `
        <div class="fs-section-total" style="${sec.total.color ? `color:${sec.total.color};border-color:${sec.total.color}` : ''}">
          <span>${esc(sec.total.label)}</span>
          <span class="mono">${m(sec.total.value)}</span>
        </div>
      ` : ""}
    </div>
  `;

  let bodyContent: string;
  if (data.twoColumn && data.sections.length >= 2) {
    const mid = Math.ceil(data.sections.length / 2);
    const left = data.sections.slice(0, mid).map(renderSection).join("");
    const right = data.sections.slice(mid).map(renderSection).join("");
    bodyContent = `
      <div class="fs-columns">
        <div class="fs-col">
          ${data.columnTitles ? `<div class="fs-col-title">${esc(data.columnTitles[0])}</div>` : ""}
          ${left}
        </div>
        <div class="fs-col">
          ${data.columnTitles ? `<div class="fs-col-title">${esc(data.columnTitles[1])}</div>` : ""}
          ${right}
        </div>
      </div>
    `;
  } else {
    bodyContent = data.sections.map(renderSection).join("");
  }

  const html = `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}" lang="${rtl ? 'ar' : 'en'}"><head><meta charset="utf-8"><title>${esc(data.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Amiri:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  :root { --ink:#0a1128; --gold:#b8935a; --line:#e2dfd6; --muted:#6b6860; --bg:#fffdf9; --surface:#f8f6f0; }
  html,body { margin:0; padding:0; background:var(--bg); color:var(--ink);
    font-family:'Cairo','Segoe UI',Tahoma,sans-serif; font-size:12px; line-height:1.5; }
  .page { max-width:210mm; margin:0 auto; padding:24px 28px; }
  .mono { font-family:'IBM Plex Mono',monospace; }

  /* Header */
  .fs-header { text-align:center; padding-bottom:16px; border-bottom:2px solid var(--ink); margin-bottom:20px; }
  .fs-header h1 { font-family:'Amiri',serif; font-size:28px; margin:0; }
  .fs-header h2 { font-family:'Amiri',serif; font-size:22px; margin:6px 0 0; color:var(--gold); }
  .fs-header .meta { color:var(--muted); font-size:11px; margin-top:6px; }
  .fs-header .period { font-family:'IBM Plex Mono',monospace; font-size:11px; background:var(--surface);
    padding:3px 12px; border-radius:4px; display:inline-block; margin-top:6px; }

  /* Sections */
  .fs-section { margin-bottom:16px; }
  .fs-section-title { font-size:12px; font-weight:700; color:var(--gold); letter-spacing:1px;
    text-transform:uppercase; padding:6px 0; border-bottom:1px solid var(--line); margin-bottom:6px; }
  .fs-row { display:flex; justify-content:space-between; padding:6px 12px; font-size:12.5px; }
  .fs-row.bold { font-weight:700; }
  .fs-row:nth-child(even) { background:rgba(248,246,240,.5); }
  .fs-section-total { display:flex; justify-content:space-between; padding:10px 12px; margin-top:6px;
    font-weight:700; font-size:14px; border-top:2px solid var(--ink); background:var(--surface); border-radius:4px; }

  /* Two columns layout */
  .fs-columns { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
  .fs-col { border:1px solid var(--line); border-radius:6px; padding:16px; }
  .fs-col-title { font-family:'Amiri',serif; font-size:16px; font-weight:700; text-align:center;
    padding:8px; margin-bottom:12px; background:var(--ink); color:#fff; border-radius:4px; }

  /* Grand Total */
  .fs-grand { display:flex; justify-content:space-between; padding:14px 20px; margin-top:20px;
    font-weight:800; font-size:18px; border:2px solid var(--ink); border-radius:8px;
    background:linear-gradient(135deg,var(--surface),#fff); }

  /* Footer & Signatures */
  .signatures { display:flex; justify-content:space-between; gap:40px; margin-top:50px; }
  .sig { flex:1; text-align:center; }
  .sig .line { border-top:1px solid var(--ink); padding-top:6px; color:var(--muted); font-size:10px; letter-spacing:1.5px; }
  .fs-footer { margin-top:28px; padding-top:14px; border-top:1px solid var(--line);
    display:flex; justify-content:space-between; }
  .fs-footer .stamp { color:var(--muted); font-size:10px; }
  .fs-footer .branding { font-family:'Amiri',serif; font-size:12px; color:var(--gold); letter-spacing:2px; }

  @media screen { body{background:#e8e4db;padding:20px 0;} .page{background:#fff;box-shadow:0 10px 50px rgba(0,0,0,.15);border-radius:4px;} }
  @media print { body{background:#fff;} .page{box-shadow:none;} }
</style></head><body onload="setTimeout(()=>window.print(),400)">
<div class="page">
  <div class="fs-header">
    <h1>${esc(data.company?.name ?? "Vortex ERP")}</h1>
    ${data.company?.address ? `<div style="color:var(--muted);font-size:11px">${esc(data.company.address)}</div>` : ""}
    <h2>${esc(data.title)}</h2>
    ${data.subtitle ? `<div class="meta">${esc(data.subtitle)}</div>` : ""}
    ${data.periodLabel ? `<div class="period">${esc(data.periodLabel)}</div>` : ""}
  </div>

  ${bodyContent}

  ${data.grandTotal ? `
    <div class="fs-grand" style="${data.grandTotal.color ? `color:${data.grandTotal.color};border-color:${data.grandTotal.color}` : ''}">
      <span>${esc(data.grandTotal.label)}</span>
      <span class="mono">${m(data.grandTotal.value)}</span>
    </div>
  ` : ""}

  <div class="signatures">
    <div class="sig"><div style="height:40px"></div><div class="line">${rtl ? "المراجع والمدقق" : "Auditor"}</div></div>
    <div class="sig"><div style="height:40px"></div><div class="line">${rtl ? "المحاسب المسؤول" : "Accountant"}</div></div>
    <div class="sig"><div style="height:40px"></div><div class="line">${rtl ? "المدير العام" : "General Manager"}</div></div>
  </div>

  <div class="fs-footer">
    <div class="stamp">${rtl ? "طُبع بواسطة نظام فورتكس المحاسبي" : "Printed by Vortex ERP"} — ${new Date().toLocaleString(rtl ? "ar-YE" : "en-US")}</div>
    <div class="branding">VORTEX ERP</div>
  </div>
</div></body></html>`;

  openPrintWindow(html);
}

// ---------------------------------------------------------------------------
// Open Print Window helper
// ---------------------------------------------------------------------------

function openPrintWindow(html: string) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    // popup blocked — fallback to iframe
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:9999;background:#000";
    document.body.appendChild(iframe);
    const cw = iframe.contentWindow!;
    cw.document.open(); cw.document.write(html); cw.document.close();
    setTimeout(() => {
      cw.focus(); cw.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 500);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
