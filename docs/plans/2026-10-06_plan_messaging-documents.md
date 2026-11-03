# خطة التصميم والتنفيذ المعمارية: منظومة المراسلات والمستندات وتجربة نجاح العمليات
## Market-Hub ERP — Communication & Document Sharing Architecture Plan

> **الفرع:** `feature/communication-and-document-sharing`  
> **الحالة:** جاهز للتنفيذ بعد المراجعة والاعتماد  
> **التوافق:** التزام كامل بقواعد `docs/VORTEX_AI_DEVELOPMENT_RULES (1).md` وقواعد Lovable في `AGENTS.md`.

---

## 1. الوضع الحالي بالتفصيل (Current State Analysis)

بعد فحص الكود المصدري للمشروع كاملاً، يتبيّن أن النظام الحالي يتعامل مع المراسلات ومشاركة الفواتير والتقارير عبر منطق مجزأ وموزع داخل صفحات React:

1. **نظام العملاء (`src/routes/_app.customers.tsx`):**
   - يحتوي على زر واتساب مباشر في البطاقات والجدول ودرج التفاصيل (`handleCustomerWhatsApp` و `handleCustomerSMS`).
   - النص مبني يدوياً داخل الدالة: إذا كان الرصيد موجب يرسل رسالة تذكير، وإذا كان الرصيد صفراً يرسل نصاً ثابتاً يحتوي اسماً صلباً `فورتكس ERP` (`مرحباً ${customer.name}، نتواصل معك بخصوص حسابك في فورتكس ERP`).
   - لا يتيح للمستخدم اختيار نوع المراسلة (طلب سداد، كشف حساب، فاتورة).
   - زر كشف الحساب `goStatement` معروض لجميع العملاء، حتى لو كان العميل مسجلاً حديثاً ولا يمتلك أي قيد أو حركة دفترية إطلاقاً.

2. **نظام المبيعات والفواتير (`src/routes/_app.sales.tsx`):**
   - يحتوي على دالة `shareInvoiceWhatsApp(inv: Invoice)` مكررة داخل الصفحة (سطور 277-312).
   - بناء النص يتم عبر سلسلة نصوص عربية/إنجليزية مشفرة مباشرة في الصفحة.
   - تنظيف الهاتف يتم بطريقة بدائية `(inv.customers?.phone || "").replace(/[^0-9]/g, "")`.
   - **ثغرة حرجة:** إذا لم يكن لدى العميل رقم هاتف، يتم فتح `https://wa.me/?text=...` بدون رقم مستلم، مما يربك المستخدم ويخالف متطلبات تجربة الاستخدام.

3. **شاشة نقاط البيع وشاشة إصدار الفواتير (`_app.pos.tsx` و `_app.sales-invoice.tsx`):**
   - بعد حفظ الفاتورة (أو حفظها Offline)، يكتفي النظام بـ `toast.success` بسيط.
   - لا توجد تجربة نجاح تفاعلية (Success Experience) تعرض ملخص العملية، تتيح إرسال الفاتورة عبر واتساب فوراً للعميل، وتوفر صوتاً تأكيدياً ناعماً.

4. **نظام المدفوعات والتحصيل (`_app.payments.tsx` و `_app.debts.tsx`):**
   - في `_app.payments.tsx` (سطور 180-202)، يتم إظهار `toast.success` مع زر action `إيصال واتساب` صغير يستدعي `paymentReceiptMessage`.
   - في `_app.debts.tsx`، يتم استخدام `WhatsAppButton` مع `debtReminderMessage`.
   - في `vortex-collection-sheet.tsx`، يتم بناء رسائل نصية بأسماء ثابتة `*سند قبض إلكتروني - فورتيكس ERP*`، وعند فتح واتساب يُفتح `https://wa.me/?text=...` إذا لم يوجد هاتف.

5. **نظام الموردين (`_app.suppliers.tsx`):**
   - يستخدم `WhatsAppButton` مع `supplierMessage` الثابتة في `src/lib/whatsapp-templates.ts`.

6. **نظام كشف الحساب (`_app.account-statement.tsx` و `src/lib/statements/`):**
   - يمتلك بنية احترافية قوية جداً (`src/lib/statements/`): محرك حسابي متكامل، كشف دفتر العميل (`loadCustomerStatement`)، حساب الأرصدة التراكمية، تصدير CSV (`exportToCSV` مع UTF-8 BOM)، وطباعة منسقة.
   - لكن ينقصه مشاركة الكشف عبر WhatsApp مباشرة، وخيار التصدير والمشاركة السريعة من بطاقة العميل.

