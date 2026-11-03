# Printing Remaining Issues — المسائل الثلاث المُغلقة

> التاريخ: 2026-10-05
> النطاق: ESC/POS المباشر · showBranding · توحيد Company Profile.
> هذا المستند يشرح ما تم، وما لم يتم، **ولماذا** — بلا ادّعاء دعم غير موجود.

---

## 1. الطباعة الحرارية المباشرة ESC/POS

### 1.1 ما الذي يدعمه النظام حاليًا

| القدرة | الحالة | الدليل |
| --- | --- | --- |
| توليد أوامر ESC/POS (بايتات) | ✅ **مدعوم فعليًا** | `src/lib/printing/escpos.ts` |
| تهيئة الطابعة `ESC @` | ✅ | `CMD.INIT` |
| المحاذاة (يسار/وسط/يمين) `ESC a n` | ✅ | `alignment()` |
| عريض `ESC E n` | ✅ | `CMD.BOLD_ON/OFF` |
| حجم الخط `GS ! n` (١..٨ أضعاف) | ✅ | `charSize()`, `FONT_SIZE` |
| تغذية أسطر `ESC d n` | ✅ | `CMD.FEED` |
| فواصل بنود خفيفة | ✅ | `separator()` |
| جدول محارف `ESC t n` | ✅ | `codeTable()` |
| اختيار خط الطابعة `ESC M n` | ✅ | `selectFont()` |
| قص الورق `GS V m` | ✅ | `CMD.CUT_FULL / CUT_PARTIAL` |
| نسخ متعددة | ✅ | `escposTransport.print()` |
| تحويل مستند موحد → إيصال حراري | ✅ | `thermal-escpos.ts` |
| **إرسال البايتات إلى الطابعة** | ❌ **غير متاح** | يحتاج Local Print Agent |

### 1.2 ما الذي لا يدعمه النظام — ولماذا

**لا يستطيع المتصفح إرسال ESC/POS مباشرة.** الأسباب تقنية وليست اختيارية:

1. **لا socket خام.** JavaScript في المتصفح لا يمكنه فتح TCP إلى منفذ الطابعة
   (٩١٠٠ عادةً) — لا `net` ولا `dgram` ولا `socket` في بيئة المتصفح.
2. **لا USB/Serial.** WebUSB وWebSerial موجودان نظريًا لكنهما يتطلبان:
   إذنًا صريحًا من المستخدم لكل جهاز، و`https` أو `localhost`، ودعمًا في المتصفح،
   وتعريفات مناسبة — ولا يصلحان كأساس موثوق لمنتج ERP.
3. **لا تشغيل أوامر نظام.** لا يوجد أي مسار مشروع لتشغيل `copy /b file LPT1`
   أو PowerShell من صفحة ويب. أي محاولة لذلك هي ثغرة أمنية، وليست حلًا.

**لذلك لم نستخدم أي حيلة (hack).** لا قيادة أوامر نظام، ولا `window.open` سري،
ولا طابعة وهمية، ولا ادّعاء أن "الطباعة المباشرة تعمل".

### 1.3 المعمارية الصحيحة — Transport Abstraction

```
Document → Profile → Template → Theme → Rendered Output → PrintTransport
```

```ts
interface PrintTransport {
  id: "browser" | "pdf" | "escpos";
  capabilities: PrintTransportCapabilities;
  print(job: PrintJob, context?: PrintTransportContext): Promise<PrintResult>;
}
```

| الملف | المسؤولية |
| --- | --- |
| `printing/escpos.ts` | توليد البايتات فقط — لا اتصال |
| `printing/thermal-escpos.ts` | تحويل المستند الموحد → كتل نصية — لا HTML ولا ESC/POS |
| `printing/transports.ts` | النقل + الحدود + الوكيل المحلي |
| `printing/adapters.ts` | واجهة رقيقة فوق الـ transports (تختار الإعدادات) |

**الفصل مطبَّق بدقة:** لا صفحة مبيعات ولا مخزون ولا مطحنة تعرف شيئًا عن ESC/POS.
الصفحات تستدعي `printUnifiedDocument()` فقط.

### 1.4 الـ fallback الحالي

عند اختيار "حراري" في الإعدادات:
- يُختار نقل `browser` مع ملف ورق `thermal-58` أو `thermal-80`.
- يُطبع HTML عبر `openPrintWindow` (iframe مخفي).
- **هذا ليس ESC/POS ولا نسمّيه كذلك.**

عند طلب ESC/POS صراحةً عبر `printEscPos()` بلا وكيل محلي:
- تُولَّد البايتات فعلًا (كود حقيقي).
- يُرجع `{ ok: false, reason: "agent_required", copiesSent: 0 }`.
- **لا يُطبع شيء.**
- `printWithFallback()` يسقط إلى المتصفح إن توفّر HTML، ويُبلّغ `fellBackTo: "browser"`.

