import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Sparkles, Loader2, ShieldCheck, Building2, ArrowLeftRight, Mail, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

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
  const [loading, setLoading] = useState(false);
  const isRtl = dir === "rtl";

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
          email, password,
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_30%)] px-4 py-10 sm:px-6 lg:px-8" dir={dir}>
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-10rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute bottom-[-8rem] right-[-4rem] h-[24rem] w-[24rem] rounded-full bg-chart-4/20 blur-[140px]" />
      </div>

      <div className="w-full max-w-6xl rounded-[32px] border border-white/20 bg-background/80 p-3 shadow-[0_30px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        <div className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-primary via-primary/90 to-chart-4 p-8 text-primary-foreground shadow-lg sm:p-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.24),_transparent_32%)]" />
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur-sm">
                <Building2 className="h-4 w-4" />
                {t("app.name")}
              </div>

              <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
                {isRtl ? "بوابتك الرقمية لإدارة الأعمال" : "Your digital gateway to smarter operations"}
              </h2>
              <p className="mt-3 max-w-md text-sm leading-7 text-primary-foreground/85 sm:text-base">
                {isRtl
                  ? "تابع المبيعات، المخزون، والعمليات من مكان واحد مع واجهة حديثة وأداء سريع."
                  : "Run sales, stock, and daily operations from one elegant workspace with fast, reliable performance."}
              </p>

              <div className="mt-8 rounded-[24px] border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-2xl bg-white/15">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold">{isRtl ? "أمان موثوق" : "Trusted security"}</p>
                    <p className="mt-1 text-sm text-primary-foreground/80">
                      {isRtl ? "بياناتك محفوظة داخل بيئة آمنة ومهيأة للعمل اليومي." : "Your data stays protected in a secure environment built for daily operations."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/70 bg-card/80 p-6 shadow-sm sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-primary to-chart-4 text-primary-foreground shadow-sm">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("app.name")}</p>
                  <p className="text-xs text-muted-foreground">{t("app.tagline")}</p>
                </div>
              </div>
              <div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                {mode === "signin" ? t("common.signin") : t("common.signup")}
              </div>
            </div>

            <div className="mt-6 rounded-[24px] border border-border/70 bg-background/70 p-4 shadow-sm">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {mode === "signin" ? t("auth.signin_title") : t("auth.signup_title")}
              </h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {mode === "signin" ? t("auth.signin_sub") : t("auth.signup_sub")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {t("common.fullname")}
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/70 px-3 py-2 shadow-sm">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      type="text"
                      autoComplete="name"
                      required
                      className="h-10 w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      placeholder={t("auth.name_placeholder")}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t("common.email")}
                </label>
                <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/70 px-3 py-2 shadow-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    required
                    className="h-10 w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    placeholder={t("auth.email_placeholder")}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t("common.password")}
                </label>
                <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/70 px-3 py-2 shadow-sm">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    required
                    minLength={6}
                    className="h-10 w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-60"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "signin" ? t("common.signin") : t("common.signup")}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>{mode === "signin" ? t("auth.no_account") : t("auth.have_account")}</span>
              <button
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="inline-flex items-center gap-1 font-semibold text-primary transition hover:underline"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                {mode === "signin" ? t("common.signup") : t("common.signin")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
