# TODO - تحديث قاعدة بيانات اليمني ستاشنري

- [ ] فهم كامل لجميع ENUMs وقيمها المطلوبة من `yemen_stationery_seed.sql` (payment_method, invoice_status, movement_type, app_role/ user_roles, loyalty kind/ reference types إن وجدت)
- [ ] إضافة migration جديدة في `supabase/migrations/` تقوم بـ:
  - [ ] تعديل ENUMs لتشمل القيم الموجودة في seed
  - [ ] (لا يتم TRUNCATE حسب طلبك الحالي؛ التركيز على enums فقط)
- [ ] تشغيل migrations على Supabase
- [ ] تنفيذ seed yemen_stationery_seed.sql بعد نجاح migrations
- [ ] عمل فحوصات بسيطة: عدد الصفوف في الجداول الأساسية و sample select
- [ ] حل أي errors متوقعة (قيم enum/foreign keys/unique/constraints) عند تشغيل seed

