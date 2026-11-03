/**
 * How to run:
 *   npx tsx src/lib/payments/__tests__/payment-method-accounting.test.ts
 *
 * يحرس هذا الملف القاعدتين اللتين يُخطئ فيهما الجميع:
 *
 *   1. **كل طريقة دفع لها حساب معروف في الدليل.** الترتيب مطابق لدالة قاعدة
 *      البيانات `payment_method_ledger_account()`: الكود الصريح → عائلة الحساب
 *      → لا شيء للآجل. أي انحراف هنا يعني قيدًا محاسبيًا في الحساب الخطأ، وهو
 *      خطأ صامت لا يظهر في الواجهة.
 *
 *   2. **لا نص دفع مكتوب داخل أي شاشة.** الشاشات كانت تكتب «نقدي (كاش)»
 *      و«بنك الكريمي (الحساب الافتراضي)» بيدها، فتختلف الصياغة بين شاشة
 *      وأخرى. كل نص الآن من `PAYMENT_UI_TEXT` في الكتالوج.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  LEDGER_KIND_ACCOUNT_CODE,
  PAYMENT_METHOD_CATALOG,
  ledgerKindLabel,
  paymentReferenceLabel,
  paymentUiText,
} from "../payment-methods";
import { auditPaymentMethods, resolveMethodAccountCode } from "../payment-method-health";

/* ── 1. Account code resolution mirrors the database function ── */
{
  assert.equal(
    resolveMethodAccountCode({ id: "cash", nameAr: "نقدًا", ledgerKind: "CASH" }),
    "1101",
  );
  assert.equal(resolveMethodAccountCode({ id: "bank", nameAr: "بنك", ledgerKind: "BANK" }), "1111");
  assert.equal(
    resolveMethodAccountCode({ id: "wallet", nameAr: "محفظة", ledgerKind: "WALLET" }),
    "1131",
  );
  assert.equal(
    resolveMethodAccountCode({ id: "card", nameAr: "شبكة", ledgerKind: "CARD" }),
    "1111",
  );
  // آجل بلا حساب تحصيل — مقصود
  assert.equal(
    resolveMethodAccountCode({
      id: "credit",
      nameAr: "آجل",
      ledgerKind: "CREDIT",
      isCreditTerm: true,
    }),
    null,
  );
  // الكود الصريح في صف الكتالوج يفوز على العائلة
  assert.equal(
    resolveMethodAccountCode({
      id: "cheque",
      nameAr: "شيك",
      ledgerKind: "BANK",
      defaultAccountCode: "1221",
    }),
    "1221",
  );
}

/* ── 2. The shipped catalogue itself is fully linked ── */
{
  const lookup = {
    codes: new Set(["1101", "1111", "1131", "1221", "1211", "1101001"]),
  };
  const health = auditPaymentMethods(
    PAYMENT_METHOD_CATALOG.map((m) => ({
      id: m.id,
      nameAr: m.nameAr,
      ledgerKind: m.ledgerKind,
      defaultAccountCode: m.defaultAccountCode,
      isCreditTerm: m.isCreditTerm,
      isActive: m.isActive,
      enabled: true,
    })),
    lookup,
  );
  const broken = health.filter((h) => h.status === "account_missing" || h.status === "no_account");
  assert.deepEqual(
    broken.map((h) => `${h.method.id}:${h.status}`),
    [],
    "every shipped, enabled method must resolve to an existing ledger account",
  );
}

/* ── 3. A missing account is reported, never silently ignored ── */
{
  const lookup = { codes: new Set(["1101"]) }; // bank + wallet accounts absent
  const health = auditPaymentMethods(
    [
      { id: "cash", nameAr: "نقدًا", ledgerKind: "CASH", enabled: true, isActive: true },
      { id: "bank", nameAr: "بنك", ledgerKind: "BANK", enabled: true, isActive: true },
      {
        id: "credit",
        nameAr: "آجل",
        ledgerKind: "CREDIT",
        isCreditTerm: true,
        enabled: true,
        isActive: true,
      },
      { id: "off", nameAr: "موقوفة", ledgerKind: "BANK", enabled: false, isActive: true },
    ],
    lookup,
  );
  assert.equal(health[0].status, "ok");
  assert.equal(health[1].status, "account_missing");
  assert.equal(health[1].accountCode, "1111");
  assert.equal(health[2].status, "credit");
  assert.equal(health[3].status, "disabled");
}

/* ── 4. Every ledger kind except CREDIT has a code ── */
{
  for (const kind of Object.keys(
    LEDGER_KIND_ACCOUNT_CODE,
  ) as (keyof typeof LEDGER_KIND_ACCOUNT_CODE)[]) {
    if (kind === "CREDIT") {
      assert.equal(LEDGER_KIND_ACCOUNT_CODE[kind], null);
    } else {
      assert.ok(LEDGER_KIND_ACCOUNT_CODE[kind], `${kind} must map to an account code`);
    }
  }
}

/* ── 5. Labels are user-facing, never raw enum keys ── */
{
  for (const kind of ["CASH", "BANK", "WALLET", "CARD", "CREDIT", "OTHER"] as const) {
    assert.notEqual(ledgerKindLabel(kind, "ar"), kind, `${kind} must not render its raw key`);
    assert.ok(ledgerKindLabel(kind, "en").length > 0);
  }
  // A key this build has never seen must not crash a screen.
  assert.equal(ledgerKindLabel("SOMETHING_NEW", "ar"), ledgerKindLabel("OTHER", "ar"));
}

/* ── 6. Reference field label follows the method ── */
{
  assert.equal(
    paymentReferenceLabel({ legacyValue: "cheque", ledgerKind: "BANK" }, "ar"),
    paymentUiText("chequeNumber", "ar"),
  );
  assert.equal(
    paymentReferenceLabel({ legacyValue: "jawali", ledgerKind: "WALLET" }, "ar"),
    paymentUiText("walletReference", "ar"),
  );
  assert.equal(
    paymentReferenceLabel({ legacyValue: "bank_transfer", ledgerKind: "BANK" }, "ar"),
    paymentUiText("transferReference", "ar"),
  );
}

/* ── 7. No screen hard-codes a payment label ── */
{
  /** نصوص الدفع التي كان كل ملف يكتبها بنفسه قبل التوحيد. */
  const forbidden = [
    "بنك الكريمي (الحساب الافتراضي)",
    "لم يتم ربط حساب افتراضي بعد",
    "رقم عملية المحفظة",
    "رقم الحوالة / المرجع",
    "الصندوق الرئيسي",
    "تسجيل مديونية مؤجلة في حساب ذمم العميل",
  ];

  const roots = ["src/routes", "src/components", "src/pages"];
  const offenders: string[] = [];

  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx|ts)$/.test(entry)) continue;
      const source = readFileSync(full, "utf8");
      for (const text of forbidden) {
        if (source.includes(text)) offenders.push(`${full} → ${text}`);
      }
    }
  };
  roots.forEach(walk);

  assert.deepEqual(
    offenders,
    [],
    `payment text must come from the catalogue:\n${offenders.join("\n")}`,
  );
}

console.log("payment-method-accounting: all assertions passed");
