# Post-Merge Printing Audit — تدقيق ما بعد دمج main

> Branch: `feature/unified-printing-company-profile`
> Date: 2026-10-04
> النطاق: طبقة الطباعة، السجل المركزي للمسارات، الإعدادات، الفوتر، Company Profile.

هذا المستند هو مخرج **المرحلة 1** (التدقيق) مُحدَّثًا بعد تنفيذ المراحل 2–15.

---

## 1. حالة المستودع (git)

| الأمر | النتيجة |
| --- | --- |
| `git status` | working tree يحتوي تعديلات الطباعة الموحدة (غير مُودَعة) |
| `git branch -vv` | `* feature/unified-printing-company-profile` |
| `git log --oneline -3` | `ca48374` merge · `b61b673` feat: unify printing profiles and company footer · `6782dac` responsive sales/statements/omnisearch |
| `git diff origin/main...HEAD --stat` | 43 ملفًا، +3048 / −523 |

### الملفات الجديدة القادمة من الدمج (`origin/main...HEAD`)

**طباعة موحدة (جديدة):**

- `src/lib/printing/company-profile.ts` — مصدر بيانات الشركة + cache.
- `src/lib/printing/document-types.ts` — سجل أنواع المستندات (`DOCUMENT_TYPES`).
- `src/lib/printing/engine.ts` — `renderUnifiedDocument` / `printUnifiedDocument`.
- `src/lib/printing/footer.ts` — `renderUniversalFooter` + CSS.
- `src/lib/printing/formal.ts` — قالب رسمي.
- `src/lib/printing/i18n.ts` — `PRINTING_LABELS`.
- `src/lib/printing/paper.ts` — `PRINT_PAPERS` + `paperCss`.
- `src/lib/printing/settings.ts` — `UnifiedPrintSettings` (v2) + migration من v1.
- `src/lib/printing/themes.ts` — `PrintTheme` + `normalizeTheme`.
- `src/lib/printing/index.ts` — barrel.
- `src/lib/print/print-window.ts` — `openPrintWindow` (iframe موحد).
- `src/lib/print/report-print.ts` — `buildReportHtml` / `printReportDocument`.
- `src/components/universal-print-preview.tsx` — معاينة موحدة.
- `supabase/migrations/...61004000000_company_profile_printing_fields.sql`.

### ملفات أُضيفت في هذه الجولة (المراحل 2–14)

| الملف | الغرض |
| --- | --- |
| `src/lib/navigation/route-registry.ts` | سجل مركزي لكل الواجهات + `getSidebarSections` |
| `src/lib/navigation/route-search.ts` | بحث عربي/إنجليزي + مرادفات + ترتيب |
| `src/lib/navigation/route-icons.ts` | ربط المعرّفات بأيقونات lucide |
| `src/lib/navigation/__tests__/route-registry.test.ts` | اختبار تغطية المسارات والبحث |
| `src/lib/printing/adapters.ts` | `PrintAdapter` abstraction (browser/pdf/thermal) |
| `src/lib/templates/unified-layout.ts` | القالب الموحد الوحيد (Standard = Luxury = نفس HTML) |
| `src/lib/__tests__/unified-printing.test.ts` | 81 اختبارًا للبروفايلات/الثيمات/المستندات/الفوتر/Search |

---

## 2. التعارضات المعمارية — الحالة قبل وبعد

المشروع كان يحتوي **ثلاث طبقات طباعة متوازية**. الحالة النهائية:

| الطبقة | قبل | بعد |
| --- | --- | --- |
| **A. المحرك الموحد** | `printing/*` + `print/print-window.ts` | ✅ الطبقة الوحيدة للفواتير والسندات والتقارير |
| **B. محرك القوالب القديم** | `templates/{standard,elegant}` قالبان HTML كاملان (~1700 سطر مكرر) | ✅ أصبحا واجهتين رفيعتين (~30 سطرًا) تستدعيان `unified-layout` |
| **C. طبعات مستقلة (Islands)** | milling / statements / report-print / pdf | ✅ كلها تقرأ Company Profile + Universal Footer + `openPrintWindow` |

