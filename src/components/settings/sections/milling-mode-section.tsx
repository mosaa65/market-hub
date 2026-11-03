import React from "react";
import { Scale, CheckCircle2, ShieldCheck, Zap, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useMillingMode, MILLING_MODES, type MillingMode } from "@/lib/milling-mode";

interface MillingModeSectionProps {
  canEdit: boolean;
  lang: string;
}

export function MillingModeSection({ canEdit, lang }: MillingModeSectionProps) {
  const isAr = lang === "ar";
  const { mode, setMode } = useMillingMode();

  const handleSelectMode = (newMode: MillingMode) => {
    if (!canEdit) {
      toast.error(
        isAr
          ? "عذراً، هذا الإجراء متاح فقط لمدير النظام (Super Admin)."
          : "Only owners or managers can change this setting.",
      );
      return;
    }
    setMode(newMode);
    toast.success(
      isAr ? "تم تحديث نمط تشغيل المنشأة بنجاح." : "Operational mode updated successfully.",
    );
  };

  const getModeIcon = (id: MillingMode) => {
    switch (id) {
      case "none":
        return <Building2 className="h-5 w-5 text-slate-500" />;
      case "simplified":
        return <Zap className="h-5 w-5 text-amber-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-amber-500/30 bg-gradient-to-r from-amber-500/5 via-card to-card shadow-xs overflow-hidden">
        <CardHeader className="border-b border-border/40 pb-4">
          <CardTitle className="text-base font-bold flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <Scale className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span>
                    {isAr ? "نمط نشاط المنشأة وإدارة المطحنة" : "Business Type & Milling Mode"}
                  </span>
                  <span className="rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold">
                    Super Admin
                  </span>
                </div>
                <div className="text-xs text-muted-foreground font-normal mt-0.5">
                  {isAr
                    ? "تحديد ما إذا كانت المؤسسة سوبرماركت/متجر عام (إخفاء المطحنة تماماً) أو مطحنة تعمل بالخطة المبسطة الموحدة."
                    : "Configure store identity: General Store/Supermarket or Simplified Mill."}
                </div>
              </div>
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {MILLING_MODES.map((item) => {
              const isSelected = mode === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectMode(item.id)}
                  className={`relative cursor-pointer rounded-2xl border-2 p-5 transition-all text-right flex flex-col justify-between ${
                    isSelected
                      ? "border-amber-500 bg-amber-500/10 shadow-md shadow-amber-500/10"
                      : "border-border/80 bg-surface/80 hover:bg-surface-2 hover:border-border"
                  } ${!canEdit ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`p-2 rounded-xl ${isSelected ? "bg-amber-500/20 text-amber-600 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}
                        >
                          {getModeIcon(item.id)}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-foreground">
                            {isAr ? item.titleAr : item.titleEn}
                          </h4>
                          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                            {isAr ? item.badgeAr : item.badgeEn}
                          </span>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="p-1 rounded-full bg-amber-500 text-white shrink-0 shadow-xs">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {isAr ? item.descriptionAr : item.descriptionEn}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground font-medium">
                    <span className="font-bold text-foreground">الاستخدام المثالي: </span>
                    {item.suitableForAr}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-muted/40 border border-border text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span>
              {isAr
                ? "التغيير يُطبق فوراً على القوائم والمسارات وشاشات النظام دون الحاجة لإعادة تسجيل الدخول أو فقدان أي بيانات سابقة."
                : "Changes take effect immediately across all navigation items and routes."}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
