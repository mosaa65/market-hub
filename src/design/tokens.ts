/**
 * Market Hub Design System — token mirror for JS/TS consumers.
 *
 * The single source of truth for *visual* values is `src/styles.css` (CSS custom
 * properties). This file mirrors only the values that JavaScript genuinely needs
 * (timings, breakpoints, control heights, chart series) so components and hooks
 * never hard-code a magic number.
 *
 * Do NOT add colors here that already exist as CSS variables — read them from CSS.
 */

/* ---------- Control sizes (mirror of --control-h-*) ---------- */
export const controlHeight = {
  xs: 28,
  sm: 32,
  md: 36,
  lg: 44,
  xl: 48,
} as const;

export type ControlSize = keyof typeof controlHeight;

/** Tailwind class per control size, used by Input/Select/Button so heights agree. */
export const controlHeightClass: Record<ControlSize, string> = {
  xs: "h-7",
  sm: "h-8",
  md: "h-9",
  lg: "h-11",
  xl: "h-12",
};

/* ---------- Motion (mirror of --duration-* / --ease-*) ---------- */
export const duration = {
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

export const easing = {
  standard: "cubic-bezier(0.32, 0.72, 0, 1)",
  emphasized: "cubic-bezier(0.16, 1, 0.3, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/* ---------- Breakpoints (mirror of --breakpoint-*) ---------- */
export const breakpoints = {
  xs: 380,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/* ---------- Z-index layers (mirror of --z-*) ---------- */
export const zIndex = {
  header: 30,
  dropdown: 40,
  overlay: 50,
  modal: 60,
  toast: 70,
} as const;

/* ---------- Table metrics (mirror of --table-*) ---------- */
export const tableMetrics = {
  cellX: 12,
  cellY: 10,
  headerHeight: 40,
  rowHeight: 44,
} as const;

/* ---------- Chart series ---------- */
export const chartSeries = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;
