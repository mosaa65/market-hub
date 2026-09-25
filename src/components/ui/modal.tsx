import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useBreakpoint, useIsCompact } from "@/design/breakpoints";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: string;
  description?: string;
  /** Footer content — use `FormActions` for consistency across the app. */
  footer?: React.ReactNode;
  /** `sm`…`xl` set the desktop width. `full` always fills the viewport. */
  size?: ModalSize;
  /**
   * Mobile presentation.
   *  - `auto` (default): bottom sheet below `md`, centered dialog at/above `md`.
   *    Large sizes become full-screen so dense forms stay usable.
   *  - `sheet` / `center` / `fullscreen`: force one presentation.
   */
  mobile?: "auto" | "sheet" | "center" | "fullscreen";
  /**
   * Desktop presentation.
   *  - `auto` (default): centered dialog, respecting `size`.
   *  - `popover-start` / `popover-end`: a compact panel anchored to the start/end
   *    edge, vertically centered. Used for filters and sort, which need little
   *    space and should not cover the list they act on.
   */
  desktop?: "auto" | "popover-start" | "popover-end";
  /**
   * Width below which an auto sheet is preferred. Use `lg` for compact utility
   * panels: a filter should be a bottom sheet on both phones and tablets.
   */
  sheetUntil?: "md" | "lg";
  /** Prevents closing on overlay click (destructive confirmations, unsaved data). */
  dismissible?: boolean;
  /** Hides the header close button (rarely needed). */
  hideClose?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
  /** Accessible description id when you need to point at custom content. */
  describedBy?: string;
}

const sizeClass: Record<ModalSize, string> = {
  sm: "md:max-w-md",
  md: "md:max-w-xl",
  lg: "md:max-w-3xl",
  xl: "md:max-w-5xl",
  full: "md:max-w-[min(96rem,calc(100vw-2rem))]",
};

/**
 * Modal — the single overlay surface for the whole application.
 *
 * Replaces the 15 hand-rolled `fixed inset-0 z-50 grid place-items-center …` shells
 * previously duplicated across 11 route files, which had inconsistent overlay
 * opacity, radius, padding, dismissal behaviour (some had no Escape/overlay close)
 * and no focus management.
 *
 * Provides, in one place:
 *  - desktop centered dialog + mobile bottom sheet / full-screen
 *  - Escape to close, overlay click to close (opt-out via `dismissible={false}`)
 *  - focus trap via `inert` on background content + Radix-style focus restore
 *  - background scroll lock that does not shift the layout
 *  - `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`
 *  - RTL-aware close button position and safe-area padding
 *
 * NOTE: presentation only. No data, query or business logic lives here.
 */
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  description,
  footer,
  size = "md",
  mobile = "auto",
  desktop = "auto",
  sheetUntil = "md",
  dismissible = true,
  hideClose = false,
  className,
  bodyClassName,
  children,
  describedBy,
}: ModalProps) {
  const compactAtMd = useIsCompact();
  const breakpoint = useBreakpoint();
  const compact = sheetUntil === "lg" ? breakpoint !== "lg" && breakpoint !== "xl" && breakpoint !== "2xl" : compactAtMd;
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => setMounted(true), []);

  const presentation = React.useMemo(() => {
    if (mobile !== "auto") return mobile;
    if (size === "full" || size === "xl") return "fullscreen";
    return "sheet";
  }, [mobile, size]);

  const asSheet = compact && presentation === "sheet";
  const asFullscreen = compact && presentation === "fullscreen";
  // Desktop popover-style panel (filters, sort): compact, edge-anchored.
  const asPopover = !compact && (desktop === "popover-start" || desktop === "popover-end");
  const asCentered = (!compact && !asPopover) || presentation === "center";

  /* ---- scroll lock (no layout shift) ---- */
  React.useEffect(() => {
    if (!open) return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingInlineEnd;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingInlineEnd = `${scrollbar}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingInlineEnd = prevPadding;
    };
  }, [open]);

  /* ---- focus management: move in, restore on exit ---- */
  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? panel).focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  /* ---- escape + focus trap ---- */
  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!dismissible) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, dismissible, onClose]);

  if (!mounted || !open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!dismissible) return;
    if (e.target === e.currentTarget) onClose();
  };

  const header = title || eyebrow || description || !hideClose;

  const node = (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex",
        asPopover
          ? desktop === "popover-start"
            ? "items-start justify-start pt-20"
            : "items-start justify-end pt-20"
          : "justify-center",
      )}
      role="presentation"
      onMouseDown={handleOverlayClick}
    >
      {/* Overlay */}
      <div aria-hidden className="overlay-enter absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : describedBy}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "relative z-10 flex w-full flex-col overflow-hidden border-border/80 bg-surface-elevated shadow-[var(--shadow-overlay)] focus:outline-none",
          asSheet && "sheet-enter mt-auto h-[92dvh] rounded-t-[24px] border-b-0",
          asFullscreen && "panel-enter h-[100dvh] rounded-none border-0",
          asCentered &&
            cn("panel-enter m-auto max-h-[calc(100dvh-2rem)] rounded-[16px]", sizeClass[size]),
          asPopover &&
            cn("panel-enter max-h-[calc(100dvh-6rem)] rounded-[20px]", sizeClass[size]),
          asPopover && desktop === "popover-start" && "absolute left-4 sm:left-6",
          asPopover && desktop === "popover-end" && "absolute right-4 sm:right-6",
          className,
        )}
      >
        {/* Drag handle (sheet only) */}
        {asSheet ? (
          <div className="flex shrink-0 justify-center pt-2.5" aria-hidden>
            <div className="h-1.5 w-12 rounded-full bg-border" />
          </div>
        ) : null}

        {header ? (
          <div
            className={cn(
              "flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-6",
            )}
          >
            <div className="min-w-0 space-y-0.5">
              {eyebrow ? (
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
                  {eyebrow}
                </p>
              ) : null}
              {title ? (
                <h2 id={titleId} className="truncate text-base font-semibold tracking-tight">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descId} className="text-caption text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>

            {hideClose ? null : (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4"
              >
                <X />
              </button>
            )}
          </div>
        ) : null}

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6",
            bodyClassName,
          )}
        >
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-border/60 bg-surface/60 px-4 py-3 pb-safe sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

/* ------------------------------------------------------------------ */
/*  ConfirmDialog                                                      */
/* ------------------------------------------------------------------ */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * ConfirmDialog — replaces every native `confirm()` call in the app.
 * Unstyled, English-labelled browser dialogs are one of the audit's a11y/UX issues.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      mobile="center"
      dismissible={!loading}
      hideClose={false}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading} block>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            block
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {description ? (
        <div className="text-sm leading-6 text-muted-foreground">{description}</div>
      ) : null}
    </Modal>
  );
}
