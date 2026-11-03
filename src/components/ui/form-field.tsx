import * as React from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { resolveFieldIcon, type FieldIconKind } from "@/components/ui/field-icons";
import type { LucideIcon } from "lucide-react";

/**
 * Field context.
 *
 * `FormField` supports two usage styles:
 *
 *  1. render prop  — `<FormField label="…">{(p) => <FieldInput {...p} />}</FormField>`
 *  2. plain child   — `<FormField label="…"><FieldInput /></FormField>`
 *
 * Style 2 is far more readable and is what most pages will use, so the resolved
 * field state (id, aria wiring, **icon**) is also published through context and
 * consumed automatically by `FieldInput`. That way a field always gets its icon
 * regardless of which style the page used.
 */
export interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean | undefined;
  icon: React.ReactNode;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

export function useFieldContext() {
  return React.useContext(FieldContext);
}

export interface FormFieldProps {
  /** Field label. Rendered as a real `<label>` wired to the control via `htmlFor`. */
  label?: string;
  /** Renders the required marker and sets `aria-required` on the control. */
  required?: boolean;
  /** Helper text shown below the control when there is no error. */
  hint?: string;
  /** Error message. Overrides `hint` and marks the control invalid. */
  error?: string | null;
  /** Success message (e.g. "Username available"). */
  success?: string;
  /** The control. Receives `id`, `aria-*` and `invalid` via the render prop. */
  children: React.ReactNode | ((props: FieldControlProps) => React.ReactNode);
  className?: string;
  /** Column span inside a `FormGrid`. */
  span?: 1 | 2 | 3 | 4 | "full";
  /**
   * Explicit icon. When omitted, an icon is derived from `kind`, then from the
   * label text (AR + EN keywords), then from a neutral default — so every field
   * in the system is consistently decorated. See `field-icons.tsx`.
   */
  icon?: LucideIcon;
  /** Semantic field kind, used to pick a sensible default icon. */
  kind?: FieldIconKind;
  /** Set false to render no icon for a specific field. */
  showIcon?: boolean;
}

export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean | undefined;
  "aria-required": boolean | undefined;
  invalid: boolean;
  /** Resolved icon — pass into `FieldInput` so the field renders it. */
  icon: React.ReactNode;
}

const spanClass: Record<NonNullable<FormFieldProps["span"]>, string> = {
  1: "",
  2: "sm:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  full: "col-span-full",
};

/**
 * FormField — the single label + control + message wrapper.
 *
 * Replaces the three page-local `Field` components and the unused shadcn `FormItem`.
 * It works with a plain child element or with a render prop, so it can wrap both
 * this design system's `FieldInput` and any third-party control:
 *
 * ```tsx
 * <FormField label="Name" required error={errors.name}>
 *   {(p) => <FieldInput {...p} value={name} onChange={...} />}
 * </FormField>
 * ```
 *
 * It can also be adopted incrementally with a plain child:
 *
 * ```tsx
 * <FormField label="Name"><FieldInput /></FormField>
 * ```
 */
export function FormField({
  label,
  required,
  hint,
  error,
  success,
  children,
  className,
  span,
  icon,
  kind,
  showIcon = true,
}: FormFieldProps) {
  const reactId = React.useId();
  const id = `field-${reactId}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const successId = `${id}-success`;

  const invalid = Boolean(error);
  const describedBy =
    [error ? errorId : null, !error && hint ? hintId : null, !error && success ? successId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  // Resolve the field's icon from the explicit prop, then the semantic kind,
  // then bilingual keyword matching on the label, then the system default.
  const ResolvedIcon = React.useMemo(
    () => resolveFieldIcon({ icon, kind, label: label ?? hint ?? undefined }),
    [icon, kind, label, hint],
  );

  const controlProps: FieldControlProps = {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
    "aria-required": required || undefined,
    invalid,
    icon: showIcon ? <ResolvedIcon aria-hidden /> : null,
  };

  const contextValue: FieldContextValue = {
    id,
    describedBy,
    invalid,
    required,
    icon: controlProps.icon,
  };

  return (
    <FieldContext.Provider value={contextValue}>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1.5 text-start",
          span && spanClass[span],
          className,
        )}
      >
        {label ? (
          <label htmlFor={id} className="text-label text-start text-muted-foreground">
            {label}
            {required ? (
              <span className="ms-1 align-super text-[11px] font-bold text-destructive" aria-hidden>
                *
              </span>
            ) : null}
          </label>
        ) : null}

        {typeof children === "function" ? children(controlProps) : children}

        {error ? (
          <p
            id={errorId}
            role="alert"
            className="flex items-start gap-1 text-caption font-medium text-destructive"
          >
            <CircleAlert className="mt-px size-3 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : success ? (
          <p
            id={successId}
            className="flex items-start gap-1 text-caption font-medium text-success-fg"
          >
            <CircleCheck className="mt-px size-3 shrink-0" aria-hidden />
            <span>{success}</span>
          </p>
        ) : hint ? (
          <p id={hintId} className="text-caption text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
