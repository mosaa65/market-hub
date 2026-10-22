import React, { useState } from "react";
import { Check, Plus, ChevronDown, CheckSquare, Square, LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export interface FilterItemOption {
  id: string;
  label: string;
  secondaryLabel?: string | null;
}

interface UnifiedDimensionFilterControlProps {
  label: string;
  icon: LucideIcon;
  dimensionKey: string;
  isGrouped: boolean;
  onToggleGroup: () => void;
  options: FilterItemOption[];
  selectedIds?: string[];
  onChangeSelectedIds: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function UnifiedDimensionFilterControl({
  label,
  icon: Icon,
  dimensionKey,
  isGrouped,
  onToggleGroup,
  options = [],
  selectedIds = [],
  onChangeSelectedIds,
  placeholder,
  disabled = false,
}: UnifiedDimensionFilterControlProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const isAllSelected = selectedIds.length === 0;

  const filteredOptions = options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(search.toLowerCase()) ||
      (opt.secondaryLabel && opt.secondaryLabel.toLowerCase().includes(search.toLowerCase())),
  );

  const toggleOption = (id: string) => {
    if (selectedIds.includes(id)) {
      const next = selectedIds.filter((item) => item !== id);
      onChangeSelectedIds(next);
    } else {
      onChangeSelectedIds([...selectedIds, id]);
    }
  };

  const selectAll = () => {
    onChangeSelectedIds([]);
  };

  const selectedCount = selectedIds.length;

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {/* سطر العنوان مع حالة البعد */}
      <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
        <span className="flex items-center gap-1 truncate">
          <Icon className="h-3 w-3 text-primary shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        {isGrouped && (
          <Badge
            variant="secondary"
            className="h-4 px-1 text-[9px] bg-primary/10 text-primary border-primary/20"
          >
            مضاف للتجميع
          </Badge>
        )}
      </div>

      {/* المكون الموحد: يمين قائمة التحديد والفلترة، ويسار (+) للتجميع والأعمدة */}
      <div className="flex items-center rounded-md border border-input bg-background shadow-xs overflow-hidden h-7">
        {/* يمين المكون: فتح قائمة التحديد المتعدد والفلترة */}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="flex-1 flex items-center justify-between px-2 text-[10px] text-right truncate h-full hover:bg-muted/30 transition-colors focus:outline-hidden"
            >
              <span className="truncate text-foreground font-normal">
                {isAllSelected ? (
                  <span className="text-muted-foreground">الكل (الافتراضي)</span>
                ) : (
                  <span>
                    تم تحديد <strong className="text-primary">{selectedCount}</strong>
                  </span>
                )}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 mr-1" />
            </button>
          </PopoverTrigger>

          <PopoverContent className="w-64 p-2 text-xs" align="start">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between border-b pb-1">
                <span className="font-semibold text-foreground text-[11px]">تحديد {label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selectAll}
                  className="h-5 px-1.5 text-[10px] text-primary hover:text-primary"
                >
                  تحديد الكل (افتراضي)
                </Button>
              </div>

              {options.length > 5 && (
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`بحث في ${label}...`}
                  className="h-6 text-[10px] px-2"
                />
              )}

              <ScrollArea className="max-h-48">
                <div className="flex flex-col gap-1 py-0.5">
                  <div
                    onClick={selectAll}
                    className="flex items-center gap-2 p-1 rounded-sm hover:bg-muted cursor-pointer text-[11px]"
                  >
                    {isAllSelected ? (
                      <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : (
                      <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-semibold text-foreground">الكل (افتراضي)</span>
                  </div>

                  {filteredOptions.map((opt) => {
                    const isSelected = selectedIds.includes(opt.id);
                    return (
                      <div
                        key={opt.id}
                        onClick={() => toggleOption(opt.id)}
                        className="flex items-center gap-2 p-1 rounded-sm hover:bg-muted cursor-pointer text-[11px]"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                        ) : (
                          <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate text-foreground">{opt.label}</span>
                        {opt.secondaryLabel && (
                          <span className="text-[9px] text-muted-foreground mr-auto shrink-0 font-mono">
                            {opt.secondaryLabel}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {filteredOptions.length === 0 && (
                    <div className="text-center py-2 text-[10px] text-muted-foreground">
                      لا توجد نتائج مطابقة
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </PopoverContent>
        </Popover>

        {/* يسار المكون: زر (+) لإضافة أو إزالة البعد من التجميع والأعمدة */}
        <Button
          type="button"
          variant={isGrouped ? "default" : "ghost"}
          size="sm"
          disabled={disabled}
          onClick={onToggleGroup}
          className={`h-full rounded-none px-2 text-xs border-r border-border transition-all shrink-0 ${
            isGrouped
              ? "bg-primary text-primary-foreground font-bold hover:bg-primary/90"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
          title={
            isGrouped
              ? `إلغاء تجميع ${label} من الأعمدة`
              : `إضافة ${label} إلى التجميع والأعمدة (+)`
          }
        >
          {isGrouped ? <Check className="h-3 w-3" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
