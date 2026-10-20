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
  "data-form-nav"?: boolean;
}

function normalizeAmount(raw: string): string {
  const ascii = raw
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".");
  const cleaned = ascii.replace(/[^0-9.]/g, "");
  const point = cleaned.indexOf(".");
  if (point < 0) return cleaned;
  return `${cleaned.slice(0, point)}.${cleaned.slice(point + 1).replace(/\./g, "")}`;
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
  "data-form-nav": formNav = false,
}: AmountInputProps) {
  const [digitStyle, setDigitStyle] = useState<DigitStyle>("latin");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatAmount(value, getDigitPreference(), decimals));
  const dirty = useRef(false);

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
      setDraft(formatAmount(value, digitStyle, decimals));
      return;
    }
    const rounded = Math.max(min, Math.round(parsed * 10 ** decimals) / 10 ** decimals);
    const next = String(rounded);
    onValueChange(next);
    setDraft(formatAmount(next, digitStyle, decimals));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={editing ? draft : formatAmount(value, digitStyle, decimals)}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      data-form-nav={formNav || undefined}
      placeholder={placeholder}
      onFocus={(event) => {
        setEditing(true);
        dirty.current = false;
        setDraft(normalizeAmount(value));
        event.currentTarget.select();
      }}
      onChange={(event) => {
        dirty.current = true;
        const next = normalizeAmount(event.target.value);
        setDraft(next);
        onValueChange(next);
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
        "min-w-0 [unicode-bidi:plaintext] text-end font-mono tabular-nums",
        invalid ? "border-destructive text-destructive" : "",
        className,
      )}
    />
  );
}
