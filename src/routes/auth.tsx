import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  Loader2,
  ShieldCheck,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  LogIn,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { InamaSoftFooter } from "@/components/inama-soft-footer";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "تسجيل الدخول — فورتيكس ERP" }] }),
  component: AuthPage,
});

const loginSchema = (t: (key: string) => string) =>
  z.object({
    email: z
      .string()
      .trim()
      .email({ message: t("auth.invalid_email") })
      .max(255, { message: t("auth.email_too_long") }),
    password: z
      .string()
      .min(6, { message: t("auth.password_short") })
      .max(72, { message: t("auth.password_too_long") }),
  });

function AuthPage() {
  const { t, dir } = useI18n();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const logoMarkUrl = "/vortex-erp-mark.png";
  const logoWordmarkUrl = "/vortex-erp-wordmark.png";
  const isRtl = dir === "rtl";

  useEffect(() => {
    if (session) navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = loginSchema(t).safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    setLoading(true);

    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      if (signInData?.session) {
        toast.success(t("auth.signin_success"));
        navigate({ to: "/dashboard", replace: true });
        return;
      }

      // Shouldn't reach here, but handle gracefully
      throw new Error(
        isRtl ? "فشل تسجيل الدخول. يرجى المحاولة مرة أخرى." : "Login failed. Please try again.",
      );
    } catch (err: unknown) {
      console.error("[Auth] Login error:", err);

      // Extract meaningful error message
      let rawMsg = "";
      if (err instanceof Error) {
        rawMsg = err.message;
      } else if (typeof err === "object" && err !== null) {
        rawMsg =
          (err as any).message ??
          (err as any).msg ??
          (err as any).error_description ??
          JSON.stringify(err);
      } else {
        rawMsg = String(err);
      }

      const message = rawMsg.toLowerCase();
      const translatedError =
        message.includes("invalid login credentials") || message.includes("invalid_credentials")
          ? isRtl
            ? "بيانات الدخول غير صحيحة. يرجى التحقق من البريد وكلمة المرور."
            : t("auth.invalid_credentials")
          : message.includes("email not confirmed")
            ? isRtl
              ? "البريد الإلكتروني بحاجة لتأكيد. يرجى مراجعة بريدك أو التواصل مع الإدارة."
              : "Email not confirmed yet."
            : message.includes("network") || message.includes("fetch")
              ? t("auth.network_error")
              : rawMsg ||
                (isRtl
                  ? "فشل تسجيل الدخول. يرجى المحاولة لاحقاً."
                  : "Login failed. Please try again later.");
      toast.error(translatedError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="relative flex min-h-screen flex-col justify-between overflow-x-hidden bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.14),_transparent_50%),radial-gradient(ellipse_at_bottom,_rgba(16,185,129,0.12),_transparent_50%)] text-foreground"
      dir={dir}
    >
      {/* Background ambient light */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 start-1/4 h-[32rem] w-[32rem] rounded-full bg-primary/20 blur-[150px]" />
        <div className="absolute -bottom-40 end-1/4 h-[28rem] w-[28rem] rounded-full bg-emerald-500/15 blur-[150px]" />
      </div>

      <div className="h-4 sm:h-8" />

      {/* Main Container */}
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card/85 shadow-[0_25px_70px_rgba(0,0,0,0.16)] backdrop-blur-2xl transition-all">
          <div className="grid lg:grid-cols-[1fr_1fr]">
            {/* Visual Branding Column */}
            <div className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-primary via-primary/95 to-chart-4 p-8 text-primary-foreground sm:p-10">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.25),_transparent_40%)]" />

              <div className="relative z-10">
                <img
                  src={logoWordmarkUrl}
                  alt="Vortex ERP"
                  className="mb-5 h-12 w-auto max-w-full object-contain object-start mix-blend-screen sm:h-14"
                />
                <div className="inline-flex items-center gap-2.5 rounded-full border border-white/25 bg-white/15 px-3.5 py-1.5 text-xs font-semibold backdrop-blur-md shadow-sm">
                  <img
                    src={logoMarkUrl}
                    alt={t("app.name")}
                    className="h-4.5 w-4.5 rounded-md object-contain bg-white/90 p-0.5"
                    onError={(event) => {
                      event.currentTarget.style.visibility = "hidden";
                    }}
                  />
                  <span>{t("app.name")} ERP</span>
                </div>

                <h1 className="mt-6 text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug">
                  {isRtl
                    ? "منظومة فورتيكس السحابية لإدارة المؤسسات"
                    : "Vortex ERP Enterprise Cloud Platform"}
                </h1>

                <p className="mt-3 text-xs sm:text-sm leading-relaxed text-primary-foreground/90">
                  {t("app.tagline")}
                </p>

                {/* Core Advantages */}
                <div className="mt-6 space-y-2.5 text-xs sm:text-[13px] text-primary-foreground/95">
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20">
                      <CheckCircle2 className="h-3 w-3 text-white" />
                    </div>
                    <span>
                      {isRtl
                        ? "نقاط بيع سريعة، باركود، وإدارة المخزون"
                        : "Fast POS, Barcode & Stock Management"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20">
                      <CheckCircle2 className="h-3 w-3 text-white" />
                    </div>
                    <span>
                      {isRtl
                        ? "تعدد الفروع، الدفعات وتواريخ الصلاحية"
                        : "Multi-warehouse, Batches & Expiry Dates"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20">
                      <CheckCircle2 className="h-3 w-3 text-white" />
                    </div>
                    <span>
                      {isRtl
                        ? "محاسبة مالية متقدمة وكشوفات حساب تفصيلية"
                        : "Advanced Accounting & Financial Statements"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Security Badge */}
              <div className="relative z-10 mt-8 rounded-xl border border-white/20 bg-white/10 p-3 backdrop-blur-md">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/20">
                    <ShieldCheck className="h-4 w-4 text-white" />
                  </div>
                  <div className="text-xs">
                    <p className="font-bold">
                      {isRtl ? "نظام آمن ومشفر بالكامل" : "Fully Secure & Encrypted"}
                    </p>
                    <p className="text-primary-foreground/80 text-[11px]">
                      {isRtl
                        ? "إدارة الصلاحيات والمستخدمين تتم مركزياً عبر إدارة النظام."
                        : "User access is strictly managed by system administrators."}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Login Form Column */}
            <div className="flex flex-col justify-between p-8 sm:p-10">
              <div>
                {/* Brand Header */}
                <div className="flex items-center gap-3 pb-5 border-b border-border/60">
                  <img
                    src={logoMarkUrl}
                    alt={t("app.name")}
                    className="h-9 w-9 shrink-0 rounded-xl object-contain bg-surface-2 p-1 border border-border/70 shadow-sm"
                    onError={(event) => {
                      event.currentTarget.style.visibility = "hidden";
                    }}
                  />
                  <div>
                    <h2 className="text-base font-bold text-foreground">{t("app.name")}</h2>
                    <p className="text-xs text-muted-foreground">{t("app.tagline")}</p>
                  </div>
                </div>

                {/* Subtitle */}
                <div className="mt-5">
                  <h3 className="text-xl font-bold tracking-tight text-foreground">
                    {isRtl ? "تسجيل الدخول للنظام" : "Sign In to ERP"}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isRtl
                      ? "أدخل بيانات حسابك للمتابعة إلى لوحة التحكم"
                      : "Enter your credentials to access your dashboard"}
                  </p>
                </div>

                {/* Authentication Form */}
                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-foreground/80">
                      {t("common.email")}
                    </label>
                    <div className="relative flex items-center">
                      <Mail className="absolute start-3.5 h-4 w-4 text-muted-foreground" />
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        type="email"
                        autoComplete="email"
                        required
                        className="h-11 w-full rounded-xl border border-border/80 bg-surface-1 ps-10 pe-4 text-sm text-foreground placeholder:text-muted-foreground/60 transition focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="example@domain.com"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-foreground/80">
                      {t("common.password")}
                    </label>
                    <div className="relative flex items-center">
                      <Lock className="absolute start-3.5 h-4 w-4 text-muted-foreground" />
                      <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        minLength={6}
                        className="h-11 w-full rounded-xl border border-border/80 bg-surface-1 ps-10 pe-11 text-sm text-foreground placeholder:text-muted-foreground/60 transition focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute end-3 grid h-7 w-7 place-items-center text-muted-foreground hover:text-foreground transition"
                        title={
                          showPassword
                            ? isRtl
                              ? "إخفاء كلمة المرور"
                              : "Hide password"
                            : isRtl
                              ? "إظهار كلمة المرور"
                              : "Show password"
                        }
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/90 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                    <span>
                      {loading
                        ? isRtl
                          ? "جاري التحقق..."
                          : "Signing in..."
                        : isRtl
                          ? "دخول إلى النظام"
                          : "Sign In"}
                    </span>
                  </button>
                </form>
              </div>

              {/* Administrative Notice */}
              <div className="mt-6 pt-3 border-t border-border/50 text-center text-[11px] text-muted-foreground">
                <span>
                  {isRtl
                    ? "إنشاء وتعيين الحسابات يتم حصراً عبر إدارة النظام والمشرفين."
                    : "Account provisioning is restricted to authorized administrators."}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Company Branding Footer - Positioned strictly UNDER the card */}
      <footer className="mt-8 w-full">
        <InamaSoftFooter className="border-t border-border/60 bg-surface/60 backdrop-blur-md" />
      </footer>
    </div>
  );
}
