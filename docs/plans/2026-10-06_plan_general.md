# MASTER PROMPT
# Market-Hub ERP — Full Offline-First / Online Hybrid Architecture Audit & Implementation Plan

أنت تعمل الآن داخل مشروع Market-Hub ERP كمهندس برمجيات ومعماري أنظمة Senior، ومتخصص في:

- Full-Stack Architecture
- React / TypeScript
- Supabase / PostgreSQL
- Vercel
- PWA
- Offline-First Applications
- Local Databases
- Data Synchronization
- Distributed Systems
- ERP Systems
- Accounting Systems
- Inventory Systems
- Security
- Performance
- Data Integrity
- UX/UI

============================================================
# 1. الهدف الرئيسي
============================================================

أريد منك دراسة مشروع Market-Hub بالكامل من الكود الفعلي الموجود في المستودع، ثم تصميم استراتيجية احترافية تجعل النظام قادرًا على العمل بنظام Hybrid:

ONLINE + OFFLINE

بحيث يستطيع العميل استخدام النظام على جهاز واحد حتى عند انقطاع الإنترنت لفترة طويلة، مثل:

- ساعات
- يوم
- عدة أيام
- أسبوع
- وربما فترة أطول

وعند عودة الإنترنت، يقوم النظام بمزامنة البيانات المحلية مع Supabase بطريقة آمنة وموثوقة.

المشروع حاليًا يعتمد على:

- React
- TypeScript
- Vercel
- Supabase
- PostgreSQL

ولا أريد أن يتحول جهاز العميل إلى بيئة تطوير.

العميل لا يجب أن يحتاج إلى:

- Docker
- Node.js
- PostgreSQL محلي
- Supabase محلي
- Terminal
- أدوات Developer
- تشغيل Backend يدوي
- إعدادات تقنية معقدة

الهدف هو أن يكون استخدام النظام للمستخدم النهائي بسيطًا مثل أي برنامج عادي.

============================================================
# 2. الفكرة العامة التي يجب أن تحققها
============================================================

نريد الوصول إلى Architecture شبيهة بالتالي:

ONLINE:

User
 ↓
PWA / Web App
 ↓
React
 ↓
Application Services
 ↓
Supabase
 ↓
PostgreSQL


OFFLINE:

User
 ↓
PWA / Installed App
 ↓
React
 ↓
Application Services
 ↓
Local Database
 ↓
Local Sync Queue


عند عودة الإنترنت:

Local Database
 ↓
Sync Queue
 ↓
Sync Engine
 ↓
Supabase API
 ↓
PostgreSQL
 ↓
Sync Confirmation
 ↓
Local Database


لكن لا تفترض أن هذا التصميم هو الحل النهائي.

قم بتحليل المشروع أولًا وحدد أفضل Architecture فعلية بناءً على الكود الموجود.

============================================================
# 3. قاعدة مهمة جدًا
============================================================

لا تبدأ بتعديل أي ملف.

في هذه المرحلة:

READ ONLY

قم أولًا بفهم المشروع بالكامل.

لا تنشئ:

- ملفات جديدة
- جداول جديدة
- migrations
- services
- sync engine
- local database
- PWA modifications

قبل إنهاء التحليل وتقديم التقرير.

بعد التقرير توقف وانتظر موافقتي.

============================================================
# 4. افحص المشروع بالكامل
============================================================

قم بفحص جميع الملفات المهمة في المشروع.

لا تعتمد فقط على أسماء المجلدات.

افحص فعليًا:

- package.json
- tsconfig
- Vite configuration
- Vercel configuration
- React entry points
- routing
- layouts
- components
- pages
- hooks
- contexts
- providers
- state management
- services
- utilities
- API clients
- Supabase client
- database access
- queries
- mutations
- RPC calls
- Edge Functions
- server functions
- authentication
- authorization
- RLS
- migrations
- SQL
- database schema
- storage
- forms
- validation
- error handling
- caching
- React Query إن وجد
- localStorage
- sessionStorage
- IndexedDB إن وجد
- browser cache
- reports
- dashboards
- inventory
- products
- services
- customers
- suppliers
- sales
- purchases
- invoices
- payments
- expenses
- accounting
- warehouses
- stock movements
- opening balances
- settings
- users
- roles
- permissions
- audit logs
- notifications
- search
- filters
- pagination
- exports
- imports
- printing

وابحث عن أي شيء آخر موجود فعليًا في المشروع.

