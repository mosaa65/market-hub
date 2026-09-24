import { SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCatalogModules } from "@/lib/catalog-modules";
import { CatalogModulesDialog } from "@/components/catalog-modules-dialog";
import { useState } from "react";

interface CatalogSectionProps {
  canEdit: boolean;
  lang: string;
}

export function CatalogSection({ lang }: CatalogSectionProps) {
  const isAr = lang === "ar";
  const { config } = useCatalogModules();
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);

  const profileLabel =
    config.profile === "spare_parts"
      ? isAr
        ? "قطع غيار ودراجات ومركبات"
        : "Spare Parts & Automotive"
      : config.profile === "grocery"
        ? isAr
          ? "مواد غذائية وبقالة وسوبرماركت"
          : "Grocery & Food Market"
        : config.profile === "retail"
          ? isAr
            ? "تجارة عامة وملابس وتجزئة"
            : "General Retail"
          : isAr
            ? "تخصيص يدوي مخصص"
            : "Custom Configuration";

  return (
    <>
      <Card className="rounded-3xl border-primary/30 bg-gradient-to-r from-primary/5 via-surface to-surface shadow-xs">
        <CardHeader className="border-b border-border/40 pb-4">
          <CardTitle className="text-base font-bold flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div>
                <div>{isAr ? "تخصيص النشاط وموديولات الفهرسة" : "Industry Profile & Catalog Modules"}</div>
                <div className="text-xs text-muted-foreground font-normal mt-0.5">
                  {isAr
                    ? "تكييف حقول الفهرس والمنتجات بحسب نشاطك التجاري (قطع غيار، مواد غذائية، ملابس، تجارة عامة)"
                    : "Configure active catalog modules, vehicle fitment, quality grades, and origins"}
                </div>
              </div>
            </span>
            <span className="rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-1 text-xs font-bold">
              {profileLabel}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl border border-border/80 bg-surface/80">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground">
                {isAr
                  ? "تحديد الميزات المفعلة في الفهرس والمنتجات والـ POS"
                  : "Configure active catalog modules"}
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                {isAr
                  ? "يمكنك بنقرة واحدة اختيار نشاطك (بقالة ومواد غذائية، قطع غيار ومركبات، تجارة عامة) لتفعيل أو إخفاء توافق القطع، درجات الجودة، وبلدان المنشأ."
                  : "Toggle vehicle fitment, quality grades, origins, brands, and units for your industry."}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCatalogDialogOpen(true)}
              className="rounded-full border-primary/40 text-primary hover:bg-primary/10 shadow-xs"
            >
              <SlidersHorizontal className="h-4 w-4 me-1.5" />
              {isAr ? "تخصيص الموديولات والنشاط" : "Customize Modules"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <CatalogModulesDialog open={catalogDialogOpen} onClose={() => setCatalogDialogOpen(false)} />
    </>
  );
}
