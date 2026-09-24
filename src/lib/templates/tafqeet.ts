/**
 * Tafqeet Utility: Convert monetary numbers to Arabic words
 * (مثال: 700.00 -> فقط سبعمائة دولار أمريكي لا غير)
 */

const ones = [
  "",
  "واحد",
  "اثنان",
  "ثلاثة",
  "أربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "ثمانية",
  "تسعة",
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
];

const tens = [
  "",
  "",
  "عشرون",
  "ثلاثون",
  "أربعون",
  "خمسون",
  "ستون",
  "سبعون",
  "ثمانون",
  "تسعون",
];

const hundreds = [
  "",
  "مائة",
  "مائتان",
  "ثلاثمائة",
  "أربعمائة",
  "خمسمائة",
  "ستمائة",
  "سبعمائة",
  "ثمانمائة",
  "تسعمائة",
];

function convertGroup(n: number): string {
  if (n === 0) return "";
  const h = Math.floor(n / 100);
  const remainder = n % 100;
  let result = hundreds[h];

  if (remainder > 0) {
    if (result) result += " و";
    if (remainder < 20) {
      result += ones[remainder];
    } else {
      const t = Math.floor(remainder / 10);
      const o = remainder % 10;
      if (o > 0) {
        result += `${ones[o]} و${tens[t]}`;
      } else {
        result += tens[t];
      }
    }
  }

  return result;
}

export function numberToArabicWords(amount: number, currency = ""): string {
  if (isNaN(amount) || amount === 0) return "فقط صفر لا غير";

  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  const integerPart = Math.floor(absAmount);
  const decimalPart = Math.round((absAmount - integerPart) * 100);

  const billions = Math.floor(integerPart / 1_000_000_000);
  const millions = Math.floor((integerPart % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((integerPart % 1_000_000) / 1000);
  const onesGroup = integerPart % 1000;

  const parts: string[] = [];

  if (billions > 0) {
    if (billions === 1) parts.push("مليار");
    else if (billions === 2) parts.push("ملياران");
    else if (billions >= 3 && billions <= 10) parts.push(`${convertGroup(billions)} مليارات`);
    else parts.push(`${convertGroup(billions)} مليار`);
  }

  if (millions > 0) {
    if (millions === 1) parts.push("مليون");
    else if (millions === 2) parts.push("مليونان");
    else if (millions >= 3 && millions <= 10) parts.push(`${convertGroup(millions)} ملايين`);
    else parts.push(`${convertGroup(millions)} مليون`);
  }

  if (thousands > 0) {
    if (thousands === 1) parts.push("ألف");
    else if (thousands === 2) parts.push("ألفان");
    else if (thousands >= 3 && thousands <= 10) parts.push(`${convertGroup(thousands)} آلاف`);
    else parts.push(`${convertGroup(thousands)} ألف`);
  }

  if (onesGroup > 0) {
    parts.push(convertGroup(onesGroup));
  }

  let text = parts.join(" و");

  // Determine Currency Labels
  let mainCurrencyName = "ريال";
  let subCurrencyName = "فلس";

  const curUpper = (currency || "").toUpperCase().trim();
  if (curUpper.includes("USD") || curUpper.includes("دولار") || curUpper === "$") {
    mainCurrencyName = "دولار أمريكي";
    subCurrencyName = "سنت";
  } else if (curUpper.includes("SAR") || curUpper.includes("سعودي")) {
    mainCurrencyName = "ريال سعودي";
    subCurrencyName = "هللة";
  } else if (curUpper.includes("YER") || curUpper.includes("يمني") || curUpper.includes("﷼")) {
    mainCurrencyName = "ريال يمني";
    subCurrencyName = "فلس";
  } else if (curUpper.includes("EUR") || curUpper.includes("يورو")) {
    mainCurrencyName = "يورو";
    subCurrencyName = "سنت";
  } else if (currency && currency.trim().length > 0) {
    mainCurrencyName = currency;
  }

  if (text) {
    text = `${text} ${mainCurrencyName}`;
  }

  if (decimalPart > 0) {
    const decimalText = convertGroup(decimalPart);
    if (text) {
      text += ` و${decimalText} ${subCurrencyName}`;
    } else {
      text = `${decimalText} ${subCurrencyName}`;
    }
  }

  if (isNegative) {
    text = `سالب ${text}`;
  }

  return `فقط ${text} لا غير`;
}
