import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * CloseButton — the one close affordance for every overlay in the system.
 *
 * Before this component each overlay invented its own close control: a bare `X`,
 * a full-width "إغلاق" row, a text link. They were also placed with
 * `left-4`/`right-4` classes that do not follow the writing direction, so an
 * Arabic panel could show its close button on the "wrong" side.
 *
 * This component owns the *appearance* and the *direction-aware placement* of
 * the control that closes a Dialog, Sheet, Drawer or panel. It does **not**
 * own the closing behaviour: it renders a real button and forwards the handler,
 * so the caller keeps using Radix's `DialogClose asChild` (or its own state
 * setter) and nothing about Esc, focus restoration or click-outside changes.
 *
 * Placement is written with logical properties (`start-*` / `end-*`), so the
 * control mirrors automatically in RTL — no `rtl:`/`ltr:` pairs to keep in
 * sync.
 *
 * @example inside a Radix overlay
 * ```tsx
 * <DialogPrimitive.Close asChild>
 *   <CloseButton label="إغلاق" />
 * </DialogPrimitive.Close>
 * ```
 */
export interface CloseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Defaults to Arabic "إغلاق" — pass a translated string. */
  label?: string;
  /** `floating` pins to the overlay corner; `inline` flows with the content. */
  variant?: "floating" | "inline";
  size?: "sm" | "md";
  /** Render the label next to the icon (used in headers). */
  showLabel?: boolean;
}

export const CloseButton = React.forwardRef<HTMLButtonElement, CloseButtonProps>(
  (
    {
      label = "إغلاق",
      variant = "floating",
      size = "sm",
      showLabel = false,
      className,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isFloating = variant === "floating";

    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          // Shared visual treatment: neutral surface, rounded, visible focus.
          "group inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent bg-surface-2/90 text-muted-foreground",
          "transition-[color,background-color,border-color,transform] duration-200",
          "hover:bg-surface-3 hover:text-foreground active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          size === "sm" ? "h-8 w-8" : "h-10 w-10",
          showLabel && "w-auto px-3",
          // Direction-aware corner placement with a comfortable touch target.
          isFloating &&
            cn(
              "absolute z-50",
              size === "sm" ? "top-4 end-4" : "top-3 end-3",
              // Never below 44px of touch area on a phone (plan §3.2).
              "max-md:h-11 max-md:w-11",
              showLabel && "max-md:w-auto",
            ),
          className,
        )}
        {...props}
      >
        <X className={cn("shrink-0", size === "sm" ? "h-4 w-4" : "h-5 w-5")} aria-hidden />
        {showLabel ? <span className="text-xs font-semibold">{label}</span> : null}
        {/* Visually hidden name for screen readers when the label is not shown. */}
        {!showLabel ? <span className="sr-only">{label}</span> : null}
      </button>
    );
  },
);

CloseButton.displayName = "CloseButton";
