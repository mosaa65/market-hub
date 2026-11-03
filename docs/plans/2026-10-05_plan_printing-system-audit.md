# تدقيق نظام الطباعة وخطة توحيده

## نطاق التدقيق

تم فحص محرك القوالب، إعدادات الطباعة، مسارات الفواتير والمخزون والمطحنة والكشوفات والتقارير، نافذة المعاينة، البحث الشامل، إعدادات المنشأة، ملفات PDF، وسجل التدقيق. هذا المستند يمثل خط الأساس قبل التغيير على الفرع `feature/unified-printing-company-profile`.

## 1. الوضع الحالي

يوجد في المشروع نواة قابلة لإعادة الاستخدام داخل `src/lib/templates`، وتشمل تسجيل القوالب، حل `PrintProfile`، ملفات تعريف الورق، تخزين الإعدادات، وتوليد HTML مشترك للمعاينة والطباعة. لكنها لا تزال مرتبطة تاريخيًا بمسميات الفواتير وبنوعين رئيسيين فقط: `customer_invoice` و`inventory_document`.

يوجد أيضًا مسارات طباعة مستقلة للكشوفات والتقارير والمطحنة وPDF القديم. لذلك فالنظام الحالي أقرب إلى محرك فواتير قابل للتوسع مع عدة ممرات قديمة، وليس منصة طباعة موحدة لكل المستندات.

## 2. أماكن كود الطباعة

| المجال                   | الملفات/المواقع                                                                    | الملاحظات                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| النواة الحالية           | `src/lib/templates/index.ts`, `types.ts`                                           | registry، profile resolution، `renderDocumentHTML`، `printDocument`، `printJob` |
| القوالب                  | `thermal.ts`, `standard.ts`, `elegant.ts`, `inventory.ts`                          | HTML/CSS مضمن؛ وجود نسخ مخصصة للمخزون                                           |
| إعدادات النواة           | `settings-store.ts`, `paper-profiles.ts`                                           | localStorage مع مفاتيح legacy (`pos_default_template`, `pos_print_mode`)        |
| الفواتير                 | `src/lib/invoice-print.ts`, `_app.pos.tsx`, `_app.sales.tsx`                       | POS والمبيعات يستخدمان adapter قديمًا فوق النواة                                |
| PDF/jsPDF                | `src/lib/pdf.ts`                                                                   | jsPDF وjspdf-autotable لمسار PDF مستقل، مع HTML print لبعض التقارير             |
| التقارير                 | `src/lib/print/report-print.ts`                                                    | مولد تقرير A4 عام، يستخدم `openPrintWindow`                                     |
| الكشوفات                 | `src/lib/statements/print.ts`, `print-sections.ts`, `print-styles.ts`              | قالب كشف مستقل مع شركة وفوتر مستقلين                                            |
| الطباعة المشتركة للنوافذ | `src/lib/print/print-window.ts`                                                    | iframe مخفي؛ `pdf.ts` يحتوي مسار نافذة أقدم أيضًا                               |
| المطحنة                  | `src/lib/milling/print.ts`                                                         | ثلاثة مستندات، Thermal/A4/A5، قراءة localStorage مباشرة وطباعة مستقلة           |
| المعاينة                 | `src/components/print-preview.tsx`                                                 | تستخدم HTML النواة، لكنها تعرض خيارات قديمة ومثالًا hard-coded                  |
| إعدادات الواجهة          | `src/components/print-settings-card.tsx`, `settings/sections/printing-section.tsx` | إعدادات نوعين فقط وقوالب thermal/standard/elegant                               |
| footer المنتج            | `src/components/inama-soft-footer.tsx`                                             | يحتوي هوية واسمًا شخصيًا ظاهرًا للمستخدم                                        |

## 3. القوالب الحالية

- `thermal`: إيصال 58/80mm، مع renderer خاص للمخزون عند `inventory_document`.
- `standard`: قالب A4 أعمال، لكن يتضمن بيانات شركة افتراضية hard-coded.
- `elegant`: قالب A4 فاخر منفصل HTML/CSS عن standard.
- `inventory`: نسختان متخصصتان للمخزون، حراري وA4.
- قوالب المطحنة داخل `src/lib/milling/print.ts` ليست أعضاء في registry الحالي.
- قالب statements مستقل عن registry.
- تقارير `report-print` لها layout مستقل عن registry.

