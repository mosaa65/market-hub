/**
 * Market-Hub ERP — Shared milling screen primitives.
 *
 * Small, presentation-only building blocks used by the three custody screens
 * (intake / milling / delivery) and the statement. No business logic lives
 * here — every decision (balance, price, item role) comes from the database.
 *
 * الحالة والنواتج القديمة (status enums / output types) أُزيلت مع النظام
 * القديم: لا حالات مستندات — السطر الواحد هو الحقيقة (docs/milling/00).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import { toSystemDigits } from "@/lib/format-preferences";

/* ------------------------------------------------------------------ panel */

export function MillingPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/70 bg-surface-1/80 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MillingSectionTitle({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
      <div className="flex items-center gap-2.5">
        {icon && (
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            {icon}
          </div>
        )}
        <div>
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------- fields */

const fieldBase =
  "h-10 w-full rounded-xl border border-border/70 bg-surface-2/50 px-3 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

export function MillingField({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-xs font-semibold text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function MillingInput({ onWheel, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      // Every milling field is part of the keyboard order unless a screen opts
      // out — the counter works without a mouse (see form-navigation.ts).
      data-form-nav=""
      {...props}
      onWheel={(e) => {
        if (props.type === "number") {
          (e.target as HTMLElement).blur();
        }
        onWheel?.(e);
      }}
      className={cn(fieldBase, props.className)}
    />
  );
}

export function MillingSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      data-form-nav=""
      {...props}
      className={cn(fieldBase, "appearance-none", props.className)}
    />
  );
}

export function MillingTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      data-form-nav=""
      {...props}
      className={cn(fieldBase, "h-auto min-h-20 py-2 leading-relaxed", props.className)}
    />
  );
}

/* ------------------------------------------------------------------ bits */

export function Mono({
  children,
  className,
  dir,
}: {
  children: ReactNode;
  className?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <span className={cn("font-mono text-xs tabular-nums text-foreground", className)} dir={dir}>
      {children}
    </span>
  );
}

export function Pill({ children, tone = "amber" }: { children: ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    slate: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
    sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold",
        tones[tone] ?? tones.amber,
      )}
    >
      {children}
    </span>
  );
}

export function StatTile({
  title,
  value,
  unit,
  icon,
  tone = "amber",
}: {
  title: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  tone?: string;
}) {
  const tones: Record<string, string> = {
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    sky: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    rose: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  };
  return (
    <div className="rounded-2xl border border-border/70 bg-surface-1/80 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{title}</p>
        {icon && (
          <div
            className={cn("grid h-8 w-8 place-items-center rounded-xl", tones[tone] ?? tones.amber)}
          >
            {icon}
          </div>
        )}
      </div>
      <p className="mt-2 text-xl font-black tabular-nums text-foreground">
        {value}
        {unit && <span className="ms-1 text-xs font-bold text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

export function MillingEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/70 p-8 text-center">
      <p className="text-sm font-bold text-muted-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function QueryErrorGuard({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-300">
      تعذر تحميل البيانات: {message}
    </div>
  );
}

/** رقم بتنسيق عددي نظيف للعرض — فواصل آلاف وأرقام النظام. */
export function fmtNum(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  const base = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
  return toSystemDigits(base);
}

/* ------------------------------------------------------------------ table */

/** جدول بسيط بأعمدة ثابتة — يُستخدم أيضاً من شاشة الأرصدة الافتتاحية. */
export function MillingTable({
  headers,
  minWidth,
  children,
}: {
  headers: string[];
  minWidth?: number;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-border/70 text-muted-foreground">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-start font-bold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function MillingRow({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-border/40 transition-colors last:border-0 hover:bg-muted/40",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({
  children,
  className,
  align = "start",
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "end" | "center";
}) {
  const alignCls = align === "end" ? "text-end" : align === "center" ? "text-center" : "text-start";
  return <td className={cn("px-3 py-2", alignCls, className)}>{children}</td>;
}
