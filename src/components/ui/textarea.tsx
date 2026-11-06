import * as React from "react";
import { cn } from "@/lib/utils";
import { VoiceInputButton } from "@/components/voice/voice-input-button";

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  /** Enables integrated voice typing */
  enableVoice?: boolean;
  /** Label for voice modal */
  voiceLabel?: string;
  /** Custom callback when voice text is confirmed */
  onVoiceInput?: (text: string) => void;
  /** Wrapper class */
  containerClassName?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      containerClassName,
      enableVoice = false,
      voiceLabel,
      onVoiceInput,
      value,
      readOnly,
      disabled,
      ...props
    },
    ref,
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

    const handleVoiceTranscript = (text: string) => {
      if (onVoiceInput) {
        onVoiceInput(text);
      }
      if (textareaRef.current) {
        textareaRef.current.value = text;
        textareaRef.current.dispatchEvent(new Event("input", { bubbles: true }));
        textareaRef.current.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };

    const textareaNode = (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          enableVoice && "pe-9",
          className,
        )}
        ref={textareaRef}
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        {...props}
      />
    );

    if (!enableVoice) {
      return textareaNode;
    }

    return (
      <div className={cn("relative w-full", containerClassName)}>
        {textareaNode}
        {!readOnly && !disabled && (
          <div className="absolute top-2 end-2 z-10">
            <VoiceInputButton
              size="sm"
              fieldLabel={
                voiceLabel ||
                (typeof props.placeholder === "string" ? props.placeholder : undefined)
              }
              currentValue={typeof value === "string" ? value : textareaRef.current?.value || ""}
              onTranscript={handleVoiceTranscript}
            />
          </div>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
