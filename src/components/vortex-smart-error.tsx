import { useState, useEffect, useTransition } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  RotateCcw,
  Home,
  ShieldCheck,
  ChevronDown,
  Copy,
  Check,
  MessageSquare,
  Phone,
  Database,
  ShieldAlert,
  Server,
  WifiOff,
  Code2,
  AlertTriangle,
  Loader2,
  Sparkles,
  Terminal,
  Activity,
} from "lucide-react";
import { reportLovableError } from "../lib/lovable-error-reporting";

export type ErrorLayer =
  | "database"
  | "auth_permissions"
  | "backend_network"
  | "frontend_ui"
  | "data_validation"
  | "unknown";

export interface DiagnosticResult {
  layer: ErrorLayer;
  title: string;
  badge: string;
  badgeCls: string;
  icon: typeof Database;
  isTransient: boolean;
  userExplanation: string;
  devRecommendation: string;
  technicalCode: string;
}

export function diagnoseSystemError(error: any): DiagnosticResult {
  const errName = (error?.name || "").toString();
  const errMsg = (error?.message || "").toString();
  const errStack = (error?.stack || "").toString();
  const errCode = (error?.code || error?.status || "").toString();
  const fullText = `${errName} ${errMsg} ${errStack} ${errCode}`.toLowerCase();

  // 1. Auth & Permissions (RLS, JWT, 401, 403)
  if (
    fullText.includes("401") ||
    fullText.includes("403") ||
    fullText.includes("permission denied") ||
    fullText.includes("row-level security") ||
    fullText.includes("rls") ||
    fullText.includes("jwt") ||
    fullText.includes("not authorized") ||
    fullText.includes("unauthorized") ||
    fullText.includes("forbidden") ||
    fullText.includes("invalid claim") ||
    fullText.includes("session expired")
  ) {
    return {
      layer: "auth_permissions",
      title: "صلاحيات الوصول والمصادقة (Auth & Security)",
      badge: "صلاحيات وأمان • RLS",
      badgeCls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      icon: ShieldAlert,
      isTransient: false,
      userExplanation:
        "حسابك لا يمتلك الصلاحية الكافية للوصول إلى هذا السجل أو انتهت جلسة الدخول الحالية.",
      devRecommendation:
        "تحقق من سياسات الأمان RLS للجداول في Supabase وصلاحيات الدور (Role) للمستخدم المسجل.",
      technicalCode: errCode || "AUTH_PERMISSION_DENIED",
    };
  }

  // 2. Database (PostgreSQL / Supabase PostgREST)
  if (
    fullText.includes("pgrst") ||
    fullText.includes("postgres") ||
    fullText.includes("supabase") ||
    fullText.includes("relation") ||
    fullText.includes("23505") ||
    fullText.includes("foreign key") ||
    fullText.includes("violates not-null") ||
    fullText.includes("violates foreign key") ||
    fullText.includes("column does not exist") ||
    fullText.includes("table does not exist") ||
    fullText.includes("database") ||
    fullText.includes("duplicate key")
  ) {
    return {
      layer: "database",
      title: "قواعد البيانات (Database / PostgreSQL)",
      badge: "قاعدة البيانات • Supabase / DB",
      badgeCls: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      icon: Database,
      isTransient: false,
      userExplanation:
        "تعذر قراءة أو تخزين السجل في قاعدة البيانات بسبب عدم اكتمال الحقول أو تكرار سجل فريد.",
      devRecommendation:
        "تحقق من مطابقة الحقول ومخطط الجداول (Schema/Migrations) وقيود الحقول الفريدة في قاعدة البيانات.",
      technicalCode: errCode || "DB_QUERY_EXCEPTION",
    };
  }

  // 3. Backend & Network (Server 500s, fetch failed, timeouts)
  if (
    fullText.includes("failed to fetch") ||
    fullText.includes("networkerror") ||
    fullText.includes("econnrefused") ||
    fullText.includes("cors") ||
    fullText.includes("500") ||
    fullText.includes("502") ||
    fullText.includes("503") ||
    fullText.includes("504") ||
    fullText.includes("timeout") ||
    fullText.includes("aborted") ||
    fullText.includes("aborterror") ||
    fullText.includes("offline") ||
    fullText.includes("load failed")
  ) {
    const isTransient =
      fullText.includes("timeout") ||
      fullText.includes("failed to fetch") ||
      fullText.includes("networkerror") ||
      fullText.includes("aborted") ||
      fullText.includes("aborterror") ||
      fullText.includes("load failed");

    return {
      layer: "backend_network",
      title: "الخادم والشبكة (Backend API / Network)",
      badge: isTransient ? "تأخر شبكة مؤقت • Network" : "خادم السيرفر • Backend",
      badgeCls: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
      icon: isTransient ? WifiOff : Server,
      isTransient,
      userExplanation: isTransient
        ? "تأخر لحظي في استجابة الشبكة أو تعثر مؤقت في جلب البيانات من الخادم."
        : "واجه خادم النظام تعثراً داخلياً أثناء معالجة الطلب.",
      devRecommendation:
        "تحقق من استقرار اتصال الإنترنت، أو سجلات دوال Edge Functions وخادم الـ API.",
      technicalCode: errCode || (isTransient ? "NETWORK_TIMEOUT_DELAY" : "SERVER_INTERNAL_ERROR"),
    };
  }

  // 4. Data Validation (Zod, missing contract)
  if (fullText.includes("zod") || fullText.includes("validation") || fullText.includes("schema")) {
    return {
      layer: "data_validation",
      title: "صحة البيانات والمدخلات (Data Validation)",
      badge: "التحقق من البيانات • Validation",
      badgeCls: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
      icon: AlertTriangle,
      isTransient: false,
      userExplanation:
        "البيانات المدخلة أو المسترجعة لا تطابق النمط المطلوب للنظام المحاسبي.",
      devRecommendation:
        "تحقق من مخطط Zod وصيغة الكائنات المرسلة لضمان توافق الحقول المطلوبة.",
      technicalCode: errCode || "DATA_VALIDATION_ERROR",
    };
  }

  // 5. Frontend UI / Runtime (TypeError, ReferenceError)
  if (
    fullText.includes("typeerror") ||
    fullText.includes("referenceerror") ||
    fullText.includes("syntaxerror") ||
    fullText.includes("cannot read properties") ||
    fullText.includes("undefined is not") ||
    fullText.includes("null is not") ||
    fullText.includes("is not a function")
  ) {
    return {
      layer: "frontend_ui",
      title: "واجهة المستخدم (Frontend Runtime)",
      badge: "كود الواجهة • Client Runtime",
      badgeCls: "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      icon: Code2,
      isTransient: false,
      userExplanation:
        "حدث خطأ أثناء عرض عناصر الصفحة نتيجة متغير مالي أو نصي غير مكتمل في الواجهة.",
      devRecommendation:
        "تحقق من قراءة الخصائص المحمية (Optional Chaining ?.) وتوفر القيم الافتراضية في مكونات React.",
      technicalCode: errCode || "FRONTEND_RENDER_EXCEPTION",
    };
  }

  // Default / General
  return {
    layer: "unknown",
    title: "خطأ عام في النظام (System Generic Error)",
    badge: "نظام عام • General",
    badgeCls: "border-zinc-500/30 bg-zinc-500/10 text-muted-foreground",
    icon: Activity,
    isTransient: true,
    userExplanation:
      "حدث استثناء غير متوقع أثناء معالجة العملية، وبياناتك وسجلاتك المالية بأمان.",
    devRecommendation:
      "فحص سجل التتبع (Stack Trace) بالأسفل لتحديد السطر والمكون المسبب للاستثناء.",
    technicalCode: errCode || "SYSTEM_RUNTIME_ERROR",
  };
}

