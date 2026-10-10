import assert from "node:assert/strict";
import {
  LEGACY_PAYMENT_VALUES,
  PAYMENT_METHOD_CATALOG,
  PAYMENT_METHOD_ICON_ASSETS,
  SHIPPED_PAYMENT_METHOD_ORDER,
  TENANT_SELECTABLE_LEGACY_VALUES,
  getPaymentMethodDefinition,
  getShippedPaymentMethod,
  isLegacyPaymentValue,
  isSelectableTender,
  isSplitPaymentValue,
  paymentMethodIcon,
  paymentMethodIconAsset,
  paymentMethodLabel,
  requiresPaymentReference,
  toCatalogId,
  toLegacyPaymentValue,
  toStorablePaymentValue,
} from "../payment-methods";

const methodIds = PAYMENT_METHOD_CATALOG.map((method) => method.id);
assert.equal(new Set(methodIds).size, methodIds.length, "catalogue method ids must be unique");

const legacyValues = new Set(PAYMENT_METHOD_CATALOG.map((method) => method.legacyValue));
for (const legacy of [
  "cash",
  "card",
  "bank_transfer",
  "credit",
  "mobile_money",
  "split",
  "cheque",
]) {
  assert.ok(legacyValues.has(legacy as (typeof PAYMENT_METHOD_CATALOG)[number]["legacyValue"]));
}

for (const method of PAYMENT_METHOD_CATALOG) {
  assert.ok(method.nameAr.trim(), `${method.id} must have an Arabic name`);
  assert.ok(method.legacyValue, `${method.id} must map to a stored legacy value`);
  assert.equal(toLegacyPaymentValue(method.id), method.legacyValue);
  assert.ok(paymentMethodIcon(method.iconKey, method.ledgerKind));
  assert.ok(method.allowedContexts.length > 0, `${method.id} must have an explicit context`);
}

for (const id of TENANT_SELECTABLE_LEGACY_VALUES) {
  assert.ok(legacyValues.has(id), `${id} must map to a known stored value`);
}

assert.equal(getPaymentMethodDefinition("cheque")?.legacyValue, "cheque");
assert.equal(getPaymentMethodDefinition("cheque")?.requiresReference, true);
assert.equal(toCatalogId("bank_transfer"), "bank_transfer");
assert.equal(toCatalogId("mobile_money"), "jawali");
assert.equal(toCatalogId("cheque"), "cheque");
assert.ok(paymentMethodIcon("unknown", "WALLET"));
assert.equal(paymentMethodLabel("bank_transfer", "ar"), "تحويل بنكي");
assert.equal(paymentMethodLabel("split", "en"), "Split payment");
assert.ok(!TENANT_SELECTABLE_LEGACY_VALUES.includes("split"));
assert.ok(!TENANT_SELECTABLE_LEGACY_VALUES.includes("credit"));

assert.deepEqual(Object.keys(PAYMENT_METHOD_ICON_ASSETS).sort(), ["floosak", "jaib", "one_cash"]);
assert.equal(paymentMethodIconAsset("floosak")?.src, "/yemeni_wallet_icons_svg/floosak.svg");
assert.equal(paymentMethodIconAsset("one_cash")?.src, "/yemeni_wallet_icons_svg/one-cash.svg");
assert.equal(paymentMethodIconAsset("jaib")?.src, "/yemeni_wallet_icons_svg/jaib.svg");
assert.equal(paymentMethodIconAsset("unknown"), undefined);
assert.equal(paymentMethodIconAsset("purple-wallet"), undefined);

/* ==========================================================================
   Regression coverage for the defects this change fixed.
   Each block names the bug it locks down.
   ========================================================================== */

// ── 1. A catalogue id NEVER silently becomes cash ──────────────────────────
//
// `toLegacyPaymentValue` returned 'cash' for an id it did not know, so a bank
// or a wallet the catalogue had not loaded was recorded as a till payment with
// no error anywhere. An unknown id must now survive unchanged so the database
// guard (`resolve_writable_payment_method`) can reject it.
assert.equal(toLegacyPaymentValue("not_a_real_method"), "not_a_real_method");
assert.notEqual(toLegacyPaymentValue("not_a_real_method"), "cash");
assert.equal(toLegacyPaymentValue(""), "");

// The honest converter returns null instead of guessing.
assert.equal(toStorablePaymentValue("kuraimi_bank"), "bank_transfer");
assert.equal(toStorablePaymentValue("jawali"), "mobile_money");
assert.equal(toStorablePaymentValue("cheque"), "cheque");
assert.equal(toStorablePaymentValue("cash"), "cash");
assert.equal(toStorablePaymentValue("not_a_real_method"), null);
assert.equal(toStorablePaymentValue(null), null);
assert.equal(toStorablePaymentValue(undefined), null);
// A raw ENUM value is already storable and passes through.
assert.equal(toStorablePaymentValue("credit"), "credit");

