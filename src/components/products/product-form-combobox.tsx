import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FormComboboxOption {
  id: string;
  label: string;
  sublabel?: string | null;
  badge?: string | null;
  disabled?: boolean;
}

export interface FormComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: FormComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  title: string;
  icon?: React.ReactNode;
  clearable?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-describedby"?: string;
  lang?: string;
}

export function FormCombobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  title,
  icon,
  clearable = true,
  clearLabel,
  disabled = false,
  className,
  id,
  "aria-describedby": ariaDescribedBy,
  lang = "ar",
}: FormComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const isArabic = lang === "ar";

  const selected = React.useMemo(() => options.find((opt) => opt.id === value), [options, value]);

  const fallbackPlaceholder = placeholder ?? (isArabic ? "اختر..." : "Select...");
  const fallbackClearLabel = clearLabel ?? (isArabic ? "بدون تحديد" : "None");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          aria-describedby={ariaDescribedBy}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={title}
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 min-w-0 w-full justify-between gap-2 rounded-2xl border-border/70 bg-background/75 px-2.5 text-start shadow-xs transition hover:border-primary/35 hover:bg-primary/[0.035]",
            className,
          )}
        >
          {icon && (
            <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "block truncate text-xs font-semibold",
                  selected ? "text-foreground" : "text-muted-foreground font-normal",
                )}
              >
                {selected?.label ?? fallbackPlaceholder}
              </span>
              {selected?.badge && (
                <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 text-[9px] font-bold text-primary">
                  {selected.badge}
                </span>
              )}
            </span>
            {selected?.sublabel && (
              <span className="block truncate text-[10px] font-normal text-muted-foreground">
                {selected.sublabel}
              </span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground/70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={isArabic ? "end" : "start"}
        sideOffset={5}
        className="w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border-border/70 bg-popover p-0 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/70 bg-primary/[0.035] px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                {icon}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-foreground">{title}</span>
              <span className="block text-[11px] text-muted-foreground">
                {isArabic ? "اختر من القائمة أو ابحث" : "Select or search"}
              </span>
            </span>
          </div>
          <span className="shrink-0 rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {options.length}
          </span>
        </div>
        <Command dir={isArabic ? "rtl" : "ltr"} className="rounded-none bg-transparent">
          <CommandInput
            placeholder={
              searchPlaceholder ?? (isArabic ? `ابحث في ${title}...` : `Search ${title}...`)
            }
            className="h-10 text-xs"
          />
          <CommandList className="max-h-[min(18rem,50dvh)] p-1.5">
            <CommandEmpty className="py-6 text-xs text-muted-foreground text-center">
              {emptyText ?? (isArabic ? "لا توجد نتائج مطابقة" : "No matching results")}
            </CommandEmpty>
            {clearable && (
              <CommandItem
                value={`__empty__ ${fallbackClearLabel}`}
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
                className={cn(
                  "mb-1 min-h-10 gap-2.5 rounded-xl px-2.5 py-2 cursor-pointer",
                  !value ? "bg-primary/[0.07] text-primary" : "",
                )}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <X className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {fallbackClearLabel}
                </span>
                <Check
                  className={cn(
                    "size-4 shrink-0 text-primary",
                    !value ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
            )}
            {options.map((option) => {
              const isSelected = value === option.id;
              return (
                <CommandItem
                  key={option.id}
                  value={`${option.label} ${option.sublabel ?? ""} ${option.badge ?? ""}`}
                  disabled={option.disabled}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "min-h-11 items-center gap-2.5 rounded-xl px-2.5 py-2 cursor-pointer",
                    isSelected ? "bg-primary/[0.07] text-foreground font-medium" : "",
                  )}
                >
                  {icon && (
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-lg",
                        isSelected
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/70 text-muted-foreground",
                      )}
                    >
                      {icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate text-xs font-semibold">{option.label}</span>
                      {option.badge && (
                        <span className="shrink-0 rounded-full border border-border/70 bg-muted/60 px-1.5 py-0.2 text-[9px] font-medium text-muted-foreground">
                          {option.badge}
                        </span>
                      )}
                    </span>
                    {option.sublabel && (
                      <span className="block truncate text-[10px] text-muted-foreground font-normal">
                        {option.sublabel}
                      </span>
                    )}
                  </span>
                  <Check
                    className={cn(
                      "size-4 shrink-0 text-primary",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
