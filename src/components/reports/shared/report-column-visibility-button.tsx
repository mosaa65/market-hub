import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ReportColumnVisibilityButtonProps {
  onClick?: () => void;
  visibleCount?: number;
  totalCount?: number;
  className?: string;
  size?: "sm" | "default";
}

export function ReportColumnVisibilityButton({
  onClick,
  visibleCount,
  totalCount,
  className,
}: ReportColumnVisibilityButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={`h-8 gap-1.5 border-border bg-card px-2.5 text-xs font-semibold text-foreground hover:bg-muted shadow-xs ${className || ""}`}
      title="تخصيص الأعمدة المعروضة وإخفائها"
    >
      <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
      <span>الأعمدة</span>
      {visibleCount !== undefined && (
        <Badge
          variant="secondary"
          className="h-4 min-w-4 px-1 text-[10px] font-mono bg-muted text-muted-foreground"
        >
          {totalCount !== undefined ? `${visibleCount}/${totalCount}` : visibleCount}
        </Badge>
      )}
    </Button>
  );
}
