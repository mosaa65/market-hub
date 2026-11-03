import React from "react";
import { Check, Layers, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReportDomain } from "@/lib/reports/types";
import {
  getDomainDimensions,
  type ReportDimensionKey,
  type DomainDimensionConfig,
} from "@/lib/reports/registry/groupby-registry";

interface ReportDimensionsBarProps {
  domain: ReportDomain;
  selectedDimensions: ReportDimensionKey[];
  onChangeDimensions: (dimensions: ReportDimensionKey[]) => void;
  onResetToDetailed?: () => void;
  disabled?: boolean;
}

export function ReportDimensionsBar({
  domain,
  selectedDimensions,
  onChangeDimensions,
  onResetToDetailed,
  disabled = false,
}: ReportDimensionsBarProps) {
  const availableDimensions = getDomainDimensions(domain);

  const toggleDimension = (key: ReportDimensionKey) => {
    if (disabled) return;
    if (selectedDimensions.includes(key)) {
      const next = selectedDimensions.filter((d) => d !== key);
      onChangeDimensions(next);
    } else {
      onChangeDimensions([...selectedDimensions, key]);
    }
  };

  const isDetailed = selectedDimensions.length === 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1 font-semibold text-muted-foreground mr-1">
          <Layers className="h-3.5 w-3.5 text-primary" />
          <span>تجميع العرض حسب:</span>
        </div>

        {availableDimensions.map((dim: DomainDimensionConfig) => {
          const isSelected = selectedDimensions.includes(dim.key);
          const Icon = dim.icon;

          return (
            <Button
              key={dim.key}
              type="button"
              variant={isSelected ? "default" : "outline"}
              size="sm"
              disabled={disabled}
              onClick={() => toggleDimension(dim.key)}
              className={`h-7 px-2.5 text-xs gap-1.5 transition-all ${
                isSelected
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-background/80 hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{dim.labelAr}</span>
              {isSelected && <Check className="h-3 w-3 ml-0.5" />}
            </Button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        {selectedDimensions.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
              مجمع حسب {selectedDimensions.length} أبعاد معاً
            </Badge>
            {onResetToDetailed && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResetToDetailed}
                disabled={disabled}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
                title="عرض تفصيلي لكل بند مستقل"
              >
                <RotateCcw className="h-3 w-3" />
                <span>عرض تفصيلي</span>
              </Button>
            )}
          </div>
        ) : (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] text-muted-foreground bg-background/50"
          >
            عرض تفصيلي (كامل السندات)
          </Badge>
        )}
      </div>
    </div>
  );
}
