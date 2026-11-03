import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * PosLabeledField — one label + one control, so the cashier row keeps a single
 * rhythm.
 *
 * The payment row used to mix three different things: `AmountInput` with its own
 * tiny label, and a note input with **no label at all** while the two fields
 * beside it had one. The result was a row whose text baseline did not line up
 * and a note box nobody could identify. Every field in the row now renders
 * through this wrapper: same label slot, same height, same surface, same focus
 * ring.
 */
export interface PosLabeledFieldProps {
  label: string;
  icon?: ReactNode;
  htmlFor?: string;
  /** Field sits on the highlighted (primary) track, e.g. amount paid. */
  emphasis?: boolean;
  className?: string;
  children: ReactNode;
}

export function PosLabeledField({
  label,
  icon,
  htmlFor,
  emphasis = false,
  className,
  children,
}: PosLabeledFieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          "flex items-center gap-1 truncate text-[10px] font-semibold leading-none sm:text-[11px]",
          emphasis ? "text-primary/90" : "text-muted-foreground",
        )}
      >
        {icon ? (
          <span className="shrink-0 opacity-80 [&_svg]:size-3" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="truncate">{label}</span>
      </label>
      {children}
    </div>
  );
}

/**
 * The single field surface used by the paid / discount / note inputs.
 * One height (`h-9`), one radius (`rounded-xl`), one border and one focus ring,
 * so an operator reading the row sees three equal fields rather than a
 * near-featureless box next to two framed ones.
 */
export const POS_FIELD_CLASS =
  "h-9 min-w-0 rounded-xl border border-border/80 bg-background px-2.5 text-xs font-semibold text-foreground outline-none transition placeholder:font-normal placeholder:text-muted-foreground/60 hover:border-border focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60";

/** Emphasis variant for the amount actually being collected. */
export const POS_FIELD_EMPHASIS_CLASS =
  "h-9 min-w-0 rounded-xl border border-primary/25 bg-primary/[0.04] px-2.5 text-xs font-semibold text-primary outline-none transition placeholder:font-normal placeholder:text-muted-foreground/60 hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20";
