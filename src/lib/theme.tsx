/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ACCENT_STORAGE_KEY,
  ARCHIVE_STORAGE_KEY,
  CUSTOM_COLOR_STORAGE_KEY,
  DEFAULT_ACCENT_THEME,
  DEFAULT_COLOR_ARCHIVE,
  DEFAULT_CUSTOM_HEX,
  GUEST_PREFERENCES_KEY,
  THEME_SYNC_BROADCAST_CHANNEL,
  applyAccentThemeVariables,
  applyModeVariant,
  getUserThemeStorageKey,
  MODE_VARIANT_STORAGE_KEY,
  parseUserThemePreferences,
  readStoredAccentTheme,
  readStoredColorArchive,
  readStoredCustomHex,
  readStoredModeVariant,
  serializeUserThemePreferences,
  type AccentThemeId,
  type ArchivedColor,
  type ModeVariantId,
  type UserThemePreferences,
} from "./color-theme";

export type Theme = "dark" | "light";

const STORAGE_KEY = "theme";
const DEFAULT_THEME: Theme = "light";

export type ThemeSyncStatus = "synced" | "syncing" | "local" | "error";

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  /** درجة عرض العرض الحالية (الافتراضي/الفخم/النقي/الرمادي/المعتم) */
  modeVariant: ModeVariantId;
  setModeVariant: (variant: ModeVariantId) => void;

  // Accent Themes & Custom Color System
  accentTheme: AccentThemeId;
  setAccentTheme: (id: AccentThemeId) => void;
  customColor: string;
  setCustomColor: (hex: string) => void;
  colorArchive: ArchivedColor[];
  addToArchive: (hex: string, name_ar?: string, name_en?: string) => void;
  removeFromArchive: (idOrHex: string) => void;
  resetArchive: () => void;

  // مزامنة المستخدم السحابية وتعدد الأجهزة
  userId: string | null;
  isCloudSynced: boolean;
  syncStatus: ThemeSyncStatus;
  lastSyncedAt: Date | null;
  forceSyncCloud: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** قراءة السمة العامة من التخزين المحلي */
function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* التخزين قد يكون محجوباً */
  }
  return DEFAULT_THEME;
}

/** قراءة التفضيلات المحلية للمستخدم المحدد أو الزائر */
function readPreferencesForUserOrGuest(userId: string | null): UserThemePreferences {
  if (typeof window === "undefined") {
    return {
      theme: DEFAULT_THEME,
      accentTheme: DEFAULT_ACCENT_THEME,
      customColor: DEFAULT_CUSTOM_HEX,
      colorArchive: DEFAULT_COLOR_ARCHIVE,
      modeVariant: "default",
      updatedAt: Date.now(),
    };
  }

  try {
    const key = userId ? getUserThemeStorageKey(userId) : GUEST_PREFERENCES_KEY;
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = parseUserThemePreferences(raw);
      if (parsed) return parsed;
    }
  } catch {
    /* ignore */
  }

  // fallback to root keys
  return {
    theme: readStoredTheme(),
    accentTheme: readStoredAccentTheme(),
    customColor: readStoredCustomHex(),
    colorArchive: readStoredColorArchive(),
    modeVariant: readStoredModeVariant(),
    updatedAt: Date.now(),
  };
}

/** حفظ التفضيلات محلياً وتحديث مفاتيح البداية السريعة */
function persistPreferencesLocally(userId: string | null, prefs: UserThemePreferences) {
  if (typeof window === "undefined") return;
  try {
    const key = userId ? getUserThemeStorageKey(userId) : GUEST_PREFERENCES_KEY;
    localStorage.setItem(key, serializeUserThemePreferences(prefs));

    // مفاتيح الإقلاع السريع (Zero-Flash pre-render boot script)
    localStorage.setItem(STORAGE_KEY, prefs.theme);
    localStorage.setItem(ACCENT_STORAGE_KEY, prefs.accentTheme);
    localStorage.setItem(CUSTOM_COLOR_STORAGE_KEY, prefs.customColor);
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(prefs.colorArchive));
    localStorage.setItem(MODE_VARIANT_STORAGE_KEY, prefs.modeVariant || "default");
  } catch {
    /* quota or private mode */
  }
}

