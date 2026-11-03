import { type ReactNode } from "react";
import { PageGuideButton, type PageGuideConfig } from "@/components/page-guide";

export function PageHeader({
  title,
  subtitle,
  actions,
  guide,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  guide?: PageGuideConfig;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-start gap-3">
        {guide && <PageGuideButton config={guide} className="mt-1" />}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
