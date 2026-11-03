/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useState } from "react";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import { CheckCircle2, AlertTriangle, AlertOctagon, Info, Loader2 } from "lucide-react";
import { playToastSound, getStoredToastPosition, type ToastPositionType } from "@/lib/toast-sound";

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
    try {
      playToastSound("error");
    } catch {
      /* ignore */
    }
    return originalError(message, {
      // إعطاء مدة أطول لرسائل الخطأ حتى يتمكن المستخدم من قراءتها بوضوح
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
            <CheckCircle2 className="size-4.5 shrink-0" strokeWidth={2.4} />
          </div>
        ),
        error: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-error">
            <AlertOctagon className="size-4.5 shrink-0" strokeWidth={2.4} />
          </div>
        ),
        warning: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-warning">
            <AlertTriangle className="size-4.5 shrink-0" strokeWidth={2.4} />
          </div>
        ),
        info: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-info">
            <Info className="size-4.5 shrink-0" strokeWidth={2.4} />
          </div>
        ),
        loading: (
          <div className="vortex-toast-icon-badge vortex-toast-icon-loading">
            <Loader2 className="size-4.5 shrink-0 animate-spin" strokeWidth={2.4} />
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