7. **نظام الطباعة والمستندات (`src/lib/printing/` و `src/lib/pdf.ts`):**
   - يمتلك محرك طباعة موحد ممتاز (`src/lib/printing/engine.ts`) يدعم A4/A5، الثيمات Formal/Luxury، بيانات الشركة من `CompanyProfile` (`company_settings`).
   - ملف `src/lib/pdf.ts` يحتوي على نصوص ثابتة "طُبع بواسطة نظام فورتكس المحاسبي" ونسخة مكررة من نافذة الطباعة `openPrintWindow` بدلاً من استخدام `src/lib/print/print-window.ts`.

---

## 2. جميع نقاط إرسال الرسائل الحالية (Current Message Points)

| الملف | السطر | الوظيفة / الحدث | المشكلة الحالية |
|---|---|---|---|
| `src/routes/_app.customers.tsx` | 83-93 | `handleCustomerWhatsApp` و `handleCustomerSMS` | نص هاردكود "فورتكس ERP"، لا يوجد خيار لتحديد نوع الرسالة، إرسال تذكير دين حتى لو لم يطلب المستخدم |
| `src/routes/_app.sales.tsx` | 277-312 | `shareInvoiceWhatsApp` | نص هاردكود، فتح `wa.me/?text=` فارغ إذا لا يوجد هاتف، تنظيف هاتف غير قياسي |
| `src/routes/_app.payments.tsx` | 185-199 | توست التحصيل مع زر إيصال واتساب | معتمد على توست sonner فقط ويفوت العميل إذا أغلقه التوست سريعاً |
| `src/routes/_app.debts.tsx` | 438, 608 | `WhatsAppButton` لتذكير الديون | يعتمد على helper قديم لا يدعم الدولة الافتراضية |
| `src/routes/_app.suppliers.tsx` | 173-180 | `WhatsAppButton` للمورد | نص ثابت بدون اسم المنشأة الحقيقي |
| `src/components/vortex-ui/finance/vortex-collection-sheet.tsx` | 103-151, 201-207 | بناء نصوص السند ومشاركتها | نصوص هاردكود `*سند قبض إلكتروني - فورتيكس ERP*`، ورابط `wa.me/?text=` فارغ |
| `src/components/vortex-ui/finance/vortex-transaction-detail-sheet.tsx` | 50-65 | سند مالي ومشاركته | نص هاردكود ورابط فارغ عند غياب الهاتف |
| `src/routes/__root.tsx` | 95 | رابط دعم واتساب | رقم دعم فني ثابت (مقبول للدعم فقط) |

---

## 3. جميع القوالب الحالية (Current Templates)

1. `debtReminderMessage` في `src/lib/whatsapp-templates.ts`:
   - تذكير مستحقات (عربي/إنجليزي)، لا يحتوي على اسم المنشأة، لا يدعم المتغيرات الموسعة.
2. `paymentReceiptMessage` في `src/lib/whatsapp-templates.ts`:
   - إيصال دفعة (عربي/إنجليزي)، لا يحتوي على اسم المنشأة، طريقة السداد، أو رصيد العميل الإجمالي.
3. `supplierMessage` في `src/lib/whatsapp-templates.ts`:
   - رسالة رصيد مورد (عربي/إنجليزي).
4. قوالب داخلية في `_app.sales.tsx`:
   - فاتورة مبيعات، لا تستخدم اسم المنشأة الحقيقي.
5. قوالب داخلية في `vortex-collection-sheet.tsx`:
   - 3 قوالب مخصصة (official, reminder, short) مكررة داخل الـ component وتحتوي `فورتيكس ERP`.
6. قوالب داخلية في `vortex-transaction-detail-sheet.tsx`:
   - قالب سند حركة مالية مكرر داخل الـ component.

---

## 4. المشاكل المعمارية (Architectural Issues)

1. **انعدام طبقة مركزية موحدة للمراسلات (Communication Engine):**
   - كل شاشة تبني النص، تنظف الهاتف، وتفتح نافذة المتصفح بنفسها.
2. **تطبيع خاطئ لأرقام الهاتف (Phone Normalization Bug):**
   - ملف `src/lib/whatsapp.ts` يفترض أن أي رقم محلي هو رقم سعودي (`966` عبر regex `^05...` أو `^5...`).
   - بينما إعدادات النظام وبيانات الدول `src/lib/country-data.ts` تعتمد اليمن `YE` كدولة افتراضية (`+967`).
   - أرقام اليمن (تبدأ بـ 77، 73، 71، 70، أو أرقام أرضية) لا تعالج بشكل صحيح في helper الواتساب.
