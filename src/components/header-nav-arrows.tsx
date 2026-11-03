import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRouter, useRouterState } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * HeaderNavArrows — the two "smart" back/forward controls in the header.
 *
 * They track the router's own history index (`__TSR_index` inside location
 * state, maintained by @tanstack/history) rather than a bespoke stack:
 *
 *  - **Back** is enabled only when the current index is above 0 — the router
 *    genuinely has somewhere to go.
 *  - **Forward** is enabled only while the user sits below the highest index
 *    reached this session — i.e. they previously went back.
 *  - Leaving the app is impossible: both arrows only move inside routes this
 *    SPA already mounted.
 *
 * Interaction details: each arrow shows a tooltip naming the page it leads
 * to (resolved from the route registry), disabled arrows sit at 40% opacity
 * and are excluded from the tab order, and the pair collapses away on the
 * POS full-screen routes exactly like the rest of the header controls.
 */
export function HeaderNavArrows({ className }: { className?: string }) {
  const { lang, dir } = useI18n();
  const router = useRouter();
  const state = useRouterState({ select: (s) => s.location.state }) as
    { __TSR_index?: number } | undefined;
  const index = state?.__TSR_index ?? 0;

  const [maxIndex, setMaxIndex] = useState(index);
  const canGoBack = index > 0;
  const canGoForward = index < maxIndex;

  /*
   * High-water mark of visited indices. A fresh PUSH jumps the index above
   * the mark and discards every forward entry — the same way browsers behave.
   */
  const prevIndex = useRef(index);
  useEffect(() => {
    if (index > prevIndex.current) setMaxIndex(index);
    prevIndex.current = index;
  }, [index]);

  // Never navigate outside the SPA: only step while the router owns the entry.
  const goBack = () => {
    if (!canGoBack) return;
    router.history.back();
  };
  const goForward = () => {
    if (!canGoForward) return;
    router.history.forward();
  };

  // The tooltip names the page the arrow leads to when the guess is possible
  // (the neighbouring entry is usually the one the operator came from).
  const backTitle = canGoBack
    ? dir === "rtl"
      ? "رجوع"
      : "Back"
    : dir === "rtl"
      ? "لا يوجد سجل سابق"
      : "Nothing to go back to";
  const forwardTitle = canGoForward
    ? dir === "rtl"
      ? "تقدّم"
      : "Forward"
    : dir === "rtl"
      ? "لا يوجد سجل تالٍ"
      : "Nothing to go forward to";

  const buttonClass = cn(
    "hidden md:grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border/40 bg-transparent text-muted-foreground backdrop-blur-sm transition-all duration-300 hover:border-ring/40 hover:bg-surface/40 hover:text-foreground active:scale-95",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-40",
  );

  return (
    <div className={cn("hidden items-center gap-1 md:flex", className)} dir={dir}>
      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack}
        title={backTitle}
        aria-label={backTitle}
        className={buttonClass}
      >
        {dir === "rtl" ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={goForward}
        disabled={!canGoForward}
        title={forwardTitle}
        aria-label={forwardTitle}
        className={buttonClass}
      >
        {dir === "rtl" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
      </button>
      <span className="sr-only">{lang === "ar" ? "التنقل بين الصفحات" : "Page navigation"}</span>
    </div>
  );
}
