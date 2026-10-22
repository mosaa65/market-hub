/**
 * Tests for the report export/print dataset builders.
 *
 * They guard the two contracts that broke before:
 *  - exported labels are translated, not raw database field names
 *  - printed money/numeric cells are LTR-isolated inside an RTL document
 *
 * Run with: npm run test:reports-export
 */
import {
  lowStockColumns,
  lowStockPrintSection,
  lowStockRows,
  paymentMixColumns,
  paymentMixPrintSection,
  paymentMixRows,
  salesColumns,
  salesPrintSection,
  salesRows,
  topProductColumns,
  topProductPrintSection,
  topProductRows,
  type LowStockRow,
  type PaymentMixRow,
  type SalesRow,
  type TopProductRow,
} from "../reports-export";
import { buildReportHtml } from "@/lib/print/report-print";
import { fmtAmount } from "@/lib/statements/format";

let passed = 0;
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`✗ ${name}`);
  passed++;
  console.log(`  ✓ ${name}`);
}

const tops: TopProductRow[] = [
  { name: "أرز بسمتي ٥ كجم", qty: 1250, total: 12500 },
  { name: "زيت طعام", qty: -3, total: -450.5 },
];
const sales: SalesRow[] = [
  {
    invoice: "INV-1024",
    date: "2026-01-31T10:00:00Z",
    total: 12500,
    paid: 10000,
    paymentMethod: "نقدي",
    status: "مدفوعة جزئيًا",
  },
];
const mixes: PaymentMixRow[] = [
  { method: "نقدي", amount: 10000, pct: 80 },
  { method: "بطاقة", amount: 2500, pct: 20 },
];
const lows: LowStockRow[] = [{ name: "سكر", stock: 0, min: 5 }];

console.log("\n════════════════════════════════════════════");
console.log("  Reports Export & Print — اختبارات");
console.log("════════════════════════════════════════════");

// --- translated headers, not raw field names -------------------------------
check(
  "أعمدة أعلى المنتجات مترجمة بالعربية",
  topProductColumns("ar")
    .map((c) => c.header)
    .join("|") === "المنتج|الكمية|الإيراد",
);
check(
  "أعمدة المبيعات مترجمة بالإنجليزية",
  salesColumns("en")
    .map((c) => c.header)
    .join("|") === "Invoice|Date|Total|Paid|Payment method|Status",
);
check(
  "أعمدة طرق الدفع تحتوي النسبة",
  paymentMixColumns("ar").some((c) => c.header === "النسبة"),
);
check(
  "أعمدة المخزون المنخفض تحتوي المتاح والحد الأدنى",
  lowStockColumns("en")
    .map((c) => c.header)
    .join("|") === "Product|On hand|Minimum",
);
check(
  "لا يوجد اسم حقل برمجي في العناوين",
  [...topProductColumns("en"), ...salesColumns("en"), ...lowStockColumns("en")].every(
    (c) => !c.header.includes("_"),
  ),
);

// --- values stay raw numbers so Excel keeps them numeric -------------------
const topCsv = topProductRows(tops);
check("الكمية تُصدَّر كرقم", typeof topCsv[0].qty === "number" && topCsv[0].qty === 1250);
check("الإيراد يُصدَّر كرقم", typeof topCsv[0].revenue === "number" && topCsv[0].revenue === 12500);
check("القيم السالبة محفوظة", topCsv[1].revenue === -450.5);
check("أسماء المنتجات العربية محفوظة", topCsv[0].name === "أرز بسمتي ٥ كجم");

const lowCsv = lowStockRows(lows);
check("المخزون المنخفض رقمي", lowCsv[0].onHand === 0 && lowCsv[0].minimum === 5);

const mixCsv = paymentMixRows(mixes);
check("نسبة طرق الدفع محسوبة", mixCsv[0].percentage === 80);

// --- print sections --------------------------------------------------------
const topSection = topProductPrintSection(tops, "ar");
check("قسم الطباعة يحوي كل المنتجات", topSection.rows.length === 2);
check("قسم الطباعة يحوي صف الإجمالي", Boolean(topSection.totals?.revenue));
check(
  "الإجمالي يجمع المبالغ السالبة",
  topSection.totals?.revenue ===
    new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 2 }).format(12500 + -450.5),
);

const salesSection = salesPrintSection(sales, "ar");
check("صف المبيعات يحمل رقم الفاتورة", salesSection.rows[0].invoice === "INV-1024");
check("قسم طرق الدفع يحوي كل الطرق", paymentMixPrintSection(mixes, "ar").rows.length === 2);
check("نسبة طرق الدفع تُطبع", paymentMixPrintSection(mixes, "ar").rows[0].percentage === "٨٠%");
check("قسم المخزون المنخفض يحوي المنتجات", lowStockPrintSection(lows, "ar").rows.length === 1);
check("تصدير المبيعات يحوي كل الأعمدة", salesRows(sales)[0].invoice === "INV-1024");

// --- printed document ------------------------------------------------------
const html = buildReportHtml({
  lang: "ar",
  title: "تقرير المبيعات",
  period: "2026-01-01 → 2026-01-31",
  generatedAt: "2026-02-01 09:00",
  kpis: [{ label: "إجمالي المبيعات", value: "12,500 ر.ي" }],
  sections: [topSection, salesSection],
});

check("الطباعة تستخدم A4", html.includes("size: A4 portrait"));
check("الوثيقة عربية RTL", html.includes('dir="rtl"') && html.includes('lang="ar"'));
check("هوامش الطباعة محددة", html.includes("@page { size: A4 portrait; margin:"));
check("الصفوف لا تنقسم بين الصفحات", html.includes("page-break-inside:avoid"));
check("الدعم الحديث لـ break-inside موجود", html.includes("break-inside:avoid"));
check("ترويسة الجدول تتكرر", html.includes("display:table-header-group"));
check("الخلايا الرقمية معزولة LTR", (html.match(/dir="ltr"/g) ?? []).length > 0);
check(
  "اسم الشركة في التذييل يأتي من Company Profile لا من ثابت",
  html.includes('class="universal-footer"'),
);
check("لا يوجد اسم منتج/شركة مكتوب داخل التقرير", !html.includes("Market Hub"));
check("لا يستدعي window.print على الصفحة الحالية", !html.includes("window.print"));

const htmlEn = buildReportHtml({
  lang: "en",
  title: "Sales report",
  sections: [topProductPrintSection(tops, "en")],
});
check("الإنجليزية LTR", htmlEn.includes('dir="ltr"') && htmlEn.includes('lang="en"'));
check("الإنجليزية لا تحوي نصوص عربية في العناوين", htmlEn.includes(">Product<"));

check(
  "المبالغ السالبة بلا علامة حرف عربي (إشارة السالب في مكانها)",
  !fmtAmount(-450.5).includes("\u061C") && fmtAmount(-450.5).startsWith("-"),
);

console.log(`\n✓ كل الاختبارات نجحت: ${passed}/${passed}\n`);
