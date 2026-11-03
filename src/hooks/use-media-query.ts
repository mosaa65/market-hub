import { useEffect, useState } from "react";

/**
 * useMediaQuery — reactive CSS media query for genuinely different layout trees.
 *
 * Used by the POS/Purchase-POS workspace to decide whether the product browser
 * is mounted at all (desktop split view) or kept out of the DOM in favour of the
 * cart-first mobile flow with an on-demand product picker.
 *
 * Rendering both trees and hiding one with CSS was explicitly rejected: it keeps
 * a heavy catalogue mounted on phones. A real behavioural split needs a real
 * runtime signal, which is what this hook provides.
 *
 * The initial value is `false` on the server and on first client paint; callers
 * must therefore treat `false` as the safe (mobile) default so nothing heavy is
 * mounted before the query resolves.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Breakpoint used to split the workspace: `lg` (1024px), matching Tailwind. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