============================================================
# 5. افهم Architecture الحالية
============================================================

قم ببناء خريطة Architecture كاملة.

أريد أن أعرف:

كيف يبدأ التطبيق؟

كيف ينتقل المستخدم بين الصفحات؟

كيف يتم جلب البيانات؟

كيف يتم إنشاء البيانات؟

كيف يتم تحديث البيانات؟

كيف يتم حذف البيانات؟

كيف يتم تنفيذ العمليات المالية؟

كيف تتصل الواجهة بـ Supabase؟

هل هناك Service Layer؟

هل يوجد Repository Pattern؟

هل يوجد Data Access Layer؟

هل يوجد Business Logic داخل Components؟

هل توجد عمليات مباشرة من UI إلى Supabase؟

هل توجد عمليات تعتمد على Server Functions؟

حدد كل ذلك.

============================================================
# 6. تتبع Data Flow
============================================================

لكل عملية مهمة، تتبع التدفق الكامل.

مثال:

UI
 ↓
Component
 ↓
Hook
 ↓
Service
 ↓
Supabase Client
 ↓
RPC / Table
 ↓
PostgreSQL
 ↓
Response
 ↓
State
 ↓
UI


افعل ذلك للعمليات المهمة مثل:

- إنشاء عميل
- تعديل عميل
- حذف عميل
- إنشاء منتج
- تعديل منتج
- بيع
- فاتورة بيع
- شراء
- فاتورة شراء
- دفع
- مصروف
- حركة مخزون
- تعديل مخزون
- رصيد افتتاحي
- حسابات العملاء
- حسابات الموردين
- القيود المحاسبية
- التقارير

استخدم الكود الفعلي ولا تعتمد على الافتراض.

============================================================
# 7. إنشاء Feature Matrix
============================================================

أنشئ جدولًا شاملًا لكل Feature:

| Feature | Current Flow | Offline? | Online Only? | Local Data Needed | Sync Needed | Conflict Risk | Financial Risk | Security Risk |

ثم صنف كل Feature إلى:

A = يجب أن يعمل Offline

B = يستحسن أن يعمل Offline

C = يمكن أن يعمل Offline بقيود

D = Online Preferred

E = Online Only

F = Never Offline

اشرح سبب التصنيف.

لا تجعل كل شيء Offline.

============================================================
# 8. حدد ماذا يجب أن يكون Offline
============================================================

فكر في الاستخدام الحقيقي لنظام ERP على جهاز واحد.

حدد البيانات التي يحتاج المستخدم إليها أثناء انقطاع الإنترنت.

مثلًا، قد تشمل:

- المنتجات
- العملاء
- الموردين
- الأسعار
- المخزون
- الفواتير
- المبيعات
- المشتريات
- المدفوعات
- المصروفات
- بعض التقارير

لكن لا تفترض أن هذه كلها يجب أن تكون Offline.

حدد ذلك بناءً على المشروع.

============================================================
# 9. حدد ماذا يجب أن يبقى Online
============================================================

حدد الوظائف التي يجب أن تبقى Online.

مثلًا:

- إدارة المستخدمين
- تغيير الصلاحيات
- بعض إعدادات النظام
- العمليات الأمنية
- العمليات التي تحتاج Server Authority
- بعض التقارير المركزية
- العمليات التي تعتمد على بيانات خارج الجهاز
- أي شيء لا يمكن ضمان صحته Offline

لكن استخدم الكود الحقيقي لتحديد ذلك.

============================================================
# 10. لا تستخدم Offline Cache فقط
============================================================

لا أريد حلًا سطحيًا مثل:

localStorage

أو:

cache API

فقط.

نحن نبني ERP.

يجب أن يكون هناك Local Persistence حقيقي.

ادرس الخيارات:

- IndexedDB
- Dexie
- SQLite
- PWA
- Service Worker
- Tauri
- Electron
- Browser Storage
- OPFS
- أي تقنية أخرى مناسبة

ثم اختر الأنسب.

لا تفترض مسبقًا أن SQLite هو الحل.

ولا تفترض مسبقًا أن IndexedDB هو الحل.

قارن الخيارات بناءً على:

- المشروع الحالي
- المتصفح
- PWA
- Desktop
- الأداء
- حجم البيانات
- reliability
- transactions
- migrations
- backup
- security
- maintainability
- deployment
- mobile support

============================================================
# 11. Desktop و Mobile
============================================================

