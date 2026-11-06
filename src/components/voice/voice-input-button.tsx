/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - Voice Input Button
 * Micro-button component placed inside or beside input fields to activate voice typing.
 */

import React, { useState } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { VoiceRecordingDialog } from "./voice-recording-dialog";
import type { FieldSize } from "@/design/styles";

export interface VoiceInputButtonProps {
  /** Called when the user confirms their spoken text */
  onTranscript: (text: string) => void;
  /** Label of the target field for display inside the recording dialog */
  fieldLabel?: string;
  /** Current value of the input if user wants to append or edit */
  currentValue?: string;
  /** Size variant matching FieldInput ('sm', 'md', 'lg') */
  size?: FieldSize;
  /** Disabled state */
  disabled?: boolean;
  className?: string;
  /** Language tag (default 'ar-SA') */
  lang?: string;
  /** Custom title/tooltip */
  title?: string;
}

export function VoiceInputButton({
  onTranscript,
  fieldLabel,
  currentValue = "",
  size = "md",
  disabled = false,
  className,
  lang = "ar-SA",
  title = "إدخال صوتي (تحويل الكلام إلى نص)",
}: VoiceInputButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const sizeClasses: Record<FieldSize, string> = {
    sm: "h-6 w-6 p-1",
    md: "h-7 w-7 p-1.5",
    lg: "h-8 w-8 p-2",
  };

  const iconSizes: Record<FieldSize, string> = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-4.5 w-4.5",
  };

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) {
            setIsDialogOpen(true);
          }
        }}
        title={title}
        aria-label={title}
        className={cn(
          "pointer-events-auto inline-flex items-center justify-center rounded-full text-muted-foreground",
          "transition-all duration-150 ease-out",
          "hover:bg-primary/15 hover:text-primary active:scale-90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          "disabled:pointer-events-none disabled:opacity-40",
          sizeClasses[size],
          className,
        )}
      >
        <Mic className={cn(iconSizes[size], "transition-transform group-hover:scale-110")} />
      </button>

      <VoiceRecordingDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onConfirm={(text) => {
          onTranscript(text);
          setIsDialogOpen(false);
        }}
        fieldLabel={fieldLabel}
        initialValue={currentValue}
        lang={lang}
      />
    </>
  );
}
