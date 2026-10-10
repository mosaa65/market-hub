import { useState, useEffect } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { money, num } from "@/lib/format";
import {
  Sparkles,
  ShieldCheck,
  Package,
  Warehouse,
  Receipt,
  ShoppingCart,
  Users,
  AlertTriangle,
  Truck,
  Building2,
  Wallet,
  BarChart3,
  TrendingUp,
  Boxes,
  ArrowRightLeft,
  ClipboardList,
  Check,
  LogIn,
  ChevronLeft,
  ChevronRight,
  X,
  Phone,
  Building,
  CheckCircle2,
  ArrowUpRight,
  Gauge,
  FileSpreadsheet,
} from "lucide-react";

export function VortexWelcomeOnboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const location = useLocation();
  const { session } = useAuth();
  const { dir, lang } = useI18n();
  const isAr = lang === "ar";

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem("vortex_welcome_seen") === "true";
    } catch {
      return;
    }
    // تظهر الواجهة الترحيبية تلقائياً لأول تشغيل قبل تسجيل الدخول (بعد انتهاء تحميل شاشة البداية)
    if (!seen && !session) {
      const timer = setTimeout(() => setOpen(true), 1300);
      return () => clearTimeout(timer);
    }
  }, [session]);

  // Support re-opening via custom event anywhere in the app
  useEffect(() => {
    const handleOpen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("open-vortex-welcome", handleOpen);
    return () => window.removeEventListener("open-vortex-welcome", handleOpen);
  }, []);

  const handleFinish = () => {
    try {
      localStorage.setItem("vortex_welcome_seen", "true");
    } catch {
      // Ignore localStorage write failures in restricted contexts
    }
    setOpen(false);
  };

  // Queries for live system overview (فقط في حال وجود جلسة مصادقة لتجنب أخطاء 401 قبل تسجيل الدخول)
  const { data: stats } = useQuery({
    queryKey: ["vortex-welcome-overview-stats", Boolean(session)],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      if (!session) {
        return {
          productsCount: 1420,
          lowStockCount: 3,
          warehousesCount: 4,
          transfersCount: 12,
          totalSales: 485000,
          paidSales: 410000,
          receivables: 75000,
          customersCount: 260,
          suppliersCount: 45,
          purchasesCount: 88,
          companyName: isAr ? "نظام فورتكس لإدارة الأعمال" : "Vortex Business ERP",
        };
      }
      const [
        productsRes,
        inventoryRes,
        warehousesRes,
        transfersRes,
        salesRes,
        customersRes,
        suppliersRes,
        purchasesRes,
        companyRes,
      ] = await Promise.all([
        supabase.from("products").select("id, name, name_ar, min_stock, sale_price").limit(1000),
        supabase.from("inventory").select("product_id, quantity").limit(2000),
        supabase.from("warehouses").select("id, name, is_active").limit(50),
        (supabase as any).from("stock_transfers").select("id, status").limit(50),
        supabase.from("sales_invoices").select("id, total, paid, status, created_at").limit(500),
        supabase.from("customers").select("id, name, balance").limit(500),
        supabase.from("suppliers").select("id, name").limit(200),
        supabase.from("purchase_invoices").select("id, total").limit(200),
        supabase.from("company_settings").select("*").limit(1).maybeSingle(),
      ]);

      const products = productsRes.data ?? [];
      const inventory = inventoryRes.data ?? [];
      const warehouses = warehousesRes.data ?? [];
      const transfers = transfersRes.data ?? [];
      const sales = salesRes.data ?? [];
      const customers = customersRes.data ?? [];
      const suppliers = suppliersRes.data ?? [];
      const purchases = purchasesRes.data ?? [];
      const company = (companyRes.data ?? {}) as Record<string, any>;

      // Calculate low stock items
      const stockMap = new Map<string, number>();
      inventory.forEach((row: any) => {
        stockMap.set(
          row.product_id,
          (stockMap.get(row.product_id) || 0) + Number(row.quantity || 0),
        );
      });

      let lowStockCount = 0;
      products.forEach((p: any) => {
        const qty = stockMap.get(p.id) || 0;
        if (p.min_stock && qty <= Number(p.min_stock)) {
          lowStockCount++;
        }
      });

      // Sales calculations
      const totalSalesAmount = sales.reduce(
        (sum: number, inv: any) => sum + Number(inv.total || 0),
        0,
      );
      const totalPaidSales = sales.reduce(
        (sum: number, inv: any) => sum + Number(inv.paid || 0),
        0,
      );
      const totalReceivables = customers.reduce(
        (sum: number, c: any) => sum + Math.max(0, Number(c.balance || 0)),
        0,
      );
      const totalPurchasesAmount = purchases.reduce(
        (sum: number, p: any) => sum + Number(p.total || 0),
        0,
      );

      return {
        productsCount: products.length,
        warehousesCount: warehouses.length,
        transfersCount: transfers.length,
        lowStockCount,
        salesCount: sales.length,
        totalSalesAmount,
        totalPaidSales,
        customersCount: customers.length,
        totalReceivables,
        suppliersCount: suppliers.length,
        purchasesCount: purchases.length,
        totalPurchasesAmount,
        company,
      };
    },
  });

  if (!open) return null;

  const totalSteps = 7;

  return (
    <div
      className="fixed inset-0 z-[99990] flex items-center justify-center bg-background/80 backdrop-blur-md p-3 sm:p-5 md:p-6 overflow-y-auto animate-in fade-in duration-200"
      dir={dir}
    >
      <div className="relative w-full max-w-4xl rounded-3xl border border-border/80 bg-card shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Top Header / Progress Ribbon */}
        <div className="flex items-center justify-between border-b border-border/70 px-5 sm:px-7 py-3.5 bg-muted/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-xl bg-primary/10 text-primary border border-primary/20 grid place-items-center">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-primary">
                  VORTEX ERP
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-border" />
                <span className="text-xs font-semibold text-muted-foreground">
                  {isAr ? `خطوة ${step + 1} من ${totalSteps}` : `Step ${step + 1} of ${totalSteps}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleFinish}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-muted/80 transition cursor-pointer"
            >
              {isAr ? "تخطي الجولة" : "Skip Tour"}
            </button>
            <button
              type="button"
              onClick={handleFinish}
              className="size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted grid place-items-center transition cursor-pointer"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Step Progress Bar */}
        <div className="w-full bg-muted/40 h-1 shrink-0">
          <div
            className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-300"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {/* Scrollable Step Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6 custom-scrollbar">
          {/* STEP 1: Hero & Introduction */}
          {step === 0 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/10 via-primary/5 to-surface-2 p-6 sm:p-8 border border-primary/20 text-center sm:text-start">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div className="space-y-3 max-w-xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-bold">
                      <Sparkles className="size-3.5" />
                      <span>
                        {isAr
                          ? "منظومة الأعمال السحابية المتقدمة"
                          : "Advanced Cloud Business Suite"}
                      </span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground leading-tight">
                      {isAr
                        ? "أهلاً بك في فورتكس ERP — مركز قيادة منشأتك"
                        : "Welcome to Vortex ERP — Your Command Center"}
                    </h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {isAr
                        ? "منظومة متكاملة تدير كافة العمليات: المبيعات، المخزون، المستودعات، العملاء، المشتريات، والمحاسبة الدقيقة من منصة واحدة ذكية وسلسة."
                        : "An integrated ecosystem to manage sales, stock, warehouses, customers, procurement, and accounting from a single smart platform."}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <img
                      src="/vortex-erp-wordmark.png"
                      alt="Vortex ERP"
                      className="h-16 sm:h-20 w-auto object-contain drop-shadow-md"
                    />
                  </div>
                </div>
              </div>

              {/* Composition of core pillars */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div className="p-4 rounded-2xl bg-surface-2/60 border border-border/80 flex items-start gap-3.5 hover:border-primary/40 transition">
                  <div className="size-10 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20 grid place-items-center shrink-0">
                    <Gauge className="size-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      {isAr ? "لوحة تحكم لحظية" : "Live Dashboard"}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isAr
                        ? "مؤشرات أداء مالية وتشغيلية تتبع نبض عملك لحظة بلحظة."
                        : "Real-time KPIs tracking sales and operations."}
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-surface-2/60 border border-border/80 flex items-start gap-3.5 hover:border-emerald-500/40 transition">
                  <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 grid place-items-center shrink-0">
                    <Receipt className="size-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      {isAr ? "مبيعات ونقاط بيع فورية" : "POS & Fast Sales"}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isAr
                        ? "إصدار فواتير نقدية وآجلة مع دعم الباركود والطباعة الحرارية."
                        : "Rapid billing with barcode and thermal receipts."}
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-surface-2/60 border border-border/80 flex items-start gap-3.5 hover:border-cyan-500/40 transition">
                  <div className="size-10 rounded-xl bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 grid place-items-center shrink-0">
                    <Warehouse className="size-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      {isAr ? "مخزون ومستودعات دقيقة" : "Stock & Warehouses"}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isAr
                        ? "متابعة الكميات، التحويلات، التسويات وتنبيهات نواقص المخزون."
                        : "Accurate stock levels, transfers and reorder alerts."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Inventory & Warehouses */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-500">
                  <Warehouse className="size-3.5" />
                  <span>{isAr ? "إدارة المخزون والمستودعات" : "Inventory & Warehouses"}</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-foreground">
                  {isAr
                    ? "حركة البضاعة تحت السيطرة الكاملة"
                    : "Total Control Over Inventory Movements"}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {isAr
                    ? "تتبع دقيق للكميات في كافة المستودعات، المناقلات الداخلية، وتنبيهات إعادة الطلب التلقائية."
                    : "Track stock quantities across all storage locations, transfer goods safely, and handle settlements."}
                </p>
              </div>

              {/* Varied Card Composition */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* Featured Large Card */}
                <div className="sm:col-span-2 p-5 rounded-2xl bg-gradient-to-br from-cyan-500/15 via-cyan-500/5 to-surface-2 border border-cyan-500/30 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="size-10 rounded-xl bg-cyan-500/20 text-cyan-500 border border-cyan-500/30 grid place-items-center">
                      <Package className="size-5" />
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-600 dark:text-cyan-300">
                      {isAr ? "بيانات حية" : "Live Stock"}
                    </span>
                  </div>
                  <div className="mt-4">
                    <div className="text-3xl font-black text-foreground">
                      {num(stats?.productsCount ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr
                        ? "إجمالي المنتجات المسجلة في النظام"
                        : "Registered products in catalog"}
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-cyan-500/20 flex items-center justify-between text-xs">
                    <Link
                      to={"/products" as any}
                      search={{} as any}
                      onClick={handleFinish}
                      className="text-cyan-600 dark:text-cyan-400 font-bold hover:underline inline-flex items-center gap-1"
                    >
                      <span>{isAr ? "عرض المنتجات" : "View Catalog"}</span>
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                    <span className="text-muted-foreground text-[11px]">
                      {isAr
                        ? `${num(stats?.warehousesCount ?? 0)} مستودع نشط`
                        : `${num(stats?.warehousesCount ?? 0)} Warehouses`}
                    </span>
                  </div>
                </div>

                {/* Card: Warehouses */}
                <div className="p-4 rounded-2xl bg-surface-2 border border-border/80 flex flex-col justify-between">
                  <div className="size-9 rounded-xl bg-blue-500/10 text-blue-500 grid place-items-center">
                    <Boxes className="size-4.5" />
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-black text-foreground">
                      {num(stats?.warehousesCount ?? 0)}
                    </div>
                    <div className="text-xs text-muted-foreground font-medium">
                      {isAr ? "المستودعات" : "Warehouses"}
                    </div>
                  </div>
                  <Link
                    to="/warehouses"
                    onClick={handleFinish}
                    className="mt-3 text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <span>{isAr ? "إدارة المستودعات" : "Manage"}</span>
                    <ArrowUpRight className="size-3" />
                  </Link>
                </div>

                {/* Card: Low Stock Alert */}
                <div className="p-4 rounded-2xl bg-surface-2 border border-border/80 flex flex-col justify-between">
                  <div className="size-9 rounded-xl bg-amber-500/10 text-amber-500 grid place-items-center">
                    <AlertTriangle className="size-4.5" />
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-black text-foreground">
                      {num(stats?.lowStockCount ?? 0)}
                    </div>
                    <div className="text-xs text-muted-foreground font-medium">
                      {isAr ? "نواقص المخزون" : "Low Stock Alerts"}
                    </div>
                  </div>
                  <Link
                    to="/inventory"
                    onClick={handleFinish}
                    className="mt-3 text-xs font-bold text-amber-500 hover:underline inline-flex items-center gap-1"
                  >
                    <span>{isAr ? "جرد المخزون" : "Inventory"}</span>
                    <ArrowUpRight className="size-3" />
                  </Link>
                </div>
              </div>

              {/* Quick Action Links Strip */}
              <div className="p-4 rounded-2xl bg-muted/40 border border-border/70 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-muted-foreground">
                  {isAr ? "عمليات المخزون المتاحة مباشرة:" : "Available Stock Operations:"}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/transfers"
                    onClick={handleFinish}
                    className="px-3 py-1.5 rounded-xl bg-background border border-border hover:border-primary/50 text-foreground font-semibold inline-flex items-center gap-1.5 transition"
                  >
                    <ArrowRightLeft className="size-3 text-cyan-500" />
                    <span>{isAr ? "التحويلات المخزنية" : "Transfers"}</span>
                  </Link>
                  <Link
                    to="/settlements"
                    onClick={handleFinish}
                    className="px-3 py-1.5 rounded-xl bg-background border border-border hover:border-primary/50 text-foreground font-semibold inline-flex items-center gap-1.5 transition"
                  >
                    <ClipboardList className="size-3 text-amber-500" />
                    <span>{isAr ? "تسويات الجرد" : "Settlements"}</span>
                  </Link>
                  <Link
                    to="/barcodes"
                    onClick={handleFinish}
                    className="px-3 py-1.5 rounded-xl bg-background border border-border hover:border-primary/50 text-foreground font-semibold inline-flex items-center gap-1.5 transition"
                  >
                    <Package className="size-3 text-emerald-500" />
                    <span>{isAr ? "طباعة الباركود" : "Barcodes"}</span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Sales & POS */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-500">
                  <Receipt className="size-3.5" />
                  <span>{isAr ? "المبيعات ونقاط البيع" : "Sales & POS Engine"}</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-foreground">
                  {isAr
                    ? "دورة بيع متكاملة من نقطة البيع حتى التحصيل"
                    : "Seamless Sales Cycle from POS to Settlement"}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {isAr
                    ? "واجهة كاشير سريعة تدعم قارئات الباركود، الفواتير النقدية والآجلة، والطباعة الحرارية المباشرة."
                    : "Fast cashier screen, barcode scanner support, cash/credit billing, and thermal receipts."}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-surface-2 border border-emerald-500/30 flex flex-col justify-between">
                  <div>
                    <div className="size-10 rounded-xl bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 grid place-items-center">
                      <TrendingUp className="size-5" />
                    </div>
                    <div className="mt-4 text-3xl font-black text-foreground">
                      {money(stats?.totalSalesAmount ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr ? "إجمالي حجم المبيعات" : "Total sales volume"}
                    </div>
                  </div>
                  <Link
                    to="/sales"
                    onClick={handleFinish}
                    className="mt-4 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                  >
                    <span>{isAr ? "سجل المبيعات" : "Sales Registry"}</span>
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>

                <div className="p-5 rounded-2xl bg-surface-2 border border-border/80 flex flex-col justify-between">
                  <div>
                    <div className="size-10 rounded-xl bg-blue-500/10 text-blue-500 grid place-items-center">
                      <ShoppingCart className="size-5" />
                    </div>
                    <div className="mt-4 text-3xl font-black text-foreground">
                      {num(stats?.salesCount ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr ? "عدد الفواتير المنفذة" : "Completed Invoices"}
                    </div>
                  </div>
                  <Link
                    to="/pos"
                    onClick={handleFinish}
                    className="mt-4 text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <span>{isAr ? "فتح نقطة البيع (POS)" : "Open POS"}</span>
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>

                <div className="p-5 rounded-2xl bg-surface-2 border border-border/80 flex flex-col justify-between">
                  <div>
                    <div className="size-10 rounded-xl bg-purple-500/10 text-purple-500 grid place-items-center">
                      <Wallet className="size-5" />
                    </div>
                    <div className="mt-4 text-3xl font-black text-foreground">
                      {money(stats?.totalPaidSales ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr ? "المقبوضات النقدية والبنكية" : "Settled Cash & Bank"}
                    </div>
                  </div>
                  <Link
                    to="/sales-returns"
                    onClick={handleFinish}
                    className="mt-4 text-xs font-bold text-purple-500 hover:underline inline-flex items-center gap-1"
                  >
                    <span>{isAr ? "مردودات المبيعات" : "Returns"}</span>
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Customers & Debt */}
          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-500">
                  <Users className="size-3.5" />
                  <span>{isAr ? "العملاء والديون والتحصيل" : "Customers & Receivables"}</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-foreground">
                  {isAr
                    ? "من البيع إلى التحصيل — كل مستحق واضح أمامك"
                    : "From Sale to Settlement — Every Balance Tracked"}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {isAr
                    ? "سجلات عملاء مفصلة، كشوفات حساب دقيقة، حدود ائتمان ذكية، وسندات قبض فورية."
                    : "Detailed customer records, statements of accounts, credit limits, and receipt vouchers."}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-gradient-to-br from-violet-500/15 via-violet-500/5 to-surface-2 border border-violet-500/30 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="size-10 rounded-xl bg-violet-500/20 text-violet-500 border border-violet-500/30 grid place-items-center">
                      <AlertTriangle className="size-5" />
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-300">
                      {isAr ? "مستحقات قائمة" : "Receivables"}
                    </span>
                  </div>
                  <div className="mt-4">
                    <div className="text-3xl font-black text-foreground">
                      {money(stats?.totalReceivables ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr
                        ? "إجمالي ديون العملاء المتبقية للتحصيل"
                        : "Total outstanding customer balance"}
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-violet-500/20 flex items-center justify-between text-xs">
                    <Link
                      to="/debts"
                      onClick={handleFinish}
                      className="text-violet-600 dark:text-violet-400 font-bold hover:underline inline-flex items-center gap-1"
                    >
                      <span>{isAr ? "متابعة سجل الديون" : "Manage Debts"}</span>
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-surface-2 border border-border/80 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="size-10 rounded-xl bg-blue-500/10 text-blue-500 grid place-items-center">
                      <Users className="size-5" />
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-500">
                      {isAr ? "دليل العملاء" : "Customer Base"}
                    </span>
                  </div>
                  <div className="mt-4">
                    <div className="text-3xl font-black text-foreground">
                      {num(stats?.customersCount ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr ? "عميل مسجل في قاعدة البيانات" : "Registered customers"}
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                    <Link
                      to="/customers"
                      onClick={handleFinish}
                      className="text-primary font-bold hover:underline inline-flex items-center gap-1"
                    >
                      <span>{isAr ? "قائمة العملاء" : "Customer List"}</span>
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                    <Link
                      to="/account-statement"
                      onClick={handleFinish}
                      className="text-muted-foreground hover:text-foreground font-medium"
                    >
                      {isAr ? "كشف حساب" : "Statement"}
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Procurement & Suppliers */}
          {step === 4 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-500">
                  <Truck className="size-3.5" />
                  <span>{isAr ? "المشتريات والموردون" : "Procurement & Suppliers"}</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-foreground">
                  {isAr
                    ? "سلسلة توريد منضبطة والتزامات مالية واضحة"
                    : "Structured Supply Chain & Clear Payables"}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {isAr
                    ? "تسجيل فواتير الشراء، إدارة أرصدة الموردين، وإدخال الكميات آلياً للمستودعات مع تحديث التكاليف."
                    : "Log supplier bills, track payment liabilities, and receive items directly into warehouse stock."}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-surface-2 border border-amber-500/30 flex flex-col justify-between">
                  <div>
                    <div className="size-10 rounded-xl bg-amber-500/20 text-amber-500 border border-amber-500/30 grid place-items-center">
                      <Truck className="size-5" />
                    </div>
                    <div className="mt-4 text-3xl font-black text-foreground">
                      {money(stats?.totalPurchasesAmount ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr ? "إجمالي المشتريات" : "Total Purchases"}
                    </div>
                  </div>
                  <Link
                    to="/purchases"
                    onClick={handleFinish}
                    className="mt-4 text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline inline-flex items-center gap-1"
                  >
                    <span>{isAr ? "سجل المشتريات" : "Purchases Log"}</span>
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>

                <div className="p-5 rounded-2xl bg-surface-2 border border-border/80 flex flex-col justify-between">
                  <div>
                    <div className="size-10 rounded-xl bg-blue-500/10 text-blue-500 grid place-items-center">
                      <Building2 className="size-5" />
                    </div>
                    <div className="mt-4 text-3xl font-black text-foreground">
                      {num(stats?.suppliersCount ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr ? "الموردين المعتمدين" : "Active Suppliers"}
                    </div>
                  </div>
                  <Link
                    to="/suppliers"
                    onClick={handleFinish}
                    className="mt-4 text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <span>{isAr ? "دليل الموردين" : "Suppliers List"}</span>
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>

                <div className="p-5 rounded-2xl bg-surface-2 border border-border/80 flex flex-col justify-between">
                  <div>
                    <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-500 grid place-items-center">
                      <ShoppingCart className="size-5" />
                    </div>
                    <div className="mt-4 text-3xl font-black text-foreground">
                      {num(stats?.purchasesCount ?? 0)}
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground mt-1">
                      {isAr ? "فواتير التوريد" : "Purchase Bills"}
                    </div>
                  </div>
                  <Link
                    to="/purchase-pos"
                    onClick={handleFinish}
                    className="mt-4 text-xs font-bold text-emerald-500 hover:underline inline-flex items-center gap-1"
                  >
                    <span>{isAr ? "إدخال سريع للشراء" : "Purchase POS"}</span>
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: Reports & Financial Intelligence */}
          {step === 5 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-500">
                  <BarChart3 className="size-3.5" />
                  <span>
                    {isAr
                      ? "التقارير والمحاسبة والذكاء المالي"
                      : "Accounting & Financial Analytics"}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-foreground">
                  {isAr
                    ? "بيانات تشغيلية تتحول إلى قرارات ربحية مدروسة"
                    : "Data-Driven Insights for Confident Decisions"}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {isAr
                    ? "قوائم مالية متوافقة مع المعايير: ميزان المراجعة، الأرباح والخسائر، الميزانية العمومية، ودفتر اليومية."
                    : "Standard accounting statements: trial balance, balance sheet, income statement, and daily journals."}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <Link
                  to="/income-statement"
                  onClick={handleFinish}
                  className="p-4 rounded-2xl bg-surface-2 border border-border/80 hover:border-primary/50 transition group"
                >
                  <div className="size-9 rounded-xl bg-emerald-500/10 text-emerald-500 grid place-items-center group-hover:scale-110 transition">
                    <TrendingUp className="size-4.5" />
                  </div>
                  <h4 className="text-sm font-bold text-foreground mt-3">
                    {isAr ? "قائمة الدخل والأرباح" : "Income Statement"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAr ? "صافي الربح وهامش المبيعات" : "Net profit & margins"}
                  </p>
                </Link>

                <Link
                  to="/balance-sheet"
                  onClick={handleFinish}
                  className="p-4 rounded-2xl bg-surface-2 border border-border/80 hover:border-primary/50 transition group"
                >
                  <div className="size-9 rounded-xl bg-blue-500/10 text-blue-500 grid place-items-center group-hover:scale-110 transition">
                    <Building className="size-4.5" />
                  </div>
                  <h4 className="text-sm font-bold text-foreground mt-3">
                    {isAr ? "الميزانية العمومية" : "Balance Sheet"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAr ? "الأصول والخصوم ورأس المال" : "Assets & liabilities"}
                  </p>
                </Link>

                <Link
                  to="/trial-balance"
                  onClick={handleFinish}
                  className="p-4 rounded-2xl bg-surface-2 border border-border/80 hover:border-primary/50 transition group"
                >
                  <div className="size-9 rounded-xl bg-violet-500/10 text-violet-500 grid place-items-center group-hover:scale-110 transition">
                    <FileSpreadsheet className="size-4.5" />
                  </div>
                  <h4 className="text-sm font-bold text-foreground mt-3">
                    {isAr ? "ميزان المراجعة" : "Trial Balance"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAr ? "توازن الحسابات المدينة والدائنة" : "Debits & credits integrity"}
                  </p>
                </Link>

                <Link
                  to="/analytics"
                  onClick={handleFinish}
                  className="p-4 rounded-2xl bg-surface-2 border border-border/80 hover:border-primary/50 transition group"
                >
                  <div className="size-9 rounded-xl bg-purple-500/10 text-purple-500 grid place-items-center group-hover:scale-110 transition">
                    <BarChart3 className="size-4.5" />
                  </div>
                  <h4 className="text-sm font-bold text-foreground mt-3">
                    {isAr ? "التحليلات والمؤشرات" : "Analytics Hub"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAr ? "رسوم بيانية ومقارنات زمنية" : "Visual charts & trends"}
                  </p>
                </Link>
              </div>
            </div>
          )}

          {/* STEP 7: Company Identity & Final Welcome */}
          {step === 6 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-1 text-center">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-primary">
                  <ShieldCheck className="size-4" />
                  <span>
                    {isAr ? "الهوية المؤسسية والجاهزية" : "Enterprise Identity & Ready Status"}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-foreground">
                  {isAr
                    ? "نظامك جاهز بكامل إمكانياته"
                    : "Your System is Ready to Empower Your Business"}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-lg mx-auto">
                  {isAr
                    ? "بيانات المنشأة معتمدة وجاهزة للطباعة وإصدار الفواتير مع دعم فني مستمر من إنما سوفت."
                    : "Company profile is configured for receipts and billing with ongoing support from Inama Soft."}
                </p>
              </div>

              {/* Digital Identity Card */}
              <div className="max-w-2xl mx-auto rounded-3xl bg-gradient-to-br from-card via-surface-2 to-card border border-border/90 p-6 sm:p-7 shadow-xl space-y-5">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-5 border-b border-border/70">
                  <div className="flex items-center gap-3.5">
                    <div className="size-14 rounded-2xl bg-surface-2 border border-border p-2 grid place-items-center shadow-sm">
                      <img
                        src={stats?.company?.logo_url || "/vortex-erp-mark.png"}
                        alt="Logo"
                        className="size-10 object-contain"
                        onError={(e) => {
                          e.currentTarget.src = "/vortex-erp-mark.png";
                        }}
                      />
                    </div>
                    <div>
                      <h4 className="text-base font-black text-foreground">
                        {stats?.company?.name ||
                          stats?.company?.name_ar ||
                          (isAr ? "فورتكس للأنشطة التجارية" : "Vortex Commercial Hub")}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {stats?.company?.tax_number
                          ? `${isAr ? "الرقم الضريبي:" : "Tax ID:"} ${stats?.company?.tax_number}`
                          : isAr
                            ? "حساب تجاري نشط"
                            : "Active Commercial Account"}
                      </p>
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-xs font-bold">
                    <CheckCircle2 className="size-3.5" />
                    <span>{isAr ? "حالة النظام: متصل وجاهز" : "Status: Active & Online"}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
                    <span className="text-muted-foreground block text-[11px]">
                      {isAr ? "هاتف المنشأة:" : "Phone:"}
                    </span>
                    <span className="font-bold text-foreground mt-0.5 block" dir="ltr">
                      {stats?.company?.phone || "+967 772 217 218"}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
                    <span className="text-muted-foreground block text-[11px]">
                      {isAr ? "العملة الافتراضية:" : "Currency:"}
                    </span>
                    <span className="font-bold text-foreground mt-0.5 block">
                      {stats?.company?.currency_symbol || (isAr ? "ريال يمني (YER)" : "YER")}
                    </span>
                  </div>
                </div>

                {/* Developer & Support Credit Card */}
                <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="size-5 text-primary shrink-0" />
                    <div>
                      <span className="font-bold text-foreground block">
                        {isAr
                          ? "تطوير ودعم إنما سوفت (Inama Soft)"
                          : "Engineered & Supported by Inama Soft"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {isAr
                          ? "شريكك التقني للأنظمة المحاسبية والسحابية"
                          : "Your enterprise software partner"}
                      </span>
                    </div>
                  </div>
                  <a
                    href="tel:+967772217218"
                    className="px-3 py-1.5 rounded-xl bg-primary/10 text-primary font-bold hover:bg-primary/20 transition inline-flex items-center gap-1.5 shrink-0"
                    dir="ltr"
                  >
                    <Phone className="size-3.5" />
                    <span>+967 772 217 218</span>
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Actions Ribbon */}
        <div className="flex items-center justify-between border-t border-border/70 px-5 sm:px-7 py-4 bg-muted/30 shrink-0">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="h-10 px-4 rounded-xl border border-border bg-background hover:bg-muted text-foreground font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <ChevronRight className={dir === "rtl" ? "size-3.5" : "size-3.5 rotate-180"} />
              <span>{isAr ? "السابق" : "Previous"}</span>
            </button>
          ) : (
            <div />
          )}

          {step < totalSteps - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="h-10 px-5 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:opacity-90 transition flex items-center gap-1.5 shadow-md shadow-primary/20 cursor-pointer mr-auto"
            >
              <span>{isAr ? "التالي" : "Next"}</span>
              <ChevronLeft className={dir === "rtl" ? "size-3.5" : "size-3.5 rotate-180"} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              className="h-11 px-7 rounded-xl bg-primary text-primary-foreground font-extrabold text-sm hover:opacity-95 transition flex items-center gap-2 shadow-lg shadow-primary/25 cursor-pointer mr-auto"
            >
              {session ? (
                <>
                  <Check className="size-4" />
                  <span>{isAr ? "ابدأ العمل الآن" : "Launch ERP"}</span>
                </>
              ) : (
                <>
                  <LogIn className="size-4" />
                  <span>{isAr ? "الانتقال إلى تسجيل الدخول" : "Proceed to Sign In"}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
