# الدليل الصارم لتطبيق مكونات منظومة Vortex UI في نظام Market Hub ERP

> **تنبيه وإلزام لكافة المطورين وأنظمة الذكاء الاصطناعي (AI Agents):**  
> هذا المستند يمثل المرجع المعياري الإلزامي والموحد لبناء وتحديث صفحات النظام، وتطبيق الجداول، والبحث والفهرسة السريعة، والفلترة، والفرز، والمودالات (Dialogs/Drawers)، وحقول الإدخال. يمنع منعاً باتاً كسر هذه القواعد أو كتابة ستايلات عشوائية خارج المنظومة.

---

## 1. المعمارية ثلاثية الطبقات (Layer Architecture)

```
Layer 0: Tokens       → src/styles.css · src/design/tokens.ts
Layer 1: Primitives   → src/components/ui/* · src/components/vortex-ui/*
Layer 2: Patterns     → TableToolbar, FormGrid, FormField, FormSection
Layer 3: Pages        → src/routes/_app.*.tsx (منطق البيانات والترجمة فقط)
```

**القاعدة الذهبية:**  
الصفحات (`src/routes/_app.*.tsx`) يجب ألا تحتوي على فئات Tailwind مخصصة ومعقدة للعناصر الأساسية. إذا احتجت تصميماً جديداً، يُضاف إلى المنظومة الموحدة (`vortex-ui` أو `ui`) ويُستخدم في كل مكان.

---

## 2. منظومة الجداول وعرض البيانات (`DataTable` & `TableToolbar`)

### أ. القواعد الإلزامية لتثبيت الهيدر والبحث (Sticky Header & Toolbar)
1. **ممنوع منعاً باتاً استخدام `overflow-hidden`** على أي حاوية أب تضم جدول بيانات (`panel-elevated`). استخدام `overflow-hidden` يكسر `position: sticky` في المتصفح ويمنع تثبيت رأس الجدول وشريط الأدوات عند التمرير.
2. الحاوية الصحيحة للجدول هي:
   ```tsx
   <div className="panel-elevated -mx-1 sm:mx-0">
     <DataTable ... />
   </div>
   ```

### ب. التجاوب وتفادي الفراغات الوهمية والتمرير المفرط
1. عند استخدام خاصية الإخفاء التجاوبي للأعمدة (`hideBelow: "sm"` أو `"md"` أو `"lg"`):
   - يجب ألا يُعطى الجدول `minWidth` ثابت وضخم (مثل 900px) في الشاشات الصغيرة؛ لأن إخفاء الأعمدة يقلص المحتوى إلى 450px بينما يجبر الجدول على 900px مما يخلق فراغاً هائلاً في اليسار يسمح للأزرار بالتمرير لمنتصف الشاشة!
   - اجعل `minWidth` متجاوباً حسب نقطة التوقف:
     ```tsx
     minWidth={
       breakpoint === "xs" ? 440 :
       breakpoint === "sm" ? 560 :
       breakpoint === "md" ? 720 : 900
     }
     ```

---

## 3. محرك الفهرسة والبحث الشامل (Fuzzy Search & Indexing)

### أ. كيفية بناء فهرس البحث لأي جدول
البحث يجب ألا يقتصر على حقل الاسم فقط، بل يجب أن يبحث في كافة الحقول المعرفة للسجل (الاسم العربي، الإنجليزي، الكود/SKU، الباركود، التصنيف، المورد/العميل، الموقع، الهاتف، إلخ):

```tsx
import { fuzzySearch, buildSearchIndex } from "@/design/fuzzy";

// 1. بناء الفهرس داخل useMemo لضمان الأداء العالي (O(1) lookups)
const searchIndex = useMemo(() => {
  return buildSearchIndex(items, (item) => [
    item.name,
    item.name_ar,
    item.sku,
    item.barcode,
    item.category?.name,
    item.category?.name_ar,
    item.shelf_location,
    item.phone,
    item.code,
  ]);
}, [items]);

// 2. تطبيق البحث اللحظي مع الفلاتر
const filtered = useMemo(() => {
  let list = items;
  if (query.trim()) {
    list = fuzzySearch(list, query, searchIndex);
  }
  list = applyFilters(list, filters, filterDefinitions);
  return list;
}, [items, query, searchIndex, filters]);
```

---

## 4. الفلترة الموحدة والفرز (Filters & Sorting)

