/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Market Hub ERP - Voice-to-Text Types
 */

export type VoiceRecognitionStatus =
  | "idle"
  | "requesting_permission"
  | "listening"
  | "processing"
  | "error"
  | "unsupported";

export type VoiceErrorCode =
  | "not-allowed"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "not-supported"
  | "aborted"
  | "unknown";

export interface VoiceError {
  code: VoiceErrorCode;
  message: string;
}

export interface SpeechRecognitionOptions {
  /** Language tag, default is 'ar-SA' (Arabic - Saudi Arabia) with dialect flexibility */
  lang?: string;
  /** Whether to stream interim (unfinalized) transcripts in real-time */
  interimResults?: boolean;
  /** Keep listening until explicitly stopped */
  continuous?: boolean;
  /** Automatically normalize Arabic numbers, remove stuttering/fillers */
  normalizeArabic?: boolean;
  /** Max silence timeout in milliseconds before auto-stopping (default 8000ms) */
  silenceTimeoutMs?: number;
}

export interface VoiceTranscriptState {
  /** Confirmed final transcript */
  finalTranscript: string;
  /** Active interim transcript currently being spoken */
  interimTranscript: string;
  /** Full concatenated transcript (final + interim) */
  fullTranscript: string;
}

export interface VoiceInputTargetField {
  label?: string;
  placeholder?: string;
  currentValue?: string;
}