3. **عدم التحقق من حالة العميل قبل عرض الخيارات (Blind UI Actions):**
   - يظهر زر "كشف حساب" لعميل مسجل جديد ليس له أي حركة مالية في `customer_ledger`.
   - يظهر زر واتساب برابط مفتوح حتى لو لم يكن لديه هاتف، أو يرسل رسالة دين لعميل رصيده صفر.
4. **تسمية البرنامج الصلبة (Hardcoded Branding):**
   - استخدام "فورتكس ERP" و "VORTEX ERP" بدلاً من قراءة اسم المنشأة من `CompanyProfile` / `company_settings`.
5. **خلط لغة الواجهة بلغة الرسالة (UI Language vs Message Language):**
   - الرسالة تُبنى بلغة الواجهة الحالية فقط للمستخدم، دون وجود مرونة لتحديد لغة الرسالة للعميل أو الاعتماد على لغة المراسلات الافتراضية للمنشأة.
6. **اعتبار فتح رابط الواتساب كأنه إرسال مؤكد (Conflation of Link Open with Delivery):**
   - مجرد فتح `wa.me` لا يعني أن الرسالة أُرسلت. يجب توضيح الحالة المعمارية (Prepared / Dispatched / Opened).
7. **غياب تجربة نجاح العمليات (Missing Operations Success UX):**
   - بعد التحصيل أو إصدار الفاتورة، لا توجد شاشة نجاح متطورة (✓ متحركة + صوت تأكيد ناعم + إجراء مراسلة مقترح فوري).

---

## 5. أماكن تكرار المنطق (Logic Duplication)

- **تنظيف الهاتف:** مكرر في 6 ملفات مختلفة بصيغ regex متباينة (`\D`, `[^\d+]`, `[^0-9]`).
- **بناء رابط الواتساب:** مكرر في 5 ملفات مع فتح `https://wa.me/?text=...` عند غياب الهاتف.
- **نصوص إيصال القبض وسند السداد:** مكررة بين `whatsapp-templates.ts` و `vortex-collection-sheet.tsx` و `vortex-transaction-detail-sheet.tsx`.
- **نوافذ الطباعة:** دالة `openPrintWindow` مكتوبة مرتين: في `src/lib/print/print-window.ts` و `src/lib/pdf.ts`.

---

## 6. أماكن توليد PDF/Excel الحالية

- **كشوف الحسابات:**
  * PDF/HTML Print: `src/lib/statements/print.ts` عبر `buildStatementHtml` و `printStatementDocument`.
  * CSV/Excel: `src/lib/statements/export.ts` عبر `exportStatementToCsv` و `exportStatementToHtmlTable`.
- **الفواتير والمبيعات:**
  * HTML / Print: `src/lib/printing/engine.ts` عبر `renderUnifiedDocument` و `printUnifiedDocument`، بالإضافة إلى `src/lib/invoice-print.ts`.
  * PDF Generator: `src/lib/pdf.ts` (jsPDF / autoTable للتقارير، وطباعة الفواتير كـ HTML جاهز للطباعة).
- **التقارير المالية:**
  * `src/lib/excel-export.ts`: تصدير CSV عام مع دعم العربية و UTF-8 BOM وتنسيق الأرقام القياسي.
  * `src/lib/reports/`: تقارير المبيعات والأرباح والمخزون.

---

## 7. العمليات التي تحتاج Confirmation/Success UX

العمليات المالية والتجارية الحساسة التي ترتبط بالعميل ومخرجاتها قابلة للمشاركة:
1. **تحصيل دفعة مالية (Payment Collection):**
   - من شاشة العملاء (F3 / Quick Pay).
   - من شاشة الديون (Quick Collect).
   - من شاشة المبيعات (Quick Collect).
   - من شاشة المدفوعات (`_app.payments.tsx`).
   - الإجراء المقترح: "إرسال إيصال التحصيل عبر واتساب" مع تفاصيل الدفعة والرصيد المتبقي.
2. **إصدار فاتورة بيع (Sales Invoice Creation):**
   - من شاشة الفواتير (`_app.sales-invoice.tsx`).
   - من شاشة نقاط البيع (`_app.pos.tsx`).
   - الإجراء المقترح: "إرسال الفاتورة عبر واتساب" أو "طباعة / معاينة المستند".
3. **توليد ومشاركة كشف الحساب (Statement Sharing):**
   - من بطاقة العميل أو شاشة كشوف الحسابات.
   - الإجراء المقترح: خيارات تصدير PDF / Excel ومشاركة الملخص عبر واتساب.

