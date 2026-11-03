import * as React from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Hint — the one tooltip for the whole system.
 *
 * The plan bans `title` as the only hint in two places (the collapsed sidebar
 * and every icon-only control): a native `title` takes about a second to
 * appear, cannot be styled, is unreadable on a phone, and is not announced
 * consistently by screen readers.
 *
 * `HintProvider` is mounted **once** at the app root and owns the provider's
 * timing rules:
 *
 *  - `delayDuration={120}` — appears quickly (plan asks for ~100–150ms) without
 *    flashing on a mouse that merely crosses the sidebar.
 *  - `skipDelayDuration={0}` — moving from one icon to the next shows the next
 *    hint *immediately* instead of restarting the delay, which is the
 *    behaviour the plan explicitly asks for.
 *
 * `Hint` is the wrapper a control uses. When `label` is empty it renders the
 * child untouched, so a screen can pass an always-present prop without
 * branching.
 */
export function HintProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={0}>
      {children}
    </TooltipProvider>
  );
}

export interface HintProps {
  /** The hint text. When absent the child is rendered as-is. */
  label?: React.ReactNode;
  children: React.ReactNode;
  /** Which side of the control the hint opens on. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Extra class on the bubble (e.g. for a wider maxima). */
  className?: string;
  /** Disable the hint without changing the JSX tree. */
  disabled?: boolean;
}

export function Hint({
  label,
  children,
  side = "top",
  align = "center",
  className,
  disabled = false,
}: HintProps) {
  if (!label || disabled) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={8}
        className={cn("max-w-[16rem] text-start leading-5", className)}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
