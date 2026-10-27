import { useState } from "react";
import { Check, ChevronsUpDown, Truck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { money } from "@/lib/format";

type PartyOption = {
  id: string;
  name: string;
  is_system?: boolean | null;
  phone?: string | null;
  balance?: number | null;
};

interface PartyPickerProps {
  options: PartyOption[];
  value: string;
  onChange: (value: string) => void;
  lang: string;
  label: string;
  emptyLabel?: string;
  className?: string;
  kind: "customer" | "supplier";
}

export function PartyPicker({
  options,
  value,
  onChange,
  lang,
  label,
  emptyLabel,
  className = "",
  kind,
}: PartyPickerProps) {
  const [open, setOpen] = useState(false);
  const isArabic = lang === "ar";
  const selected = options.find((option) => option.id === value);
  const fallbackLabel = emptyLabel ?? (isArabic ? "اختر جهة" : "Select party");
  const PartyIcon = kind === "customer" ? UserRound : Truck;
  // A system cash party is the explicit counterpart for the blank/walk-in
  // choice. Showing both creates two entries that perform the same role.
  const showEmptyItem = Boolean(emptyLabel && !options.some((option) => option.is_system));

  const select = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          className={`h-10 min-w-0 w-full justify-between gap-2 rounded-2xl border-border/70 bg-background/75 px-2 text-start shadow-sm transition hover:border-primary/35 hover:bg-primary/[0.035] ${className}`}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <PartyIcon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-foreground">
              {selected?.name ?? fallbackLabel}
            </span>
            {selected?.balance != null && (
              <span className="block truncate text-[10px] font-normal text-muted-foreground">
                {isArabic ? "الرصيد" : "Balance"}: {money(Number(selected.balance))}
              </span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground/70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={isArabic ? "end" : "start"}
        sideOffset={5}
        className="w-[min(360px,calc(100vw-1rem))] overflow-hidden rounded-2xl border-border/70 bg-popover p-0 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/70 bg-primary/[0.035] px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
              <PartyIcon className="size-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-foreground">{label}</span>
              <span className="block text-[11px] text-muted-foreground">
                {isArabic ? "اختر من القائمة أو ابحث" : "Select or search"}
              </span>
            </span>
          </div>
          <span className="shrink-0 rounded-full border border-border/70 bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground">
            {options.length}
          </span>
        </div>
        <Command dir={isArabic ? "rtl" : "ltr"} className="rounded-none bg-transparent">
          <CommandInput
            placeholder={isArabic ? "ابحث بالاسم أو الهاتف..." : "Search name or phone..."}
            className="h-11 text-xs"
          />
          <CommandList className="max-h-[min(22rem,55dvh)] p-1.5">
            <CommandEmpty className="py-8 text-xs text-muted-foreground">
              {isArabic ? "لا توجد نتائج مطابقة" : "No matching results"}
            </CommandEmpty>
            {showEmptyItem && (
              <CommandItem
                value={`__empty__ ${emptyLabel}`}
                onSelect={() => select("")}
                className={`mb-1 min-h-11 gap-2.5 rounded-xl px-2.5 py-2 ${!value ? "bg-primary/[0.07] text-primary" : ""}`}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <UserRound className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{emptyLabel}</span>
                <Check className={`size-4 ${value ? "opacity-0" : "opacity-100"}`} />
              </CommandItem>
            )}
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={`${option.name} ${option.phone ?? ""} ${option.balance ?? ""}`}
                onSelect={() => select(option.id)}
                className={`min-h-14 items-start gap-2.5 rounded-xl px-2.5 py-2 ${value === option.id ? "bg-primary/[0.07] text-foreground" : ""}`}
              >
                <span
                  className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${value === option.id ? "bg-primary/10 text-primary" : "bg-muted/70 text-muted-foreground"}`}
                >
                  <PartyIcon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{option.name}</span>
                  <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span className="truncate">
                      {option.phone || (isArabic ? "بدون هاتف" : "No phone")}
                    </span>
                    {option.balance != null && (
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 font-mono [unicode-bidi:isolate] ${Number(option.balance) > 0 ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" : Number(option.balance) < 0 ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border/70 bg-muted/60 text-muted-foreground"}`}
                      >
                        {money(Number(option.balance))}
                      </span>
                    )}
                  </span>
                </span>
                <Check
                  className={`mt-1 size-4 shrink-0 text-primary ${value === option.id ? "opacity-100" : "opacity-0"}`}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
