/**
 * Unified printing tests — profiles, themes, documents, company profile,
 * footer and legacy normalisation.
 *
 * Runs with: npx tsx src/lib/printing/__tests__/unified-printing.test.ts
 */

import { PRINT_PAPERS, paperCss, type PrintPaperId } from "../paper";
import { PRINT_THEMES, normalizeTheme } from "../themes";
import { DOCUMENT_TYPES, getDocumentTypeMeta } from "../document-types";
import {
  normalizePrintSettings,
  DEFAULT_UNIFIED_PRINT_SETTINGS,
  PRINT_SETTINGS_KEY,
} from "../settings";
import { PRINT_ADAPTER_META, getRegisteredPrintAdapters } from "../adapters";
import { renderUnifiedDocument } from "../engine";
import { renderStandardTemplate } from "@/lib/templates/standard";
import { renderElegantTemplate } from "@/lib/templates/elegant";
import {
  renderThermalTemplate,
  renderThermalQrTemplate,
  renderThermalMillingTemplate,
  renderMillingCleanTemplate,
  renderMillingMasterTemplate,
  renderMillingThermalTemplate,
} from "@/lib/templates";
import { formatPrintedDateTime } from "@/lib/templates/unified-layout";
import { renderFormalTemplate } from "../formal";
import {
  COMPANY_RIGHTS_TEXT,
  renderInvoiceRightsFooter,
  renderUniversalFooter,
  UNIVERSAL_FOOTER_CSS,
} from "../footer";
import { DEFAULT_COMPANY_PROFILE, type CompanyProfile } from "../company-profile";
import type { UnifiedDocumentData, InvoiceLabels } from "@/lib/templates";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) passed += 1;
  else failures.push(name);
}

/* ─────────────────────────── Profiles ─────────────────────────── */

check("A4 profile exists", PRINT_PAPERS.a4.widthMm === 210 && PRINT_PAPERS.a4.heightMm === 297);
check("A5 profile exists", PRINT_PAPERS.a5.widthMm === 148 && PRINT_PAPERS.a5.heightMm === 210);
check("Thermal 58mm exists", PRINT_PAPERS["thermal-58"].widthMm === 58);
check("Thermal 80mm exists", PRINT_PAPERS["thermal-80"].widthMm === 80);
check(
  "thermal profiles are flagged",
  PRINT_PAPERS["thermal-58"].thermal && PRINT_PAPERS["thermal-80"].thermal,
);

const portraitCss = paperCss(PRINT_PAPERS.a4, "portrait");
const landscapeCss = paperCss(PRINT_PAPERS.a4, "landscape");
check("portrait paper css uses width then height", portraitCss.includes("210mm 297mm"));
check("landscape paper css swaps dimensions", landscapeCss.includes("297mm 210mm"));
check(
  "thermal paper css uses auto height",
  paperCss(PRINT_PAPERS["thermal-80"]).includes("80mm auto"),
);

/* ─────────────────────────── Themes ─────────────────────────── */

check("standard theme exists", PRINT_THEMES.standard.id === "standard");
check("luxury theme exists", PRINT_THEMES.luxury.id === "luxury");
check("formal theme exists", PRINT_THEMES.formal.id === "formal");
check("legacy 'elegant' normalises to luxury", normalizeTheme("elegant") === "luxury");
check("legacy 'premium' normalises to luxury", normalizeTheme("premium") === "luxury");
check("legacy 'normal' normalises to standard", normalizeTheme("normal") === "standard");
check("legacy 'standard' stays standard", normalizeTheme("standard") === "standard");
check("unknown theme falls back to standard", normalizeTheme("nonsense") === "standard");
check("undefined theme falls back to standard", normalizeTheme(undefined) === "standard");

/* ─────────────────────────── Settings / migration ─────────────────────────── */

check(
  "default settings are complete",
  DEFAULT_UNIFIED_PRINT_SETTINGS.behavior === "default" &&
    DEFAULT_UNIFIED_PRINT_SETTINGS.method === "browser" &&
    DEFAULT_UNIFIED_PRINT_SETTINGS.copies === 1,
);
check("settings key is the v2 store", PRINT_SETTINGS_KEY === "vortex_print_settings_v2");

