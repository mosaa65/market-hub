import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
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
  ShoppingBag,
  Sparkles,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  CreditCard,
  Banknote,
  Building2,
  Clock,
  Printer,
  Receipt,
  FileText,
  Truck,
  ArrowRight,
  PackagePlus,
  Coins,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PageGuideButton, type PageGuideConfig } from "@/components/page-guide";
import { DollarSign, Archive, Zap } from "lucide-react";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { useKeyboardWedge } from "@/hooks/use-keyboard-wedge";
import { useCatalogModules } from "@/lib/catalog-modules";
import { useIsDesktop } from "@/hooks/use-media-query";
import { CartLine as CartLineRow } from "@/components/commerce/cart-line";
import { MobileProductPicker } from "@/components/commerce/mobile-product-picker";
import { SupplierFormDialog } from "@/components/contacts/supplier-form-dialog";
import { UniversalPrintPreview } from "@/components/universal-print-preview";
import type { PrintRequest } from "@/lib/printing";

export const Route = createFileRoute("/_app/purchase-pos")({
  head: () => ({ meta: [{ title: "نقطة المشتريات — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="purchases">
      <PurchasePOSPage />
    </ModuleGuard>
  ),
});

interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  name_ar: string | null;
  cost_price: number;
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
  sku: string | null;
  unit_cost: number;
  tax_rate: number;
  quantity: number;
}

interface Warehouse {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
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

const purchasePosGuideConfig: PageGuideConfig = {
  title: "دليل نقطة المشتريات السريعة والتوريد (POP)",
  subtitle:
    "شرح لدورة إدخال البضاعة اللحظية، تحديث أسعار التكلفة والمخزون، ومعالجة الموردين النقديين والآجلين.",
  badge: "توريد ومشتريات سريعة",
  icon: <ShoppingBag className="h-5 w-5 text-sky-500" />,
  summaryText:
    "تم تصميم واجهة نقطة المشتريات (Point of Purchase) لتمنح مسؤولي المشتريات وأمناء المخازن نفس سلاسة وسرعة الكاشير، لتوثيق استلام البضائع وزيادة الأرصدة وتعديل أسعار الشراء لحظة بلحظة.",
  overviewCards: [
    {
      title: "دعم كامل للمورد النقدي (Cash Vendor)",
      description:
        "إمكانية الشراء السريع والنثري دون الحاجة لفتح حساب مالي مستقل لكل بائع عابر في السوق.",
      icon: <DollarSign className="h-4 w-4" />,
    },
    {
      title: "تعديل فوري لسعر التكلفة لكل صنف",
      description:
        "إمكانية مراجعة وتحديث سعر الشراء مباشرة في السلة لكل بند ليتناسب مع فاتورة المورد الفعلية.",
      icon: <Truck className="h-4 w-4" />,
    },
    {
      title: "إضافة فورية للرصيد بالمستودع",
      description:
        "زيادة كميات المخزون وتحديث متوسط التكلفة في المستودع المختار فور الضغط على زر الحفظ.",
      icon: <Archive className="h-4 w-4" />,
    },
    {
      title: "حفظ سريع باختصار لوحة المفاتيح",
      description:
        "البحث السريع بـ (F2) وحفظ وتأكيد فاتورة الشراء بالكامل بضغطة زر أو اختصار (F4).",
      icon: <Zap className="h-4 w-4" />,
    },
  ],
  matrixTitle: "مصفوفة الأثر المالي والمخزني لفواتير المشتريات السريعة",
  matrixDescription:
    "جدول تحليلي يوضح قيود اليومية وتأثير حركة الشراء على الذمم وأرصدة المستودعات:",
  impactMatrix: {
    columns: [
      { key: "purchaseType", label: "نوع العملية وطريقة السداد", className: "w-[22%]" },
      { key: "inventoryImpact", label: "التأثير المخزني", className: "w-[24%]" },
      { key: "financialImpact", label: "الأثر المالي والقيد المحاسبي", className: "w-[30%]" },
      { key: "auditControls", label: "الضوابط والتدقيق", className: "w-[24%]" },
    ],
    rows: [
      {
        badge: { label: "شراء نقدي كاش", variant: "emerald" },
        fields: {
          purchaseType: "فاتورة مشتريات نقدية كاملة",
          inventoryImpact: "زيادة رصيد المستودع المختار فوراً بالكميات المستلمة.",
          accountingImpact: "من حـ/ المخزون (مدين) إلى حـ/ الصندوق أو العهدة النقدية (دائن).",
          auditControls: "تسوية فورية دون تسجيل أي ذمة أو مديونية على المنشأة.",
        },
      },
      {
        badge: { label: "شراء آجل (ذمم موردين)", variant: "purple" },
        fields: {
          purchaseType: "فاتورة مشتريات على الحساب",
          inventoryImpact: "زيادة رصيد المستودع بالكميات المستلمة.",
          accountingImpact: "من حـ/ المخزون (مدين) إلى حـ/ المورد المختار (دائن) كالتزام مالي.",
          auditControls: "اشتراط اختيار مورد معتمد ومطابقة كشف حساب المورد لاحقاً.",
        },
      },
      {
        badge: { label: "سداد بنكي / شبكة", variant: "blue" },
        fields: {
          purchaseType: "دفع بالتحويل أو البطاقة",
          inventoryImpact: "زيادة كميات المخزون وتحديث التكلفة.",
          accountingImpact: "من حـ/ المخزون (مدين) إلى حـ/ البنك أو الحساب الجاري (دائن).",
          auditControls: "توثيق رقم المرجع البنكي في حقل الملاحظات.",
        },
      },
      {
        badge: { label: "سداد جزئي", variant: "amber" },
        fields: {
          purchaseType: "دفع دفعة مقدمة والباقي آجل",
          inventoryImpact: "زيادة كامل كميات البضاعة في المستودع.",
          accountingImpact: "قيد مركب: إلى حـ/ الصندوق (بالمبلغ المدفوع) وحـ/ المورد (بالمتبقي).",
          auditControls: "تحديث رصيد المورد التراكمي بالمبلغ المتبقي غير المسدد فقط.",
        },
      },
    ],
  },
  stepsTitle: "الخطوات القياسية لتسجيل مشتريات سريعة",
  steps: [
    {
      number: "1",
      title: "اختيار المستودع والمورد",
      description:
        "حدد المستودع الذي ستدخل إليه البضاعة، واختر المورد (أو اترك المورد النقدي الافتراضي للمشتريات العاجلة).",
    },
    {
      number: "2",
      title: "مسح أو اختيار المنتجات",
      description: "ابحث بالاسم أو امسح الباركود لإضافة الأصناف المطلوبة إلى سلة الشراء.",
    },
    {
      number: "3",
      title: "مراجعة سعر الشراء والكمية",
      description: "تأكد من مطابقة سعر التكلفة للوحدة مع فاتورة المورد الورقية وعدل الكميات بدقة.",
    },
    {
      number: "4",
      title: "تحديد الدفع والحفظ (F4)",
      description: "اختر طريقة السداد (نقدي/آجل/بنكي) واضغط زر الحفظ (F4) لترحيل الفاتورة فوراً.",
    },
  ],
  rulesTitle: "ضوابط الرقابة وسلامة التكلفة",
  rules: [
    {
      type: "danger",
      title: "دقة تكلفة الشراء",
      description:
        "سعر الشراء المدخل هو الأساس لحساب متوسط تكلفة الصنف وأرباح المبيعات لاحقاً، احرص على مطابقته التامة مع الفاتورة الضريبية.",
    },
    {
      type: "warning",
      title: "تحديد المستودع بعناية",
      description:
        "لا يمكن تعديل المستودع بعد حفظ الفاتورة؛ تأكد من المستودع الفعلي الذي تم تفريغ البضاعة فيه لتجنب فروقات الجرد.",
    },
    {
      type: "info",
      title: "تحديث المخزون التلقائي",
      description:
        "يقوم النظام بتحديث رصيد الصنف محلياً وعبر السيرفر فوراً دون الحاجة لتحديث الصفحة.",
    },
  ],
  footerTip: "فورتيكس ERP — وحدة التوريد ونقاط المشتريات السريعة",
};

function PurchasePOSPage() {
  const { isModuleEnabled } = useModules();
  const { t, lang, dir } = useI18n();
  const { config: catalogConfig } = useCatalogModules();
  const navigate = useNavigate();
  const { roles } = useAuth();
  // Suppliers are RLS-restricted to owner/manager/accountant; cashiers must not
  // be shown an "add supplier" action they cannot complete.
  const canManageSuppliers =
    roles.includes("owner") || roles.includes("manager") || roles.includes("accountant");

  const [products, setProducts] = useState<Product[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Catalog Filters
  const [categories, setCategories] = useState<MetaOption[]>([]);
  const [brands, setBrands] = useState<MetaOption[]>([]);
  const [units, setUnits] = useState<MetaOption[]>([]);
  const [origins, setOrigins] = useState<MetaOption[]>([]);
  const [qualities, setQualities] = useState<MetaOption[]>([]);
  const [makes, setMakes] = useState<MetaOption[]>([]);
  const [models, setModels] = useState<MetaOption[]>([]);
  const [compatibilities, setCompatibilities] = useState<Compatibility[]>([]);

  const [warehouseId, setWarehouseId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
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
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "mobile_money" | "bank_transfer" | "credit"
  >("cash");
  const [note, setNote] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transferRef, setTransferRef] = useState("");

  // Mobile workspace: cart-first, catalogue opened on demand.
  const isDesktop = useIsDesktop();
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);

  // Modals
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [successInvoice, setSuccessInvoice] = useState<{
    id: string;
    number?: string;
    total: number;
    paid: number;
    supplierName: string;
  } | null>(null);
  const [quoteRequest, setQuoteRequest] = useState<PrintRequest | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const scanHandlerRef = useRef<(code: string) => void>(() => undefined);

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (warehouseId) void loadStock(warehouseId);
  }, [warehouseId]);

  async function loadAll() {
    try {
      const [
        { data: ws },
        { data: sups },
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
        supabase.from("suppliers").select("id,name,phone").order("name"),
        supabase
          .from("products")
          .select(
            "id,sku,barcode,name,name_ar,cost_price,sale_price,tax_rate,image_url,category_id,brand_id,unit_id,origin_id,quality_grade_id,unit:units!products_unit_id_fkey(short_name,name,name_ar),category:categories(name,name_ar),brand:brands!products_brand_id_fkey(name,name_ar),origin:countries_of_origin(name,name_ar,code),quality:quality_grades(name,name_ar,code)",
          )
          .eq("is_active", true)
          .order("name")
          .limit(500),
        supabase.from("categories").select("id,name,name_ar").order("name"),
        supabase.from("brands").select("id,name,name_ar").order("name"),
        supabase.from("units").select("id,name,name_ar,short_name").order("name"),
        (supabase as any).from("countries_of_origin").select("id,name,name_ar,code").order("name"),
        (supabase as any)
          .from("quality_grades")
          .select("id,name,name_ar,code,sort_order")
          .order("sort_order"),
        (supabase as any).from("vehicle_makes").select("id,name,name_ar").order("name"),
        (supabase as any).from("vehicle_models").select("id,name,name_ar,make_id").order("name"),
        (supabase as any).from("product_compatibilities").select("product_id,vehicle_model_id"),
      ]);

      const loadedWarehouses = ws ?? [];
      const loadedSuppliers = sups ?? [];
      setWarehouses(loadedWarehouses);
      setSuppliers(loadedSuppliers);
      setProducts((ps as any) ?? []);
      setCategories(cats ?? []);
      setBrands(brs ?? []);
      setUnits(uns ?? []);
      setOrigins(origs ?? []);
      setQualities(quals ?? []);
      setMakes(vMakes ?? []);
      setModels(vModels ?? []);
      setCompatibilities(compats ?? []);

      // Auto-select warehouse
      if (loadedWarehouses.length > 0) {
        setWarehouseId(loadedWarehouses[0].id);
      }

      // Auto-select "مورد نقدي" or default first supplier.
      // A cash purchase still needs a real supplier_id (create_purchase rejects
      // NULL and posts the payable balance), so we reuse ONE stable cash-supplier
      // record rather than creating a new supplier per transaction.
      if (loadedSuppliers.length > 0) {
        const normalized = (s: string) => s.trim().toLowerCase();
        const cashSup = loadedSuppliers.find((s) => {
          const n = normalized(s.name);
          return (
            n.includes("نقدي") ||
            n.includes("كاش") ||
            n.includes("cash") ||
            n.includes("walk-in") ||
            n.includes("نقد")
          );
        });
        setSupplierId(cashSup ? cashSup.id : loadedSuppliers[0].id);
      }
    } catch (err: any) {
      console.error("Error loading POP meta:", err);
    }
  }

  async function loadStock(whId: string) {
    const { data } = await supabase
      .from("inventory")
      .select("product_id,quantity")
      .eq("warehouse_id", whId);
    const map: Record<string, number> = {};
    (data ?? []).forEach((r) => {
      map[r.product_id] = Number(r.quantity);
    });
    setStockMap(map);
  }

  // Active filters count
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

  const clearAllFilters = () => {
    setSelectedCategory("");
    setSelectedBrand("");
    setSelectedUnit("");
    setSelectedOrigin("");
    setSelectedQuality("");
    setSelectedMake("");
    setSelectedModel("");
    setSearch("");
  };

  // Add to purchase cart
  function addToCart(p: Product) {
    const pName = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || p.name;
    const unitCost = Number(p.cost_price || 0);
    setCart((prev) => {
      const existing = prev.find((l) => l.product_id === p.id);
      if (existing) {
        return prev.map((l) => (l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: pName,
          sku: p.sku,
          unit_cost: unitCost,
          tax_rate: Number(p.tax_rate || 0),
          quantity: 1,
        },
      ];
    });
  }

  function updateCartLine(productId: string, patch: Partial<CartLine>) {
    setCart((prev) =>
      prev.map((line) => {
        if (line.product_id !== productId) return line;
        return { ...line, ...patch };
      }),
    );
  }

  /** Commit a quantity. `null` (empty field mid-edit) leaves the line intact. */
  function setQty(productId: string, qty: number | null) {
    if (qty === null || Number.isNaN(qty)) return;
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.product_id !== productId));
    } else {
      setCart((prev) =>
        prev.map((l) => (l.product_id === productId ? { ...l, quantity: qty } : l)),
      );
    }
  }

  function setCost(productId: string, cost: number) {
    setCart((prev) =>
      prev.map((l) => (l.product_id === productId ? { ...l, unit_cost: Math.max(0, cost) } : l)),
    );
  }

  // Barcode Handler
  const handleBarcode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const found = products.find(
      (p) =>
        (p.barcode && p.barcode.toLowerCase() === trimmed.toLowerCase()) ||
        (p.sku && p.sku.toLowerCase() === trimmed.toLowerCase()),
    );
    if (found) {
      addToCart(found);
      toast.success(
        lang === "ar"
          ? `تمت إضافة: ${found.name_ar || found.name}`
          : `Added: ${found.name || found.name_ar}`,
      );
    } else {
      toast.error(
        lang === "ar" ? "لم يتم العثور على الصنف بالباركود" : "Product barcode not found",
      );
    }
  };

  useEffect(() => {
    scanHandlerRef.current = handleBarcode;
  });

  useKeyboardWedge({
    onScan: (scanned) => {
      scanHandlerRef.current(scanned);
    },
  });

  // Hotkeys: F2 search, F4 submit, Esc clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        void submitPurchase();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart, warehouseId, supplierId, paymentMethod, paid, discount, note]);

  // Financial calculations
  const subtotal = cart.reduce((s, l) => s + l.unit_cost * l.quantity, 0);
  const taxTotal = cart.reduce((s, l) => s + l.unit_cost * l.quantity * (l.tax_rate / 100), 0);
  const discountN = Number(discount || 0);
  const total = Math.max(0, subtotal + taxTotal - discountN);
  const paidN = paymentMethod === "credit" ? 0 : paid !== "" ? Number(paid) : total;
  const isOverpaid = Number.isFinite(paidN) && paidN > total;

  // Filter products
  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (search) {
        const s = search.toLowerCase();
        const matchesName = (p.name || "").toLowerCase().includes(s);
        const matchesNameAr = (p.name_ar || "").toLowerCase().includes(s);
        const matchesSku = (p.sku || "").toLowerCase().includes(s);
        const matchesBarcode = (p.barcode || "").toLowerCase().includes(s);
        if (!matchesName && !matchesNameAr && !matchesSku && !matchesBarcode) return false;
      }
      if (selectedCategory && p.category_id !== selectedCategory) return false;
      if (catalogConfig.enableBrands && selectedBrand && p.brand_id !== selectedBrand) return false;
      if (catalogConfig.enableUnits && selectedUnit && p.unit_id !== selectedUnit) return false;
      if (catalogConfig.enableOrigins && selectedOrigin && p.origin_id !== selectedOrigin)
        return false;
      if (
        catalogConfig.enableQualityGrades &&
        selectedQuality &&
        p.quality_grade_id !== selectedQuality
      )
        return false;
      return true;
    });
  }, [
    products,
    search,
    selectedCategory,
    selectedBrand,
    selectedUnit,
    selectedOrigin,
    selectedQuality,
    catalogConfig,
  ]);

  // Create Supplier — the SAME form used by the Suppliers page.
  function handleSupplierSaved(record: { id: string; name: string; phone?: string | null }) {
    setSuppliers((prev) => [record as Supplier, ...prev]);
    setSupplierId(record.id);
    toast.success(lang === "ar" ? "تمت إضافة المورد بنجاح" : "Supplier added successfully");
  }

  // Submit Purchase Invoice
  async function submitPurchase() {
    if (loading) return;
    if (!warehouseId) {
      return toast.error(
        lang === "ar" ? "يرجى تحديد مستودع الاستلام" : "Please select receiving warehouse",
      );
    }
    if (!supplierId) {
      return toast.error(lang === "ar" ? "يرجى اختيار المورد" : "Please select a supplier");
    }
    if (cart.length === 0) {
      return toast.error(lang === "ar" ? "سلة المشتريات فارغة" : "Purchase cart is empty");
    }
    if (!Number.isFinite(paidN) || paidN < 0 || isOverpaid) {
      return toast.error(
        lang === "ar"
          ? "يجب أن يكون المبلغ المدفوع بين صفر وإجمالي الفاتورة"
          : "Paid amount must be between zero and the invoice total",
      );
    }

    const invalid = cart.find((l) => l.quantity <= 0 || l.unit_cost < 0);
    if (invalid) {
      return toast.error(
        lang === "ar"
          ? "يجب أن تكون الكمية موجبة وتكلفة الوحدة صحيحة"
          : "Invalid quantity or cost price",
      );
    }

    setLoading(true);
    try {
      const currentSup = suppliers.find((s) => s.id === supplierId);

      // Carry an electronic payment reference in the existing note so the RPC
      // contract and offline sync format stay unchanged.
      const composedNote = (() => {
        const parts: string[] = [];
        if (note.trim()) parts.push(note.trim());
        if (
          (paymentMethod === "bank_transfer" || paymentMethod === "mobile_money") &&
          transferRef.trim()
        ) {
          parts.push(
            `${paymentMethod === "mobile_money" ? (lang === "ar" ? "مرجع المحفظة" : "Wallet reference") : lang === "ar" ? "رقم الحوالة" : "Transfer no."}: ${transferRef.trim()}`,
          );
        }
        return parts.length ? parts.join(" — ") : null;
      })();

      const { data: invoiceId, error } = await supabase.rpc("create_purchase", {
        _warehouse_id: warehouseId,
        _supplier_id: supplierId,
        _payment_method: paymentMethod,
        _paid: paidN,
        _discount: discountN,
        _note: composedNote as any,
        _items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
          tax_rate: Number(l.tax_rate),
        })),
      });

      if (error) throw error;

      // Update local stock map with added quantities
      setStockMap((prev) => {
        const next = { ...prev };
        cart.forEach((c) => {
          next[c.product_id] = (next[c.product_id] ?? 0) + Number(c.quantity);
        });
        return next;
      });

      toast.success(
        lang === "ar"
          ? "تم تسجيل فاتورة الشراء وتحديث المخزون بنجاح"
          : "Purchase recorded successfully",
      );

      setSuccessInvoice({
        id: invoiceId || "recorded",
        total,
        paid: paidN,
        supplierName: currentSup?.name || (lang === "ar" ? "مورد نقدي" : "Cash Supplier"),
      });

      // Reset cart and payment
      setCart([]);
      setPaid("");
      setDiscount("");
      setNote("");
      setTransferRef("");
    } catch (e: any) {
      toast.error(
        e.message || (lang === "ar" ? "حدث خطأ أثناء حفظ الفاتورة" : "Failed to record purchase"),
      );
    } finally {
      setLoading(false);
    }
  }

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  function openPurchaseQuotation() {
    if (cart.length === 0) {
      return toast.error(lang === "ar" ? "السلة فارغة" : "Purchase cart is empty");
    }
    setQuoteRequest({
      doc: {
        docType: "quotation",
        title: lang === "ar" ? "عرض أسعار شراء" : "Purchase Price Preview",
        number: lang === "ar" ? "عرض أسعار" : "QUOTE",
        date: purchaseDate,
        partyLabel: lang === "ar" ? "المورد" : "Supplier",
        partyName:
          selectedSupplier?.name ?? (lang === "ar" ? "لم يتم اختيار مورد" : "No supplier selected"),
        status: lang === "ar" ? "معاينة فقط" : "Preview only",
        currency: "",
        subtotal,
        tax: taxTotal,
        discount: discountN,
        total,
        paid: 0,
        balance: total,
        notes:
          lang === "ar"
            ? "هذه معاينة لأسعار الشراء فقط ولا تسجل أي عملية."
            : "Preview only. No purchase is recorded.",
        lines: cart.map((line) => ({
          product: line.name,
          qty: line.quantity,
          price: line.unit_cost,
          total: line.unit_cost * line.quantity * (1 + line.tax_rate / 100),
        })),
      },
      documentType: "quotation",
      rtl: lang === "ar",
    });
  }

  return (
    <div className="grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--primary)_10%,transparent),transparent_48%)] lg:grid-cols-[minmax(0,1fr)_minmax(400px,460px)] lg:grid-rows-[auto_minmax(0,1fr)]">
      {/* Top Bar / Header */}
      <div className="m-1.5 flex shrink-0 flex-col items-stretch gap-2 rounded-2xl border border-border/80 bg-surface/95 px-3 py-2 shadow-sm backdrop-blur-md sm:m-2 sm:px-4 lg:col-start-1 lg:row-start-1">
        <div className="flex items-center gap-3">
          <Link
            to="/purchases"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border/80 bg-surface-2/60 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
            title={lang === "ar" ? "العودة إلى سجل المشتريات" : "Back to purchases list"}
          >
            <ArrowRight className={`h-4 w-4 ${dir === "rtl" ? "" : "rotate-180"}`} />
          </Link>
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-2xl border border-primary/25 bg-primary text-primary-foreground shadow-sm">
              <PackagePlus className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold tracking-tight text-foreground">
                  {lang === "ar" ? "نقطة المشتريات السريعة" : "Point of Purchase (POP)"}
                </h1>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {lang === "ar" ? "مساحة المشتريات" : "Purchase workspace"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {lang === "ar"
                  ? "تسجيل مشتريات وتحديث فوري للمخزون مع إسناد المورد النقدي"
                  : "Rapid purchase receiving & stock increment"}
              </p>
            </div>
          </div>
        </div>

        {/* Global Toolbar Selectors */}
        <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
          {/* Warehouse Selector */}
          <div className="order-2 flex h-9 min-w-0 items-center gap-1.5 rounded-xl border border-border/80 bg-surface px-2.5 text-xs shadow-2xs">
            <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-muted-foreground font-medium hidden sm:inline">
              {lang === "ar" ? "المستودع:" : "Warehouse:"}
            </span>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="bg-transparent font-medium text-foreground outline-none text-xs cursor-pointer"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar}
                </option>
              ))}
            </select>
          </div>

          {/* Supplier Selector with Cash Supplier Default */}
          <div className="order-1 flex h-9 min-w-0 items-center gap-1.5 rounded-xl border border-border/80 bg-surface px-2.5 text-xs shadow-2xs">
            <Truck className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-muted-foreground font-medium hidden sm:inline">
              {lang === "ar" ? "المورد:" : "Supplier:"}
            </span>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-8 w-72 max-w-[48vw] bg-transparent px-1 text-sm font-medium text-foreground outline-none cursor-pointer"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setNewSupplierOpen(true)}
              title={lang === "ar" ? "إضافة مورد جديد" : "Add new supplier"}
              className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition disabled:opacity-40"
              disabled={!canManageSuppliers}
            >
              <UserPlus className="h-3 w-3" />
            </button>
          </div>

          {/* Purchase Date */}
          <div className="order-3 flex h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-surface px-2.5 text-xs shadow-2xs">
            <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="bg-transparent text-xs text-foreground outline-none cursor-pointer font-mono"
            />
          </div>

          {/* Page Guide Button */}
          <PageGuideButton config={purchasePosGuideConfig} className="order-4 !h-9 !w-9" />

          {/* Barcode Camera Modal Trigger */}
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="order-5 grid h-9 w-9 place-items-center rounded-xl border border-border/80 bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-2 transition shadow-2xs"
            title={lang === "ar" ? "مسح الباركود بالكاميرا" : "Scan barcode with camera"}
          >
            <ScanBarcode className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area: Products Grid (Left) + Cart & Totals (Right) */}
      <div className="flex min-h-0 flex-col gap-2 overflow-hidden px-1.5 pb-1.5 sm:px-2 sm:pb-2 lg:contents">
        {/* Left Column: Search, Filters & Product Grid — desktop only. */}
        {isDesktop && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/80 bg-surface/95 shadow-sm ring-1 ring-background/40 lg:col-start-1 lg:row-start-2 lg:mx-2 lg:mb-2">
            {/* Search & Filter Bar */}
            <div className="p-3 border-b border-border/60 bg-surface/50 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleBarcode(search);
                      }
                    }}
                    placeholder={
                      lang === "ar"
                        ? "ابحث باسم المنتج، الكود SKU، أو امسح الباركود (F2)..."
                        : "Search by product name, SKU, or scan barcode (F2)..."
                    }
                    className="h-10 w-full rounded-2xl border border-border/80 bg-surface pe-9 ps-9 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 hover:bg-surface-2 text-muted-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Toggle Filter Panel */}
                <button
                  type="button"
                  onClick={() => setFilterOpen((o) => !o)}
                  className={`relative flex h-10 items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold transition ${
                    filterOpen || activeFiltersCount > 0
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/80 bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{lang === "ar" ? "تصفية" : "Filter"}</span>
                  {activeFiltersCount > 0 && (
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Collapsible Filter Panel */}
              {filterOpen && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-2 border-t border-border/60">
                  {/* Category */}
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                      {lang === "ar" ? "التصنيف" : "Category"}
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="h-8 w-full rounded-xl border border-border/80 bg-surface px-2 text-xs text-foreground outline-none"
                    >
                      <option value="">{lang === "ar" ? "الكل" : "All"}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {lang === "ar" ? c.name_ar || c.name : c.name || c.name_ar}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Brand */}
                  {catalogConfig.enableBrands && (
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                        {lang === "ar" ? "الماركة" : "Brand"}
                      </label>
                      <select
                        value={selectedBrand}
                        onChange={(e) => setSelectedBrand(e.target.value)}
                        className="h-8 w-full rounded-xl border border-border/80 bg-surface px-2 text-xs text-foreground outline-none"
                      >
                        <option value="">{lang === "ar" ? "الكل" : "All"}</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {lang === "ar" ? b.name_ar || b.name : b.name || b.name_ar}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Quality */}
                  {catalogConfig.enableQualityGrades && (
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                        {lang === "ar" ? "درجة الجودة" : "Quality Grade"}
                      </label>
                      <select
                        value={selectedQuality}
                        onChange={(e) => setSelectedQuality(e.target.value)}
                        className="h-8 w-full rounded-xl border border-border/80 bg-surface px-2 text-xs text-foreground outline-none"
                      >
                        <option value="">{lang === "ar" ? "الكل" : "All"}</option>
                        {qualities.map((q) => (
                          <option key={q.id} value={q.id}>
                            {lang === "ar" ? q.name_ar || q.name : q.name || q.name_ar}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Origin */}
                  {catalogConfig.enableOrigins && (
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                        {lang === "ar" ? "بلد المنشأ" : "Origin"}
                      </label>
                      <select
                        value={selectedOrigin}
                        onChange={(e) => setSelectedOrigin(e.target.value)}
                        className="h-8 w-full rounded-xl border border-border/80 bg-surface px-2 text-xs text-foreground outline-none"
                      >
                        <option value="">{lang === "ar" ? "الكل" : "All"}</option>
                        {origins.map((o) => (
                          <option key={o.id} value={o.id}>
                            {lang === "ar" ? o.name_ar || o.name : o.name || o.name_ar}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Products Grid */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 custom-scrollbar">
              {filtered.length === 0 ? (
                <div className="grid place-items-center py-16 text-center text-muted-foreground">
                  <ShoppingBag className="h-10 w-10 opacity-30 mb-2" />
                  <p className="text-sm font-semibold">
                    {lang === "ar"
                      ? "لم يتم العثور على أي منتجات مطابقة"
                      : "No matching products found"}
                  </p>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="mt-2 text-xs text-primary underline"
                  >
                    {lang === "ar" ? "إعادة ضبط الفلاتر" : "Reset filters"}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {filtered.map((p) => {
                    const stock = stockMap[p.id] ?? 0;
                    const catLabel =
                      lang === "ar"
                        ? p.category?.name_ar || p.category?.name
                        : p.category?.name || p.category?.name_ar;
                    const qualityLabel =
                      lang === "ar"
                        ? p.quality?.name_ar || p.quality?.name
                        : p.quality?.name || p.quality?.name_ar;

                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addToCart(p)}
                        className="group flex flex-col justify-between rounded-2xl border border-border/80 bg-surface/90 p-3 text-start transition-all hover:border-primary/60 hover:bg-surface-2 hover:shadow-md active:scale-[0.98]"
                      >
                        <div className="w-full">
                          {/* Quality & Category Badges */}
                          <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                            {qualityLabel && (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary border border-primary/20">
                                {qualityLabel}
                              </span>
                            )}
                            {catLabel && (
                              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted-foreground font-medium border border-border/60 truncate max-w-[100px]">
                                {catLabel}
                              </span>
                            )}
                          </div>

                          {/* Product Title */}
                          <h4 className="text-xs font-bold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                            {lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar}
                          </h4>

                          {/* SKU & Barcode */}
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                            {p.sku && <span>SKU: {p.sku}</span>}
                            {p.barcode && <span>#{p.barcode}</span>}
                          </div>
                        </div>

                        {/* Financials & Stock */}
                        <div className="mt-2.5 pt-2 border-t border-border/60 w-full flex items-center justify-between">
                          <div>
                            <span className="text-[10px] text-muted-foreground block">
                              {lang === "ar" ? "سعر التكلفة:" : "Cost:"}
                            </span>
                            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                              {money(p.cost_price || 0)}
                            </span>
                          </div>

                          {/* Warehouse Stock */}
                          <div className="text-end">
                            <span className="text-[10px] text-muted-foreground block">
                              {lang === "ar" ? "المخزون:" : "Stock:"}
                            </span>
                            <span
                              className={`font-mono text-xs font-semibold ${stock <= 0 ? "text-amber-500" : "text-muted-foreground"}`}
                            >
                              {stock}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Column: Purchase Cart & Invoicing — the primary workspace. */}
        <div className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-3xl border border-primary/15 bg-surface/95 p-2.5 shadow-xl ring-1 ring-border/50 backdrop-blur-md sm:p-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mx-2 lg:mb-2">
          {/* Cart Header */}
          <div className="mb-2 flex shrink-0 items-center justify-between border-b border-border/60 px-1 pb-2">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-primary" />
              <span className="text-xs font-bold text-foreground">
                {lang === "ar" ? "أصناف أمر الشراء" : "Purchase Items"}
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {cart.length}
              </span>
            </div>
            {isDesktop ? (
              cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="flex items-center gap-1 text-[11px] text-destructive hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  {lang === "ar" ? "إفراغ السلة" : "Clear cart"}
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => setMobilePickerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t("pos.add_product")}</span>
              </button>
            )}
          </div>

          {/* Cart Lines Scrollable Area */}
          <div className="my-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            {cart.length === 0 ? (
              <div className="grid place-items-center py-14 text-center text-sm text-muted-foreground">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-border bg-surface-2/50 mb-2">
                  <ShoppingBag className="h-6 w-6 opacity-40 text-muted-foreground" />
                </div>
                <p className="text-xs font-semibold">
                  {lang === "ar" ? "سلة المشتريات فارغة" : "Purchase cart is empty"}
                </p>
                <p className="text-[11px] text-muted-foreground/80 mt-1 max-w-[200px]">
                  {lang === "ar"
                    ? "انقر على أي منتج أو امسح الباركود لإضافته لأمر الشراء"
                    : "Click any item or scan barcode to add to purchase order"}
                </p>
              </div>
            ) : (
              cart.map((line) => (
                <CartLineRow
                  key={line.product_id}
                  line={{
                    id: line.product_id,
                    name: line.name,
                    quantity: line.quantity,
                    unitPrice: line.unit_cost,
                    taxRate: line.tax_rate,
                    stock: stockMap[line.product_id],
                  }}
                  labels={{
                    price: lang === "ar" ? "سعر الشراء" : "Cost",
                    quantity: lang === "ar" ? "الكمية" : "Qty",
                    remove: lang === "ar" ? "حذف" : "Remove",
                  }}
                  formatMoney={money}
                  onQuantityCommit={(next) => setQty(line.product_id, next)}
                  onPriceChange={(next) => setCost(line.product_id, next)}
                  onRemove={() => setCart((c) => c.filter((x) => x.product_id !== line.product_id))}
                />
              ))
            )}

            {/* Payment and totals share this same cart scroll area. */}
            <div className="mt-3 space-y-2 border-t border-border/70 bg-surface/95 pt-2.5 pr-1">
              {/* Payment Method Selector — 4 clear options incl. wallet & transfer. */}
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <label className="relative min-w-0">
                  <span className="sr-only">
                    {lang === "ar" ? "طريقة الدفع" : "Payment method"}
                  </span>
                  <select
                    value={paymentMethod}
                    onChange={(e) => {
                      const method = e.target.value as typeof paymentMethod;
                      setPaymentMethod(method);
                      setPaid(method === "credit" ? "0" : "");
                    }}
                    className="h-10 w-full appearance-none rounded-xl border border-border/80 bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="cash">{lang === "ar" ? "نقدًا" : "Cash"}</option>
                    <option value="mobile_money">{lang === "ar" ? "محفظة" : "Wallet"}</option>
                    <option value="bank_transfer">{lang === "ar" ? "حوالة" : "Transfer"}</option>
                    <option value="credit">{lang === "ar" ? "آجل" : "Credit"}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </label>
                <input
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder={lang === "ar" ? "الخصم" : "Discount"}
                  aria-label={lang === "ar" ? "الخصم" : "Discount"}
                  className="h-10 w-full rounded-xl border border-border/80 bg-surface px-2 text-end font-mono text-xs outline-none focus:border-primary"
                />
              </div>

              {/* Transfer reference — shown only for bank transfers. */}
              {(paymentMethod === "bank_transfer" || paymentMethod === "mobile_money") && (
                <input
                  type="text"
                  value={transferRef}
                  onChange={(e) => setTransferRef(e.target.value)}
                  placeholder={
                    paymentMethod === "mobile_money"
                      ? lang === "ar"
                        ? "رقم عملية المحفظة / المرجع"
                        : "Wallet transaction / reference number"
                      : t("pos.pm.transfer_ref")
                  }
                  aria-label={
                    paymentMethod === "mobile_money"
                      ? lang === "ar"
                        ? "مرجع المحفظة"
                        : "Wallet reference"
                      : t("pos.pm.transfer_ref")
                  }
                  className="h-8 w-full rounded-xl border border-border/80 bg-surface px-2.5 text-xs text-foreground outline-none transition focus:border-primary"
                />
              )}

              {/* Paid Amount */}
              {paymentMethod !== "cash" && (
                <div className="rounded-2xl border border-border/70 bg-surface-2/30 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-semibold text-muted-foreground">
                      {lang === "ar" ? "المبلغ المدفوع" : "Amount paid"}
                    </span>
                    <span className="font-mono font-bold text-primary">{money(total)}</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={paid}
                    onChange={(e) => setPaid(e.target.value)}
                    placeholder={total.toFixed(2)}
                    className={`h-10 w-full rounded-xl border bg-surface px-3 text-end font-mono text-sm font-bold outline-none focus:border-primary ${
                      isOverpaid
                        ? "border-destructive text-destructive focus:border-destructive"
                        : "border-border text-foreground"
                    }`}
                  />
                </div>
              )}

              {isOverpaid && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] font-medium text-destructive">
                  {lang === "ar"
                    ? "المبلغ المدفوع أكبر من إجمالي الفاتورة"
                    : "Paid amount exceeds the invoice total"}
                </p>
              )}

              {/* Note Input */}
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  lang === "ar" ? "ملاحظة على فاتورة الشراء (اختياري)..." : "Note (optional)..."
                }
                className="h-8 w-full rounded-xl border border-border/80 bg-surface px-2.5 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary"
              />

              <div className="space-y-1.5 rounded-2xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{lang === "ar" ? "المجموع الفرعي" : "Subtotal"}</span>
                  <span className="font-mono font-semibold text-foreground">{money(subtotal)}</span>
                </div>

                {discountN > 0 && (
                  <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
                    <span className="font-medium">{lang === "ar" ? "الخصم" : "Discount"}</span>
                    <span className="font-mono font-bold [unicode-bidi:isolate]">
                      −{money(discountN)}
                    </span>
                  </div>
                )}

                {taxTotal > 0 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{lang === "ar" ? "الضريبة" : "Tax"}</span>
                    <span className="font-mono font-semibold text-foreground">
                      {money(taxTotal)}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-primary/20 pt-2">
                  <span className="text-xs font-bold text-foreground">
                    {lang === "ar" ? "الإجمالي" : "Total"}
                  </span>
                  <span className="font-mono text-base font-extrabold tracking-tight text-primary">
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {money(total)}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions stay outside the only scroll region. */}
          <div className="mt-2 flex shrink-0 gap-2 border-t border-border/70 bg-surface/95 pb-1 pt-2">
            <button
              type="button"
              onClick={openPurchaseQuotation}
              disabled={cart.length === 0}
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-transparent bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">
                {lang === "ar" ? "عرض الأسعار" : "Price preview"}
              </span>
            </button>
            <button
              type="button"
              onClick={submitPurchase}
              disabled={loading || cart.length === 0 || isOverpaid}
              className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary/90 px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:shadow-primary/35 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{lang === "ar" ? "جاري تسجيل الشراء..." : "Recording purchase..."}</span>
                </>
              ) : (
                <span>{lang === "ar" ? "تسجيل فاتورة الشراء" : "Save Purchase Order"}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* New Supplier — the SAME form used by the Suppliers page. */}
      <SupplierFormDialog
        open={newSupplierOpen}
        onClose={() => setNewSupplierOpen(false)}
        onSaved={(record) => handleSupplierSaved(record)}
      />

      {/* Success Modal */}
      {successInvoice && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
          <div className="panel-elevated w-full max-w-sm rounded-2xl p-6 border border-border/80 bg-surface text-center space-y-4 shadow-2xl">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <div>
              <h3 className="text-base font-bold text-foreground">
                {lang === "ar"
                  ? "تم تسجيل فاتورة الشراء بنجاح!"
                  : "Purchase Recorded Successfully!"}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {lang === "ar"
                  ? `المورد: ${successInvoice.supplierName}`
                  : `Supplier: ${successInvoice.supplierName}`}
              </p>
            </div>

            <div className="rounded-xl border border-border/70 bg-surface-2/40 p-3 space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{lang === "ar" ? "إجمالي الفاتورة:" : "Total:"}</span>
                <span className="font-mono font-bold text-foreground">
                  {money(successInvoice.total)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{lang === "ar" ? "المسدد نقداً:" : "Paid:"}</span>
                <span className="font-mono font-bold text-emerald-500">
                  {money(successInvoice.paid)}
                </span>
              </div>
              {successInvoice.total > successInvoice.paid && (
                <div className="flex justify-between text-amber-500 font-semibold pt-1 border-t border-border/60">
                  <span>{lang === "ar" ? "المتبقي (آجل):" : "Balance Due:"}</span>
                  <span className="font-mono">
                    {money(successInvoice.total - successInvoice.paid)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSuccessInvoice(null)}
                className="h-10 w-full rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition shadow-sm"
              >
                {lang === "ar" ? "فاتورة شراء جديدة" : "New Purchase"}
              </button>
              <Link
                to="/purchases"
                className="h-9 w-full grid place-items-center rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-surface-2 transition"
              >
                {lang === "ar" ? "عرض في سجل المشتريات" : "View in Purchases Register"}
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Camera Scanner */}
      {scannerOpen && (
        <BarcodeScanner
          open={scannerOpen}
          onDetected={(code) => {
            setScannerOpen(false);
            handleBarcode(code);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Mobile product picker — reuses the SAME search state and filtering. */}
      <MobileProductPicker
        open={mobilePickerOpen && !isDesktop}
        onClose={() => setMobilePickerOpen(false)}
        search={search}
        onSearchChange={setSearch}
        title={t("pos.add_product_title")}
        searchPlaceholder={t("pos.search_product")}
        emptyLabel={lang === "ar" ? "لا توجد منتجات مطابقة" : "No matching products"}
        inputRef={searchRef}
        products={filtered.slice(0, 200).map((p) => ({
          id: p.id,
          name: (lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar) || "—",
          meta: p.sku || p.barcode || null,
          value: money(Number(p.cost_price || 0)),
          sub: `${t("pos.stock")}: ${stockMap[p.id] ?? 0}`,
        }))}
        onSelect={(id) => {
          const product = products.find((p) => p.id === id);
          if (product) addToCart(product);
          setMobilePickerOpen(false);
        }}
      />
      {quoteRequest ? (
        <UniversalPrintPreview
          open
          onOpenChange={(open) => {
            if (!open) setQuoteRequest(null);
          }}
          request={quoteRequest}
          title={lang === "ar" ? "معاينة عرض أسعار الشراء" : "Purchase price preview"}
          rtl={lang === "ar"}
        />
      ) : null}
    </div>
  );
}
