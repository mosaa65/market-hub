/**
 * Unified Operation Confirmation Audio Service
 * Market-Hub ERP
 *
 * Provides a short, pleasant, native-app-like confirmation chime (~120ms)
 * synthesized entirely via the standard Web Audio API.
 *
 * Highlights:
 * - Zero external media files / MP3 assets (no loading latency, no broken URLs, no licensing issues).
 * - Gentle harmonic dual-tone chime (sine wave with soft attack & exponential decay).
 * - Safe against browser autoplay restrictions (silently handles un-interacted states).
 * - Idempotent, lightweight, zero memory leaks.
 */

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
      sharedAudioContext = new AudioCtx();
    }
    if (sharedAudioContext.state === "suspended") {
      void sharedAudioContext.resume();
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

export interface PlayChimeOptions {
  volume?: number; // 0.0 to 1.0 (default 0.25)
  tone?: "success" | "soft" | "notice";
}

/**
 * Plays a short, pleasant confirmation chime.
 * Safe to call anywhere; fails silently if audio is unavailable or blocked.
 */
export function playSuccessChime(options: PlayChimeOptions = {}): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const vol = Math.max(0.01, Math.min(1, options.volume ?? 0.22));

    // Tone 1: Gentle primary harmonic (659.25 Hz - E5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    // Smooth frequency ramp to A5 (880 Hz) for an uplifting, completed feel
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(vol, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    // Tone 2: Warm sub-harmonic overtone (1046.50 Hz - C6) starting slightly later
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1046.5, now + 0.03);

    gain2.gain.setValueAtTime(0.001, now + 0.03);
    gain2.gain.linearRampToValueAtTime(vol * 0.45, now + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.15);
    osc2.start(now + 0.03);
    osc2.stop(now + 0.17);
  } catch {
    // Graceful fallback: audio autoplay policies or hardware issues shouldn't break UI flows
  }
}