const fromLegacyAuto = normalizePrintSettings({ printMode: "auto" } as never);
check("legacy printMode 'auto' migrates to direct", fromLegacyAuto.behavior === "direct");
const fromLegacyOff = normalizePrintSettings({ printMode: "off" } as never);
check("legacy printMode 'off' migrates to off", fromLegacyOff.behavior === "off");
const fromLegacyAsk = normalizePrintSettings({ printMode: "ask" } as never);
check("legacy printMode 'ask' migrates to ask", fromLegacyAsk.behavior === "ask");
check(
  "legacy paperSize 58mm migrates to thermal-58",
  normalizePrintSettings({ paperSize: "58mm" } as never).paperId === "thermal-58",
);
check(
  "legacy paperSize A4 migrates to a4",
  normalizePrintSettings({ paperSize: "A4" } as never).paperId === "a4",
);
check("copies are clamped to >= 1", normalizePrintSettings({ copies: 0 }).copies === 1);
check("copies are clamped to <= 20", normalizePrintSettings({ copies: 99 }).copies === 20);
check("NaN copies fall back to 1", normalizePrintSettings({ copies: Number.NaN }).copies === 1);
check(
  "legacy overrides survive normalisation",
  (
    normalizePrintSettings({
      overrides: { customer_invoice: { theme: "elegant" } },
    } as never).overrides.customer_invoice as { theme?: string } | undefined
  )?.theme === "elegant",
);

/* ─────────────────────────── Adapters ─────────────────────────── */

check("browser adapter declared", PRINT_ADAPTER_META.browser.capabilities.supportsPreview);
check(
  "pdf adapter does not claim copies",
  PRINT_ADAPTER_META.pdf.capabilities.supportsCopies === false,
);
check(
  "thermal adapter does not claim direct output",
  PRINT_ADAPTER_META.thermal.capabilities.supportsDirectOutput === false,
);
check("all three adapters are registered", getRegisteredPrintAdapters().length === 3);

/* ─────────────────────────── Document types ─────────────────────────── */

const REQUIRED_DOCS = [
  "customer_invoice",
  "purchase_invoice",
  "sales_return",
  "purchase_return",
  "payment_receipt",
  "customer_statement",
  "supplier_statement",
  "stock_transfer",
  "inventory_document",
  "report",
  "mill_document",
  "daily_ticket",
  "audit_record",
];
for (const id of REQUIRED_DOCS) {
  check(
    `document type registered: ${id}`,
    DOCUMENT_TYPES.some((d) => d.id === id),
  );
}
check(
  "every document type has Arabic + English names",
  DOCUMENT_TYPES.every((d) => d.nameAr.trim() && d.nameEn.trim()),
);
check(
  "unknown document type falls back safely",
  getDocumentTypeMeta("nope" as never).nameEn === "Document",
);

/* ─────────────────────────── Documents render ─────────────────────────── */

const COMPANY: CompanyProfile = {
  name: "شركة الاختبار",
  contacts: ["770000001"],
  address: "صنعاء",
  email: "test@example.com",
  logoUrl: "/inama-soft-logo.ico",
};

const LABELS: InvoiceLabels = {
  invoice: "مستند",
  date: "التاريخ",
  billTo: "الطرف",
  warehouse: "المستودع",
  payment: "الدفع",
  status: "الحالة",
  product: "الصنف",
  qty: "الكمية",
  price: "السعر",
  total: "الإجمالي",
  subtotal: "المجموع",
  tax: "الضريبة",
  discount: "الخصم",
  grandTotal: "الإجمالي النهائي",
  paid: "المدفوع",
  balance: "المتبقي",
  thanks: "شكرًا",
  poweredBy: "",
};

