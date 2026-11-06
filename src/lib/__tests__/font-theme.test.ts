import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURATED_FONTS,
  DEFAULT_FONT_THEME,
  FONT_STORAGE_KEY,
  FONT_FAMILY_BOOT_MAP,
  type FontThemeId,
} from "../font-theme.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(__dirname, "../../../public/fonts");

console.log("==================================================");
console.log("Starting Vortex Typography & Local Fonts Test Suite");
console.log("==================================================");

// 1. Verify default font is ibm-plex (IBM Plex Sans Arabic)
assert.equal(DEFAULT_FONT_THEME, "ibm-plex", "Default font must be ibm-plex");
assert.equal(CURATED_FONTS["ibm-plex"].isDefault, true, "ibm-plex must be flagged isDefault");
assert.ok(CURATED_FONTS["ibm-plex"].fontFamily.includes("IBM Plex Sans Arabic"));

// 2. Verify total number of curated fonts (10 fonts: 1 default + 9 Arabic fonts)
const fontKeys = Object.keys(CURATED_FONTS) as FontThemeId[];
assert.equal(fontKeys.length, 10, "Must have exactly 10 curated local fonts");

const expectedFonts: FontThemeId[] = [
  "ibm-plex",
  "cairo",
  "tajawal",
  "noto-sans-arabic",
  "almarai",
  "readex-pro",
  "alexandria",
  "rubik",
  "noto-kufi-arabic",
  "changa",
];
assert.deepEqual(
  [...fontKeys].sort(),
  [...expectedFonts].sort(),
  "All 10 fonts must match expected IDs",
);

// 3. Verify metadata integrity for each font
for (const key of fontKeys) {
  const font = CURATED_FONTS[key];
  assert.equal(font.id, key, `Font ${key} id must match`);
  assert.ok(font.name_ar, `Font ${key} must have Arabic name`);
  assert.ok(font.name_en, `Font ${key} must have English name`);
  assert.ok(font.fontFamily, `Font ${key} must have fontFamily`);
  assert.ok(font.category_ar, `Font ${key} must have category_ar`);
  assert.ok(font.description_ar, `Font ${key} must have description_ar`);
  assert.ok(FONT_FAMILY_BOOT_MAP[key], `Font ${key} must exist in boot map`);
}

// 4. Verify local font files exist on disk in public/fonts
assert.ok(fs.existsSync(fontsDir), "public/fonts directory must exist");
assert.ok(fs.existsSync(path.join(fontsDir, "fonts.css")), "public/fonts/fonts.css must exist");

const fontsCss = fs.readFileSync(path.join(fontsDir, "fonts.css"), "utf8");
// Ensure fonts.css does not have external Google URLs
assert.equal(
  fontsCss.includes("https://fonts.gstatic.com"),
  false,
  "fonts.css must not reference external gstatic",
);
assert.equal(
  fontsCss.includes("https://fonts.googleapis.com"),
  false,
  "fonts.css must not reference external googleapis",
);

// Check folders on disk
const expectedFolders = [
  "IBM-Plex-Sans-Arabic",
  "Cairo",
  "Tajawal",
  "Noto-Sans-Arabic",
  "Almarai",
  "Readex-Pro",
  "Alexandria",
  "Rubik",
  "Noto-Kufi-Arabic",
  "Changa",
];

for (const folder of expectedFolders) {
  const folderPath = path.join(fontsDir, folder);
  assert.ok(fs.existsSync(folderPath), `Font folder ${folder} must exist`);
  const files = fs.readdirSync(folderPath);
  assert.ok(files.length > 0, `Font folder ${folder} must contain downloaded .woff2 files`);
  const woff2Files = files.filter((f) => f.endsWith(".woff2"));
  assert.ok(woff2Files.length > 0, `Font folder ${folder} must have .woff2 files`);
}

console.log(`✓ Verified ${fontKeys.length} curated fonts with complete local font files!`);
console.log("✓ Zero Google cloud dependencies found in fonts.css");
console.log("==================================================");