نحن نريد أن يكون النظام قابلًا للاستخدام من:

- Desktop
- Laptop
- Tablet
- Mobile

حدد هل PWA وحدها كافية.

وهل يمكن:

Install to Desktop

بحيث يظهر النظام كتطبيق؟

وهل يمكن:

Install to Mobile

بحيث يعمل كتطبيق؟

حدد القيود الحقيقية.

لا تفترض أن PWA تجعل كل شيء Offline تلقائيًا.

وضح الفرق بين:

PWA
+
Local Database
+
Service Worker
+
Sync Engine

============================================================
# 12. Local Database Architecture
============================================================

صمم Local Database مناسبة للمشروع.

لا تنسخ كل PostgreSQL إلى الجهاز بشكل أعمى.

حدد:

What must be local

What should be local

What can be cached

What must remain server-side

لكل جدول حدد:

- هل يحتاج Local Copy؟
- لماذا؟
- ما الأعمدة المطلوبة؟
- هل نحتاج كل الأعمدة؟
- هل نحتاج Index؟
- هل نحتاج Foreign Keys؟
- هل نحتاج Soft Delete؟
- هل نحتاج Version؟
- هل نحتاج Sync Status؟

============================================================
# 13. Local Database Schema
============================================================

اقترح Local Schema.

قد نحتاج أشياء مثل:

products
customers
suppliers
invoices
invoice_items
payments
expenses
stock_movements
inventory
sync_queue
sync_operations
sync_conflicts
app_metadata

لكن لا تستخدم هذه القائمة كحقيقة.

استخرج الجداول الفعلية من المشروع.

لكل Local Table حدد:

Primary Key

Local ID

Server ID

Created At

Updated At

Deleted At

Version

Sync Status

Operation ID

Idempotency Key

Device ID

Dependencies

حسب الحاجة.

============================================================
# 14. ID Strategy
============================================================

هذه نقطة شديدة الأهمية.

افحص حاليًا كيف يتم إنشاء IDs.

إذا كان النظام يعتمد على:

Auto Increment IDs

حدد تأثير ذلك على Offline.

لأن الجهاز قد ينشئ سجلًا أثناء عدم وجود الإنترنت.

يجب تصميم استراتيجية مثل:

UUID

ULID

Client Generated IDs

Local IDs + Server IDs

أو غيرها.

لا تختار دون تحليل.

============================================================
# 15. Idempotency
============================================================

يجب أن تمنع تكرار العمليات.

مثال:

المستخدم ينشئ فاتورة Offline.

ثم يعود الإنترنت.

Sync يبدأ.

تم إرسال الطلب.

السيرفر نفذ العملية.

لكن الجهاز لم يستلم Response بسبب انقطاع الإنترنت.

يجب ألا يقوم Retry بإنشاء فاتورة ثانية.

لذلك صمم:

idempotency_key

أو آلية مكافئة.

حلل ذلك لكل:

- Invoice
- Payment
- Stock Movement
- Expense
- Purchase
- Journal Entry

============================================================
# 16. Sync Engine
============================================================

صمم Sync Engine حقيقي.

يجب أن يتعامل مع:

- Queue
- Retry
- Backoff
- Dependencies
- Ordering
- Batching
- Validation
- Idempotency
- Errors
- Conflicts
- Partial Failures
- Recovery

التدفق المقترح:

Local Transaction
 ↓
Local Database
 ↓
Sync Queue
 ↓
Sync Engine
 ↓
Server
 ↓
Validation
 ↓
Database
 ↓
Confirmation
 ↓
Mark Synced

وفي حالة الفشل:

Failed
 ↓
Retry
 ↓
Backoff
 ↓
Retry
 ↓
Permanent Failure

لا تجعل النظام يعيد إرسال العملية بلا حدود.

============================================================
# 17. Sync Priority
============================================================

حدد Priority للعمليات.

مثلًا:

High Priority:

- Sales
- Payments
- Inventory movements

Medium:

- Customers
- Suppliers
- Products

Low:

- Cached metadata
- Reports cache

لكن لا تفترض هذا الترتيب.

استخرجه من طبيعة المشروع.

============================================================
# 18. Dependency Ordering
============================================================

حلل العلاقات.

مثلاً:

Customer
 ↓
Invoice
 ↓
Invoice Items
 ↓
Payment

أو:

Product
 ↓
Invoice Item
 ↓
Stock Movement

