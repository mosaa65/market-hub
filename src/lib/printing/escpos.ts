/**
 * ESC/POS Command Builder — توليد أوامر ESC/POS (طبقة بيانات فقط).
 *
 * ⚠️ نطاق هذه الطبقة: **توليد البايتات** وفق مواصفة Epson ESC/POS.
 * لا تتصل بأي طابعة، ولا تعرف شيئًا عن الشبكة أو USB أو المتصفح.
 * الاتصال مسؤولية `PrintTransport` (انظر `transports.ts`).
 *
 * الفائدة العملية: أوامر ESC/POS قابلة للاختبار بالكامل بلا عتاد، لأنها
 * مجرد تسلسل بايتات معروفة. لذلك يُبنى الدعم "حقيقيًا" على مستوى التوليد،
 * ويُعلن النقل صراحةً كغير متاح في المتصفح.
 *
 * المراجع: Epson ESC/POS Command Reference (ESC @, ESC a, ESC E, GS !, GS V).
 */

/** محارف التحكم الأساسية. */
export const ESC = 0x1b;
export const GS = 0x1d;

export const CMD = {
  /** ESC @ — تهيئة الطابعة (تهيئة كاملة). */
  INIT: [ESC, 0x40],
  /** ESC a n — محاذاة: 0 يسار، 1 وسط، 2 يمين. */
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  /** ESC E n — عريض (Bold). */
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  /** ESC d n — تغذية أسطر. */
  FEED: (n = 1) => [ESC, 0x64, n],
  /** ESC J n — تغذية نقطية (أدق للفواصل). */
  FEED_DOTS: (n = 1) => [ESC, 0x4a, n],
  /** GS V m — قص الورق. */
  CUT_FULL: [GS, 0x56, 0x00],
  CUT_PARTIAL: [GS, 0x56, 0x01],
} as const;

export type EscPosAlignment = "left" | "center" | "right";

/** أحجام الخط: مضاعفات عرض/ارتفاع المحرف (1..8). */
export interface EscPosFontSize {
  width: number;
  height: number;
}

export const FONT_SIZE = {
  normal: { width: 1, height: 1 } as EscPosFontSize,
  double: { width: 2, height: 2 } as EscPosFontSize,
  /** عريض فعليًا عبر مضاعفة العرض فقط — شائع في الفواتير. */
  wide: { width: 2, height: 1 } as EscPosFontSize,
};

/** GS ! n — حجم المحرف: البتات العليا للعرض والسفلى للارتفاع. */
export function charSize(size: EscPosFontSize): number[] {
  const w = Math.min(8, Math.max(1, Math.round(size.width))) - 1;
  const h = Math.min(8, Math.max(1, Math.round(size.height))) - 1;
  return [GS, 0x21, (w << 4) | h];
}

/** ESC a n — محاذاة. */
export function alignment(value: EscPosAlignment): number[] {
  if (value === "center") return [...CMD.ALIGN_CENTER];
  if (value === "right") return [...CMD.ALIGN_RIGHT];
  return [...CMD.ALIGN_LEFT];
}

/**
 * ترميز النص إلى بايتات.
 *
 * الطابعات الحرارية الشائعة تستخدم صفحة محارف واحدة (CP437/CP850/CP1256).
 * لا نضيف مكتبة ترميز ضخمة: نستخدم `TextEncoder` (UTF-8) افتراضيًا، ونمنح
 * المنادي القدرة على تمرير ترميز مخصص عند الحاجة (`codec`).
 */
export interface EscPosEncodeOptions {
  /** يحوّل النص إلى بايتات. الافتراضي UTF-8. */
  codec?: (text: string) => number[];
}

const utf8Encoder = (text: string): number[] => Array.from(new TextEncoder().encode(text));

/**
 * ESC t n — اختيار جدول محارف الطابعة.
 * 0 = CP437، 16 = CP1252، 22 = CP858 … إلخ (حسب الطراز).
 */
export function codeTable(index: number): number[] {
  return [ESC, 0x74, index];
}

/** ESC M n — خط الطابعة (A/B/C). */
export function selectFont(font: "A" | "B" | "C"): number[] {
  const code = font === "B" ? 0x01 : font === "C" ? 0x02 : 0x00;
  return [ESC, 0x4d, code];
}

/** مواصفة عنصر يُطبع على سطر واحد. */
export interface EscPosBlock {
  text: string;
  align?: EscPosAlignment;
  bold?: boolean;
  size?: EscPosFontSize;
}

/** فاصل نصي خفيف لا يستهلك حبرًا كثيرًا. */
export function separator(char = "-", width = 42): string {
  return char.repeat(Math.max(1, width));
}

/**
 * بناء أمر طباعة كامل من كتل نصية.
 *
 * هذا هو "القالب" الحراري لمن يريد طباعة نصية مباشرة: بلا HTML وبلا CSS.
 * كل مستند يمرّر كتلًا (عنوان، بيانات، بنود، إجمالي) — لا يعرف شيئًا عن ESC/POS.
 */
export interface EscPosDocument {
  /** عرض الورق بالأعمدة (42 لـ 80mm، 32 لـ 58mm عادةً). */
  columns?: number;
  blocks: EscPosBlock[];
  /** قص الورق في النهاية (فقط إذا كانت الطابعة تدعمه). */
  cut?: boolean;
  /** تغذية أسطر قبل القص. */
  feedBeforeCut?: number;
  encode?: EscPosEncodeOptions;
}

export function columnsForWidthMm(widthMm: number): number {
  // 80mm → 48 عمودًا عند Font A، و58mm → 32 عمودًا.
  return widthMm >= 76 ? 42 : 32;
}

/**
 * تحويل مستند نصي إلى تسلسل بايتات ESC/POS جاهز للإرسال.
 * لا يفتح أي اتصال — يُرجع `Uint8Array` فقط.
 */
export function buildEscPosBytes(doc: EscPosDocument): Uint8Array {
  const encode = doc.encode?.codec ?? utf8Encoder;
  const bytes: number[] = [];

  bytes.push(...CMD.INIT);

  for (const block of doc.blocks) {
    if (block.align) bytes.push(...alignment(block.align));
    if (block.size) bytes.push(...charSize(block.size));
    if (block.bold) bytes.push(...CMD.BOLD_ON);

    bytes.push(...encode(block.text));
    bytes.push(...CMD.FEED(1));

    if (block.bold) bytes.push(...CMD.BOLD_OFF);
    if (block.size) bytes.push(...charSize(FONT_SIZE.normal));
  }

  // إعادة المحاذاة إلى اليسار حتى لا تتسرب حالة من آخر كتلة.
  bytes.push(...alignment("left"));

  if (doc.cut) {
    bytes.push(...CMD.FEED(doc.feedBeforeCut ?? 3));
    bytes.push(...CMD.CUT_FULL);
  }

  return new Uint8Array(bytes);
}

/** تمثيل hex — يُستخدم في الاختبارات وعرض تشخيصي. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}
