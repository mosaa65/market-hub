import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReportShellProps {
  title: string;
  subtitle: string;
  actions: ReactNode;
  summary?: ReactNode;
  error?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
  onBack?: () => void;
  backLabel: string;
  refreshLabel: string;
  children: ReactNode;
}

/**
 * الغلاف الموحد لكل كشوف مركز الكشوفات.
 * يحافظ على نفس ترتيب كشف العميل: عنوان، أدوات، تنبيه، ملخص، ثم الجدول.
 */
export function ReportShell({
  title,
  subtitle,
  actions,
  summary,
  error,
  loading = false,
  onRefresh,
  onBack,
  backLabel,
  refreshLabel,
  children,
}: ReportShellProps) {
  return (
    <div className="panel-elevated overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
              {refreshLabel}
            </Button>
          )}
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              {backLabel}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="border-b border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </div>
      )}
      {summary}
      {children}
    </div>
  );
}

export function ReportSummary({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-3">
      {children}
    </div>
  );
}

export function ReportSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border-border/70 bg-surface/50 p-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
