import { useState, useEffect } from "react";
import { Share, PlusSquare, X, Smartphone, ArrowDown } from "lucide-react";

export function IosInstallPrompt() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Only run in client browser
    if (typeof window === "undefined" || typeof navigator === "undefined") return;

    // Check if already running in standalone mode (installed PWA)
    const isStandalone =
      ("standalone" in window.navigator &&
        (window.navigator as unknown as { standalone: boolean }).standalone) ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (isStandalone) {
      return;
    }

    // Check if device is iOS (iPhone, iPad, iPod)
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIos =
      /iphone|ipad|ipod/.test(userAgent) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);

    if (!isIos) {
      return;
    }

    // Check if dismissed recently (within 7 days)
    const dismissedUntil = localStorage.getItem("vortex_pwa_ios_dismissed");
    if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
      return;
    }

    // Delay prompt slightly for smoother user experience
    const timer = setTimeout(() => {
      setIsOpen(true);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setIsOpen(false);
    // Dismiss for 7 days
    try {
      localStorage.setItem(
        "vortex_pwa_ios_dismissed",
        String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      );
    } catch {
      // ignore
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4 sm:p-6 flex justify-center pointer-events-none animate-in fade-in slide-in-from-bottom-5 duration-300">
      <div className="w-full max-w-md bg-card/95 backdrop-blur-xl border border-primary/20 text-card-foreground rounded-3xl p-5 shadow-2xl pointer-events-auto space-y-4 dir-rtl border-t-2 border-t-primary">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Smartphone className="size-6" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">تثبيت فورتيكس ERP على جهازك</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                احصل على تجربة تطبيق أصلي كامل الشاشة وسريع
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="إغلاق التنبيه"
            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="bg-muted/50 rounded-2xl p-3.5 space-y-2.5 border border-border/50 text-xs">
          <div className="flex items-center gap-3 text-foreground/90 font-medium">
            <span className="size-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
              1
            </span>
            <span>اضغط على زر المشاركة</span>
            <span className="inline-flex items-center justify-center p-1 rounded-md bg-background border border-border/80 shadow-xs">
              <Share className="size-3.5 text-sky-400" />
            </span>
            <span className="text-muted-foreground text-[11px]">(في شريط سفلي بسفاري)</span>
          </div>

          <div className="flex items-center gap-3 text-foreground/90 font-medium">
            <span className="size-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
              2
            </span>
            <span>انزل للأسفل واختر</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background border border-border/80 text-[11px] font-bold text-foreground shadow-xs">
              <PlusSquare className="size-3 text-emerald-400" />
              <span>إضافة إلى الشاشة الرئيسية</span>
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <ArrowDown className="size-3 text-primary animate-bounce" />
            افتح من أيقونة الشاشة الرئيسية لاحقاً
          </span>
          <button
            type="button"
            onClick={handleDismiss}
            className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition cursor-pointer"
          >
            حسناً، فهمت
          </button>
        </div>
      </div>
    </div>
  );
}
