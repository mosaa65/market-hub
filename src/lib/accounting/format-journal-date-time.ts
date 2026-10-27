/** Format the stored posting timestamp in Yemen local time with Arabic day periods. */
export function formatJournalDateTime(value: string | Date, lang: "ar" | "en") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-YE" : "en-GB", {
    timeZone: "Asia/Aden",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