/** يطبّق السمة واللون على عنصر الجذر */
export function applyTheme(
  theme: Theme,
  accentId: AccentThemeId = readStoredAccentTheme(),
  customHex: string = readStoredCustomHex(),
  modeVariant: ModeVariantId = readStoredModeVariant(),
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0A0A0B" : "#FBFAF9");

  // تطبيق درجة العرض (فخم/نقي/رمادي/معتم) — الافتراضي بدون كلاس
  applyModeVariant(modeVariant);

  // تطبيق متغيرات لون الثيم
  applyAccentThemeVariables(accentId, theme, customHex);
}

/**
 * سكربت الحجب قبل الرسم (Zero-Flash Head Script).
 * يقرأ السمة الفاتحة/المظلمة ولون الثيم المخصص ويطبّقهما على <html> قبل أن يرسم المتصفح أي بكسل.
 */
export const THEME_BOOT_SCRIPT = `(function(){
  try {
    var t = localStorage.getItem("${STORAGE_KEY}");
    if (t !== "dark" && t !== "light") { t = "${DEFAULT_THEME}"; }
    var r = document.documentElement;
    r.classList.toggle("dark", t === "dark");
    r.classList.toggle("light", t === "light");
    r.dataset.theme = t;
    r.style.colorScheme = t;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) { m.setAttribute("content", t === "dark" ? "#0A0A0B" : "#FBFAF9"); }

    // درجة عرض العرض (فخم/نقي/رمادي/معتم)
    var v = localStorage.getItem("${MODE_VARIANT_STORAGE_KEY}") || "default";
    var vc = { "luxe": "light-luxe", "pure": "light-pure", "sand": "light-sand", "mist": "light-mist", "slate": "dark-slate", "deep": "dark-deep", "navy": "dark-navy", "cocoa": "dark-cocoa" };
    if (vc[v]) { r.classList.add(vc[v]); }
    r.dataset.modeVariant = v;

    var a = localStorage.getItem("${ACCENT_STORAGE_KEY}") || "${DEFAULT_ACCENT_THEME}";
    r.dataset.accent = a;

    var presets = {
      emerald: {
        dark: { p: "oklch(0.68 0.20 155)", fg: "oklch(1 0 0)", r: "oklch(0.68 0.20 155 / 0.6)", sp: "oklch(0.68 0.20 155)", tp: "oklch(0.68 0.20 155 / 0.20)" },
        light: { p: "oklch(0.54 0.18 155)", fg: "oklch(0.99 0.01 55)", r: "oklch(0.54 0.18 155 / 0.5)", sp: "oklch(0.50 0.18 155)", tp: "oklch(0.54 0.18 155 / 0.12)" }
      },
      amethyst: {
        dark: { p: "oklch(0.66 0.24 295)", fg: "oklch(1 0 0)", r: "oklch(0.66 0.24 295 / 0.6)", sp: "oklch(0.66 0.24 295)", tp: "oklch(0.66 0.24 295 / 0.20)" },
        light: { p: "oklch(0.55 0.24 295)", fg: "oklch(0.99 0.01 55)", r: "oklch(0.55 0.24 295 / 0.5)", sp: "oklch(0.52 0.22 295)", tp: "oklch(0.55 0.24 295 / 0.12)" }
      },
      ruby: {
        dark: { p: "oklch(0.65 0.24 15)", fg: "oklch(1 0 0)", r: "oklch(0.65 0.24 15 / 0.6)", sp: "oklch(0.65 0.24 15)", tp: "oklch(0.65 0.24 15 / 0.20)" },
        light: { p: "oklch(0.55 0.23 15)", fg: "oklch(0.99 0.01 55)", r: "oklch(0.55 0.23 15 / 0.5)", sp: "oklch(0.51 0.21 15)", tp: "oklch(0.55 0.23 15 / 0.12)" }
      },
      amber: {
        dark: { p: "oklch(0.74 0.19 75)", fg: "oklch(0.12 0 0)", r: "oklch(0.74 0.19 75 / 0.6)", sp: "oklch(0.74 0.19 75)", tp: "oklch(0.74 0.19 75 / 0.20)" },
        light: { p: "oklch(0.58 0.18 75)", fg: "oklch(1 0 0)", r: "oklch(0.58 0.18 75 / 0.5)", sp: "oklch(0.54 0.17 75)", tp: "oklch(0.58 0.18 75 / 0.12)" }
      },
      topaz: {
        dark: { p: "oklch(0.70 0.18 215)", fg: "oklch(0.10 0 0)", r: "oklch(0.70 0.18 215 / 0.6)", sp: "oklch(0.70 0.18 215)", tp: "oklch(0.70 0.18 215 / 0.20)" },
        light: { p: "oklch(0.56 0.18 215)", fg: "oklch(1 0 0)", r: "oklch(0.56 0.18 215 / 0.5)", sp: "oklch(0.52 0.17 215)", tp: "oklch(0.56 0.18 215 / 0.12)" }
      }
    };

    if (a in presets) {
      var s = presets[a][t];
      r.style.setProperty("--primary", s.p);
      r.style.setProperty("--primary-foreground", s.fg);
      r.style.setProperty("--ring", s.r);
      r.style.setProperty("--sidebar-primary", s.sp);
      r.style.setProperty("--sidebar-primary-foreground", s.fg);
      r.style.setProperty("--sidebar-ring", s.r);
      r.style.setProperty("--tone-primary", s.tp);
    } else if (a === "custom") {
      var c = localStorage.getItem("${CUSTOM_COLOR_STORAGE_KEY}") || "${DEFAULT_CUSTOM_HEX}";
      var clean = c.replace("#","");
      if(clean.length === 6) {
        var n = parseInt(clean, 16);
        var red = (n >> 16) & 255, green = (n >> 8) & 255, blue = n & 255;
        var lum = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
        var fg = lum > 0.62 ? "oklch(0.12 0 0)" : "oklch(1 0 0)";
        var rgbStr = "rgb(" + red + " " + green + " " + blue + ")";
        r.style.setProperty("--primary", rgbStr);
        r.style.setProperty("--primary-foreground", fg);
        r.style.setProperty("--ring", "rgb(" + red + " " + green + " " + blue + " / 0.55)");
        r.style.setProperty("--sidebar-primary", rgbStr);
        r.style.setProperty("--sidebar-primary-foreground", fg);
        r.style.setProperty("--sidebar-ring", "rgb(" + red + " " + green + " " + blue + " / 0.55)");
        r.style.setProperty("--tone-primary", "rgb(" + red + " " + green + " " + blue + " / 0.15)");
      }
    }
  } catch(e) {}
})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initialPrefs = readPreferencesForUserOrGuest(null);

  const [theme, setThemeState] = useState<Theme>(initialPrefs.theme);
  const [modeVariant, setModeVariantState] = useState<ModeVariantId>(
    initialPrefs.modeVariant || readStoredModeVariant(),
  );
  const [accentTheme, setAccentThemeState] = useState<AccentThemeId>(initialPrefs.accentTheme);
  const [customColor, setCustomColorState] = useState<string>(initialPrefs.customColor);
  const [colorArchive, setColorArchive] = useState<ArchivedColor[]>(initialPrefs.colorArchive);

  const [userId, setUserId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<ThemeSyncStatus>("local");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const cloudSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const stateRef = useRef({ theme, modeVariant, accentTheme, customColor, colorArchive, userId });

  stateRef.current = { theme, modeVariant, accentTheme, customColor, colorArchive, userId };

  // 1. تطبيق الثيم فورياً على DOM عند أي تغيير (مع درجة العرض)
  useEffect(() => {
    applyTheme(theme, accentTheme, customColor, modeVariant);
  }, [theme, accentTheme, customColor, modeVariant]);

  // دالة المزامنة السحابية المؤجلة (Debounced Cloud Sync)
  const syncToCloud = useCallback((targetUserId: string, prefs: UserThemePreferences) => {
    if (!targetUserId) return;
    setSyncStatus("syncing");

    if (cloudSyncTimer.current) {
      clearTimeout(cloudSyncTimer.current);
    }

    cloudSyncTimer.current = setTimeout(async () => {
      try {
        const payload = {
          theme: prefs.theme,
          accentTheme: prefs.accentTheme,
          customColor: prefs.customColor,
          colorArchive: prefs.colorArchive,
          updatedAt: prefs.updatedAt || Date.now(),
        };

        // المزامنة عبر مسارين لضمان الدقة والموثوقية:
        // 1. بيانات المستخدم raw_user_meta_data (تتزامن عبر كل الأجهزة لحظة تسجيل الدخول)
        const updateAuthPromise = supabase.auth.updateUser({
          data: { theme_preferences: payload },
        });

        // 2. عمود theme في جدول profiles (إذا كان متوفراً)
        const updateProfilesPromise = supabase
          .from("profiles")
          .update({ theme: JSON.stringify(payload) } as any)
          .eq("id", targetUserId);

        await Promise.allSettled([updateAuthPromise, updateProfilesPromise]);

        setSyncStatus("synced");
        setLastSyncedAt(new Date());
      } catch (err) {
        console.warn("[Theme] Cloud sync error (operating in local fallback):", err);
        setSyncStatus("error");
      }
    }, 450);
  }, []);

  // إرسال تحديثات فورية عبر النوافذ المفتوحة
  const broadcastChange = useCallback(
    (prefs: UserThemePreferences, targetUserId: string | null) => {
      try {
        if (broadcastChannelRef.current) {
          broadcastChannelRef.current.postMessage({
            type: "THEME_CHANGE",
            userId: targetUserId,
            prefs,
          });
        }
      } catch {
        // المزامنة عبر BroadcastChannel اختيارية — نتجاهل فشلها بصمت
      }
    },
    [],
  );

  // حفظ محلي وإطلاق المزامنة
  const commitPreferences = useCallback(
    (newPrefs: UserThemePreferences, currentUserId: string | null) => {
      persistPreferencesLocally(currentUserId, newPrefs);
      broadcastChange(newPrefs, currentUserId);

      if (currentUserId) {
        syncToCloud(currentUserId, newPrefs);
      } else {
        setSyncStatus("local");
      }
    },
    [broadcastChange, syncToCloud],
  );

  // تحديث سمة العرض (فاتح / داكن)
  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      const prefs: UserThemePreferences = {
        theme: next,
        modeVariant: stateRef.current.modeVariant,
        accentTheme: stateRef.current.accentTheme,
        customColor: stateRef.current.customColor,
        colorArchive: stateRef.current.colorArchive,
        updatedAt: Date.now(),
      };
      commitPreferences(prefs, stateRef.current.userId);
    },
    [commitPreferences],
  );

  /** تحديث درجة عرض النظام (الافتراضي/الفخم/النقي/الرمادي/المعتم) */
  const setModeVariant = useCallback(
    (variant: ModeVariantId) => {
      setModeVariantState(variant);
      const prefs: UserThemePreferences = {
        theme: stateRef.current.theme,
        modeVariant: variant,
        accentTheme: stateRef.current.accentTheme,
        customColor: stateRef.current.customColor,
        colorArchive: stateRef.current.colorArchive,
        updatedAt: Date.now(),
      };
      commitPreferences(prefs, stateRef.current.userId);
    },
    [commitPreferences],
  );

  const toggleTheme = useCallback(() => {
    const next: Theme = stateRef.current.theme === "dark" ? "light" : "dark";
    setTheme(next);
  }, [setTheme]);

  // تحديث الثيم النشط (الأزرق، الزمرد، الأرجوان، الياقوت، الذهب، التوباز أو مخصص)
  const setAccentTheme = useCallback(
    (id: AccentThemeId) => {
      setAccentThemeState(id);
      const prefs: UserThemePreferences = {
        theme: stateRef.current.theme,
        accentTheme: id,
        customColor: stateRef.current.customColor,
        colorArchive: stateRef.current.colorArchive,
        updatedAt: Date.now(),
      };
      commitPreferences(prefs, stateRef.current.userId);
    },
    [commitPreferences],
  );

  // تحديث اللون المخصص
  const setCustomColor = useCallback(
    (hex: string) => {
      const formatted = hex.startsWith("#") ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
      setCustomColorState(formatted);
      const prefs: UserThemePreferences = {
        theme: stateRef.current.theme,
        modeVariant: stateRef.current.modeVariant,
        accentTheme: stateRef.current.accentTheme,
        customColor: formatted,
        colorArchive: stateRef.current.colorArchive,
        updatedAt: Date.now(),
      };
      commitPreferences(prefs, stateRef.current.userId);
    },
    [commitPreferences],
  );

  // إضافة لون للأرشيف
  const addToArchive = useCallback(
    (hex: string, name_ar?: string, name_en?: string) => {
      const formatted = hex.startsWith("#") ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
      setColorArchive((prev) => {
        if (prev.some((item) => item.hex.toUpperCase() === formatted)) {
          return prev;
        }
        const newItem: ArchivedColor = {
          id: `custom-${Date.now()}`,
          hex: formatted,
          name_ar: name_ar || `لون مخصص (${formatted})`,
          name_en: name_en || `Custom ${formatted}`,
          isPreset: false,
        };
        const next = [newItem, ...prev];
        const prefs: UserThemePreferences = {
          theme: stateRef.current.theme,
          accentTheme: stateRef.current.accentTheme,
          customColor: stateRef.current.customColor,
          colorArchive: next,
          updatedAt: Date.now(),
        };
        commitPreferences(prefs, stateRef.current.userId);
        return next;
      });
    },
    [commitPreferences],
  );

  // إزالة لون من الأرشيف
  const removeFromArchive = useCallback(
    (idOrHex: string) => {
      setColorArchive((prev) => {
        const next = prev.filter(
          (item) => item.id !== idOrHex && item.hex.toUpperCase() !== idOrHex.toUpperCase(),
        );
        const prefs: UserThemePreferences = {
          theme: stateRef.current.theme,
          accentTheme: stateRef.current.accentTheme,
          customColor: stateRef.current.customColor,
          colorArchive: next,
          updatedAt: Date.now(),
        };
        commitPreferences(prefs, stateRef.current.userId);
        return next;
      });
    },
    [commitPreferences],
  );

  // استعادة الأرشيف الافتراضي
  const resetArchive = useCallback(() => {
    setColorArchive(DEFAULT_COLOR_ARCHIVE);
    const prefs: UserThemePreferences = {
      theme: stateRef.current.theme,
      modeVariant: stateRef.current.modeVariant,
      accentTheme: stateRef.current.accentTheme,
      customColor: stateRef.current.customColor,
      colorArchive: DEFAULT_COLOR_ARCHIVE,
      updatedAt: Date.now(),
    };
    commitPreferences(prefs, stateRef.current.userId);
  }, [commitPreferences]);

  // جلب ومزامنة إعدادات المستخدم من السحابة عند تسجيل الدخول
  const loadUserPreferences = useCallback(
    async (user: any) => {
      if (!user || !user.id) return;
      const uid = user.id;
      setUserId(uid);
      setSyncStatus("syncing");

      // 1. محاولة القراءة من الكاش المحلي للمستخدم أولاً للاستجابة الفورية
      const cachedLocal = readPreferencesForUserOrGuest(uid);
      let resolvedPrefs: UserThemePreferences = cachedLocal;

      try {
        // 2. التحقق من السحابة (user_metadata و profiles.theme)
        let cloudPrefs: UserThemePreferences | null = null;
        if (user.user_metadata?.theme_preferences) {
          cloudPrefs = parseUserThemePreferences(user.user_metadata.theme_preferences);
        }

        if (!cloudPrefs) {
          const { data: profileData } = await supabase
            .from("profiles")
            .select("theme")
            .eq("id", uid)
            .maybeSingle();

          if (profileData && (profileData as any).theme) {
            cloudPrefs = parseUserThemePreferences((profileData as any).theme);
          }
        }

        if (cloudPrefs) {
          // إذا كانت التفضيلات السحابية أحدث أو موجودة، نعتمدها
          if (!cachedLocal || cloudPrefs.updatedAt >= cachedLocal.updatedAt) {
            resolvedPrefs = cloudPrefs;
          } else {
            // الكاش المحلي أحدث (مثلاً تم التعديل أثناء انقطاع الاتصال)، نرفعه للسحابة
            syncToCloud(uid, cachedLocal);
          }
        } else {
          // لا توجد تفضيلات سحابية بعد (مستخدم جديد) -> نرفع التفضيلات الحالية فوراً
          const initialToUpload: UserThemePreferences = {
            theme: stateRef.current.theme,
            accentTheme: stateRef.current.accentTheme,
            customColor: stateRef.current.customColor,
            colorArchive: stateRef.current.colorArchive,
            updatedAt: Date.now(),
          };
          syncToCloud(uid, initialToUpload);
          resolvedPrefs = initialToUpload;
        }

        // تطبيق التفضيلات المعتمَدة
        setThemeState(resolvedPrefs.theme);
        setAccentThemeState(resolvedPrefs.accentTheme);
        setCustomColorState(resolvedPrefs.customColor);
        setColorArchive(resolvedPrefs.colorArchive);
        applyTheme(resolvedPrefs.theme, resolvedPrefs.accentTheme, resolvedPrefs.customColor);
        persistPreferencesLocally(uid, resolvedPrefs);

        setSyncStatus("synced");
        setLastSyncedAt(new Date());
      } catch (e) {
        console.warn("[Theme] Error loading cloud theme preferences:", e);
        setSyncStatus("local");
      }
    },
    [syncToCloud],
  );

  // عند تسجيل الخروج: استعادة التفضيلات المحلية للزائر دون مسح بيانات المستخدم السحابية
  const handleUserLogout = useCallback(() => {
    setUserId(null);
    setSyncStatus("local");
    const guestPrefs = readPreferencesForUserOrGuest(null);
    setThemeState(guestPrefs.theme);
    setAccentThemeState(guestPrefs.accentTheme);
    setCustomColorState(guestPrefs.customColor);
    setColorArchive(guestPrefs.colorArchive);
    applyTheme(guestPrefs.theme, guestPrefs.accentTheme, guestPrefs.customColor);
    persistPreferencesLocally(null, guestPrefs);
  }, []);

  // زر المزامنة الفورية اليدوية
  const forceSyncCloud = useCallback(async () => {
    const currentUid = stateRef.current.userId;
    if (!currentUid) {
      setSyncStatus("local");
      return;
    }
    const currentPrefs: UserThemePreferences = {
      theme: stateRef.current.theme,
      modeVariant: stateRef.current.modeVariant,
      accentTheme: stateRef.current.accentTheme,
      customColor: stateRef.current.customColor,
      colorArchive: stateRef.current.colorArchive,
      updatedAt: Date.now(),
    };
    syncToCloud(currentUid, currentPrefs);
  }, [syncToCloud]);

  // الاشتراك في أحداث Supabase Auth و BroadcastChannel للتزامن الفوري عبر الأجهزة والتبويبات
  useEffect(() => {
    // 1. BroadcastChannel للمزامنة الفورية بين تبويبات المتصفح
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const channel = new BroadcastChannel(THEME_SYNC_BROADCAST_CHANNEL);
        broadcastChannelRef.current = channel;

        channel.onmessage = (event) => {
          const { userId: msgUserId, prefs } = event.data || {};
          if (msgUserId === stateRef.current.userId && prefs) {
            setThemeState(prefs.theme);
            setAccentThemeState(prefs.accentTheme);
            setCustomColorState(prefs.customColor);
            setColorArchive(prefs.colorArchive);
            applyTheme(prefs.theme, prefs.accentTheme, prefs.customColor);
          }
        };
      }
    } catch {
      // فشل قراءة تفضيلات الثيم المخزنة محليًا — نتجاهله ونستخدم الافتراضي
    }

    // 2. مزامنة عند التبديل بين التبويبات عبر حدث storage
    const handleStorageChange = (e: StorageEvent) => {
      if (
        e.key === STORAGE_KEY ||
        e.key === ACCENT_STORAGE_KEY ||
        e.key === CUSTOM_COLOR_STORAGE_KEY
      ) {
        const activePrefs = readPreferencesForUserOrGuest(stateRef.current.userId);
        setThemeState(activePrefs.theme);
        setAccentThemeState(activePrefs.accentTheme);
        setCustomColorState(activePrefs.customColor);
        setColorArchive(activePrefs.colorArchive);
        applyTheme(activePrefs.theme, activePrefs.accentTheme, activePrefs.customColor);
      }
    };
    window.addEventListener("storage", handleStorageChange);

    // 3. استعلام جلسة المصادقة المبدئية
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session?.user) {
          loadUserPreferences(data.session.user);
        } else {
          setSyncStatus("local");
        }
      })
      .catch(() => {
        setSyncStatus("local");
      });

    // 4. الاستماع إلى تغييرات حالة تسجيل الدخول / الخروج
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === "SIGNED_IN" ||
        event === "INITIAL_SESSION" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        if (session?.user) {
          loadUserPreferences(session.user);
        }
      } else if (event === "SIGNED_OUT") {
        handleUserLogout();
      }
    });

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
      authListener?.subscription?.unsubscribe();
      if (cloudSyncTimer.current) {
        clearTimeout(cloudSyncTimer.current);
      }
    };
  }, [loadUserPreferences, handleUserLogout]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        modeVariant,
        setModeVariant,
        accentTheme,
        setAccentTheme,
        customColor,
        setCustomColor,
        colorArchive,
        addToArchive,
        removeFromArchive,
        resetArchive,
        userId,
        isCloudSynced: syncStatus === "synced",
        syncStatus,
        lastSyncedAt,
        forceSyncCloud,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  // خارج المزوّد (اختبارات معزولة):
  const fallbackPrefs = readPreferencesForUserOrGuest(null);
  return {
    theme: fallbackPrefs.theme,
    setTheme: (t) => applyTheme(t, fallbackPrefs.accentTheme, fallbackPrefs.customColor),
    toggleTheme: () => {
      const next = fallbackPrefs.theme === "dark" ? "light" : "dark";
      applyTheme(next, fallbackPrefs.accentTheme, fallbackPrefs.customColor);
    },
    modeVariant: fallbackPrefs.modeVariant || "default",
    setModeVariant: (variant: ModeVariantId) => applyModeVariant(variant),
    accentTheme: fallbackPrefs.accentTheme,
    setAccentTheme: (id) =>
      applyAccentThemeVariables(id, fallbackPrefs.theme, fallbackPrefs.customColor),
    customColor: fallbackPrefs.customColor,
    setCustomColor: () => {},
    colorArchive: fallbackPrefs.colorArchive,
    addToArchive: () => {},
    removeFromArchive: () => {},
    resetArchive: () => {},
    userId: null,
    isCloudSynced: false,
    syncStatus: "local",
    lastSyncedAt: null,
    forceSyncCloud: async () => {},
  };
}
