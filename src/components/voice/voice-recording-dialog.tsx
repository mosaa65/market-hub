/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - Voice Recording Dialog (Gemini-Inspired)
 * Rendered via createPortal at root (z-[9999]) to guarantee visibility over any modal or sheet.
 * Features live audio waveform, pause/resume, interactive editing, and Arabic dialect normalization.
 */

import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Mic,
  MicOff,
  Check,
  RotateCcw,
  X,
  Volume2,
  AlertCircle,
  Sparkles,
  Pause,
  Play,
  Edit3,
} from "lucide-react";
import { useSpeechToText } from "@/hooks/use-speech-to-text";
import { AudioWaveformVisualizer } from "./audio-waveform-visualizer";

export interface VoiceRecordingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (text: string) => void;
  fieldLabel?: string;
  initialValue?: string;
  lang?: string;
}

export function VoiceRecordingDialog({
  isOpen,
  onClose,
  onConfirm,
  fieldLabel,
  initialValue = "",
  lang = "ar-SA",
}: VoiceRecordingDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState<string>("");
  const [mode, setMode] = useState<"append" | "replace">(
    initialValue.trim() ? "append" : "replace",
  );
  const [hasManuallyEdited, setHasManuallyEdited] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    status,
    isListening,
    fullTranscript,
    error,
    startListening,
    stopListening,
    reset,
  } = useSpeechToText({
    lang,
    continuous: true,
    interimResults: true,
    normalizeArabic: true,
    normalizeDigits: true,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // When dialog opens, reset and start listening cleanly
  useEffect(() => {
    if (isOpen) {
      const initialMode = initialValue.trim() ? "append" : "replace";
      setMode(initialMode);
      setHasManuallyEdited(false);
      setText(initialValue.trim());
      reset();

      // Delay slightly for DOM mount & permissions cycle
      const t = setTimeout(() => {
        startListening();
      }, 60);
      return () => clearTimeout(t);
    } else {
      stopListening();
    }
  }, [isOpen, initialValue, startListening, stopListening, reset]);

  // Sync incoming live transcripts with display text (unless user manually typed custom edits)
  useEffect(() => {
    if (!hasManuallyEdited && isOpen) {
      if (fullTranscript.trim()) {
        if (mode === "append" && initialValue.trim()) {
          setText(`${initialValue.trim()} ${fullTranscript.trim()}`);
        } else {
          setText(fullTranscript.trim());
        }
      }
    }
  }, [fullTranscript, hasManuallyEdited, mode, initialValue, isOpen]);

  // Handle global keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
        // If user is inside textarea and pressed Shift+Enter, allow newline
        if (e.target === textareaRef.current && e.shiftKey) {
          return;
        }
        e.preventDefault();
        handleComplete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, text]);

  if (!isOpen || !mounted || typeof document === "undefined") {
    return null;
  }

  const handleComplete = () => {
    stopListening();
    onConfirm(text.trim());
    onClose();
  };

  const handleToggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleRetry = () => {
    reset();
    setHasManuallyEdited(false);
    setText(mode === "append" && initialValue.trim() ? initialValue.trim() : "");
    startListening();
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const isRtl = lang.startsWith("ar");

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-200"
      dir={isRtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-primary/30 bg-surface/95 p-5 sm:p-6 shadow-[0_0_50px_rgba(6,182,212,0.18)] backdrop-blur-2xl transition-all animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gemini Subtle Aura Gradient Header */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 via-primary to-cyan-400 opacity-90" />

        {/* Top Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div
              className={`relative flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${
                isListening
                  ? "bg-primary/20 text-primary shadow-[0_0_20px_rgba(6,182,212,0.4)] ring-2 ring-primary/40"
                  : "bg-surface-3 text-muted-foreground ring-1 ring-border/50"
              }`}
            >
              {isListening ? (
                <>
                  <Mic className="h-5 w-5 animate-pulse" />
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                  </span>
                </>
              ) : (
                <MicOff className="h-5 w-5" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-foreground">
                  {isListening ? "جارٍ الاستماع للصوت..." : "الميكروفون متوقف مؤقتاً"}
                </h3>
                {fieldLabel && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary border border-primary/20">
                    {fieldLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-primary inline" />
                تحدث بحرية باللغة العربية، وسيتم تحويل الصوت إلى نص فورياً
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground cursor-pointer"
            title="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Live Audio Waveform Visualizer */}
        <div className="mt-3.5">
          <AudioWaveformVisualizer
            isListening={isListening}
            className="w-full h-14 rounded-2xl bg-surface-2/70 border border-primary/20"
            barColor="#06b6d4"
            barGlowColor="rgba(6, 182, 212, 0.45)"
            barWidth={3}
            barGap={3}
          />
        </div>

        {/* Append / Replace Mode Selector (Shown if initial value exists) */}
        {initialValue.trim() && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-2/60 px-3 py-1.5 border border-border/40 text-xs text-muted-foreground">
            <span className="truncate max-w-[220px]">
              النص السابق: <strong className="text-foreground">{initialValue}</strong>
            </span>
            <div className="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setMode("append");
                  setHasManuallyEdited(false);
                  setText(
                    fullTranscript.trim()
                      ? `${initialValue.trim()} ${fullTranscript.trim()}`
                      : initialValue.trim(),
                  );
                }}
                className={`rounded-lg px-2 py-0.5 font-medium transition cursor-pointer ${
                  mode === "append"
                    ? "bg-primary text-primary-foreground font-bold"
                    : "hover:bg-surface-3 text-muted-foreground"
                }`}
              >
                إضافة
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("replace");
                  setHasManuallyEdited(false);
                  setText(fullTranscript.trim());
                }}
                className={`rounded-lg px-2 py-0.5 font-medium transition cursor-pointer ${
                  mode === "replace"
                    ? "bg-primary text-primary-foreground font-bold"
                    : "hover:bg-surface-3 text-muted-foreground"
                }`}
              >
                استبدال
              </button>
            </div>
          </div>
        )}

        {/* Live Interactive & Editable Transcription Box */}
        <div className="mt-3 relative rounded-2xl border border-border/70 bg-surface-2/80 p-3.5 transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
          {error ? (
            <div className="flex items-start gap-2.5 text-xs text-destructive py-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{error.message}</p>
                <p className="mt-1 text-muted-foreground">
                  تأكد من منح إذن الميكروفون للموقع، أو انقر «إعادة المحاولة».
                </p>
              </div>
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setHasManuallyEdited(true);
                }}
                placeholder="ابدأ التحدث الآن... سيظهر النص المسموع هنا تدريجياً، ويمكنك تعديله يدوياً بأي وقت."
                rows={3}
                className="w-full resize-none border-0 bg-transparent p-0 text-sm font-medium leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 custom-scrollbar"
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground/70 border-t border-border/30 pt-1.5">
                <span className="flex items-center gap-1">
                  <Edit3 className="h-3 w-3 inline text-primary/70" />
                  يمكنك الكتابة والتعديل باللوحة مباشرة
                </span>
                {text.trim() && (
                  <span className="tabular-nums font-mono text-[10px]">
                    {text.trim().length} حرف
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Action Controls Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/40">
          <div className="flex items-center gap-1.5">
            {/* Pause / Resume Toggle */}
            <button
              type="button"
              onClick={handleToggleListening}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                isListening
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
                  : "bg-primary/15 text-primary hover:bg-primary/25"
              }`}
            >
              {isListening ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  <span>إيقاف مؤقت</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  <span>متابعة التحدث</span>
                </>
              )}
            </button>

            {/* Retry Button */}
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-3 hover:text-foreground cursor-pointer"
              title="إعادة الاستماع من البداية"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">إعادة</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-surface-3 hover:text-foreground border border-border/50 cursor-pointer"
            >
              إلغاء
            </button>

            <button
              type="button"
              onClick={handleComplete}
              disabled={!text.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-md transition-all hover:opacity-95 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Check className="h-4 w-4" />
              <span>إدراج في الحقل</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
