# Printing Implementation Report — تقرير التنفيذ

> التاريخ: 2026-10-04 · الفرع: \`feature/unified-printing-company-profile\`

---

## 1. ما تم اكتشافه

1. **ثلاث طبقات طباعة متوازية** تعمل في نفس الوقت (محرك موحد، محرك قوالب قديم، جزر مستقلة).
2. **قالبان HTML كاملان مكرران**: \`standard.ts\` (835 سطرًا) و\`elegant.ts\` (865 سطرًا) — HTML متطابق تقريبًا، الفرق ألوان فقط.
3. **مصدران للإعدادات**: \`vortex_print_settings_v2\` و\`vortex_print_settings\` (v1) بلا مزامنة.
4. **واجهتا معاينة**: واحدة قديمة تختار Normal/Luxury، وواحدة موحدة غير مستخدمة في الإعدادات.
5. **28 مسارًا من 46** في \`src/routes\` غير قابلة للبحث لأن \`navigationIndex\` كان يدويًا (18 عنصرًا).
6. **\`navigationIndex\` لا يطبّق \`canAccessRoute\`** — يعرض روابط قد تُرفض عند الفتح.
7. **بيانات شركة ثابتة**: \`"مطاحن"` في \`milling/print.ts\`، \`"Vortex ERP · Market Hub"` في \`report-print.ts\`، \`INAMA_SOFT_BRAND` في \`statements/company.ts\`.
8. **\`print-preview.tsx\`** يحوي نماذج بيانات ببيانات شركة وهمية (\`طاحونتي\` / \`772217218\` / \`إنما سوفت\`).
9. **\`window.print()\` محقون في HTML** القوالب القديمة، و\`printDocument\` لا يزيله (طباعة مزدوجة).
10. **\`showBranding\`** أصبح بلا أثر بعد إفراغ \`DEFAULT_BRANDING\`.

## 2. ما تم تغييره

### السجل المركزي للمسارات (المرحلة 2)
- أُنشئ \`route-registry.ts\` (44 مسارًا) + \`route-search.ts\` + \`route-icons.ts\`.
- \`app-shell.tsx\`: حُذفت مصفوفة \`sections\` اليدوية (~435 سطرًا) واستُبدلت بـ \`getSidebarSections()\`.
- Omnisearch وCommand Palette يستهلكان نفس السجل بنفس عوامل التصفية.
- اختبار يثبت أن كل مسار مهم له Search Entry، وأن البحث بالعربية/الإنجليزية/المرادفات يعمل.

### الإعدادات والـ adapters (المرحلة 3)
- \`adapters.ts\`: \`PrintAdapter\` + \`PRINT_ADAPTER_META\` + سجل الـ adapters.
- \`engine.ts\`: \`ADAPTERS\` الثلاثة مسجّلة؛ \`printUnifiedDocument\` يختار بالمعرّف لا بـ \`if\`.
- الطباعة الحرارية المباشرة مُعلَنة صراحة كغير مدعومة (\`supportsDirectOutput: false\`).

### توحيد القوالب (المرحلة 5)
- \`unified-layout.ts\` جديد (~480 سطرًا) يحل محل ~1700 سطر مكرر.
- \`standard.ts\` و\`elegant.ts\` أصبحا واجهتين رفيعتين (~30 سطرًا لكل منهما).
- \`normalizeTheme\` يقبل \`normal\` / \`standard\` / \`elegant\` / \`luxury\` / \`premium\` بلا فقدان.

### المعاينة (المرحلة 8)
- \`print-preview.tsx\` **حُذف**.
- \`universal-print-preview.tsx\` وُسِّع: معاينة · طباعة · تحميل PDF · مشاركة · إلغاء، و\`rtl\` صريح.

### Company Profile والفوتر (المرحلتان 9–10)
- \`milling/print.ts\`: حُذف \`readCompany()\` المحلي و\`"مطاحن"\`؛ يقرأ من \`company_settings_cache\` عبر نفس شكل Company Profile.
- \`report-print.ts\`: حُذف \`"Vortex ERP · Market Hub"\` الافتراضي.
- \`unified-layout.ts\` و\`formal.ts\` يستخدمان \`renderUniversalFooter\` حصريًا.
- فوتر التطبيق (\`inama-soft-footer.tsx\`) ثابت أسفل الشاشة على الهاتف وسطح المكتب (\`fixed inset-x-0 bottom-0\`).

### الترجمة (المرحلة 11)
- \`_app.transfers.tsx\`: دليل الصفحة كامل (~60 نصًا) انتقل إلى \`t()\` عبر \`buildTransferGuide(t)\`.
- \`_app.audit.tsx\`: كل نصوص الواجهة + الفلاتر + التفاصيل + أسماء الإجراءات + حقول/قيم الـ payload انتقلت إلى \`t()\`.
- أُضيف ~200 مفتاح ترجمة جديد (\`transfers.*\`، \`transfers.guide.*\`، \`audit.*\`).

## 3. الملفات المعدلة

**جديدة:**
- \`src/lib/navigation/route-registry.ts\`
- \`src/lib/navigation/route-search.ts\`
- \`src/lib/navigation/route-icons.ts\`
- \`src/lib/navigation/__tests__/route-registry.test.ts\`
- \`src/lib/navigation/index.ts\`
- \`src/lib/printing/adapters.ts\`
- \`src/lib/templates/unified-layout.ts\`
- \`src/lib/__tests__/unified-printing.test.ts\`
- \`docs/POST_MERGE_PRINTING_AUDIT.md\` · \`docs/UNIFIED_PRINTING_SYSTEM.md\` · \`docs/PRINTING_UNUSED_SETTINGS.md\` · \`docs/PRINTING_IMPLEMENTATION_REPORT.md\`

**معدّلة:**
- \`src/lib/templates/standard.ts\` · \`elegant.ts\` (1700 → 30 سطرًا)
- \`src/lib/templates/types.ts\` · \`index.ts\`
- \`src/lib/printing/engine.ts\` · \`i18n.ts\` · \`index.ts\` · \`footer.ts\`
- \`src/lib/print/report-print.ts\`
- \`src/lib/milling/print.ts\`
- \`src/lib/statements/company.ts\` · \`print.ts\`
- \`src/components/app-shell.tsx\` · \`universal-print-preview.tsx\`
- \`src/routes/_app.audit.tsx\` · \`_app.transfers.tsx\` · \`_app.purchases.tsx\`
- \`src/lib/i18n.tsx\`

**محذوفة:**
- \`src/components/print-preview.tsx\`

## 4. Migrations

| المصدر | الهدف | المكان |
| --- | --- | --- |
| \`vortex_print_settings` (v1) | \`vortex_print_settings_v2\` | \`normalizePrintSettings\` |
| \`printMode: auto/ask/off\` | \`behavior: direct/ask/off\` | \`normalizePrintSettings\` |
| \`paperSize: 80mm/58mm/A4/A5\` | \`paperId: thermal-80/thermal-58/a4/a5\` | \`normalizePrintSettings\` |
| \`elegant\` / \`premium\` | \`luxury\` | \`normalizeTheme\` |
| \`normal\` | \`standard\` | \`normalizeTheme\` |

SQL: \`supabase/migrations/...61004000000_company_profile_printing_fields.sql\`
يضيف \`footer_text\` · \`footer_contact\` · \`contact_numbers\` إلى \`company_settings\`.

## 5. الإعدادات الجديدة

\`orientation\` (portrait/landscape) · \`overrides\` لكل نوع مستند ·
\`footerEnabled\` · \`method\` بثلاث قيم مع \`PrintAdapter\` لكل قيمة.

## 6. القوالب والـ adapters وأنواع المستندات

- قالب واحد موحد + 3 themes (standard · luxury · formal) + قالب حراري.
- 3 adapters: browser · pdf · thermal (المباشر غير مدعوم — حد موثّق).
- 13 نوع مستند في \`DOCUMENT_TYPES\`.

## 7. البحث

44 مسارًا مسجّلًا (كان 18 يدويًا). كل مسار يُصفّى بـ: الوحدة + الصلاحية + وضع
المطحنة. البحث يدعم العربية والإنجليزية والتطبيع والمرادفات (تحويل/تحويلات،
مخزون، كشف/كشف حساب، مطحنة، طباعة، سجل الأحداث).

## 8. الترجمة

~200 مفتاح جديد. لا نص عربي مباشر متبقٍ في \`_app.transfers.tsx\` أو
\`_app.audit.tsx\` (بقيت فقط مقارنات اختيار البيانات ثنائية اللغة).

## 9. الفوتر و Company Profile

- \`renderUniversalFooter\` هو الفوتر الوحيد في كل المستندات.
- Company Profile هو المصدر الوحيد — لا اسم شركة ثابت في أي قالب.
- الرقمان \`784795104\` و\`772217218\` قابلان للتعديل من Company Profile مع
  fallback واضح عند غيابهما.
- اسم \`موسى العواضي\` لا يظهر في أي فوتر مرئي أو مستند مطبوع.

## 10. الاختبارات

| الأمر | النتيجة |
| --- | --- |
| \`npm run test:unified-printing\` | ✅ **81 اختبارًا** — البروفايلات (A4/A5/58/80، Portrait/Landscape، النسخ، Overrides) · الثيمات (Standard/Luxury/Formal + تطبيع القيم القديمة) · المستندات (فواتير، مرتجعات، سندات، كشوفات، مخزون، تحويلات، تقارير، مطحنة، تذاكر، سجلات) · Company Profile (الاسم من قاعدة البيانات، fallback، الشعار، البريد، العنوان، الرقمان، غياب اسم موسى) · الفوتر (يظهر، لا يختفي، لا يغطي المحتوى، لا يصعد للمنتصف، متعدد الصفحات، RTL/LTR) · Search (تغطية المسارات، التصفية، العربية، الإنجليزية، المرادفات، Enter) |
| \`npm run test:route-registry\` | ✅ تغطية المسارات + البحث + التصفية |
| \`npm run test:statements\` | ✅ |
| \`npm run test:reports-export\` | ✅ |
| \`npm run build\` | ✅ نجح |
| \`npm run lint\` | ✅ **0 أخطاء** في كل الملفات المعدّلة |

## 11. Browser QA

تم التحقق عبر \`npm run build\` الناجح + فحص الأنواع (\`tsc --noEmit\` نظيف) +
تشغيل مجموعات الاختبار الأربع.

**لم يُختبر فعليًا في متصفح حقيقي:** تغيير الإعدادات من الواجهة، إتمام بيع تجريبي
في POS، ومعاينة الفاتورة على الهاتف، والطباعة الفعلية على طابعة حرارية (يتطلب
عتادًا). هذه البنود تحتاج تشغيل \`npm run dev\` وفتح التطبيق يدويًا.

## 12. المشاكل المتبقية

1. **الطباعة الحرارية المباشرة غير مدعومة** — حد معماري موثّق، وليست عيبًا مخفيًا.
2. **واجهة تحرير Overrides لكل مستند** — النوع والقراءة جاهزان في المحرك؛ الواجهة تحتاج إضافة قسم Accordion في \`print-settings-card.tsx\`.
3. **\`showBranding\`** بلا أثر — يحتاج قرار المستخدم: حذف أو ربط بـ \`brandingText\`.
4. **إعدادات الطباعة الحرارية التفصيلية** (حجم الخط، الهوامش، عرض الأعمدة، إظهار/إخفاء الشعار) معرّفة نصيًا في \`PRINTING_LABELS\` لكن تحتاج حقولًا في الواجهة.
5. **\`milling/print.ts\`** يقرأ كاش Company Profile مباشرة — يمكن توحيده عبر \`getCachedCompanyProfile()\` في جولة لاحقة.
