import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  RotateCcw,
  Home,
  ShieldCheck,
  ChevronDown,
  Copy,
  Check,
  MessageSquare,
  Phone,
} from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth";
import { ModulesProvider } from "@/lib/modules";
import { ThemeProvider, THEME_BOOT_SCRIPT } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";
import { IosInstallPrompt } from "@/components/IosInstallPrompt";
import { VortexSplashScreen } from "@/components/VortexSplashScreen";
import { VortexWelcomeOnboarding } from "@/components/VortexWelcomeOnboarding";
import { VortexSmartError } from "@/components/vortex-smart-error";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 selection:bg-primary/20">
      <div className="max-w-md w-full p-8 text-center rounded-3xl border border-border/80 bg-card/60 backdrop-blur-xl shadow-2xl space-y-4">
        <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-muted/70 text-foreground border border-border/60 shadow-inner">
          <span className="text-2xl font-black font-mono">404</span>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-xl font-black tracking-tight text-foreground">الصفحة غير موجودة</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            الرابط الذي تحاول الوصول إليه غير موجود أو تم نقله لمكان آخر.
          </p>
        </div>
        <div className="pt-2">
          <a
            href="/"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-foreground text-background px-6 text-xs font-bold shadow-md hover:opacity-95 transition"
          >
            <Home className="size-4" />
            <span>العودة للرئيسية</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: any; reset: () => void }) {
  return <VortexSmartError error={error} reset={reset} />;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "فورتيكس ERP - منصة البيع بالجملة والتجزئة" },
      {
        name: "description",
        content:
          "نظام ERP متكامل لإدارة المبيعات، المشتريات، المخزون، نقاط البيع، والمالية في منصة واحدة.",
      },
      { name: "author", content: "Inama Soft" },
      { name: "theme-color", content: "#0A0A0B" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Vortex ERP" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "application-name", content: "Vortex ERP" },
      { property: "og:title", content: "فورتيكس ERP - منصة البيع بالجملة والتجزئة" },
      {
        property: "og:description",
        content:
          "نظام ERP متكامل لإدارة المبيعات، المشتريات، المخزون، نقاط البيع، والمالية في منصة واحدة.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://market-hub-two-theta.vercel.app/" },
      { property: "og:site_name", content: "Vortex ERP" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "فورتيكس ERP - منصة البيع بالجملة والتجزئة" },
      {
        name: "twitter:description",
        content:
          "نظام ERP متكامل لإدارة المبيعات، المشتريات، المخزون، نقاط البيع، والمالية في منصة واحدة.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/140ea316-e570-4ca2-bfbb-ac4e2ba79f9b",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/140ea316-e570-4ca2-bfbb-ac4e2ba79f9b",
      },
    ],
    links: [
      { rel: "canonical", href: "https://market-hub-two-theta.vercel.app/" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/pwa-192x192.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className="light" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/**
         * يجب أن يسبق أي شيء مرئي: يقرأ السمة المحفوظة ويطبّقها على <html>
         * قبل أول رسم، فلا يومض التطبيق بالوضع الفاتح ثم ينقلب ليلاً.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <ModulesProvider>
              <VortexSplashScreen />
              <VortexWelcomeOnboarding />
              <Outlet />
              <IosInstallPrompt />
              <Toaster />
            </ModulesProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
