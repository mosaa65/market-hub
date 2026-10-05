import { memo } from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  Receipt,
  Package,
  Users,
  X,
  Sparkles,
  Command as CommandIcon,
  Loader2,
  Building2,
  ScanBarcode,
} from "lucide-react";
import { InvoiceScannerModal } from "@/components/invoice-scanner-modal";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useModules } from "@/lib/modules";
import { useMillingMode, isRouteVisibleByMillingMode } from "@/lib/milling-mode";
import { canAccessRoute } from "@/lib/route-access";
import { cn } from "@/lib/utils";
import { searchRoutes } from "@/lib/navigation";
import { routeIcon, routeCategoryLabel } from "@/lib/navigation/route-icons";

/**
 * تهيئة قيمة البحث قبل تمريرها إلى PostgREST `.or(...)`.
 *
 * السبب: صيغة الفلتر في PostgREST تفصل الحقول والفلاتر بفواصل وأقواس، وقيمة
 * تحتوي فاصلة أو قوسًا تجعل الطلب غير صالح وتفشل البحث كله. كما أن `%` و `_`
 * محرفان خاصان في `LIKE` — تُهرب بـ `\` حتى لا يتحول بحث المستخدم إلى نمط.
 * هذا تحصين للاستعلام الحالي، لا إعادة بناء لمحرك البحث.
 */
function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[\\"'()]/g, " ") // رموز تكسر صيغة الفلتر
    .replace(/,/g, " ") // الفاصلة تفصل الفلاتر في .or()
    .replace(/[%_]/g, (m) => `\\${m}`) // محارف LIKE الخاصة
    .replace(/\s+/g, " ")
    .trim();
}

/** ترويسة الفاصل بين الفلاتر — ثابت واحد بدل تكرار النص */
const DEBOUNCE_MS = 250;

/** هل الخطأ ناتج عن إلغاء الطلب؟ الإلغاء عملية متوقعة لا خطأ للمستخدم. */
function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const anyErr = error as { name?: string; message?: string; details?: string };
  if (anyErr.name === "AbortError") return true;
  const text = `${anyErr.message ?? ""} ${anyErr.details ?? ""}`.toLowerCase();
  return text.includes("abort");
}

interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  category: "invoice" | "product" | "customer" | "supplier" | "nav";
  to: string;
  badge?: string;
  icon: any;
}

import { useBreakpoint } from "@/design/breakpoints";

