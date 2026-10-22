import { useEffect, useState } from "react";

import { breakpoints, type Breakpoint } from "./tokens";

/**
 * Reactive breakpoint hook — the JS counterpart to Tailwind's `sm:`/`md:` prefixes.
 *
 * Use it only when a layout decision cannot be expressed in CSS (e.g. swapping a
 * `<table>` for a card list, or rendering a Modal as a bottom sheet). Prefer pure
 * CSS whenever possible.
 */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => resolve());

  useEffect(() => {
    const queries = Object.entries(breakpoints).map(
      ([name, min]) => [name as Breakpoint, window.matchMedia(`(min-width: ${min}px)`)] as const,
    );

    const update = () => setBp(resolve());
    for (const [, mql] of queries) mql.addEventListener("change", update);
    update();
    return () => {
      for (const [, mql] of queries) mql.removeEventListener("change", update);
    };
  }, []);

  return bp;
}

function resolve(): Breakpoint {
  if (typeof window === "undefined") return "lg";
  const width = window.innerWidth;
  const entries = Object.entries(breakpoints) as [Breakpoint, number][];
  let current: Breakpoint = "xs";
  for (const [name, min] of entries) {
    if (width >= min) current = name;
  }
  return current;
}

/** Convenience predicates for the two decisions that actually matter in this app. */
export function useIsMobile(): boolean {
  const bp = useBreakpoint();
  return bp === "xs";
}

/** True below `md` — the threshold where tables and dialogs change shape. */
export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < breakpoints.md,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoints.md - 1}px)`);
    const update = () => setCompact(mql.matches);
    mql.addEventListener("change", update);
    update();
    return () => mql.removeEventListener("change", update);
  }, []);

  return compact;
}
