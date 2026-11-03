import { Check, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { StatementFieldKey } from "@/lib/statements/types";

export interface ColumnVisibilityOption {
  key: StatementFieldKey;
  label: string;
}

interface ColumnVisibilityMenuProps {
  columns: ColumnVisibilityOption[];
  visible: Record<StatementFieldKey, boolean>;
  onChange: (key: StatementFieldKey, visible: boolean) => void;
  label: string;
  title: string;
}

export function ColumnVisibilityMenu({
  columns,
  visible,
  onChange,
  label,
  title,
}: ColumnVisibilityMenuProps) {
  const visibleCount = columns.filter((column) => visible[column.key]).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
          <Columns3 className="h-3.5 w-3.5" />
          {label}
          <span className="text-[10px] text-muted-foreground">
            {visibleCount}/{columns.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[220px] p-1.5">
        <div className="border-b border-border/60 px-2 py-1.5 text-xs font-semibold">{title}</div>
        <div className="space-y-0.5 pt-1">
          {columns.map((column) => (
            <button
              key={column.key}
              type="button"
              onClick={() => {
                if (visible[column.key] && visibleCount <= 1) return;
                onChange(column.key, !visible[column.key]);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs transition hover:bg-surface-2"
            >
              <span className="grid h-3.5 w-3.5 place-items-center rounded border-border">
                {visible[column.key] && <Check className="h-3 w-3 text-primary" />}
              </span>
              {column.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
