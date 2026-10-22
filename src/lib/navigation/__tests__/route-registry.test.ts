/**
 * Route Registry tests — يتحقق أن كل مسار مهم قابل للوصول له Search Entry،
 * وأن البحث بالعربية/الإنجليزية/المرادفات يعمل، وأن Enter يفتح المسار الصحيح.
 *
 * يُشغّل بـ: npx tsx src/lib/navigation/__tests__/route-registry.test.ts
 */

import {
  ROUTE_REGISTRY,
  getVisibleRoutes,
  ROUTE_BY_ID,
  SIDEBAR_SECTION_ORDER,
  getSidebarSections,
} from "../route-registry";
import { searchRoutes } from "../route-search";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) passed += 1;
  else failures.push(name);
}

/** كل مسار في السجل يجب أن يكون فريدًا ويحمل بيانات كاملة. */
const ids = ROUTE_REGISTRY.map((e) => e.id);
check("route ids are unique", new Set(ids).size === ids.length);

const paths = ROUTE_REGISTRY.map((e) => e.path);
check("full paths are unique", new Set(paths).size === paths.length);

// المسارات الأساسية قد تتكرر فقط لأقسام الإعدادات أو لتقارير فرعية تستخدم
// المجال نفسه مع `?report=`؛ يجب أن تعلن الأخيرة أباً مرئياً في القائمة.
const basePaths = ROUTE_REGISTRY.map((e) => e.path.split("?")[0]);
const duplicateBaseEntries = ROUTE_REGISTRY.filter(
  (entry) => basePaths.filter((path) => path === entry.path.split("?")[0]).length > 1,
);
check(
  "duplicate base paths are limited to settings sections and report children",
  duplicateBaseEntries.every(
    (entry) =>
      entry.path.split("?")[0] === "/settings" ||
      Boolean(entry.sidebarParentId) ||
      entry.category === "reports",
  ),
);
check(
  "every report child points to an existing sidebar domain",
  ROUTE_REGISTRY.filter((entry) => entry.sidebarParentId).every((entry) =>
    ROUTE_REGISTRY.some((parent) => parent.id === entry.sidebarParentId),
  ),
);

check(
  "every entry has Arabic + English titles",
  ROUTE_REGISTRY.every((e) => e.titleAr.trim() && e.titleEn.trim()),
);
check(
  "every entry has Arabic + English descriptions",
  ROUTE_REGISTRY.every((e) => e.descriptionAr.trim() && e.descriptionEn.trim()),
);
check(
  "every entry declares a category",
  ROUTE_REGISTRY.every((e) => Boolean(e.category)),
);

/** المسارات المهمة المطلوبة يجب أن تكون مسجّلة. */
const REQUIRED_ROUTES = [
  "/dashboard",
  "/pos",
  "/sales",
  "/purchases",
  "/sales-returns",
  "/customers",
  "/suppliers",
  "/debts",
  "/payments",
  "/expenses",
  "/inventory",
  "/warehouses",
  "/transfers",
  "/batches",
  "/barcodes",
  "/statements/customer",
  "/statements/supplier",
  "/statements/cash",
  "/audit",
  "/settings",
  "/milling",
  "/milling/intake",
  "/milling/milling",
  "/milling/delivery",
  "/milling/customer-statement",
  "/milling/manufacture",
  "/milling/performance",
];
for (const path of REQUIRED_ROUTES) {
  check(`required route registered: ${path}`, paths.includes(path));
}

/** التصفية بالوحدات: وحدة معطّلة تُخفي عنصرها. */
const withModulesOff = getVisibleRoutes({ isModuleEnabled: (id) => id !== "multi_warehouse" });
check("disabled module hides its routes", !withModulesOff.some((e) => e.id === "transfers"));
check(
  "unrelated routes stay visible when a module is disabled",
  withModulesOff.some((e) => e.id === "dashboard"),
);

/** التصفية بالصلاحيات: عنصر ممنوع لا يظهر. */
const cashierOnly = getVisibleRoutes({ canAccess: (e) => e.id !== "audit" });
check("permission filter hides audit", !cashierOnly.some((e) => e.id === "audit"));

/** البحث بالعربية. */
check("Arabic search: تحويلات → transfers", searchRoutes("تحويلات", true)[0]?.id === "transfers");
check(
  "Arabic search: كشف حساب → statements",
  searchRoutes("كشف حساب", true)[0]?.id === "statement-customers",
);
check("Arabic search: مطحنة → milling", searchRoutes("مطحنة", true)[0]?.id === "milling");
check("Arabic search: سجل الأحداث → audit", searchRoutes("سجل الأحداث", true)[0]?.id === "audit");

/** البحث بالإنجليزية. */
check("English search: transfers", searchRoutes("transfers", false)[0]?.id === "transfers");
check(
  "English search: audit",
  searchRoutes("audit", false).some((entry) => entry.id === "audit"),
);
check("English search: inventory", searchRoutes("inventory", false)[0]?.id === "inventory");

