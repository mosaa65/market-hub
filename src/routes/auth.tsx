import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  ShieldCheck,
  Mail,
  Phone,
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
import { Button } from "@/components/ui/button";
import { CountrySelector } from "@/components/country-selector";
import { DEFAULT_COUNTRY, Country } from "@/lib/country-data";
import { formatPhoneE164, phoneToAuthEmail } from "@/lib/phone-utils";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "تسجيل الدخول — فورتيكس ERP" }] }),
  component: AuthPage,
});

function resolveCandidates(input: string, countryCode: string): string[] {
  const trimmed = input.trim();
  if (trimmed.includes("@")) {
    return [trimmed.toLowerCase()];
  }
  const digits = trimmed.replace(/\D/g, "");
  const candidates: string[] = [];
  const push = (value: string) => {
    const email = phoneToAuthEmail(value);
    if (!candidates.includes(email)) candidates.push(email);
  };

  // الرقم القادم بصيغة دولية كاملة يبدأ ببادئة الدولة (967…) — لا نلصق البادئة
  // مرة ثانية، وهذا حال من كُتب له الحساب مرقّماً بالصيغة الدولية.
  const dialDigits = countryCode.replace(/\D/g, "");
  if (digits.startsWith(dialDigits) && digits.length > dialDigits.length) {
    push(digits);
    push(digits.slice(dialDigits.length));
    push(`0${digits.slice(dialDigits.length)}`);
    return candidates;
  }

  // 1) الصيغة الدولية المعيارية (الأساس المسجل في النظام): +967771234567 → 967771234567
  // نضعها أولاً لتنجح فوراً بأول محاولة بدلاً من انتظار محاولات تفشل وتسبب بطء تسجيل الدخول
  const canonical = formatPhoneE164(digits, countryCode).replace(/\D/g, "");
  push(canonical);

  // 2) الرقم بدون أصفار بادئة كاحتياط في حال سجل بحساب محلي قديم
  const stripped = digits.replace(/^0+/, "");
  push(stripped || digits);

  // 3) الرقم الخام كما أُدخل (احتياط أخير)
  push(digits);

  return candidates;
}

