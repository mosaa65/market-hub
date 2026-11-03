import {
  SlidersHorizontal,
  Box,
  Sprout,
  Package,
  Layers,
  Globe2,
  Medal,
  Tags,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useCatalogModules } from "@/lib/catalog-modules";
import { MillingModeSection } from "./milling-mode-section";
import { toast } from "sonner";

interface CatalogSectionProps {
  canEdit: boolean;
  lang: string;
}

export function CatalogSection({ canEdit, lang }: CatalogSectionProps) {
  const isAr = lang === "ar";
  const { config, updateConfig } = useCatalogModules();

  const dimensions = [
    {
      key: "enableUnits" as const,
      titleAr: "وحدات القياس والعبوات",
      titleEn: "Units & packaging sizes",
      descAr:
        "الوحدة التي يُقاس بها الصنف (كجم، طن، حبة، باكت...). إلغاء تفعيلها يبسط إدخال الأصناف.",
      descEn: "Unit of measurement. Disabling simplifies direct item counting.",
      icon: Box,
      current: config.enableUnits,
    },
    {
      key: "enableGrainGrades" as const,
      titleAr: "درجات وأصناف الحبوب",
      titleEn: "Grain grades & varieties",
      descAr: "تصنيف القمح والذرة والشعير إلى أصناف تجارية مختلفة (درجة أولى، ثانية...).",
      descEn: "Commercial grading for wheat, corn, barley, etc.",
      icon: Sprout,
      current: config.enableGrainGrades,
    },
    {
      key: "enablePackagingBags" as const,
      titleAr: "مستلزمات التعبئة والتغليف",
      titleEn: "Packaging supplies",
      descAr: "إدارة أكياس وخيوط التعبئة كأصناف استهلاكية مباشرة.",
      descEn: "Manage packaging bags and strings as consumable catalog items.",
      icon: Package,
      current: config.enablePackagingBags,
    },
    {
      key: "enableBrands" as const,
      titleAr: "العلامات التجارية (Brands)",
      titleEn: "Brands",
      descAr: "ربط الأصناف بشركات وعلامات تجارية محددة لتسهيل الفلترة والتقارير.",
      descEn: "Link items to brands for enhanced grouping and reporting.",
      icon: Layers,
      current: config.enableBrands,
    },
    {
      key: "enableOrigins" as const,
      titleAr: "بلدان المنشأ",
      titleEn: "Countries of origin",
      descAr: "تحديد بلد الصنع أو بلد الاستيراد للمنتجات.",
      descEn: "Origin country metadata on catalog items.",
      icon: Globe2,
      current: config.enableOrigins,
    },
    {
      key: "enableQualityGrades" as const,
      titleAr: "درجات الجودة",
      titleEn: "Quality grades",
      descAr: "إضافة خيارات ومستويات جودة للصنف التجاري.",
      descEn: "Quality level options for goods.",
      icon: Medal,
      current: config.enableQualityGrades,
    },
    {
      key: "enableMakesAndModels" as const,
      titleAr: "الماركات والموديلات",
      titleEn: "Makes & Models",
      descAr: "تنظيم المنتجات وموديلاتها وتوافقها (قطع غيار أو أجهزة).",
      descEn: "Compatible makes and models for automotive or parts stores.",
      icon: Tags,
      current: config.enableMakesAndModels,
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-border/80 bg-card shadow-xs">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-base font-bold flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-2xl bg-primary/10 text-primary">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-bold">
                  {isAr ? "تخصيص أبعاد الفهرس والمنتجات" : "Catalogue Dimensions & Modules"}
                </div>
                <div className="text-xs text-muted-foreground font-normal mt-0.5">
                  {isAr
                    ? "فعّل أو عطل الحقول والأبعاد المناسبة لنشاطك التجاري. كل تغيير يُطبّق ويُحفظ فوراً."
                    : "Enable or disable catalog dimensions fitting your business. Changes save instantly."}
                </div>
              </div>
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {dimensions.map((dim) => {
              const Icon = dim.icon;
              return (
                <div
                  key={dim.key}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-border/70 bg-surface/70 p-4 transition-all hover:bg-surface-2 hover:border-border"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-xs font-bold text-foreground">
                        {isAr ? dim.titleAr : dim.titleEn}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {isAr ? dim.descAr : dim.descEn}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <Switch
                      checked={dim.current}
                      disabled={!canEdit}
                      onCheckedChange={(val) => {
                        updateConfig({ [dim.key]: val });
                        toast.success(
                          isAr
                            ? `${val ? "تم تفعيل" : "تم تعطيل"}: ${dim.titleAr}`
                            : `${val ? "Enabled" : "Disabled"}: ${dim.titleEn}`,
                        );
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 pt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>
              {isAr
                ? "يتم حفظ هذه الخيارات تلقائياً وتنعكس على شاشات إضافة المنتجات وتعديلها"
                : "Settings are automatically saved and immediately affect item forms"}
            </span>
          </div>
        </CardContent>
      </Card>

      <MillingModeSection canEdit={canEdit} lang={lang} />
    </div>
  );
}
