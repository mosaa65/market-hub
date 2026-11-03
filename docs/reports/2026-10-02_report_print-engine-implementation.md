# تقرير Print Engine
## 1. Architecture before
كان `renderDocumentHTML` يختار renderer من `getTemplateRenderer`، وكانت القوالب تضع `@page` وحجم العرض داخلياً. `paperSize` محفوظ في localStorage لكنه لا يغيّر renderer فعلياً. المعاينة تستخدم `srcDoc`، والطباعة تستخدم iframe، بينما PDF له مسار jsPDF مستقل.

## 2. Architecture after
أضيفت طبقة typed صغيرة تتكون من:
- `paper-profiles.ts`: registry لـ A4 و80mm و58mm.
- `PrintTemplateMeta.supportedPaperProfiles`: توافق واضح لكل قالب.
- `PrintProfile` و`resolvePrintProfile`: ربط document type + template + paper مع fallback آمن.
- `renderDocumentHTML`: يضيف CSS الخاص بالـprofile ويزيل `onload` من HTML الموحد، ليصبح المصدر نفسه للمعاينة والطباعة.
- Preview يبدّل القالب والورق محلياً، ويعطّل profile غير المتوافق.

## 3. Files changed
- `src/lib/templates/paper-profiles.ts`
- `src/lib/templates/types.ts`
- `src/lib/templates/index.ts`
- `src/lib/templates/thermal.ts`
- `src/lib/templates/inventory.ts`
- `src/components/print-preview.tsx`
- `src/lib/templates/__tests__/print-engine.test.ts`
- `package.json`
- `docs/PRINT_ENGINE_IMPLEMENTATION_PLAN.md`

## 4. Data model
`PaperProfile` يصف العرض والارتفاع والهوامش والاتجاه. `PrintTemplateMeta` يصف الشكل والقوالب المتوافقة. `PrintProfile` يربط `documentType`, `templateId`, `paperProfileId`, و`options`.

## 5. Migration
تم الإبقاء على signatures القديمة لـ`renderInvoiceHTML` و`printDocument`. تمت إضافة profile resolution فوق القوالب الحالية، مع إبقاء renderers المتخصصة للمخزون. لا توجد إعادة كتابة شاملة ولا dependency جديدة.

## 6. paperSize
لم يُحذف. بقي في `PrintSettings` وlocalStorage كـlegacy/deprecated compatibility data. يستخدمه resolver لاختيار Paper Profile عند عدم تمرير profile صريح. لم يعد واجهة القرار المعمارية الأساسية في preview.

## 7. Preview
المعاينة HTML/CSS حقيقية داخل iframe، ولا تنشئ PDF أو network request عند تبديل القالب/الورق. اختيار مؤقت حتى الضغط على الطباعة، مع خيار صريح لحفظه كافتراضي.

## 8. Print
الطباعة تنشئ iframe مخفياً من نفس HTML الناتج عن renderer ثم تستدعي `window.print`; profile CSS يحدد `@page` وwidth، و`onload` الآلي أزيل لتجنب الطباعة العرضية في preview.

## 9. PDF
مسار jsPDF الحالي لم يُحذف أو يُعاد اختراعُه. ما زال adapter مستقلاً عند طلب PDF؛ اعتماد server-side Chromium مؤجل لحين تقييم بيئة الاستضافة والخطوط العربية.

## 10. Performance
التبديل محلي وmemoized، ولا يوجد PDF في preview، ولا توجد requests إضافية. Registry ثابت وخفيف، والـiframe الوحيد المستخدم هو preview أو print path.

## 11. Testing
أضيف اختبار zero-dependency للـregistry/resolver، وتم تشغيل TypeScript وlint. المشروع لديه مشاكل lint وTypeScript سابقة واسعة خارج نطاق Print Engine (موثقة في نتائج التنفيذ)، لذلك لم يكن validation العام أخضر.

## 12. Known limitations
- واجهة Settings الأساسية ما زالت تحتوي عناصر legacy `paperSize` للحفاظ على التوافق؛ ينبغي ترحيلها إلى cards/profile summary في مرحلة UX لاحقة.
- PDF لا يزال jsPDF layout مستقلاً؛ لا يمكن توحيده مع HTML بدون server-side browser renderer مناسب للاستضافة.
- 58mm يستخدم عائلة thermal الحالية مع width profile، وليس template thermal مخصصاً بالكامل.
- لا يوجد visual regression runner مثبت في المشروع؛ يلزم QA بصري عبر browser automation بعد تشغيل dev server.
