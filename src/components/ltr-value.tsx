/**
 * LTR isolation for numeric / serial data inside an RTL interface.
 *
 * Arabic UI stays RTL; digits, phones, emails, invoice numbers and money
 * values must read left-to-right. `dir="ltr"` alone is not enough: the value
 * is still placed by the surrounding paragraph's base direction, so a minus
 * sign or a trailing currency symbol can migrate to the wrong end.
 *
 * `dir="ltr"` on an inline element already implies `unicode-bidi: isolate`,
 * but we set it explicitly so the behaviour is identical across browsers and
 * so callers can compose it with `text-end` alignment without flipping layout.
 *
 * Rule: isolate the VALUE only — never a card or container that holds Arabic
 * prose.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Class that keeps a value LTR and isolated regardless of the page direction. */
export const ltrValueClass = "[unicode-bidi:isolate]";

export function Ltr({
  children,
  className,
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: "span" | "div" | "bdi" | "td";
}) {
  return (
    <Tag dir="ltr" className={cn(ltrValueClass, className)}>
      {children}
    </Tag>
  );
}

export default Ltr;