export function VortexSmartError({
  error,
  reset,
}: {
  error: any;
  reset: () => void;
}) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [autoRecovering, setAutoRecovering] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [isPending, startTransition] = useTransition();

  const diagnostic = diagnoseSystemError(error);
  const LayerIcon = diagnostic.icon;

  useEffect(() => {
    reportLovableError(error, {
      boundary: "tanstack_root_smart_error_component",
      layer: diagnostic.layer,
      code: diagnostic.technicalCode,
    });
  }, [error, diagnostic]);

  // Smart Auto-Recovery for Transient/Delay Errors
  useEffect(() => {
    if (diagnostic.isTransient) {
      setAutoRecovering(true);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            // Attempt silent recovery
            try {
              router.invalidate();
              reset();
            } catch (e) {
              console.warn("Silent recovery attempt completed");
            }
            setAutoRecovering(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [diagnostic.isTransient, reset, router]);

  const handleManualRetry = () => {
    setIsRetrying(true);
    startTransition(() => {
      try {
        router.invalidate();
        reset();
      } finally {
        setTimeout(() => setIsRetrying(false), 800);
      }
    });
  };

  const supportPhone = "+967772217218";
  const supportPhoneFormatted = "+967 772 217 218";

  const errorSummary =
    `*تقرير فحص فني ذكي - Vortex ERP*
` +
    `• طبقة الخطأ: ${diagnostic.title}
` +
    `• كود التشخيص: ${diagnostic.technicalCode}
` +
    `• اسم الخطأ: ${error?.name || "خطأ عام"}
` +
    `• الرسالة: ${error?.message || "لا توجد رسالة"}
` +
    `• الرابط: ${typeof window !== "undefined" ? window.location.href : "غير محدد"}
` +
    `• التوصية للمبرمج: ${diagnostic.devRecommendation}
` +
    `• التوقيت: ${new Date().toLocaleString("ar-YE")}`;

  const copyErrorDetails = async () => {
    const fullText = `${errorSummary}

*سجل التتبع الفني (Stack Trace):*
${error?.stack || "لا يوجد"}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const whatsappUrl = `https://wa.me/967772217218?text=${encodeURIComponent(
    `${errorSummary}

يرجى فحص المشكلة البرمجية أعلاه.`,
  )}`;

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background/95 to-surface-2/40 px-4 py-8 selection:bg-primary/20"
      dir="rtl"
    >
      <div className="relative max-w-xl w-full p-6 sm:p-8 rounded-3xl border border-border/80 bg-card/90 dark:bg-zinc-950/90 backdrop-blur-2xl shadow-2xl space-y-6 text-center overflow-hidden">
        {/* Ambient Top Glow according to layer */}
        <div className="pointer-events-none absolute -top-20 inset-x-0 mx-auto size-60 rounded-full bg-amber-500/10 blur-3xl opacity-70" />

        {/* Transient Auto-Recovery Banner */}
        {autoRecovering && (
          <div className="relative -mx-6 -mt-6 sm:-mx-8 sm:-mt-8 mb-4 px-4 py-2.5 bg-gradient-to-r from-amber-500/15 via-emerald-500/15 to-amber-500/15 border-b border-border/60 flex items-center justify-center gap-2 text-xs font-semibold text-foreground animate-pulse">
            <Loader2 className="size-3.5 animate-spin text-amber-500" />
            <span>
              رُصد تأخر لحظي في استجابة البيانات • جاري المحاولة الذكية تلقائياً خلال ({countdown}) ثوانٍ...
            </span>
          </div>
        )}

        {/* Dynamic Architectural Layer Icon Badge */}
        <div className="mx-auto relative">
          <div className="size-16 sm:size-20 mx-auto grid place-items-center rounded-3xl bg-gradient-to-tr from-card via-surface/80 to-surface-2 border border-border/80 shadow-xl group transition-transform hover:scale-105">
            <LayerIcon className="size-8 sm:size-10 text-amber-500 dark:text-amber-400 filter drop-shadow-md" />
          </div>
          <span className="absolute -bottom-1 -end-1 sm:end-44 flex size-5 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-3.5 rounded-full bg-emerald-500 ring-2 ring-card shadow-xs" />
          </span>
        </div>

        {/* Category & Status Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold shadow-xs ${diagnostic.badgeCls}`}>
            <LayerIcon className="size-3.5" />
            <span>{diagnostic.badge}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-surface/70 px-2.5 py-1 text-[11px] font-mono font-semibold text-muted-foreground shadow-xs">
            <span>الكود:</span>
            <span className="text-foreground">{diagnostic.technicalCode}</span>
          </span>
        </div>

        {/* Reassuring User Explanation */}
        <div className="space-y-2">
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
            {diagnostic.title}
          </h1>
          <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground max-w-md mx-auto">
            {diagnostic.userExplanation}{" "}
            <strong className="text-foreground font-bold">
              بياناتك وسجلاتك المالية بأمان تام.
            </strong>
          </p>
        </div>

        {/* Circular & Sleek Action Buttons (Fully Responsive) */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleManualRetry}
            disabled={isRetrying || isPending}
            className="w-full sm:w-auto h-11 px-6 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all cursor-pointer disabled:opacity-60"
          >
            {isRetrying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            <span>إعادة المحاولة الذكية</span>
          </button>

          <a
            href="/"
            className="w-full sm:w-auto h-11 px-6 rounded-full border border-border/80 bg-surface/80 hover:bg-surface-2 text-foreground font-bold text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xs"
          >
            <Home className="size-4 text-muted-foreground" />
            <span>العودة للوحة التحكم الرئيسية</span>
          </a>
        </div>

        {/* Direct Developer & Support Quick Actions */}
        <div className="rounded-2xl border border-border/70 bg-surface/50 p-4 space-y-3 text-right backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone className="size-3.5 text-primary" />
              <span className="text-xs font-bold text-foreground">
                الدعم الفني المباشر (موسى العوضي)
              </span>
            </div>
            <span className="text-[11px] font-mono font-semibold text-muted-foreground" dir="ltr">
              {supportPhoneFormatted}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={copyErrorDetails}
              className="flex-1 min-w-[140px] inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-border/80 bg-card px-3 text-xs font-semibold text-foreground hover:bg-surface-2 transition active:scale-95 cursor-pointer shadow-xs"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    تم نسخ التقرير الفني ✓
                  </span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5 text-muted-foreground" />
                  <span>نسخ التقرير الفني</span>
                </>
              )}
            </button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[140px] inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-3 text-xs font-bold transition active:scale-95 shadow-sm"
            >
              <MessageSquare className="size-3.5" />
              <span>إرسال للمطور عبر واتساب</span>
            </a>
          </div>
        </div>

        {/* Developer Diagnostics Accordion (For Programmers & Debugging) */}
        <div className="pt-2 border-t border-border/50 text-right">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between text-xs font-bold text-muted-foreground hover:text-foreground py-1 transition cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Terminal className="size-3.5 text-amber-500" />
              <span>تفاصيل تشخيص المبرمج (Developer Diagnostics)</span>
            </span>
            <ChevronDown
              className={`size-3.5 transition-transform duration-200 ${showDetails ? "rotate-180" : ""}`}
            />
          </button>

          {showDetails && (
            <div className="mt-3 p-3.5 rounded-2xl bg-zinc-950/80 border border-border/80 font-mono text-[11px] text-zinc-300 overflow-x-auto text-left dir-ltr max-h-56 space-y-2">
              <div className="text-emerald-400 font-bold border-b border-zinc-800 pb-1.5">
                // System Layer: {diagnostic.layer.toUpperCase()} | Code: {diagnostic.technicalCode}
              </div>
              <div className="text-amber-300 font-semibold">
                // Recommendation: {diagnostic.devRecommendation}
              </div>
              <div className="text-rose-400 font-bold">
                {error?.name || "Error"}: {error?.message || "Unknown error"}
              </div>
              {error?.stack && (
                <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap font-mono mt-1">
                  {error.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
