"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VortexFieldProps {
  label?: React.ReactNode;
  id?: string;
  required?: boolean;
  optional?: boolean;
  hint?: React.ReactNode;
  error?: string | null;
  badge?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function VortexField({
  label,
  id,
  required,
  optional,
  hint,
  error,
  badge,
  className,
  children,
}: VortexFieldProps) {
  return (
    <div className={cn("space-y-1.5 text-start", className)}>
      {(label || badge) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label
              htmlFor={id}
              className="flex items-center gap-1 text-xs font-semibold text-foreground/90 select-none tracking-tight"
            >
              <span>{label}</span>
              {required && <span className="text-destructive font-bold text-sm">*</span>}
              {optional && (
                <span className="text-[10px] font-normal text-muted-foreground">(اختياري)</span>
              )}
            </label>
          )}
          {badge && <div className="text-[10px] text-muted-foreground">{badge}</div>}
        </div>
      )}

      <div className="relative">{children}</div>

      {error ? (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-destructive animate-in fade-in slide-in-from-top-1 duration-150">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground leading-normal">{hint}</p>
      ) : null}
    </div>
  );
}
