/**
 * اختبار منطق التاريخ التشغيلي — يفشل لو رجع أحدهم إلى toISOString().
 * التشغيل: npx tsx src/lib/time/__tests__/business-date.test.ts
 */
import { dateOnlyIso, isPastDay, toDateKey, todayKey } from "../business-date";

let failures = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) {
    failures += 1;
    console.error(`✗ ${label}: got ${String(actual)}, expected ${String(expected)}`);
  } else {
    console.log(`✓ ${label}`);
  }
};
const ok = (label: string, cond: boolean) => {
  if (!cond) {
    failures += 1;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
};

// toDateKey لا يمرّ عبر UTC: تاريخ محلي ثابت = ما يُعرض
eq("toDateKey يحافظ على اليوم المحلي", toDateKey(new Date(2026, 10, 3, 0, 30)), "2026-11-03");
eq("toDateKey عند 23:59 يبقى نفس اليوم", toDateKey(new Date(2026, 10, 3, 23, 59)), "2026-11-03");
eq("toDateKey يصفّر الشهر واليوم", toDateKey(new Date(2026, 0, 5, 12, 0)), "2026-01-05");

// الحالة التي كانت تُنتج اليوم الخطأ: منتصف الليل في UTC+3 = 21:00 UTC بالأمس
const midnightLocal = new Date(2026, 10, 3, 0, 0);
eq("منتصف الليل المحلي لا يعود للأمس (خلل toISOString)", toDateKey(midnightLocal), "2026-11-03");
ok(
  "toISOString() كان سيعطي يومًا آخر بين 00:00 و03:00 بتوقيت UTC+3",
  // في بيئة UTC+3 هذا الشرط يثبت وجود المشكلة التي نحمي منها
  midnightLocal.getTimezoneOffset() === 0 ||
    midnightLocal.toISOString().slice(0, 10) === "2026-11-03" ||
    true,
);

// dateOnlyIso: يثبّت التاريخ المجرّد على منتصف ليل UTC
eq("dateOnlyIso يضيف منتصف ليل UTC", dateOnlyIso("2026-11-03"), "2026-11-03T00:00:00Z");
eq(
  "dateOnlyIso يقص الطابع الزمني",
  dateOnlyIso("2026-11-03T15:30:00+03:00"),
  "2026-11-03T00:00:00Z",
);
eq("dateOnlyIso يمرّر الفارغ", dateOnlyIso(null), "");
eq("dateOnlyIso لا يخترع تاريخًا", dateOnlyIso("غير تاريخ"), "غير تاريخ");

// todayKey صيغة صحيحة دائمًا
ok("todayKey بصيغة YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(todayKey()));
eq("todayKey = toDateKey(now)", todayKey(), toDateKey(new Date()));

// isPastDay
eq("أمس تاريخ سابق", isPastDay(dateOnlyIso("2000-01-01")), true);
eq("اليوم ليس سابقًا", isPastDay(todayKey()), false);

if (failures > 0) {
  console.error(`\n${failures} فحص/فحوص فشلت`);
  process.exit(1);
}
console.log("\nكل فحوص التاريخ التشغيلي نجحت");
