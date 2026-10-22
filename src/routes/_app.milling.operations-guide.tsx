/**
 * /milling/operations-guide — دليل عمليات وتشغيل المطحنة الشامل.
 *
 * مرجع تشغيلي تفصيلي ومكتمل يشرح بدقة كيف يعمل نظام المطحنة المبسط حالياً:
 *   1. استقبال وفواتير الطحن (استلام أمانة + فاتورة رسمية + دفع في معاملة واحدة).
 *   2. إدخال نواتج الطحن والتسليم والطباعة والواتساب من نفس المستند.
 *   3. قمح المطحنة التجاري والتصنيع الذكي.
 *   4. المستهلكات وصرفها التشغيلي.
 *   5. كشف الأمانات والرقابة وتنبيه الفاقد المكتشف.
 *   6. القواعد الذهبية والأسئلة الشائعة.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Cog,
  PackageMinus,
  Receipt,
  Scale,
  Wheat,
  Printer,
  Share2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  HelpCircle,
  Clock,
  Sparkles,
  ExternalLink,
  ChevronDown,
  Layers,
  Banknote,
  Truck,
  RotateCcw,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";

export const Route = createFileRoute("/_app/milling/operations-guide")({
  head: () => ({ meta: [{ title: "دليل عمليات المطحنة الشامل — فورتكس ERP" }] }),
  component: MillingOperationsGuidePage,
});

export function MillingOperationsGuidePage() {
  const [activeTab, setActiveTab] = useState<
    "counter" | "own_grain" | "supplies" | "statement" | "faq"
  >("counter");

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="دليل عمليات وتشغيل المطحنة"
          subtitle="شرح تفصيلي شامل لكيفية عمل نظام المطحنة خطوة بخطوة — لمالك المطحنة وعمال الكاونتر وصالة الطحن."
        />

        {/* لافتة القاعدة الذهبية الحاكمة */}
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-amber-500/20 p-2.5 text-amber-600 dark:text-amber-400 shrink-0">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">
                  القاعدة الحاكمة: اسأل نفسك دائماً «الحبوب هذه لمن؟»
                </h2>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  إذا كانت الحبوب <strong className="text-foreground">ملك العميل</strong>: المسار هو{" "}
                  <strong className="text-amber-600 dark:text-amber-400">
                    استقبال وفواتير الطحن
                  </strong>{" "}
                  (أمانة عينية + فاتورة خدمة، صفر أثر على مخزون المطحنة).
                  <br />
                  إذا كانت الحبوب <strong className="text-foreground">ملك المطحنة</strong>: المسار
                  هو{" "}
                  <strong className="text-sky-600 dark:text-sky-400">
                    مشتريات ← تصنيع ذكي ← مبيعات
                  </strong>{" "}
                  (بضاعة تجارية تؤثر في المخزون والتكلفة والأرباح).
                </p>
              </div>
            </div>
            <Link
              to="/milling/intake"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-amber-600"
            >
              <Scale className="h-4 w-4" /> فتح استقبال وفواتير الطحن
            </Link>
          </div>
        </div>

        {/* شريط التنقل بين أبواب الدليل */}
        <div className="flex flex-wrap gap-2 border-b border-border/80 pb-3">
          {[
            { id: "counter", label: "1. استقبال وفواتير الطحن (خدمة العميل)", icon: Scale },
            { id: "own_grain", label: "2. قمح المطحنة والتصنيع الذكي", icon: Cog },
            { id: "supplies", label: "3. المستهلكات (أكياس وخيط وزيت)", icon: PackageMinus },
            { id: "statement", label: "4. كشف الأمانات والرقابة المالية", icon: Receipt },
            { id: "faq", label: "5. الأسئلة الشائعة والمواقف الميدانية", icon: HelpCircle },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
                  isActive
                    ? "bg-amber-500 text-white shadow-xs"
                    : "border border-border/70 bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ─── الباب 1: استقبال وفواتير الطحن ─── */}
        {activeTab === "counter" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400">
                <Scale className="h-5 w-5" />
                <h3 className="text-base font-bold text-foreground">
                  استقبال وفواتير الطحن (/milling/intake)
                </h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                هذه هي <strong>الواجهة الوحيدة</strong> التي يتعامل معها عامل المطحنة عند تقديم خدمة
                طحن للزبائن. تم إلغاء الشاشات المتفرقة والربط اليدوي المعقد؛ الآن تتم كل الخدمة
                (الاستلام، الفوترة، الدفع، الطحن، والتسليم) تحت رقم مستند واحد وفاتورة رسمية واحدة.
              </p>

              {/* المراحل الثلاث للخدمة */}
              <div className="grid gap-4 md:grid-cols-3 pt-2">
                {/* المرحلة 1 */}
                <div className="rounded-xl border border-border/80 bg-surface-2/40 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-500/20 text-xs font-black text-amber-600">
                      1
                    </span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                      لحظة الوصول
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-foreground">الاستلام والفوترة الفورية</h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    1. اختر العميل (أو اضغط <strong>«+ جديد»</strong> لإضافته فوراً دون مغادرة
                    الشاشة).
                    <br />
                    2. اختر صنف الحبوب (مثلاً: قمح بلدي) واكتب عدد الأكياس.
                    <br />
                    3. يحسب النظام الوزن تلقائياً (الأكياس × سعة العبوة الرسمية 25/50 كجم) مع
                    إمكانية التعديل يدوياً.
                    <br />
                    4. حدد سعر الخدمة وطريقة الدفع (نقداً / شبكة / آجل / مجزأ) والمبلغ المدفوع.
                    <br />
                    5. اضغط <strong>«تسجيل الاستلام وإصدار فاتورة الأجور»</strong>.
                  </p>
                  <div className="rounded-lg bg-emerald-500/10 p-2 text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">
                    ✓ النتيجة: إنشاء مستند طحن + تسجيل أمانة عينية + إصدار فاتورة مبيعات رسمية برقم
                    حقيقي في ثانية واحدة!
                  </div>
                </div>

                {/* المرحلة 2 */}
                <div className="rounded-xl border border-border/80 bg-surface-2/40 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-500/20 text-xs font-black text-amber-600">
                      2
                    </span>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                      بعد الطحن
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-foreground">تسجيل نواتج الطحن</h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    1. يظهر المستند المفتوح فوراً أسفل الكاونتر (أو تفتحه من تبويب «المستندات
                    المفتوحة»).
                    <br />
                    2. في قسم <strong>«2. عملية الطحن»</strong>، تظهر الحبوب المستلمة ورصيدها
                    المتبقي للطحن.
                    <br />
                    3. أدخل كمية الحبوب المطحونة، ثم أضف أسطر النواتج (مثال: دقيق أبيض 18 كيس 450
                    كجم، نخالة 2 كيس 45 كجم).
                    <br />
                    4. اضغط <strong>«تسجيل نواتج الطحن»</strong>.
                  </p>
                  <div className="rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                    ✓ النتيجة: نقص الحبوب وزيادة النواتج في أمانات العميل تحت نفس رقم المستند.
                  </div>
                </div>

                {/* المرحلة 3 */}
                <div className="rounded-xl border border-border/80 bg-surface-2/40 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-500/20 text-xs font-black text-amber-600">
                      3
                    </span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                      عند التسليم
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-foreground">تسليم النواتج للعميل</h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    1. في قسم <strong>«3. تسليم النواتج»</strong>، يظهر جدول النواتج الجاهزة ورصيدها
                    المتبقي.
                    <br />
                    2. أدخل الكمية التي يستلمها العميل الآن (يمكن التسليم كلياً أو جزئياً).
                    <br />
                    3. النظام يرفض آلياً تسليم أكثر مما هو مسجل للعميل.
                    <br />
                    4. اضغط <strong>«تسجيل تسليم للعميل»</strong>.
                  </p>
                  <div className="rounded-lg bg-blue-500/10 p-2 text-[11px] text-blue-700 dark:text-blue-300 font-semibold">
                    ✓ النتيجة: إخراج النواتج المسلمة من رصيد العميل وطباعة سند التسليم النهائي.
                  </div>
                </div>
              </div>

              {/* أدوات الطباعة والواتساب */}
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-2">
                <h4 className="text-xs font-bold text-foreground flex items-center gap-2">
                  <Printer className="h-4 w-4 text-primary" /> الطباعة الموحدة ومشاركة الواتساب
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  في أعلى بطاقة المستند يوجد زران سريعان:
                  <br />- <strong>طباعة المستند:</strong> يفتح المعاينة الذكية (يدعم طابعات الفواتير
                  الحرارية 80mm وطابعات الورق A4/A5). تتحدث محتويات المستند تلقائياً حسب مرحلته
                  (فاتورة استلام ← فاتورة محدثة بنواتج الطحن ← سند تسليم أمانة).
                  <br />- <strong>واتساب ومشاركة:</strong> يفتح رسالة مجهزة باسم العميل، رقم
                  المستند، رقم الفاتورة، والمبلغ المتبقي مع رابط الفاتورة لمشاركتها مباشرة على
                  واتساب بنقرة واحدة.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── الباب 2: قمح المطحنة والتصنيع الذكي ─── */}
        {activeTab === "own_grain" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5 text-sky-600 dark:text-sky-400">
                <Cog className="h-5 w-5" />
                <h3 className="text-base font-bold text-foreground">
                  قمح المطحنة التجاري والتصنيع الذكي
                </h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                هذا المسار مخصص عندما تشتري المطحنة قمحاً لحسابها الخاص بهدف طحنه وبيعه للمستهلكين
                أو المتاجر. هنا الحبوب والدقيق ملك للمطحنة بالكامل وتدخل في تقييم المخزون وتكلفة
                المبيعات وحساب الأرباح والخسائر.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-surface-2/40 p-4">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-xs font-bold text-sky-600">
                    أ
                  </span>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">شراء القمح وتوريده للمخزن</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      يتم عبر شاشة المشتريات العامة أو نقطة الشراء السريعة (
                      <Link to="/purchases" className="text-primary underline">
                        /purchases
                      </Link>
                      ). يدخل القمح مخزون الشركة بتكلفة الشراء الحقيقية ويُسجل كأصل من أصول المخزون.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-surface-2/40 p-4">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-xs font-bold text-sky-600">
                    ب
                  </span>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">
                      عملية «التصنيع الذكي» (
                      <Link to="/milling/manufacture" className="text-primary underline">
                        /milling/manufacture
                      </Link>
                      )
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      عند تشغيل الماكينة لطحن قمح الشركة:
                      <br />
                      1. حدد المخزن وصنف القمح الخام وكمية القمح المطحون (بالكيلوجرام).
                      <br />
                      2. أضف النواتج المستخرجة (مثال: دقيق ممتاز + نخالة).
                      <br />
                      3. يقوم النظام تلقائياً بخصم كمية القمح من المخزون، وإدخال النواتج بتكلفة
                      محسوبة آلياً بنسبة أسعار بيعها (Relative Sales Value). الناتج الأخير يستقبل
                      فارق التقريب تلقائياً لضمان تطابق إجمالي التكلفة بنسبة 100%.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-surface-2/40 p-4">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-xs font-bold text-sky-600">
                    ج
                  </span>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground">بيع الدقيق والمنتجات</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      يتم بيع الدقيق والنخالة كأي منتجات تجارية عبر نقطة البيع POS أو فواتير
                      المبيعات. عند البيع يتم خصم المخزون واحتساب تكلفة البضاعة المباعة (COGS) بدقة
                      بناءً على تكلفة التصنيع الذكي المحسوبة سابقاً.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── الباب 3: المستهلكات ─── */}
        {activeTab === "supplies" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5 text-violet-600 dark:text-violet-400">
                <PackageMinus className="h-5 w-5" />
                <h3 className="text-base font-bold text-foreground">
                  المستهلكات التشغيلية (أكياس، خيط، زيت المطحنة)
                </h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                تحتاج المطحنة يومياً إلى مستهلكات في صالة الطحن (أكياس فارغة للتعبئة، بكرات خيط
                خياطة، زيوت تشحيم، فلاتر). تتم إدارة هذه المواد لضمان عدم ضياعها أو سرقتها دون إرباك
                الحسابات.
              </p>

              <div className="grid gap-4 sm:grid-cols-2 pt-2">
                <div className="rounded-xl border border-border/80 bg-surface-2/40 p-4 space-y-2">
                  <h4 className="text-xs font-bold text-foreground">1. شراء وتوريد المستهلكات</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    تُعرّف الأصناف بتصنيف <code>PACKAGING</code> أو <code>NON_STOCK_ITEM</code>،
                    وتُشترى عبر المشتريات العادية إلى «مخزن المستهلكات» أو المستودع الرئيسي.
                  </p>
                </div>
                <div className="rounded-xl border border-border/80 bg-surface-2/40 p-4 space-y-2">
                  <h4 className="text-xs font-bold text-foreground">
                    2. الصرف الداخلي اليومي (
                    <Link to="/milling/consumables" className="text-primary underline">
                      /milling/consumables
                    </Link>
                    )
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    عند تسليم العمال حزمة أكياس أو بكرة خيط لصالة الطحن: يدخل المسؤول ويحدد الصنف
                    والكمية المصروفة. يُصدر النظام سند صرف ببادئة متميزة <strong>`CS-`</strong>{" "}
                    (Consumables Supply) وتُنقص الكمية فوراً من رصيد المستهلكات.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── الباب 4: كشف الأمانات والرقابة ─── */}
        {activeTab === "statement" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400">
                <Receipt className="h-5 w-5" />
                <h3 className="text-base font-bold text-foreground">
                  كشف حساب الأمانات والرقابة التشغيلية (/milling/customer-statement)
                </h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                شاشة رقابية شاملة تعرض الموقف الحقيقي لكل عميل بدون أي حسابات يدوية أو تخزين أرصدة
                ثابتة قد تخالف الواقع.
              </p>

              <div className="space-y-4 pt-2">
                <div className="rounded-xl border border-border/80 bg-surface-2/40 p-4 space-y-2">
                  <h4 className="text-xs font-bold text-foreground">
                    التبويب العيني (كميات الحبوب والنواتج)
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    يعرض لكل عميل وصنف: ما تم استلامه، وما تم صرفه، والمتبقي الحالي في المطحنة
                    (بالأكياس وبالكيلوجرام). عند النقر على زر <strong>«مشاركة الكشف»</strong>، يمكن
                    إرسال ملخص الأمانات والمتبقي للعميل مباشرة عبر واتساب.
                  </p>
                </div>

                <div className="rounded-xl border border-border/80 bg-surface-2/40 p-4 space-y-2">
                  <h4 className="text-xs font-bold text-foreground">
                    التبويب المالي (فواتير أجور الطحن والذمم)
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    يسرد جميع فواتير أجور الطحن الرسمية المرتبطة بالمستندات: قيمة الفاتورة، المدفوع،
                    والمتبقي كذمة على العميل. يحتوي كل سطر على:
                    <br />- زر <strong>«طباعة»</strong> لإعادة طباعة مستند وفاتورة الطحن بأي وقت.
                    <br />- زر <strong>«فتح في الكاونتر»</strong> لفتح المستند ومتابعة نواتجه أو
                    تسليمه فوراً.
                    <br />- رابط مباشر للفاتورة في شاشة المبيعات لمتابعة السداد والتحصيل.
                  </p>
                </div>

                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
                  <h4 className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> تنبيه «الفاقد المكتشف» (الرقابة على
                    الماكينات)
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    لا يوجد حقل لإدخال الفاقد يدوياً في النظام (لأن ذلك يفتح باب التلاعب). بدلاً من
                    ذلك، يقوم النظام آلياً بحساب: (وزن الحبوب المطحونة − إجمالي وزن النواتج المسجلة)
                    لكل عملية طحن مستقلة. إذا تجاوز الفرق النسبة الطبيعية، يظهر تنبيه للمراجعة
                    الرقابية للتأكد من نظافة الماكينات وعدم تسرب الدقيق.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── الباب 5: الأسئلة الشائعة والمواقف الميدانية ─── */}
        {activeTab === "faq" && (
          <div className="space-y-4">
            {[
              {
                q: "ماذا أفعل لو دفع العميل جزءاً من أجور الطحن نقداً والباقي آجل؟",
                a: "في استقبال وفواتير الطحن، اختر طريقة الدفع (مثلاً نقداً أو آجل) واكتب في خانة «المدفوع» المبلغ المستلم فقط (مثلاً 5,000 من أصل 10,000). سيقوم النظام آلياً بتسجيل الدفعة وترحيل المبلغ المتبقي كذمة رسمية على العميل في دفتر المبيعات والذمم.",
              },
              {
                q: "ماذا أفعل لو استلم العميل نصف الدقيق اليوم، وقال سأستلم الباقي غداً؟",
                a: "في قسم «3. تسليم النواتج»، أدخل فقط الكمية التي أخذها العميل اليوم (مثلاً 10 أكياس من أصل 20). سيسجل النظام تسليم 10 أكياس ويُبقي 10 أكياس في رصيده. وعندما يعود غداً، افتح نفس المستند من تبويب «المستندات المفتوحة» وسلّمه الباقي.",
              },
              {
                q: "هل تظهر فواتير أجور الطحن في تقارير المبيعات والأرباح العامة للمنشأة؟",
                a: "نعم، تماماً كأي فاتورة مبيعات أخرى. تظهر في كشف المبيعات اليومي، ودفتر اليومية، وتقارير الذمم، وقائمة الدخل تحت بند «إيراد الخدمات» المفصول عن مبيعات البضاعة.",
              },
              {
                q: "عميل جديد حضر ومعه أكياس حبوب، هل أحتاج لفتح شاشة العملاء لتسجيله؟",
                a: "لا. بجانب قائمة اختيار العميل في الكاونتر يوجد زر «+ جديد»، اضغط عليه واكتب اسم العميل ورقم هاتفه، وسيتم حفظه واختياره تلقائياً في الكاونتر دون مغادرة الصفحة.",
              },
              {
                q: "أين أجد مستند قديم لعميل لطحن تم قبل أسبوع لإعادة طباعته؟",
                a: "يمكنك الذهاب إلى «كشف حساب الأمانات» (/milling/customer-statement) واختيار التبويب المالي، أو فتح تبويب «المستندات المفتوحة والبحث» في استقبال وفواتير الطحن والبحث برقم المستند أو اسم العميل، والضغط على زر «طباعة».",
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-2"
              >
                <h4 className="text-xs font-bold text-foreground flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-amber-500 shrink-0" /> {item.q}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed ps-6">{item.a}</p>
              </div>
            ))}
          </div>
        )}

        {/* تذييل المرجع */}
        <div className="rounded-2xl border border-border/70 bg-surface-1/80 p-4 text-center">
          <p className="text-xs text-muted-foreground">
            دليل العمليات المعتمد لنظام المطحنة المبسط — Market-Hub / Vortex ERP.
          </p>
        </div>
      </div>
    </ModuleGuard>
  );
}
export default MillingOperationsGuidePage;