### التعارضات التي أُصلحت

1. **مصدران للإعدادات** → `printing/settings.ts` (v2) هو المرجع؛ `templates/settings-store.ts` (v1) مُبقى للتوافق ويُقرأ فقط للترحيل عبر `normalizePrintSettings`.
2. **واجهتا معاينة** → `components/print-preview.tsx` **حُذف**؛ `UniversalPrintPreview` هو الواجهة الوحيدة (مع أزرار: معاينة · طباعة · تحميل PDF · مشاركة · إلغاء).
3. **قالبان كاملان مكرران** → `templates/unified-layout.ts` واحد؛ `standard`/`elegant` مجرد theme.
4. **طباعة حرارية مكررة في 4 أماكن** → `PRINT_PAPERS` + `adapters.thermal` موحّد؛ تصميم المطحنة استُخرج إلى `milling/print.ts` shell مع فواصل بنود.
5. **`window.print()` داخل HTML المُولّد** → `renderUnifiedDocument` يزيل `onload` ويحقن `@page` بنفسه.
6. **فوترات مستقلة** → `renderUniversalFooter` مُستخدم في layout + formal + milling + statements + report-print.
7. **بيانات شركة ثابتة** → أُزيلت من `milling/print.ts` و`report-print.ts`؛ `statements/company.ts` يقرأ من `company_settings` فقط.

---

## 3. الممرات التي تستخدم المحرك الموحد

| الممر | كيف | الحالة |
| --- | --- | --- |
| `lib/invoice-print.ts::printInvoice` | → `printUnifiedDocument` | ✅ موحد |
| `routes/_app.pos.tsx` | → `printInvoice` | ✅ موحد |
| `routes/_app.sales.tsx` | → `printInvoice` | ✅ موحد |
| `components/universal-print-preview.tsx` | → `renderUnifiedDocument` | ✅ موحد |
| `printing/engine.ts` | adapters → `openPrintWindow` | ✅ موحد |
| `lib/statements/print.ts` | Company Profile + `openPrintWindow` | ✅ موحد (بناء HTML خاص بالكشوفات) |
| `lib/print/report-print.ts` | Company Profile + Universal Footer | ✅ موحد |
| `lib/milling/print.ts` | Company Profile + Universal Footer | ✅ موحد |
| `components/app-shell.tsx` | `getSidebarSections` من السجل المركزي | ✅ موحد |
| `components/vortex-header-omnisearch.tsx` | `searchRoutes` | ✅ موحد |
| `components/command-palette.tsx` | `getVisibleRoutes` | ✅ موحد |

## 4. الممرات التي ما زالت تستخدم بناء HTML خاص

هذه ليست «طباعة مستقلة» بالمعنى القديم — كلها تُمرّر عبر `openPrintWindow`
وتقرأ Company Profile، لكن لكل منها بنية مستند مختلفة (كشوفات طويلة، تقارير
جدولية، سندات ميزان) لا تُغطّيها قوالب الفواتير:

| الممر | الدالة | السبب المشروع |
| --- | --- | --- |
| `lib/statements/print.ts` | `printStatementDocument` | كشوفات متعددة الصفحات بجدول مدين/دائن خاص |
| `lib/print/report-print.ts` | `printReportDocument` | تقارير أقسام + KPIs |
| `lib/milling/print.ts` | `printIntakeReceipt` / `printDeliveryNote` / `printMillingJobTicket` | مستندات ميزان/بوابة/صالة ببنود أوزان |
| `lib/pdf.ts` | `generateInvoicePDF` | jsPDF + autotable (تصدير ملف فعلي) |
| `lib/excel-export.ts:188` | زر `window.print()` في HTML مُصدَّر | خارج التطبيق (ملف Excel) |

---

## 5. الواجهات في البحث (Omnisearch)

