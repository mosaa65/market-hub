/**
 * محرك الصوت الذكي للإشعارات والتنبيهات (Vortex Toast Audio Engine)
 * يستخدم Web Audio API لتوليد أصوات نقية وسريعة بدون أي ملفات خارجية أو تأخير
 */

const SOUND_STORAGE_KEY = "vortex_toast_sound_enabled";
const POSITION_STORAGE_KEY = "vortex_toast_position";

export type ToastSoundType = "success" | "error" | "warning" | "info";
export type ToastPositionType =
  "top-center" | "top-right" | "top-left" | "bottom-center" | "bottom-right" | "bottom-left";

let audioCtx: AudioContext | null = null;
let lastPlayedAt = 0;

/**
 * الحصول على كائن AudioContext بأمان
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {
        /* ignore */
      });
    }

    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * هل صوت الإشعارات مفعّل في تفضيلات المستخدم؟
 */
export function isToastSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const val = localStorage.getItem(SOUND_STORAGE_KEY);
    // افتراضياً مفعّل إلا إذا عطله المستخدم صراحة
    return val !== "false" && val !== "disabled";
  } catch {
    return true;
  }
}

/**
 * تفعيل أو تعطيل صوت الإشعارات
 */
export function setToastSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "true" : "false");
    window.dispatchEvent(new CustomEvent("vortex-toast-sound-change", { detail: { enabled } }));
  } catch {
    /* ignore */
  }
}

/**
 * قراءة موضع الإشعار المفضل
 */
export function getStoredToastPosition(): ToastPositionType {
  if (typeof window === "undefined") return "top-center";
  try {
    const val = localStorage.getItem(POSITION_STORAGE_KEY) as ToastPositionType;
    if (
      val &&
      [
        "top-center",
        "top-right",
        "top-left",
        "bottom-center",
        "bottom-right",
        "bottom-left",
      ].includes(val)
    ) {
      return val;
    }
  } catch {
    /* ignore */
  }
  return "top-center";
}

/**
 * حفظ موضع الإشعار
 */
export function setStoredToastPosition(pos: ToastPositionType): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, pos);
    window.dispatchEvent(
      new CustomEvent("vortex-toast-position-change", { detail: { position: pos } }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * تشغيل نغمة الإشعار بحسب نوعه عبر Web Audio API
 */
export function playToastSound(type: ToastSoundType): void {
  if (!isToastSoundEnabled()) return;

  // تفادي تكرار الصوت السريع جداً إذا أُطلقت عدة إشعارات معاً
  const now = Date.now();
  if (now - lastPlayedAt < 120) return;
  lastPlayedAt = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const t = ctx.currentTime;

    if (type === "success") {
      // نغمة نجاح ثلاثية فاخرة وناعمة (Ascending Chime: E5 -> G#5 -> B5)
      const freqs = [659.25, 830.61, 987.77];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t + idx * 0.055);

        gain.gain.setValueAtTime(0.0001, t + idx * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.09, t + idx * 0.055 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.055 + 0.28);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t + idx * 0.055);
        osc.stop(t + idx * 0.055 + 0.3);
      });
    } else if (type === "error") {
      // نغمة خطأ ثنائية وقورة ومحددة بدون إزعاج (Double Low Pulse: Eb4 -> C4)
      const freqs = [311.13, 261.63];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, t + idx * 0.09);

        gain.gain.setValueAtTime(0.0001, t + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.11, t + idx * 0.09 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.09 + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t + idx * 0.09);
        osc.stop(t + idx * 0.09 + 0.24);
      });
    } else if (type === "warning") {
      // نغمة تحذير تنبيهية رنانة ودافئة (Warm Alert Ping: A4 -> F#5)
      const freqs = [440.0, 739.99];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t + idx * 0.06);

        gain.gain.setValueAtTime(0.0001, t + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.09, t + idx * 0.06 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.06 + 0.24);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t + idx * 0.06);
        osc.stop(t + idx * 0.06 + 0.26);
      });
    } else {
      // نغمة معلومات وتعليمات نقية وناعمة (Pure Drop Ding: D5)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, t);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.24);
    }
  } catch {
    /* ignore */
  }
}
