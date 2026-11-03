/**
 * Unified Operation Confirmation Audio Service
 * Market-Hub ERP
 *
 * Provides a crisp, pleasant, native-app-like confirmation chime
 * with multi-engine resilience:
 * 1. Web Audio API synthesized harmonics (sine wave with soft attack & exponential decay)
 * 2. In-memory data-URI WAV fallback for environments where AudioContext is suspended or restricted
 */

let sharedAudioContext: AudioContext | null = null;
let cachedWavUrl: string | null = null;

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
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/**
 * Builds a lightweight, standalone 16-bit PCM WAV chime (E5 -> A5 chord)
 * encoded as a Data URI so it can play reliably via standard HTMLAudioElement.
 */
function getChimeWavDataUri(): string {
  if (cachedWavUrl) return cachedWavUrl;
  try {
    const sampleRate = 22050;
    const duration = 0.35;
    const numSamples = Math.floor(sampleRate * duration);
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF identifier
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataSize, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true); // 16 for PCM
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // 16 bits per sample
    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, dataSize, true);

    // Synthesize dual harmonic tones: 659.25Hz (E5) + 880Hz (A5)
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Exponential decay envelope
      const env = Math.exp(-t * 11) * Math.min(t / 0.015, 1);
      const tone1 = Math.sin(2 * Math.PI * 659.25 * t);
      const tone2 = Math.sin(2 * Math.PI * 880 * t) * 0.7;
      const tone3 = Math.sin(2 * Math.PI * 1318.5 * t) * 0.35;
      const sample = Math.max(-1, Math.min(1, (tone1 + tone2 + tone3) * 0.5 * env));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    cachedWavUrl = `data:audio/wav;base64,${btoa(binary)}`;
    return cachedWavUrl;
  } catch {
    return "";
  }
}

export interface PlayChimeOptions {
  volume?: number; // 0.0 to 1.0 (default 0.40)
  tone?: "success" | "soft" | "notice";
}

/**
 * Plays a clear, pleasant confirmation chime.
 * Uses Web Audio API with automatic resume, and falls back to HTMLAudioElement.
 */
export function playSuccessChime(options: PlayChimeOptions = {}): void {
  if (typeof window === "undefined") return;

  const vol = Math.max(0.05, Math.min(1, options.volume ?? 0.4));
  let webAudioStarted = false;

  const ctx = getAudioContext();
  if (ctx) {
    const runNodes = () => {
      try {
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(659.25, now);
        osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12);

        gain1.gain.setValueAtTime(0.001, now);
        gain1.gain.linearRampToValueAtTime(vol, now + 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1046.5, now + 0.03);

        gain2.gain.setValueAtTime(0.001, now + 0.03);
        gain2.gain.linearRampToValueAtTime(vol * 0.6, now + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.2);
        osc2.start(now + 0.03);
        osc2.stop(now + 0.24);
        webAudioStarted = true;
      } catch (err) {
        console.warn("[audio] WebAudio node scheduling error:", err);
      }
    };

    if (ctx.state === "suspended") {
      ctx.resume().then(runNodes).catch(() => {
        playFallbackAudio(vol);
      });
      return;
    } else {
      runNodes();
    }
  }

  // If Web Audio API wasn't available or couldn't start, fire fallback
  if (!webAudioStarted) {
    playFallbackAudio(vol);
  }
}

function playFallbackAudio(vol: number): void {
  try {
    const dataUri = getChimeWavDataUri();
    if (!dataUri) return;
    const audio = new Audio(dataUri);
    audio.volume = Math.max(0.05, Math.min(1, vol));
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        // Autoplay policy or user gesture requirement
        console.debug("[audio] HTMLAudio play suppressed:", err);
      });
    }
  } catch {
    // Ignore fallback failures
  }
}
