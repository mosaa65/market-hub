import { useI18n } from "@/lib/i18n";
import { Sparkles } from "lucide-react";

export function ComingSoon({ title, icon: Icon = Sparkles }: { title: string; icon?: typeof Sparkles }) {
  const { t } = useI18n();
  return (
    <div className="panel-elevated flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-chart-4/20 border border-border">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("common.workflow_note")}</p>
      <span className="mt-4 inline-flex items-center rounded-full border border-border bg-surface px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("common.coming_soon")}
      </span>
    </div>
  );
}