export const VortexHeaderOmnisearch = memo(function VortexHeaderOmnisearch({
  onFocusChange,
}: {
  onFocusChange?: (focused: boolean) => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const { isModuleEnabled } = useModules();
  const { roles, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const { mode: millingMode } = useMillingMode();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === "xs" || breakpoint === "sm";

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dataResults, setDataResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scannerModalOpen, setScannerModalOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * فهرس الواجهات الموحد — يُشتق من سجل المسارات المركزي (route-registry)
   * بدل القائمة اليدوية السابقة، ويطبّق الصلاحيات + الوحدات + وضع المطحنة.
   */
  const routeIndex = useMemo(() => {
    return searchRoutes("", isAr, {
      isModuleEnabled,
      isVisibleByMillingMode: (path) => isRouteVisibleByMillingMode(path, millingMode),
      canAccess: (entry) =>
        canAccessRoute(entry.path.split("?")[0], {
          roles,
          isPlatformAdmin,
          isPlatformSuperadmin,
        }),
    });
  }, [isAr, isModuleEnabled, millingMode, roles, isPlatformAdmin, isPlatformSuperadmin]);

  // إغلاق القائمة عند النقر خارجها
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onFocusChange?.(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // اختصارات لوحة المفاتيح: '/' و 'Ctrl+K' / 'Cmd+K'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInput = activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA");

      // زر '/' عندما لا يكون المستخدم داخل حقل إدخال آخر
      if (e.key === "/" && !isInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }

      // اختصار Ctrl+K أو Cmd+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }

      // زر Escape للإغلاق
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
        inputRef.current?.blur();
        onFocusChange?.(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // البحث التسامحي في البيانات عبر Supabase
  //
  // التصميم:
  //   1) Debounce = 250ms — لا يُرسل طلب أثناء الكتابة السريعة.
  //   2) AbortController لكل طلب — الطلب السابق يُلغى فعليًا على مستوى HTTP
  //      عبر `.abortSignal(signal)` المدعوم في Supabase JS.
  //   3) حرس «أحدث طلب» (requestId) — حتى لو وصل ردّ طلب قديم بعد بدء الجديد،
  //      لا يستطيع أن يكتب النتائج أو حالة التحميل أو الخطأ.
  //   4) التنظيف عند تغيّر الاستعلام وعند إلغاء تركيب المكوّن.
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const cleanQuery = query.trim();

    // أقل من حرفين: لا بحث — ولا نترك أي طلب أو مؤقّت معلّقًا.
    if (cleanQuery.length < 2) {
      abortRef.current?.abort();
      abortRef.current = null;
      requestSeqRef.current += 1; // يُبطل أي ردّ قادم من طلب سابق
      setDataResults([]);
      setIsLoading(false);
      return;
    }

    // ابدأ مؤقت الانتظار بعد إلغاء أي طلب سابق فورًا
    const seq = ++requestSeqRef.current;
    setIsLoading(true);

    const handler = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // هل ما زال هذا الطلب هو الأحدث؟ لا يكتب شيئًا بعده إلا هو.
      const isLatest = () => seq === requestSeqRef.current;

      try {
        const term = sanitizeSearchTerm(cleanQuery);
        if (!term) {
          if (isLatest()) {
            setDataResults([]);
            setIsLoading(false);
          }
          return;
        }

        // Taken from the other branch, and kept because it is a real
        // improvement: an operator typing a phone number should match on the
        // digits alone, so "0771234567" finds "+967 771 234 567". A term that
        // is entirely digits searches the phone column; otherwise it searches
        // the name. Note the queries below select `customers(name, phone)` and
        // read `total` — the columns this schema actually has. The other
        // branch's `customer_name` / `total_amount` do not exist here, so its
        // version of this query fails at runtime rather than merely reading
        // old data.
        const digitsOnly = cleanQuery.replace(/\D/g, "");
        const phoneMatchable = digitsOnly.length >= 3;

        // جلب متزامن فائق السرعة من المنتجات، الفواتير، العملاء، والموردين
        const [productsRes, invoicesRes, customersRes, suppliersRes] = await Promise.all([
          supabase
            .from("products")
            .select("id, name, name_ar, barcode, sku, sale_price")
            .or(`name.ilike.%${term}%,name_ar.ilike.%${term}%,barcode.ilike.%${term}%,sku.ilike.%${term}%`)
            .limit(6)
            .abortSignal(controller.signal),
          supabase
            .from("sales_invoices")
            .select("id, invoice_number, total, created_at, customers(name, phone)")
            .or(`invoice_number.ilike.%${term}%`)
            .order("created_at", { ascending: false })
            .limit(6)
            .abortSignal(controller.signal),
          supabase
            .from("customers")
            .select("id, name, phone, balance")
            .or(
              phoneMatchable
                ? `phone.ilike.%${digitsOnly}%,name.ilike.%${term}%`
                : `name.ilike.%${term}%`,
            )
            .limit(6)
            .abortSignal(controller.signal),
          supabase
            .from("suppliers")
            .select("id, name, phone, balance")
            .or(
              phoneMatchable
                ? `phone.ilike.%${digitsOnly}%,name.ilike.%${term}%`
                : `name.ilike.%${term}%`,
            )
            .limit(6)
            .abortSignal(controller.signal),
        ]);

        // طلب قديم: لا يلمس أي state
        if (!isLatest()) return;

        const results: SearchResultItem[] = [];

        // 1) فواتير — اسم العميل من العلاقة (لا يوجد عمود customer_name في الجدول)
        (invoicesRes.data || []).forEach((inv: any) => {
          const customerName = inv.customers?.name || (isAr ? "عميل نقدي" : "Cash");
          results.push({
            id: `inv-${inv.id}`,
            title: `${isAr ? "فاتورة رقم" : "Invoice #"} ${inv.invoice_number}`,
            subtitle: `${customerName} • ${Number(inv.total ?? 0).toLocaleString()} ${isAr ? "ر.ي" : "YER"}`,
            category: "invoice",
            to: `/sales?invoiceId=${inv.id}`,
            badge: isAr ? "فاتورة" : "Invoice",
            icon: Receipt,
          });
        });

        // 2) منتجات — عمود السعر الصحيح هو sale_price
        (productsRes.data || []).forEach((p: any) => {
          results.push({
            id: `prod-${p.id}`,
            title: p.name_ar || p.name,
            subtitle: `${p.barcode ? `[${p.barcode}] • ` : ""}${isAr ? "السعر:" : "Price:"} ${Number(p.sale_price ?? 0).toLocaleString()} ${isAr ? "ر.ي" : "YER"}`,
            category: "product",
            to: `/products?search=${encodeURIComponent(p.barcode || p.name)}`,
            badge: isAr ? "منتج" : "Product",
            icon: Package,
          });
        });

        // 3) عملاء
        (customersRes.data || []).forEach((c: any) => {
          results.push({
            id: `cust-${c.id}`,
            title: c.name,
            subtitle: `${c.phone ? `${c.phone} • ` : ""}${isAr ? "الرصيد:" : "Balance:"} ${Number(c.balance ?? 0).toLocaleString()} ${isAr ? "ر.ي" : "YER"}`,
            category: "customer",
            to: `/customers?search=${encodeURIComponent(c.name)}`,
            badge: isAr ? "عميل" : "Customer",
            icon: Users,
          });
        });

        // 4) موردين
        (suppliersRes.data || []).forEach((s: any) => {
          results.push({
            id: `supp-${s.id}`,
            title: s.name,
            subtitle: `${s.phone ? `${s.phone} • ` : ""}${isAr ? "الرصيد للمورد:" : "Supplier balance:"} ${Number(s.balance ?? 0).toLocaleString()} ${isAr ? "ر.ي" : "YER"}`,
            category: "supplier",
            to: `/suppliers?search=${encodeURIComponent(s.name)}`,
            badge: isAr ? "مورد" : "Supplier",
            icon: Building2,
          });
        });

        setDataResults(results);
      } catch (err) {
        // الإلغاء ليس خطأ: لا Toast ولا رسالة للمستخدم
        if (isAbortError(err)) return;
        // خطأ حقيقي من Supabase/الشبكة — ولا يُكتب إن كان الطلب قديمًا
        if (!isLatest()) return;
        console.warn("[Omnisearch] Error searching:", err);
        setDataResults([]);
      } finally {
        // الطلب القديم لا يُطفئ مؤشر تحميل الطلب الأحدث
        if (isLatest()) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handler);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [query, isAr]);

  // تصفية الواجهات حسب البحث — من السجل المركزي (يدعم العربية/الإنجليزية والمرادفات)
  const filteredNav = useMemo(() => {
    if (!query.trim()) return routeIndex.slice(0, 8); // الافتراضي
    return searchRoutes(query, isAr, {
      isModuleEnabled,
      isVisibleByMillingMode: (path) => isRouteVisibleByMillingMode(path, millingMode),
      canAccess: (entry) =>
        canAccessRoute(entry.path.split("?")[0], {
          roles,
          isPlatformAdmin,
          isPlatformSuperadmin,
        }),
    });
  }, [query, routeIndex, isAr, isModuleEnabled, millingMode, roles, isPlatformAdmin, isPlatformSuperadmin]);

  // دمج كافة النتائج
  const allResults = useMemo(() => {
    const list: { to: string }[] = [];
    dataResults.forEach((d) => list.push(d));
    filteredNav.forEach((n) => list.push({ to: n.path }));
    return list;
  }, [dataResults, filteredNav]);

  // التنقل السريع عند الضغط على عنصر (يدعم مسارات تحتوي query مثل /settings?section=printing)
  const handleSelect = (to: string) => {
    setIsOpen(false);
    setQuery("");
    const [pathname, search] = to.split("?");
    if (search) {
      navigate({ to: pathname, search: Object.fromEntries(new URLSearchParams(search)) } as never);
    } else {
      navigate({ to: pathname } as never);
    }
  };

  // التحكم بالأسهم للأسفل والأعلى وEnter
  const handleKeyDownInput = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < allResults.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : allResults.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = allResults[selectedIndex];
      if (current) {
        handleSelect(current.to);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 w-full min-w-0 max-w-none">
      {/* Search Input Bar in Header */}
      <div
        className={cn(
          "group relative flex h-10 w-full items-center gap-2.5 rounded-full border bg-surface/90 px-3.5 text-sm transition-all duration-200",
          isOpen
            ? "border-primary/60 bg-surface shadow-md shadow-primary/10 ring-2 ring-primary/20"
            : "border-border/60 hover:border-ring/40 hover:bg-surface",
        )}
      >
        <Search
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            isOpen ? "text-primary stroke-[2.5]" : "text-muted-foreground group-hover:text-foreground",
          )}
        />

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => {
            setIsOpen(true);
            onFocusChange?.(true);
          }}
          onBlur={() => {
            // Delay to allow click events on dropdown items
            setTimeout(() => onFocusChange?.(false), 200);
          }}
          onKeyDown={handleKeyDownInput}
          placeholder={
            isMobile
              ? isAr ? "بحث..." : "Search..."
              : isAr ? "ابحث عن فاتورة، عميل، منتج، مورد... (/)" : "Search invoices, products, customers... (/)"
          }
          className="h-full flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/75 placeholder:truncate focus:outline-none"
        />

        {isLoading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : isMobile && isOpen ? (
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              inputRef.current?.blur();
              onFocusChange?.(false);
            }}
            className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            title={isAr ? "إغلاق البحث" : "Close search"}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <kbd className="hidden sm:inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-border/80 bg-background/80 px-1.5 text-[10px] font-mono font-bold text-muted-foreground/90 shadow-sm">
              /
            </kbd>
            <kbd className="hidden lg:inline-flex h-5 items-center gap-0.5 rounded-md border border-border/80 bg-background/80 px-1.5 text-[10px] font-mono font-medium text-muted-foreground shadow-sm">
              <CommandIcon className="h-3 w-3" /> K
            </kbd>
          </div>
        )}

        <button
          type="button"
          onClick={() => setScannerModalOpen(true)}
          title={isAr ? "الاستعلام عن فاتورة بالباركود / QR" : "Scan Invoice QR/Barcode"}
          className="flex h-7 items-center gap-1 rounded-full bg-primary/10 px-2 text-[11px] font-bold text-primary hover:bg-primary/20 transition-colors shrink-0"
        >
          <ScanBarcode className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{isAr ? "مسح فاتورة" : "Scan Invoice"}</span>
        </button>
      </div>

      <InvoiceScannerModal
        open={scannerModalOpen}
        onClose={() => setScannerModalOpen(false)}
      />

      {/* Floating Expansive Results Dropdown anchored directly below header */}
      {isOpen && (
        <div
          className={cn(
            "fixed inset-x-2.5 top-[68px] z-50 max-h-[75vh] overflow-hidden rounded-2xl border border-border/80 bg-popover/95 p-2 shadow-2xl backdrop-blur-2xl transition-all animate-in fade-in-0 zoom-in-95 sm:absolute sm:top-full sm:inset-x-auto sm:mt-2 sm:w-[580px] md:w-[680px] lg:w-[760px]",
            isAr ? "sm:right-0" : "sm:left-0",
          )}
        >
          {/* Header indicator */}
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-semibold text-foreground/80">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {query
                ? isAr
                  ? `نتائج البحث عن: "${query}"`
                  : `Search results for: "${query}"`
                : isAr
                  ? "البحث الذكي الشامل في النظام"
                  : "Vortex OmniSearch"}
            </span>
            <span className="text-[11px] font-mono opacity-80">
              {isAr ? "استخدم الأسهم ↑ ↓ ثم Enter" : "Use ↑ ↓ then Enter"}
            </span>
          </div>

          <div className="overflow-y-auto max-h-[60vh] p-1.5 space-y-3 custom-scrollbar">
            {/* 1) نتائج البيانات الحية: فواتير، منتجات، عملاء */}
            {dataResults.length > 0 && (
              <div className="space-y-1">
                <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {isAr ? "البيانات والسجلات المطابقة" : "Matching Records"}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {dataResults.map((item, idx) => {
                    const isSelected = selectedIndex === idx;
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.id}
                        onClick={() => handleSelect(item.to)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          "group flex items-center justify-between gap-3 rounded-xl border p-2.5 cursor-pointer transition-all duration-150",
                          isSelected
                            ? "border-primary/50 bg-primary/10 shadow-sm"
                            : "border-border/40 bg-surface/60 hover:border-border hover:bg-surface",
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={cn(
                              "grid h-8 w-8 shrink-0 place-items-center rounded-lg border",
                              item.category === "invoice"
                                ? "bg-emerald-500/15 border-emerald-500/20 text-emerald-500"
                                : item.category === "product"
                                  ? "bg-teal-500/15 border-teal-500/20 text-teal-500"
                                  : "bg-blue-500/15 border-blue-500/20 text-blue-500",
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-xs text-foreground truncate">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {item.subtitle}
                            </div>
                          </div>
                        </div>
                        {item.badge && (
                          <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border border-border/50">
                            {item.badge}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2) الواجهات والصفحات والإعدادات */}
            {filteredNav.length > 0 && (
              <div className="space-y-1">
                <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {isAr ? "الواجهات والإعدادات السريعة" : "Navigation & Settings"}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {filteredNav.map((nav, nIdx) => {
                    const actualIdx = dataResults.length + nIdx;
                    const isSelected = selectedIndex === actualIdx;
                    const Icon = routeIcon(nav.id);
                    const title = isAr ? nav.titleAr : nav.titleEn;
                    const sub = isAr ? nav.descriptionAr : nav.descriptionEn;
                    return (
                      <div
                        key={nav.id}
                        onClick={() => handleSelect(nav.path)}
                        onMouseEnter={() => setSelectedIndex(actualIdx)}
                        className={cn(
                          "group flex items-center justify-between gap-3 rounded-xl border p-2.5 cursor-pointer transition-all duration-150",
                          isSelected
                            ? "border-primary/50 bg-primary/10 shadow-sm"
                            : "border-border/40 bg-surface/50 hover:border-border hover:bg-surface",
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 border border-border/50 text-foreground group-hover:text-primary transition-colors">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-xs text-foreground truncate">
                              {title}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {sub}
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80 border border-border/50">
                          {routeCategoryLabel(nav.category, isAr)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* في حال عدم وجود نتائج */}
            {dataResults.length === 0 && filteredNav.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                <p className="text-sm font-medium">
                  {isAr ? "لم نجد نتائج مطابقة لبحثك" : "No matching results found"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/75">
                  {isAr
                    ? "جرّب البحث باسم العميل، رقم الفاتورة، أو اسم الشاشة"
                    : "Try searching by invoice number, product name, or module"}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
