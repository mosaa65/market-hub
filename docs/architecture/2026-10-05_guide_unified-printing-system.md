# Unified Printing System — منصة الطباعة الموحدة

> المرجع المعماري الكامل لطبقة الطباعة. اقرأ هذا قبل إضافة أي قالب أو نوع مستند.

---

## 1. المبدأ

كل مستند في النظام يمرّ عبر **مسار واحد**:

\`\`\`
بيانات المستند
   ↓
Mapper  (تحويل بيانات فقط — لا HTML)
   ↓
Document Type  +  PrintTheme  +  Paper Profile
   ↓
Unified Layout  (HTML واحد لكل المستندات)
   ↓
Print Adapter  (browser / pdf / thermal)
   ↓
openPrintWindow  (iframe مخفي)
\`\`\`

لا يوجد قالب HTML كامل لكل نوع مستند. الاختلاف بين المستندات هو **البيانات**
و**نوع المستند**، والاختلاف بين الأنماط هو **Theme** فقط.

---

## 2. الطبقات

### 2.1 السجل المركزي للمسارات — \`src/lib/navigation/\`

| الملف | المسؤولية |
| --- | --- |
| \`route-registry.ts\` | \`ROUTE_REGISTRY\`: مصدر الحقيقة لكل الواجهات (id, path, titleAr/En, descriptionAr/En, keywords, category, moduleId, requiredRoles, visibleInSearch). وأيضًا \`getSidebarSections\` |
| \`route-search.ts\` | \`searchRoutes(query, isAr, filters)\` — تطبيع عربي + مرادفات + ترتيب بالنقاط |
| \`route-icons.ts\` | \`routeIcon(id)\` و\`routeCategoryLabel\` |

**المستهلكون:** \`app-shell.tsx\` (Sidebar) · \`vortex-header-omnisearch.tsx\` (Omnisearch) · \`command-palette.tsx\` (Command Palette).

**قواعد الظهور (تُطبَّق في \`getVisibleRoutes\`):**
1. \`visibleInSearch === false\` → مخفي دائمًا.
2. \`isVisibleByMillingMode(path)\` → يخفي واجهات المطحنة عند تعطيل الوضع.
3. \`isModuleEnabled(moduleId)\` → يخفي عند تعطيل الوحدة.
4. \`canAccessRoute(path, roles)\` → يخفي عند عدم الصلاحية.

لا تظهر واجهة غير قابلة للوصول فعليًا، ولا تختفي واجهة متاحة.

### 2.2 الإعدادات — \`src/lib/printing/settings.ts\`

\`\`\`ts
interface UnifiedPrintSettings {
  behavior: "default" | "ask" | "direct" | "off";
  method: "browser" | "pdf" | "thermal";
  preview: boolean;
  copies: number;              // 1..20
  paperId: "a4" | "a5" | "thermal-80" | "thermal-58";
  orientation: "portrait" | "landscape";
  theme: "standard" | "luxury" | "formal";
  footerEnabled: boolean;
  overrides: Partial<Record<PrintingDocumentType, DocumentPrintOverride>>;
}
\`\`\`

المفتاح: \`vortex_print_settings_v2\`. الترحيل من v1 يتم في \`normalizePrintSettings\`
(\`printMode\` → \`behavior\`، \`paperSize\` → \`paperId\`).

### 2.3 المحرك — \`src/lib/printing/engine.ts\`

\`\`\`ts
renderUnifiedDocument(request): string   // HTML جاهز للطباعة أو المعاينة
printUnifiedDocument(request): void      // يختار الـ adapter ويطبع
shouldPreview(settings): boolean
\`\`\`

أولوية الاختيار لكل حقل: \`request\` ← \`settings.overrides[docType]\` ← \`settings\` العام.

### 2.4 الـ Adapters — \`src/lib/printing/adapters.ts\`

\`\`\`ts
interface PrintAdapter {
  id: "browser" | "pdf" | "thermal";
  nameAr: string; nameEn: string;
  capabilities: {
    supportsCopies: boolean;
    supportsPreview: boolean;
    supportsPaperProfiles: boolean;
    supportsDirectOutput: boolean;
  };
  print(request, html, copies): Promise<void> | void;
}
\`\`\`

| Adapter | نسخ | معاينة | ملفات ورق | إخراج مباشر |
| --- | --- | --- | --- | --- |
| \`browser\` | ✅ | ✅ | ✅ | ❌ (مربّع حوار المتصفح) |
| \`pdf\` | ❌ (نسخة واحدة) | ✅ | ✅ | ❌ (يُطلب «حفظ كـ PDF») |
| \`thermal\` | ✅ | ✅ | ✅ | ❌ |

> **حدّ صريح:** الطباعة الحرارية المباشرة (ESC/POS عبر USB أو الشبكة) **غير
> مدعومة**. \`thermal\` يمرّر المستند عبر المتصفح مع ملف الورق الحراري (58/80 ملم).
> هذا حدّ معماري موثّق، وليس ادّعاءً بدعم مباشر. التكامل المستقبلي (QZ Tray أو
> Desktop Wrapper) يُضاف كـ adapter رابع دون تعديل أي صفحة.

### 2.5 القالب الموحد — \`src/lib/templates/unified-layout.ts\`

HTML واحد فيه: Header (شعار + اسم الشركة + جهات الاتصال) · شريط العنوان والرقم
والتاريخ · 3 بطاقات معلومات · جدول البنود · الملاحظات والمبلغ كتابةً · الإجماليات ·
التوقيعات · الفوتر الموحد.

**الاختلاف بين الأنماط ألوان وحدود فقط** — عبر \`PRINT_THEMES\`:

| Theme | اللون | الاستخدام |
| --- | --- | --- |
| \`standard\` | أزرق \`#1d4ed8\` | افتراضي |
| \`luxury\` | ذهبي \`#9a6b16\` | بديل \`elegant\` القديم |
| \`formal\` | أسود \`#111827\` | مؤسسي رسمي |

\`standard.ts\` و\`elegant.ts\` واجهتان رفيعتان (~30 سطرًا) تستدعيان نفس الدالة.

### 2.6 المappers

الـ mapper مسؤول عن **تحويل البيانات فقط** — لا HTML ولا CSS. الأنواع موجودة في
\`src/lib/printing/document-types.ts\` (13 نوعًا):

\`customer_invoice\` · \`purchase_invoice\` · \`sales_return\` · \`purchase_return\` ·
\`payment_receipt\` · \`customer_statement\` · \`supplier_statement\` ·
\`stock_transfer\` · \`inventory_document\` · \`report\` · \`mill_document\` ·
\`daily_ticket\` · \`audit_record\`

### 2.7 Company Profile — \`src/lib/printing/company-profile.ts\`

المصدر الوحيد لبيانات الشركة في كل المستندات:

\`\`\`ts
getCachedCompanyProfile()   // متزامن — من كاش localStorage
loadCompanyProfile()        // غير متزامن — من company_settings
cacheCompanyProfile(row)    // يحدّث الكاش
\`\`\`

الحقول: \`name\`, \`arabicName\`, \`englishName\`, \`legalName\`, \`phone\`, \`contacts\`,
\`address\`, \`email\`, \`taxNumber\`, \`logoUrl\`, \`footerText\`, \`footerContact\`, \`currency\`.

**Fallback المعتمد:** \`784795104 · 772217218\` عند غياب \`footer_contact\`.

### 2.8 الفوتر الموحد — \`src/lib/printing/footer.ts\`

\`\`\`ts
renderUniversalFooter(company, rtl, compact?) => string
UNIVERSAL_FOOTER_CSS
\`\`\`

يُستخدم في: القالب الموحد · القالب الرسمي · المطحنة · الكشوفات · التقارير ·
PDF · المعاينة. يحترم RTL/LTR، و\`break-inside: avoid\` حتى لا يُقطع بين الصفحات،
ولا يغطي المحتوى (يُدفع بـ \`margin-top: auto\` داخل \`flex column\`).

---

## 3. المعاينة الموحدة — \`components/universal-print-preview.tsx\`

- تعرض **نفس HTML** الذي سيذهب للطباعة (\`renderUnifiedDocument\`).
- لا تجلب البيانات مرة أخرى — تستهلك \`PrintRequest\` (document snapshot).
- تحترم: Company Profile · Template · Theme · Paper · Orientation · Copies ·
  Footer · RTL/LTR.
- أزرار موحدة: **معاينة · طباعة · تحميل PDF · مشاركة · إلغاء**.

---

## 4. إضافة نوع مستند جديد

1. أضف النوع إلى \`PrintingDocumentType\` و\`DOCUMENT_TYPES\` في \`document-types.ts\`.
2. املأ \`UnifiedDocumentData\` من بياناتك (هذا هو الـ mapper).
3. استدعِ \`printUnifiedDocument({ doc, documentType, rtl })\`.
4. لا تكتب HTML — القالب الموحد يتولّى ذلك.
5. أضف اختبارًا في \`src/lib/__tests__/unified-printing.test.ts\`.

## 5. إضافة طريقة طباعة جديدة

1. أضف القيمة إلى \`PrintMethod\` في \`settings.ts\`.
2. سجّل \`PrintAdapter\` جديدًا في \`ADAPTERS\` داخل \`engine.ts\`.
3. أضف التسمية في \`PRINTING_LABELS\`.
لا تُعدّل أي صفحة تطبع مستندًا — الصفحات لا تعرف الـ adapter.
