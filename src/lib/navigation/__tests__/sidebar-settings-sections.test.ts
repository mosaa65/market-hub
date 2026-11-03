/**
 * يتحقق من أن قسم «النظام والإعدادات» يعرض شاشاته في القائمة الجانبية
 * كما تنص §4.1 بند 3 من الخطة، وأن روابطه تشير إلى أقسام حقيقية.
 *
 * يُشغَّل بـ: npm run test:sidebar-settings
 */
import { getSidebarSections, SIDEBAR_HIDDEN_IDS } from "../route-registry";
import { getRegisteredSettingsSections } from "@/components/settings/settings-registry";
/*
 * القاموس العربي يُقرأ من مصدر الترجمة نفسه، لا من قائمة مكرّرة هنا —
 * وإلا صار الاختبار يفحص نسخة قد تتقادم بصمت بينما الواجهة تستخدم غيرها.
 */
import { translatedKeys } from "@/lib/i18n";

const AR_KEYS = translatedKeys("ar");

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const sections = getSidebarSections();
const settingsSection = sections.find((s) => s.category === "settings");

/* ── 1) القسم موجود ويحمل مداخله ───────────────────────────────── */

check("settings section exists in the sidebar", Boolean(settingsSection));
check(
  "settings section still contains the hub entry",
  Boolean(settingsSection?.entries.some((e) => e.path === "/settings")),
);

/* ── 2) شاشات الإعدادات تظهر كروابط حقيقية ────────────────────── */

const sectioned = (settingsSection?.entries ?? []).filter((e) =>
  e.path.startsWith("/settings?section="),
);

check("settings screens are listed inside the section", sectioned.length > 0);

/*
 * الحارس الأهم: كل رابط في القائمة يجب أن يقابل قسماً مسجّلاً فعلاً في
 * settings-registry. رابط يشير إلى قسم غير موجود يفتح `/settings` ويعرض
 * «القسم غير موجود» — وهو خطأ صامت لا يظهر إلا بالنقر.
 */
const registeredIds = new Set(getRegisteredSettingsSections().map((s) => s.id));
const brokenLinks = sectioned
  .map((entry) => new URLSearchParams(entry.path.split("?")[1]).get("section"))
  .filter((id): id is string => id !== null)
  .filter((id) => !registeredIds.has(id));

check(
  `every sidebar settings link targets a registered section (broken: ${brokenLinks.join(", ") || "none"})`,
  brokenLinks.length === 0,
);

/* ── 3) عناوين الترجمة موجودة، فلا تظهر مفاتيح خام للمستخدم ──── */

const missingKeys = sectioned
  .filter((entry) => entry.i18nKey)
  .map((entry) => entry.i18nKey as string)
  .filter((key) => !AR_KEYS.has(key));

check(
  `every settings link has an Arabic title (missing: ${missingKeys.join(", ") || "none"})`,
  missingKeys.length === 0,
);

/* ── 4) الرابط الجامع نفسه ليس مخفياً ───────────────────────────── */

check("the settings hub is not hidden from the sidebar", !SIDEBAR_HIDDEN_IDS.has("settings"));

/* ── 5) كل شاشة إعدادات لها رابط في القائمة (لا قسم محجوب بلا سبب) ── */

const linkedIds = new Set(
  sectioned
    .map((entry) => new URLSearchParams(entry.path.split("?")[1]).get("section"))
    .filter((id): id is string => id !== null),
);
const unlinked = [...registeredIds].filter((id) => !linkedIds.has(id));

check(
  `settings screens reachable from the sidebar (unlinked: ${unlinked.join(", ") || "none"})`,
  unlinked.length === 0,
);

if (failures.length > 0) {
  throw new Error(`Sidebar settings section tests failed:\n - ${failures.join("\n - ")}`);
}

console.log(`Sidebar settings section tests passed: ${passed}`);
