import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  Loader2, ShieldCheck, ArrowLeftRight, Mail, Lock, Eye, EyeOff,
  Sparkles, CheckCircle2, Boxes, Receipt, BarChart3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { InamaSoftFooter } from "@/components/inama-soft-footer";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "تسجيل الدخول — فورتيكس ERP" }] }),
  component: AuthPage,
});

const buildSchema = (t: (key: string) => string) =>
  z.object({
    email: z.string().trim().email({ message: t("auth.invalid_email") }).max(255, { message: t("auth.email_too_long") }),
    password: z.string().min(6, { message: t("auth.password_short") }).max(72, { message: t("auth.password_too_long") }),
    fullName: z.string().trim().min(1, { message: t("auth.fullname_required") }).max(100, { message: t("auth.fullname_too_long") }).optional(),
  });

function AuthPage() {
  const { t, dir } = useI18n();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>("/inama-soft-logo.ico");
  const isRtl = dir === "rtl";

  useEffect(() => {
    supabase
      .from("company_settings")
      .select("logo_url")
      .order("id")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.logo_url) setLogoUrl(data.logo_url);
      });
  }, []);

  useEffect(() => {
    if (session) navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = buildSchema(t).safeParse({ email, password, fullName: mode === "signup" ? fullName : undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success(t("auth.signup_success"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success(t("auth.signin_success"));
      }
    } catch (err: any) {
      const message = String(err?.message ?? "").toLowerCase();
      const translatedError =
        message.includes("invalid login credentials") || message.includes("invalid_credentials")
          ? t("auth.invalid_credentials")
          : message.includes("email") && message.includes("already")
            ? t("auth.email_exists")
            : message.includes("network") || message.includes("fetch")
              ? t("auth.network_error")
              : t("auth.failed");
      toast.error(translatedError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="relative flex min-h-screen flex-col justify-between overflow-x-hidden bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.15),_transparent_50%),radial-gradient(ellipse_at_bottom,_rgba(16,185,129,0.12),_transparent_50%)] text-foreground"
      dir={dir}
    >
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 start-1/4 h-[32rem] w-[32rem] rounded-full bg-primary/20 blur-[150px]" />
        <div className="absolute -bottom-40 end-1/4 h-[28rem] w-[28rem] rounded-full bg-emerald-500/15 blur-[150px]" />
      </div>

      {/* Spacer for top balance */}
      <div className="h-4 sm:h-8" />

      {/* Main Login Container */}
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-[32px] border border-border/70 bg-card/80 shadow-[0_25px_70px_rgba(0,0,0,0.18)] backdrop-blur-2xl transition-all">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            {/* Visual Branding Hero Column */}
            <div className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-primary via-primary/95 to-chart-4 p-8 text-primary-foreground sm:p-12">
              {/* Subtle mesh overlay */}
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.25),_transparent_40%)]" />

              <div className="relative z-10">
                {/* Brand Badge */}
                <div className="inline-flex items-center gap-2.5 rounded-full border border-white/25 bg-white/15 px-4 py-2 text-xs font-semibold backdrop-blur-md shadow-sm">
                  <img
                    src={logoUrl}
                    alt={t("app.name")}
                    className="h-5 w-5 rounded-md object-contain bg-white/90 p-0.5"
                    onError={() => setLogoUrl("/inama-soft-logo.ico")}
                  />
                  <span>{t("app.name")} ERP</span>
                </div>

                <h1 className="mt-8 text-2xl sm:text-4xl font-extrabold tracking-tight leading-snug">
                  {isRtl ? "منظومة فورتيكس لإدارة المؤسسات والأنشطة التجارية" : "Vortex ERP Enterprise Cloud Platform"}
                </h1>

                <p className="mt-4 text-xs sm:text-sm leading-relaxed text-primary-foreground/90 max-w-md">
                  {isRtl
                    ? "حل متكامل وسحابي لإدارة نقاط البيع، المخزون، المشتريات، الحسابات، وتعدد الفروع بسهولة وأمان فائق."
                    : "Comprehensive cloud solution to streamline POS, stock, purchases, accounting, and multi-warehouse operations."}
                </p>

                {/* Key Highlights list */}
                <div className="mt-8 space-y-3">
                  <div className="flex items-center gap-3 text-xs sm:text-sm text-primary-foreground/95">
                    <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/20">
                      <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span>{isRtl ? "نقاط بيع سريعة وطباعة فورية وملصقات باركود" : "Fast POS, instant receipt and barcode printing"}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs sm:text-sm text-primary-foreground/95">
                    <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/20">
                      <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span>{isRtl ? "إدارة المستودعات، الدفعات، وتواريخ الصلاحية" : "Multi-warehouse, batch numbers and expiry tracking"}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs sm:text-sm text-primary-foreground/95">
                    <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/20">
                      <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span>{isRtl ? "محاسبة مالية متقدمة، ميزان مراجعة وكشوفات حساب" : "Advanced accounting, journals and financial statements"}</span>
                  </div>
                </div>
              </div>

              {/* Security guarantee footer on visual side */}
              <div className="relative z-10 mt-10 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/20">
                    <ShieldCheck className="h-5 w-5 text-white" />
                  </div>
                  <div className="text-xs">
                    <p className="font-bold">{isRtl ? "بيانات مشفرة وآمنة 100%" : "100% Secure & Encrypted"}</p>
                    <p className="text-primary-foreground/80 text-[11px] mt-0.5">
                      {isRtl ? "نظام موثوق ومعتمد للعمليات اليومية المستمرة." : "High availability ERP architecture with role-based access."}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Login / Signup Form Column */}
            <div className="flex flex-col justify-between p-8 sm:p-12">
              <div>
                {/* Form Top Brand Header */}
                <div className="flex items-center justify-between gap-4 pb-6 border-b border-border/60">
                  <div className="flex items-center gap-3">
                    <img
                      src={logoUrl}
                      alt={t("app.name")}
                      className="h-10 w-10 shrink-0 rounded-2xl object-contain bg-surface-2 p-1.5 border border-border/70 shadow-sm"
                      onError={() => setLogoUrl("/inama-soft-logo.ico")}
                    />
                    <div>
                      <h2 className="text-base font-bold text-foreground">{t("app.name")}</h2>
                      <p className="text-xs text-muted-foreground">{t("app.tagline")}</p>
                    </div>
                  </div>

                  {/* Mode switcher badge */}
                  <div className="inline-flex rounded-xl bg-surface-2 p-1 border border-border/60">
                    <button
                      type="button"
                      onClick={() => setMode("signin")}
                      className={cn(
                        "rounded-lg px-3 py-1 text-xs font-semibold transition-all",
                        mode === "signin"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t("common.signin")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("signup")}
                      className={cn(
                        "rounded-lg px-3 py-1 text-xs font-semibold transition-all",
                        mode === "signup"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t("common.signup")}
                    </button>
                  </div>
                </div>

                {/* Form Title */}
                <div className="mt-6">
                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                    {mode === "signin" ? t("auth.signin_title") : t("auth.signup_title")}
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                    {mode === "signin" ? t("auth.signin_sub") : t("auth.signup_sub")}
                  </p>
                </div>

                {/* Authentication Form */}
                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  {mode === "signup" && (
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-foreground/80">
                        {t("common.fullname")}
                      </label>
                      <div className="relative flex items-center">
                        <Sparkles className="absolute start-3.5 h-4 w-4 text-muted-foreground" />
                        <input
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          type="text"
                          autoComplete="name"
                          required
                          className="h-11 w-full rounded-2xl border border-border/80 bg-surface-1 ps-10 pe-4 text-sm text-foreground placeholder:text-muted-foreground/60 transition focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                          placeholder={t("auth.name_placeholder")}
                        />
                      </div>
                    </div>
                  )}

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
                        className="h-11 w-full rounded-2xl border border-border/80 bg-surface-1 ps-10 pe-4 text-sm text-foreground placeholder:text-muted-foreground/60 transition focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder={t("auth.email_placeholder")}
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
                        autoComplete={mode === "signin" ? "current-password" : "new-password"}
                        required
                        minLength={6}
                        className="h-11 w-full rounded-2xl border border-border/80 bg-surface-1 ps-10 pe-11 text-sm text-foreground placeholder:text-muted-foreground/60 transition focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute end-3 grid h-7 w-7 place-items-center text-muted-foreground hover:text-foreground transition"
                        title={showPassword ? (isRtl ? "إخفاء كلمة المرور" : "Hide password") : (isRtl ? "إظهار كلمة المرور" : "Show password")}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary/90 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
                  >
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>{mode === "signin" ? t("common.signin") : t("common.signup")}</span>
                  </button>
                </form>
              </div>

              {/* Bottom Switch Mode Link */}
              <div className="mt-8 pt-4 border-t border-border/50 text-center text-xs text-muted-foreground">
                <span>{mode === "signin" ? t("auth.no_account") : t("auth.have_account")} </span>
                <button
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  className="inline-flex items-center gap-1 font-bold text-primary hover:underline transition ms-1"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  <span>{mode === "signin" ? t("common.signup") : t("common.signin")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Company Branding Bar - Strictly Rendered UNDER the Form */}
      <footer className="mt-8 w-full">
        <InamaSoftFooter className="border-t border-border/60 bg-surface/60 backdrop-blur-md" />
      </footer>
    </div>
  );
}