### 1.5 كيف يُضاف Local Print Agent مستقبلًا

الواجهة **موجودة ومُوثّقة** في `transports.ts`:

```ts
interface LocalPrintAgent {
  isAvailable(): Promise<boolean>;
  send(bytes: Uint8Array, options?: { printerName?: string }): Promise<void>;
}
```

خطوات التنفيذ المستقبلي (بلا تعديل أي مستند أو صفحة):

1. ابنِ خدمة سطح مكتب (Windows Service / Tauri / Electron sidecar) تستمع على
   `127.0.0.1` فقط، وتقبل بايتات ESC/POS.
2. مرّرها إلى المحرك: `printEscPos(request, { agent })`.
3. لا شيء آخر. كل المستندات تعمل تلقائيًا لأن التوليد مفصول عن النقل.

**لم يُبنَ الـ agent في هذه المهمة** لأن المشروع لا يحتوي بنية سطح مكتب جاهزة،
وبناؤه بلا ضرورة يخالف نطاق العمل.

### 1.6 الاختبارات

`npm run test:transports` — **٩٣ اختبارًا**، منها:
- تسلسل البايتات حرفيًا (`ESC @`, `ESC a 1`, `ESC E 1/0`, `GS ! 0x11`, `GS V 0`).
- كل كتلة تنتهي بـ `ESC d 1`.
- عدم كذب النقل: بلا وكيل → `agent_required` + `copiesSent: 0`.
- مع وكيل مُحاكى → إرسال بايتات حقيقية بعدد النسخ.
- فشل الوكيل → `transport_error` مع الرسالة.
- السقوط إلى المتصفح + الإبلاغ عنه.
- الـ mapper يغطي **١٣ نوع مستند**.
- عدم وجود جدول قدرات مكرر (adapters تقرأ من transports).

---

## 2. showBranding — القرار: **حُذف بالكامل**

### 2.1 ما كان عليه

| الطبقة | الموضع |
| --- | --- |
| النوع | `CustomFieldOptions.showBranding` في `templates/types.ts` |
| الإعدادات | `PrintSettings.showBranding: true` في `settings-store.ts` |
| القوالب | `opts.showBranding` في `standard.ts`, `elegant.ts`, `thermal.ts`, `inventory.ts` (مرتان) |
| البيانات | `UnifiedDocumentData.brandingText` + `DEFAULT_BRANDING = ""` |
| الواجهة | توجل "التوقيع البرمجي (Inama Soft)" |

### 2.2 لماذا حُذف

1. **`DEFAULT_BRANDING` كان سلسلة فارغة** — التوجل يُظهر/يُخفي فراغًا. لا أثر.
2. **`brandingText` كان يُمرَّر دائمًا كـ `""`** من `invoice-print.ts`، فلا يُنتج شيئًا.
3. **Company Profile أصبح المصدر المركزي للهوية**: الاسم + الشعار + الفوتر + Theme.
   الإبقاء على `showBranding` كان يُنشئ **نظام Branding ثانيًا** ينافس Company Profile —
   وهذا ممنوع صراحةً في المتطلبات.
4. **خطر حقيقي**: أي إعادة تفعيل مستقبلية له كانت ستُعيد اسم صانع النظام أو رقمه
   إلى مستند مطبوع — وهو ما مُنع صراحةً.

### 2.3 ما تم حذفه

- `CustomFieldOptions.showBranding`
- `PrintSettings.showBranding` (والقيمة الافتراضية `true`)
- `UnifiedDocumentData.brandingText`
- `DEFAULT_BRANDING` (تصدير من `templates`, `invoice-print`, `pdf`)
- `opts.showBranding` وكل استخدامه في القوالب الأربعة
- أصناف CSS `.branding` من `thermal.ts` و`inventory.ts`
- توجل "التوقيع البرمجي (Inama Soft)" من واجهة الإعدادات
- `poweredBy: DEFAULT_BRANDING` → `poweredBy: ""`
- لاحقة `— ${DEFAULT_BRANDING}` من تذييل تقارير PDF

### 2.4 البديل (بلا فقدان وظيفة)

| ما كان يريده المستخدم | البديل الحالي |
| --- | --- |
| إظهار/إخفاء هوية الشركة | `showLogo` + `showCompanyInfo` + `footerEnabled` |
| نص تسويقي/شكر | `company_settings.footer_text` (Company Profile) |
| ظهور اسم الشركة | `company_settings.name` — دائمًا، من المصدر المركزي |

### 2.5 الاختبار

`npm run test:company-profile` يفحص المشروع **مصدريًا** (بعد إزالة التعليقات):
لا وجود لـ `showBranding` / `DEFAULT_BRANDING` / `brandingText` في أي ملف.
أي إعادة إدخال لها تُفشل الاختبار تلقائيًا.

