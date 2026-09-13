import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ScanBarcode,
  Loader2,
  X,
  Filter,
  ChevronDown,
  UserPlus,
  CalendarDays,
  Wrench,
  ShoppingBag,
  Sparkles,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  CreditCard,
  Banknote,
  Building2,
  Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { useCatalogModules } from "@/lib/catalog-modules";

export const Route = createFileRoute("/_app/pos")({
  head: () => ({ meta: [{ title: "نقطة البيع — فورتيكس ERP" }] }),
  component: POSPage,
});

interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  name_ar: string | null;
  sale_price: number;
  tax_rate: number;
  image_url: string | null;
  category_id?: string | null;
  brand_id?: string | null;
  unit_id?: string | null;
  origin_id?: string | null;
  quality_grade_id?: string | null;
  unit?: { short_name: string; name_ar: string | null; name: string } | null;
  category?: { name: string; name_ar: string | null } | null;
  brand?: { name: string; name_ar: string | null } | null;
  origin?: { name: string; name_ar: string | null; code?: string } | null;
  quality?: { name: string; name_ar: string | null; code?: string } | null;
}

interface CartLine {
  product_id: string;
  name: string;
  unit_price: number;
  tax_rate: number;
  quantity: number;
  is_service?: boolean;
}

interface Warehouse {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Customer {
  id: string;
  name: string;
}

interface MetaOption {
  id: string;
  name: string;
  name_ar: string | null;
  short_name?: string;
  code?: string;
  make_id?: string;
}

interface Compatibility {
  product_id: string;
  vehicle_model_id: string;
}

function POSPage() {
  const { t, lang } = useI18n();
  const { config: catalogConfig } = useCatalogModules();
  const [products, setProducts] = useState<Product[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Comprehensive Catalog Meta Options
  const [categories, setCategories] = useState<MetaOption[]>([]);
  const [brands, setBrands] = useState<MetaOption[]>([]);
  const [units, setUnits] = useState<MetaOption[]>([]);
  const [origins, setOrigins] = useState<MetaOption[]>([]);
  const [qualities, setQualities] = useState<MetaOption[]>([]);
  const [makes, setMakes] = useState<MetaOption[]>([]);
  const [models, setModels] = useState<MetaOption[]>([]);
  const [compatibilities, setCompatibilities] = useState<Compatibility[]>([]);

  const [warehouseId, setWarehouseId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // Filter States
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [selectedOrigin, setSelectedOrigin] = useState("");
  const [selectedQuality, setSelectedQuality] = useState("");
  const [selectedMake, setSelectedMake] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [paid, setPaid] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank_transfer" | "credit">("cash");
  const [note, setNote] = useState("");
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerCreditLimit, setNewCustomerCreditLimit] = useState("");

  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceNote, setServiceNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<{ id: string; number: string } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const scanHandlerRef = useRef<(code: string) => void>(() => undefined);

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (warehouseId) void loadStock(warehouseId);
  }, [warehouseId]);