function docFor(docType: UnifiedDocumentData["docType"]): UnifiedDocumentData {
  return {
    docType,
    title: "مستند اختبار",
    number: "T-001",
    date: "2026-10-04",
    partyName: "عميل الاختبار",
    warehouse: "المستودع الرئيسي",
    payment: "نقداً",
    status: "مدفوعة",
    lines: [
      { product: "صنف أول", qty: 2, unit: "حبة", price: 50, total: 100, code: "P1" },
      {
        product: "صنف ثانٍ طويل الاسم جدًا لاختبار الالتفاف",
        qty: 3,
        unit: "كرتون",
        price: 25,
        total: 75,
      },
    ],
    subtotal: 175,
    tax: 10,
    discount: 5,
    total: 180,
    paid: 180,
    balance: 0,
    currency: "ر.ي",
    company: { name: COMPANY.name, phone: COMPANY.contacts[0], logo: COMPANY.logoUrl },
  };
}

for (const type of [
  "customer_invoice",
  "purchase_invoice",
  "sales_return",
  "payment_receipt",
] as const) {
  const html = renderStandardTemplate(docFor(type), LABELS, true, { company: COMPANY });
  check(`standard renders ${type}`, html.includes("<!doctype html>") && html.includes("T-001"));
}

const longDoc = docFor("customer_invoice");
longDoc.lines = Array.from({ length: 40 }, (_, i) => ({
  product: `صنف رقم ${i + 1} باسم طويل نسبيًا`,
  qty: 1,
  price: 10,
  total: 10,
}));
const manyLinesHtml = renderStandardTemplate(longDoc, LABELS, true, { company: COMPANY });
check("many lines render without truncation", (manyLinesHtml.match(/<tr>/g) ?? []).length >= 40);
check(
  "long invoice includes a line items summary row",
  manyLinesHtml.includes('class="items-summary-row"'),
);
const fiftyLinesDoc = docFor("customer_invoice");
fiftyLinesDoc.lines = Array.from({ length: 50 }, (_, index) => ({
  product: `Product ${index + 1}`,
  qty: 1,
  unit: "each",
  price: 10,
  total: 10,
}));
const fiftyLinesHtml = renderStandardTemplate(fiftyLinesDoc, LABELS, true, { company: COMPANY });
check("50 lines and one summary row render", (fiftyLinesHtml.match(/<tr>/g) ?? []).length === 51);
check(
  "50 line summary quantity and amount are aggregated",
  fiftyLinesHtml.includes("50 each") && fiftyLinesHtml.includes("500.00"),
);
const fiftyOneLinesDoc = {
  ...fiftyLinesDoc,
  lines: [
    ...fiftyLinesDoc.lines,
    { product: "Product 51", qty: 1, unit: "each", price: 10, total: 10 },
  ],
};
const fiftyOneLinesHtml = renderStandardTemplate(fiftyOneLinesDoc, LABELS, true, {
  company: COMPANY,
});
check(
  "51 line document keeps all rows and summary",
  (fiftyOneLinesHtml.match(/<tr>/g) ?? []).length === 52,
);
check(
  "printed date uses Latin digits and 24-hour Aden time",
  formatPrintedDateTime("2026-10-20T13:05:00.000Z") === "20/10/2026 16:05",
);
/* Standard and luxury must share one layout — only colours differ. */
const stdHtml = renderStandardTemplate(docFor("customer_invoice"), LABELS, true, {
  company: COMPANY,
});
const luxHtml = renderElegantTemplate(docFor("customer_invoice"), LABELS, true, {
  company: COMPANY,
});
check(
  "standard and luxury share the same page container",
  stdHtml.includes('class="page-container"') && luxHtml.includes('class="page-container"'),
);
check(
  "standard and luxury share the same items table",
  stdHtml.includes('class="items-table"') && luxHtml.includes('class="items-table"'),
);
check(
  "standard and luxury differ only by theme tokens",
  stdHtml.includes(PRINT_THEMES.standard.accent) && luxHtml.includes(PRINT_THEMES.luxury.accent),
);
check("standard does not contain the luxury accent", !stdHtml.includes(PRINT_THEMES.luxury.accent));

/* RTL / LTR */
const ltrHtml = renderStandardTemplate(docFor("customer_invoice"), LABELS, false, {
  company: COMPANY,
});
check("RTL document declares rtl", stdHtml.includes('dir="rtl"'));
check("LTR document declares ltr", ltrHtml.includes('dir="ltr"'));