---

## 3. توحيد Company Profile

### 3.1 المصدر المركزي

```
company_settings (Supabase)
        ↓
printing/company-profile.ts   ← الملف الوحيد الذي يلمس الكاش
        ↓
getCachedCompanyProfile()
        ↓
Sales · Purchases · Reports · Statements · Milling · Inventory
Printing · Preview · PDF · Thermal · ESC/POS
```

```ts
getCachedCompanyProfile(): CompanyProfile   // متزامن
loadCompanyProfile(): Promise<CompanyProfile>  // من قاعدة البيانات
cacheCompanyProfile(row): CompanyProfile    // كتابة/دمج (اسمح بأعمدة DB)
patchCompanyProfileCache(patch): CompanyProfile  // تحديث جزئي (يقبل camelCase)
clearCompanyProfileCache(): void
```

المفتاح `company_settings_cache` **يُذكر في ملف واحد فقط**.

### 3.2 ما تم توحيده

| الملف | قبل | بعد |
| --- | --- | --- |
| `lib/format.ts` | يقرأ `localStorage` بنفسه بمفتاح مكرر | `getCachedCompanyProfile()` |
| `lib/milling/print.ts` | `readCompany()` محلي + `"مطاحن"` كـ fallback | `getCachedCompanyProfile()` |
| `lib/statements/company.ts` | يقرأ `company_settings` مباشرة | ✅ مشروع (لا يلمس الكاش، يقرأ DB عبر استعلامه) |
| `routes/_app.settings.tsx` | يكتب `{currency, currency_symbol}` فقط | `cacheCompanyProfile(payload)` — الصف الكامل |
| `lib/pdf.ts` | `DEFAULT_BRANDING` في التذييل | Company Profile |

### 3.3 لماذا لا يجوز القراءة المباشرة من الكاش

1. **تعدد أشكال البيانات.** كل قارئ مباشر كان يفسّر الأعمدة بطريقته: `format.ts`
   كان يقرأ `currency_symbol`، و`milling/print.ts` كان يقرأ `legal_name` و`tax_number`.
   أي عمود جديد يُنسى في أحد الملفات → مستند يعرض بيانات ناقصة.
2. **الكاش يمكن أن يكون جزئيًا.** `setCompanySettingsCache({currency})` كان يكتب
   صفًا ناقصًا **يستبدل** الصف الكامل في `format.ts` — فتُفقد بيانات الشركة.
   (اكتُشف وأُصلح: `patchCompanyProfileCache` الآن تدمج بدل الاستبدال.)
3. **الفشل الصامت.** قارئ مباشر بلا try/catch يُسقط المستند كله عند JSON تالف.
   الـ accessor المركزي يبتلع الخطأ ويُرجع profile صالحًا.
4. **تناسق الاتجاه.** المطحنة كانت قد تعرض اسمًا قديمًا بينما الفاتورة تعرض الجديد
   لو اختلف مسار الكاش — وهذا بالضبط ما حذّر منه الطلب.

### 3.4 الاختبار

`npm run test:company-profile` — **٤٦ اختبارًا**، منها:
- **فحص مصدري**: لا ملف (غير الـ accessor) يذكر `company_settings_cache`.
- **فحص مصدري**: لا ملف في `printing/` أو `print/` أو `templates/` يستدعي
  `localStorage.getItem` (عدا مخازن الإعدادات المشروعة).
- سيناريو التغيير الكامل: اسم → رقم → بريد → عنوان → فوتر → شعار، ثم التحقق من
  ظهورها في **القالب الموحد + الرسمي + ESC/POS** فورًا.
- التأكد أن الاسم القديم **اختفى** بعد التغيير (لا كاش منفصل).
- fallback للقيم الفارغة/الفارغة تمامًا (`null`, `{}`) بلا انهيار وبلا نص `"null"`.
- التأكد أن `patch` لا يفقد الاسم أو البريد.

---

## 4. النتيجة النهائية

| المعيار | الحالة |
| --- | --- |
| لا إعدادات وهمية | ✅ `showBranding` و`DEFAULT_BRANDING` و`brandingText` محذوفة |
| لا قراءات Company Profile خارج المسار المركزي | ✅ مفروض باختبار مصدري |
| لا ادّعاء كاذب بدعم ESC/POS | ✅ النقل يُرجع `agent_required` ولا يطبع |
| لا تكرار معماري جديد | ✅ adapters فوق transports، جدول قدرات واحد |

### ملاحظة أخيرة صريحة

**ESC/POS المباشر ما زال يحتاج Local Print Agent.** ما أُنجز هو:
توليد الأوامر (حقيقي ومُختبر)، النقل (حقيقي ومُختبر مع وكيل مُحاكى)،
الحد المعماري (موثّق)، والـ fallback (المتصفح). لم يُبنَ الـ agent نفسه.
