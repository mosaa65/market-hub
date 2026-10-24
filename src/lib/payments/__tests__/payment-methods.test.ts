import assert from "node:assert/strict";
import {
  LEGACY_PAYMENT_VALUES,
  PAYMENT_METHOD_CATALOG,
  SHIPPED_PAYMENT_METHOD_ORDER,
  getPaymentMethodDefinition,
  isLegacyPaymentValue,
  isSelectableTender,
  isSplitPaymentValue,
  paymentMethodIcon,
  paymentMethodLabel,
  toCatalogId,
  toLegacyPaymentValue,
  toStorablePaymentValue,
} from "../payment-methods";

// ── 1. التحقق من الطرق الأربع الأساسية فقط في الكتالوج ───────────────────────
const methodIds = PAYMENT_METHOD_CATALOG.map((method) => method.id);
assert.equal(methodIds.length, 4, "The catalog must contain exactly 4 payment methods");
assert.deepEqual(
  new Set(methodIds),
  new Set(["cash", "credit", "bank_transfer", "mobile_money"]),
  "The 4 methods must be: cash, credit, bank_transfer, mobile_money",
);

// ── 2. التحقق من ربط كل طريقة بحسابها المحاسبي الدقيق ─────────────────────────
const methodMap = new Map(PAYMENT_METHOD_CATALOG.map((m) => [m.id, m]));

// أ. النقد
const cash = methodMap.get("cash")!;
assert.ok(cash, "cash must exist in catalog");
assert.equal(cash.ledgerKind, "CASH");
assert.equal(cash.defaultAccountCode, "1101");
assert.equal(cash.legacyValue, "cash");
assert.equal(cash.nameAr, "نقدًا");

// ب. الآجل
const credit = methodMap.get("credit")!;
assert.ok(credit, "credit must exist in catalog");
assert.equal(credit.ledgerKind, "CREDIT");
assert.equal(credit.defaultAccountCode, "1211");
assert.equal(credit.isCreditTerm, true);
assert.equal(credit.legacyValue, "credit");
assert.equal(credit.nameAr, "آجل");

// ج. البنك
const bank = methodMap.get("bank_transfer")!;
assert.ok(bank, "bank_transfer must exist in catalog");
assert.equal(bank.ledgerKind, "BANK");
assert.equal(bank.defaultAccountCode, "1111");
assert.equal(bank.legacyValue, "bank_transfer");
assert.equal(bank.nameAr, "بنك");

// د. المحفظة الإلكترونية
const wallet = methodMap.get("mobile_money")!;
assert.ok(wallet, "mobile_money must exist in catalog");
assert.equal(wallet.ledgerKind, "WALLET");
assert.equal(wallet.defaultAccountCode, "1131");
assert.equal(wallet.legacyValue, "mobile_money");
assert.equal(wallet.nameAr, "محفظة إلكترونية");

// ── 3. فحص الأيقونات والأوصاف ───────────────────────────────────────────────
for (const method of PAYMENT_METHOD_CATALOG) {
  assert.ok(method.nameAr.trim(), `${method.id} must have an Arabic name`);
  assert.ok(method.legacyValue, `${method.id} must map to a stored legacy value`);
  assert.equal(toLegacyPaymentValue(method.id), method.legacyValue);
  assert.ok(paymentMethodIcon(method.iconKey, method.ledgerKind));
  assert.ok(method.allowedContexts.length > 0, `${method.id} must have explicit contexts`);
  assert.equal(isSelectableTender(method), true);
}

// ── 4. التوافق العكسي وحل المعرفات القديمة (Backward Compatibility) ─────────
// الحوالات القديمة والبطاقات والشيكات تصب في بنك (bank_transfer)
assert.equal(toCatalogId("bank_transfer"), "bank_transfer");
assert.equal(toCatalogId("card"), "bank_transfer");
assert.equal(toCatalogId("cheque"), "bank_transfer");
assert.equal(toCatalogId("kuraimi_bank"), "bank_transfer");
assert.equal(toCatalogId("yemen_kuwait_bank"), "bank_transfer");

// المحافظ القديمة تصب في محفظة إلكترونية (mobile_money)
assert.equal(toCatalogId("mobile_money"), "mobile_money");
assert.equal(toCatalogId("jawali"), "mobile_money");
assert.equal(toCatalogId("jaib"), "mobile_money");
assert.equal(toCatalogId("floosak"), "mobile_money");
assert.equal(toCatalogId("one_cash"), "mobile_money");

// ── 5. الفحص الصارم لـ toStorablePaymentValue ─────────────────────────────────
assert.equal(toStorablePaymentValue("cash"), "cash");
assert.equal(toStorablePaymentValue("credit"), "credit");
assert.equal(toStorablePaymentValue("bank_transfer"), "bank_transfer");
assert.equal(toStorablePaymentValue("mobile_money"), "mobile_money");
assert.equal(toStorablePaymentValue("card"), "bank_transfer");
assert.equal(toStorablePaymentValue("cheque"), "bank_transfer");
assert.equal(toStorablePaymentValue("kuraimi_bank"), "bank_transfer");
assert.equal(toStorablePaymentValue("jawali"), "mobile_money");
assert.equal(toStorablePaymentValue("jaib"), "mobile_money");
assert.equal(toStorablePaymentValue("not_real"), null);
assert.equal(toStorablePaymentValue(null), null);
assert.equal(toStorablePaymentValue(undefined), null);

// ── 6. مسميات طرق الدفع الموحدة ──────────────────────────────────────────────
assert.equal(paymentMethodLabel("cash", "ar"), "نقدًا");
assert.equal(paymentMethodLabel("credit", "ar"), "آجل");
assert.equal(paymentMethodLabel("bank_transfer", "ar"), "بنك");
assert.equal(paymentMethodLabel("mobile_money", "ar"), "محفظة إلكترونية");

// حل المسميات القديمة تلقائيًا
assert.equal(paymentMethodLabel("card", "ar"), "بنك");
assert.equal(paymentMethodLabel("cheque", "ar"), "بنك");
assert.equal(paymentMethodLabel("jaib", "ar"), "محفظة إلكترونية");

// ── 7. ترتيب العرض ───────────────────────────────────────────────────────────
assert.deepEqual(SHIPPED_PAYMENT_METHOD_ORDER, [
  "cash",
  "credit",
  "bank_transfer",
  "mobile_money",
]);

console.log("All payment method tests passed successfully!");