/* Formal */
const formalHtml = renderFormalTemplate(
  docFor("customer_invoice"),
  LABELS,
  true,
  { showFooter: true },
  COMPANY,
);
check(
  "formal template renders",
  formalHtml.includes("<!doctype html>") && formalHtml.includes("T-001"),
);

/* Engine — profiles & overrides */
const engineThermal = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  paperId: "thermal-58",
  theme: "standard",
});
check("engine honours thermal-58 paper", engineThermal.includes("--print-width:58mm"));

const engineLandscape = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  paperId: "a4",
  orientation: "landscape",
});
check("engine honours landscape orientation", engineLandscape.includes("297mm 210mm"));

const engineOverride = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  settings: {
    ...DEFAULT_UNIFIED_PRINT_SETTINGS,
    paperId: "a4",
    overrides: { customer_invoice: { paperId: "thermal-80" } },
  },
});
check(
  "per-document override beats the global default",
  engineOverride.includes("--print-width:80mm"),
);

const engineFormal = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  theme: "formal",
});
check("engine routes formal theme to the formal template", engineFormal.includes("A4 portrait"));

/* ─────────────────────────── Company Profile ─────────────────────────── */

check("default company profile has no invented tenant name", DEFAULT_COMPANY_PROFILE.name === "");
check("default company profile invents no contacts", DEFAULT_COMPANY_PROFILE.contacts.length === 0);

const footer = renderUniversalFooter(COMPANY, true);
check("removed universal footer renders no content", footer === "");
check("removed universal footer has no injected styles", UNIVERSAL_FOOTER_CSS === "");

const noOwnerName = renderUniversalFooter(COMPANY, true);
check("footer never contains the former owner name", !noOwnerName.includes("موسى العواضي"));

function rightsOccurrences(html: string): number {
  const text = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return text.split(COMPANY_RIGHTS_TEXT).length - 1;
}

check(
  "rights helper contains the approved exact line",
  rightsOccurrences(renderInvoiceRightsFooter()) === 1,
);

/* Company data must come from Company Profile, not a template constant. */
const profileDrivenHtml = renderStandardTemplate(docFor("customer_invoice"), LABELS, true, {
  company: { ...COMPANY, name: "منشأة العميل الفعلية" },
});
check(
  "template reads the company name from the profile",
  profileDrivenHtml.includes("منشأة العميل الفعلية"),
);
check(
  "template never falls back to a hard-coded company name",
  !profileDrivenHtml.includes("طاحونتي"),
);

/* Legacy footer settings cannot reintroduce fixed footer output. */
const FOOTER_MARKUP = '<footer class="universal-footer"';
for (const paperId of ["a4", "a5", "thermal-58", "thermal-80"] as PrintPaperId[]) {
  const html = renderUnifiedDocument({
    doc: docFor("customer_invoice"),
    documentType: "customer_invoice",
    rtl: true,
    paperId,
    settings: { ...DEFAULT_UNIFIED_PRINT_SETTINGS, footerEnabled: true, paperId },
  });
  check(`removed footer stays absent on ${paperId}`, !html.includes(FOOTER_MARKUP));
}

const footerOffHtml = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  settings: { ...DEFAULT_UNIFIED_PRINT_SETTINGS, footerEnabled: false },
});
check("legacy footer disabled remains absent", !footerOffHtml.includes(FOOTER_MARKUP));

/* Multi-page layout is no longer constrained by a fixed footer. */
check("removed footer adds no pagination styles", UNIVERSAL_FOOTER_CSS === "");

/* ─────────────────────────── Color Customization Tests ─────────────────────────── */

const customColorStandardHtml = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  templateId: "standard",
  theme: "standard",
  paperId: "a4",
  accentColor: "#0f766e",
});
check(
  "custom accent color applies to standard template CSS",
  customColorStandardHtml.includes("--print-accent: #0f766e"),
);

