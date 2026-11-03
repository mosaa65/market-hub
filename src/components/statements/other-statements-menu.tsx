import { useState } from "react";
import { Check, ClipboardList, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { REPORT_DEFINITIONS, type ReportType } from "@/lib/statements/report-registry";
import { cn } from "@/lib/utils";

// قائمة الكشوفات التشغيلية الأخرى (المستبعد منها كشوفات الحسابات الأساسية: عميل، مورد، صندوق)
const OTHER_STATEMENT_TYPES: ReportType[] = [
  "purchases",
  "debts",
  "sales-invoices",
  "profit-sales",
  "inventory-movements",
  "returns",
  "expenses",
  "product",
];

interface OtherStatementsMenuProps {
  currentType: ReportType;
  onSelect: (type: ReportType) => void;
  isLoading?: boolean;
  label?: string;
  title?: string;
}

export function OtherStatementsMenu({
  currentType,
  onSelect,
  isLoading = false,
  label = "كشوفات أخرى",
  title = "اختيار كشف آخر",
}: OtherStatementsMenuProps) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const isOtherActive = OTHER_STATEMENT_TYPES.includes(currentType);
  const activeDef = isOtherActive ? REPORT_DEFINITIONS.find((r) => r.type === currentType) : null;

  const handleSelect = (type: ReportType) => {
    if (type === currentType) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    onSelect(type);
    setOpen(false);
    // محاكاة انتهاء التحميل إذا لم تأتِ الخاصية من الخارج
    setTimeout(() => {
      setSwitching(false);
    }, 600);
  };

  const showLoading = isLoading || switching;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isOtherActive ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 gap-1.5 px-2.5 text-xs transition-all duration-200",
            isOtherActive && "bg-primary text-primary-foreground shadow-sm",
          )}
        >
          {showLoading ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-current" />
          ) : (
            <ClipboardList className="h-3.5 w-3.5" />
          )}
          <span>{label}</span>
          {activeDef && (
            <span
              className={cn(
                "rounded px-1.5 py-0.2 text-[10px] font-medium",
                isOtherActive
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-surface-2 text-muted-foreground",
              )}
            >
              {activeDef.title.ar}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[250px] p-1.5">
        <div className="flex items-center justify-between border-b border-border/60 px-2 py-1.5 text-xs font-semibold">
          <span>{title}</span>
          {showLoading && <RefreshCw className="h-3 w-3 animate-spin text-primary" />}
        </div>
        <div className="space-y-0.5 pt-1 max-h-[300px] overflow-y-auto">
          {OTHER_STATEMENT_TYPES.map((type) => {
            const def = REPORT_DEFINITIONS.find((r) => r.type === type);
            if (!def) return null;
            const Icon = def.icon;
            const isSelected = currentType === type;

            return (
              <button
                key={type}
                type="button"
                onClick={() => handleSelect(type)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-xs transition-colors",
                  isSelected
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-surface-2 text-foreground/90",
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isSelected ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="truncate">{def.title.ar}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary stroke-[2.5]" />}
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