// ── 2. Every catalogue method converts to a value the ENUM actually holds ──
//
// The ENUM is `cash | card | bank_transfer | credit | mobile_money | split |
// cheque`. A catalogue row whose stored value fell outside it would raise at
// write time; this asserts that cannot happen for the shipped catalogue.
for (const method of PAYMENT_METHOD_CATALOG) {
  assert.ok(
    isLegacyPaymentValue(method.legacyValue),
    `${method.id} stores '${method.legacyValue}', which the ENUM cannot hold`,
  );
  assert.ok(
    isLegacyPaymentValue(toLegacyPaymentValue(method.id)),
    `${method.id} converts to a value the ENUM cannot hold`,
  );
}
for (const value of LEGACY_PAYMENT_VALUES) {
  assert.ok(isLegacyPaymentValue(value), `${value} must be a storable ENUM value`);
}
assert.ok(!isLegacyPaymentValue("transfer"), "'transfer' is not a real ENUM value");
assert.ok(!isLegacyPaymentValue("bank"), "'bank' is not a real ENUM value");
assert.ok(!isLegacyPaymentValue("online"), "'online' is not a real ENUM value");

// `cheque` shipped in the migration seed and must be a first-class catalogue row
// — its absence from the client registry once left it nameless and icon-less.
const cheque = getPaymentMethodDefinition("cheque");
assert.ok(cheque, "cheque must be in the catalogue");
assert.equal(cheque.legacyValue, "cheque");
assert.ok(isLegacyPaymentValue(cheque.legacyValue));

// ── 3. Named institutions share a generic value WITHOUT losing their name ──
//
// بنك الكريمي / جيب / فلوسك / ون كاش are not ENUM values of their own. They
// settle as the generic bank_transfer / mobile_money, and their `legacyIds` is
// deliberately empty so a stored generic value does not masquerade as them.
for (const id of ["kuraimi_bank", "yemen_kuwait_bank", "jaib", "floosak", "one_cash"]) {
  const def = getPaymentMethodDefinition(id);
  assert.ok(def, `${id} must be in the catalogue`);
  assert.deepEqual(def.legacyIds, [], `${id} must declare no legacy id of its own`);
  assert.ok(
    def.legacyValue === "bank_transfer" || def.legacyValue === "mobile_money",
    `${id} must settle as a generic bank/wallet value`,
  );
}

// The FIRST wallet carries the historical value; a stored `mobile_money`
// resolves to جوالي, not to one of the later wallets.
assert.equal(toCatalogId("mobile_money"), "jawali");
assert.equal(getPaymentMethodDefinition("jawali")?.legacyIds?.[0], "mobile_money");

// ── 4. `split` is never offered as a single tender ────────────────────────
//
// It is what an invoice RECORDS when paid by several methods, not a method an
// operator picks; offering it would let a single-tender invoice claim a split.
const splitDef = getPaymentMethodDefinition("split");
assert.ok(splitDef, "split must stay in the catalogue so historic invoices render");
assert.equal(isSelectableTender(splitDef), false);
for (const method of PAYMENT_METHOD_CATALOG) {
  if (method.id === "split") continue;
  assert.equal(isSelectableTender(method), true, `${method.id} must be selectable`);
}
assert.ok(!TENANT_SELECTABLE_LEGACY_VALUES.includes("split"));

// ── 5. Split detection covers the English marker too ──────────────────────
//
// The chip used to test only `[دفع مجزأ:` and so rendered the raw note marker
// on an invoice written in English mode.
assert.equal(isSplitPaymentValue("split"), true);
assert.equal(isSplitPaymentValue("cash", "[دفع مجزأ: نقدًا: 100]"), true);
assert.equal(isSplitPaymentValue("cash", "[Split: Cash: 100 | Card: 50]"), true);
assert.equal(isSplitPaymentValue("cash", "عميل دفع نقدًا"), false);
assert.equal(isSplitPaymentValue("cash", null), false);
assert.equal(isSplitPaymentValue(null, null), false);