إذا كانت العملية تعتمد على عملية أخرى لم تتم مزامنتها، يجب أن يعرف Sync Engine ذلك.

لا ترسل العمليات بترتيب عشوائي.

============================================================
# 19. Conflict Resolution
============================================================

حلل التعارضات.

مثال:

المنتج تغير محليًا.

وفي Server تغير أيضًا.

ماذا يحدث؟

لكن الأهم:

لا تستخدم:

Last Write Wins

على كل شيء.

خصوصًا:

- الأموال
- الفواتير
- المدفوعات
- المخزون
- القيود

حدد لكل Entity:

Conflict Detection

Conflict Type

Resolution Strategy

Server Authority

Local Authority

User Intervention

Audit Trail

============================================================
# 20. Accounting Integrity
============================================================

تعامل مع النظام كنظام ERP حقيقي.

حلل:

- Sales
- Purchases
- Payments
- Receivables
- Payables
- Expenses
- Journal Entries
- Opening Balances
- Inventory Valuation
- Cost
- Profit
- Customer Balance
- Supplier Balance

حدد ماذا يحدث Offline.

لا تسمح بتصميم يؤدي إلى:

Duplicate transaction

Wrong balance

Duplicate payment

Wrong inventory

Wrong accounting entry

Incorrect totals

Missing transaction

============================================================
# 21. Inventory Integrity
============================================================

هذه نقطة حرجة.

حلل:

- Stock
- Warehouses
- Stock movements
- Opening stock
- Purchases
- Sales
- Returns
- Adjustments
- Transfers
- Cost

إذا كان المخزون يتغير Offline، كيف سيتم التعامل مع:

Negative stock

Duplicate movement

Conflicting movement

Missing movement

Sync failure

Server validation

حدد التصميم الصحيح.

============================================================
# 22. Invoice Numbering
============================================================

افحص كيفية إنشاء:

Invoice Number

Receipt Number

Payment Number

Purchase Number

Journal Number

Stock Movement Number

إذا كانت الأرقام تأتي من PostgreSQL Sequence، فحلل المشكلة.

كيف سنحافظ على:

- uniqueness
- traceability
- ordering
- auditability

أثناء Offline؟

لا تستخدم حلًا قد يؤدي إلى Duplicate Numbers.

============================================================
# 23. Authentication
============================================================

حلل Supabase Auth الحالي.

حدد:

- Session
- Refresh Token
- Expiration
- Persistence
- Offline Login
- Token Refresh
- Logout
- Password Changes
- Role
- Permissions

ماذا يحدث إذا:

Session موجودة والجهاز Offline؟

ماذا يحدث إذا:

Session انتهت أثناء Offline؟

ماذا يحدث إذا:

المستخدم عاد Online؟

هل يسمح له بالدخول؟

هل نحتاج Offline Session Policy؟

كيف نحافظ على Security؟

============================================================
# 24. Authorization
============================================================

Offline يجب ألا يصبح وسيلة لتجاوز:

- RLS
- Roles
- Permissions
- User restrictions

إذا كان المستخدم ليس لديه صلاحية لعملية معينة، فلا يجب أن تسمح له Offline بتنفيذها لمجرد عدم وجود Server.

صمم طريقة مناسبة لذلك.

============================================================
# 25. Security
============================================================

حلل مخاطر تخزين البيانات محليًا.

خصوصًا:

- Financial Data
- Customer Data
- Supplier Data
- Auth Data
- Tokens
- Cached Data
- Local Database
- Device Theft
- Browser Storage
- XSS
- Token Theft

حدد:

ما الذي يمكن تخزينه؟

ما الذي يجب تشفيره؟

ما الذي لا يجب تخزينه؟

ولا تضع أبدًا:

SUPABASE SERVICE ROLE KEY

أو أي Secret Server-side داخل Frontend.

============================================================
# 26. PWA
============================================================

حلل إمكانية تحويل النظام إلى PWA.

حدد:

- Manifest
- Service Worker
- Installability
- Offline Shell
- Asset Caching
- API Caching
- Runtime Caching
- Cache Versioning
- Cache Invalidation
- Update Strategy

مهم:

لا تجعل Service Worker يخزن كل شيء بلا تمييز.

============================================================
# 27. Service Worker
============================================================

صمم سياسة واضحة:

ما الذي Cache First؟

ما الذي Network First؟

ما الذي Network Only؟

ما الذي Stale While Revalidate؟

وما الذي يجب ألا يتم Cache له إطلاقًا؟

