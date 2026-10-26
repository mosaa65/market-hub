# مجلد سوبابيز وقواعد البيانات (Supabase & Database)

هذا المجلد يحتوي على كافة تعريفات البنية التحتية، الترحيلات (Migrations)، البذور (Seeds)، ودوال الحافة (Edge Functions) لنظام **Market Hub**.

> 💡 **الدليل الكامل والمفصل متاح في:** [`docs/DATABASE_MASTER_GUIDE.md`](../docs/DATABASE_MASTER_GUIDE.md)  
> 🚀 **لوحة التحكم السريعة بالأوامر:** شغّل `db-control.bat` من المجلد الرئيسي.

---

## محتويات المجلد:

* **`migrations/`**: ملفات الترحيل الـ 60 المرقمة، وهي مصدر الحقيقة لكل جداول وعلاقات وسياسات النظام.
* **`seeds/`**: البيانات الأولية مقسمة إلى:
  * `01_system`: بيانات النظام الإلزامية لأي عميل (وحدات، حسابات، باقات).
  * `02_company`: هوية المنشأة لكل عميل.
  * `03_samples`: بيانات تجريبية (مطحنة) للمطورين فقط.
* **`functions/`**: دوال الحافة (Edge Functions) مثل `admin-create-user`.
* **`config.toml`**: إعدادات منافذ Supabase المحلي والخدمات (Auth, Storage, PostgREST).
* **`docs/archive/`**: أرشيف التقارير وفحوصات التدقيق السابقة.

---

## الأوامر السريعة عبر `npm`:

```powershell
# 1. تشغيل السيرفر المحلي (Docker)
npm run db:local:start

# 2. فحص الروابط والمفاتيح
npm run db:local:status

# 3. تطبيق التعديلات الجديدة بأمان على قاعدة قائمة دون مسح بيانات
npm run db:local:migrate

# 4. إعادة بناء وتأسيس محلي كامل (تطوير / تجارب)
npm run db:local:rebuild

# 5. رفع التحديثات الجديدة إلى السحابة
npm run db:cloud:push
```
