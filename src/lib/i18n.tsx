import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

type Dict = Record<string, string>;

const en: Dict = {
  "app.name": "Vortex ERP",
  "app.tagline": "Grocery & Wholesale Trading Platform",
  "nav.dashboard": "Dashboard",
  "nav.pos": "POS",
  "nav.products": "Products",
  "nav.inventory": "Inventory",
  "nav.sales": "Sales",
  "nav.purchases": "Purchases",
  "nav.returns": "Returns",
  "nav.transfers": "Stock Transfers",
  "nav.customers": "Customers",
  "nav.suppliers": "Suppliers",
  "nav.finance": "Finance",
  "nav.reports": "Reports",
  "nav.users": "Users & Roles",
  "nav.notifications": "Notifications",
  "nav.settings": "Settings",
  "nav.section.overview": "Overview",
  "nav.section.operations": "Operations",
  "nav.section.relations": "Relations",
  "nav.section.accounting": "Accounting",
  "nav.section.admin": "Administration",

  "common.search": "Search anything...",
  "common.signin": "Sign in",
  "common.signup": "Create account",
  "common.signout": "Sign out",
  "common.email": "Email",
  "common.password": "Password",
  "common.fullname": "Full name",
  "common.continue": "Continue",
  "common.continue_with_google": "Continue with Google",
  "common.or": "or",
  "common.loading": "Loading...",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.new": "New",
  "common.export": "Export",
  "common.print": "Print",
  "common.today": "Today",
  "common.theme": "Theme",
  "common.language": "Language",
  "common.coming_soon": "Coming soon",
  "common.workflow_note": "We will build out this module in the next phase.",

  "dash.title": "Dashboard",
  "dash.subtitle": "Real-time overview of your operations",
  "dash.revenue": "Revenue (30d)",
  "dash.sales": "Sales orders",
  "dash.customers": "Active customers",
  "dash.alerts": "Low stock alerts",
  "dash.recent_sales": "Recent sales",
  "dash.top_products": "Top products",
  "dash.empty": "No data yet. Create your first sale to see analytics.",

  "auth.signin_title": "Welcome back",
  "auth.signin_sub": "Sign in to continue to your workspace.",
  "auth.signup_title": "Create your workspace",
  "auth.signup_sub": "The first account becomes the owner with full access.",
  "auth.have_account": "Already have an account?",
  "auth.no_account": "Don't have an account?",

  "products.title": "Products",
  "inventory.title": "Inventory",
  "pos.title": "Point of Sale",
  "sales.title": "Sales",
  "purchases.title": "Purchases",
  "customers.title": "Customers",
  "suppliers.title": "Suppliers",
  "finance.title": "Finance",
  "reports.title": "Reports",
  "users.title": "Users & Permissions",
  "notifications.title": "Notifications",
  "settings.title": "Settings",
};

const ar: Dict = {
  "app.name": "فورتكس",
  "app.tagline": "منصة تجارة الجملة والبقالة",
  "nav.dashboard": "لوحة التحكم",
  "nav.pos": "نقطة البيع",
  "nav.products": "المنتجات",
  "nav.inventory": "المخزون",
  "nav.sales": "المبيعات",
  "nav.purchases": "المشتريات",
  "nav.returns": "المرتجعات",
  "nav.transfers": "تحويلات المخزون",
  "nav.customers": "العملاء",
  "nav.suppliers": "الموردون",
  "nav.finance": "المالية",
  "nav.reports": "التقارير",
  "nav.users": "المستخدمون والصلاحيات",
  "nav.notifications": "الإشعارات",
  "nav.settings": "الإعدادات",
  "nav.section.overview": "نظرة عامة",
  "nav.section.operations": "العمليات",
  "nav.section.relations": "العلاقات",
  "nav.section.accounting": "المحاسبة",
  "nav.section.admin": "الإدارة",

  "common.search": "ابحث عن أي شيء...",
  "common.signin": "تسجيل الدخول",
  "common.signup": "إنشاء حساب",
  "common.signout": "تسجيل الخروج",
  "common.email": "البريد الإلكتروني",
  "common.password": "كلمة المرور",
  "common.fullname": "الاسم الكامل",
  "common.continue": "متابعة",
  "common.continue_with_google": "المتابعة مع جوجل",
  "common.or": "أو",
  "common.loading": "جارٍ التحميل...",
  "common.cancel": "إلغاء",
  "common.save": "حفظ",
  "common.new": "جديد",
  "common.export": "تصدير",
  "common.print": "طباعة",
  "common.today": "اليوم",
  "common.theme": "السمة",
  "common.language": "اللغة",
  "common.coming_soon": "قريباً",
  "common.workflow_note": "سنقوم ببناء هذه الوحدة في المرحلة التالية.",

  "dash.title": "لوحة التحكم",
  "dash.subtitle": "نظرة فورية على عملياتك",
  "dash.revenue": "الإيرادات (30 يوم)",
  "dash.sales": "طلبات البيع",
  "dash.customers": "العملاء النشطون",
  "dash.alerts": "تنبيهات المخزون المنخفض",
  "dash.recent_sales": "أحدث المبيعات",
  "dash.top_products": "أفضل المنتجات",
  "dash.empty": "لا توجد بيانات بعد. أنشئ أول عملية بيع لعرض التحليلات.",

  "auth.signin_title": "مرحباً بعودتك",
  "auth.signin_sub": "سجل الدخول للمتابعة إلى مساحة عملك.",
  "auth.signup_title": "أنشئ مساحة عملك",
  "auth.signup_sub": "أول حساب يصبح المالك بصلاحيات كاملة.",
  "auth.have_account": "لديك حساب بالفعل؟",
  "auth.no_account": "ليس لديك حساب؟",

  "products.title": "المنتجات",
  "inventory.title": "المخزون",
  "pos.title": "نقطة البيع",
  "sales.title": "المبيعات",
  "purchases.title": "المشتريات",
  "customers.title": "العملاء",
  "suppliers.title": "الموردون",
  "finance.title": "المالية",
  "reports.title": "التقارير",
  "users.title": "المستخدمون والصلاحيات",
  "notifications.title": "الإشعارات",
  "settings.title": "الإعدادات",
};

const dicts: Record<Lang, Dict> = { en, ar };

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  dir: "ltr" | "rtl";
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    return (localStorage.getItem("lang") as Lang) || "en";
  });

  useEffect(() => {
    const dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
    localStorage.setItem("lang", lang);
  }, [lang]);

  const value: I18nCtx = {
    lang,
    setLang: setLangState,
    dir: lang === "ar" ? "rtl" : "ltr",
    t: (key) => dicts[lang][key] ?? key,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be used inside <I18nProvider>");
  return c;
}
