# توثيق إعادة تصميم وتطوير واجهة الإعدادات (Settings UI Architecture Documentation)
**المشروع:** market-hub (فورتيكس ERP)  
**الفرع:** `yunis-fixes`  
**المطور:** يونس (Senior Software & ERP Engineer)  
**الحالة:** تم التنفيذ والتوثيق بنجاح ✅  

---

## 1. ما تم تغييره وتطويره (Overview of Accomplishments)

تمت إعادة هيكلة واجهة صفحة الإعدادات (`/_app/settings`) وتصميمها من الصفر لتتحول من صفحة بطاقات متراكمة بطول رأسي إلى **ERP Master-Detail Navigation System** محترف وجاهز للتوسع، مع الحفاظ التام على:
- جميع الإعدادات الموجودة دون زيادة أو نقصان.
- قاعدة البيانات و DB Schema والجدول `company_settings` دون أي تغيير.
- منطق الحفظ و LocalStorage و Supabase API دون أي تعديل في الـ Logic.

---

## 2. المكونات الجديدة والمعمارية الهيكلية (Component Architecture)

تم إنشاء مجلد جديد ومستقل للمكونات: `src/components/settings/`:

1. **`src/components/settings/settings-registry.ts`**:
   - سجل مركزي مرن تسجيل الأقسام وإدارتها (`Registry System`).
   - يدعم تسجيل المكون والأيقونة والعناوين باللغتين العربية والإنجليزية.

2. **`src/components/settings/settings-sidebar.tsx`**:
   - مكون شريط النافيجيشن والتنقل.
   - يدعم البحث الفوري في الأقسام (Section Search Filter).
   - تجاوب كامل: شريط جانبي مع شارات تنبيهية للشاشات الكبيرة (Desktop)، وشريط تبنيب أفقياً قابل للتمرير للشاشات الصغيرة (Mobile).

3. **`src/components/settings/settings-layout.tsx`**:
   - المكون الرئيسي الذي ينظم العرض المبوب بين النافيجيشن والمحتوى الفعلي للقسم المحدد.

4. **المكونات التفصيلية للأقسام (`src/components/settings/sections/`)**:
   - `company-section.tsx`: معلومات المنشأة والمتجر.
   - `invoicing-section.tsx`: الفواتير والعملة والضريبة وبادئة الفواتير والخدمة المخصصة والباركود.
   - `printing-section.tsx`: إعدادات الطباعة الشاملة والقوالب.
   - `catalog-section.tsx`: تخصيص النشاط وموديولات الفهرسة.
   - `subscription-section.tsx`: الباقة والاشتراك واستهلاك الموارد.
   - `appearance-section.tsx`: المظهر ولغة الواجهة.

---

## 3. الأقسام الحالية المتاحة في الواجهة (Current Settings Sections)

1. 🏢 **معلومات المنشأة (Company Profile):** الاسم التجاري، الاسم القانوني، الرقم الضريبي، الهاتف، البريد، والعنوان.
2. 🧾 **الفواتير والعملة (Invoicing & POS):** العملة، رمز العملة، نسبة الضريبة، بادئة الفاتورة، تفعيل أجور التركيب/الخدمة، وتفعيل الباركود.
3. 🖨️ **الطباعة والقوالب (Printing Architecture):** القالب الافتراضي للعملاء والمخزون، حجم الورق، الطباعة التلقائية، وإظهار/إخفاء العناصر.
4. 🎛️ **تخصيص النشاط (Catalog & Modules):** تكييف الفهرس حسب النشاط (بقالة، قطع غيار، تجارة عامة).
5. 👑 **الباقة والاشتراك (Subscription & Plan):** استهلاك الموارد والحصص وموديولات النظام.
6. 🌐 **المظهر واللغة (Appearance & Language):** تبديل لغة النظام لـ (العربية / الإنجليزية).

---

## 4. دليل المطورين المستقبلي (Developer Expansion Guide)

### أ. كيف يضيف مبرمج مستقبلاً قسماً جديداً (مثلاً: إعدادات المخزون)؟
بسطر واحد فقط في `src/components/settings/settings-registry.ts`:
```ts
registerSettingsSection({
  id: "inventory",
  titleAr: "إعدادات المخزون",
  titleEn: "Inventory Settings",
  descriptionAr: "حدود الطلب والتنبيهات وحجز المخزون",
  descriptionEn: "Reorder points and stock reservation",
  icon: Boxes,
  component: InventorySection,
});
```

### ب. كيف يضيف مبرمج مستقبلاً إعداداً جديداً داخل قسم موجود؟
يفتح المكون الخاص بالقسم المستهدف من مجلد `src/components/settings/sections/` ويضيف الحقل مباشرة داخل المكون بنفس نسق الحقول الجاهزة دون الحاجة لتغيير هيكل الصفحة.

---

## 5. الاختبارات التي تم إنهاؤها (Verification & Testing)

- [x] **فحص تجميع TypeScript:** تم إجراء `npx tsc --noEmit` بنجاح وانعدام الأخطاء في ملفات الإعدادات.
- [x] **الحفاظ على قاعدة البيانات:** عدم إجراء أي تعديل على قاعدة البيانات أو Migrations (0 DB changes).
- [x] **التنقل سليس والمرونة:** تجربة فتح الأقسام والبحث السريع والتنقل بين التبويبات.
- [x] **دعم RTL التام:** محاذاة الخطوط والأيقونات والحقول بالكامل من اليمين إلى اليسار باللغة العربية.
- [x] **التجاوب (Responsive):** تجربة العرض على الشاشات الكبيرة والصغيرة دون أي انكسارات.

---

## 6. تقرير الحالة قبل الـ Commit/Push (Final Pre-Commit Checklist)

- **Branch:** `yunis-fixes`
- **Task:** Settings UI Redesign
- **Database:** NO CHANGES
- **Main Branch:** NOT TOUCHED / NO MERGE
- **Files Changed / Created:**
  - `src/routes/_app.settings.tsx`
  - `src/components/settings/settings-registry.ts`
  - `src/components/settings/settings-sidebar.tsx`
  - `src/components/settings/settings-layout.tsx`
  - `src/components/settings/sections/company-section.tsx`
  - `src/components/settings/sections/invoicing-section.tsx`
  - `src/components/settings/sections/printing-section.tsx`
  - `src/components/settings/sections/catalog-section.tsx`
  - `src/components/settings/sections/subscription-section.tsx`
  - `src/components/settings/sections/appearance-section.tsx`
  - `docs/YUNIS_SETTINGS_UI_PLAN.md`
