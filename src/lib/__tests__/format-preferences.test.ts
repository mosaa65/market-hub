import { formatQuantity, money } from "../format";
import { formatFormalDateTime, setDigitPreference, toSystemDigits } from "../format-preferences";

const values = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { dispatchEvent: () => true },
});

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  PASS  ${name}`);
    return;
  }
  failures++;
  console.error(`  FAIL  ${name}\n        expected ${expected}\n        actual   ${actual}`);
}

setDigitPreference("latin");
check("Latin quantity honours the preference", formatQuantity(1234.5), "1,234.5");
check(
  "Latin money does not inherit Arabic browser digits",
  /^[0-9,]+(?:\.[0-9]+)?\s/.test(money(1234.5)),
  true,
);
check(
  "Latin date/time honours the preference",
  /[٠-٩]/.test(formatFormalDateTime("2026-11-04T13:05:00Z", { isRtl: true }).full),
  false,
);

setDigitPreference("arabic");
check("Arabic digits are applied only by the preference", toSystemDigits("1,234.5"), "١,٢٣٤.٥");
check("Arabic quantity honours the preference", formatQuantity(1234.5), "١,٢٣٤.٥");

if (failures > 0) process.exit(1);
console.log("\n✅ format-preferences: all checks passed");
