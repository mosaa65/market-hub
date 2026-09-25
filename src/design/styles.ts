/**
 * Market Hub Design System — shared class recipes.
 *
 * This is the **central place where control appearances are defined**. Components
 * consume these strings; pages must never re-declare an input or button style.
 *
 * Changing a value here (height, radius, focus ring, motion) changes the whole app.
 */

/* ---------- Focus & state primitives ---------- */

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-0";

export const disabledState = "disabled:cursor-not-allowed disabled:opacity-50";

/* ---------- Field surface ---------- */

/**
 * The canonical field surface: input, textarea, select trigger and other
 * "boxed control" shells all share it so they line up pixel-for-pixel.
 */
export const fieldSurface = [
  "w-full min-w-0 rounded-[12px] border-input bg-surface/70 backdrop-blur-sm text-foreground",
  "shadow-[inset_0_1px_0_0_oklch(1_0_0/0.04)]",
  "transition-[border-color,box-shadow,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
  "placeholder:text-muted-foreground/60",
  "hover:border-primary/25 hover:bg-surface",
  "focus:outline-none focus:border-primary/60 focus:bg-surface focus:ring-4 focus:ring-primary/10",
  "aria-[invalid=true]:border-destructive/70 aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/10",
  disabledState,
  "read-only:bg-surface-2/50 read-only:text-muted-foreground read-only:border-transparent",
].join(" ");

/** Pill-shaped field used by the global search bar. */
export const pillFieldSurface = [
  "w-full min-w-0 rounded-full border-border/60 bg-surface/50 backdrop-blur-xl text-foreground",
  "shadow-[inset_0_1px_0_0_oklch(1_0_0/0.05),0_1px_2px_0_oklch(0_0_0/0.12)]",
  "transition-[border-color,box-shadow,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
  "placeholder:text-muted-foreground/60 hover:border-primary/30 hover:bg-surface/70",
  "focus:outline-none focus:border-primary/50 focus:bg-surface/80 focus:ring-4 focus:ring-primary/15",
  "aria-[invalid=true]:border-destructive/70 aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/10",
  disabledState,
].join(" ");

/** Field sizes — keeps every control height honest across the app. */
export const fieldSize = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3 text-sm",
  lg: "h-11 px-4 text-base sm:text-sm",
} as const;

export type FieldSize = keyof typeof fieldSize;

/** Padding applied when a leading/trailing adornment (icon, suffix) is present. */
export const fieldAdornmentPadding = {
  start: "ps-9",
  end: "pe-9",
  both: "ps-9 pe-9",
  endButton: "pe-9",
} as const;

/* ---------- Typography ---------- */

export const typography = {
  pageTitle: "text-title text-foreground",
  pageSubtitle: "text-sm text-muted-foreground",
  sectionTitle: "text-section text-foreground",
  label: "text-label text-muted-foreground",
  helper: "text-caption text-muted-foreground",
  error: "text-caption font-medium text-destructive",
  cellNum: "text-cell-num tabular-nums",
  mono: "font-mono text-[13px] tabular-nums",
} as const;

/* ---------- Surfaces ---------- */

export const surface = {
  panel: "rounded-[16px] border-border/80 bg-surface",
  panelElevated: "rounded-[16px] border-border/80 bg-surface-elevated shadow-[var(--shadow-panel)]",
  card: "rounded-[14px] border-border/70 bg-surface/80",
  inset: "rounded-[10px] border-border/60 bg-background/40",
} as const;

/* ---------- Status tones ---------- */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

/**
 * Tone → class recipe. Every status surface in the app should resolve through this
 * map instead of using literal palette colors, so light/dark and theming keep working.
 */
export const toneClasses: Record<Tone, { badge: string; icon: string; text: string; bar: string }> =
  {
    neutral: {
      badge: "bg-tone-neutral text-tone-neutral-fg border-border/60",
      icon: "text-muted-foreground",
      text: "text-muted-foreground",
      bar: "bg-muted-foreground/40",
    },
    info: {
      badge: "bg-tone-info text-tone-info-fg border-tone-info-fg/20",
      icon: "text-tone-info-fg",
      text: "text-tone-info-fg",
      bar: "bg-tone-info-fg/60",
    },
    success: {
      badge: "bg-tone-success text-tone-success-fg border-tone-success-fg/20",
      icon: "text-tone-success-fg",
      text: "text-tone-success-fg",
      bar: "bg-tone-success-fg/60",
    },
    warning: {
      badge: "bg-tone-warning text-tone-warning-fg border-tone-warning-fg/20",
      icon: "text-tone-warning-fg",
      text: "text-tone-warning-fg",
      bar: "bg-tone-warning-fg/60",
    },
    danger: {
      badge: "bg-tone-danger text-tone-danger-fg border-tone-danger-fg/20",
      icon: "text-tone-danger-fg",
      text: "text-tone-danger-fg",
      bar: "bg-tone-danger-fg/60",
    },
    primary: {
      badge: "bg-tone-primary text-tone-primary-fg border-tone-primary-fg/20",
      icon: "text-tone-primary-fg",
      text: "text-tone-primary-fg",
      bar: "bg-primary/60",
    },
  };

/* ---------- Table ---------- */

export const tableClasses = {
  wrapper: "relative w-full",
  scroller: "w-full overflow-x-auto overscroll-x-contain",
  table: "w-full border-collapse text-sm",
  head: "sticky top-0 z-10 bg-surface/95 backdrop-blur-sm",
  headRow: "border-b border-border",
  headCell:
    "h-10 px-3 text-start align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap",
  bodyRow: "border-b border-border/60 transition-colors duration-150 hover:bg-accent/40",
  cell: "px-3 py-2.5 align-middle",
  cellNum: "px-3 py-2.5 align-middle text-end tabular-nums",
  actionsCell: "px-3 py-2.5 text-end whitespace-nowrap",
} as const;
