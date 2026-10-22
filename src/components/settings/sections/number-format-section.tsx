import { Hash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { getDigitPreference, setDigitPreference, type DigitStyle } from "@/lib/format-preferences";
import { getCompanyCurrencySymbol } from "@/lib/format";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export function NumberFormatSection() {
  const { lang } = useI18n();
  const [digitStyle, setDigitStyle] = useState<DigitStyle>("latin");
  const isAr = lang === "ar";
  const currencySymbol = getCompanyCurrencySymbol();
  const latinAmount = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(1250);
  const arabicAmount = new Intl.NumberFormat("ar-YE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(1250);
  const dateOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const latinDate = new Intl.DateTimeFormat("en-CA", dateOptions).format(new Date());
  const arabicDate = new Intl.DateTimeFormat("ar-YE", dateOptions).format(new Date());

  useEffect(() => setDigitStyle(getDigitPreference()), []);

  const selectStyle = (style: DigitStyle) => {
    setDigitStyle(style);
    setDigitPreference(style);
    toast.success(isAr ? "تم حفظ تفضيل نظام الأرقام" : "Number system preference updated");
  };

  return (
    <Card className="rounded-3xl border-border/80 shadow-xs">
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <span className="p-2 rounded-xl bg-primary/10 text-primary">
            <Hash className="h-5 w-5" />
          </span>
          {isAr ? "نظام الأرقام والترقيم الموحد" : "Numbering & Digit System"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isAr
            ? "حدد النمط الرقمي المعتمد في كامل النظام والفواتير والتقارير."
            : "Select the standard digit style used across the system, invoices, and reports."}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(
            [
              [
                "latin",
                "أرقام لاتينية / إنجليزية",
                "0 - 9",
                `معاينة: ${latinAmount} ${currencySymbol} • ${latinDate}`,
              ],
              [
                "arabic",
                "أرقام عربية مشرقية",
                "٠ - ٩",
                `معاينة: ${arabicAmount} ${currencySymbol} • ${arabicDate}`,
              ],
            ] as const
          ).map(([style, label, sample, preview]) => (
            <button
              key={style}
              type="button"
              onClick={() => selectStyle(style)}
              className={`text-start rounded-2xl border p-3.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${digitStyle === style ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40 bg-surface"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted">{sample}</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">{preview}</div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
