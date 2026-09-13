import { useState } from "react";
import { useCatalogModules, type BusinessProfile } from "@/lib/catalog-modules";
import { useI18n } from "@/lib/i18n";
import {
  X,
  SlidersHorizontal,
  Bike,
  ShoppingCart,
  Store,
  Sparkles,
  Check,
  CheckCircle2,
  Globe2,
  Medal,
  Layers,
  Box,
  Car,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface CatalogModulesDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CatalogModulesDialog({ open, onClose }: CatalogModulesDialogProps) {
  const { lang } = useI18n();
  const { config, setProfile, updateConfig } = useCatalogModules();

  if (!open) return null;

  const profiles: {
    id: BusinessProfile;
    titleAr: string;
    titleEn: string;
    descAr: string;
    descEn: string;
    icon: typeof Bike;
    badgeColor: string;
  }[] = [
    {
      id: "spare_parts",
      titleAr: "قطع غيار ودراجات ومركبات",
      titleEn: "Spare Parts & Automotive",
      descAr: "تفعيل كافة ميزات توافق الموديلات، درجات الجودة (أصلي/تجاري)، وبلدان المنشأ.",
      descEn: "Full fitment compatibility, quality grades (OEM/Aftermarket), and origins.",
      icon: Bike,
      badgeColor: "border-primary/40 bg-primary/10 text-primary",
    },
    {
      id: "grocery",
      titleAr: "مواد غذائية وبقالة وسوبرماركت",
      titleEn: "Grocery & Food Market",
      descAr: "إلغاء توافق المركبات ودرجات الجودة، والتركيز على التصنيفات والماركات والوحدات.",
      descEn: "Disables vehicle fitment and grades, keeping categories, brands, and units.",
      icon: ShoppingCart,
      badgeColor: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    {
      id: "retail",
      titleAr: "تجارة عامة وملابس وتجزئة",
      titleEn: "General Retail & Apparel",
      descAr: "تصنيفات، ماركات، وحدات، مع إمكانية تحديد بلدان المنشأ وإلغاء فلاتر المركبات.",
      descEn: "Categories, brands, units, and origin countries without vehicle fitment.",
      icon: Store,
      badgeColor: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    },
    {
      id: "custom",
      titleAr: "تخصيص يدوي مخصص",
      titleEn: "Custom Configuration",
      descAr: "تحكم حر كامل بتفعيل أو تعطيل أي موديول حسب حاجة مشروعك تمامًا.",
      descEn: "Full manual control over each individual catalog dimension and attribute.",
      icon: SlidersHorizontal,
      badgeColor: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300",
    },
  ];

  const modules = [
    {
      key: "enableMakesAndModels" as const,
      titleAr: "ماركات وموديلات المركبات وتوافق القطع",
      titleEn: "Vehicle Makes, Models & Part Fitment",
      descAr: "إدارة ماركات وموديلات الدراجات والمركبات وتحديد توافق القطعة مع موديلات متعددة في كرت الصنف والـ POS.",
      descEn: "Manage vehicle makes/models and match parts with specific models in products and POS.",
      icon: Car,
      current: config.enableMakesAndModels,
    },
    {
      key: "enableQualityGrades" as const,
      titleAr: "درجات الجودة (أصلي / وكالة / تجاري)",
      titleEn: "Quality Grades (OEM / Genuine / Aftermarket)",
      descAr: "تصنيف القطع والأصناف بحسب درجات الجودة، وترتيبها وفلترتها في نقطة البيع.",
      descEn: "Classify items by grade (OEM, Genuine, Grade A, Economy) with POS filtering.",
      icon: Medal,
      current: config.enableQualityGrades,
    },
    {
      key: "enableOrigins" as const,
      titleAr: "بلدان المنشأ وكود الدولة",
      titleEn: "Countries of Origin & Country Codes",
      descAr: "إدارة بلدان التصنيع والمنشأ للأصناف مع كود المنشأ (مثال: JP اليابان، CN الصين).",
      descEn: "Track country of manufacture with 2-letter country codes.",
      icon: Globe2,
      current: config.enableOrigins,
    },
    {
      key: "enableBrands" as const,
      titleAr: "العلامات التجارية والشركات المصنعة",
      titleEn: "Brands & Manufacturers",
      descAr: "إدارة الماركات المصنعة للبضائع والقطع (مثال: NGK, Castrol, المراعي).",
      descEn: "Manage item manufacturers and brand lines.",
      icon: Layers,
      current: config.enableBrands,
    },
    {
      key: "enableUnits" as const,
      titleAr: "الوحدات والعبوات المتعددة",
      titleEn: "Units of Measurement & Packaging",
      descAr: "إدارة وحدات القياس (حبة، كرتون، باكت، طقم، درزن...).",
      descEn: "Track measurement units (piece, carton, pack, set...).",
      icon: Box,
      current: config.enableUnits,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel-elevated w-full max-w-2xl rounded-3xl border border-border/80 bg-surface/95 p-6 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 pb-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                {lang === "ar" ? "إدارة موديولات الفهرسة وتخصيص النشاط" : "Catalog Modules & Business Profile"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {lang === "ar"
                  ? "خصص أبعاد الفهرسة لتناسب نشاطك (قطع غيار، بقالة ومواد غذائية، تجارة عامة)"
                  : "Customize catalog dimensions to fit your exact business needs"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto space-y-6 py-4 pr-1 custom-scrollbar flex-1">
          {/* Section 1: Pre-set Profiles */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {lang === "ar" ? "اختر نمط النشاط المناسب لمشروعك" : "Select Business Profile"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {lang === "ar" ? "يضبط الموديولات تلقائيًا بنقرة واحدة" : "Auto-configures modules in 1 click"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {profiles.map((p) => {
                const Icon = p.icon;
                const isSelected = config.profile === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProfile(p.id);
                      toast.success(
                        lang === "ar"
                          ? `تم تطبيق نمط: ${p.titleAr}`
                          : `Applied profile: ${p.titleEn}`
                      );
                    }}
                    className={`group relative flex flex-col items-start gap-1.5 rounded-2xl border p-3.5 text-start transition-all duration-200 ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/30"
                        : "border-border/80 bg-surface/70 hover:border-primary/40 hover:bg-surface-2"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`grid h-8 w-8 place-items-center rounded-xl border ${p.badgeColor}`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-foreground">
                          {lang === "ar" ? p.titleAr : p.titleEn}
                        </span>
                      </div>
                      {isSelected && (
                        <div className="grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {lang === "ar" ? p.descAr : p.descEn}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Individual Module Switches */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {lang === "ar" ? "التحكم التفصيلي في موديولات الفهرسة" : "Individual Module Switches"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {lang === "ar" ? "تفعيل أو إلغاء فوري" : "Instant enable / disable"}
              </span>
            </div>

            <div className="space-y-2.5 rounded-2xl border border-border/80 bg-surface-2/30 p-3">
              {modules.map((m) => {
                const Icon = m.icon;
                return (
                  <div
                    key={m.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface p-3 transition hover:border-primary/30"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-primary border border-border/80 mt-0.5">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-foreground">
                          {lang === "ar" ? m.titleAr : m.titleEn}
                        </div>
                        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                          {lang === "ar" ? m.descAr : m.descEn}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Switch
                        checked={m.current}
                        onCheckedChange={(val) => {
                          updateConfig({ [m.key]: val, profile: "custom" });
                          toast.success(
                            lang === "ar"
                              ? `${val ? "تم تفعيل" : "تم تعطيل"}: ${m.titleAr}`
                              : `${val ? "Enabled" : "Disabled"}: ${m.titleEn}`
                          );
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/60 pt-4 shrink-0 mt-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              {lang === "ar"
                ? "يتم تطبيق التغييرات فوراً على الفهرس والمنتجات ونقطة البيع"
                : "Changes apply immediately to Catalog, Products, and POS"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground hover:opacity-90 shadow-sm shadow-primary/20 transition active:scale-95"
          >
            {lang === "ar" ? "حفظ وإغلاق" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
