import assert from "node:assert/strict";
import {
  PAYMENT_METHOD_CATALOG,
  PAYMENT_METHOD_ICON_ASSETS,
  TENANT_SELECTABLE_LEGACY_VALUES,
  getPaymentMethodDefinition,
  paymentMethodIcon,
  paymentMethodIconAsset,
  paymentMethodLabel,
  toCatalogId,
  toLegacyPaymentValue,
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

console.log("payment-methods: all checks passed");
