"use client";

/**
 * WarehouseBadge — المستودع بوصفه حقيقة، لا حقل نموذج.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * لماذا لا يبقى قائمةً في شبكة الحقول
 * ════════════════════════════════════════════════════════════════════════════
 * البذرة تنشئ مستودعًا واحدًا (`MAIN`)، ومنشآت كثيرة لا تُضيف ثانيًا أبدًا.
 * ومع ذلك كانت الشاشات الثلاث تعرض `<select>` مفتوحًا بجانب العميل مهما كان
 * العدد. النتيجة: نصف صف مأخوذ بخيار لا يتغيّر، والعميل يضيق على نصف الصف
 * الآخر — وهذا هو «الزحام» المرئي الذي لا علاقة له بعدد الحقول الحقيقية.
 *
 * القاعدة هنا:
 *   • مستودع واحد  → نصّ فقط، بلا حقل. «تغيير» تظهر حين يكون هناك ما تُغيّره.
 *   • أكثر من واحد → يبقى قائمة، لكن مضغوطة على سطر الشارة لا في شبكة.
 *
 * والاختيار مسجَّل في المستقبل: المستودع يُختار مرة، فيكفي أن تراه بلون محايد
 * لتتأكد أنك في المكان الصحيح، لا أن تختاره في كل فاتورة.
 */

import { Warehouse } from "lucide-react";

import { cn } from "@/lib/utils";
import { MillingSelect } from "@/components/milling/milling-ui";

export interface WarehouseOption {
  id: string;
  nameAr: string;
  isDefault?: boolean;
}

export interface WarehouseBadgeProps {
  value: string;
  onChange: (id: string) => void;
  warehouses: readonly WarehouseOption[];
  /** يُظهر خيارًا فارغًا «اختر المستودع» حين لا مستودع محددًا بعد. */
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function WarehouseBadge({
  value,
  onChange,
  warehouses,
  required = false,
  disabled = false,
  className,
}: WarehouseBadgeProps) {
  const selected = warehouses.find((w) => w.id === value) ?? null;
  const single = warehouses.length === 1;
  const missing = required && !value;

  return (
    <div
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1",
        missing
          ? "border-amber-500/50 bg-amber-500/[0.06]"
          : "border-border/70 bg-surface/70",
        className,
      )}
      title={missing ? "اختر المستودع قبل الحفظ" : undefined}
    >
      <Warehouse
        className={cn(
          "size-3.5 shrink-0",
          missing ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      />

      {single ? (
        // مستودع واحد: اسمه نصًا، والتحكم يظهر فقط إن كان هناك ما تُغيّره.
        <span className="truncate text-[11px] font-bold text-foreground">
          {selected?.nameAr ?? warehouses[0]?.nameAr ?? "—"}
        </span>
      ) : (
        <MillingSelect
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label="المستودع"
          className="min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-[11px] font-bold shadow-none focus:ring-0"
        >
          {!value ? <option value="">اختر المستودع…</option> : null}
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.nameAr}
              {warehouse.isDefault ? " (افتراضي)" : ""}
            </option>
          ))}
        </MillingSelect>
      )}
    </div>
  );
}
