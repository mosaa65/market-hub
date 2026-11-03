/**
 * Elegant template — alias متوافق مع البيانات القديمة.
 *
 * لم يعد قالب HTML مستقلاً؛ يعيد تصدير النمط الفاخر من ملف النمطين الموحد
 * (`standard.ts`) الذي يستدعي `renderUnifiedLayout` بثيم `luxury`.
 *
 * سبب الإبقاء: قيم القوالب القديمة (`elegant`, `premium`) محفوظة في
 * localStorage وفي overrides؛ حذف الملف يكسر تلك البيانات دون migration.
 */

export { renderElegantTemplate } from "./standard";
