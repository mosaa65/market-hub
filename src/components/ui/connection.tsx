import * as React from "react";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";

/**
 * Connection awareness.
 *
 * Closes the audit's resilience gap: previously a dropped connection produced
 * either a silent empty list or a raw error toast, with no way for the user to
 * tell "there is nothing here" apart from "we could not reach the server".
 *
 * `useOnline()` reports connectivity; `ConnectionBanner` surfaces it at the top of
 * the app and offers a retry that refetches everything in the cache.
 */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  React.useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

export function ConnectionBanner() {
  const online = useOnline();
  const queryClient = useQueryClient();
  const [reconnecting, setReconnecting] = React.useState(false);

  const retry = async () => {
    setReconnecting(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setReconnecting(false);
    }
  };

  if (online) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 border-b border-warning-fg/25 bg-tone-warning px-4 py-2 text-xs text-tone-warning-fg"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      <span className="font-medium">
        لا يوجد اتصال بالإنترنت — سيتم تحديث البيانات عند عودة الاتصال
      </span>
      <button
        type="button"
        onClick={retry}
        className="ms-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        {reconnecting ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <RefreshCw className="size-3" />
        )}
        إعادة المحاولة
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Network-aware error state                                          */
/* ------------------------------------------------------------------ */

/**
 * Turns a raw query error into something a shop user can act on.
 * Distinguishes "you are offline" from "the server refused" from "this record
 * does not exist", because the remedy is different in each case.
 */
export function describeQueryError(error: unknown): {
  title: string;
  description: string;
  canRetry: boolean;
} {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = (error as { status?: number } | null)?.status;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (offline || /failed to fetch|networkerror|load failed/i.test(message)) {
    return {
      title: "تعذّر الاتصال بالخادم",
      description: "تحقّق من اتصال الإنترنت ثم أعد المحاولة. لم يتم فقدان أي بيانات.",
      canRetry: true,
    };
  }

  if (status === 401 || /jwt|not authenticated|unauthorized/i.test(message)) {
    return {
      title: "انتهت صلاحية الجلسة",
      description: "يرجى تسجيل الدخول مرة أخرى للمتابعة.",
      canRetry: false,
    };
  }

  if (status === 403 || /permission denied|row-level security|violates row-level/i.test(message)) {
    return {
      title: "لا تملك صلاحية الوصول",
      description: "تواصل مع مدير النظام لمنحك الصلاحية المطلوبة.",
      canRetry: false,
    };
  }

  if (status === 404 || /not found|does not exist/i.test(message)) {
    return {
      title: "السجل غير موجود",
      description: "ربما تم حذفه أو نقله من مستخدم آخر.",
      canRetry: false,
    };
  }

  if (status === 409 || /duplicate key|unique constraint/i.test(message)) {
    return {
      title: "السجل موجود مسبقًا",
      description: "هذه القيمة مستخدمة بالفعل. جرّب قيمة أخرى.",
      canRetry: false,
    };
  }

  if (typeof status === "number" && status >= 500) {
    return {
      title: "خطأ في الخادم",
      description: "حدثت مشكلة مؤقتة في الخادم. أعد المحاولة بعد قليل.",
      canRetry: true,
    };
  }

  return {
    title: "تعذّر تحميل البيانات",
    description: message || "حدث خطأ غير متوقع.",
    canRetry: true,
  };
}

export interface QueryErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  /** Renders a compact variant suitable for inside a panel/table body. */
  compact?: boolean;
  className?: string;
}

export function QueryErrorState({
  error,
  onRetry,
  compact = false,
  className,
}: QueryErrorStateProps) {
  const info = describeQueryError(error);

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 text-center",
        compact ? "px-6 py-10" : "px-6 py-16",
        className,
      )}
    >
      <div className="grid h-11 w-11 place-items-center rounded-2xl border border-danger-fg/25 bg-tone-danger text-tone-danger-fg">
        <WifiOff className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{info.title}</p>
        <p className="mx-auto max-w-sm text-xs leading-5 text-muted-foreground">
          {info.description}
        </p>
      </div>
      {info.canRetry && onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} icon={<RefreshCw />}>
          إعادة المحاولة
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline refreshing indicator (for infinite lists)                   */
/* ------------------------------------------------------------------ */

export function InlineRefreshing({ label = "جارٍ التحديث…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Spinner size="sm" />
      {label}
    </span>
  );
}