---

## 8. التصميم المقترح (Proposed Unified Architecture)

```text
Business Operation (Sale / Payment / Statement)
                ↓
       Mutation / DB Success
                ↓
     Operation Success Experience
   (✓ Animation + Short Web Audio Chime)
                ↓
        Unified Context Builder
   (Customer, Company Profile, Invoice, Payment, Statement)
                ↓
    Available Customer Actions Layer
    (getAvailableCustomerActions - Rules: Balance, Ledger, Phone)
                ↓
        Communication Engine
        ┌───────┴───────┐
        ↓               ↓
   Message Engine   Document Sharing
   (Templates +     (PDF / XLSX / CSV
    Vars + I18n)     + Web Share API)
        └───────┬───────┘
                ↓
    Preview / Action Dispatcher
        ┌───────┴───────┐
        ↓               ↓
   WhatsApp (wa.me)  Native File Share / Download
```

### المكونات البرمجية الأساسية:

1. **محرك الهواتف القياسي (`src/lib/communication/phone.ts`):**
   - تطبيع الأرقام وفق رمز الدولة الافتراضي للمنشأة (`company_settings` أو `country-data.ts` لليمن `+967`).
   - دعم الأرقام المحلية (05..., 5..., 77..., 73..., 71...), والأرقام الدولية (+..., 00...).
   - التحقق الصارم من صحة الرقم: عدم فتح رابط الواتساب إذا لم يكن الرقم صالحاً.

2. **طبقة فحص صلاحية الإجراءات (`src/lib/communication/action-resolver.ts`):**
   - دالة `getAvailableCustomerActions(context: CustomerActionContext)`:
     * `payment_request`: مفعل **فقط** إذا كان رصيد العميل > 0 ويوجد هاتف صالح.
     * `debt_reminder`: مفعل **فقط** إذا كان رصيد العميل > 0 ويوجد هاتف صالح.
     * `statement`: مفعل **فقط** إذا كان العميل يمتلك حركة فعلية (حركات دفترية في `customer_ledger` أو فواتير مسجلة).
     * `invoice_share`: مفعل إذا كانت هناك فاتورة مختارة.
     * يعيد كائنات `ActionDescriptor` تحمل `{ key, label, enabled, disabledReason, icon }`.

3. **محرك القوالب المركزي (`src/lib/communication/template-engine.ts`):**
   - دعم القوالب: `invoice.created`, `payment.receipt`, `payment.request`, `debt.reminder`, `customer.statement`, `supplier.notice`.
   - استبدال المتغيرات: `{{customer.name}}`, `{{company.name}}`, `{{company.phone}}`, `{{invoice.number}}`, `{{invoice.total}}`, `{{payment.amount}}`, `{{statement.period}}`, `{{statement.balance}}`.
   - قراءة بيانات المنشأة الحقيقية من `CompanyProfile` المعتمد في `src/lib/printing/company-profile.ts`.
   - فصل لغة الرسالة (عربي / إنجليزي) عن لغة واجهة النظام، مع إمكانية تمرير لغة العميل المفضلة.

4. **خدمة مشاركة المستندات وتوليدها (`src/lib/communication/document-share.ts`):**
   - توليد وتنزيل الفواتير وكشوف الحساب كـ PDF و Excel (CSV مع BOM).
   - استخدام `navigator.share` (Web Share API مع Files) عند دعم المتصفح لها (على الهواتف المحمولة)، مما يتيح إرفاق ملف الـ PDF/Excel مباشرة في واتساب.
   - وجود fallback واضح (تنزيل الملف ثم فتح محادثة الواتساب بالنص الملخص).
   - توثيق دقيق لحالة الإرسال: لا يتم اعتبار فتح رابط الواتساب `sent` بل `opened`.

5. **نظام تجربة النجاح الموحد (`src/components/communication/operation-success-modal.tsx`):**
   - نافذة مودال نظيفة وسريعة مبنية فوق `src/components/ui/modal.tsx` المشترك.
   - حركة ✓ ناعمة وحديثة ومبهجة.
   - صوت تأكيد ناعم وقصير جداً (~120ms) مولد عبر Web Audio API بدون أي ملفات خارجية ثقيلة، آمن ومتوافق ولا يتكرر عند إعادة الـ render.
   - زر إغلاق فوري يعمل بنقرة واحدة على Desktop و Mobile بدون تعليق أو تسريب للـ scroll.
   - أزرار الإجراءات المقترحة للمراسلة متصلة مباشرة بالـ Communication Engine.

