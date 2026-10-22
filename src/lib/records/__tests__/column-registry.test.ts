import {
  defaultVisibility,
  isCustomized,
  resolveVisibility,
  type ColumnRegistry,
} from "../column-registry";
import { PRODUCTS_COLUMNS, COLUMN_REGISTRIES } from "../registries";

/**
 * Column registry rules (plan §9.1).
 *
 * These target the two failure modes that would be invisible in the UI but
 * corrupt a user's table:
 *   1. A stored preference that hides an essential column.
 *   2. A stale or unknown key leaking into the resolved map.
 */
const registry: ColumnRegistry = {
  id: "test",
  columns: [
    { key: "name", labelAr: "الاسم", labelEn: "Name", essential: true, defaultVisible: true },
    { key: "sku", labelAr: "رمز", labelEn: "SKU", defaultVisible: false },
    { key: "price", labelAr: "السعر", labelEn: "Price", defaultVisible: true },
  ],
};

const results: string[] = [];
let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    results.push(`  PASS  ${name}`);
  } else {
    failures++;
    results.push(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
  }
}

// 1. Defaults come straight from the registry.
check("defaults", defaultVisibility(registry), { name: true, sku: false, price: true });

// 2. An essential column cannot be hidden by a stored preference.
check(
  "essential cannot be hidden",
  resolveVisibility(registry, { name: false, sku: true, price: true }),
  { name: true, sku: true, price: true },
);

// 3. An unknown/stale key is dropped rather than carried forward.
check(
  "stale key dropped",
  resolveVisibility(registry, { name: true, sku: true, price: false, ghost: true }),
  { name: true, sku: true, price: false },
);

// 4. A brand-new column (absent from storage) takes its declared default, so
//    adding a field does not silently ship it hidden.
check("new column uses its default", resolveVisibility(registry, { name: true, price: true }), {
  name: true,
  sku: false,
  price: true,
});

// 5. A non-boolean stored value is ignored in favour of the default.
check(
  "non-boolean value falls back",
  resolveVisibility(registry, {
    name: true,
    sku: "yes" as unknown as boolean,
    price: true,
  }),
  { name: true, sku: false, price: true },
);

// 6. `isCustomized` only reports a real departure from the defaults.
check("not customized at defaults", isCustomized(registry, defaultVisibility(registry)), false);
check(
  "customized after a change",
  isCustomized(registry, { name: true, sku: true, price: true }),
  true,
);

// 7. Every registry declares exactly one essential identity column and an
//    actions column that is essential — the plan forbids hiding either.
for (const [key, reg] of Object.entries(COLUMN_REGISTRIES)) {
  const essentials = reg.columns.filter((c) => c.essential).map((c) => c.key);
  const actions = reg.columns.find((c) => c.key === "actions");
  check(`${key}: has essential columns`, essentials.length >= 1, true);
  check(`${key}: actions are essential`, actions?.essential, true);
  check(
    `${key}: columns have unique keys`,
    new Set(reg.columns.map((c) => c.key)).size,
    reg.columns.length,
  );
  check(`${key}: registry id matches its map key`, reg.id, key);
}

// 8. Products specifically: the English name and SKU start hidden (§9.2).
check(
  "products: English name hidden by default",
  PRODUCTS_COLUMNS.columns.find((c) => c.key === "name_en")?.defaultVisible,
  false,
);
check(
  "products: SKU hidden by default",
  PRODUCTS_COLUMNS.columns.find((c) => c.key === "sku")?.defaultVisible,
  false,
);
check(
  "products: name always visible",
  PRODUCTS_COLUMNS.columns.find((c) => c.key === "name")?.essential,
  true,
);

console.log(results.join("\n"));
console.log(
  failures === 0
    ? `\n✅ column-registry: all ${results.length} checks passed`
    : `\n❌ column-registry: ${failures} of ${results.length} checks failed`,
);
if (failures > 0) process.exit(1);
