import assert from "node:assert/strict";
import {
  CURATED_THEMES,
  DEFAULT_ACCENT_THEME,
  DEFAULT_COLOR_ARCHIVE,
  DEFAULT_CUSTOM_HEX,
  FUNCTIONAL_STATUS_TOKENS,
  auditThemeIndependence,
  calculateContrastRatio,
  deriveCustomColorVariables,
  getContrastForeground,
  hexToRgb,
  parseUserThemePreferences,
  serializeUserThemePreferences,
  type AccentThemeId,
  type UserThemePreferences,
} from "../color-theme.js";

console.log("==================================================");
console.log("Starting Enterprise Theme & Status Independence Tests");
console.log("==================================================");

// 1. Verify default theme is sapphire (Royal Blue)
assert.equal(DEFAULT_ACCENT_THEME, "sapphire");
assert.equal(CURATED_THEMES.sapphire.id, "sapphire");
assert.equal(CURATED_THEMES.sapphire.hex, "#2563EB");

// 2. Verify exactly 6 curated themes exist with distinct identities
type CuratedThemeKey = Exclude<AccentThemeId, "custom">;
const themeKeys = Object.keys(CURATED_THEMES) as CuratedThemeKey[];
assert.equal(themeKeys.length, 6, "Must have exactly 6 curated themes");
assert.deepEqual(
  [...themeKeys].sort(),
  ["amber", "amethyst", "emerald", "ruby", "sapphire", "topaz"].sort(),
);

for (const key of themeKeys) {
  const theme = CURATED_THEMES[key];
  assert.ok(theme.name_ar && theme.name_en, `Theme ${key} must have Arabic and English labels`);
  assert.match(theme.hex, /^#[0-9A-Fa-f]{6}$/, `Theme ${key} must have valid 6-char hex`);
  assert.ok(theme.light.primary, `Theme ${key} must have light primary token`);
  assert.ok(theme.dark.primary, `Theme ${key} must have dark primary token`);
  assert.ok(theme.light.ring, `Theme ${key} must have light ring token`);
  assert.ok(theme.dark.ring, `Theme ${key} must have dark ring token`);
}

// 3. Hex to RGB and contrast calculation
assert.deepEqual(hexToRgb("#2563EB"), { r: 37, g: 99, b: 235 });
assert.deepEqual(hexToRgb("#000000"), { r: 0, g: 0, b: 0 });
assert.deepEqual(hexToRgb("#FFFFFF"), { r: 255, g: 255, b: 255 });
assert.deepEqual(hexToRgb("invalid"), { r: 37, g: 99, b: 235 }); // Fallback to safe sapphire

assert.equal(
  getContrastForeground("#FFFFFF"),
  "oklch(0.12 0 0)",
  "Light color must have dark text",
);
assert.equal(getContrastForeground("#000000"), "oklch(1 0 0)", "Dark color must have white text");
assert.equal(getContrastForeground("#2563EB"), "oklch(1 0 0)", "Royal blue must have white text");

// WCAG contrast ratios
const blackOnWhiteRatio = calculateContrastRatio("#000000", "#FFFFFF");
assert.ok(blackOnWhiteRatio > 20, "Black on white contrast must be ~21:1");
const whiteOnSapphireRatio = calculateContrastRatio("#FFFFFF", "#2563EB");
assert.ok(whiteOnSapphireRatio >= 4.5, "White on sapphire must satisfy WCAG AA (>= 4.5:1)");

// 4. Custom palette derivation and archive defaults
const derived = deriveCustomColorVariables("#10B981");
assert.ok(derived.dark.primary.includes("rgb(16 185 129)"));
assert.ok(derived.dark.ring.includes("rgb(16 185 129 / 0.6)"));
assert.ok(derived.light.primary);
assert.ok(derived.light.ring);

assert.ok(DEFAULT_COLOR_ARCHIVE.length >= 8);
assert.ok(DEFAULT_COLOR_ARCHIVE.some((item) => item.hex.toLowerCase() === "#2563eb"));
assert.ok(DEFAULT_COLOR_ARCHIVE.some((item) => item.hex.toLowerCase() === "#059669"));

// 5. User Preferences Serialization and Cross-Device Synchronization Parsing
const samplePrefs: UserThemePreferences = {
  theme: "dark",
  accentTheme: "amethyst",
  customColor: "#8B5CF6",
  colorArchive: [
    {
      id: "test-custom-1",
      hex: "#8B5CF6",
      name_ar: "بنفسجي خاص",
      name_en: "Custom Purple",
    },
  ],
  updatedAt: 1700000000000,
};

const serialized = serializeUserThemePreferences(samplePrefs);
assert.equal(typeof serialized, "string");
const deserialized = parseUserThemePreferences(serialized);
assert.ok(deserialized);
assert.equal(deserialized.accentTheme, "amethyst");
assert.equal(deserialized.customColor, "#8B5CF6");
assert.equal(deserialized.theme, "dark");
assert.equal(deserialized.colorArchive.length, 1);
assert.equal(deserialized.colorArchive[0].hex, "#8B5CF6");

// Fallback handling for null, undefined, invalid JSON, or legacy raw strings
assert.equal(parseUserThemePreferences(null), null);
assert.equal(parseUserThemePreferences(""), null);
assert.equal(parseUserThemePreferences("invalid-json"), null);

// 6. Functional Status Token Independence and Auditing across all 6 Themes and both Modes
console.log("\nAuditing Functional Status Invariance for 6 themes in Light & Dark modes...");

const modes: ("light" | "dark")[] = ["light", "dark"];
let auditCount = 0;

for (const themeKey of themeKeys) {
  for (const mode of modes) {
    const report = auditThemeIndependence(themeKey, mode);
    auditCount++;

    assert.equal(report.themeId, themeKey);
    assert.equal(report.mode, mode);
    assert.equal(report.primaryHex, CURATED_THEMES[themeKey as CuratedThemeKey].hex);
    assert.ok(
      report.statusIntegrity.allIndependent,
      `Status independence compromised for ${themeKey} (${mode})`,
    );
    assert.ok(report.statusIntegrity.successIndependent, `Success color conflict for ${themeKey}`);
    assert.ok(report.statusIntegrity.warningIndependent, `Warning color conflict for ${themeKey}`);
    assert.ok(report.statusIntegrity.dangerIndependent, `Danger color conflict for ${themeKey}`);
    assert.ok(report.statusIntegrity.infoIndependent, `Info color conflict for ${themeKey}`);
    assert.ok(
      report.wcagContrast.passesAA,
      `WCAG AA contrast failure for ${themeKey}: ratio ${report.wcagContrast.ratio}`,
    );
    assert.ok(report.summaryTextAr.length > 0, "Summary audit text must be provided");
  }
}

// 7. Verify functional status tokens match expected system definitions
assert.equal(FUNCTIONAL_STATUS_TOKENS.success.hex, "#059669");
assert.equal(FUNCTIONAL_STATUS_TOKENS.warning.hex, "#D97706");
assert.equal(FUNCTIONAL_STATUS_TOKENS.danger.hex, "#E11D48");
assert.equal(FUNCTIONAL_STATUS_TOKENS.info.hex, "#2563EB");

console.log(
  `Successfully completed ${auditCount} visual theme audit runs (6 themes x 2 modes = 12 matrix permutations).`,
);
console.log("All Enterprise Theme & Status Independence tests passed 100%!");