============================================================
# 28. Application Updates
============================================================

افترض:

Version 1.0

المستخدم Offline أسبوعًا.

خلال ذلك أنت أصدرت:

Version 1.1

ثم:

Version 1.2

عندما يعود المستخدم Online:

كيف سيتم تحديث التطبيق؟

كيف ستتم حماية البيانات المحلية؟

كيف سيتم عمل:

Local DB Migration

بدون فقد البيانات؟

كيف نضمن compatibility؟

============================================================
# 29. Local Database Migration
============================================================

صمم:

Schema Version

Migration System

مثلاً:

v1
 ↓
v2
 ↓
v3

لا تحذف بيانات المستخدم أثناء Migration.

حدد كيفية:

- backup
- migration
- rollback
- recovery

============================================================
# 30. Long Offline Usage
============================================================

اختبر تصميمك نظريًا مع:

1. Offline لمدة يوم
2. Offline لمدة أسبوع
3. Offline لمدة شهر
4. 100 عملية Offline
5. 1,000 عملية Offline
6. 10,000 عملية Offline
7. إغلاق الجهاز أثناء Sync
8. Crash أثناء Sync
9. انقطاع الإنترنت أثناء Sync
10. تحديث التطبيق أثناء وجود بيانات Pending
11. تلف Local DB
12. حذف Browser Storage
13. Browser Restart
14. Computer Restart
15. User Logout
16. Session Expiration

اشرح ماذا سيحدث في كل حالة.

============================================================
# 31. Backup
============================================================

فكر في:

ماذا يحدث إذا تلفت Local Database؟

هل نحتاج:

Local Backup

Encrypted Backup

Server Backup

Export

Recovery

حدد استراتيجية مناسبة.

============================================================
# 32. Reports
============================================================

صنف التقارير:

Offline Reports

Online Reports

Hybrid Reports

لا تعرض Report على أنه كامل إذا كانت هناك:

Pending Sync Operations

أظهر للمستخدم عند الحاجة:

Last Synced At

Pending Operations

Sync Status

============================================================
# 33. UX
============================================================

أريد UX واضحًا ولكن غير مزعج.

مثلاً:

ONLINE
🟢 متصل

SYNCING
🟡 تتم المزامنة

OFFLINE
🔴 غير متصل

SYNC ERROR
⚠️ يوجد خطأ في المزامنة

لكن لا تظهر Error للمستخدم لمجرد عدم وجود Internet.

Offline يجب أن تكون حالة تشغيل طبيعية.

عند إنشاء عملية Offline، يمكن عرض:

"تم حفظ العملية على الجهاز وسيتم مزامنتها عند توفر الاتصال."

بدل:

"Failed"

============================================================
# 34. Performance
============================================================

حلل:

- Initial Load
- Bundle Size
- Lazy Loading
- Database Queries
- Indexes
- Pagination
- Virtualization
- Caching
- Sync Batching
- Background Sync
- Memory
- CPU
- Storage

يجب ألا يصبح Offline Mode سببًا في بطء النظام.

============================================================
# 35. Scalability
============================================================

اليوم:

Device واحد.

لكن فكر هل يمكن مستقبلًا أن يصبح:

Device 1
Device 2
Device 3

لنفس الحساب أو المتجر.

لا نريد Architecture تمنع هذا مستقبلًا.

لكن لا تبالغ في التعقيد إذا كان الجهاز واحدًا حاليًا.

صمم بطريقة:

Simple Now

Extensible Later

============================================================
# 36. Server Architecture
============================================================

حلل Vercel + Supabase.

حدد:

ما الذي يجب أن يبقى في Vercel؟

ما الذي يجب أن يبقى في Supabase؟

هل نحتاج Server-side endpoints؟

هل نحتاج RPC؟

هل نحتاج Edge Functions؟

هل Sync الأفضل أن يتم:

Directly to Supabase

أو عبر Server Layer؟

حدد بناءً على Security وBusiness Logic.

============================================================
# 37. Repository Architecture
============================================================

إذا كانت الواجهة حاليًا تتصل مباشرة بـ Supabase في أماكن كثيرة، حلل هل نحتاج:

Repository Pattern

مثل:

UI
 ↓
Use Case
 ↓
Repository
 ↓
Local Data Source
 ↓
Remote Data Source

مثلاً:

ProductRepository

CustomerRepository

InvoiceRepository

InventoryRepository