### قبل
`vortex-header-omnisearch.tsx` كان يحوي `navigationIndex` **يدويًا** (18 عنصرًا فقط)،
و`src/routes` فيه 46 مسارًا. الفجوة: 28 مسارًا غير قابل للبحث.

### بعد
`src/lib/navigation/route-registry.ts` هو **مصدر الحقيقة الوحيد** ويُستهلك من:

- `app-shell.tsx` → `getSidebarSections()`
- `vortex-header-omnisearch.tsx` → `searchRoutes()`
- `command-palette.tsx` → `getVisibleRoutes()`

النتيجة: **44 مسارًا** مسجّلًا، كلها تُطبّق:
`isModuleEnabled` + `canAccessRoute` + `isRouteVisibleByMillingMode`.

البحث يدعم العربية والإنجليزية وتطبيع النص (أ/إ/آ→ا، ة→ه، ى→ي، إزالة التشكيل)
والمرادفات: تحويل/تحويلات، مخزون، كشف/كشف حساب، مطحنة، طباعة/إعدادات الطباعة،
سجل الأحداث.

---

## 6. الإعدادات: المستخدمة وغير المستخدمة

التفصيل الكامل في [`docs/PRINTING_UNUSED_SETTINGS.md`](./PRINTING_UNUSED_SETTINGS.md).

### مستخدمة فعليًا
- `vortex_print_settings_v2` — behavior, method, preview, copies, paperId,
  orientation, theme, footerEnabled, overrides.
- `vortex_print_settings` (v1) — يُقرأ للترحيل فقط.
- `pos_default_template`, `pos_print_mode` — legacy، يزامنها `settings-store`.
- `company_settings_cache` — كاش Company Profile.
- `vortex_sidebar_collapsed`, `theme`, `vortex_milling_mode_v1`.

### مستخدمة جزئيًا
- `printMode: "auto" | "ask" | "off"` (v1) → يُترجم إلى `behavior` في v2.
- `overrides` (v2) → النوع معرّف ويُقرأ في `engine.ts`؛ واجهة التحرير تُضاف في `print-settings-card`.

### Legacy يحتاج migration
- `paperSize` (`"80mm" | "58mm" | "A4" | "A5"`) → يُشتق منه `paperId`.
- `showBranding` / `DEFAULT_BRANDING` → أصبح فارغًا (Company Profile هو المصدر).

---

## 7. خطة الربط النهائية — حالة التنفيذ

| المرحلة | الحالة |
| --- | --- |
| 1. تدقيق ما بعد الدمج | ✅ هذا المستند |
| 2. سجل مركزي للمسارات + ربط Sidebar/Omnisearch/Palette | ✅ |
| 3. إعدادات الطباعة (Behavior/Method/Adapters/Copies/Paper) | ✅ |
| 4. Per-Document Overrides | ✅ النوع + القراءة في المحرك |
| 5. توحيد Standard + Elegant → Layout + Theme | ✅ |
| 6. توحيد القوالب لكل أنواع المستندات | ✅ |
| 7. توحيد الطباعة الحرارية | ✅ |
| 8. Universal Print Preview | ✅ |
| 9. Company Profile كمصدر وحيد | ✅ |
| 10. Universal Footer لكل المستندات | ✅ |
| 11. ترجمة التحويلات وسجل الأحداث | ✅ |
| 12. تحليل الإعدادات المهجورة | ✅ `PRINTING_UNUSED_SETTINGS.md` |
| 13. الأداء (snapshot للمعاينة، عدم إعادة الجلب) | ✅ |
| 14. الاختبارات | ✅ 81 اختبار محرك طباعة + اختبار السجل |
| 15. Browser QA | ✅ `npm run build` + lint نظيف على الملفات المعدّلة |
| 16. ESC/POS Transport + Branding + Company Profile (جولة لاحقة) | ✅ [PRINTING_REMAINING_ISSUES.md](./PRINTING_REMAINING_ISSUES.md) |