  useEffect(() => {
    const channel = supabase.channel("pos-live-meta");
    const tables = [
      "categories",
      "brands",
      "units",
      "products",
      "warehouses",
      "customers",
      "countries_of_origin",
      "quality_grades",
      "vehicle_makes",
      "vehicle_models",
      "product_compatibilities",
    ] as const;

    tables.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        void loadAll();
      });
    });

    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  async function loadAll() {
    try {
      const [
        { data: ws },
        { data: cs },
        { data: ps },
        { data: cats },
        { data: brs },
        { data: uns },
        { data: origs },
        { data: quals },
        { data: vMakes },
        { data: vModels },
        { data: compats },
      ] = await Promise.all([
        supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
        supabase.from("customers").select("id,name").eq("is_active", true).order("name"),
        supabase
          .from("products")
          .select(
            "id,sku,barcode,name,name_ar,sale_price,tax_rate,image_url,category_id,brand_id,unit_id,origin_id,quality_grade_id,unit:units(short_name,name,name_ar),category:categories(name,name_ar),brand:brands(name,name_ar),origin:countries_of_origin(name,name_ar,code),quality:quality_grades(name,name_ar,code)"
          )
          .eq("is_active", true)
          .order("name")
          .limit(500),
        supabase.from("categories").select("id,name,name_ar").order("name"),
        supabase.from("brands").select("id,name,name_ar").order("name"),
        supabase.from("units").select("id,name,name_ar,short_name").order("name"),
        (supabase as any).from("countries_of_origin").select("id,name,name_ar,code").order("name"),
        (supabase as any).from("quality_grades").select("id,name,name_ar,code,sort_order").order("sort_order"),
        (supabase as any).from("vehicle_makes").select("id,name,name_ar").order("name"),
        (supabase as any).from("vehicle_models").select("id,name,name_ar,make_id").order("name"),
        (supabase as any).from("product_compatibilities").select("product_id,vehicle_model_id"),
      ]);

      const loadedWarehouses = ws ?? [];
      setWarehouses(loadedWarehouses);
      setCustomers(cs ?? []);
      setProducts((ps as any) ?? []);
      setCategories(cats ?? []);
      setBrands(brs ?? []);
      setUnits(uns ?? []);
      setOrigins(origs ?? []);
      setQualities(quals ?? []);
      setMakes(vMakes ?? []);
      setModels(vModels ?? []);
      setCompatibilities(compats ?? []);

      // Auto-select warehouse if not set or if current one not in list
      if (loadedWarehouses.length > 0) {
        setWarehouseId((current) => (loadedWarehouses.some((w) => w.id === current) ? current : loadedWarehouses[0].id));
      }
    } catch (err: any) {
      console.error("Error loading POS meta:", err);
    }
  }

  async function loadStock(whId: string) {
    const { data } = await supabase.from("inventory").select("product_id,quantity").eq("warehouse_id", whId);
    const map: Record<string, number> = {};
    (data ?? []).forEach((r) => {
      map[r.product_id] = Number(r.quantity);
    });
    setStockMap(map);
  }

  // Active Filters Count
  const activeFiltersCount = useMemo(() => {
    return [
      selectedCategory,
      catalogConfig.enableBrands ? selectedBrand : "",
      catalogConfig.enableUnits ? selectedUnit : "",
      catalogConfig.enableOrigins ? selectedOrigin : "",
      catalogConfig.enableQualityGrades ? selectedQuality : "",
      catalogConfig.enableMakesAndModels ? selectedMake : "",
      catalogConfig.enableMakesAndModels ? selectedModel : "",
    ].filter(Boolean).length;
  }, [
    selectedCategory,
    selectedBrand,
    selectedUnit,
    selectedOrigin,
    selectedQuality,
    selectedMake,
    selectedModel,
    catalogConfig,
  ]);

  function resetFilters() {
    setSelectedCategory("");
    setSelectedBrand("");
    setSelectedUnit("");
    setSelectedOrigin("");
    setSelectedQuality("");
    setSelectedMake("");
    setSelectedModel("");
  }

  // Filtered models based on selected make
  const availableModels = useMemo(() => {
    if (!selectedMake) return models;
    return models.filter((m) => m.make_id === selectedMake);
  }, [models, selectedMake]);

  // Handle Make change (resets model if incompatible)
  function handleMakeChange(makeId: string) {
    setSelectedMake(makeId);
    if (selectedModel) {
      const targetModel = models.find((m) => m.id === selectedModel);
      if (targetModel && targetModel.make_id !== makeId) {
        setSelectedModel("");
      }
    }
  }

  // Filtered Products
  const filtered = useMemo(() => {
    // Model compatibility set
    const compatibleWithModel = selectedModel
      ? new Set(compatibilities.filter((c) => c.vehicle_model_id === selectedModel).map((c) => c.product_id))
      : null;

    // Make compatibility set
    const makeModelIds = selectedMake
      ? new Set(models.filter((m) => m.make_id === selectedMake).map((m) => m.id))
      : null;
    const compatibleWithMake = makeModelIds
      ? new Set(compatibilities.filter((c) => makeModelIds.has(c.vehicle_model_id)).map((c) => c.product_id))
      : null;

    return products.filter((p) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.name_ar ?? "").includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q);

      const matchesCat = !selectedCategory || p.category_id === selectedCategory;
      const matchesBrand = !catalogConfig.enableBrands || !selectedBrand || p.brand_id === selectedBrand;
      const matchesUnit = !catalogConfig.enableUnits || !selectedUnit || p.unit_id === selectedUnit;
      const matchesOrigin = !catalogConfig.enableOrigins || !selectedOrigin || p.origin_id === selectedOrigin;
      const matchesQuality = !catalogConfig.enableQualityGrades || !selectedQuality || p.quality_grade_id === selectedQuality;
      const matchesMake = !catalogConfig.enableMakesAndModels || !compatibleWithMake || compatibleWithMake.has(p.id);
      const matchesModel = !catalogConfig.enableMakesAndModels || !compatibleWithModel || compatibleWithModel.has(p.id);

      return (
        matchesSearch &&
        matchesCat &&
        matchesBrand &&
        matchesUnit &&
        matchesOrigin &&
        matchesQuality &&
        matchesMake &&
        matchesModel
      );
    });
  }, [
    products,
    search,
    selectedCategory,
    selectedBrand,
    selectedUnit,
    selectedOrigin,
    selectedQuality,
    selectedMake,
    selectedModel,
    compatibilities,
    models,
    catalogConfig,
  ]);

  function addToCart(p: Product) {
    const stock = stockMap[p.id] ?? 0;
    const prodName = lang === "ar" && p.name_ar ? p.name_ar : p.name;
    if (stock <= 0) {
      return toast.error(lang === "ar" ? `نفد المخزون من: ${prodName}` : `${p.name} ${t("pos.out_of_stock")}`);
    }
    setCart((c) => {
      const existing = c.find((l) => l.product_id === p.id);
      if (existing) {
        if (existing.quantity >= stock) {
          toast.error(
            lang === "ar" ? `الحد الأقصى المتاح في المخزون: ${stock}` : `${t("pos.max_stock")}: ${stock}`
          );
          return c;
        }
        return c.map((l) => (l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...c,
        {
          product_id: p.id,
          name: prodName,
          unit_price: Number(p.sale_price),
          tax_rate: Number(p.tax_rate ?? 0),
          quantity: 1,
        },
      ];
    });
  }

  function setQty(pid: string, qty: number) {
    const service = cart.find((l) => l.product_id === pid)?.is_service;
    if (service) {
      if (qty < 1) setCart((c) => c.filter((l) => l.product_id !== pid));
      else setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, quantity: qty } : l)));
      return;
    }
    const stock = stockMap[pid] ?? 0;
    if (qty < 1) return setCart((c) => c.filter((l) => l.product_id !== pid));
    if (qty > stock) {
      toast.error(
        lang === "ar" ? `الحد الأقصى المتاح في المخزون: ${stock}` : `${t("pos.max_stock")}: ${stock}`
      );
      return;
    }
    setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, quantity: qty } : l)));
  }

  function addService() {
    const price = Number(servicePrice);
    if (!serviceName.trim() || !Number.isFinite(price) || price < 0) {
      return toast.error(lang === "ar" ? "يرجى إدخال اسم الخدمة وسعرها المتفق عليه" : "Enter a service name and price");
    }
    const id = `service-${crypto.randomUUID()}`;
    setCart((c) => [
      ...c,
      {
        product_id: id,
        name: serviceNote.trim() ? `${serviceName.trim()} — ${serviceNote.trim()}` : serviceName.trim(),
        unit_price: price,
        tax_rate: 0,
        quantity: 1,
        is_service: true,
      },
    ]);
    setServiceName("");
    setServicePrice("");
    setServiceNote("");
    setServiceOpen(false);
    toast.success(lang === "ar" ? "تمت إضافة الخدمة للسلة" : "Service added to cart");
  }

  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = search.trim();
    if (!q) return;
    handleCode(q);
  }

  function handleCode(code: string) {
    const q = code.trim();
    if (!q) return;
    const exact = products.find((p) => p.barcode === q || p.sku === q);
    if (exact) {
      addToCart(exact);
      confirmScan();
      setSearch("");
      return;
    }
    const partial = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        (p.name_ar ?? "").includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q.toLowerCase()) ||
        (p.barcode ?? "").toLowerCase().includes(q.toLowerCase())
    );
    if (partial.length === 1) {
      addToCart(partial[0]);
      confirmScan();
      setSearch("");
      return;
    }
    toast.error(lang === "ar" ? `لم يُعثر على منتج مطابق للرمز: ${q}` : `No product for: ${q}`);
  }

  function confirmScan() {
    navigator.vibrate?.(35);
  }

  scanHandlerRef.current = handleCode;

  // Financial Computations
  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const taxTotal = cart.reduce((s, l) => s + l.unit_price * l.quantity * (l.tax_rate / 100), 0);
  const discountN = Number(discount || 0);
  const total = Math.max(0, subtotal + taxTotal - discountN);

  // Auto-Paid & Smart Payment Logic
  const isPaidEmpty = paid.trim() === "";
  const effectivePaid = isPaidEmpty ? total : Number(paid);
  const isOverpaid = !isPaidEmpty && Number(paid) > total;
  const remainingDebt = Math.max(0, total - effectivePaid);

  // Handle smart payment method switching on paid input change
  function handlePaidChange(val: string) {
    setPaid(val);
    if (val.trim() === "") {
      // Empty -> auto full payment -> switch to cash if was credit
      if (paymentMethod === "credit") {
        setPaymentMethod("cash");
      }
    } else {
      const num = Number(val);
      if (!isNaN(num)) {
        if (num < total) {
          // Paid less than total (partial or 0) -> auto switch to credit (آجل)
          setPaymentMethod("credit");
        } else if (num >= total && paymentMethod === "credit") {
          // Paid in full or more -> auto switch back to cash (نقدًا)
          setPaymentMethod("cash");
        }
      }
    }
  }

  // When total changes and user has entered an explicit amount in paid:
  useEffect(() => {
    if (paid.trim() !== "") {
      const num = Number(paid);
      if (!isNaN(num)) {
        if (num < total && paymentMethod === "cash") {
          setPaymentMethod("credit");
        } else if (num >= total && paymentMethod === "credit") {
          setPaymentMethod("cash");
        }
      }
    }
  }, [total]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setScannerOpen((v) => !v);
      } else if (e.key === "F9" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        if (cart.length > 0 && !loading && !isOverpaid) {
          void checkout();
        }
      }
    };
    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
  }, [cart, loading, warehouseId, customerId, paymentMethod, paid, discount, isOverpaid, total]);

  async function checkout() {
    if (!warehouseId) {
      return toast.error(lang === "ar" ? "يرجى اختيار المستودع أولاً" : t("pos.select_warehouse"));
    }
    if (cart.length === 0) {
      return toast.error(lang === "ar" ? "السلة فارغة، يرجى إضافة منتجات أولاً" : t("pos.cart_empty"));
    }
    if (isOverpaid) {
      return toast.error(
        lang === "ar" ? "المبلغ المدفوع أكبر من إجمالي الفاتورة المطلوب!" : "Paid amount cannot exceed invoice total!"
      );
    }
    if (effectivePaid < 0) {
      return toast.error(lang === "ar" ? "المبلغ المدفوع لا يمكن أن يكون سالبًا" : "Paid amount cannot be negative");
    }
    if (effectivePaid < total && !customerId) {
      return toast.error(
        lang === "ar"
          ? "يرجى اختيار العميل لتسجيل المبلغ المتبقي كدين آجل"
          : "Select a customer so the unpaid balance can be recorded as debt"
      );
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("create_sale", {
        _warehouse_id: warehouseId,
        _customer_id: (customerId || null) as any,
        _payment_method: paymentMethod,
        _paid: Math.min(Math.max(effectivePaid, 0), total),
        _discount: discountN,
        _note: (note || null) as any,
        _sale_date: saleDate,
        _items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          tax_rate: l.tax_rate,
          is_service: !!l.is_service,
          name: l.name,
        })),
      });
      if (error) throw error;
      const invoiceId = data as string;
      const { data: inv } = await supabase
        .from("sales_invoices")
        .select("invoice_number")
        .eq("id", invoiceId)
        .maybeSingle();
      setLastInvoice({ id: invoiceId, number: inv?.invoice_number ?? "" });
      toast.success(
        lang === "ar"
          ? `تمت عملية البيع بنجاح — فاتورة #${inv?.invoice_number ?? ""}`
          : `${t("pos.sale_complete")} — #${inv?.invoice_number ?? ""}`
      );
      setCart([]);
      setPaid("");
      setDiscount("");
      setNote("");
      setSaleDate(new Date().toISOString().slice(0, 10));
      await loadStock(warehouseId);
      searchRef.current?.focus();
    } catch (err: any) {
      toast.error(err.message ?? (lang === "ar" ? "فشل إصدار الفاتورة" : t("pos.checkout_failed")));
    } finally {
      setLoading(false);
    }
  }

  async function createCustomer() {
    const name = newCustomerName.trim();
    if (!name) {
      return toast.error(lang === "ar" ? "اسم العميل مطلوب" : "Customer name is required");
    }
    const { data, error } = await supabase
      .from("customers")
      .insert({
        name,
        phone: newCustomerPhone.trim() || null,
        credit_limit: Math.max(0, Number(newCustomerCreditLimit || 0)),
      })
      .select("id,name")
      .single();
    if (error) return toast.error(error.message);
    setCustomers((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
    setCustomerId(data.id);
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNewCustomerCreditLimit("");
    setNewCustomerOpen(false);
    toast.success(lang === "ar" ? "تمت إضافة العميل واختياره بنجاح" : "Customer added and selected");
  }

  const selectClassName =
    "h-10 w-full appearance-none rounded-2xl border border-border/80 bg-surface/90 px-3.5 text-xs text-foreground outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <>
      <PageHeader title={t("pos.title")} subtitle={t("pos.subtitle")} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_440px]">
        {/* Products Panel */}
        <div className="order-2 flex flex-col panel-elevated p-4 lg:order-1 rounded-3xl border border-border/80 bg-surface/90 shadow-sm">
          {/* Top Action Bar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-input/80 bg-surface px-3.5 h-10 shadow-2xs transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleScan}
                placeholder={`${t("pos.search_or_scan")} (F2)`}
                className="w-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="rounded-full p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <kbd className="hidden sm:inline-block rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                F2
              </kbd>
            </div>

            {/* Smart Responsive Filter Button */}
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-all duration-200 ${
                filterOpen || activeFiltersCount > 0
                  ? "border-primary bg-primary/10 text-primary shadow-xs shadow-primary/10 ring-1 ring-primary/20"
                  : "border-border bg-surface text-muted-foreground hover:border-ring hover:text-foreground"
              }`}
              title={lang === "ar" ? "تصفية المنتجات" : "Filter products"}
            >
              <Filter className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{t("common.filter")}</span>
              {activeFiltersCount > 0 && (
                <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground leading-none">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Barcode Camera Scanner (Hidden on Laptops/Desktops >= 1024px, Visible on Mobile & Tablets) */}
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="grid lg:hidden h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary transition hover:bg-primary/20 active:scale-95 shadow-2xs"
              title={lang === "ar" ? "قراءة الباركود بالكاميرا (F4)" : "Scan with camera (F4)"}
            >
              <ScanBarcode className="h-4 w-4" />
            </button>

            {/* Warehouse Select (Only shown if more than 1 warehouse exists) */}
            {warehouses.length > 1 && (
              <div className="relative shrink-0">
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="h-10 appearance-none rounded-full border border-amber-500/30 bg-amber-500/10 pl-9 pr-8 text-xs font-semibold text-amber-600 dark:text-amber-300 outline-none hover:bg-amber-500/20 rtl:pl-8 rtl:pr-9 cursor-pointer transition"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-700 dark:text-amber-300" />
              </div>
            )}
          </div>

          {/* Comprehensive Elegant Catalog Filter Form */}
          {filterOpen && (
            <div className="mb-4 rounded-3xl border border-border/80 bg-surface/95 p-4 shadow-lg backdrop-blur-md transition-all duration-200">
              <div className="mb-3 flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-primary" />
                  <span className="text-sm font-bold text-foreground">
                    {lang === "ar" ? "تصفية الفهرس الشامل" : "Catalog Filters"}
                  </span>
                  {activeFiltersCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary font-mono">
                      {activeFiltersCount} {lang === "ar" ? "نشط" : "active"}
                    </span>
                  )}
                </div>
                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-surface px-2.5 py-1 text-xs text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive active:scale-95"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>{t("common.reset")}</span>
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {/* 1. Categories */}
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{t("common.categories")}</span>
                  <div className="relative">
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">{t("common.all")}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {lang === "ar" ? c.name_ar || c.name : c.name || c.name_ar || ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>

                {/* 2. Brands */}
                {catalogConfig.enableBrands && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{t("common.brands")}</span>
                  <div className="relative">
                    <select
                      value={selectedBrand}
                      onChange={(e) => setSelectedBrand(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">{t("common.all")}</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {lang === "ar" ? b.name_ar || b.name : b.name || b.name_ar || ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                )}

                {/* 3. Units */}
                {catalogConfig.enableUnits && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{t("common.units")}</span>
                  <div className="relative">
                    <select
                      value={selectedUnit}
                      onChange={(e) => setSelectedUnit(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">{t("common.all")}</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {lang === "ar" ? u.name_ar || u.short_name || u.name : u.short_name || u.name || u.name_ar || ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                )}

                {/* 4. Countries of Origin */}
                {catalogConfig.enableOrigins && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{lang === "ar" ? "بلدان المنشأ" : "Country of Origin"}</span>
                  <div className="relative">
                    <select
                      value={selectedOrigin}
                      onChange={(e) => setSelectedOrigin(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">{t("common.all")}</option>
                      {origins.map((o) => (
                        <option key={o.id} value={o.id}>
                          {lang === "ar" ? o.name_ar || o.name : o.name || o.name_ar || ""}
                          {o.code ? ` (${o.code})` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                )}

                {/* 5. Quality Grades */}
                {catalogConfig.enableQualityGrades && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{lang === "ar" ? "درجات الجودة" : "Quality Grade"}</span>
                  <div className="relative">
                    <select
                      value={selectedQuality}
                      onChange={(e) => setSelectedQuality(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">{t("common.all")}</option>
                      {qualities.map((q) => (
                        <option key={q.id} value={q.id}>
                          {lang === "ar" ? q.name_ar || q.name : q.name || q.name_ar || ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                )}

                {/* 6. Vehicle Makes */}
                {catalogConfig.enableMakesAndModels && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{lang === "ar" ? "ماركات المركبات" : "Vehicle Make"}</span>
                  <div className="relative">
                    <select
                      value={selectedMake}
                      onChange={(e) => handleMakeChange(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">{t("common.all")}</option>
                      {makes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {lang === "ar" ? m.name_ar || m.name : m.name || m.name_ar || ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                )}

                {/* 7. Vehicle Models */}
                {catalogConfig.enableMakesAndModels && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{lang === "ar" ? "موديلات المركبات" : "Vehicle Model"}</span>
                  <div className="relative">
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">{t("common.all")}</option>
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {lang === "ar" ? m.name_ar || m.name : m.name || m.name_ar || ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                )}
              </div>
            </div>
          )}

          {/* Product Grid Area */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 max-h-[calc(100vh-270px)] overflow-y-auto pr-1">
            {filtered.map((p) => {
              const stock = stockMap[p.id] ?? 0;
              const low = stock <= 0;
              const catLabel =
                lang === "ar" ? p.category?.name_ar || p.category?.name : p.category?.name || p.category?.name_ar;
              const unitLabel =
                lang === "ar" ? p.unit?.name_ar || p.unit?.short_name : p.unit?.short_name || p.unit?.name_ar;
              const originLabel =
                lang === "ar" ? p.origin?.name_ar || p.origin?.name : p.origin?.name || p.origin?.name_ar;
              const qualityLabel =
                lang === "ar" ? p.quality?.name_ar || p.quality?.name : p.quality?.name || p.quality?.name_ar;

              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  disabled={low}
                  className="group relative flex flex-col items-start justify-between gap-1.5 rounded-2xl border border-border/80 bg-surface/90 p-3 text-start transition-all hover:border-primary/50 hover:bg-surface-2 hover:shadow-sm disabled:opacity-40"
                >
                  <div className="w-full">
                    <div className="line-clamp-2 text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                      {lang === "ar" && p.name_ar ? p.name_ar : p.name}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                      {catLabel && (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
                          {catLabel}
                        </span>
                      )}
                      {unitLabel && (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
                          {unitLabel}
                        </span>
                      )}
                      {catalogConfig.enableOrigins && originLabel && (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
                          {originLabel}
                        </span>
                      )}
                      {catalogConfig.enableQualityGrades && qualityLabel && (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
                          {qualityLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex w-full items-center justify-between border-t border-border/40 pt-1.5">
                    <span className="text-sm font-bold text-primary font-mono">{money(Number(p.sale_price))}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                        low ? "bg-destructive/10 text-destructive font-semibold" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {low ? (lang === "ar" ? "نفد" : "0") : `${stock}`}
                    </span>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full grid place-items-center py-16 text-sm text-muted-foreground">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-surface mb-3">
                  <ScanBarcode className="h-6 w-6 opacity-60 text-primary" />
                </div>
                <div className="font-semibold text-foreground">{t("pos.no_products")}</div>
                {activeFiltersCount > 0 && (
                  <button
                    onClick={resetFilters}
                    className="mt-2 text-xs text-primary underline underline-offset-4 hover:opacity-80"
                  >
                    {lang === "ar" ? "إلغاء التصفية وإظهار الكل" : "Clear filters and show all"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Cart Panel - Elegant, Fixed Viewport Height, Dedicated Internal Scroll */}
        <div className="order-1 flex flex-col rounded-3xl border border-border/80 bg-surface/95 shadow-xl p-4 lg:order-2 lg:sticky lg:top-4 h-[650px] lg:h-[calc(100vh-120px)] lg:max-h-[calc(100vh-120px)] overflow-hidden backdrop-blur-md">
          {/* Cart Header */}
          <div className="shrink-0 mb-3 flex items-center justify-between rounded-2xl border border-border/70 bg-gradient-to-l from-primary/10 via-surface-2/40 to-transparent px-3.5 py-2.5 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary">
                <ShoppingBag className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <span>{t("pos.cart")}</span>
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-mono font-bold text-primary">
                    {cart.length}
                  </span>
                </h2>
              </div>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setCart([])}
                className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-surface/80 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive active:scale-95"
              >
                <Trash2 className="h-3 w-3" />
                <span>{t("pos.clear")}</span>
              </button>
            )}
          </div>

          {/* Quick Service Banner */}
          <div className="shrink-0 mb-2.5 flex items-center justify-between rounded-2xl border border-dashed border-violet-500/30 bg-violet-500/5 px-3 py-2 transition hover:bg-violet-500/10">
            <div className="flex items-center gap-2 min-w-0">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">
                <Wrench className="h-3.5 w-3.5" />
              </div>
              <span className="truncate text-xs font-medium text-muted-foreground">
                {lang === "ar" ? "خدمة أو أجرة تركيب بسعر متفق عليه" : "Service or custom labor"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setServiceOpen(true)}
              className="shrink-0 h-7 rounded-full bg-violet-600 px-3 text-xs font-medium text-white shadow-xs shadow-violet-500/20 transition hover:bg-violet-500 active:scale-95"
            >
              {lang === "ar" ? "+ خدمة" : "+ Service"}
            </button>
          </div>

          {/* Customer Selection - Elegant Rounded Full with 100% Round Add Button */}
          <div className="shrink-0 mb-2.5 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <select
                aria-label={lang === "ar" ? "العميل" : "Customer"}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="h-10 w-full appearance-none rounded-full border border-border/80 bg-surface/90 px-4 pl-9 pr-9 text-xs font-medium outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20 rtl:pl-9 rtl:pr-4"
              >
                <option value="">{t("pos.walkin")}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-3 rtl:right-auto" />
            </div>

            <button
              type="button"
              onClick={() => setNewCustomerOpen(true)}
              title={lang === "ar" ? "إضافة عميل جديد" : "Add new customer"}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary transition hover:bg-primary/20 hover:scale-105 active:scale-95 shadow-xs shadow-primary/10"
            >
              <UserPlus className="h-4 w-4" />
            </button>
          </div>

          {/* Dedicated Internal Scroll Area for Cart Items */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2.5 my-1 custom-scrollbar">
            {cart.length === 0 ? (
              <div className="grid place-items-center py-14 text-sm text-muted-foreground">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-border bg-surface-2/40 mb-3">
                  <ShoppingBag className="h-6 w-6 opacity-40 text-muted-foreground" />
                </div>
                <div className="font-medium">{t("pos.empty_cart")}</div>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  {lang === "ar" ? "انقر على أي منتج أو امسح الباركود لإضافته" : "Click any product or scan to add"}
                </p>
              </div>
            ) : (
              cart.map((l) => (
                <div
                  key={l.product_id}
                  className={`group relative rounded-2xl border p-3 transition-all duration-200 ${
                    l.is_service
                      ? "border-violet-500/30 bg-violet-500/5 hover:border-violet-500/50"
                      : "border-border/70 bg-surface-2/40 hover:border-primary/40 hover:bg-surface-2/70 shadow-2xs"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground tracking-tight">
                        {l.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                        <span className="text-primary font-medium">{money(l.unit_price)}</span>
                        {l.tax_rate > 0 && (
                          <span className="rounded bg-muted px-1 py-0.2 text-[9px] text-muted-foreground">
                            +{l.tax_rate}% {t("pos.tax")}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQty(l.product_id, 0)}
                      title={t("common.delete")}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive active:scale-90"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2 pt-1.5 border-t border-border/40">
                    <div className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-surface/90 p-0.5 shadow-2xs">
                      <button
                        type="button"
                        onClick={() => setQty(l.product_id, l.quantity - 1)}
                        className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition hover:bg-surface-2 hover:text-foreground active:scale-90"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={l.quantity}
                        onChange={(e) => setQty(l.product_id, Number(e.target.value))}
                        className="h-6 w-11 bg-transparent text-center text-xs font-mono font-bold text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        type="button"
                        onClick={() => setQty(l.product_id, l.quantity + 1)}
                        className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition hover:bg-surface-2 hover:text-foreground active:scale-90"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-end">
                      <span className="text-sm font-bold font-mono text-foreground">
                        {money(l.unit_price * l.quantity * (1 + l.tax_rate / 100))}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer Summary & Payment Controls */}
          <div className="shrink-0 pt-2.5 border-t border-border/70 space-y-2 mt-auto bg-surface/60 backdrop-blur-xs">
            {/* Financial Rows */}
            <div className="space-y-1 text-xs">
              <Row label={t("pos.subtotal")} value={money(subtotal)} />
              {taxTotal > 0 && <Row label={t("pos.tax")} value={money(taxTotal)} />}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("pos.discount")}</span>
                <input
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0"
                  className="h-6 w-20 rounded-full border border-border bg-surface px-2.5 text-end text-xs font-mono outline-none focus:border-primary"
                />
              </div>
              <Row label={t("pos.total")} value={money(total)} bold />
            </div>

            {/* Payment Method Switcher */}
            <div className="grid grid-cols-4 gap-1 pt-1">
              {(["cash", "card", "bank_transfer", "credit"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`h-8 rounded-xl border text-xs font-semibold transition-all duration-150 flex items-center justify-center gap-1 ${
                    paymentMethod === m
                      ? "border-primary bg-primary/15 text-primary shadow-2xs ring-1 ring-primary/30"
                      : "border-border/80 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  {m === "cash" && <Banknote className="h-3 w-3" />}
                  {m === "card" && <CreditCard className="h-3 w-3" />}
                  {m === "bank_transfer" && <Building2 className="h-3 w-3" />}
                  {m === "credit" && <Clock className="h-3 w-3" />}
                  <span>{t(`pos.pm.${m}`)}</span>
                </button>
              ))}
            </div>

            {/* Date & Paid Input */}
            <div className="space-y-1.5 pt-1">
              <div className="grid grid-cols-2 gap-2">
                {/* Sale Date */}
                <label className="flex h-9 items-center gap-1.5 rounded-full border border-input/80 bg-surface/90 px-3 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none font-mono"
                  />
                </label>

                {/* Paid Input */}
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    value={paid}
                    onChange={(e) => handlePaidChange(e.target.value)}
                    placeholder={
                      isPaidEmpty
                        ? `${lang === "ar" ? "مدفوع بالكامل" : "Full paid"} (${total.toFixed(0)})`
                        : `${t("pos.paid")}`
                    }
                    className={`h-9 w-full rounded-full border px-3 text-xs font-mono outline-none transition ${
                      isOverpaid
                        ? "border-destructive bg-destructive/10 text-destructive focus:ring-2 focus:ring-destructive/30"
                        : "border-input/80 bg-surface/90 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                    }`}
                  />
                </div>
              </div>

              {/* Status Badges: Overpaid Alert / Remaining Debt / Auto-Paid Indicator */}
              {isOverpaid ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive flex items-center gap-1.5 animate-in fade-in duration-200">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {lang === "ar"
                      ? `المبلغ المدفوع (${money(effectivePaid)}) أكبر من الإجمالي المطلوب (${money(total)})`
                      : `Paid amount (${money(effectivePaid)}) exceeds total (${money(total)})`}
                  </span>
                </div>
              ) : paymentMethod === "credit" && remainingDebt > 0 ? (
                <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-mono text-amber-600 dark:text-amber-300">
                  <span>{lang === "ar" ? "المتبقي كدين آجل:" : "Remaining debt:"}</span>
                  <span className="font-bold">{money(remainingDebt)}</span>
                </div>
              ) : isPaidEmpty ? (
                <div className="flex items-center justify-between text-[11px] text-emerald-600 dark:text-emerald-400 font-medium px-2">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {lang === "ar" ? "المدفوع تلقائيًا: كامل الإجمالي" : "Auto paid: Full invoice"}
                  </span>
                  <span className="font-mono font-semibold">{money(total)}</span>
                </div>
              ) : null}
            </div>

            {/* Checkout Button */}
            {isOverpaid ? (
              <button
                type="button"
                disabled
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-destructive text-sm font-bold text-destructive-foreground border border-destructive/60 cursor-not-allowed opacity-90 shadow-lg shadow-destructive/20 ring-2 ring-destructive/30"
              >
                <AlertCircle className="h-4 w-4" />
                <span>{lang === "ar" ? "المبلغ المدفوع أكبر من الإجمالي!" : "Paid amount exceeds total!"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={checkout}
                disabled={loading || cart.length === 0}
                className="mt-2 flex h-11 w-full items-center justify-between px-4 rounded-2xl bg-gradient-to-r from-primary to-primary/90 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/35 hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-50 disabled:pointer-events-none"
              >
                <div className="flex items-center gap-2">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  <span>{t("pos.checkout")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-base">{money(total)}</span>
                  <kbd className="hidden sm:inline-block rounded-md bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-mono text-primary-foreground">
                    F9
                  </kbd>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Barcode Scanner Dialog */}
      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        continuous
        onDetected={handleCode}
      />

      {/* New Customer Dialog */}
      {newCustomerOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createCustomer();
            }}
            className="panel-elevated w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-border/80"
          >
            <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="font-bold text-foreground">
                {lang === "ar" ? "إضافة عميل جديد سريعًا" : "Quick add customer"}
              </h3>
              <button
                type="button"
                onClick={() => setNewCustomerOpen(false)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                autoFocus
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                placeholder={lang === "ar" ? "اسم العميل *" : "Customer name *"}
                className="h-10 w-full rounded-2xl border border-input bg-surface px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <input
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                placeholder={lang === "ar" ? "رقم الجوال (اختياري)" : "Phone (optional)"}
                className="h-10 w-full rounded-2xl border border-input bg-surface px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <div>
                <input
                  type="number"
                  min="0"
                  value={newCustomerCreditLimit}
                  onChange={(e) => setNewCustomerCreditLimit(e.target.value)}
                  placeholder={lang === "ar" ? "حد الائتمان — صفر = بلا سقف" : "Credit limit — zero means unlimited"}
                  className="h-10 w-full rounded-2xl border border-input bg-surface px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {lang === "ar" ? "يمكن تركه صفرًا للسماح بالبيع الآجل بلا حد." : "Leave zero to allow unlimited credit."}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewCustomerOpen(false)}
                className="h-9 rounded-full border border-border px-4 text-xs font-medium hover:bg-surface-2"
              >
                {t("common.cancel")}
              </button>
              <button className="h-9 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90">
                {lang === "ar" ? "إضافة واختيار" : "Add & select"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Custom Service Dialog */}
      {serviceOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addService();
            }}
            className="panel-elevated w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-border/80"
          >
            <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="font-bold text-foreground">{lang === "ar" ? "إضافة خدمة أو أجرة" : "Add service"}</h3>
              <button
                type="button"
                onClick={() => setServiceOpen(false)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                autoFocus
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder={lang === "ar" ? "اسم الخدمة (مثال: تغيير زيت أو صيانة)" : "Service name"}
                className="h-10 w-full rounded-2xl border border-input bg-surface px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <input
                type="number"
                min="0"
                value={servicePrice}
                onChange={(e) => setServicePrice(e.target.value)}
                placeholder={lang === "ar" ? "السعر المتفق عليه" : "Agreed price"}
                className="h-10 w-full rounded-2xl border border-input bg-surface px-3.5 text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <input
                value={serviceNote}
                onChange={(e) => setServiceNote(e.target.value)}
                placeholder={lang === "ar" ? "ملاحظة اختيارية" : "Optional note"}
                className="h-10 w-full rounded-2xl border border-input bg-surface px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setServiceOpen(false)}
                className="h-9 rounded-full border border-border px-4 text-xs font-medium hover:bg-surface-2"
              >
                {t("common.cancel")}
              </button>
              <button className="h-9 rounded-full bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-500 shadow-sm shadow-violet-500/25">
                {lang === "ar" ? "إضافة للسلة" : "Add to cart"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? "font-bold text-sm text-foreground pt-1 border-t border-border/40" : "text-muted-foreground"
      }`}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