لكن لا تعيد بناء المشروع بالكامل إذا لم يكن ذلك ضروريًا.

============================================================
# 38. Data Source Abstraction
============================================================

أريد إمكانية أن تكون:

Online:

Repository
 ↓
RemoteDataSource

Offline:

Repository
 ↓
LocalDataSource

Hybrid:

Repository
 ↓
Local
+
Remote
+
Sync

بدون أن تكون UI مرتبطة مباشرة بقاعدة البيانات.

============================================================
# 39. Error Handling
============================================================

صنف الأخطاء:

Network Error

Validation Error

Authentication Error

Authorization Error

Conflict Error

Database Error

Sync Error

Permanent Error

Temporary Error

User Error

حدد هل:

Retry

Ignore

Queue

Show User

Require Online

============================================================
# 40. Observability
============================================================

صمم آلية لمعرفة:

- عدد Pending Operations
- Failed Operations
- Last Sync
- Sync Duration
- Sync Errors
- Conflicts
- Local DB Size

بدون كشف بيانات حساسة.

ويجب أن تكون هناك أدوات Debug للمطور.

============================================================
# 41. Audit
============================================================

العمليات المالية يجب أن تكون قابلة للتتبع.

حدد:

Created By

Created At

Device

Operation ID

Sync ID

Server Timestamp

Local Timestamp

وأي معلومات أخرى مهمة.

============================================================
# 42. Testing Strategy
============================================================

صمم خطة Testing تشمل:

Unit Tests

Repository Tests

Local DB Tests

Sync Tests

Integration Tests

E2E Tests

Offline Tests

Network Failure Tests

Conflict Tests

Migration Tests

Authentication Tests

Security Tests

Performance Tests

============================================================
# 43. أهم Scenarios
============================================================

يجب أن يكون التصميم قادرًا على التعامل مع السيناريوهات التالية:

SCENARIO 1:

User Online
→ creates invoice
→ sync immediately

SCENARIO 2:

User Offline
→ creates invoice
→ closes browser
→ opens next day
→ invoice still exists

SCENARIO 3:

User Offline
→ creates 100 invoices
→ Internet returns
→ all sync safely

SCENARIO 4:

Internet disappears during Sync

SCENARIO 5:

Server accepts transaction
but Client doesn't receive response

SCENARIO 6:

Retry occurs

SCENARIO 7:

Device restarts during Sync

SCENARIO 8:

App updates while pending operations exist

SCENARIO 9:

Local DB migration

SCENARIO 10:

Conflict between local and server data

============================================================
# 44. Do Not Overengineer
============================================================

لا تبني Distributed System معقد بدون سبب.

نحن حاليًا نحتاج:

Single Device

Reliable Offline

Reliable Sync

Secure Online Backend

Maintainable Code

Fast UX

Future Extensibility

إذا كان هناك حل أبسط ويحقق نفس المتطلبات، اختر الحل الأبسط.

============================================================
# 45. لا تغير Supabase بدون سبب
============================================================

Supabase هو Backend الحالي.

لا تقترح استبداله إلا إذا وجدت مشكلة Architecture حقيقية لا يمكن حلها بطريقة مناسبة.

إذا كان Supabase مناسبًا:

Keep Supabase.

============================================================
# 46. لا تنشئ Backend محليًا للمستخدم
============================================================

لا أريد أن يحتاج العميل إلى:

Docker

Node

Postgres

Redis

Backend Server

Terminal

Developer Environment

إلا إذا أثبت التحليل أن هذا ضروري جدًا.

الأولوية:

Install App

Open App

Use App

============================================================
# 47. Mobile
============================================================

حلل إمكانية تشغيل نفس Architecture على Mobile.

حدد:

PWA

Installable Web App

Storage Limits

Background Sync

Push

Offline Persistence

Browser Restrictions

ولا تفترض أن Desktop وMobile لديهما نفس القيود.

============================================================
# 48. Deployment
============================================================

التطبيق يجب أن يستمر باستخدام:

GitHub

Vercel

Supabase

مع أقل تغييرات ممكنة في Deployment.

حدد كيف سيتم:

Build

Deploy

PWA Update

Database Migration

Local Migration

Rollback

============================================================
# 49. Rollback
============================================================

إذا أصدرنا Version جديدة وحدثت مشكلة:

كيف نرجع للنسخة السابقة؟

وماذا يحدث للبيانات المحلية؟

يجب ألا يؤدي Rollback إلى فقد البيانات.

