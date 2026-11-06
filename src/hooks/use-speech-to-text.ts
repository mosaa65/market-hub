/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - useSpeechToText Hook
 * Production-ready hook for real-time speech recognition with Arabic dialect optimization.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type {
  VoiceRecognitionStatus,
  VoiceError,
  SpeechRecognitionOptions,
} from "@/lib/voice/voice-types";
import {
  SpeechRecognitionSession,
  isSpeechRecognitionSupported,
} from "@/lib/voice/speech-recognition-adapter";
import { normalizeArabicSpeechTranscript } from "@/lib/voice/arabic-voice-normalizer";

export interface UseSpeechToTextOptions extends SpeechRecognitionOptions {
  onTranscriptChange?: (fullText: string) => void;
  onFinalResult?: (finalText: string) => void;
  onError?: (error: VoiceError) => void;
}

export function useSpeechToText(options: UseSpeechToTextOptions = {}) {
  const [status, setStatus] = useState<VoiceRecognitionStatus>("idle");
  const [finalTranscript, setFinalTranscript] = useState<string>("");
  const [interimTranscript, setInterimTranscript] = useState<string>("");
  const [error, setError] = useState<VoiceError | null>(null);

  const sessionRef = useRef<SpeechRecognitionSession | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const isSupported = isSpeechRecognitionSupported();

  const reset = useCallback(() => {
    setFinalTranscript("");
    setInterimTranscript("");
    setError(null);
    setStatus("idle");
  }, []);

  const stopListening = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.stop();
      sessionRef.current = null;
    }
    setStatus("idle");
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) {
      const err: VoiceError = {
        code: "not-supported",
        message: "التعرف على الصوت غير مدعوم في هذا المتصفح.",
      };
      setError(err);
      setStatus("unsupported");
      optionsRef.current.onError?.(err);
      return;
    }

    if (sessionRef.current) {
      sessionRef.current.stop();
      sessionRef.current = null;
    }

    setError(null);
    setStatus("requesting_permission");

    const session = new SpeechRecognitionSession(
      {
        lang: optionsRef.current.lang || "ar-SA",
        continuous: optionsRef.current.continuous ?? true,
        interimResults: optionsRef.current.interimResults ?? true,
      },
      {
        onStart: () => {
          setStatus("listening");
        },
        onResult: ({ interim, final, full }) => {
          const normalize = optionsRef.current.normalizeArabic !== false;
          const cleanInterim = normalize
            ? normalizeArabicSpeechTranscript(interim, { trim: false })
            : interim;
          const cleanFinal = normalize
            ? normalizeArabicSpeechTranscript(final)
            : final;
          const cleanFull = normalize
            ? normalizeArabicSpeechTranscript(full)
            : full;

          setInterimTranscript(cleanInterim);
          setFinalTranscript(cleanFinal);

          optionsRef.current.onTranscriptChange?.(cleanFull);
          if (cleanFinal && !cleanInterim) {
            optionsRef.current.onFinalResult?.(cleanFinal);
          }
        },
        onError: (err) => {
          setError(err);
          setStatus("error");
          optionsRef.current.onError?.(err);
        },
        onEnd: () => {
          setStatus("idle");
        },
      },
    );

    sessionRef.current = session;
    const started = session.start();
    if (!started) {
      setStatus("error");
    }
  }, [isSupported]);

  // Teardown when component unmounts
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.abort();
        sessionRef.current = null;
      }
    };
  }, []);

  const fullTranscript = [finalTranscript, interimTranscript]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    status,
    isListening: status === "listening",
    isSupported,
    finalTranscript,
    interimTranscript,
    fullTranscript,
    error,
    startListening,
    stopListening,
    reset,
  };
}