const customColorLuxuryHtml = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  templateId: "elegant",
  theme: "luxury",
  paperId: "a5",
  accentColor: "#b45309",
});
check(
  "custom accent color applies to luxury template CSS",
  customColorLuxuryHtml.includes("--print-accent: #b45309"),
);

const settingsWithColors = {
  ...DEFAULT_UNIFIED_PRINT_SETTINGS,
  standardAccentColor: "#0284c7",
  luxuryAccentColor: "#831843",
};

const settingsColorStd = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  templateId: "standard",
  theme: "standard",
  settings: settingsWithColors,
});
check(
  "settings standardAccentColor propagates to standard template",
  settingsColorStd.includes("--print-accent: #0284c7"),
);

const settingsColorLux = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  templateId: "elegant",
  theme: "luxury",
  settings: settingsWithColors,
});
check(
  "settings luxuryAccentColor propagates to luxury template",
  settingsColorLux.includes("--print-accent: #831843"),
);

/* A5 layout adjustments */
const a5LayoutHtml = renderUnifiedDocument({
  doc: docFor("customer_invoice"),
  documentType: "customer_invoice",
  rtl: true,
  paperId: "a5",
  templateId: "standard",
});
check("A5 paper profile applies A5 container min-height", a5LayoutHtml.includes("200mm"));

/* ── Invoice Redesign & Architectural Audit Tests ── */
/* ── Invoice Redesign & Architectural Audit Tests ── */
check(
  "luxury template has 3-zone balanced header",
  luxHtml.includes('class="luxury-header-wrap"') && luxHtml.includes('class="luxury-header-grid"'),
);
check(
  "luxury template has dedicated QR box in metadata corner",
  luxHtml.includes('class="luxury-qr-box"'),
);
check(
  "luxury template does not have fake simulated signature svgs",
  !luxHtml.includes("M10 32 C 30 10"),
);
check("luxury template hides signatures by default", !luxHtml.includes('class="stamp-box-area"'));
const signaturesEnabledHtml = renderUnifiedDocument({
  doc: { ...docFor("customer_invoice"), options: { showSignatures: true } },
  documentType: "customer_invoice",
  rtl: true,
  paperId: "a4",
  templateId: "elegant",
  theme: "luxury",
});
check(
  "luxury template shows signatures when explicitly enabled",
  signaturesEnabledHtml.includes('class="stamp-box-area"'),
);
check(
  "standard template has compact high-density party ribbon",
  stdHtml.includes('class="party-info-compact-bar"'),
);
check(
  "standard template is structurally distinct from luxury",
  !stdHtml.includes('<header class="luxury-header-wrap">') &&
    stdHtml.includes('<header class="corporate-header-wrap">'),
);
check("document output omits legacy footer fields", !stdHtml.includes("footer-contact"));
check(
  "unified invoice renders the approved rights line exactly once",
  rightsOccurrences(stdHtml.replace(/\s*<\/span>\s*<bdi[^>]*>/g, " | ")) === 1 &&
    stdHtml.includes("772217218 - 784795101"),
);

const invoiceTemplateOutputs = [
  renderUnifiedDocument({ doc: docFor("customer_invoice"), templateId: "standard", paperId: "a4" }),
  renderFormalTemplate(docFor("customer_invoice"), LABELS, true),
  renderThermalTemplate(docFor("customer_invoice"), LABELS, true),
  renderThermalQrTemplate(docFor("customer_invoice"), LABELS, true),
  renderThermalMillingTemplate(docFor("customer_invoice"), LABELS, true),
  renderMillingCleanTemplate(docFor("customer_invoice"), LABELS, true),
  renderMillingMasterTemplate(docFor("customer_invoice"), LABELS, true),
  renderMillingThermalTemplate(docFor("customer_invoice"), LABELS, true),
];
check(
  "approved rights line appears exactly once in every invoice template",
  invoiceTemplateOutputs.every((html) => rightsOccurrences(html) === 1),
);
if (failures.length > 0) {
  throw new Error(`Unified printing tests failed:\n - ${failures.join("\n - ")}`);
}

console.log(`Unified printing tests passed: ${passed}`);