============================================================
# 50. Final Architecture
============================================================

بعد دراسة المشروع، اقترح Architecture نهائية.

يجب أن توضح:

Frontend

PWA

Local Database

Repository

Local Data Source

Remote Data Source

Sync Engine

Sync Queue

Conflict Resolver

Supabase

PostgreSQL

Authentication

Authorization

RLS

Server-side Validation

============================================================
# 51. Architecture Diagram
============================================================

أنشئ مخططات نصية واضحة.

مثال:

USER
 ↓
PWA
 ↓
React UI
 ↓
Use Cases
 ↓
Repository
 ↙          ↘
Local       Remote
DB          Supabase
 ↓             ↓
Sync Queue   PostgreSQL
      ↘       ↙
       Sync Engine


ووضح:

Online Flow

Offline Flow

Sync Flow

Conflict Flow

Authentication Flow

Update Flow

Migration Flow

============================================================
# 52. Implementation Roadmap
============================================================

بعد انتهاء التحليل، ضع خطة تنفيذ مرحلية.

مثلاً:

PHASE 0
Architecture Preparation

PHASE 1
Repository/Data Layer

PHASE 2
Local Database

PHASE 3
Offline Read

PHASE 4
Offline Writes

PHASE 5
Sync Queue

PHASE 6
Sync Engine

PHASE 7
Conflict Handling

PHASE 8
Inventory

PHASE 9
Sales

PHASE 10
Purchases

PHASE 11
Accounting

PHASE 12
Reports

PHASE 13
Authentication

PHASE 14
PWA

PHASE 15
Security

PHASE 16
Testing

PHASE 17
Production Rollout

لكن لا تستخدم هذا الترتيب بشكل أعمى.

أنشئ الترتيب بناءً على dependency graph الحقيقي للمشروع.

============================================================
# 53. Tasks
============================================================

لكل Task حدد:

Task ID

Name

Purpose

Files

Database Changes

Dependencies

Risk

Testing

Rollback

Acceptance Criteria

مثال:

TASK-001

Local Database Foundation

Files:
...

Dependencies:
...

Acceptance Criteria:
...

============================================================
# 54. Acceptance Criteria
============================================================

لا تعتبر المشروع ناجحًا إلا إذا تحقق:

1. النظام يفتح بدون Internet بعد تثبيته/تحميله سابقًا.
2. البيانات المحلية تبقى بعد Browser Restart.
3. البيانات تبقى بعد Computer Restart.
4. العمليات Offline تحفظ محليًا.
5. العمليات لا تتكرر.
6. Sync يعمل تلقائيًا.
7. Retry آمن.
8. لا تضيع البيانات.
9. لا يتم تجاوز صلاحيات المستخدم.
10. لا يتم كشف Server Secrets.
11. المخزون لا يفسد.
12. الحسابات لا تفسد.
13. الفواتير لا تتكرر.
14. المدفوعات لا تتكرر.
15. Updates لا تحذف Local Data.
16. Migration آمن.
17. التطبيق سريع.
18. UX واضح.
19. يمكن معرفة Sync Status.
20. يمكن استرجاع العمليات الفاشلة.
21. النظام يعمل حتى بعد Offline لمدة أسبوع.
22. النظام لا يحتاج Docker أو Node أو أدوات تطوير عند العميل.

============================================================
# 55. أهم الأولويات
============================================================

رتب قراراتك وفق:

1. Data Integrity
2. Financial Correctness
3. Security
4. Reliability
5. Consistency
6. Recoverability
7. Maintainability
8. Performance
9. UX
10. Implementation Convenience

لا تضحي بسلامة البيانات من أجل سهولة التنفيذ.

============================================================
# 56. ممنوع التخمين
============================================================

إذا لم تعرف شيئًا:

ابحث في الكود.

ابحث في:

- migrations
- SQL
- services
- hooks
- components
- queries
- database types
- Supabase functions
- configuration

لا تقل:

"غالبًا المشروع يعمل بهذه الطريقة."

بل تحقق من ذلك.

============================================================
# 57. لا تخفي المشاكل الحالية
============================================================

إذا وجدت مشاكل حالية مثل:

- broken queries
- wrong RLS
- missing validation
- direct database access
- duplicated business logic
- bad state management
- missing indexes
- incorrect inventory calculations
- customer insertion issues
- accounting inconsistencies
- security issues
- race conditions

قم بتسجيلها.

