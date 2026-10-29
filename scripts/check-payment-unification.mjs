#!/usr/bin/env node
/**
 * حارس توحيد طرق الدفع.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا يوجد هذا الملف
 * ════════════════════════════════════════════
 * أسباب انحراف طرق الدفع لم تكن تقنية: كل شاشة كانت تكتب اسم الطريقة بنفسها،
 * فتظهر «نقدًا» في فاتورة الكاشير و«نقدي» في سجل الفواتير لنفس العملية. إصلاح
 * الشاشات مرة واحدة لا يمنع شاشة جديدة من تكرار الخطأ بعد شهر.
 *
 * ما يفحصه (محدّد عن قصد حتى لا يعطي إنذارات كاذبة):
 *   1. اسم طريقة دفع عربي مكتوبًا كنص صريح في الواجهة.
 *   2. عرض `ledgerKind` الخام للمستخدم ({x.ledgerKind}).
 *
 * ولا يفحص:
 *   • أكواد الحسابات في التقارير — التقرير يعرف ما يقرأه، والكتالوج لا يصلح له.
 *   • قيم payment_method المخزّنة ("cash" / "credit"…) — عقد بيانات لا تسمية.
 *
 * التشغيل: node scripts/check-payment-unification.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/routes", "src/components"];

/** ملفات مسموح لها بتعريف الأسماء: الكتالوج وطبقة القواعد. */
const ALLOWED = new Set([
  "src/lib/payments/payment-methods.ts",
  "src/lib/payments/payment-rules.ts",
  "src/lib/payments/treasury-types.ts",
]);

/**
 * أسماء التصنيفات فقط — المستثنى أسماء الأطراف (الكريمي/جيب/فلوسك) لأنها
 * بيانات من القاعدة لا تصنيفات، ولا يصحّ تجميدها في فحص.
 */
const PAYMENT_LABEL = /(["'`])(نقدًا|نقدا|تحويل بنكي|حوالة بنكية|محفظة إلكترونية)(["'`])/;

/**
 * {x.ledgerKind} — مفتاح تقني يُعرض للمستخدم.
 *
 * يستبعد `ledgerKind={...}` لأنه تمرير قيمة إلى مكوّن (كما يفعل
 * PaymentMethodIcon لاختيار الأيقونة)، وهي قيمة لا تُعرض ككلام.
 */
const RAW_LEDGER_KIND = /(?<!ledgerKind=)\{\s*[A-Za-z_$][\w$.]*\.ledgerKind\s*\}/;

/** مواضع تُخزّن قيمة أو تُقارن، لا تعرض نصًا. */
const VALUE_CONTEXT =
  /(?:value|id|key|type|method|methodId|legacyValue|payment_method|finalMethod)\s*[:=]\s*$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry).replace(/\\/g, "/");
    const full = join(ROOT, rel);
    if (statSync(full).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(rel);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((dir) => {
  try {
    return walk(dir);
  } catch {
    return [];
  }
}).filter((file) => !ALLOWED.has(file) && !file.includes("__tests__"));

const violations = [];

for (const file of files) {
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    if (RAW_LEDGER_KIND.test(line)) {
      violations.push({
        file,
        line: index + 1,
        rule: "عرض ledgerKind الخام — استخدم ledgerKindLabel()",
        text: trimmed.slice(0, 110),
      });
      return;
    }

    if (PAYMENT_LABEL.test(line) && !VALUE_CONTEXT.test(trimmed)) {
      violations.push({
        file,
        line: index + 1,
        rule: "اسم طريقة دفع مكتوب يدويًا — استخدم nameAr / paymentMethodLabel()",
        text: trimmed.slice(0, 110),
      });
    }
  });
}

if (violations.length === 0) {
  console.log(`check-payment-unification: OK — ${files.length} ملفًا بلا مخالفات.`);
  process.exit(0);
}

console.error(`check-payment-unification: ${violations.length} مخالفة\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.rule}`);
  console.error(`    ${v.text}\n`);
}
process.exit(1);
