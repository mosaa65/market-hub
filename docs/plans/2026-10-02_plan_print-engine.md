# خطة تنفيذ Print Engine في Market-Hub
## A. الوضع الحالي
المسار الحالي هو:

```text
Document
  -> renderDocumentHTML(doc, templateId, labels, rtl, options)
  -> getTemplateRenderer(templateId, docType)
  -> template renderer
  -> HTML يحتوي @page داخلياً
  -> iframe ثم window.print()
```

- اختيار القالب يتم من `src/lib/templates/index.ts` أو من `PrintSettings` في `settings-store.ts`.
- `defaultCustomerTemplate` و`defaultInventoryTemplate` محفوظان في localStorage، مع مفاتيح legacy للـPOS.
- `paperSize` محفوظ أيضاً في `PrintSettings`، لكن لا يدخل فعلياً إلى `renderDocumentHTML` ولا يغيّر القالب أو CSS.
- القوالب الحالية هي `thermal` و`standard` و`elegant`، مع renderers متخصصة للمخزون في `inventory.ts`.
- المعاينة الحالية تستخدم HTML حقيقياً داخل iframe، لكن لا تتيح Paper Profile موحداً، وتعرض خيارات قد لا تكون متوافقة مع القالب.
- مسار PDF الحالي مستقل جزئياً ويستخدم jsPDF/AutoTable في `src/lib/pdf.ts`، بينما قوالب HTML هي المصدر الفعلي للطباعة.

## B. المشكلات الحالية
1. `paperSize` إعداد محفوظ لكنه dead setting ولا يفرض أي قرار على renderer.
2. تعريف حجم الورق موزع داخل كل template (`@page` وwidth ثابتة).
3. لا يوجد resolver مركزي يرفض template/paper غير المتوافق.
4. لا يوجد Print Profile صريح يفصل الاختيار المؤقت عن الإعداد الافتراضي.
5. preview وprint يشتركان في HTML، لكن القالب يملك side effect (`body onload=window.print`) غير مناسب للمعاينة.
6. شاشة الإعدادات تعتمد dropdowns وتعرض 58mm/A5 بلا دعم حقيقي متساوٍ في كل القوالب.
7. لا توجد اختبارات registry/resolver تغطي compatibility وfallback.

## C. Architecture الجديدة
```text
Document
  -> Print Profile Resolver
       -> Template Registry
       -> Paper Profile Registry
       -> Options / locale / direction
  -> renderDocumentHTML (single renderer source)
       -> Preview: srcDoc HTML/CSS
       -> Browser Print: print iframe + window.print()
       -> PDF: legacy jsPDF path remains an explicit on-demand adapter
```

- `Template` يصف الشكل والـrenderer والـpaper profiles المدعومة.
- `PaperProfile` يصف العرض/الارتفاع والاتجاه والهوامش.
- `PrintProfile` يربط نوع المستند بالقالب والورق.
- `resolvePrintProfile` يطبّق compatibility ويعطي fallback آمن عند legacy data.
- renderer يضيف CSS خاصاً بالـPaper Profile بعد template CSS، ويزيل auto-print side effect من HTML الموحد.

## D. Migration Strategy
1. إبقاء `paperSize` في schema/localStorage وعدم حذف البيانات القديمة.
2. اعتبار `paperSize` legacy compatibility input؛ عند غياب profile صريح يُستخدم فقط لاختيار profile متوافق مع القالب.
3. إضافة registries وresolver فوق renderers الحالية بدلاً من إعادة كتابة القوالب.
4. إبقاء `renderInvoiceHTML` و`printDocument` signatures الحالية كـadapters.
5. تحديث Preview وSettings لاستخدام profiles المتوافقة فقط، مع حفظ default صراحة عبر الإعدادات.
6. إبقاء jsPDF الحالي لمسار PDF القائم إلى أن تتوفر بيئة server-side browser renderer مناسبة؛ لا تتم إضافة dependency ثقيلة في هذه المرحلة.

## نطاق المرحلة الحالية
هذه المرحلة تبني الأساس typed والمتوافق مع السلوك القائم: profiles/registry/resolver، preview/print profile-aware، وواجهة إعدادات مرئية خفيفة. لا تضيف Template Builder أو PDF server جديداً دون متطلبات تشغيل واستضافة واضحة.