ولا تفترض أن Offline Architecture ستصلحها تلقائيًا.

============================================================
# 58. المطلوب في التقرير النهائي
============================================================

بعد الانتهاء من قراءة وتحليل المشروع، قدم تقريرًا احترافيًا بعنوان:

# Market-Hub ERP
# Offline-First Architecture Audit & Implementation Proposal

ويجب أن يحتوي على:

1. Executive Summary
2. Current Architecture
3. Current Data Flow
4. Database Architecture
5. Authentication Architecture
6. Authorization Architecture
7. Feature Inventory
8. Offline/Online Matrix
9. Local Database Recommendation
10. Local Schema Proposal
11. Repository Architecture
12. Sync Architecture
13. Sync Queue
14. Idempotency
15. Conflict Resolution
16. Inventory Strategy
17. Accounting Strategy
18. Invoice Strategy
19. Payment Strategy
20. Reports Strategy
21. PWA Strategy
22. Service Worker Strategy
23. Authentication Offline Strategy
24. Security Strategy
25. Backup Strategy
26. Migration Strategy
27. Update Strategy
28. Performance Strategy
29. UX Strategy
30. Testing Strategy
31. Deployment Strategy
32. Rollback Strategy
33. Risks
34. Current Problems
35. Proposed Solution
36. Implementation Roadmap
37. Task Breakdown
38. Acceptance Criteria

============================================================
# 59. الملفات
============================================================

في نهاية التقرير أعطني قائمة واضحة:

FILES TO MODIFY

FILES TO CREATE

FILES TO DELETE

FILES TO LEAVE UNCHANGED

DATABASE TABLES TO MODIFY

DATABASE TABLES TO CREATE

DATABASE MIGRATIONS REQUIRED

SUPABASE FUNCTIONS TO MODIFY

VERCEL CHANGES

PWA CHANGES

============================================================
# 60. VERY IMPORTANT
============================================================

في هذه المرحلة:

DO NOT MODIFY CODE.

DO NOT CREATE FILES.

DO NOT RUN DATABASE MIGRATIONS.

DO NOT CHANGE SUPABASE.

DO NOT CHANGE VERCEL.

DO NOT CHANGE RLS.

DO NOT DEPLOY.

DO NOT DELETE ANYTHING.

DO NOT REFACTOR THE PROJECT YET.

أريد فقط:

FULL PROJECT ANALYSIS

+
ARCHITECTURE DESIGN

+
OFFLINE/ONLINE CLASSIFICATION

+
DATABASE DESIGN

+
SYNC DESIGN

+
SECURITY ANALYSIS

+
IMPLEMENTATION PLAN

============================================================
# 61. بعد التقرير
============================================================

بعد تقديم التقرير بالكامل:

STOP.

WAIT FOR MY APPROVAL.

لا تبدأ تنفيذ أي Task حتى أوافق.

بعد أن أوافق، سننفذ Tasks واحدة واحدة.

كل Task يجب أن:

1. تكون محددة.
2. تكون صغيرة قدر الإمكان.
3. تحافظ على النظام الحالي.
4. لا تكسر الميزات الموجودة.
5. تحتوي على Tests.
6. تحتوي على Validation.
7. تحتوي على Rollback Strategy.
8. يتم اختبارها قبل الانتقال للـTask التالية.

============================================================
# FINAL INSTRUCTION
============================================================

أريد منك أن تتعامل مع هذه المهمة كأنك تبني طبقة Offline لنظام ERP حقيقي يعتمد عليه متجر أو شركة في عملياتها اليومية والمالية.

لا تبحث عن أسرع طريقة لإضافة Offline.

ابحث عن:

أكثر Architecture مناسبة للمشروع الحالي

مع:

أقل تعقيد ممكن

أعلى موثوقية ممكنة

أمان جيد

سلامة بيانات عالية

تجربة استخدام سلسة

قابلية للصيانة

وقابلية للتوسع مستقبلًا.

افهم المشروع أولًا.

حلل.

ارسم Architecture.

صنف Features.

حلل Database.

حلل Business Logic.

حلل Accounting.

حلل Inventory.

حلل Authentication.

حلل Security.

صمم Local Storage.

صمم Sync.

صمم Conflict Resolution.

صمم Migration.

صمم Update Strategy.

صمم Testing.

ثم قدم التقرير.

ولا تعدل أي كود حتى أعطيك موافقة صريحة.

ابدأ الآن بتحليل المشروع بالكامل.