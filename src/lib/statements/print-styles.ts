/**
 * Statement Print Styles — CSS القالب (A4 · RTL/LTR · متعدد الصفحات)
 *
 * مفصول عن print.ts حتى تبقى ملفات القالب صغيرة وقابلة للمراجعة،
 * وحتى لا تختلط الأنماط بمنطق بناء HTML.
 */

export function statementPrintStyles(lang: "ar" | "en"): string {
  const start = lang === "ar" ? "right" : "left";

  return `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
:root {
  --ink: #0a1128; --gold: #b8935a; --line: #e2dfd6; --muted: #6b6860;
  --bg: #fffdf9; --surface: #f8f6f0; --debit: #b91c1c; --credit: #047857;
}
html, body { margin:0; padding:0; background:var(--bg); color:var(--ink);
  font-family:'Cairo','Segoe UI',Tahoma,sans-serif; font-size:11.5px; line-height:1.45;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { max-width:210mm; margin:0 auto; padding:20px 22px; position:relative; }

/* ── Header ── */
.rpt-head { display:flex; justify-content:space-between; align-items:flex-start; gap:18px;
  padding-bottom:12px; border-bottom:2.5px solid var(--ink); }
.co { display:flex; gap:10px; align-items:flex-start; }
.co-logo { width:52px; height:52px; object-fit:contain; border:1px solid var(--line);
  border-radius:8px; padding:3px; background:#fff; }
.co-logo-fallback { width:52px; height:52px; display:grid; place-items:center;
  border:1px solid var(--line); border-radius:8px; background:var(--surface);
  font-weight:800; color:var(--gold); font-size:19px; }
.co-name { font-family:'Amiri',serif; font-size:21px; font-weight:700; margin:0; line-height:1.25; }
.co-legal { font-size:10.5px; color:var(--muted); }
.co-lines { font-size:10px; color:var(--muted); margin-top:3px; line-height:1.5; }
.rpt-title { text-align:${start}; min-width:180px; }
.rpt-title h2 { font-family:'Amiri',serif; font-size:19px; font-weight:700; margin:0; color:var(--gold); }
.rpt-title .sub { font-size:10px; color:var(--muted); margin-top:3px; }
.rpt-title .period { font-family:'IBM Plex Mono',monospace; font-size:10.5px;
  background:var(--surface); border:1px solid var(--line); padding:3px 9px; border-radius:5px;
  display:inline-block; margin-top:5px; }
.rpt-title .stamp { font-size:9.5px; color:var(--muted); margin-top:4px; }

/* ── Reference report layout ── */
.legacy-head { min-height:78px; align-items:center; border-bottom:1px solid #777; padding:4px 0 8px; }
.legacy-brand { display:flex; flex-direction:column; align-items:center; width:145px; color:#111; }
.legacy-brand .co-logo, .legacy-brand .co-logo-fallback { width:58px; height:58px; border:0; border-radius:0; padding:0; }
.legacy-brand-name { font-size:10px; font-weight:700; margin-top:3px; }
.legacy-title { flex:1; text-align:center !important; min-width:0; }
.legacy-title h2 { color:#404040; font-family:'Cairo','Segoe UI',Tahoma,sans-serif; font-size:23px; margin:0; }
.legacy-title .sub { color:#555; font-size:10px; }
.legacy-title .period { background:transparent; border:0; font-family:'Cairo','Segoe UI',Tahoma,sans-serif; font-size:10px; margin-top:2px; padding:0; }
.legacy-branch { width:145px; display:flex; flex-direction:column; gap:2px; text-align:right; font-size:10px; color:#222; }
.legacy-branch span, .legacy-branch small { color:#555; font-size:9px; }
.legacy-statement-table { table-layout:fixed; margin-top:8px; border:1px solid #777; font-size:10px; }
.legacy-statement-table th, .legacy-statement-table td { border:1px solid #aaa; padding:4px 5px; text-align:center; }
.legacy-statement-table th { background:#f2f2f2; color:#111; font-size:10px; font-weight:700; }
.legacy-statement-table .legacy-col-0 { width:4%; }
.legacy-statement-table .legacy-col-1 { width:25%; text-align:right; }
.legacy-statement-table .legacy-col-2 { width:13%; }
.legacy-statement-table .legacy-col-3 { width:13%; }
.legacy-statement-table .legacy-col-4, .legacy-statement-table .legacy-col-5,
.legacy-statement-table .legacy-col-6, .legacy-statement-table .legacy-col-7 { width:11.25%; }
.legacy-statement-table .legacy-description { text-align:right; }
.legacy-statement-table td { color:#333; font-family:'Tahoma','Segoe UI',sans-serif; }
.legacy-statement-table td.debit, .legacy-statement-table td.balance-debit { color:#233b76; }
.legacy-statement-table td.credit, .legacy-statement-table td.balance-credit { color:#5c2130; }
.legacy-statement-table tr.opening td { background:#fafafa; color:#333; }
.legacy-statement-table tr.month-total td { background:#bdbd; color:#111; font-weight:700; border-top:2px solid #333; }
.legacy-statement-table tr.grand-total td { background:#a9a9a9; color:#fff; font-weight:700; border-top:2px solid #222; }
.legacy-currency { margin-top:4px; font-size:9px; color:#666; text-align:left; }

.luxury-report-table { width:100%; border-collapse:collapse; margin-top:8px; border:1px solid #777; font-size:10px; }
.luxury-report-table th, .luxury-report-table td { border:1px solid #aaa; padding:5px 6px; }
.luxury-report-table th { background:#f2f2f2; color:#111; font-size:10px; font-weight:700; }
.luxury-report-table td { color:#333; font-family:'Tahoma','Segoe UI',sans-serif; }
.luxury-report-table td.num { font-family:'IBM Plex Mono',monospace; }
.luxury-report-table td.debit { color:#233b76; font-weight:600; }
.luxury-report-table td.credit { color:#5c2130; font-weight:600; }
.luxury-report-table tr:nth-child(even) td { background:rgba(248,246,240,.4); }
.luxury-report-table tr.subtotal td { background:#e8f5e9; color:#1b5e20; font-weight:700; border-top:1.5px solid #2e7d32; }
.luxury-report-table tr.grand-total td { background:#a9a9a9; color:#fff; font-weight:700; border-top:2px solid #222; }
.luxury-report-table tr.grand-total td.debit, .luxury-report-table tr.grand-total td.credit { color:#fff; }
.luxury-cards { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 8px; }
.luxury-card { flex:1; min-width:100px; background:#fff; border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
.luxury-card .lc-label { font-size:9.5px; color:var(--muted); }
.luxury-card .lc-val { font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:700; color:var(--ink); margin-top:2px; }

/* ── Entity + Summary ── */
.meta-grid { display:grid; grid-template-columns:1.05fr 1.35fr; gap:12px; margin:12px 0 10px; }
.box { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#fff; }
.box-h { background:var(--surface); padding:5px 10px; font-size:10px; font-weight:700;
  letter-spacing:.6px; color:var(--muted); border-bottom:1px solid var(--line); }
.box-b { padding:8px 10px; }
.kv { display:flex; justify-content:space-between; gap:12px; padding:2.5px 0; font-size:11px; }
.kv .k { color:var(--muted); }
.kv .v { font-weight:600; }

.sum-grid { display:grid; grid-template-columns:1fr 1fr; }
.sum { padding:7px 10px; border-bottom:1px solid var(--line); }
.sum:nth-child(odd) { border-inline-end:1px solid var(--line); }
.sum .sk { font-size:9.5px; color:var(--muted); letter-spacing:.4px; }
.sum .sv { font-family:'IBM Plex Mono',monospace; font-size:14px; font-weight:700; margin-top:2px; }
.sv.debit { color:var(--debit); }
.sv.credit { color:var(--credit); }
.sum-final { background:var(--ink); color:#fff; grid-column:1 / -1; border-bottom:none; }
.sum-final .sk { color:rgba(255,255,255,.72); }
.sum-final .sv { color:#fff; font-size:15px; }
.sum-final .dir { font-size:9.5px; color:rgba(255,255,255,.66); margin-top:1px; }

/* ── Integrity warning ── */
.warn { margin:0 0 10px; border:1px solid #f59e0b; background:#fffbeb; border-radius:7px;
  padding:7px 10px; font-size:10.5px; color:#92400e; display:flex; gap:7px; align-items:flex-start; }
.warn b { display:block; margin-bottom:2px; }

/* ── Table ── */
table { width:100%; border-collapse:collapse; }
thead { display:table-header-group; }
tfoot { display:table-footer-group; }
tr { page-break-inside:avoid; }
th { background:var(--ink); color:#fff; padding:7px 8px; font-size:10.5px; font-weight:600;
  letter-spacing:.3px; white-space:nowrap; }
td { padding:6px 8px; border-bottom:1px solid var(--line); font-size:11px; vertical-align:top; }
tbody tr:nth-child(even) { background:rgba(248,246,240,.55); }
td.num { font-family:'IBM Plex Mono',monospace; white-space:nowrap; }
td.debit { color:var(--debit); }
td.credit { color:var(--credit); }
td.balance { font-weight:700; }
tr.opening td { background:var(--surface); font-style:italic; color:var(--muted); }
tr.opening td.balance { color:var(--ink); font-style:normal; }
tr.totals td { background:var(--ink); color:#fff; font-weight:700; font-size:11.5px; border-bottom:none; }
tr.totals td.debit, tr.totals td.credit { color:#fff; }
td.empty { text-align:center; padding:22px; color:var(--muted); font-size:12px; }

/* ── Aging chips ── */
.age-chip { display:inline-block; padding:1px 6px; border-radius:9px; font-size:9.5px; font-weight:700; }
.age-ok { background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; }
.age-warn { background:#fffbeb; color:#b45309; border:1px solid #fde68a; }
.age-bad { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; }

/* ── Footer ── */
.notes { margin-top:14px; border:1px dashed var(--line); border-radius:7px; padding:8px 10px;
  font-size:10.5px; color:var(--muted); min-height:38px; }
.sigs { display:flex; justify-content:space-between; gap:34px; margin-top:26px; }
.sig { flex:1; text-align:center; }
.sig .pad { height:34px; }
.sig .line { border-top:1.5px solid var(--ink); padding-top:5px; font-size:10px;
  color:var(--muted); letter-spacing:.6px; }
.rpt-foot { margin-top:16px; padding-top:9px; border-top:1px solid var(--line);
  display:flex; justify-content:space-between; gap:14px; align-items:flex-start;
  font-size:9.5px; color:var(--muted); }
.brand { display:flex; gap:8px; align-items:center; }
.brand img { width:20px; height:20px; object-fit:contain; }
.brand-txt b { color:var(--ink); font-size:10.5px; }
.brand-txt div { line-height:1.5; }
.pagenum { text-align:center; font-family:'IBM Plex Mono',monospace; }

/* ── Screen preview only ── */
@media screen {
  body { background:#e8e4db; padding:18px 0; }
  .page { background:#fff; box-shadow:0 12px 46px rgba(0,0,0,.16); border-radius:6px; }
}
@media print {
  body { background:#fff; margin:0; }
  .page { box-shadow:none; padding:10mm 12mm 12mm 12mm; max-width:none; width:100%; }
}
`;
}
