"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as DrawerPrimitive } from "vaul";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBreakpoint } from "@/design/breakpoints";

export type VortexDialogSize = "sm" | "md" | "lg" | "xl" | "full";

const sizeClasses: Record<VortexDialogSize, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  full: "sm:max-w-[95vw] sm:h-[90vh]",
};

export interface VortexDrawerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: string;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  size?: VortexDialogSize;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  dismissible?: boolean;
  hideClose?: boolean;
}

/**
 * VortexDrawerDialog:
 * High-performance dual-surface container:
 * - Desktop (>= md): Floating centered Dialog with multi-layered depth, backdrop blur, and smooth entrance.
 * - Mobile (< md): Native-feeling bottom Sheet/Drawer with swipe-to-dismiss handle and keyboard-safe scrolling.
 */
export function VortexDrawerDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  eyebrow,
  icon,
  description,
  footer,
  size = "md",
  children,
  className,
  bodyClassName,
  dismissible = true,
  hideClose = false,
}: VortexDrawerDialogProps) {
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === "xs" || breakpoint === "sm";

  // Desktop Presentation
  if (!isMobile) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={dismissible ? onOpenChange : undefined}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-all duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border/70 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-2xl transition-all duration-200 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
              sizeClasses[size],
              className
            )}
            onPointerDownOutside={(e) => {
              if (!dismissible) e.preventDefault();
            }}
            onEscapeKeyDown={(e) => {
              if (!dismissible) e.preventDefault();
            }}
          >
            {/* Header */}
            {(title || eyebrow) && (
              <div className="flex shrink-0 items-start justify-between border-b border-border/50 px-6 py-4.5 bg-muted/20">
                <div className="flex items-center gap-3">
                  {icon && (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                      {icon}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {eyebrow && (
                      <span className="text-[11px] font-semibold tracking-wider text-primary uppercase">
                        {eyebrow}
                      </span>
                    )}
                    <DialogPrimitive.Title className="text-lg font-bold tracking-tight text-foreground">
                      {title}
                    </DialogPrimitive.Title>
                    {(subtitle || description) && (
                      <DialogPrimitive.Description className="text-xs text-muted-foreground leading-relaxed">
                        {subtitle || description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                </div>
                {!hideClose && dismissible && (
                  <DialogPrimitive.Close asChild>
                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      aria-label="إغلاق"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </DialogPrimitive.Close>
                )}
              </div>
            )}

            {/* Scrollable Body */}
            <div className={cn("flex-1 overflow-y-auto px-6 py-5 custom-scrollbar", bodyClassName)}>
              {children}
            </div>

            {/* Sticky/Docked Footer */}
            {footer && (
              <div className="shrink-0 border-t border-border/50 bg-muted/20 px-6 py-3.5 flex items-center justify-end gap-2.5">
                {footer}
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  // Mobile Presentation: Bottom Sheet (Drawer)
  return (
    <DrawerPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      dismissible={dismissible}
      shouldScaleBackground={false}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity duration-200" />
        <DrawerPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mt-12 flex max-h-[92vh] flex-col rounded-t-[26px] border-t border-border/70 bg-card/98 text-card-foreground shadow-2xl backdrop-blur-2xl focus:outline-none pb-safe",
            className
          )}
        >
          {/* Drag Handle */}
          <div className="mx-auto my-2.5 h-1.5 w-12 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/50 transition-colors" />

          {/* Mobile Header */}
          {(title || eyebrow) && (
            <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-5 pb-3">
              <div className="flex items-center gap-2.5">
                {icon && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                    {icon}
                  </div>
                )}
                <div>
                  {eyebrow && (
                    <span className="block text-[10px] font-semibold text-primary uppercase">
                      {eyebrow}
                    </span>
                  )}
                  <DrawerPrimitive.Title className="text-base font-bold text-foreground">
                    {title}
                  </DrawerPrimitive.Title>
                </div>
              </div>
              {!hideClose && dismissible && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-full bg-muted p-1 text-muted-foreground hover:text-foreground"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* Scrollable Content */}
          <div className={cn("flex-1 overflow-y-auto px-5 py-4 custom-scrollbar", bodyClassName)}>
            {children}
          </div>

          {/* Mobile Sticky Footer */}
          {footer && (
            <div className="shrink-0 border-t border-border/40 bg-card/95 px-5 py-3 shadow-lg">
              {footer}
            </div>
          )}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
