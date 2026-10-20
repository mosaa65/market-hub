/**
 * Company Profile unification tests.
 *
 * يتحقق من:
 *   • أن الـ accessor المركزي يعمل (قراءة/كتابة/تحديث جزئي/مسح).
 *   • أن حالات null/empty تُرجع fallback صالحًا بلا انهيار.
 *   • أن **لا ملف** في المشروع يقرأ كاش Company Profile مباشرة من localStorage
 *     خارج `printing/company-profile.ts` (فحص مصدري).
 *   • أن المستندات (قالب موحد، رسمي، حراري، ESC/POS) كلها تستخدم المصدر المركزي.
 *
 * يُشغّل بـ: npx tsx src/lib/printing/__tests__/company-profile.test.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  cacheCompanyProfile,
  clearCompanyProfileCache,
  DEFAULT_COMPANY_PROFILE,
  getCachedCompanyProfile,
  patchCompanyProfileCache,
} from "../company-profile";
import { renderUnifiedDocument } from "../engine";
import { renderThermalEscPos } from "../thermal-escpos";
import { renderFormalTemplate } from "../formal";
import type { PrintRequest } from "../engine";
import { getDefaultArabicLabels } from "@/lib/pdf";
import { COMPANY_RIGHTS_TEXT } from "../footer";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) passed += 1;
  else failures.push(name);
}

/* ── localStorage stub: الاختبار يعمل في Node بلا DOM ──────────────────── */
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

/* ───────────────────────── 1. Accessor behaviour ───────────────────────── */

clearCompanyProfileCache();
const empty = getCachedCompanyProfile();
check("empty cache returns the default profile", empty.name === DEFAULT_COMPANY_PROFILE.name);
check("empty profile has no invented contact numbers", empty.contacts.length === 0);

// كتابة صف كامل من قاعدة البيانات
const row = {
  name: "شركة النور للتجارة",
  name_ar: "شركة النور",
  legal_name: "شركة النور للتجارة المحدودة",
  phone: "771111111",
  contact_numbers: "772222222, 773333333",
  address: "صنعاء - شارع تعز",
  email: "info@alnoor.ye",
  tax_number: "300123456700003",
  logo_url: "/logo.png",
  footer_text: "legacy footer text must not be loaded",
  footer_contact: "784795104 · 772217218",
  currency_symbol: "ر.ي",
};

const cached = cacheCompanyProfile(row);
check("cacheCompanyProfile returns the new name", cached.name === "شركة النور للتجارة");
check("cacheCompanyProfile keeps Arabic name", cached.arabicName === "شركة النور");
check("cacheCompanyProfile parses extra contacts", cached.contacts.includes("772222222"));
check("cacheCompanyProfile keeps email", cached.email === "info@alnoor.ye");
check("cacheCompanyProfile keeps address", cached.address === "صنعاء - شارع تعز");
check("cacheCompanyProfile keeps tax number", cached.taxNumber === "300123456700003");
check("cacheCompanyProfile keeps logo", cached.logoUrl === "/logo.png");
check("cacheCompanyProfile keeps currency", cached.currency === "ر.ي");

// القراءة اللاحقة ترى نفس البيانات (نفس المصدر)
const reread = getCachedCompanyProfile();
check("subsequent reads see the cached identity", reread.name === "شركة النور للتجارة");

/* ───────────────────────── 2. Partial update ───────────────────────────── */

const patched = patchCompanyProfileCache({ currency: "USD" });
check("patch updates the currency", patched.currency === "USD");
check("patch does NOT lose the company name", patched.name === "شركة النور للتجارة");
check("patch does NOT lose the email", patched.email === "info@alnoor.ye");
check("patch is visible on the next read", getCachedCompanyProfile().currency === "USD");

/* ───────────────────────── 3. Fallbacks ───────────────────────────────── */

// صف فارغ تمامًا
clearCompanyProfileCache();
const blank = cacheCompanyProfile({});
check("blank profile does not invent contact numbers", blank.contacts.length === 0);
check("blank row does not throw on contacts", Array.isArray(blank.contacts));

// قيم null/undefined لا تُنتج "null" نصيًا
const nullish = cacheCompanyProfile({
  name: null,
  phone: null,
  email: null,
  address: null,
  footer_contact: null,
});
check("null name falls back instead of rendering 'null'", !String(nullish.name).includes("null"));
check("null phone becomes undefined", nullish.phone === undefined);
check("null email becomes undefined", nullish.email === undefined);

