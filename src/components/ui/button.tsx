import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Button — Market Hub Design System.
 *
 * Single source of truth for every clickable action in the app.
 * Existing variant names (`default`, `destructive`) are kept as aliases so that
 * unmigrated pages continue to work while pages migrate incrementally.
 *
 * Sizes map to the control-height scale so a Button and an Input on the same row
 * are always the same height.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "rounded-[10px] text-sm font-medium cursor-pointer select-none",
    "transition-[background-color,border-color,color,box-shadow,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
    "active:scale-[0.98]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[var(--shadow-control)] hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[var(--shadow-control)] hover:bg-secondary/80",
        outline:
          "border border-border bg-surface text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        danger:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-control)] hover:bg-destructive/90",
        success:
          "bg-success text-success-foreground shadow-[var(--shadow-control)] hover:bg-success/90",
        link: "text-primary underline-offset-4 hover:underline",
        /** @deprecated alias of `primary` — kept for existing call sites */
        default:
          "bg-primary text-primary-foreground shadow-[var(--shadow-control)] hover:bg-primary/90",
        /** @deprecated alias of `danger` — kept for existing call sites */
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-control)] hover:bg-destructive/90",
      },
      size: {
        xs: "h-7 gap-1.5 rounded-lg px-2.5 text-xs",
        sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-6 text-sm",
        icon: "h-9 w-9 p-0",
        "icon-sm": "h-8 w-8 rounded-lg p-0",
        "icon-lg": "h-11 w-11 p-0",
        /** @deprecated alias of `md` */
        default: "h-9 px-4 text-sm",
      },
      /** Full-width on mobile, intrinsic on larger screens. */
      block: {
        true: "w-full sm:w-auto",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      block: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner, disables the button and marks it `aria-busy`. */
  loading?: boolean;
  /** Convenience leading icon rendered before children. */
  icon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      block,
      asChild = false,
      loading = false,
      icon,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, block, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    const isIconOnly = size === "icon" || size === "icon-sm" || size === "icon-lg";

    return (
      <button
        className={cn(buttonVariants({ variant, size, block, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
        {isIconOnly ? null : children}
        {isIconOnly && !icon && !loading ? children : null}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