6. **مكونات واجهة المراسلة المشتركة (`src/components/communication/`):**
   - `CustomerActionDropdown`: قائمة منسدلة ديناميكية في صفحة العملاء لا تعرض إلا ما ينطبق على العميل.
   - `WhatsAppShareButton`: زر ذكي يعرض تنبيهاً واضحاً وحالة معطلة عندما لا يمتلك العميل رقماً، بدلاً من فتح رابط خالي.

---

## 9. الملفات التي سيتم تعديلها (Files to Modify)

1. `src/lib/whatsapp.ts`:
   - إعادة كتابة دالة التطبيع لترتبط بنظام الدولة الافتراضية الموحد وعدم فرض `966`، مع الحفاظ على التوافق الرجعي للتوابع المصدرة.
2. `src/lib/whatsapp-templates.ts`:
   - تحويله لاستخدام قوالب المحرك المركزي مع الحفاظ على توقيع الدوال القديمة للرجعية.
3. `src/components/whatsapp-button.tsx`:
   - تحديثه لاستخدام فحص الهاتف الجديد، ودعم التلميحات المحسنة والتصميم الحديث.
4. `src/routes/_app.customers.tsx`:
   - استبدال زر الواتساب الأحادي بزر إجراءات المراسلة الذكي المستند إلى `getAvailableCustomerActions`.
   - فحص وجود حركة دفترية قبل تفعيل زر كشف الحساب.
   - ربط عمليات التحصيل بنظام Success Experience.
5. `src/routes/_app.sales.tsx`:
   - استبدال `shareInvoiceWhatsApp` المحلية بالمحرك المركزي.
   - إضافة التحذير وحالة التعطيل عند غياب رقم هاتف العميل.
   - دعم نافذة مشاركة الفاتورة الكاملة (واتساب / PDF / Excel).
6. `src/routes/_app.sales-invoice.tsx`:
   - ربط حفظ الفاتورة بنظام `OperationSuccessModal` لإتاحة خيار إرسال الفاتورة للعميل والطباعة السريعة.
7. `src/routes/_app.pos.tsx`:
   - ربط إتمام عملية البيع بـ `OperationSuccessModal` عند الحاجة.
8. `src/routes/_app.payments.tsx`:
   - استبدال التوست المحدود بـ `OperationSuccessModal` عند تسجيل الدفعة مع زر إرسال الإيصال.
9. `src/components/vortex-ui/finance/vortex-collection-sheet.tsx`:
   - ربط قوالب السند ومشاركة الواتساب بـ Communication Engine والتخلص من النصوص الثابتة.
10. `src/components/vortex-ui/finance/vortex-transaction-detail-sheet.tsx`:
    - ربط المشاركة بمحرك المراسلات وإزالة فتح `wa.me/?text=` بدون رقم.
11. `src/routes/_app.account-statement.tsx`:
    - إضافة زر مشاركة ملخص الكشف عبر الواتساب وخيارات التصدير المباشرة.

---

## 10. الملفات الجديدة المقترحة (Proposed New Files)

1. `src/lib/communication/types.ts`:
   - الأنواع والواجهات (BusinessEvent, Context, ActionDescriptor, Channel, Template, DeliveryStatus).
2. `src/lib/communication/phone.ts`:
   - نظام تنظيف وتطبيع الهواتف الموحد ودعم الأرقام المحلية والدولية واليمن الافتراضي.
3. `src/lib/communication/context-builder.ts`:
   - بناء الـ Context الموحد من سجلات العملاء والمنشأة والفواتير والسندات.
4. `src/lib/communication/action-resolver.ts`:
   - منطق تحديد الإجراءات المتاحة لكل عميل بناءً على الرصيد، الحركات، الهاتف، والفواتير.
5. `src/lib/communication/template-engine.ts`:
   - محرك القوالب المركزي والمتغيرات ودعم اللغات.
6. `src/lib/communication/document-share.ts`:
   - خدمة تجهيز ومشاركة المستندات (PDF / XLSX / Web Share API).
7. `src/lib/communication/audio.ts`:
   - مولد صوت التأكيد النظيف عبر Web Audio API (بدون أصول صوتية خارجية، خفيف، متوافق، آمن).
8. `src/lib/communication/index.ts`:
   - نقطة الدخول المصدرة لكافة وحدات المراسلات والمستندات.
9. `src/components/communication/customer-communication-menu.tsx`:
   - قائمة خيارات التواصل الذكية لشاشة العملاء.
10. `src/components/communication/operation-success-modal.tsx`:
    - مودال النجاح الموحد للعمليات (تحصيل، فواتير، إلخ) مع الصوت والأنيميشن والإجراءات.
