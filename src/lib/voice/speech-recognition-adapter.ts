/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - Speech Recognition Browser Adapter
 */

import type { SpeechRecognitionOptions, VoiceError } from "./voice-types";

// Type declarations for window.SpeechRecognition / window.webkitSpeechRecognition
interface IWindowWithSpeech extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as unknown as IWindowWithSpeech;
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export function getSpeechRecognitionConstructor(): any {
  if (typeof window === "undefined") return null;
  const win = window as unknown as IWindowWithSpeech;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export interface RecognitionCallbacks {
  onStart?: () => void;
  onResult?: (data: { interim: string; final: string; full: string }) => void;
  onError?: (error: VoiceError) => void;
  onEnd?: () => void;
}

export class SpeechRecognitionSession {
  private recognition: any = null;
  private options: SpeechRecognitionOptions;
  private callbacks: RecognitionCallbacks;
  private isExplicitlyStopped: boolean = false;
  private finalTranscriptAccumulator: string = "";

  constructor(options: SpeechRecognitionOptions, callbacks: RecognitionCallbacks) {
    this.options = {
      lang: "ar-SA",
      interimResults: true,
      continuous: true,
      ...options,
    };
    this.callbacks = callbacks;
  }

  public start(): boolean {
    const SpeechConstructor = getSpeechRecognitionConstructor();
    if (!SpeechConstructor) {
      this.callbacks.onError?.({
        code: "not-supported",
        message: "متصفحك الحالي لا يدعم التعرف على الصوت المباشر.",
      });
      return false;
    }

    try {
      this.isExplicitlyStopped = false;
      this.finalTranscriptAccumulator = "";
      this.recognition = new SpeechConstructor();
      this.recognition.lang = this.options.lang || "ar-SA";
      this.recognition.continuous = this.options.continuous ?? true;
      this.recognition.interimResults = this.options.interimResults ?? true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.callbacks.onStart?.();
      };

      this.recognition.onresult = (event: any) => {
        let interim = "";
        let currentFinalBatch = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const text = item[0]?.transcript || "";
          if (item.isFinal) {
            currentFinalBatch += (currentFinalBatch ? " " : "") + text.trim();
          } else {
            interim += (interim ? " " : "") + text.trim();
          }
        }

        if (currentFinalBatch) {
          this.finalTranscriptAccumulator = this.finalTranscriptAccumulator
            ? `${this.finalTranscriptAccumulator} ${currentFinalBatch}`
            : currentFinalBatch;
        }

        const full = [this.finalTranscriptAccumulator, interim].filter(Boolean).join(" ").trim();

        this.callbacks.onResult?.({
          interim,
          final: this.finalTranscriptAccumulator,
          full,
        });
      };

      this.recognition.onerror = (event: any) => {
        const errorType = event?.error || "unknown";

        if (errorType === "aborted" && this.isExplicitlyStopped) {
          // Normal abort when user finishes recording
          return;
        }

        let message = "حدث خطأ أثناء الاستماع.";
        switch (errorType) {
          case "not-allowed":
            message = "تم رفض إذن الوصول إلى الميكروفون. يرجى تفعيله من إعدادات المتصفح.";
            break;
          case "no-speech":
            message = "لم يتم التقاط أي صوت، يرجى التحدث بوضوح بالقرب من الميكروفون.";
            break;
          case "audio-capture":
            message = "تعذر العثور على ميكروفون صالح لتسجيل الصوت.";
            break;
          case "network":
            message = "تعذر الاتصال بخدمة التعرف على الصوت. تحقق من اتصالك.";
            break;
        }

        this.callbacks.onError?.({
          code: errorType,
          message,
        });
      };

      this.recognition.onend = () => {
        if (!this.isExplicitlyStopped && this.options.continuous) {
          // Restart gracefully if ended unintentionally while continuous was requested
          try {
            this.recognition?.start();
            return;
          } catch {
            // Ignore if already active or permission lost
          }
        }
        this.callbacks.onEnd?.();
      };

      this.recognition.start();
      return true;
    } catch (err: any) {
      this.callbacks.onError?.({
        code: "unknown",
        message: err?.message || "تعذر بدء جلسة التسجيل الصوتي.",
      });
      return false;
    }
  }

  public stop(): void {
    this.isExplicitlyStopped = true;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Recognition already closed
      }
      this.recognition = null;
    }
  }

  public abort(): void {
    this.isExplicitlyStopped = true;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Recognition already closed
      }
      this.recognition = null;
    }
  }
}
