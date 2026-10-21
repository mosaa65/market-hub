import { useEffect, useRef, useState } from "react";
import { getDigitPreference, toSystemDigits, type DigitStyle } from "@/lib/format-preferences";
import { cn } from "@/lib/utils";

export interface AmountInputProps {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  min?: number;
  decimals?: number;
  showLabel?: boolean;
  dir?: "auto" | "rtl" | "ltr";
  "data-form-nav"?: boolean;
}

function normalizeAmount(raw: string): string {
  const ascii = raw
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".");
  const cleaned = ascii.replace(/[^0-9.-]/g, "");
  const signed = cleaned.startsWith("-")
    ? `-${cleaned.slice(1).replace(/-/g, "")}`
    : cleaned.replace(/-/g, "");
  const point = signed.indexOf(".");
  if (point < 0) return signed;
  return `${signed.slice(0, point)}.${signed.slice(point + 1).replace(/\./g, "")}`;
}

function formatAmount(value: string, digitStyle: DigitStyle, decimals: number): string {
  if (!value) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const formatted = number.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
  return toSystemDigits(formatted, digitStyle);
}

function formatAmountDraft(value: string, digitStyle: DigitStyle): string {
  const normalized = normalizeAmount(value);
  if (!normalized || normalized === "-") return normalized;
  const [integer, ...fraction] = normalized.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = fraction.length ? `${grouped}.${fraction.join("")}` : grouped;
  return toSystemDigits(formatted, digitStyle);
}

function caretAfterDigits(value: string, digitCount: number, afterDecimal: boolean): number {
  if (digitCount === 0 && !afterDecimal) return 0;
  let seenDigits = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/[0-9٠-٩۰-۹]/.test(value[index])) seenDigits += 1;
    if (seenDigits >= digitCount && (!afterDecimal || value[index] === ".")) return index + 1;
  }
  return value.length;
}

export function AmountInput({
  value,
  onValueChange,
  label,
  placeholder,
  className,
  disabled = false,
  invalid = false,
  min = 0,
  decimals = 2,
  showLabel = false,
  dir = "auto",
  "data-form-nav": formNav = false,
}: AmountInputProps) {
  const [digitStyle, setDigitStyle] = useState<DigitStyle>("latin");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatAmount(value, getDigitPreference(), decimals));
  const dirty = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const syncPreference = () => setDigitStyle(getDigitPreference());
    syncPreference();
    window.addEventListener("vortex_digit_preference_changed", syncPreference);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener("vortex_digit_preference_changed", syncPreference);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  useEffect(() => {
    if (!editing) setDraft(formatAmount(value, digitStyle, decimals));
  }, [value, digitStyle, decimals, editing]);

  function commit(raw: string) {
    const normalized = normalizeAmount(raw);
    if (!normalized) {
      onValueChange("");
      setDraft("");
      return;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      onValueChange(value);
      setDraft(formatAmount(value, digitStyle, decimals));
      return;
    }
    const rounded = Math.max(min, Math.round(parsed * 10 ** decimals) / 10 ** decimals);
    const next = String(rounded);
    onValueChange(next);
    setDraft(formatAmount(next, digitStyle, decimals));
  }

  const input = (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      dir={dir}
      value={editing ? draft : formatAmount(value, digitStyle, decimals)}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      data-form-nav={formNav || undefined}
      placeholder={placeholder}
      onFocus={(event) => {
        setEditing(true);
        dirty.current = false;
        setDraft(formatAmountDraft(value, digitStyle));
        event.currentTarget.select();
      }}
      onChange={(event) => {
        dirty.current = true;
        const cursor = event.target.selectionStart ?? event.target.value.length;
        const prefix = normalizeAmount(event.target.value.slice(0, cursor));
        const next = normalizeAmount(event.target.value);
        const formatted = formatAmountDraft(next, digitStyle);
        setDraft(formatted);
        const digitCount = (prefix.match(/[0-9٠-٩۰-۹]/g) ?? []).length;
        const afterDecimal = prefix.includes(".");
        requestAnimationFrame(() => {
          const input = inputRef.current;
          if (!input) return;
          const caret = caretAfterDigits(formatted, digitCount, afterDecimal);
          input.setSelectionRange(caret, caret);
        });
        if (next === "") {
          onValueChange("");
          return;
        }
        const parsed = Number(next);
        if (Number.isFinite(parsed) && parsed >= min) onValueChange(next);
      }}
      onBlur={(event) => {
        if (dirty.current) commit(event.target.value);
        else setDraft(formatAmount(value, digitStyle, decimals));
        dirty.current = false;
        setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (dirty.current) commit(event.currentTarget.value);
          else setDraft(formatAmount(value, digitStyle, decimals));
          dirty.current = false;
          setEditing(false);
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "min-w-0 [unicode-bidi:plaintext] font-mono tabular-nums",
        dir === "rtl" ? "text-start" : "text-end",
        invalid ? "border-destructive text-destructive" : "",
        className,
      )}
    />
  );

  if (!showLabel) return input;

  return (
    <label className="flex min-w-0 flex-col gap-1 text-start">
      <span className="truncate text-[10px] font-semibold leading-none text-muted-foreground sm:text-[11px]">
        {label}
      </span>
      {input}
    </label>
  );
}
