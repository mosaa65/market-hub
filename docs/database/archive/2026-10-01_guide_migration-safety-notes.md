# ملاحظات أمان ترحيلات قاعدة البيانات وحماية البيانات (Database Migration & Safety Notes)

> **المشروع:** Market Hub (Vortex ERP)  
> **حالة قاعدة البيانات:** لا يتم إجراء أي حذف أو تعديل أو تفريغ لجداول أو سجلات الشركة الحقيقية (Strictly Zero Data Loss).

---

## 1. الحالة والجاهزية الفنية

تم إعداد ملفات الترحيل الإضافية لتكون **تراكمية وآمنة تماماً (Additive & Idempotent)**:

- التطبيق يعمل بسلاسة بوجودها أو بدونها، حيث تتولى وحدة الأمان `src/lib/safety.ts` اكتشاف وجود الدوال أو الرجوع التلقائي للاستعلامات المباشرة.
- **لم يتم حذف أو تعديل أي سجلات حقيقية في قاعدة البيانات نهائياً.**

---

## 2. تصحيح خطأ بناء جملة سابق في الترحيلات

أثناء محاولة تشغيل `npx supabase db push`، ظهر الخطأ التالي:

```text
syntax error at or near "USING" (SQLSTATE 42601)
```

### السبب الجذري:

في الترحيل `20260917200000_link_superadmin_user_and_permissions.sql`، تم إنشاء سياسة إدخال `INSERT` باستخدام جملة `USING`:

```sql
CREATE POLICY tenant_subscriptions_insert ON public.tenant_subscriptions
  FOR INSERT TO authenticated
  USING (public.is_platform_admin(auth.uid()))   -- غير صالح لعمليات INSERT في PostgreSQL
  WITH CHECK (public.is_platform_admin(auth.uid()));
```

في PostgreSQL، تقبل سياسات `INSERT` فقط جملة `WITH CHECK`، بينما تطبق `USING` على `SELECT` و `UPDATE` و `DELETE`. وجود هذا الخطأ كان يحجب تنفيذ أي ترحيل تالٍ.

**الحل المطبق:** إزالة جملة `USING` غير الصالحة والإبقاء على `WITH CHECK` لضمان تحقق الهدف الأمني الأصلي ("فقط مسؤولو المنصة يمكنهم إضافة اشتراكات") دون التأثير على أي جدول أو سياسة أخرى.

---

## 3. محتويات الترحيل الإضافي الآمن (`20260918000000_referential_safety_and_product_search.sql`)

| الكائن البرمجي                       | نوعه          | هل يؤثر على البيانات المخزنة؟                                |
| :----------------------------------- | :------------ | :----------------------------------------------------------- |
| `product_reference_counts(uuid)`     | دالة جديدة    | لا — استعلام قراءة فقط `SELECT` لحساب مراجع الصنف قبل الحذف. |
| `product_delete_guard(uuid)`         | دالة جديدة    | لا — تمنع حذف الصنف إذا كان مرتبطاً بحركات مخزنية أو فواتير. |
| `warehouse_reference_counts(uuid)`   | دالة جديدة    | لا — استعلام قراءة فقط `SELECT`.                             |
| `search_products(...)`               | دالة جديدة    | لا — استعلام قراءة وبحث فوري في المنتجات من جانب الخادم.     |
| 9 فهارس `CREATE INDEX IF NOT EXISTS` | فهارس تسريع   | لا — بناء هياكل بحث وتسريع الاستعلامات دون تعديل أي صف.      |
| 4 أذونات `GRANT EXECUTE`             | صلاحيات تنفيذ | لا.                                                          |

---

## 4. ما لم يتم لمسه مطلقاً (Explicitly NOT Touched)

- لا تغيير في مخطط أي جدول حالي، ولا حذف لأي جدول أو عمود أو إعادة تسميته.
- لا تعديل على علاقات المفاتيح الأجنبية (Foreign Keys).
- لا مساس بسياسات أمان الصفوف (RLS Policies).
- لم يتم تشغيل أي أمر `seed` أو `reset` أو `truncate` أو `drop` أو حذف جماعي.
- ملفات SQL التجريبية (`docs/seed/yemen_grocery_seed.sql`, `docs/seed/yemen_stationery_seed.sql`) لم يتم تشغيلها مطلقاً.

---

## 5. ملاحظة هندسية لمرحلة قادمة: الحذف التعاقبي (Cascade Deletion)

يحتوي مخطط قاعدة البيانات الحالي على قيود:

```sql
inventory.product_id REFERENCES products(id) ON DELETE CASCADE
stock_movements.product_id REFERENCES products(id) ON DELETE CASCADE
```

يقوم حارس الحذف في الواجهة (`product_delete_guard` و `src/lib/safety.ts`) بمنع حذف أي صنف له حركات مخزنية أو فواتير، مما يسد الثغرة البرمجية عبر التطبيق.  
ولكن لتحقيق الأمان المؤسسي التام داخل قاعدة البيانات نفسها، يوصى مستقبلاً بتحويل القيد من `ON DELETE CASCADE` إلى `ON DELETE RESTRICT` ضمن مهمة منفصلة ومعتمدة لمنع الحذف العرضي في حال تنفيذ أوامر SQL يدوية مباشرة.
