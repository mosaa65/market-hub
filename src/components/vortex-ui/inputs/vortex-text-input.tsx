import * as React from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldSurface, disabledState, FieldSize, fieldSize } from "@/design/styles";

export interface VortexTextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: FieldSize;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  clearable?: boolean;
  onClear?: () => void;
  hasError?: boolean;
}

export const VortexTextInput = React.forwardRef<HTMLInputElement, VortexTextInputProps>(
  (
    {
      className,
      type = "text",
      size = "md",
      startIcon,
      endIcon,
      clearable = false,
      onClear,
      hasError = false,
      value,
      onChange,
      disabled,
      ...props
    },
    ref,
  ) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const isPassword = type === "password";
    const effectiveType = isPassword ? (showPassword ? "text" : "password") : type;

    const hasValue = value !== undefined && value !== null && String(value).length > 0;

    const handleClear = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (onClear) {
        onClear();
      } else if (onChange) {
        const syntheticEvent = {
          target: { value: "" },
          currentTarget: { value: "" },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    };

    return (
      <div className="relative flex w-full items-center">
        {startIcon && (
          <div className="pointer-events-none absolute start-3 flex items-center justify-center text-muted-foreground/70 transition-colors">
            {startIcon}
          </div>
        )}

        <input
          ref={ref}
          type={effectiveType}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={hasError ? "true" : undefined}
          className={cn(
            fieldSurface,
            fieldSize[size],
            startIcon && "ps-10",
            (endIcon || clearable || isPassword) && "pe-10",
            hasError && "border-destructive/80 focus:border-destructive focus:ring-destructive/20",
            className,
          )}
          {...props}
        />

        <div className="absolute end-2.5 flex items-center gap-1">
          {clearable && hasValue && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              tabIndex={-1}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-surface-2 hover:text-foreground focus:outline-none"
              title="مسح"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {isPassword && !disabled && (
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              tabIndex={-1}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-surface-2 hover:text-foreground focus:outline-none"
              title={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            >
              {showPassword ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          {endIcon && !isPassword && (
            <div className="pointer-events-none flex items-center text-muted-foreground/70">
              {endIcon}
            </div>
          )}
        </div>
      </div>
    );
  },
);

VortexTextInput.displayName = "VortexTextInput";