// مسح الكاش
clearCompanyProfileCache();
check(
  "clearCompanyProfileCache resets to defaults",
  getCachedCompanyProfile().name === DEFAULT_COMPANY_PROFILE.name,
);

/* ─────────────── 4. Every document path uses the central source ─────────── */

cacheCompanyProfile(row);

const baseDoc = {
  title: "فاتورة مبيعات",
  number: "INV-1",
  date: "2026-10-05",
  partyName: "عميل",
  lines: [{ product: "صنف", qty: 1, price: 10, total: 10 }],
  total: 10,
  currency: "ر.ي",
};

const request = (over: Partial<PrintRequest> = {}): PrintRequest =>
  ({ doc: { ...baseDoc, docType: "customer_invoice" }, rtl: true, ...over }) as PrintRequest;

// القالب الموحد (بدون doc.company → يسقط إلى Company Profile)
const unifiedHtml = renderUnifiedDocument(
  request({ paperId: "a4", templateId: "standard", theme: "standard" }),
);
check(
  "unified layout renders the company name from Company Profile",
  unifiedHtml.includes("شركة النور للتجارة"),
);
check("unified layout renders the company address", unifiedHtml.includes("صنعاء - شارع تعز"));
check("unified layout omits fixed support contacts", !unifiedHtml.includes("784795104"));
check(
  "unified invoice includes the approved company rights line",
  unifiedHtml.includes("تطوير وبرمجة إنما سوفت") && unifiedHtml.includes("772217218 - 784795101"),
);
check(
  "unified invoice includes the approved company rights line",
  (unifiedHtml.match(/تطوير وبرمجة إنما سوفت/g) ?? []).length === 1 &&
    unifiedHtml.includes("772217218 - 784795101"),
);
check(
  "unified layout omits the removed universal footer",
  !unifiedHtml.includes('class="universal-footer"'),
);

// القالب الرسمي
const formalHtml = renderFormalTemplate(baseDoc as never, getDefaultArabicLabels(), true);
check("formal template uses Company Profile", formalHtml.includes("شركة النور للتجارة"));
check(
  "formal template omits the removed universal footer",
  !formalHtml.includes('class="universal-footer"'),
);

// المapper الحراري ESC/POS
const escposDoc = renderThermalEscPos(request());
const escposText = escposDoc.blocks.map((b) => b.text).join("\n");
check("ESC/POS mapper uses Company Profile name", escposText.includes("شركة النور للتجارة"));
check("ESC/POS mapper uses Company Profile address", escposText.includes("صنعاء - شارع تعز"));
check("ESC/POS mapper omits fixed support contacts", !escposText.includes("784795104"));
check(
  "ESC/POS mapper prints the tax number from Company Profile",
  escposText.includes("300123456700003"),
);

// تغيير الهوية ينعكس على كل المستندات فورًا (نفس المصدر، بلا كاش منفصل)
cacheCompanyProfile({
  ...row,
  name: "منشأة الأمانة",
  name_ar: "منشأة الأمانة",
  address: "عدن",
  footer_contact: "711111111",
});

const afterHtml = renderUnifiedDocument(request({ paperId: "a4" }));
check("changing the name propagates to the unified layout", afterHtml.includes("منشأة الأمانة"));
check("old name is gone from the unified layout", !afterHtml.includes("شركة النور للتجارة"));
check("changing the address propagates", afterHtml.includes("عدن"));

const afterFormal = renderFormalTemplate(baseDoc as never, getDefaultArabicLabels(), true);
check("changing the name propagates to the formal template", afterFormal.includes("منشأة الأمانة"));

const afterEscpos = renderThermalEscPos(request())
  .blocks.map((b) => b.text)
  .join("\n");
check("changing the name propagates to ESC/POS", afterEscpos.includes("منشأة الأمانة"));
check("legacy footer contact is not printed by ESC/POS", !afterEscpos.includes("711111111"));

/* ─────────────── 5. No direct cache reads outside the accessor ──────────── */

const SRC = join(process.cwd(), "src");
const CACHE_KEY = "company_settings_cache";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** ملفات هذا الاختبار نفسها تستشهد بالمفاتيح للفحص — لا تُعد مخالفة. */
function isTestFile(normalized: string): boolean {
  return normalized.includes("__tests__") || normalized.endsWith(".test.ts");
}

const files = walk(SRC);
const offenders: string[] = [];

