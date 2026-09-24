import { Languages } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

interface AppearanceSectionProps {
  canEdit?: boolean;
}

export function AppearanceSection() {
  const { lang, setLang } = useI18n();
  const isAr = lang === "ar";

  return (
    <Card className="rounded-3xl border-border/80 shadow-xs">
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Languages className="h-5 w-5" />
          </div>
          <div>
            <div>{isAr ? "المظهر ولغة الواجهة" : "Appearance & Language"}</div>
            <div className="text-xs text-muted-foreground font-normal mt-0.5">
              {isAr
                ? "تخصيص لغة النظام (العربية / الإنجليزية) والاتجاه التلقائي"
                : "Choose interface language and automatic direction"}
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-surface/70 p-4">
          <div>
            <div className="text-sm font-semibold">{isAr ? "لغة عرض الواجهة" : "Interface Language"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {isAr
                ? "اختر لغة الواجهة الرئيسية للنظام، يتم حفظ اختيارك تلقائياً."
                : "Choose the main interface language. Your selection is saved automatically."}
            </div>
          </div>
          <div className="inline-flex rounded-full border border-border bg-surface p-1 shadow-xs">
            <button
              type="button"
              onClick={() => setLang("ar")}
              className={`h-9 rounded-full px-5 text-xs font-bold transition-all ${
                lang === "ar"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              العربية
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`h-9 rounded-full px-5 text-xs font-bold transition-all ${
                lang === "en"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              English
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