// ── 6. Reference requirement comes from the catalogue, not a literal list ──
//
// The POS used to test two hard-coded ids, so بنك الكريمي silently dropped the
// transfer number the cashier typed.
assert.equal(requiresPaymentReference("kuraimi_bank"), true);
assert.equal(requiresPaymentReference("yemen_kuwait_bank"), true);
assert.equal(requiresPaymentReference("jaib"), true);
assert.equal(requiresPaymentReference("floosak"), true);
assert.equal(requiresPaymentReference("one_cash"), true);
assert.equal(requiresPaymentReference("cheque"), true);
assert.equal(requiresPaymentReference("bank_transfer"), true);
assert.equal(requiresPaymentReference("mobile_money"), true);
assert.equal(requiresPaymentReference("cash"), false);
assert.equal(requiresPaymentReference("card"), false);
assert.equal(requiresPaymentReference("credit"), false);
assert.equal(requiresPaymentReference(null), false);
assert.equal(requiresPaymentReference(undefined), false);

// ── 7. Historic records still read correctly ──────────────────────────────
//
// A stored ENUM value from an old document must keep its generic name; it must
// NOT be relabelled with a named institution that merely shares the value.
assert.equal(paymentMethodLabel("bank_transfer", "ar"), "تحويل بنكي");
assert.equal(paymentMethodLabel("bank_transfer", "en"), "Bank transfer");
assert.equal(paymentMethodLabel("mobile_money", "ar"), "محفظة إلكترونية");
assert.equal(paymentMethodLabel("cash", "ar"), "نقدًا");
assert.equal(paymentMethodLabel("cheque", "ar"), "شيك");
assert.equal(paymentMethodLabel("split", "ar"), "دفع بأكثر من طريقة");
assert.notEqual(paymentMethodLabel("bank_transfer", "ar"), "بنك الكريمي");
assert.notEqual(paymentMethodLabel("mobile_money", "ar"), "جوالي");

// A catalogue id is labelled from the catalogue, including a named institution.
assert.equal(paymentMethodLabel("kuraimi_bank", "ar"), "بنك الكريمي");
assert.equal(paymentMethodLabel("jawali", "en"), "Jawali");

// An unknown value is returned verbatim: a method we do not know about is
// information, not an error to be swallowed.
assert.equal(paymentMethodLabel("some_future_method", "ar"), "some_future_method");
assert.equal(paymentMethodLabel(null, "ar"), "—");
assert.equal(paymentMethodLabel(undefined, "ar"), "—");

// The business's own naming wins for the method it renamed, and only for it.
const overrides = { kuraimi_bank: { nameAr: "حوالات صنعاء", iconKey: "bank-transfer" } };
assert.equal(paymentMethodLabel("kuraimi_bank", "ar", overrides), "حوالات صنعاء");
assert.equal(paymentMethodLabel("bank_transfer", "ar", overrides), "تحويل بنكي");

// ── 8. The shipped order list is not a whitelist ──────────────────────────
//
// It orders the settings screen. Every id in it must exist in the catalogue —
// a stale id would render a row with no definition — and the catalogue must not
// contain a method the order list has forgotten.
const shippedIds = new Set(PAYMENT_METHOD_CATALOG.map((m) => m.id));
for (const id of SHIPPED_PAYMENT_METHOD_ORDER) {
  assert.ok(shippedIds.has(id), `order list names '${id}', which is not in the catalogue`);
}
for (const id of shippedIds) {
  assert.ok(
    (SHIPPED_PAYMENT_METHOD_ORDER as readonly string[]).includes(id),
    `catalogue method '${id}' is missing from the shipped order list`,
  );
}
assert.equal(new Set(SHIPPED_PAYMENT_METHOD_ORDER).size, SHIPPED_PAYMENT_METHOD_ORDER.length);

// `card` and the generic `mobile_money` were in the catalogue but absent from the
// picker whitelist that used to gate them — the reason they never appeared.
assert.ok(SHIPPED_PAYMENT_METHOD_ORDER.includes("card"));
assert.ok(SHIPPED_PAYMENT_METHOD_ORDER.includes("mobile_money"));
assert.ok(SHIPPED_PAYMENT_METHOD_ORDER.includes("cheque"));

// ── 9. Named institutions keep their own identity for display ────────────
//
// Two different banks share `bank_transfer`; a screen that only has the stored
// value must show the GENERIC name, and one that has the catalogue id must show
// the institution's. That is the whole reason `methodId` exists on the chip.
assert.notEqual(
  paymentMethodLabel("bank_transfer", "ar"),
  paymentMethodLabel("kuraimi_bank", "ar"),
  "a generic bank value must not be shown as a named bank",
);
assert.equal(getShippedPaymentMethod("kuraimi_bank")?.nameAr, "بنك الكريمي");
assert.equal(getShippedPaymentMethod("nonexistent_method"), undefined);

console.log("payment-methods: all checks passed");