for (const file of files) {
  const normalized = file.replace(/\\/g, "/");
  // ملف الـ accessor نفسه هو المكان الوحيد المسموح له بلمس المفتاح.
  if (normalized.endsWith("lib/printing/company-profile.ts")) continue;
  if (isTestFile(normalized)) continue;
  const source = readFileSync(file, "utf8");
  if (source.includes(CACHE_KEY)) offenders.push(normalized);
}

check(
  `no file reads the Company Profile cache directly (found: ${offenders.join(", ") || "none"})`,
  offenders.length === 0,
);

// ولا قراءة مباشرة لبيانات الشركة من localStorage بمفاتيح بديلة
const suspicious: string[] = [];
for (const file of files) {
  const normalized = file.replace(/\\/g, "/");
  if (isTestFile(normalized)) continue;
  if (normalized.endsWith("lib/printing/company-profile.ts")) continue;
  const source = readFileSync(file, "utf8");
  // ملفات **Company Profile** المباشرة = تجاوز للمصدر المركزي.
  // (ملفات إعدادات الطباعة/الكشوفات تخزّن إعداداتها الخاصة، وهذا مشروع.)
  const isCompanyProfileFile =
    normalized.endsWith("lib/format.ts") ||
    normalized.endsWith("lib/milling/print.ts") ||
    normalized.endsWith("lib/statements/company.ts");
  if (isCompanyProfileFile && /localStorage\s*\.\s*getItem/.test(source)) {
    suspicious.push(normalized);
  }
}

check(
  `no Company Profile reader bypasses the central accessor (found: ${suspicious.join(", ") || "none"})`,
  suspicious.length === 0,
);

// ملفات الطباعة (printing/print/templates) يجب ألا تلمس localStorage إطلاقًا.
const printingStorageOffenders: string[] = [];
for (const file of files) {
  const normalized = file.replace(/\\/g, "/");
  if (isTestFile(normalized)) continue;
  const isCorePrintingFile =
    normalized.includes("/lib/printing/") ||
    normalized.includes("/lib/print/") ||
    normalized.includes("/lib/templates/");
  if (!isCorePrintingFile) continue;
  // مخازن الإعدادات لها مفتاحها الخاص — ليست Company Profile.
  if (normalized.endsWith("lib/printing/settings.ts")) continue;
  if (normalized.endsWith("lib/printing/company-profile.ts")) continue;
  if (normalized.endsWith("lib/templates/settings-store.ts")) continue;
  const source = readFileSync(file, "utf8");
  if (/localStorage\s*\.\s*getItem/.test(source)) printingStorageOffenders.push(normalized);
}

check(
  `printing engine files never touch localStorage directly (found: ${printingStorageOffenders.join(", ") || "none"})`,
  printingStorageOffenders.length === 0,
);

/* ─────────────── 6. showBranding is fully removed ──────────────────────── */

const brandingOffenders: string[] = [];
for (const file of files) {
  const normalized = file.replace(/\\/g, "/");
  if (isTestFile(normalized)) continue;
  const source = readFileSync(file, "utf8");
  // التعليقات تشرح سبب الإزالة — لا تُعد استخدامًا فعليًا.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  if (
    /\bshowBranding\b/.test(stripped) ||
    /\bDEFAULT_BRANDING\b/.test(stripped) ||
    /\bbrandingText\b/.test(stripped)
  ) {
    brandingOffenders.push(normalized);
  }
}

check(
  `showBranding / DEFAULT_BRANDING / brandingText fully removed (found: ${brandingOffenders.join(", ") || "none"})`,
  brandingOffenders.length === 0,
);

// لا نصوص منتج ثابتة داخل المستندات المطبوعة
const productNames = ["موسى العواضي", "طاحونتي", "مؤسسة فورتكس"];
const docOffenders: string[] = [];
for (const file of files) {
  const normalized = file.replace(/\\/g, "/");
  if (isTestFile(normalized)) continue;
  const isDocumentFile =
    normalized.includes("/lib/printing/") ||
    normalized.includes("/lib/templates/") ||
    normalized.includes("/lib/statements/") ||
    normalized.includes("/lib/milling/print");
  if (!isDocumentFile) continue;
  const source = readFileSync(file, "utf8");
  for (const name of productNames) {
    if (source.includes(name)) docOffenders.push(`${normalized} → ${name}`);
  }
}

check(
  `no hard-coded company/product name in printed documents (found: ${docOffenders.join(", ") || "none"})`,
  docOffenders.length === 0,
);

if (failures.length > 0) {
  throw new Error(`Company Profile tests failed:\n - ${failures.join("\n - ")}`);
}

console.log(`Company Profile tests passed: ${passed}`);
