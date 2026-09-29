import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useState } from "react";
import {
  Sparkles,
  DollarSign,
  TrendingUp,
  Receipt,
  Users,
  SlidersHorizontal,
  Calendar,
  Layers,
  ArrowRight
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  VortexMetricCard,
  VortexDateBadge,
  VortexCollectionSheet,
  VortexTransactionDetailSheet,
  VortexFilterSheet,
  VortexFilterSection,
  VortexSearchInput,
  VortexNumberInput,
  VortexCurrencyInput,
  VortexDrawerDialog,
} from "@/components/vortex-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/vortex-ui")({
  head: () => ({ meta: [{ title: "مختبر مكونات Vortex UI — فورتكس ERP" }] }),
  component: VortexUiShowcasePage,
});

function VortexUiShowcasePage() {
  // Collection Sheet State
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionSuccessData, setCollectionSuccessData] = useState<any>(null);

  // Transaction Detail Sheet State
  const [txSheetOpen, setTxSheetOpen] = useState(false);

  // Filter Sheet State
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAccountState, setFilterAccountState] = useState("all");
  const [filterHasPhone, setFilterHasPhone] = useState(false);

  // Inputs state
  const [sampleSearch, setSampleSearch] = useState("");
  const [sampleAmount, setSampleAmount] = useState<number | null>(4500);
  const [sampleQty, setSampleQty] = useState<number | null>(12);

  return (
    <div className="space-y-8 pb-16">
      <PageHeader
        title="مختبر ومكتبة مكونات Vortex UI"
        subtitle="جميع المكونات والوحدات المقتبسة من تصميم نظام مُلاك والمجهزة لإعادة الاستخدام في كل واجهات فورتكس"
      />

      {/* ─── 1. البطاقات المالية (Vortex Metric Cards) ─── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="size-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">1. بطاقات الإحصاءات والمالية (Vortex Metric Cards)</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <VortexMetricCard
            title="إجمالي التحصيلات اليومية"
            value={24850}
            currency="ر.س"
            trend={{ value: 14.2, isPositive: true }}
            icon={TrendingUp}
            variant="default"
            description="مقارنة بالمتوسط للأسبوع الماضي"
          />
          <VortexMetricCard
            title="الذمم والديون المستحقة"
            value={186200}
            currency="ر.س"
            trend={{ value: 5.8, isPositive: false }}
            icon={DollarSign}
            variant="warning"
            description="تشمل العملاء المتجاوزين للحد"
          />
          <VortexMetricCard
            title="فواتير مسددة بالكامل"
            value={342}
            icon={Receipt}
            variant="success"
            description="نسبة التغطية النقدية 92%"
          />
          <VortexMetricCard
            title="عملاء بحاجة للمتابعة"
            value={18}
            icon={Users}
            variant="danger"
            description="تجاوزوا مهلة السداد المقررة"
          />
        </div>
      </section>

      {/* ─── 2. شارات وتنسيق التواريخ الفاخرة (Vortex Date Badge) ─── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="size-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">2. شارات التواريخ العربية الفاخرة (Vortex Date Badge)</h2>
        </div>
        <Card className="rounded-3xl border-border/80">
          <CardHeader>
            <CardTitle className="text-sm">معاينة أحجام شارة التاريخ وتنسيقها المستوحى من مُلاك</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-6">
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">الحجم الصغير (sm):</span>
              <VortexDateBadge date={new Date().toISOString()} size="sm" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">الحجم العادي (md):</span>
              <VortexDateBadge date={new Date().toISOString()} size="md" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">الحجم الكبير مع اسم اليوم (lg):</span>
              <VortexDateBadge date={new Date().toISOString()} size="lg" showWeekday />
            </div>
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">تاريخ سابق (فاتورة قديمة):</span>
              <VortexDateBadge date="2026-04-15" size="md" showWeekday />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── 3. حقول الإدخال والبحث الموحدة (Inputs) ─── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">3. حقول الإدخال المحسّنة (Vortex Inputs)</h2>
        </div>
        <Card className="rounded-3xl border-border/80">
          <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold text-muted-foreground block mb-2">حقل البحث الفوري مع زر المسح:</label>
              <VortexSearchInput
                value={sampleSearch}
                onChange={(e) => setSampleSearch(e.target.value)}
                placeholder="ابحث عن عميل أو رقم فاتورة..."
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground block mb-2">حقل المبالغ والعملات (Currency Input):</label>
              <VortexCurrencyInput
                value={sampleAmount}
                onChange={setSampleAmount}
                currency="ر.س"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground block mb-2">حقل الأعداد والكميات (Number Input):</label>
              <VortexNumberInput
                value={sampleQty}
                onChange={setSampleQty}
                min={0}
                max={100}
                placeholder="أدخل الكمية..."
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── 4. النوافذ والشيتات التفاعلية (Dialogs & Sheets) ─── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">4. الشيتات التفاعلية وسندات القبض (Interactive Sheets)</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Collection Sheet Trigger */}
          <div className="rounded-3xl border border-border/80 bg-surface p-5 space-y-3 flex flex-col justify-between">
            <div>
              <div className="size-10 rounded-2xl bg-emerald-500/10 text-emerald-600 grid place-items-center mb-3">
                <Receipt className="size-5" />
              </div>
              <h3 className="text-sm font-bold">شيت التحصيل وسند القبض السريع</h3>
              <p className="text-xs text-muted-foreground mt-1">
                نافذة منبثقة لتسجيل المبالغ، اختيار طريقة الدفع، وتوليد إشعار واتساب وSMS مباشرة.
              </p>
            </div>
            <Button
              onClick={() => setCollectionOpen(true)}
              className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              تجربة شيت التحصيل
            </Button>
          </div>

          {/* Transaction Detail Sheet Trigger */}
          <div className="rounded-3xl border border-border/80 bg-surface p-5 space-y-3 flex flex-col justify-between">
            <div>
              <div className="size-10 rounded-2xl bg-primary/10 text-primary grid place-items-center mb-3">
                <Sparkles className="size-5" />
              </div>
              <h3 className="text-sm font-bold">شيت تفاصيل السند والعملية</h3>
              <p className="text-xs text-muted-foreground mt-1">
                عرض تفاصيل العملية الماليّة مع شارة تاريخ فاخرة، متبقي الحساب، وزر المشاركة المباشر.
              </p>
            </div>
            <Button
              onClick={() => setTxSheetOpen(true)}
              variant="outline"
              className="w-full rounded-2xl border-primary/30 text-primary hover:bg-primary/10"
            >
              عرض تفاصيل سند نموذجي
            </Button>
          </div>

          {/* Filter Sheet Trigger */}
          <div className="rounded-3xl border border-border/80 bg-surface p-5 space-y-3 flex flex-col justify-between">
            <div>
              <div className="size-10 rounded-2xl bg-amber-500/10 text-amber-600 grid place-items-center mb-3">
                <SlidersHorizontal className="size-5" />
              </div>
              <h3 className="text-sm font-bold">شيت الفلترة الجانبي المتقدم</h3>
              <p className="text-xs text-muted-foreground mt-1">
                تصفية القوائم بفئات وفلاتر سريعة مثل نظام مُلاك العقاري.
              </p>
            </div>
            <Button
              onClick={() => setFilterOpen(true)}
              variant="secondary"
              className="w-full rounded-2xl"
            >
              فتح شيت الفلترة
            </Button>
          </div>
        </div>
      </section>

      {/* ─── Modals / Sheets Injected ─── */}
      <VortexCollectionSheet
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        customer={{
          id: "demo-cust-1",
          name: "شركة الأفق للتجارة والمقاولات",
          phone: "+967771234567",
          balance: 8500,
        }}
        onSavePayment={async (data) => {
          toast.success("تم تسجيل سند القبض التجريبي بنجاح!");
          return { receiptNumber: "REC-9482" };
        }}
      />

      <VortexTransactionDetailSheet
        open={txSheetOpen}
        onOpenChange={setTxSheetOpen}
        transaction={{
          id: "TX-9921",
          type: "payment",
          title: "سند قبض تحصيل نقدي",
          amount: 4500,
          date: new Date().toISOString().slice(0, 10),
          customerName: "مؤسسة الرواد للخدمات اللوجستية",
          customerPhone: "+967770000000",
          referenceNumber: "9921",
          method: "تحويل بنكي - مصرف الراجحي",
          notes: "دفعة من فاتورة توريد البضائع رقم #INV-104",
          remainingBalance: 12000,
        }}
      />

      <VortexFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        title="تصفية الحسابات والديون"
        activeFiltersCount={(filterAccountState !== "all" ? 1 : 0) + (filterHasPhone ? 1 : 0)}
        onReset={() => {
          setFilterAccountState("all");
          setFilterHasPhone(false);
        }}
      >
        <VortexFilterSection title="حالة الذمم والمديونية">
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "all", label: "الكل" },
              { id: "debt", label: "عليهم ديون" },
              { id: "over_limit", label: "تجاوزوا الحد" },
              { id: "zero", label: "حساب مسوى" },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilterAccountState(opt.id)}
                className={`rounded-xl border p-2.5 text-xs font-medium transition ${
                  filterAccountState === opt.id
                    ? "border-primary bg-primary/10 text-primary font-bold"
                    : "border-border/70 hover:bg-surface-2 text-muted-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </VortexFilterSection>

        <VortexFilterSection title="بيانات الاتصال">
          <label className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-surface-2/40 cursor-pointer">
            <span className="text-xs font-medium">العملاء الذين لديهم رقم هاتف مسجل فقط</span>
            <input
              type="checkbox"
              checked={filterHasPhone}
              onChange={(e) => setFilterHasPhone(e.target.checked)}
              className="rounded border-input text-primary focus:ring-primary"
            />
          </label>
        </VortexFilterSection>
      </VortexFilterSheet>
    </div>
  );
}