11. `src/components/communication/document-share-dialog.tsx`:
    - نافذة مشاركة المستند (معاينة، PDF، Excel، واتساب مع التوجيه السليم).
12. `src/lib/communication/__tests__/communication-engine.test.ts`:
    - اختبارات شاملة لتطبيع الهواتف، القوالب، محدد الصلاحيات، والتأكد من خلوه من أي ريجريشن.

---

## 11. قاعدة البيانات المطلوبة إن وجدت (Database Changes)

- **لا يتطلب هذا التطوير أي تعديل على قاعدة البيانات (Zero DB Migrations):**
  * بيانات المنشأة موجودة بالفعل في جدول `company_settings` ويتم استهلاكها عبر `CompanyProfile`.
  * بيانات العملاء موجودة في جدول `customers` (بما فيها `balance`, `phone`, `name`, `credit_limit`).
  * الحركات المالية موجودة في جدول `customer_ledger` وتكفي لتحديد ما إذا كان العميل يمتلك حركة مالية فعلية أم لا.
  * الفواتير والدفعات موجودة في `sales_invoices` و `customer_payments`.
  * هذا يتوافق بدقة مع تعليمات المستخدم وقواعد `VORTEX_AI_DEVELOPMENT_RULES (1).md` لعدم العبث بـ schema بدون حاجة قاطعة.

---

## 12. مراحل التنفيذ (Implementation Phases)

### المرحلة 1: النواة المركزية للمراسلات (Core Communication Engine)
- إنشاء مجلد `src/lib/communication/` وكتابة الأنواع والـ phone normalization و context builder ومحرك القوالب و action-resolver.
- كتابة اختبارات وحدة شاملة والتأكد من تغطية جميع حالات أرقام اليمن والأرقام الدولية وقواعد السماح بالإجراءات.

### المرحلة 2: محرك مشاركة المستندات ومولد الصوت (Document Share & Audio Service)
- تنفيذ `src/lib/communication/document-share.ts` لدمج PDF/CSV ومشاركة Web Share API.
- تنفيذ `src/lib/communication/audio.ts` عبر Web Audio API مع التحقق من معايير المتصفح.

### المرحلة 3: مكونات تجربة النجاح والواجهة (Success UX & UI Components)
- بناء `OperationSuccessModal` مع أيقونة التحقق المتحركة وزر الإغلاق السريع الموثوق.
- بناء `CustomerCommunicationMenu` و `DocumentShareDialog`.

### المرحلة 4: ربط وتحديث شاشات العملاء والديون والموردين (Customer & Debts Integration)
- تحديث `_app.customers.tsx`: استبدال أزرار الواتساب العشوائية بالقائمة الديناميكية، إخفاء كشف الحساب لمن ليس له حركة، وإظهار طلب السداد لمن عليه دين فقط.
- تحديث `_app.debts.tsx` و `_app.suppliers.tsx` لاستخدام المحرك المركزي.

### المرحلة 5: ربط وتحديث شاشات المبيعات والتحصيل (Sales & Payments Integration)
- تحديث `_app.sales.tsx`: حظر إرسال واتساب لعميل بلا هاتف مع إظهار التنبيه المناسب، ربط مشاركة الفواتير بنافذة المشاركة الموحدة.
- تحديث `_app.sales-invoice.tsx` و `_app.pos.tsx`: تفعيل `OperationSuccessModal` بعد إصدار الفاتورة بنجاح.
- تحديث `_app.payments.tsx` و `vortex-collection-sheet.tsx`: تفعيل `OperationSuccessModal` بعد نجاح التحصيل.

### المرحلة 6: التوافقية الرجعية، الفحوصات والتحقق الشامل (Compatibility, Audit & Validation)
- ربط الدوال القديمة في `whatsapp.ts` بالمحرك الجديد لتفادي كسر أي شاشة أخرى.
- تشغيل اختبارات الوحدة، `npx tsc --noEmit`، و `npm run lint`.
- فحص يدوي للحالات المذكورة في متطلبات المستخدم.
- كتابة التقرير النهائي للتنفيذ في نهاية هذا الملف.

---

## 13. مخاطر التغيير والحد منها (Risks & Mitigations)

1. **خطر كسر وظائف تعتمد على `whatsapp.ts` القديم:**
   - *الحل:* الإبقاء على نفس الدوال المصدرة (`openWhatsApp`, `buildWhatsAppLink`, `normalizeWhatsAppPhone`) وتوجيه منطقها داخلياً إلى `src/lib/communication/phone.ts`.
