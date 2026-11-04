/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useState } from "react";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import { CheckCircle2, AlertTriangle, AlertOctagon, Info, Loader2 } from "lucide-react";
import { playToastSound, getStoredToastPosition, type ToastPositionType } from "@/lib/toast-sound";

// =========================================================================
// التحقق الذكي: هل الرسالة قاعدة عمل / تحقق تشغيلي وليست خطأ فادحاً غير متوقع؟
// كاختيار عميل، تحديد طريقة دفع، كمية غير متوفرة، حقول مطلوبة
// =========================================================================
function isBusinessRuleNotice(msg: unknown): boolean {
  if (typeof msg !== "string") return false;
  const text = msg.toLowerCase();

  // أخطاء فنية واستثناءات غير متوقعة يجب أن تبقى حمراء
  const technicalErrors = [
    "database",
    "server error",
    "500",
    "crash",
    "network error",
    "failed to fetch",
    "تعذر الاتصال",
    "خطأ غير متوقع",
    "خطأ برمجي",
    "استثناء",
    "internal error",
  ];

  if (technicalErrors.some((kw) => text.includes(kw))) {
    return false;
  }

  // كلمات قواعد العمل والتحقق والملاحظات الإجرائية
  const ruleKeywords = [
    "يرجى",
    "الرجاء",
    "رجاء",
    "فضلاً",
    "فضلا",
    "يجب",
    "تأكد",
    "مطلوب",
    "تحديد",
    "اختر",
    "اختيار",
    "غير كاف",
    "غير متوفر",
    "لا يمكن",
    "لا يوجد",
    "أدخل",
    "ادخل",
    "أضف",
    "اضف",
    "تنبيه",
    "تحذير",
    "قواعد",
    "الحد الأدنى",
    "الحد الاقصى",
    "فارغ",
    "عميل",
    "طريقة الدفع",
    "الآجل",
    "الرصيد",
    "please",
    "required",
    "must",
    "cannot",
    "choose",
    "select",
    "insufficient",
    "missing",
  ];

  return ruleKeywords.some((kw) => text.includes(kw));
}

// =========================================================================
// اعتراض وتطوير دوال الإشعارات الموحدة للنظام بأكمله
// =========================================================================
const originalSuccess = sonnerToast.success;
const originalError = sonnerToast.error;
const originalWarning = sonnerToast.warning;
const originalInfo = sonnerToast.info;

// ضمان عدم التكرار إذا تم إعادة تحميل المكون
const INTERCEPTED_FLAG = "__vortex_toast_enhanced__";

if (!(sonnerToast as unknown as Record<string, boolean>)[INTERCEPTED_FLAG]) {
  (sonnerToast as unknown as Record<string, boolean>)[INTERCEPTED_FLAG] = true;

  sonnerToast.success = (message, data) => {
    try {
      playToastSound("success");
    } catch {
      /* ignore */
    }
    return originalSuccess(message, {
      duration: data?.duration ?? 3800,
      ...data,
    });
  };

  sonnerToast.error = (message, data) => {
    // إذا كانت الرسالة قاعدة عمل أو ملاحظة تمنع العملية (كالتحقق واختيار العميل)
    // نوجهها تلقائياً إلى تحذير برتقالي أنيق مع صوت التنبيه الهادئ
    if (isBusinessRuleNotice(message)) {
      try {
        playToastSound("warning");
      } catch {
        /* ignore */
      }
      return originalWarning(message, {
        duration: data?.duration ?? 4500,
        ...data,
      });
    }

    try {
      playToastSound("error");
    } catch {
      /* ignore */
    }
    return originalError(message, {
      // إعطاء مدة أطول لرسائل الخطأ التقني غير المتوقع
      duration: data?.duration ?? 5500,
      ...data,
    });
  };

  sonnerToast.warning = (message, data) => {
    try {
      playToastSound("warning");
    } catch {
      /* ignore */
    }
    return originalWarning(message, {
      duration: data?.duration ?? 4500,
      ...data,
    });
  };

  sonnerToast.info = (message, data) => {
    try {
      playToastSound("info");
    } catch {
      /* ignore */
    }
    return originalInfo(message, {
      duration: data?.duration ?? 4000,
      ...data,
    });
  };
}

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * مكون الإشعارات الموحد والفاخر لنظام Vortex ERP
 * يدعم الموضع العلوي الذكي للهواتف، النغمات التفاعلية، والألوان والأيقونات الفاخرة
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const [position, setPosition] = useState<ToastPositionType>(() => getStoredToastPosition());

  useEffect(() => {
    const handlePosChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ position: ToastPositionType }>;
      if (customEvent.detail?.position) {
        setPosition(customEvent.detail.position);
      }
    };

    window.addEventListener("vortex-toast-position-change", handlePosChange);
    return () => {
      window.removeEventListener("vortex-toast-position-change", handlePosChange);
    };
  }, []);

  return (
    <Sonner
      className="vortex-toaster-container group"
      position={position}
      expand={true}
      richColors={false}
      closeButton={true}
      visibleToasts={4}
      gap={10}
      offset={18}
      mobileOffset={{ top: 14, left: 14, right: 14 }}
      icons={{
        success: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-success">
            <CheckCircle2 className="size-4 shrink-0" strokeWidth={2.4} />
          </div>
        ),
        error: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-error">
            <AlertOctagon className="size-4 shrink-0" strokeWidth={2.4} />
          </div>
        ),
        warning: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-warning">
            <AlertTriangle className="size-4 shrink-0" strokeWidth={2.4} />
          </div>
        ),
        info: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-info">
            <Info className="size-4 shrink-0" strokeWidth={2.4} />
          </div>
        ),
        loading: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-loading">
            <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2.4} />
          </div>
        ),
      }}
      toastOptions={{
        classNames: {
          toast: "vortex-toast-card",
          title: "vortex-toast-title",
          description: "vortex-toast-desc",
          actionButton: "vortex-toast-action-btn",
          cancelButton: "vortex-toast-cancel-btn",
          closeButton: "vortex-toast-close-btn",
          success: "vortex-toast-theme-success",
          error: "vortex-toast-theme-error",
          warning: "vortex-toast-theme-warning",
          info: "vortex-toast-theme-info",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, sonnerToast as toast };
export * from "@/lib/toast-sound";
