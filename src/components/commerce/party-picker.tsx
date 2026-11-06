import { useMemo, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  ShoppingBag,
  Sparkles,
  Truck,
  UserRound,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { money } from "@/lib/format";

export type PartyOption = {
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

/* ------------------------------------------------------------------ */
/* أفاتار دائري معبّر: حرف أول من الاسم + لون ثابت مشتق من الاسم        */
/* ------------------------------------------------------------------ */

/** لوحة ألوان جميلة وثابتة — نفس الاسم يعطي نفس اللون دائماً. */
const AVATAR_PALETTE = [
  "from-sky-500/90 to-blue-600/90",
  "from-emerald-500/90 to-teal-600/90",
  "from-violet-500/90 to-purple-600/90",
  "from-amber-500/90 to-orange-600/90",
  "from-rose-500/90 to-pink-600/90",
  "from-cyan-500/90 to-sky-600/90",
  "from-fuchsia-500/90 to-violet-600/90",
  "from-lime-500/90 to-green-600/90",
] as const;

function nameColorClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function nameInitial(name: string): string {
  const trimmed = (name || "").trim();
  return trimmed ? trimmed[0] : "؟";
}

/** شارة الرصيد المُحسّنة: أيقونة محفظة + تدرّج لوني معبّر عن حالة الحساب. */
function BalanceChip({ balance, lang }: { balance: number; lang: string }) {
  const positive = balance > 0;
  const negative = balance < 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums [unicode-bidi:isolate] ${
        positive
          ? "border-amber-400/30 bg-gradient-to-l from-amber-500/15 to-amber-400/5 text-amber-700 dark:text-amber-300"
          : negative
            ? "border-emerald-400/30 bg-gradient-to-l from-emerald-500/15 to-emerald-400/5 text-emerald-700 dark:text-emerald-300"
            : "border-border/70 bg-muted/60 text-muted-foreground"
      }`}
      title={lang === "ar" ? "رصيد الحساب" : "Account balance"}
    >
      <Wallet className="size-3 shrink-0 opacity-70" />
      {money(balance)}
    </span>
  );
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

  /**
   * The seeded system party (عميل نقدي / مورد نقدي) is pinned to the TOP of the
   * list and rendered as its own card instead of as one more customer row.
   *
   * It is not a customer in the same sense as the rest — it is the "no name"
   * party every counter sale is booked to, so it must be found first and never
   * be mistaken for someone's account. Pinning it also means the operator does
   * not have to search for a specific name to get the default.
   */
  const { pinned, regular } = useMemo(() => {
    const pinnedOptions = options.filter((option) => option.is_system);
    const rest = options.filter((option) => !option.is_system);
    return { pinned: pinnedOptions, regular: rest };
  }, [options]);
  const isPinnedSelected = Boolean(selected?.is_system);

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
          <span
            className={`grid size-7 shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-extrabold text-white shadow-sm ring-1 ring-black/5 ${
              selected
                ? `${nameColorClass(selected.name)} bg-gradient-to-br`
                : "bg-primary/10 text-primary"
            }`}
          >
            {selected ? nameInitial(selected.name) : <PartyIcon className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="block truncate text-xs font-semibold text-foreground">
                {selected?.name ?? fallbackLabel}
              </span>
              {isPinnedSelected && (
                <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 text-[9px] font-bold text-primary">
                  {isArabic ? "افتراضي" : "Default"}
                </span>
              )}
            </span>
            {selected?.balance != null && (
              <span className="mt-0.5 block w-fit">
                <BalanceChip balance={Number(selected.balance)} lang={lang} />
              </span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground/70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={isArabic ? "end" : "start"}
        sideOffset={5}
        /*
         * `collisionPadding` و`sticky="always"` يمنحان Radix مساحة فعلية
         * للاختيار: بلا هامش كان يلتصق بحافة الشاشة، وبلا `sticky` كان
         * يتمرّر مع الصفحة فيبتعد عن زره. هامش 12px للفوتر والحدود.
         */
        collisionPadding={{ top: 12, bottom: 12, left: 12, right: 12 }}
        sticky="always"
        avoidCollisions
        className="max-h-[min(28rem,70dvh)] w-[min(360px,calc(100vw-1rem))] overflow-hidden rounded-2xl border-border/70 bg-popover p-0 shadow-2xl"
      >
        {/* الهدر: تدرّج أنيق بلون الـ primary يتلاشى تدريجياً بعد الهدر — بلا رمادي */}
        <div className="flex items-center justify-between border-b border-border/70 bg-gradient-to-b from-primary/[0.12] via-primary/[0.05] to-transparent px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/15 bg-primary/10 text-primary">
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
        {pinned.length > 0 && (
          <div className="border-b border-border/70 bg-gradient-to-b from-primary/[0.09] to-transparent p-1.5">
            <div className="mb-1 flex items-center gap-1 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary/80">
              <Sparkles className="size-3" />
              {isArabic ? "الجهة الافتراضية" : "Default party"}
            </div>
            {pinned.map((option) => {
              const active = value === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => select(option.id)}
                  className={`flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-start transition ${active ? "border-primary/40 bg-primary/10" : "border-transparent hover:border-primary/20 hover:bg-primary/[0.06]"}`}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                    <ShoppingBag className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-foreground">
                      {option.name}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {isArabic
                        ? "بيع فوري نقدي — لا يُسجَّل عليه دين"
                        : "Walk-in cash sale — cannot carry debt"}
                    </span>
                  </span>
                  <Check
                    className={`size-4 shrink-0 text-primary ${active ? "opacity-100" : "opacity-0"}`}
                  />
                </button>
              );
            })}
          </div>
        )}
        <Command dir={isArabic ? "rtl" : "ltr"} className="rounded-none bg-transparent">
          <CommandInput
            placeholder={isArabic ? "ابحث بالاسم أو الهاتف..." : "Search name or phone..."}
            className="h-11 text-xs"
          />
          <CommandList className="max-h-[min(22rem,48dvh)] p-1.5">
            <CommandEmpty className="py-8 text-xs text-muted-foreground">
              {isArabic ? "لا توجد نتائج مطابقة" : "No matching results"}
            </CommandEmpty>
            {showEmptyItem && (
              <>
                <CommandItem
                  value={`__empty__ ${emptyLabel}`}
                  onSelect={() => select("")}
                  className={`mb-1 min-h-11 gap-2.5 rounded-xl px-2.5 py-2 ring-1 ring-inset ${!value ? "bg-primary/[0.09] text-primary ring-primary/25" : "ring-transparent"}`}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{emptyLabel}</span>
                  <Check className={`size-4 ${value ? "opacity-0" : "opacity-100"}`} />
                </CommandItem>
                <CommandSeparator className="bg-border/50" />
              </>
            )}
            {regular.map((option) => {
              const active = value === option.id;
              const balance = option.balance != null ? Number(option.balance) : null;
              return (
                <CommandItem
                  key={option.id}
                  value={`${option.name} ${option.phone ?? ""} ${option.balance ?? ""}`}
                  onSelect={() => select(option.id)}
                  className={`min-h-14 items-start gap-2.5 rounded-xl px-2.5 py-2 ring-1 ring-inset transition-colors ${active ? "bg-primary/[0.09] text-foreground ring-primary/25 shadow-[0_1px_4px_oklch(0_0_0/0.05)]" : "ring-transparent hover:bg-primary/[0.04]"}`}
                >
                  {/* أفاتار دائري معبّر بلون مشتق من اسم العميل */}
                  <span
                    className={`mt-0.5 grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br text-[11px] font-extrabold text-white shadow-sm ring-1 ring-black/5 ${nameColorClass(option.name)}`}
                    aria-hidden="true"
                  >
                    {nameInitial(option.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-xs font-semibold ${active ? "text-primary" : ""}`}
                    >
                      {option.name}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">
                        {option.phone || (isArabic ? "بدون هاتف" : "No phone")}
                      </span>
                      {balance != null && (
                        <>
                          {/* فاصل عمودي أنيق بين الهاتف والرصيد */}
                          <span
                            className="h-2.5 w-px shrink-0 rounded bg-border/80"
                            aria-hidden="true"
                          />
                          <BalanceChip balance={balance} lang={lang} />
                        </>
                      )}
                    </span>
                  </span>
                  <Check
                    className={`mt-1 size-4 shrink-0 text-primary ${active ? "opacity-100" : "opacity-0"}`}
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
