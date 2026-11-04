/**
 * stock-decompose.ts — تفكيك الأرصدة إلى وحدات متعددة.
 *
 * يحوّل كمية أساسية واحدة (مثلاً: 63 حبة) إلى أجزاء تفكيكية مرتبة
 * من الأكبر إلى الأصغر (مثلاً: "5 كراتين و 3 حبات")، وذلك بناءً على
 * قائمة الوحدات المسجّلة للصنف ومعاملات التحويل الخاصة بها.
 *
 * الدالة لا تتصل بقاعدة البيانات — تعمل فقط على البيانات المحمَّلة.
 */

/** وحدة بسيطة للتفكيك — أي وحدة لها معامل تحويل إلى الأساس. */
export interface DecomposeUnit {
  /** معرّف الوحدة. */
  unit_id: string;
  /** اسم الوحدة للعرض. */
  label: string;
  /** عدد وحدات الأساس التي تعادل وحدة واحدة من هذا النوع. */
  factor_to_base: number;
}

/** جزء واحد من التفكيك: الكمية والوحدة. */
export interface DecomposedSegment {
  quantity: number;
  label: string;
  unit_id: string;
  factor: number;
}

/**
 * يفكّك كمية أساسية إلى أجزاء وحدات من الأكبر إلى الأصغر.
 *
 * @param baseQuantity - الكمية بالوحدة الأساسية (مثلاً: 63 حبة)
 * @param units        - قائمة الوحدات المتاحة مع معامل تحويلها
 * @param baseLabel    - اسم الوحدة الأساسية (مثلاً: "حبة")
 *
 * @returns مصفوفة أجزاء مرتبة من الأكبر إلى الأصغر، كل جزء يحتوي الكمية والتسمية.
 *
 * @example
 * // وحدة "كرتون" = 12 حبة
 * decomposeStock(63, [{ unit_id: "carton", label: "كرتون", factor_to_base: 12 }], "حبة")
 * // → [{ quantity: 5, label: "كرتون" }, { quantity: 3, label: "حبة" }]
 */
export function decomposeStock(
  baseQuantity: number,
  units: DecomposeUnit[],
  baseLabel: string,
): DecomposedSegment[] {
  // لا يوجد رصيد
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) {
    return [{ quantity: 0, label: baseLabel, unit_id: "", factor: 1 }];
  }

  // فلتر الوحدات الصالحة (معامل > 1) وترتيبها من الأكبر للأصغر
  const packagingUnits = units
    .filter((u) => u.factor_to_base > 1 && Number.isFinite(u.factor_to_base))
    .sort((a, b) => b.factor_to_base - a.factor_to_base);

  // لا توجد وحدات تعبئة — إرجاع الكمية الأساسية فقط
  if (packagingUnits.length === 0) {
    return [{ quantity: baseQuantity, label: baseLabel, unit_id: "", factor: 1 }];
  }

  const segments: DecomposedSegment[] = [];
  let remaining = baseQuantity;

  for (const unit of packagingUnits) {
    const count = Math.floor(remaining / unit.factor_to_base);
    if (count > 0) {
      segments.push({
        quantity: count,
        label: unit.label,
        unit_id: unit.unit_id,
        factor: unit.factor_to_base,
      });
      remaining = Math.round((remaining - count * unit.factor_to_base) * 1e6) / 1e6;
    }
  }

  // الباقي بالوحدة الأساسية
  if (remaining > 0.0001) {
    segments.push({
      quantity: Math.round(remaining * 1000) / 1000,
      label: baseLabel,
      unit_id: "",
      factor: 1,
    });
  }

  // إذا لم يبقَ شيء (كمية مقسومة بالضبط) فلا نضيف صفر
  return segments.length > 0
    ? segments
    : [{ quantity: 0, label: baseLabel, unit_id: "", factor: 1 }];
}

/**
 * يحوّل التفكيك إلى نص مقروء بالعربية أو الإنجليزية.
 *
 * @example
 * formatDecomposed(segments, "ar") // → "5 كرتون و 3 حبة"
 * formatDecomposed(segments, "en") // → "5 Carton + 3 Piece"
 */
export function formatDecomposed(
  segments: DecomposedSegment[],
  lang: "ar" | "en" = "ar",
): string {
  if (segments.length === 0) return "0";

  const separator = lang === "ar" ? " و " : " + ";
  return segments
    .filter((s) => s.quantity > 0)
    .map((s) => `${s.quantity} ${s.label}`)
    .join(separator) || "0";
}