/** البحث بالمرادفات. */
check(
  "synonym search: طباعة → printing settings",
  searchRoutes("طباعة", true).some((e) => e.id === "printing-settings"),
);
check(
  "synonym search: مخزون → inventory",
  searchRoutes("مخزون", true).some((entry) => entry.id === "inventory"),
);

/** Enter يفتح المسار الصحيح: أول نتيجة لها path صالح يبدأ بـ '/'. */
const firstHit = searchRoutes("كشف", true)[0];
check("search hit exposes a navigable path", Boolean(firstHit) && firstHit.path.startsWith("/"));

/** لا توجد عناصر مكررة بالمعرّف. */
check(
  "no duplicate ids in registry",
  new Set(ROUTE_REGISTRY.map((e) => e.id)).size === ROUTE_REGISTRY.length,
);

/** ROUTE_BY_ID متسق. */
check(
  "ROUTE_BY_ID matches registry size",
  Object.keys(ROUTE_BY_ID).length === ROUTE_REGISTRY.length,
);

/**
 * فئات السجل كلها يجب أن يكون لها قسم في القائمة الجانبية.
 *
 * هذا هو الفحص الذي كان غائباً فسقط قسم الإعدادات بصمت: `settings` فئة
 * صحيحة، ومداخلها الأربعة سليمة ومصرَّح بها، لكنها لم تُذكر في
 * SIDEBAR_SECTION_ORDER — وهي مرشّح ضمني، فأي فئة غائبة منها لا تُعرض ولا
 * يُشتكى. النتيجة كانت صفحة إعدادات بلا أي زر يقود إليها في القائمة.
 */
const declaredCategories = new Set(ROUTE_REGISTRY.map((e) => e.category));
const sidebarCategories = new Set(SIDEBAR_SECTION_ORDER.map((s) => s.category));
for (const category of declaredCategories) {
  check(`category reachable from the sidebar: ${category}`, sidebarCategories.has(category));
}

/** وكل قسم في القائمة يجب أن يخرج بمداخل فعلية. */
const sidebarSections = getSidebarSections();
check(
  "every sidebar section has entries",
  sidebarSections.every((section) => section.entries.length > 0),
);

/**
 * «التقارير» هو الأب في القائمة، وتحته المجالات الستة فقط. التقرير الفردي
 * يختار من شاشة مجاله حتى لا تتحول القائمة الجانبية إلى قائمة طويلة.
 */
const reportsSection = sidebarSections.find((section) => section.category === "reports");
check(
  "reports sidebar lists the six domains only",
  Boolean(reportsSection) &&
    reportsSection!.entries.length === 6 &&
    reportsSection!.entries.every((entry) => !entry.sidebarParentId),
);
check(
  "individual report links stay searchable but are absent from the sidebar",
  ROUTE_REGISTRY.some((entry) => entry.sidebarParentId) &&
    Boolean(reportsSection) &&
    !reportsSection!.entries.some((entry) => Boolean(entry.sidebarParentId)),
);

/**
 * /settings يجب أن يبقى مسجّلاً ومسموحاً للمالك، لأن غلاف التطبيق يبني عليه
 * زر الإعدادات: لو حُذف المدخل أو ضاقت صلاحيته لاختفى الزر بصمت.
 */
const settingsEntry = ROUTE_BY_ID["settings"];
check("settings entry exists", Boolean(settingsEntry));
check(
  "settings is owner/manager only",
  Boolean(settingsEntry) &&
    ["owner", "manager"].every((role) =>
      (settingsEntry!.requiredRoles ?? []).includes(role as never),
    ),
);
check(
  "settings is visible to an owner",
  getVisibleRoutes().some((e) => e.id === "settings"),
);

/*
 * شاشات الإعدادات تظهر داخل قسم «النظام والإعدادات» في القائمة.
 *
 * كان الاختبار السابق يشترط العكس (أن تبقى خارج القائمة)، وهو قرار قديم
 * عكسَته الخطة في §4.1 بند 3: يجب أن يتوسّع القسم ويعرض شاشاته مباشرةً
 * بدل أن يُطوى على رابط عام واحد.
 */
const settingsSection = sidebarSections.find((section) => section.category === "settings");

check(
  "settings section reveals its screens in the sidebar",
  Boolean(
    settingsSection && settingsSection.entries.some((e) => e.path.startsWith("/settings?section=")),
  ),
);

check(
  "every sectioned settings link targets a real query string",
  (settingsSection?.entries ?? [])
    .filter((e) => e.path.startsWith("/settings?"))
    .every((e) => new URLSearchParams(e.path.split("?")[1]).get("section") !== null),
);

/** رابط الإعدادات الجامع يبقى موجوداً لفتح الشاشة الرئيسية للقسم. */
check(
  "the settings hub entry is still present",
  Boolean(settingsSection?.entries.some((e) => e.path === "/settings")),
);

if (failures.length > 0) {
  throw new Error(`Route registry tests failed:\n - ${failures.join("\n - ")}`);
}

console.log(`Route registry tests passed: ${passed}`);