المطلوب هو الإبقاء على المخرجات الحالية أثناء نقلها تدريجيًا إلى registry/schema مشترك. لا توجد حاجة لإنشاء قالب منفصل باسم `normal`؛ المسميات القديمة `standard` و`elegant` يجب تطبيعها إلى layout موحد وtheme مختلف.

## 4. الإعدادات الحالية

`PrintSettings` محفوظ في `localStorage` تحت `vortex_print_settings` ويحتوي على:

- القالب الافتراضي للعميل والمخزون.
- paper profile للعميل والمخزون.
- `paperSize` legacy.
- `autoPrintCustomerInvoice` و`autoPrintInventoryDocument`.
- `printMode`: `auto | ask | off`.
- مفاتيح إظهار/إخفاء logo، بيانات الشركة، العميل، الحركة، الماليات، التوقيعات، footer وbranding.

ملفات الورق الحالية: `a4`, `thermal-80`, `thermal-58`. لا يوجد landscape فعلي في registry، ولا copies، ولا print method abstraction، ولا overrides عامة لكل document type.

بيانات المنشأة الرسمية موجودة أصلًا في جدول `company_settings` وواجهة Settings. الأعمدة الموجودة تشمل الاسم، الاسم القانوني، الرقم الضريبي، العملة، الشعار، العنوان، الهاتف والبريد الإلكتروني. توجد cache للعملة في `src/lib/format.ts` وcache منفصلة تقرأها المطحنة.

## 5. الإعدادات غير المستخدمة أو المستخدمة جزئيًا

- `paperSize` محفوظ لكنه لا يمثل كل خصائص profile ولا يفرض orientation.
- `defaultCustomerPaperProfile` و`defaultInventoryPaperProfile` مستخدمان في النواة، لكن بقية الممرات لا تقرأهما.
- `autoPrint*` مستخدمان في `printJob` وPOS بصورة جزئية؛ بقية أنواع المستندات لا تملك behavior.
- `showFooter` و`showBranding` لا يضمنان footer موحدًا بين statements/reports/milling.
- `showLogo` موجود في الخيارات، لكن بعض القوالب لا تعرض الشعار فعليًا.
- `PrintPreviewModal` يعرض عينة hard-coded ولا يمرر Company Profile الحقيقي.
- مفاتيح `pos_default_template` و`pos_print_mode` legacy ما زالت مصدرًا قد يتغلب على الإعداد الموحد.
- المطحنة تقرأ `company_settings_cache` مباشرة بدل Company Profile مركزي.
- `jsPDF` و`jspdf-autotable` موجودان لمسار PDF لكنه غير موحد مع HTML preview.

## 6. أنواع المستندات الحالية

في `src/lib/templates/types.ts`: `customer_invoice`, `purchase_invoice`, `sales_return`, `purchase_return`, `stock_transfer`, `stock_receipt`, `stock_issue`, `payment_receipt`, `quotation`, `delivery_note`, `inventory_document`.

عمليًا توجد أيضًا:

- كشوف العملاء والموردين وكشف الديون.
- تقارير المبيعات والمنتجات والدفع والمخزون والتقارير المالية.
- مستندات المطحنة: intake receipt، delivery note، milling job ticket.
- التذاكر اليومية وسجل العمليات/التدقيق.
- ملفات PDF للفواتير وبعض التقارير.

## 7. نقاط التكرار والتضارب

1. ثلاث دورات طباعة رئيسية: النواة، `milling/print.ts`، وstatements/reports.
2. أكثر من footer: قوالب الفواتير، statements، reports، المطحنة، و`InamaSoftFooter`.
3. fallback لبيانات الشركة hard-coded داخل standard/elegant/preview والمبيعات.
4. استخدام أسماء هوية المنتج بدل Company Profile في بعض المستندات.
5. وجود `body onload=window.print()` داخل القوالب؛ النواة تزيله للطباعة، لكن القوالب نفسها غير نظيفة للمعاينة.
6. مساران للنافذة: iframe في `print-window.ts` و`window.open` داخل `pdf.ts`.
7. اختيار القالب في POS منفصل عن صفحة Printing Settings.
8. المطحنة تستخدم `a4/a5/thermal` بينما النواة تستخدم `PaperProfileId` مختلفًا.
9. البحث الشامل يسجل 15 واجهة تقريبًا فقط رغم وجود 47+ route في shell و51 route فعليًا.
10. بعض النصوص الجديدة في صفحات المطحنة وواجهة الطباعة مكتوبة مباشرة في JSX/HTML بدل i18n.

## 8. ما يمكن إعادة استخدامه