2. **خطر تعليق المودال أو منع التفاعل عند الإغلاق السريع:**
   - *الحل:* استخدام `src/components/ui/modal.tsx` الذي يعالج `inert` و scroll lock بشكل قياسي، والتأكد من تنظيف أي مؤقتات فور إغلاق المودال.
3. **خطر تشغيل الصوت بشكل عشوائي أو تكراره في كل render:**
   - *الحل:* ربط تشغيل الصوت بـ `useEffect` يعتمد على معرف العملية الفريد (`operationId`)، مع فحص وجود تفاعل من المستخدم وتقديم خيار كتم الصوت.
4. **خطر حظر النوافذ المنبثقة (Popup Blocker) عند فتح الواتساب:**
   - *الحل:* فتح رابط الواتساب كاستجابة مباشرة لنقرة المستخدم (`onClick`) دائماً، وعدم فتحه تلقائياً داخل مؤقتات أو وعود متأخرة.

---

## 14. خطة الاختبار (Testing Plan)

1. **اختبارات تطبيع الهواتف (Phone Normalization):**
   - رقم يمني محلي: `771234567` → `967771234567`
   - رقم يمني مع صفر: `0771234567` → `967771234567`
   - رقم دولي: `+966501234567` → `966501234567`
   - رقم مع رموز: `+967-77 123 4567` → `967771234567`
   - رقم غير صالح: `abc`, `123` → يعيد `null`.
2. **اختبارات قواعد إجراءات العملاء (Action Resolver):**
   - عميل عليه دين وله هاتف → `payment_request: enabled`, `debt_reminder: enabled`.
   - عميل رصيده صفر → `payment_request: disabled`, `debt_reminder: disabled`.
   - عميل جديد بدون أي سجلات في الدفتر → `statement: disabled`.
   - عميل لديه حركات دفترية → `statement: enabled`.
   - عميل بدون رقم هاتف → إجراءات الواتساب معطلة مع سبب واضح.
3. **اختبارات محرك القوالب (Template Engine):**
   - استبدال اسم المنشأة الحقيقي من `CompanyProfile` بدلاً من اسم ثابت.
   - التحقق من تنسيق الأرقام والعملة والتاريخ.
4. **اختبارات الفحص التقني (Build & Typecheck):**
   - `npx tsx src/lib/communication/__tests__/communication-engine.test.ts`
   - `npm run test:statements`
   - `npm run test:unified-printing`
   - `npx tsc --noEmit`

---

## 15. خطة الحفاظ على الأداء وعدم إحداث Regressions

1. **التحميل الكسول (Lazy Generation):**
   - لا يتم توليد ملفات PDF أو استدعاء دوال الحسابات الثقيلة لكشف الحساب إلا عندما ينقر المستخدم على خيار المستند أو الكشف.
2. **التخزين المؤقت وحجم الاستعلامات (No N+1 Queries):**
   - عند فحص حركات العميل لكشف الحساب، يتم الاستعلام بحد أقصى `limit(1)` على جدول `customer_ledger` فقط لمعرفة ما إذا كانت لديه حركة، دون جلب كافة الحركات إلى الذاكرة في شاشات الجداول.
3. **الحفاظ على Realtime و State Integrity:**
   - الحفاظ على كاش TanStack Query والتحديث التفاؤلي أو إبطال الكاش (`queryClient.invalidateQueries`) بعد نجاح العمليات لضمان ظهور الرصيد الجديد فوراً.
4. **تنظيف الموارد:**
   - إغلاق أي سياق صوتي غير نشط، وتنظيف الـ Object URLs الناتجة عن ملفات Blob فور إغلاق نافذة المشاركة لمنع أي تسريب ذاكرة (Memory Leaks).

---

## Implementation Report

> **التاريخ:** 2026-10-05 · **الفرع:** `feature/communication-and-document-sharing`
> **الالتزام:** قواعد `docs/VORTEX_AI_DEVELOPMENT_RULES (1).md`

### Implemented (ما تم تنفيذه في هذه الجلسة)