كل صفحة جدول في النظام يجب أن تتضمن خيارات فلترة وفرز مخصصة في `TableToolbar`:

### أ. تعريف الفلاتر (`FilterDefinition`)
```tsx
const itemFilterDefinitions: FilterDefinition[] = [
  {
    key: "category_id",
    label: lang === "ar" ? "التصنيف" : "Category",
    type: "select",
    options: categories.map((c) => ({
      value: c.id,
      label: lang === "ar" ? c.name_ar || c.name : c.name || c.name_ar,
    })),
  },
  {
    key: "status",
    label: lang === "ar" ? "الحالة" : "Status",
    type: "select",
    options: [
      { value: "active", label: lang === "ar" ? "نشط" : "Active" },
      { value: "inactive", label: lang === "ar" ? "معطل" : "Inactive" },
    ],
  },
  {
    key: "date_range",
    label: lang === "ar" ? "تاريخ الإنشاء" : "Created Date",
    type: "date-range",
  },
];
```

### ب. خيارات الفرز (`SortOption`)
```tsx
const itemSortOptions: SortOption[] = [
  { value: "name", label: lang === "ar" ? "الاسم" : "Name" },
  { value: "created_at", label: lang === "ar" ? "الأحدث" : "Newest" },
  { value: "price", label: lang === "ar" ? "السعر" : "Price" },
];
```

### ج. ربط شريط الأدوات بالجدول
```tsx
toolbar={
  <TableToolbar
    search={{
      value: query,
      onValueChange: setQuery,
      placeholder: lang === "ar" ? "بحث بالاسم، الكود، التصنيف..." : "Search...",
      resultCount: totalCount ?? filtered.length,
    }}
    filters={{
      definitions: itemFilterDefinitions,
      values: filters,
      onValueChange: setFilters,
    }}
    sort={{
      options: itemSortOptions,
      value: sort?.key ?? "",
      onValueChange: (v) => setSort(v ? { key: v, direction: sort?.direction ?? "asc" } : null),
      label: lang === "ar" ? "ترتيب" : "Sort",
    }}
    action={
      <ToolbarAction
        label={lang === "ar" ? "إضافة جديد" : "Add New"}
        icon={<Plus />}
        tone="primary"
        onClick={openNew}
      />
    }
  />
}
```

---

## 5. نماذج الإدخال والمودالات المتكيفة (`VortexDrawerDialog` & Inputs)

### أ. قاعدة المودال المتكيف:
- في شاشات سطح المكتب واللابتوب: يظهر كـ Centered Dialog متناسق.
- في شاشات الجوال: يتحول تلقائياً إلى Bottom Sheet مع مقبض سحب ناعم وإغلاق بالسحب.
- الفوتر وأزرار الإلغاء والحفظ تكون **دوماً في صف واحد أفقي متجاور** (`flex-row items-center justify-end gap-3`).

### ب. قواعد الأرقام والعملات:
- العملات والمبالغ: استخدم `VortexCurrencyInput` مع رمز العملة (`﷼`).
- الأرقام والكميات: استخدم `VortexNumberInput`.
- النصوص والبحث: استخدم `VortexTextInput` مع تفعيل خاصية المسح `clearable` والاتجاه التلقائي `dir="rtl"` أو `dir="ltr"`.

---

## 6. قائمة التحقق الإلزامية قبل تسليم أي شاشة (Migration Checklist)

- [ ] تم استخدام `VortexDrawerDialog` للنماذج مع فوتر بأزرار متجاورة أفقياً.
- [ ] تم استخدام حقول `vortex-ui` الموحدة (`VortexTextInput`, `VortexCurrencyInput`, إلخ).
- [ ] تم التحقق من تثبيت رأس الجدول وشريط الأدوات (Sticky) وعدم وجود `overflow-hidden` على الحاوية.
- [ ] تم تضمين البحث الشامل مع بناء الفهرس `buildSearchIndex` عبر كافة الحقول.
- [ ] تم إضافة الفلاتر المناسبة للبيانات (الحالة، التصنيف، النطاق الزمني).
- [ ] تم ضبط التجاوب للأعمدة وحساب `minWidth` المناسب لمنع الفراغ في جهة اليسار.
- [ ] لم يتم المساس ببيانات الإنتاج أو تطبيق أي هجرات عشوائية على قاعدة البيانات.