- `templateRegistry` و`getCompatibleTemplates` و`resolvePrintProfile` أساس مناسب.
- `UnifiedDocumentData` يمكن توسيعه إلى schema مشترك مع mappers.
- `paperCss` و`PAPER_PROFILES` أساس جيد للتوجه والمقاسات.
- `openPrintWindow` مناسب ليكون BrowserPrintAdapter الوحيد.
- `report-print` يطبق تكرار رؤوس الجداول وRTL/LTR وعزل الأرقام بصورة جيدة.
- مكونات تخطيط المطحنة تحتوي على تسلسل بصري مفيد للورق الحراري.
- جدول `company_settings` هو المصدر الصحيح ولا يلزم جدول Company Profile ثانٍ.
- `useI18n` وقاموس `src/lib/i18n.tsx` هما مصدر الترجمة.

## 9. المعمارية المقترحة

```text
DocumentData + DocumentType
        |
        v
Document Mapper / Normalizer
        |
        v
Company Profile Resolver (company_settings/cache)
        |
        v
Print Profile (global defaults + document override)
        |
        v
Template Registry: unified-modern / formal / thermal
        |
        v
Theme + Layout + Universal Header/Footer
        |
        v
Rendered HTML / Document Model
        |
        +--> UniversalPrintPreview
        +--> BrowserPrintAdapter
        +--> PdfAdapter (existing jsPDF where supported)
        +--> ThermalAdapter (future/local adapter boundary)
```

القاعدة: document mapper يختلف حسب نوع المستند، أما template/theme/layout/adapter فلا يكرر business logic.

## 10. خطة التنفيذ المرحلية

1. إنشاء branch وتثبيت هذا audit.
2. إنشاء طبقة `src/lib/printing` للأنواع، Company Profile، profiles، themes، footer، adapters، settings.
3. تطبيع `standard/elegant` إلى template layout موحد مع themes، وإضافة Formal.
4. نقل thermal إلى registry الموحد مع 58/80mm ونسخ المطحنة تدريجيًا.
5. تطوير settings إلى Global Defaults + Per Document Overrides مع migration آمن.
6. استبدال hard-coded company/footer بresolver مركزي.
7. جعل preview وbrowser print يستهلكان نفس HTML بلا side effects.
8. ربط POS والمبيعات ثم statements/reports ثم mill adapters دون تغيير business logic.
9. توسيع route/search index من مصدر واحد وإضافة إعدادات الشركة والطباعة وكل routes المهمة.
10. إضافة i18n واختبارات rendering/profile/compatibility وlint/build.
11. توثيق المعمارية والتقرير النهائي.

## 11. المخاطر المحتملة

- تغيّر schema `company_settings` بين البيئات؛ لذلك يجب استخدام الأعمدة الموجودة فقط أو migration nullable.
- كسر إعدادات المستخدم القديمة؛ يلزم fallback وتطبيع `normal/luxury/standard/elegant`.
- اختلاف دعم CSS للطباعة الحرارية بين المتصفحات.
- الخط العربي والصور قد تؤخر POS؛ يجب عدم إعادة fetch داخل preview.
- بعض الممرات لا تملك `UnifiedDocumentData` كاملًا؛ يلزم mapper صغير لكل نوع.
- PDF العربي عبر jsPDF قد يحتاج الإبقاء على مسار HTML كخيار افتراضي.

## 12. خطة الاختبار

- اختبارات unit لـsettings migration، profile resolution، document registry، themes وfooter.
- اختبار HTML يثبت غياب الأسماء hard-coded ووجود Company Profile والرقم القابل للتعديل.
- اختبار كل document type مع fallback إلى template مناسب.
- A4/A5/58/80mm، portrait/landscape، RTL/LTR.
- preview وbrowser print من نفس HTML.
- نسخة واحدة ونسخ متعددة عند دعم adapter.
- بيانات طويلة، عدة صفحات، آخر بند، footer، logo غائب وحاضر.
- POS complete sale دون إعادة جلب بيانات المستند في preview.
- `npm run lint`, `npm run build`, والاختبارات الحالية `test:print-engine`, `test:statements`, `test:reports-export`.

## نتيجة التدقيق

النواة الحالية تستحق التوسعة ولا ينبغي استبدالها بنظام ثانٍ. أكبر قيمة هندسية هي بناء facade موحد فوقها، إزالة البيانات الثابتة، توحيد footer والprofiles، ثم نقل الممرات الخاصة تدريجيًا. البحث كذلك يحتاج registry مشترك بدل قائمة يدوية مختصرة.