const loginSchema = (t: (key: string) => string, isRtl: boolean) =>
  z.object({
    identifier: z
      .string()
      .trim()
      .min(1, {
        message: isRtl
          ? "يرجى إدخال رقم الهاتف أو البريد الإلكتروني"
          : "Please enter phone number or email",
      })
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
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const logoMarkUrl = "/vortex-erp-mark.png";
  const logoWordmarkUrl = "/vortex-erp-wordmark.png";
  const isRtl = dir === "rtl";
  /**
   * التمييز بين البريد والهاتف يجب أن يقبل أثناء الكتابة.
   *
   * المشكلة التي كانت: الشرط `includes("@")` يُقرأ مع كل ضغطة مفتاح، وكان
   * مرتبطاً بـ `maxLength` يتغيّر معه — فحظة كتابة @ يهبط الحد من 15 إلى 255
   * ثم يعود، فيُقتطع النص ولا يكتمل ".com".
   *
   * الآن نوع المُدخَل عقد مستقر يُحسم مرة واحدة من أول حرف غير رقمي، ولا
   * يُعاد الحكم عليه مع كل حرف.
   */
  const [inputMode, setInputMode] = useState<"unknown" | "phone" | "email">("unknown");
  const isEmailInput =
    inputMode === "email" || (inputMode === "unknown" && identifier.includes("@"));

  const handleIdentifierChange = (raw: string) => {
    setIdentifier(raw);

    // الفراغ يعيد النية إلى المجهول، فيصحّ تبديل النوع لاحقاً بدل الجمود
    // على قرارٍ خاطئ اتُّخذ في حرفٍ سابق.
    if (raw.trim() === "") {
      setInputMode("unknown");
      return;
    }

    if (/[@A-Za-z]/.test(raw)) {
      setInputMode("email");
      return;
    }

    // رقم فقط بعد أن حُسم النوع بريداً => المستخدم غيّر رأيه، نعود إلى رقم
    // (يمنع بقاء منتقي الدولة مخفياً مع رقم في يده).
    if (inputMode === "email" && /^\s*\d/.test(raw)) {
      setInputMode("phone");
      return;
    }

    if (inputMode === "unknown" && /\d/.test(raw)) setInputMode("phone");
  };

  useEffect(() => {
    if (session) navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = loginSchema(t, isRtl).safeParse({ identifier, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    const candidates = resolveCandidates(identifier, country.dialCode);
    setLoading(true);

    try {
      let lastError: any = null;
      let sessionEstablished = false;

      for (const email of candidates) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (!signInError && signInData?.session) {
          sessionEstablished = true;
          break;
        }

        if (signInError) {
          lastError = signInError;
        }
      }

      if (sessionEstablished) {
        toast.success(t("auth.signin_success"));
        navigate({ to: "/dashboard", replace: true });
        return;
      }

      if (lastError) {
        throw lastError;
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
            ? "بيانات الدخول غير صحيحة. يرجى التحقق من رقم الهاتف/البريد وكلمة المرور."
            : "Invalid credentials. Please check your phone/email and password."
          : message.includes("email not confirmed")
            ? isRtl
              ? "الحساب بحاجة لتأكيد. يرجى مراجعة الإدارة."
              : "Account not confirmed yet."
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
      className="relative flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground"
      dir={dir}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.18),_transparent_65%)]" />
        <div className="absolute top-1/3 start-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[150px]" />
      </div>

      <main className="relative z-10 mx-auto flex w-full flex-1 items-center px-4 py-10 sm:px-6 sm:py-14">
        <div className="mx-auto w-full max-w-[32rem]">
          <header className="mb-8 text-center sm:mb-10">
            <div className="mx-auto grid size-16 place-items-center rounded-[1.4rem] border border-primary/30 bg-primary/10 p-2 shadow-[0_10px_28px_rgba(37,99,235,0.18)]">
              <img src={logoMarkUrl} alt={t("app.name")} className="size-full object-contain" />
            </div>
            <h1 className="mt-4 text-2xl font-black tracking-tight text-foreground sm:text-3xl">
              {isRtl ? "نظام فورتكس لإدارة الأعمال" : "Vortex Business Management"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isRtl
                ? "سجّل الدخول لإدارة متجرك، مخزونك ومبيعاتك"
                : "Sign in to manage your store, inventory, and sales"}
            </p>
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("open-vortex-welcome"))}
                className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors shadow-sm cursor-pointer"
              >
                <Sparkles className="size-3.5" />
                <span>{isRtl ? "🌟 جولة تعريفية في نظام فورتكس" : "🌟 Explore Vortex ERP Tour"}</span>
              </button>
            </div>
          </header>

          <div className="grid">
            <section className="hidden">
              <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(255,255,255,0.26)_1px,transparent_1px)] [background-size:18px_18px]" />
              <div className="pointer-events-none absolute -bottom-32 -end-24 h-80 w-80 rounded-full border-[32px] border-white/10" />
              <div className="relative flex h-full flex-col">
                <div className="flex items-center justify-between gap-4">
                  <img
                    src={logoWordmarkUrl}
                    alt="Vortex ERP"
                    className="h-9 w-auto max-w-[11rem] object-contain object-start brightness-0 invert sm:h-11 sm:max-w-[14rem]"
                  />
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold backdrop-blur-sm">
                    <Sparkles className="size-3.5" />
                    {isRtl ? "منصة أعمال متكاملة" : "Integrated business platform"}
                  </span>
                </div>

                <div className="my-10 max-w-md sm:my-14 lg:my-auto">
                  <div className="mb-5 inline-flex size-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-sm backdrop-blur-sm">
                    <ShieldCheck className="size-6" />
                  </div>
                  <h1 className="text-2xl font-black leading-snug tracking-tight sm:text-[2rem]">
                    {isRtl
                      ? "إدارة متجرك بثقة، من مكان واحد."
                      : "Run your business with confidence, from one place."}
                  </h1>
                  <p className="mt-4 max-w-sm text-sm leading-7 text-primary-foreground/85">
                    {isRtl
                      ? "المبيعات والمخزون والحسابات في مساحة عمل موحدة وواضحة."
                      : "Sales, inventory, and accounting in one clear workspace."}
                  </p>

                  <div className="mt-7 grid grid-cols-3 gap-2.5 sm:gap-3">
                    {[
                      isRtl ? "نقاط البيع" : "Point of sale",
                      isRtl ? "إدارة المخزون" : "Inventory",
                      isRtl ? "تقارير مالية" : "Financials",
                    ].map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-white/15 bg-white/10 px-2 py-3 text-center text-[10px] font-semibold sm:text-[11px] backdrop-blur-sm"
                      >
                        <CheckCircle2 className="mx-auto mb-1.5 size-3.5 text-white/90" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 border-t border-white/15 pt-5 text-xs text-primary-foreground/85">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10">
                    <ShieldCheck className="size-4" />
                  </div>
                  <p>
                    {isRtl
                      ? "وصولك محمي وتُدار الصلاحيات مركزيًا عبر إدارة النظام."
                      : "Your access is protected and managed centrally by your administrators."}
                  </p>
                </div>
              </div>
            </section>

            <section className="flex flex-col justify-center rounded-[2rem] border border-border/70 bg-card px-5 py-7 shadow-[0_24px_80px_rgba(0,0,0,0.12)] backdrop-blur-xl sm:px-7 sm:py-8">
              <div className="mx-auto w-full max-w-sm">
                <div className="text-center">
                  <h2 className="text-xl font-black tracking-tight text-foreground">
                    {isRtl ? "تسجيل الدخول" : "Sign in"}
                  </h2>
                  <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                    {isRtl
                      ? "أدخل بيانات حسابك للوصول إلى متجرك"
                      : "Enter your account details to access your store"}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                  <div className="space-y-2">
                    <label
                      htmlFor="login-identifier"
                      className="block text-xs font-bold text-foreground"
                    >
                      {isEmailInput
                        ? isRtl
                          ? "البريد الإلكتروني"
                          : "Email address"
                        : isRtl
                          ? "رقم الهاتف"
                          : "Phone number"}
                    </label>
                    <div className="flex gap-2">
                      {!isEmailInput && (
                        <CountrySelector value={country} onChange={setCountry} disabled={loading} />
                      )}
                      <div className="relative flex-1">
                        {isEmailInput ? (
                          <Mail
                            className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden
                          />
                        ) : (
                          <Phone
                            className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden
                          />
                        )}
                        <input
                          id="login-identifier"
                          value={identifier}
                          onChange={(e) => handleIdentifierChange(e.target.value)}
                          type="text"
                          inputMode={isEmailInput ? "email" : "tel"}
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          required
                          disabled={loading}
                          dir="ltr"
                          className="h-12 w-full rounded-2xl border border-border bg-surface px-4 ps-10 text-sm text-foreground shadow-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground hover:border-primary/45 focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                          placeholder={isEmailInput ? "name@company.com" : `${country.placeholder}`}
                          maxLength={isEmailInput ? 254 : 32}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-bold text-foreground"
                    >
                      {t("common.password")}
                    </label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <input
                        id="login-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        minLength={6}
                        disabled={loading}
                        dir="ltr"
                        className="h-12 w-full rounded-2xl border border-border bg-surface px-4 ps-10 pe-12 text-sm text-foreground shadow-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground hover:border-primary/45 focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="absolute end-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                        aria-label={
                          showPassword
                            ? isRtl
                              ? "إخفاء كلمة المرور"
                              : "Hide password"
                            : isRtl
                              ? "إظهار كلمة المرور"
                              : "Show password"
                        }
                        aria-pressed={showPassword}
                        disabled={loading}
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" aria-hidden />
                        ) : (
                          <Eye className="size-4" aria-hidden />
                        )}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    loading={loading}
                    icon={<LogIn aria-hidden />}
                    className="mt-2 h-12 w-full rounded-2xl bg-primary text-sm font-bold shadow-[0_14px_30px_-12px_color-mix(in_oklab,var(--primary)_80%,transparent)] hover:bg-primary/90 focus-visible:ring-primary/40"
                  >
                    {loading
                      ? isRtl
                        ? "جارٍ تسجيل الدخول..."
                        : "Signing in..."
                      : isRtl
                        ? "تسجيل الدخول"
                        : "Sign in"}
                  </Button>
                </form>

                <div className="mt-7 flex items-start gap-2.5 border-t border-border/70 pt-5 text-[11px] leading-5 text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <p>
                    {isRtl
                      ? "يتم إنشاء الحسابات وإدارتها من قبل إدارة النظام فقط."
                      : "Accounts are created and managed by your system administrator only."}
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="relative z-10 w-full">
        <InamaSoftFooter className="border-t border-border/70 bg-surface/80 text-muted-foreground backdrop-blur-md" />
      </footer>
    </div>
  );
}
