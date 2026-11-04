export function formatPrintedDateTime(value: string | Date): string {
  if (!value) return "";

  if (typeof value === "string") {
    const normalized = value
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
      .replace(/،/g, " ")
      .trim();

    // Check if it already matches DD/MM/YYYY or YYYY/MM/DD with optional time
    const ymdMatch = normalized.match(
      /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(ص|م|AM|PM)?)?$/i,
    );
    if (ymdMatch) {
      const [, year, month, day, rawHour = "00", minute = "00", period = ""] = ymdMatch;
      let hour = Number(rawHour);
      if (/^(م|PM)$/i.test(period) && hour < 12) hour += 12;
      if (/^(ص|AM)$/i.test(period) && hour === 12) hour = 0;
      return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year} ${String(hour).padStart(2, "0")}:${minute}`;
    }

    const dmyMatch = normalized.match(
      /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(ص|م|AM|PM)?)?$/i,
    );
    if (dmyMatch) {
      const [, day, month, year, rawHour = "00", minute = "00", period = ""] = dmyMatch;
      let hour = Number(rawHour);
      if (/^(م|PM)$/i.test(period) && hour < 12) hour += 12;
      if (/^(ص|AM)$/i.test(period) && hour === 12) hour = 0;
      return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year} ${String(hour).padStart(2, "0")}:${minute}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Aden",
    numberingSystem: "latn",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}