| # | الملف / المكوّن | التغيير المنفّذ |
|---|---|---|
| 1 | `src/routes/_app.pos.tsx` | ربط `OperationSuccessModal` بإتمام عملية البيع: حالة `saleSuccess` تحمل بيانات الفاتورة والعميل، وتُعرض نافذة النجاح (✓ متحركة + صوت تأكيد + زر إرسال الفاتورة عبر واتساب) بعد كل بيع مؤكد لعميل مسجّل. |
| 2 | `src/routes/_app.account-statement.tsx` | إضافة زر **«مشاركة الكشف»** في شريط الأدوات + ربط `DocumentShareDialog` (ملخص واتساب / طباعة PDF / تصدير Excel) عبر `statementToContext` من المحرك المركزي، مع تعطيل الزر لحساب الصندوق وحظر المشاركة عند عدم وجود حركات في الفترة. |
| 3 | `src/lib/whatsapp-templates.ts` | (مُنجز مسبقاً في commit النواة) القوالب الثلاثة مرتبطة بـ `template-engine` المركزي وتقرأ اسم المنشأة الحقيقي من `CompanyProfile` — تحقّقت من ذلك وأكّدته. |
| 4 | `src/routes/_app.debts.tsx` | زر تذكير واتساب يعمل عبر `WhatsAppButton` الموحّد: يتعطّل تلقائياً عند غياب رقم صالح، والقوالب مرتبطة بالمحرك المركزي (اسم المنشأة الفعلي). |
| 5 | `src/routes/_app.suppliers.tsx` | رسالة المورد تُبنى عبر المحرك المركزي (`supplier_notice`) بسم المنشأة الحقيقي بدل النص الثابت. |
| 6 | `package.json` | إضافة `tsx` إلى `devDependencies` (كان مفقوداً رغم اعتماد كل سكربتات الاختبار عليه) + سكربت `test:communication`. |

### Preserved (ما تم الحفاظ عليه ولم يتغيّر)

- التوافق الرجعي الكامل لـ `src/lib/whatsapp.ts` (`openWhatsApp` / `buildWhatsAppLink` / `normalizeWhatsAppPhone`) — كل التوقيعات السابقة كما هي.
- تواقيع دوال `whatsapp-templates.ts` الثلاثة دون أي كسر.
- سلوك `WhatsAppButton` الحالي في الديون والموردين (تعطيل + تلميح عند رقم غير صالح).
- منطق Statement Engine — لا منطق حسابي أُضيف داخل الشاشات.
- نافذة الطباعة ما بعد البيع في POS وتدفق الطباعة/القالب كما هو.
- **Zero DB Migrations** — لم يُمس أي schema أو جدول أو صلاحية.

### Not Changed (خارج نطاق المهمة — لم تُلمس)

- `poweredBy: "Vortex ERP"` في قوالب الطباعة الداخلية لـ `_app.pos.tsx` (أسطر 1281، 2489) — مخالفة موثّقة لبند "تسمية البرنامج الصلبة" لكنها في مسار الطباعة لا المراسلة، وتعديلها خارج نطاق هذه الجلسة.
- تكرار بناء قالب الفاتورة داخل `_app.sales-invoice.tsx` و`_app.pos.tsx` بدل توحيده في `template-engine`.
- أخطاء `prettier/prettier` (CRLF) الموجودة مسبقاً في كامل المشروع (5,890 خطأ قبل تعديلاتي — مُثبت بـ `git stash`).
- تحذيرات `prefer-const` الخمسة في `_app.pos.tsx` (أسطر 535-539) — سابقة لعملي.
- لم يُستخدم `whatsapp-share-button.tsx` في أي شاشة بعد (المكوّن متاح للمرحلة القادمة).

### Conflicts

- **لا تعارضات.** لم تُجرَ أي عملية `merge` أو `rebase`، ولم يُحذف أي ملف أو ميزة.
- **قرار مطلوب من المطور (اختياري):** توحيد قالب الفاتورة الداخلي في POS والفواتير مع `template-engine`، وتحديث `poweredBy` ليُقرأ من `CompanyProfile` بدل النص الثابت — كلاهما خارج النطاق الحالي.

### Validation (الفحوص التي نُفّذت ونتائجها)

| الفحص | الأمر | النتيجة |
|---|---|---|
| اختبارات محرك المراسلات | `npm run test:communication` | ✅ **13/13 نجحت · 0 فشل** |
| اختبارات محرك الكشوفات | `npm run test:statements` | ✅ **81/81 نجحت** |
| اختبارات الطباعة الموحّدة | `npm run test:unified-printing` | ✅ **81 نجحت** |
| اختبارات ملف المنشأة | `npm run test:company-profile` | ✅ **46 نجحت** |
| فحص الأنواع | `npx tsc --noEmit` | ✅ **نظيف — 0 أخطاء** |
| ESLint على الملفين المُعدّلين | `eslint _app.pos.tsx _app.account-statement.tsx` | ✅ **0 خطأ في تعديلاتي** (5 أخطاء `prefer-const` سابقة) |

**الإجمالي:** 221 اختبار ناجح، 0 فشل، 0 أخطاء أنواع.
