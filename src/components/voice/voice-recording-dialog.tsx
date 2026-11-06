/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - Voice Recording Dialog
 * Compact, zero-latency modal displaying live waveform and streaming transcription.
 */

import React, { useEffect, useState } from "react";
import { Mic, MicOff, Check, RotateCcw, X, Volume2, AlertCircle, Sparkles } from "lucide-react";
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
  const [accumulatedText, setAccumulatedText] = useState<string>(initialValue);

  const {
    status,
    isListening,
    fullTranscript,
    finalTranscript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    reset,
  } = useSpeechToText({
    lang,
    continuous: true,
    interimResults: true,
    normalizeArabic: true,
  });

  // Whenever modal opens, start listening cleanly
  useEffect(() => {
    if (isOpen) {
      setAccumulatedText(initialValue);
      reset();
      // Slight delay to ensure DOM and mic permissions cycle cleanly
      const t = setTimeout(() => {
        startListening();
      }, 50);
      return () => clearTimeout(t);
    } else {
      stopListening();
    }
  }, [isOpen, initialValue, startListening, stopListening, reset]);

  // Handle keyboard shortcuts (Enter to submit, Escape to cancel)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleComplete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, fullTranscript, accumulatedText]);

  if (!isOpen) return null;

  // The resulting text to insert
  const effectiveResult = fullTranscript
    ? (accumulatedText ? `${accumulatedText} ${fullTranscript}` : fullTranscript).trim()
    : accumulatedText.trim();

  const handleComplete = () => {
    stopListening();
    onConfirm(effectiveResult);
    onClose();
  };

  const handleRetry = () => {
    reset();
    setAccumulatedText("");
    startListening();
  };

  const isRtl = lang.startsWith("ar");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-200"
      dir={isRtl ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border/80 bg-surface/95 p-6 shadow-2xl backdrop-blur-2xl transition-all">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                isListening
                  ? "bg-primary/20 text-primary shadow-[0_0_15px_rgba(6,182,212,0.35)]"
                  : "bg-surface-3 text-muted-foreground"
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
                <h3 className="text-base font-bold text-foreground">
                  {isListening ? "جارٍ الاستماع..." : "الميكروفون متوقف"}
                </h3>
                {fieldLabel && (
                  <span className="rounded-full bg-surface-3 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border/40">
                    {fieldLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Volume2 className="h-3 w-3 text-primary inline" />
                تحدث بوضوح، وسيتم تحويل كلماتك إلى نص فورياً
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
            title="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Live Audio Waveform Visualizer */}
        <div className="mt-4">
          <AudioWaveformVisualizer
            isListening={isListening}
            className="w-full h-16 rounded-xl"
            barColor="#06b6d4"
            barGlowColor="rgba(6, 182, 212, 0.45)"
            barWidth={3}
            barGap={3}
          />
        </div>

        {/* Live Streaming Transcription Box */}
        <div className="mt-4 min-h-[110px] max-h-[220px] overflow-y-auto rounded-xl border border-border/60 bg-surface-2/70 p-4 transition-all">
          {error ? (
            <div className="flex items-start gap-2.5 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{error.message}</p>
                <p className="mt-1 text-muted-foreground">
                  يمكنك النقر على زر "إعادة المحاولة" أدناه أو التأكد من إذن الميكروفون.
                </p>
              </div>
            </div>
          ) : effectiveResult ? (
            <div className="text-sm font-medium leading-relaxed text-foreground select-text">
              <span>{finalTranscript || accumulatedText}</span>
              {interimTranscript && (
                <span className="text-primary font-semibold opacity-80 ms-1 animate-pulse">
                  {interimTranscript}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-[80px] text-center text-muted-foreground/70">
              <Sparkles className="h-5 w-5 mb-1.5 text-primary/40 animate-pulse" />
              <p className="text-xs">ابدأ التحدث الآن... سيظهر النص المسموع هنا تدريجياً.</p>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="mt-5 flex items-center justify-between gap-3 pt-3 border-t border-border/40">
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>إعادة التحدث</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground border border-border/50"
            >
              إلغاء
            </button>

            <button
              type="button"
              onClick={handleComplete}
              disabled={!effectiveResult}
              className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-1.5 text-xs font-bold text-primary-foreground shadow-md transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="h-4 w-4" />
              <span>إدراج في الحقل</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
