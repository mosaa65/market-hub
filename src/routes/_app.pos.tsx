import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Search,
  Plus,
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
  Clock,
  Printer,
  Receipt,
  FileText,
  SkipForward,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  posOfflineService,
  productsRepo,
  warehousesRepo,
  customersRepo,
  categoriesRepo,
  brandsRepo,
  unitsRepo,
} from "@/lib/offline";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { type PageGuideConfig, PageGuideButton } from "@/components/page-guide";
import {
  ShoppingCart,
  Zap,
  ShieldCheck,
  Barcode,
  Scale,
  ArrowRightLeft,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { useKeyboardWedge } from "@/hooks/use-keyboard-wedge";
import { useCatalogModules } from "@/lib/catalog-modules";
import { useIsDesktop } from "@/hooks/use-media-query";
import { CartLine as CartLineRow } from "@/components/commerce/cart-line";
import { MobileProductPicker } from "@/components/commerce/mobile-product-picker";
import { CustomerFormDialog } from "@/components/contacts/customer-form-dialog";
import { UniversalPrintPreview } from "@/components/universal-print-preview";
import { printUnifiedDocument, type PrintRequest } from "@/lib/printing";
import { printInvoice, type InvoiceTemplate } from "@/lib/invoice-print";
import type { InvoiceDoc } from "@/lib/pdf";
import { OperationSuccessModal } from "@/components/communication";
import type { CustomerContext, InvoiceContext } from "@/lib/communication";

export const Route = createFileRoute("/_app/pos")({
  head: () => ({ meta: [{ title: "نقطة البيع — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="pos">
      <POSPage />
    </ModuleGuard>
  ),
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
  /** تُستعلم في addToCart لتحديد مسار الخدمة؛ بدونها لا يمكن بيع أجرة الطحن. */
  is_service?: boolean | null;
  item_nature?: string | null;
  inventory_policy?: string | null;
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
  /** Default catalogue sale price, kept so we can flag an overridden price. */
  base_price?: number;
  tax_rate: number;
  quantity: number;
  is_service?: boolean;
  item_nature?: string;
  inventory_policy?: string;
}

interface Warehouse {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number;
  credit_limit?: number;
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

const posGuideConfig: PageGuideConfig = {
  title: "دليل نقطة البيع والكاشير المتقدم (POS)",
  subtitle:
    "شرح شامل لدورة البيع السريع، الأثر المخزني والمالي، معالجة الدفع، واختصارات لوحة المفاتيح.",
  badge: "كاشير ونقاط البيع السريعة",
  icon: <ShoppingCart className="h-5 w-5 text-sky-500" />,
  summaryText:
    "صُممت نقطة البيع لتقديم تجربة كاشير فائقة السرعة مع تحديث فوري للمخزون والحسابات المالية لحظة بلحظة وبدون الحاجة لإعادة تحميل الصفحة.",
  overviewCards: [
    {
      title: "مسح باركود فوري وبحث مرن",
      description:
        "دعم كامل لقوارئ الباركود السلكية واللاسلكية وكاميرا الجوال مع البحث الذكي بالاسم أو الكود (اختصار F2).",
      icon: <Barcode className="h-4 w-4" />,
    },
    {
      title: "تعدد وتنوع طرق السداد",
      description:
        "سداد نقدي، عبر نقاط البيع (شبكة/مدى/فيزا)، تحويلات بنكية، أو مبيعات آجلة مع التحقق من سقف العميل.",
      icon: <CreditCard className="h-4 w-4" />,
    },
    {
      title: "الخصم الفوري والتحكم المالي",
      description:
        "خصم تلقائي لكميات المنتجات من مستودع نقطة البيع المختار فور تأكيد العملية لمنع العجز والبيع الزائد.",
      icon: <Scale className="h-4 w-4" />,
    },
    {
      title: "طباعة وحفظ فوري",
      description:
        "إتمام الفاتورة وطباعة الإيصال الحراري بضغطة زر واحدة أو باختصار لوحة المفاتيح (F4).",
      icon: <Zap className="h-4 w-4" />,
    },
  ],
  matrixTitle: "مصفوفة الأثر المالي والمخزني لعمليات الكاشير",
  matrixDescription:
    "جدول تفصيلي يوضح كيفية تأثير كل طريقة دفع وحركة في نقطة البيع على القيود المحاسبية ورصيد المخزون:",
  impactMatrix: {
    columns: [
      { key: "paymentType", label: "طريقة العملية", className: "w-[20%]" },
      { key: "inventoryImpact", label: "التأثير المخزني", className: "w-[25%]" },
      { key: "accountingImpact", label: "القيد المحاسبي والأثر المالي", className: "w-[30%]" },
      { key: "controls", label: "شروط وضوابط العملية", className: "w-[25%]" },
    ],
    rows: [
      {
        badge: { label: "سداد نقدي (Cash)", variant: "emerald" },
        fields: {
          paymentType: "فاتورة كاش فورية",
          inventoryImpact: "خصم الكميات من مستودع الفرع فوراً وتحديث الرصيد الفعلي.",
          accountingImpact:
            "من حـ/ الصندوق (مدين) إلى حـ/ المبيعات (دائن) + إثبات تكلفة البضاعة المباعة.",
          controls: "تسجيل المبلغ المستلم وحساب الفكة/المتبقي للعميل آلياً.",
        },
      },
      {
        badge: { label: "دفع إلكتروني (Card/Network)", variant: "blue" },
        fields: {
          paymentType: "شبكة / مدى / بطاقة",
          inventoryImpact: "خصم الكميات فوراً من مستودع الفرع.",
          accountingImpact: "من حـ/ البنك أو وسيط الدفع (مدين) إلى حـ/ المبيعات (دائن).",
          controls: "مطابقة إشعار جهاز الدفع الإلكتروني قبل اعتماد الفاتورة.",
        },
      },
      {
        badge: { label: "مبيعات آجلة (Credit)", variant: "purple" },
        fields: {
          paymentType: "على الحساب (ذمم عملاء)",
          inventoryImpact: "خصم الكميات فوراً من مستودع الفرع.",
          accountingImpact:
            "من حـ/ العميل (مدين) إلى حـ/ المبيعات (دائن) بزيادة رصيد مديونية العميل.",
          controls: "اشتراط اختيار عميل حقيقي غير نقدي والتحقق من عدم تجاوز الحد الائتماني.",
        },
      },
      {
        badge: { label: "تحويل بنكي (Transfer)", variant: "amber" },
        fields: {
          paymentType: "حوالة / إيداع بنكي",
          inventoryImpact: "خصم الكميات فوراً من المستودع.",
          accountingImpact: "من حـ/ الحساب الجاري بالبنك (مدين) إلى حـ/ المبيعات (دائن).",
          controls: "إدخال رقم الحوالة أو المرجع في حقل الملاحظات لسهولة المطابقة البنكية.",
        },
      },
    ],
  },
  stepsTitle: "خطوات إتمام عملية بيع نموذجية في الكاشير",
  steps: [
    {
      number: "1",
      title: "تجهيز السلة والأصناف",
      description:
        "امسح الباركود بالقارئ السريع أو ابحث بالاسم بالضغط على (F2) وانقر لإضافة المنتج للسلة.",
    },
    {
      number: "2",
      title: "تعديل الكميات والخصومات",
      description: "عدل كمية كل صنف، وطبق الخصم الإجمالي إن وجد وفق الصلاحيات المخولة لك.",
    },
    {
      number: "3",
      title: "تحديد العميل وطريقة الدفع",
      description:
        "اترك العميل الافتراضي للمبيعات النقدية، أو اختر العميل المسجل للمبيعات الآجلة، وحدد طريقة السداد.",
    },
    {
      number: "4",
      title: "الحفظ والطباعة (F4)",
      description: "اضغط زر حفظ الفاتورة أو F4 لإصدار الفاتورة فوراً وطباعة إيصال الكاشير الحراري.",
    },
  ],
  rulesTitle: "إرشادات السلامة والرقابة التشغيلية",
  rules: [
    {
      type: "danger",
      title: "التحقق من الرصيد لمنع المخزون السالب",
      description:
        "النظام يمنع استكمال البيع إذا كانت الكمية المطلوبة غير متوفرة في المستودع المختار إلا إذا كان البيع على المكشوف مصرحاً به.",
    },
    {
      type: "warning",
      title: "تدقيق أسعار البيع والخصم",
      description:
        "لا يُسمح بتعديل سعر البيع إلى أقل من سعر التكلفة إلا بموافقة إدارية لحماية هوامش الربحية.",
    },
    {
      type: "info",
      title: "حفظ فوري دون فقدان الجلسة",
      description:
        "جميع بنود السلة محمية محلياً في الذاكرة السريعة لمنع ضياع الفاتورة في حال انقطاع الاتصال المؤقت.",
    },
  ],
  footerTip: "فورتيكس ERP — نظام الكاشير ونقاط البيع السريعة المعتمد",
};

function POSPage() {
  const { isModuleEnabled } = useModules();
  const { t, lang } = useI18n();
  const { config: catalogConfig } = useCatalogModules();
  const navigate = useNavigate();
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
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "card" | "mobile_money" | "bank_transfer" | "credit"
  >("cash");
  const [note, setNote] = useState("");
  /** Transfer reference — appended to the note on submit; no DB column needed. */
  const [transferRef, setTransferRef] = useState("");
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Mobile workspace: catalogue is never mounted behind the cart on phones.
  const isDesktop = useIsDesktop();
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);

  // Quotation preview (read-only, never persists).
  const [quoteRequest, setQuoteRequest] = useState<PrintRequest | null>(null);

  // Settings & Split Payment
  const [enableServiceFeeSetting, setEnableServiceFeeSetting] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pos_enable_service_fee");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  // Print Settings (persisted in localStorage)
  const [printMode, setPrintMode] = useState<"auto" | "ask" | "off">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pos_print_mode");
      if (saved === "auto" || saved === "ask" || saved === "off") return saved;
    }
    return "ask";
  });
  const [defaultTemplate, setDefaultTemplate] = useState<InvoiceTemplate>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pos_default_template");
      if (saved === "thermal" || saved === "standard" || saved === "elegant") return saved;
    }
    return "thermal";
  });

  // Post-sale dialog state
  const [postSaleDoc, setPostSaleDoc] = useState<InvoiceDoc | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplate>(defaultTemplate);

  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState("");

  const [newCustomerOpen, setNewCustomerOpen] = useState(false);

  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [serviceNote, setServiceNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<{ id: string; number: string } | null>(null);
  const [saleSuccess, setSaleSuccess] = useState<{
    id: string;
    number: string;
    total: number;
    paid: number;
    remaining: number;
    currency: string;
    customer: CustomerContext | null;
    invoice: InvoiceContext;
  } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Company settings for invoice generation
  const [companySettings, setCompanySettings] = useState<any>(null);

  const productCompatMap = useMemo(() => {
    const modelLookup = new Map(models.map((m) => [m.id, m]));
    const makeLookup = new Map(makes.map((mk) => [mk.id, mk]));
    const map = new Map<string, { makeName: string; modelName: string }[]>();

    for (const c of compatibilities) {
      const m = modelLookup.get(c.vehicle_model_id);
      if (!m) continue;
      const mk = m.make_id ? makeLookup.get(m.make_id) : null;
      const makeName =
        lang === "ar" ? mk?.name_ar || mk?.name || "" : mk?.name || mk?.name_ar || "";
      const modelName = lang === "ar" ? m.name_ar || m.name : m.name || m.name_ar || "";
      const arr = map.get(c.product_id) || [];
      arr.push({ makeName, modelName });
      map.set(c.product_id, arr);
    }
    return map;
  }, [compatibilities, models, makes, lang]);

  const searchRef = useRef<HTMLInputElement>(null);
  const scanHandlerRef = useRef<(code: string) => void>(() => undefined);

  useEffect(() => {
    void loadAll();
    // Load company settings for invoice generation
    supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCompanySettings(data);
      });
  }, []);

  useEffect(() => {
    if (warehouseId) void loadStock(warehouseId);
  }, [warehouseId]);

  // Granular Realtime sync: updates specific state without triggering full-page reload or re-fetching 11 tables
  useEffect(() => {
    const channel = supabase.channel("pos-live-meta-optimized");

    // Granular updates for products without re-running loadAll
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "products" },
      (payload) => {
        if (payload.eventType === "UPDATE") {
          const updated = payload.new as any;
          setProducts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
        } else if (payload.eventType === "INSERT") {
          const inserted = payload.new as any;
          setProducts((prev) => [inserted, ...prev]);
        } else if (payload.eventType === "DELETE") {
          const deleted = payload.old as any;
          setProducts((prev) => prev.filter((p) => p.id !== deleted.id));
        }
      },
    );

    // Granular updates for customers
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "customers" },
      (payload) => {
        if (payload.eventType === "UPDATE") {
          const updated = payload.new as any;
          setCustomers((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
        } else if (payload.eventType === "INSERT") {
          setCustomers((prev) => [payload.new as any, ...prev]);
        } else if (payload.eventType === "DELETE") {
          setCustomers((prev) => prev.filter((c) => c.id !== (payload.old as any).id));
        }
      },
    );

    // Granular updates for warehouses
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "warehouses" },
      (payload) => {
        if (payload.eventType === "UPDATE") {
          const updated = payload.new as any;
          setWarehouses((prev) =>
            prev.map((w) => (w.id === updated.id ? { ...w, ...updated } : w)),
          );
        } else if (payload.eventType === "INSERT") {
          setWarehouses((prev) => [...prev, payload.new as any]);
        }
      },
    );

    // Granular updates for stock levels (inventory)
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "inventory_balances" },
      (payload) => {
        const row = (payload.new || payload.old) as any;
        if (row && row.product_id && (!warehouseId || row.warehouse_id === warehouseId)) {
          setStockMap((prev) => ({
            ...prev,
            [row.product_id]: Number(row.balance ?? row.available_quantity ?? 0),
          }));
        }
      },
    );

    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [warehouseId]);

  async function loadAll() {
    try {
      const [
        wsRes,
        csRes,
        psRes,
        catsRes,
        brsRes,
        unsRes,
        origsRes,
        qualsRes,
        vMakesRes,
        vModelsRes,
        compatsRes,
      ] = await Promise.allSettled([
        supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
        supabase.from("customers").select("id,name,phone,balance,credit_limit").order("name"),
        (supabase.from("products") as any)
          .select(
            "id,sku,barcode,name,name_ar,sale_price,tax_rate,image_url,category_id,brand_id,unit_id,origin_id,quality_grade_id,is_active,is_service,item_nature,inventory_policy",
          )
          // نقاط البيع تبيع المنتجات النهائية فقط (المواصفة §20): الخام
          // والتعبئة والخدمات لا تُعرض هنا — الخدمة لها مسارها المستقل
          // (تذكرة الطحن)، والخام/التعبئة مخزون داخلي لا سلعة بيع.
          .eq("is_active", true)
          .eq("is_sellable", true)
          .neq("item_class", "RAW_MATERIAL")
          .neq("item_class", "PACKAGING")
          .neq("item_class", "SERVICE")
          .order("name")
          .limit(1000),
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

      let ws = wsRes.status === "fulfilled" ? wsRes.value.data : null;
      let cs = csRes.status === "fulfilled" ? csRes.value.data : null;
      let ps = psRes.status === "fulfilled" ? psRes.value.data : null;
      let cats = catsRes.status === "fulfilled" ? catsRes.value.data : null;
      let brs = brsRes.status === "fulfilled" ? brsRes.value.data : null;
      let uns = unsRes.status === "fulfilled" ? unsRes.value.data : null;
      const origs = origsRes.status === "fulfilled" ? origsRes.value.data : [];
      const quals = qualsRes.status === "fulfilled" ? qualsRes.value.data : [];
      const vMakes = vMakesRes.status === "fulfilled" ? vMakesRes.value.data : [];
      const vModels = vModelsRes.status === "fulfilled" ? vModelsRes.value.data : [];
      const compats = compatsRes.status === "fulfilled" ? compatsRes.value.data : [];

      // Offline fallbacks from local repositories
      if (!ws || ws.length === 0) ws = (await warehousesRepo.getAll()) as any;
      if (!cs || cs.length === 0) cs = (await customersRepo.getAll()) as any;
      if (!ps || ps.length === 0) ps = (await productsRepo.getAll()) as any;
      if (!cats || cats.length === 0) cats = (await categoriesRepo.getAll()) as any;
      if (!brs || brs.length === 0) brs = (await brandsRepo.getAll()) as any;
      if (!uns || uns.length === 0) uns = (await unitsRepo.getAll()) as any;

      // بيانات المستودعات/العملاء مرجعية كذلك: تخزين محلي دون outbox
      // (نفس سبب 409 المذكور أدناه).
      if (ws && ws.length > 0)
        await Promise.all(
          ws.map((w) =>
            (warehousesRepo as any).adapter.setItem("warehouses", w.id, w).catch(() => {}),
          ),
        );
      if (cs && cs.length > 0) cs.forEach((c) => customersRepo.create(c as any).catch(() => {}));
      // المنتجات/التصنيفات/العلامات/الوحدات بيانات مرجعية للعمل دون اتصال:
      // تُخزَّن محليًا فقط. كتابتها في outbox المزامنة كانت ترفع 409
      // (تعارض) على كل تحميل لأنها موجودة أصلًا في السحابة — والسحابة مصدر
      // الحقيقة لهذه الجداول كلها.
      if (ps && ps.length > 0)
        await Promise.all(
          ps.map((p: any) =>
            (productsRepo as any).adapter.setItem("products", p.id, p).catch(() => {}),
          ),
        );
      if (cats && cats.length > 0)
        await Promise.all(
          cats.map((c) =>
            (categoriesRepo as any).adapter.setItem("categories", c.id, c).catch(() => {}),
          ),
        );
      // بيانات العلامات والوحدات مرجعية للعمل دون اتصال: تُخزَّن محليًا فقط.
      // كتابتها في outbox المزامنة كانت ترفع 409 (تعارض) على كل تحميل لأنها
      // موجودة أصلاً في السحابة — والسحابة مصدر الحقيقة لهما.
      if (brs && brs.length > 0)
        await Promise.all(
          brs.map((b) => (brandsRepo as any).adapter.setItem("brands", b.id, b).catch(() => {})),
        );
      if (uns && uns.length > 0)
        await Promise.all(
          uns.map((u) => (unitsRepo as any).adapter.setItem("units", u.id, u).catch(() => {})),
        );

      const loadedWarehouses = ws ?? [];
      setWarehouses(loadedWarehouses);
      setCustomers(cs ?? []);

      // Build safe in-memory lookup maps to enrich products without brittle DB joins
      const catMap = new Map((cats ?? []).map((c: any) => [c.id, c]));
      const brandMap = new Map((brs ?? []).map((b: any) => [b.id, b]));
      const unitMap = new Map((uns ?? []).map((u: any) => [u.id, u]));
      const origMap = new Map((origs ?? []).map((o: any) => [o.id, o]));
      const qualMap = new Map((quals ?? []).map((q: any) => [q.id, q]));

      let rawProducts = (ps as any) ?? [];
      // Fallback query if the first returned empty due to column discrepancy
      if (!rawProducts.length) {
        try {
          const { data: fallbackPs } = await (supabase.from("products") as any)
            .select(
              "id,sku,barcode,name,name_ar,sale_price,tax_rate,image_url,category_id,brand_id,unit_id",
            )
            .limit(1000);
          if (fallbackPs && fallbackPs.length) rawProducts = fallbackPs;
        } catch (e) {
          console.warn("Fallback products query error:", e);
        }
      }

      const enrichedProducts = rawProducts.map((p: any) => ({
        ...p,
        category: p.category_id ? catMap.get(p.category_id) || null : null,
        brand: p.brand_id ? brandMap.get(p.brand_id) || null : null,
        unit: p.unit_id ? unitMap.get(p.unit_id) || null : null,
        origin: p.origin_id ? origMap.get(p.origin_id) || null : null,
        quality: p.quality_grade_id ? qualMap.get(p.quality_grade_id) || null : null,
      }));

      setProducts(enrichedProducts);
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
        setWarehouseId((current) =>
          loadedWarehouses.some((w) => w.id === current) ? current : loadedWarehouses[0].id,
        );
      }

      // Fetch company settings to sync enable_pos_service_fee
      void supabase
        .from("company_settings")
        .select("*")
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data && (data as any).enable_pos_service_fee !== undefined) {
            setEnableServiceFeeSetting(Boolean((data as any).enable_pos_service_fee));
          }
        });
    } catch (err: any) {
      console.error("Error loading POS meta:", err);
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
      ? new Set(
          compatibilities
            .filter((c) => c.vehicle_model_id === selectedModel)
            .map((c) => c.product_id),
        )
      : null;

    // Make compatibility set
    const makeModelIds = selectedMake
      ? new Set(models.filter((m) => m.make_id === selectedMake).map((m) => m.id))
      : null;
    const compatibleWithMake = makeModelIds
      ? new Set(
          compatibilities
            .filter((c) => makeModelIds.has(c.vehicle_model_id))
            .map((c) => c.product_id),
        )
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
      const matchesBrand =
        !catalogConfig.enableBrands || !selectedBrand || p.brand_id === selectedBrand;
      const matchesUnit = !catalogConfig.enableUnits || !selectedUnit || p.unit_id === selectedUnit;
      const matchesOrigin =
        !catalogConfig.enableOrigins || !selectedOrigin || p.origin_id === selectedOrigin;
      const matchesQuality =
        !catalogConfig.enableQualityGrades ||
        !selectedQuality ||
        p.quality_grade_id === selectedQuality;
      const matchesMake =
        !catalogConfig.enableMakesAndModels || !compatibleWithMake || compatibleWithMake.has(p.id);
      const matchesModel =
        !catalogConfig.enableMakesAndModels ||
        !compatibleWithModel ||
        compatibleWithModel.has(p.id);

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
    const prodName = lang === "ar" && p.name_ar ? p.name_ar : p.name;
    // الخدمات (SERVICE) لا مخزون لها إطلاقاً — item_nature = SERVICE يعني
    // inventory_policy = UNTRACKED. فحص "نفد المخزون" كان يرفضها لأن
    // stockMap لا يحملها، فيستحيل بيع أجرة الطحن من نقطة البيع.
    const isService = p.is_service === true;

    if (!isService) {
      const stock = stockMap[p.id] ?? 0;
      if (stock <= 0) {
        return toast.error(
          lang === "ar" ? `نفد المخزون من: ${prodName}` : `${p.name} ${t("pos.out_of_stock")}`,
        );
      }
      setCart((c) => {
        const existing = c.find((l) => l.product_id === p.id);
        if (existing) {
          if (existing.quantity >= stock) {
            toast.error(
              lang === "ar"
                ? `الحد الأقصى المتاح في المخزون: ${stock}`
                : `${t("pos.max_stock")}: ${stock}`,
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
            base_price: Number(p.sale_price),
            tax_rate: Number(p.tax_rate ?? 0),
            quantity: 1,
            is_service: false,
          },
        ];
      });
      return;
    }

    // مسار الخدمة: بلا فحص مخزون، والحمولة تحمل is_service = true.
    setCart((c) => {
      const existing = c.find((l) => l.product_id === p.id);
      if (existing) {
        return c.map((l) => (l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...c,
        {
          product_id: p.id,
          name: prodName,
          unit_price: Number(p.sale_price),
          base_price: Number(p.sale_price),
          tax_rate: Number(p.tax_rate ?? 0),
          quantity: 1,
          is_service: true,
        },
      ];
    });
  }

  /**
   * setQty — commit a quantity for a cart line.
   *
   * `null` means the operator emptied the field mid-edit: we deliberately do
   * NOT remove the line then (that surprised cashiers). Removal happens only on
   * an explicit `0`, and every business rule below is the original one:
   * services are uncapped, physical items are capped by stock, and a quantity
   * below the minimum removes the line.
   */
  function setQty(pid: string, qty: number | null) {
    const line = cart.find((l) => l.product_id === pid);
    if (!line) return;

    // Empty commit: leave the line untouched, the stepper restores the number.
    if (qty === null || Number.isNaN(qty)) return;

    if (qty < 1) {
      setCart((c) => c.filter((l) => l.product_id !== pid));
      return;
    }

    if (!line.is_service) {
      const stock = stockMap[pid] ?? 0;
      if (qty > stock) {
        toast.error(
          lang === "ar"
            ? `الحد الأقصى المتاح في المخزون: ${stock}`
            : `${t("pos.max_stock")}: ${stock}`,
        );
        return;
      }
    }

    setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, quantity: qty } : l)));
  }

  /**
   * setPrice — override the per-transaction price for a single cart line.
   *
   * This NEVER writes back to `products.sale_price`; it only changes
   * `CartLine.unit_price`, which is what `create_sale` already receives. The
   * product's permanent price is therefore untouched.
   */
  function setPrice(pid: string, price: number) {
    setCart((c) =>
      c.map((l) => (l.product_id === pid ? { ...l, unit_price: Math.max(0, price) } : l)),
    );
  }

  function addService() {
    const price = Number(servicePrice);
    if (!serviceName.trim() || !Number.isFinite(price) || price < 0) {
      return toast.error(
        lang === "ar"
          ? "يرجى إدخال اسم الخدمة وسعرها المتفق عليه"
          : "Enter a service name and price",
      );
    }
    const id = `service-${crypto.randomUUID()}`;
    setCart((c) => [
      ...c,
      {
        product_id: id,
        name: serviceNote.trim()
          ? `${serviceName.trim()} — ${serviceNote.trim()}`
          : serviceName.trim(),
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

  function handleCode(code: string): boolean {
    const q = code.trim();
    if (!q) return false;
    const exact = products.find((p) => p.barcode === q || p.sku === q);
    if (exact) {
      addToCart(exact);
      confirmScan();
      setSearch("");
      return true;
    }
    const partial = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        (p.name_ar ?? "").includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q.toLowerCase()) ||
        (p.barcode ?? "").toLowerCase().includes(q.toLowerCase()),
    );
    if (partial.length === 1) {
      addToCart(partial[0]);
      confirmScan();
      setSearch("");
      return true;
    }
    // No matching product: keep the raw scanned code and offer a clear next step.
    // Nothing is created automatically; the user chooses to open the product form.
    const isAr = lang === "ar";
    toast.error(isAr ? `لا يوجد منتج مطابق للباركود: ${q}` : `No product for barcode: ${q}`, {
      duration: 8000,
      action: {
        label: isAr ? "إنشاء منتج بهذا الباركود" : "Create product with this barcode",
        onClick: () => navigate({ to: "/products", search: { barcode: q } as any }),
      },
    });
    return false;
  }

  // Wedge scans go through handleCode, then report a brief "received" feedback.
  function handleWedgeCode(code: string) {
    const matched = handleCode(code);
    if (matched) {
      navigator.vibrate?.(35);
      toast.success(lang === "ar" ? "تم استقبال الباركود" : "Barcode received", {
        duration: 1500,
      });
    }
  }

  function confirmScan() {
    navigator.vibrate?.(35);
  }

  scanHandlerRef.current = handleCode;

  // Global USB/Bluetooth keyboard-wedge support: a scanner connected to a
  // desktop/laptop can type a barcode even when no field is focused. It is
  // routed through the same `handleCode` used by the search field and camera,
  // and is disabled while the camera dialog is open to avoid double reads.
  useKeyboardWedge({ onScan: handleWedgeCode, disabled: scannerOpen });

  function formatWithCommas(val: number | string): string {
    const n = typeof val === "number" ? val : Number(val);
    if (!Number.isFinite(n)) return "0";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  }

  // Financial Computations with strict 2-decimal precision
  const subtotal = Math.round(cart.reduce((s, l) => s + l.unit_price * l.quantity, 0) * 100) / 100;
  const taxTotal =
    Math.round(cart.reduce((s, l) => s + l.unit_price * l.quantity * (l.tax_rate / 100), 0) * 100) /
    100;
  const discountN = Math.round(Number(discount || 0) * 100) / 100;
  const total = Math.max(0, Math.round((subtotal + taxTotal - discountN) * 100) / 100);

  // Split payment amounts
  const splitCashN = Math.max(0, Number(splitCash || 0));
  const splitCardN = Math.max(0, Number(splitCard || 0));
  const splitPaidTotal = Math.round((splitCashN + splitCardN) * 100) / 100;
  // عدد وسائل الدفع غير الصفرية في الدفع المجزأ:
  //  0 -> لم يدفع شيء،  1 -> وسيلة واحدة (تُسجل بوسيلتها الحقيقية)،  2+ -> دفع مجزأ حقيقي
  const splitMethodCount = (splitCashN > 0 ? 1 : 0) + (splitCardN > 0 ? 1 : 0);
  const isMultiMethodSplit = isSplitPayment && splitMethodCount > 1;

  // Auto-Paid & Smart Payment Logic
  // إذا كانت وسيلة الدفع "آجل" وترك حقل المدفوع فارغاً، فالافتراضي هو 0 (دين بالكامل)
  // أما في الوسائل الأخرى (نقدي/بطاقة/تحويل/محفظة)، فالفارغ يعني سداد كامل المبلغ تلقائياً
  const isPaidEmpty = paid.trim() === "";
  const singlePaidNum = isPaidEmpty
    ? paymentMethod === "credit"
      ? 0
      : total
    : Math.max(0, Number(paid));
  const effectivePaid = isSplitPayment ? splitPaidTotal : singlePaidNum;
  const isOverpaid = isSplitPayment ? splitPaidTotal > total : !isPaidEmpty && Number(paid) > total;
  const remainingDebt = Math.max(0, Math.round((total - effectivePaid) * 100) / 100);

  // وسيلة الدفع يختارها الكاشير وتتبدل ذكياً حسب المبلغ:
  function syncMethodWithPaid(num: number) {
    setPaymentMethod((current) => {
      if (current === "cash" && num < total) return "credit";
      if (current === "credit" && num >= total && total > 0) return "cash";
      return current;
    });
  }

  // Handle smart payment method switching on paid input change
  function handlePaidChange(val: string) {
    setPaid(val);
    if (val.trim() === "") {
      // ترك الحقل فارغاً لا يغير وسيلة الدفع قسراً إذا كان الكاشير قد اختار "آجل"
      return;
    }
    const num = Number(val);
    if (!Number.isNaN(num)) syncMethodWithPaid(num);
  }

  // When total changes and user has entered an explicit amount in paid:
  useEffect(() => {
    if (paid.trim() === "") return;
    const num = Number(paid);
    if (Number.isNaN(num)) return;
    syncMethodWithPaid(num);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- مقصود: يستجيب فقط لتغيّر total حتى لا يعاد ضبط وسيلة الدفع التي يختارها المستخدم
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkout تعاد إنشاؤها كل render؛ الاعتماديات أعلاه تغطي كل مدخلاتها
  }, [
    cart,
    loading,
    warehouseId,
    customerId,
    paymentMethod,
    paid,
    discount,
    isOverpaid,
    total,
    isSplitPayment,
    splitPaidTotal,
  ]);

  async function checkout() {
    if (loading) return;
    if (!warehouseId) {
      return toast.error(lang === "ar" ? "يرجى اختيار المستودع أولاً" : t("pos.select_warehouse"));
    }
    if (cart.length === 0) {
      return toast.error(
        lang === "ar" ? "السلة فارغة، يرجى إضافة منتجات أولاً" : t("pos.cart_empty"),
      );
    }
    if (isOverpaid) {
      return toast.error(
        lang === "ar"
          ? "المبلغ المدفوع أكبر من إجمالي الفاتورة المطلوب!"
          : "Paid amount cannot exceed invoice total!",
      );
    }
    if (effectivePaid < 0) {
      return toast.error(
        lang === "ar" ? "المبلغ المدفوع لا يمكن أن يكون سالبًا" : "Paid amount cannot be negative",
      );
    }
    if (effectivePaid < total && !customerId) {
      return toast.error(
        lang === "ar"
          ? "يرجى اختيار العميل لتسجيل المبلغ المتبقي كدين آجل"
          : "Select a customer so the unpaid balance can be recorded as debt",
      );
    }
    if (isSplitPayment && splitMethodCount === 0) {
      return toast.error(
        lang === "ar"
          ? "يرجى توزيع مبلغ الدفع على وسيلة واحدة على الأقل"
          : "Please allocate the payment to at least one method",
      );
    }

    setLoading(true);
    try {
      // وسيلة الدفع المحفوظة على الفاتورة:
      //  * وسيلة واحدة -> تُسجل باسمها الحقيقي (نقد/بطاقة/بنك/آجل)
      //  * أكثر من وسيلة -> 'split' كي تبقى قابلة للفلترة والتقارير
      const singleSplitMethod = splitMethodCount === 1 ? (splitCashN > 0 ? "cash" : "card") : null;
      let finalMethod: string = isSplitPayment
        ? isMultiMethodSplit
          ? "split"
          : (singleSplitMethod ?? "cash")
        : paymentMethod;

      // تصحيح منطقي نهائي للوسيلة قبل الإرسال لمنع التناقض:
      if (!isSplitPayment) {
        if (effectivePaid >= total && total > 0 && finalMethod === "credit") {
          // إذا كان المدفوع يغطي الإجمالي بالكامل، لا يمكن أن تكون الفاتورة "آجل"
          finalMethod = "cash";
        } else if (effectivePaid === 0 && total > 0 && finalMethod !== "credit") {
          // إذا لم يُدفع أي مبلغ، فالفاتورة دين آجل بالكامل
          finalMethod = "credit";
        }
      }

      // التوزيع المالي للدفع المجزأ يُرسل إلى قاعدة البيانات عبر customer_payment_splits
      // ليُسجّل كمدفوعات فعلية موثقة بدل النص الحر في الملاحظات.
      const paymentSplits: Array<{ method: string; amount: number }> = isSplitPayment
        ? [
            splitCashN > 0 ? { method: "cash", amount: splitCashN } : null,
            splitCardN > 0 ? { method: "card", amount: splitCardN } : null,
          ].filter((part): part is { method: string; amount: number } => part !== null)
        : [];

      let splitNote = "";
      if (isSplitPayment) {
        const parts = [];
        if (splitCashN > 0) parts.push(`${lang === "ar" ? "نقد" : "Cash"}: ${money(splitCashN)}`);
        if (splitCardN > 0)
          parts.push(`${lang === "ar" ? "شبكة/بطاقة" : "Card"}: ${money(splitCardN)}`);
        if (remainingDebt > 0)
          parts.push(`${lang === "ar" ? "آجل" : "Debt"}: ${money(remainingDebt)}`);
        splitNote = `[${lang === "ar" ? "الدفع بأكثر من طريقة" : "Split"}: ${parts.join(" | ")}]`;
      }

      const finalNote = (() => {
        const parts: string[] = [];
        if (note.trim()) parts.push(note.trim());
        // Electronic references are carried in the existing note field; this
        // preserves the RPC/offline contract while keeping the cashier context.
        if (
          (finalMethod === "bank_transfer" ||
            finalMethod === "mobile_money" ||
            paymentMethod === "bank_transfer" ||
            paymentMethod === "mobile_money") &&
          transferRef.trim()
        ) {
          const electronicLabel =
            finalMethod === "mobile_money" || paymentMethod === "mobile_money"
              ? lang === "ar"
                ? "مرجع المحفظة"
                : "Wallet reference"
              : lang === "ar"
                ? "رقم الحوالة"
                : "Transfer no.";
          parts.push(`${electronicLabel}: ${transferRef.trim()}`);
        }
        if (splitNote) parts.push(splitNote);
        return parts.length ? parts.join(" — ") : null;
      })();

      let invoiceId: string;
      let invoiceNumber: string;

      const isOfflineMode = typeof navigator !== "undefined" && !navigator.onLine;

      if (isOfflineMode) {
        const offlineResult = await posOfflineService.processOfflineSale({
          warehouse_id: warehouseId,
          customer_id: customerId || null,
          items: cart.map((l) => ({
            product_id: l.product_id,
            product_name: l.name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            subtotal: l.quantity * l.unit_price,
          })),
          subtotal,
          discount: discountN,
          tax: taxTotal,
          total,
          paid: Math.min(Math.max(effectivePaid, 0), total),
          payment_method: finalMethod as any,
          notes: finalNote as any,
        });
        invoiceId = offlineResult.invoice_id;
        invoiceNumber = offlineResult.local_document_ref;
        setLastInvoice({ id: invoiceId, number: invoiceNumber });
        toast.success(
          lang === "ar"
            ? `تم حفظ الفاتورة محلياً (Offline) — مرجع #${invoiceNumber}`
            : `Invoice saved offline — Ref #${invoiceNumber}`,
        );
      } else {
        try {
          const { data, error } = await supabase.rpc("create_sale", {
            _warehouse_id: warehouseId,
            _customer_id: (customerId || null) as any,
            _payment_method: finalMethod as any,
            _paid: Math.min(Math.max(effectivePaid, 0), total),
            _discount: discountN,
            _note: finalNote as any,
            _sale_date: saleDate,
            _payment_splits: paymentSplits as any,
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
          invoiceId = data as string;
          const { data: inv } = await supabase
            .from("sales_invoices")
            .select("invoice_number")
            .eq("id", invoiceId)
            .maybeSingle();
          invoiceNumber = inv?.invoice_number ?? invoiceId.slice(0, 8);
          setLastInvoice({ id: invoiceId, number: invoiceNumber });
          toast.success(
            lang === "ar"
              ? `تمت عملية البيع بنجاح — فاتورة #${invoiceNumber}`
              : `${t("pos.sale_complete")} — #${invoiceNumber}`,
          );
        } catch (netErr: any) {
          const offlineResult = await posOfflineService.processOfflineSale({
            warehouse_id: warehouseId,
            customer_id: customerId || null,
            items: cart.map((l) => ({
              product_id: l.product_id,
              product_name: l.name,
              quantity: l.quantity,
              unit_price: l.unit_price,
              subtotal: l.quantity * l.unit_price,
            })),
            subtotal,
            discount: discountN,
            tax: taxTotal,
            total,
            paid: Math.min(Math.max(effectivePaid, 0), total),
            payment_method: finalMethod as any,
            notes: finalNote as any,
          });
          invoiceId = offlineResult.invoice_id;
          invoiceNumber = offlineResult.local_document_ref;
          setLastInvoice({ id: invoiceId, number: invoiceNumber });
          toast.success(
            lang === "ar"
              ? `تعذر الاتصال بالخادم، تم حفظ الفاتورة محلياً — مرجع #${invoiceNumber}`
              : `Connection error, saved offline — Ref #${invoiceNumber}`,
          );
        }
      }

      // Build invoice doc for printing
      const customer = customers.find((c) => c.id === customerId);
      const warehouse = warehouses.find((w) => w.id === warehouseId);
      const cur = companySettings?.currency_symbol ?? companySettings?.currency ?? "";
      const invoiceDoc: InvoiceDoc = {
        title: lang === "ar" ? "فاتورة بيع" : "Sales Invoice",
        number: invoiceNumber,
        date: saleDate,
        partyLabel: lang === "ar" ? "العميل" : "Bill To",
        partyName: customer?.name ?? (lang === "ar" ? "عميل نقدي" : "Walk-in Customer"),
        warehouse: lang === "ar" ? (warehouse as any)?.name_ar || warehouse?.name : warehouse?.name,
        payment:
          lang === "ar"
            ? ({
                cash: "نقدًا",
                card: "بطاقة",
                bank_transfer: "حوالة",
                credit: "آجل",
                split: "الدفع بأكثر من طريقة",
                mobile_money: "محفظة",
              }[finalMethod] ?? finalMethod)
            : finalMethod.replace("_", " "),
        status:
          remainingDebt > 0
            ? effectivePaid > 0
              ? lang === "ar"
                ? "جزئي"
                : "Partial"
              : lang === "ar"
                ? "آجل / غير مدفوع"
                : "Unpaid"
            : lang === "ar"
              ? "مكتمل"
              : "Paid",
        currency: cur,
        subtotal,
        tax: taxTotal,
        discount: discountN,
        total,
        paid: Math.min(Math.max(effectivePaid, 0), total),
        lines: cart.map((l) => ({
          product: l.name,
          qty: l.quantity,
          price: l.unit_price,
          total: Math.round(l.unit_price * l.quantity * (1 + l.tax_rate / 100) * 100) / 100,
        })),
        company: companySettings
          ? {
              name: companySettings.name ?? "",
              address: companySettings.address ?? undefined,
              phone: companySettings.phone ?? undefined,
              vat: companySettings.tax_number ?? undefined,
            }
          : undefined,
      };

      // Unified Success Experience (only when a customer is attached)
      if (customerId) {
        const saleCustomer = customers.find((c) => c.id === customerId);
        setSaleSuccess({
          id: invoiceId,
          number: invoiceNumber,
          total,
          paid: Math.min(Math.max(effectivePaid, 0), total),
          remaining: remainingDebt,
          currency: cur,
          customer: saleCustomer
            ? {
                id: saleCustomer.id,
                name: saleCustomer.name,
                phone: saleCustomer.phone ?? null,
                balance: remainingDebt,
                creditLimit: saleCustomer.credit_limit ?? undefined,
                hasLedgerActivity: true,
              }
            : {
                id: customerId,
                name: lang === "ar" ? "عميل" : "Customer",
                phone: null,
                balance: remainingDebt,
              },
          invoice: {
            id: invoiceId,
            invoiceNumber,
            date: saleDate,
            subtotal,
            tax: taxTotal,
            discount: discountN,
            total,
            paid: Math.min(Math.max(effectivePaid, 0), total),
            remaining: remainingDebt,
            status:
              remainingDebt > 0
                ? effectivePaid > 0
                  ? lang === "ar"
                    ? "جزئي"
                    : "Partial"
                  : lang === "ar"
                    ? "آجل / غير مدفوع"
                    : "Unpaid"
                : lang === "ar"
                  ? "مكتمل"
                  : "Paid",
            linesCount: cart.length,
          },
        });
      }

      // Handle print mode
      const labels = {
        invoice: lang === "ar" ? "فاتورة" : "Invoice",
        date: lang === "ar" ? "التاريخ" : "Date",
        billTo: lang === "ar" ? "العميل" : "Bill To",
        warehouse: lang === "ar" ? "المستودع" : "Warehouse",
        payment: lang === "ar" ? "الدفع" : "Payment",
        status: lang === "ar" ? "الحالة" : "Status",
        product: lang === "ar" ? "المنتج" : "Product",
        qty: lang === "ar" ? "الكمية" : "Qty",
        price: lang === "ar" ? "السعر" : "Price",
        total: lang === "ar" ? "الإجمالي" : "Total",
        subtotal: lang === "ar" ? "المجموع" : "Subtotal",
        tax: lang === "ar" ? "الضريبة" : "Tax",
        discount: lang === "ar" ? "الخصم" : "Discount",
        grandTotal: lang === "ar" ? "الإجمالي الكلي" : "Grand Total",
        paid: lang === "ar" ? "المدفوع" : "Paid",
        balance: lang === "ar" ? "المتبقي" : "Balance",
        thanks: lang === "ar" ? "شكراً لتعاملكم معنا" : "Thank you for your business",
        poweredBy: "Vortex ERP",
      };
      const rtl = lang === "ar";

      if (printMode === "auto") {
        printInvoice(invoiceDoc, defaultTemplate, labels, rtl);
      } else if (printMode === "ask") {
        setSelectedTemplate(defaultTemplate);
        setPostSaleDoc(invoiceDoc);
      }
      // printMode === "off" → do nothing

      setCart([]);
      setPaid("");
      setDiscount("");
      setNote("");
      setTransferRef("");
      setIsSplitPayment(false);
      setSplitCash("");
      setSplitCard("");
      setSaleDate(new Date().toISOString().slice(0, 10));
      await loadStock(warehouseId);
      searchRef.current?.focus();
    } catch (err: any) {
      toast.error(err.message ?? (lang === "ar" ? "فشل إصدار الفاتورة" : t("pos.checkout_failed")));
    } finally {
      setLoading(false);
    }
  }

  /**
   * openQuotation — build a READ-ONLY price quote from the current cart.
   *
   * Deliberately performs no persistence whatsoever: it does not call
   * `create_sale`, does not touch stock, customer balance or payment splits. It
   * only maps the current cart into a `quotation` document and hands it to the
   * shared print engine for preview. Closing the preview leaves the cart intact.
   */
  function openQuotation() {
    if (cart.length === 0) {
      return toast.error(lang === "ar" ? "السلة فارغة" : t("pos.cart_empty"));
    }
    const customer = customers.find((c) => c.id === customerId);
    const cur = companySettings?.currency_symbol ?? companySettings?.currency ?? "";
    const request: PrintRequest = {
      doc: {
        docType: "quotation",
        title: lang === "ar" ? "عرض أسعار" : "Quotation",
        // A preview marker rather than a real invoice number: nothing is stored,
        // so no document sequence is consumed.
        number: lang === "ar" ? "عرض أسعار" : "QUOTE",
        date: saleDate,
        partyLabel: lang === "ar" ? "العميل" : "Bill To",
        partyName: customer?.name ?? (lang === "ar" ? "عميل نقدي" : "Walk-in Customer"),
        warehouse:
          lang === "ar"
            ? (warehouses.find((w) => w.id === warehouseId) as any)?.name_ar ||
              warehouses.find((w) => w.id === warehouseId)?.name
            : warehouses.find((w) => w.id === warehouseId)?.name,
        status: lang === "ar" ? "عرض سعر" : "Quotation",
        currency: cur,
        subtotal,
        tax: taxTotal,
        discount: discountN,
        total,
        paid: 0,
        balance: total,
        notes:
          lang === "ar"
            ? "هذا عرض أسعار وليس فاتورة — الأسعار صالحة حسب الاتفاق."
            : "This is a price quotation, not an invoice.",
        lines: cart.map((l) => ({
          product: l.name,
          qty: l.quantity,
          price: l.unit_price,
          total: Math.round(l.unit_price * l.quantity * (1 + l.tax_rate / 100) * 100) / 100,
        })),
        company: companySettings
          ? {
              name: companySettings.name ?? "",
              address: companySettings.address ?? undefined,
              phone: companySettings.phone ?? undefined,
              vat: companySettings.tax_number ?? undefined,
            }
          : undefined,
      },
      documentType: "quotation",
      rtl: lang === "ar",
    };
    setQuoteRequest(request);
  }

  const selectClassName =
    "h-10 w-full appearance-none rounded-2xl border border-border/80 bg-surface/90 px-3.5 text-xs text-foreground outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <>
      {/* Compact workspace shell: replaces the tall PageHeader so the whole
          viewport is usable. The page guide stays reachable via its button. */}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--primary)_10%,transparent),transparent_48%)] p-1.5 sm:p-2 lg:grid-cols-[minmax(0,1fr)_minmax(400px,460px)] lg:grid-rows-[auto_minmax(0,1fr)]">
        {/* Slim title bar: identity + page guide, without the tall hero header. */}
        <div className="flex shrink-0 flex-col items-stretch gap-2 rounded-2xl border border-border/80 bg-surface/95 px-3 py-2 shadow-sm backdrop-blur-md sm:px-4 lg:col-start-1 lg:row-start-1">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-primary/25 bg-primary text-primary-foreground shadow-sm">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-extrabold tracking-tight text-foreground">
                  {t("pos.title")}
                </h1>
                <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary sm:inline">
                  {lang === "ar" ? "مساحة الكاشير" : "Cashier workspace"}
                </span>
              </div>
              <p className="hidden truncate text-[11px] text-muted-foreground sm:block">
                {t("pos.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-1.5 border-t border-border/60 pt-2">
            <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 md:flex">
              <select
                aria-label={lang === "ar" ? "العميل" : "Customer"}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="h-9 w-72 max-w-[48vw] rounded-xl border border-border/80 bg-surface px-3 text-sm font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("pos.walkin")}</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                className="grid h-9 w-9 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary transition hover:bg-primary/20"
                title={lang === "ar" ? "إضافة عميل" : "Add customer"}
              >
                <UserPlus className="h-4 w-4" />
              </button>
              <label className="flex h-9 items-center gap-1 rounded-xl border border-border/80 bg-surface px-2 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-24 bg-transparent text-[11px] text-foreground outline-none"
                />
              </label>
              {enableServiceFeeSetting && (
                <button
                  type="button"
                  onClick={() => setServiceOpen(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 text-xs font-semibold text-violet-700 transition hover:bg-violet-500/20 dark:text-violet-300"
                  title={
                    lang === "ar" ? "خدمة أو أجرة تركيب بسعر متفق عليه" : "Service or custom labor"
                  }
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">
                    {lang === "ar" ? "إضافة خدمة" : "Add service"}
                  </span>
                </button>
              )}
            </div>
            <PageGuideButton config={posGuideConfig} className="!h-9 !w-9 shrink-0" />
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-1 items-stretch gap-2 lg:contents">
          {/* Products Panel — desktop only. On phones the catalogue is NOT
            mounted; the cart-first flow opens a product picker instead. */}
          {isDesktop && (
            <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border/80 bg-surface/95 p-2.5 shadow-sm ring-1 ring-background/40 lg:col-start-1 lg:row-start-2">
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

                {/* Barcode Camera Scanner */}
                {isModuleEnabled("barcode") && (
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="grid lg:hidden h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary transition hover:bg-primary/20 active:scale-95 shadow-2xs"
                    title={
                      lang === "ar" ? "قراءة الباركود بالكاميرا (F4)" : "Scan with camera (F4)"
                    }
                  >
                    <ScanBarcode className="h-4 w-4" />
                  </button>
                )}

                {/* Warehouse Select (Only shown if multi_warehouse is enabled & more than 1 exists) */}
                {isModuleEnabled("multi_warehouse") && warehouses.length > 1 && (
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

              {/* Scan mode indicator — honest about what is actually known.
              Never claims a scanner is "connected". */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-surface-2/50 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ScanBarcode className="h-3.5 w-3.5 text-primary" />
                  <span className="hidden md:inline">{t("scan.ready")}</span>
                  <span className="md:hidden">{t("scan.use_device_camera")}</span>
                </span>
                {isModuleEnabled("barcode") && (
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary transition hover:bg-primary/20"
                  >
                    <ScanBarcode className="h-3 w-3" />
                    <span>{t("scan.use_camera")}</span>
                  </button>
                )}
              </div>

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
                      <span className="font-medium text-foreground/80">
                        {t("common.categories")}
                      </span>
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
                                {lang === "ar"
                                  ? u.name_ar || u.short_name || u.name
                                  : u.short_name || u.name || u.name_ar || ""}
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
                        <span className="font-medium text-foreground/80">
                          {lang === "ar" ? "بلدان المنشأ" : "Country of Origin"}
                        </span>
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
                        <span className="font-medium text-foreground/80">
                          {lang === "ar" ? "درجات الجودة" : "Quality Grade"}
                        </span>
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
                        <span className="font-medium text-foreground/80">
                          {lang === "ar" ? "ماركات المركبات" : "Vehicle Make"}
                        </span>
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
                        <span className="font-medium text-foreground/80">
                          {lang === "ar" ? "موديلات المركبات" : "Vehicle Model"}
                        </span>
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

              {/* Product Grid Area — fills the remaining height and scrolls internally. */}
              <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
                {filtered.map((p) => {
                  const stock = stockMap[p.id] ?? 0;
                  const low = stock <= 0;
                  const catLabel =
                    lang === "ar"
                      ? p.category?.name_ar || p.category?.name
                      : p.category?.name || p.category?.name_ar;
                  // العرض العربي يجب أن يفضّل التسمية العربية دائماً. كان الرمز
                  // الإنجليزي (short_name) يُعرض كبديل عن name_ar الغائب، فيظهر
                  // "kg" وسط واجهة عربية — وهذا ما يُفسد قراءة الشاشة للقبّان.
                  const unitLabel =
                    lang === "ar"
                      ? p.unit?.name_ar || p.unit?.name || p.unit?.short_name || ""
                      : p.unit?.short_name || p.unit?.name || p.unit?.name_ar || "";
                  const originLabel =
                    lang === "ar"
                      ? p.origin?.name_ar || p.origin?.name
                      : p.origin?.name || p.origin?.name_ar;
                  const qualityLabel =
                    lang === "ar"
                      ? p.quality?.name_ar || p.quality?.name
                      : p.quality?.name || p.quality?.name_ar;
                  const compats = productCompatMap.get(p.id) || [];
                  const uniqueMakes = Array.from(
                    new Set(compats.map((c) => c.makeName).filter(Boolean)),
                  );

                  return (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p)}
                      disabled={low}
                      className="group relative flex flex-col items-start justify-between gap-1.5 rounded-2xl border border-border/80 bg-surface/90 p-2.5 text-start transition-all hover:border-primary/50 hover:bg-surface-2 hover:shadow-sm disabled:opacity-40"
                    >
                      <div className="w-full">
                        {/* Catalog Index Info Strip ABOVE the product name */}
                        <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[10px] leading-none">
                          {/* Quality Grade */}
                          {catalogConfig.enableQualityGrades && qualityLabel && (
                            <span
                              className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-bold border ${
                                qualityLabel.includes("أصلي") ||
                                qualityLabel.toLowerCase().includes("genuine") ||
                                qualityLabel.toLowerCase().includes("oem")
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                  : "bg-surface-2 text-foreground/80 border-border/70"
                              }`}
                            >
                              <span>{qualityLabel}</span>
                            </span>
                          )}

                          {/* Origin */}
                          {catalogConfig.enableOrigins && originLabel && (
                            <span className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-surface px-1 py-0.5 text-muted-foreground font-medium">
                              <span>{originLabel}</span>
                              {p.origin?.code && (
                                <span className="text-[9px] font-mono opacity-70">
                                  ({p.origin.code})
                                </span>
                              )}
                            </span>
                          )}

                          {/* Brand or Category */}
                          {catalogConfig.enableBrands && p.brand ? (
                            <span className="inline-flex items-center rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-primary font-semibold truncate max-w-[85px]">
                              {lang === "ar"
                                ? p.brand.name_ar || p.brand.name
                                : p.brand.name || p.brand.name_ar}
                            </span>
                          ) : catLabel ? (
                            <span className="inline-flex items-center rounded bg-surface-2 px-1.5 py-0.5 text-muted-foreground truncate max-w-[85px]">
                              {catLabel}
                            </span>
                          ) : null}

                          {/* Vehicle Fitment / Models */}
                          {catalogConfig.enableMakesAndModels && compats.length > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-sky-700 dark:text-sky-300 font-semibold truncate max-w-[120px]"
                              title={compats
                                .map((c) => `${c.makeName} - ${c.modelName}`)
                                .join(" | ")}
                            >
                              <span>
                                🏍️ {uniqueMakes[0] || compats[0].makeName}{" "}
                                {compats.length > 1
                                  ? `(+${compats.length - 1})`
                                  : compats[0].modelName}
                              </span>
                            </span>
                          )}
                        </div>

                        {/* Product Name */}
                        <div className="line-clamp-2 text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-snug">
                          {lang === "ar" && p.name_ar ? p.name_ar : p.name}
                        </div>
                      </div>

                      {/* Price & Stock */}
                      <div className="mt-2 flex w-full items-center justify-between border-t border-border/40 pt-1.5">
                        <span className="text-xs sm:text-sm font-bold text-primary font-mono">
                          {money(Number(p.sale_price))}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                            low
                              ? "bg-destructive/10 text-destructive font-semibold"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {low
                            ? lang === "ar"
                              ? "نفد"
                              : "0"
                            : `${stock} ${unitLabel ? `· ${unitLabel}` : ""}`}
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
          )}

          {/* Cart Panel — the primary workspace on all sizes. On mobile it is the
            only panel; on desktop it is the fixed-width right column. */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-primary/15 bg-surface/95 p-2.5 shadow-xl ring-1 ring-border/50 backdrop-blur-md sm:p-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {/* Cart Header */}
            <div className="mb-2 flex shrink-0 items-center justify-between border-b border-border/60 px-1 pb-2">
              <div className="flex items-center gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-xs font-bold text-foreground">
                    <span>{t("pos.cart")}</span>
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-mono font-bold text-primary">
                      {cart.length}
                    </span>
                  </h2>
                </div>
              </div>
              {isDesktop ? (
                cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-surface/80 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive active:scale-95"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t("pos.clear")}</span>
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

            {/* Customer controls stay in the workspace header on desktop; the
                compact cart variant remains available on touch widths. */}
            <div className="mb-2 flex shrink-0 items-center gap-2 md:hidden">
              <div className="relative min-w-0 flex-1">
                <select
                  aria-label={lang === "ar" ? "العميل" : "Customer"}
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="h-9 w-full appearance-none rounded-full border border-border/80 bg-surface/90 px-3.5 pl-8 pr-8 text-xs font-medium outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20 rtl:pl-8 rtl:pr-3.5"
                >
                  <option value="">{t("pos.walkin")}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground rtl:left-3 rtl:right-auto" />
              </div>

              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                title={lang === "ar" ? "إضافة عميل جديد" : "Add new customer"}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary transition hover:bg-primary/20 hover:scale-105 active:scale-95 shadow-xs shadow-primary/10"
              >
                <UserPlus className="h-3.5 w-3.5" />
              </button>

              {/* Date input cleanly integrated in customer header */}
              <label
                className="flex h-9 items-center gap-1.5 rounded-full border border-border/80 bg-surface/90 px-2.5 text-xs text-muted-foreground shadow-2xs hover:border-primary/40 transition shrink-0"
                title={lang === "ar" ? "تاريخ الفاتورة" : "Sale Date"}
              >
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-24 bg-transparent text-[11px] text-foreground outline-none font-mono cursor-pointer"
                />
              </label>
            </div>

            {/* Selected Customer Balance & Credit Info */}
            {customerId &&
              (() => {
                const cust = customers.find((c) => c.id === customerId);
                if (!cust) return null;
                const bal = Number(cust.balance || 0);
                const limit = Number(cust.credit_limit || 0);
                const remainingCredit = limit > 0 ? limit - bal : null;
                return (
                  <div className="shrink-0 mb-2 flex items-center justify-between rounded-xl bg-surface-2/60 border border-border/60 px-3 py-1 text-[11px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span>{lang === "ar" ? "رصيد العميل:" : "Customer Balance:"}</span>
                      <span
                        className={`font-mono font-bold ${bal > 0 ? "text-amber-500" : "text-emerald-500"}`}
                      >
                        {money(bal)}
                      </span>
                    </div>
                    {limit > 0 && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span>{lang === "ar" ? "حد الائتمان:" : "Credit Limit:"}</span>
                        <span className="font-mono">{money(limit)}</span>
                        {remainingCredit !== null && (
                          <span
                            className={`font-mono font-semibold ${remainingCredit < remainingDebt ? "text-rose-500" : "text-emerald-500"}`}
                          >
                            ({lang === "ar" ? "المتاح:" : "Avail:"} {money(remainingCredit)})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

            {/* Cart items — internal scroll, shared row component for POS parity. */}
            <div className="my-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {cart.length === 0 ? (
                <div className="grid place-items-center py-14 text-center text-sm text-muted-foreground">
                  <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-border bg-surface-2/40">
                    <ShoppingBag className="h-6 w-6 text-muted-foreground opacity-40" />
                  </div>
                  <div className="font-medium">{t("pos.empty_cart")}</div>
                  <p className="mt-1 text-xs text-muted-foreground/80">
                    {isDesktop
                      ? lang === "ar"
                        ? "انقر على أي منتج أو امسح الباركود لإضافته"
                        : "Click any product or scan to add"
                      : lang === "ar"
                        ? "اضغط لإضافة منتج وابحث عنه"
                        : "Tap to add a product and search"}
                  </p>
                  {!isDesktop && (
                    <button
                      type="button"
                      onClick={() => setMobilePickerOpen(true)}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm active:scale-95"
                    >
                      <Plus className="h-4 w-4" />
                      <span>{t("pos.add_product")}</span>
                    </button>
                  )}
                </div>
              ) : (
                cart.map((l) => (
                  <CartLineRow
                    key={l.product_id}
                    line={{
                      id: l.product_id,
                      name: l.name,
                      quantity: l.quantity,
                      unitPrice: l.unit_price,
                      taxRate: l.tax_rate,
                      isService: l.is_service,
                      priceModified:
                        l.base_price != null &&
                        Math.round(l.base_price * 100) !== Math.round(l.unit_price * 100),
                      stock: l.is_service ? undefined : (stockMap[l.product_id] ?? 0),
                    }}
                    labels={{
                      price: t("pos.price"),
                      quantity: t("common.qty"),
                      remove: t("common.delete"),
                      priceModified: t("pos.price_override"),
                      stockLabel: t("pos.stock_available"),
                    }}
                    formatMoney={money}
                    onQuantityCommit={(next) => setQty(l.product_id, next)}
                    onPriceChange={(next) => setPrice(l.product_id, next)}
                    onRemove={() => setCart((c) => c.filter((x) => x.product_id !== l.product_id))}
                  />
                ))
              )}

              {/* Payment and totals share this same cart scroll area. */}
              <div className="mt-3 space-y-2 border-t border-border/70 bg-surface/95 pt-2.5 pr-1">
                {/* Payment Method Switcher: Cash | Card | Bank | Credit | Split */}
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                    <label className="relative min-w-0">
                      <span className="sr-only">
                        {lang === "ar" ? "طريقة الدفع" : "Payment method"}
                      </span>
                      <select
                        value={isSplitPayment ? "split" : paymentMethod}
                        onChange={(e) => {
                          if (e.target.value === "split") {
                            setIsSplitPayment(true);
                          } else {
                            const method = e.target.value as typeof paymentMethod;
                            setIsSplitPayment(false);
                            setPaymentMethod(method);
                            setPaid(method === "credit" ? "0" : "");
                          }
                        }}
                        className="h-10 w-full appearance-none rounded-xl border border-border/80 bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="cash">{t("pos.pm.cash")}</option>
                        <option value="mobile_money">{t("pos.pm.mobile_money")}</option>
                        <option value="bank_transfer">{t("pos.pm.bank_transfer")}</option>
                        <option value="credit">{t("pos.pm.credit")}</option>
                        <option value="split">{t("pos.pm.split")}</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      placeholder={t("pos.discount")}
                      aria-label={t("pos.discount")}
                      className="h-10 w-full rounded-xl border border-border/80 bg-surface px-2 text-end font-mono text-xs outline-none focus:border-primary"
                    />
                  </div>

                  {/* Transfer reference — only meaningful for bank transfers. */}
                  {!isSplitPayment &&
                    (paymentMethod === "bank_transfer" || paymentMethod === "mobile_money") && (
                      <input
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
                        className="h-9 w-full rounded-2xl border border-input/80 bg-surface/90 px-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                    )}

                  {/* Split Payment inputs if enabled */}
                  {isSplitPayment ? (
                    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-2.5 space-y-2 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-xs font-semibold text-violet-700 dark:text-violet-300">
                        <span>
                          {lang === "ar"
                            ? "توزيع الدفعات (نقد / بطاقة أو حوالة / آجل):"
                            : "Split Allocation:"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSplitCash(String(total));
                            setSplitCard("");
                          }}
                          className="text-[10px] text-violet-600 underline"
                        >
                          {lang === "ar" ? "نقد كامل" : "All Cash"}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-0.5">
                            {lang === "ar" ? "نقدًا:" : "Cash:"}
                          </label>
                          <input
                            type="number"
                            min="0"
                            dir="ltr"
                            value={splitCash}
                            onChange={(e) => setSplitCash(e.target.value)}
                            placeholder="0"
                            className="h-8 w-full rounded-xl border border-border bg-surface px-2 text-xs font-mono outline-none focus:border-violet-500 [unicode-bidi:plaintext]"
                          />
                          {splitCash && Number(splitCash) > 0 && (
                            <span className="text-[9px] text-muted-foreground font-mono block text-end">
                              <span dir="ltr" className="[unicode-bidi:isolate]">
                                {formatWithCommas(splitCash)}
                              </span>
                            </span>
                          )}
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground block mb-0.5">
                            {lang === "ar" ? "بطاقة/حوالة:" : "Card/Transfer:"}
                          </label>
                          <input
                            type="number"
                            min="0"
                            dir="ltr"
                            value={splitCard}
                            onChange={(e) => setSplitCard(e.target.value)}
                            placeholder="0"
                            className="h-8 w-full rounded-xl border border-border bg-surface px-2 text-xs font-mono outline-none focus:border-violet-500 [unicode-bidi:plaintext]"
                          />
                          {splitCard && Number(splitCard) > 0 && (
                            <span className="text-[9px] text-muted-foreground font-mono block text-end">
                              <span dir="ltr" className="[unicode-bidi:isolate]">
                                {formatWithCommas(splitCard)}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Split Summary Footer */}
                      <div className="pt-1.5 border-t border-violet-500/20 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">
                          {lang === "ar" ? "إجمالي المدفوع الآن:" : "Total Paid Now:"}
                        </span>
                        <span className="font-mono font-bold text-foreground">
                          <span dir="ltr" className="[unicode-bidi:isolate]">
                            {money(splitPaidTotal)}
                          </span>
                        </span>
                      </div>

                      {remainingDebt > 0 && (
                        <div className="flex items-center justify-between rounded-xl bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-xs font-mono text-amber-600 dark:text-amber-300">
                          <span>
                            {lang === "ar" ? "المتبقي كدين آجل على العميل:" : "Remaining Debt:"}
                          </span>
                          <span className="font-bold">
                            <span dir="ltr" className="[unicode-bidi:isolate]">
                              {money(remainingDebt)}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  ) : paymentMethod !== "cash" ? (
                    /* Single Payment Paid Input & Live Comma Preview */
                    <div className="space-y-1.5">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-muted-foreground">
                          <span>{lang === "ar" ? "المبلغ المدفوع" : "Amount paid"}</span>
                          <span className="font-mono text-primary">{money(total)}</span>
                        </div>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            dir="ltr"
                            value={paid}
                            onChange={(e) => handlePaidChange(e.target.value)}
                            placeholder={
                              isPaidEmpty
                                ? paymentMethod === "credit"
                                  ? `${lang === "ar" ? "آجل بالكامل" : "Full credit"} (${money(0)})`
                                  : `${lang === "ar" ? "مدفوع بالكامل" : "Full paid"} (${money(total)})`
                                : `${t("pos.paid")}`
                            }
                            className={`h-9 w-full rounded-2xl border px-3 text-xs font-mono outline-none transition ${
                              isOverpaid
                                ? "border-destructive bg-destructive/10 text-destructive focus:ring-2 focus:ring-destructive/30"
                                : "border-input/80 bg-surface/90 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                            } [unicode-bidi:plaintext]`}
                          />
                          {paid.trim() !== "" && !isNaN(Number(paid)) && (
                            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-muted-foreground pointer-events-none">
                              <span dir="ltr" className="[unicode-bidi:isolate]">
                                = {money(Number(paid))}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quick Shortcuts */}
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <button
                          type="button"
                          onClick={() => {
                            setIsSplitPayment(false);
                            setPaymentMethod("cash");
                            setPaid("");
                          }}
                          className="rounded-full bg-surface-2 px-2.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-surface-3 transition"
                        >
                          {lang === "ar" ? "الكامل" : "Full"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsSplitPayment(false);
                            const half = Math.round((total / 2) * 100) / 100;
                            setPaid(String(half));
                            if (half < total) setPaymentMethod("credit");
                          }}
                          className="rounded-full bg-surface-2 px-2.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-surface-3 transition"
                        >
                          {lang === "ar" ? "نصف المبلغ" : "Half"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsSplitPayment(false);
                            setPaymentMethod("credit");
                            setPaid("0");
                          }}
                          className="rounded-full bg-surface-2 px-2.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-surface-3 transition"
                        >
                          {lang === "ar" ? "آجل (0)" : "0 (Debt)"}
                        </button>
                      </div>

                      {/* Status Badges */}
                      {isOverpaid ? (
                        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive flex items-center gap-1.5 animate-in fade-in duration-200">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {lang === "ar"
                              ? `المبلغ المدفوع (${money(effectivePaid)}) أكبر من الإجمالي المطلوب (${money(total)})`
                              : `Paid amount (${money(effectivePaid)}) exceeds total (${money(total)})`}
                          </span>
                        </div>
                      ) : paymentMethod === "credit" || remainingDebt > 0 ? (
                        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-mono text-amber-600 dark:text-amber-300">
                          <span>
                            {lang === "ar" ? "المتبقي كدين آجل على العميل:" : "Remaining debt:"}
                          </span>
                          <span className="font-bold">
                            <span dir="ltr" className="[unicode-bidi:isolate]">
                              {money(remainingDebt)}
                            </span>
                          </span>
                        </div>
                      ) : isPaidEmpty ? (
                        <div className="flex items-center justify-between text-[11px] text-emerald-600 dark:text-emerald-400 font-medium px-2">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {lang === "ar"
                              ? "المدفوع تلقائيًا: كامل الإجمالي"
                              : "Auto paid: Full invoice"}
                          </span>
                          <span className="font-mono font-semibold">
                            <span dir="ltr" className="[unicode-bidi:isolate]">
                              {money(total)}
                            </span>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Notes — kept in the payment area so the operator never hunts for it. */}
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("pos.notes_placeholder")}
                  className="h-9 w-full shrink-0 rounded-2xl border border-input/80 bg-surface/90 px-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />

                <div className="space-y-1.5 rounded-2xl border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("pos.subtotal")}</span>
                    <span className="font-mono font-semibold text-foreground">
                      {money(subtotal)}
                    </span>
                  </div>

                  {discountN > 0 && (
                    <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
                      <span className="font-medium">{t("pos.discount")}</span>
                      <span className="font-mono font-bold [unicode-bidi:isolate]">
                        −{money(discountN)}
                      </span>
                    </div>
                  )}

                  {taxTotal > 0 && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{t("pos.tax")}</span>
                      <span className="font-mono font-semibold text-foreground">
                        {money(taxTotal)}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t border-primary/20 pt-2">
                    <span className="text-xs font-bold text-foreground">{t("pos.total")}</span>
                    <span className="font-mono text-base font-extrabold tracking-tight text-primary">
                      <span dir="ltr" className="[unicode-bidi:isolate]">
                        {money(total)}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action row stays outside the only scroll region. */}
            <div className="mt-2 shrink-0 border-t border-border/70 bg-surface/95 pb-1 pt-2">
              {isOverpaid ? (
                <button
                  type="button"
                  disabled
                  className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-destructive/60 bg-destructive text-sm font-bold text-destructive-foreground opacity-90 shadow-lg shadow-destructive/20 ring-2 ring-destructive/30"
                >
                  <AlertCircle className="h-4 w-4" />
                  <span>
                    {lang === "ar"
                      ? "المبلغ المدفوع أكبر من الإجمالي!"
                      : "Paid amount exceeds total!"}
                  </span>
                </button>
              ) : (
                <div className="flex gap-2">
                  {/* Secondary: quotation preview (never persists). */}
                  <button
                    type="button"
                    onClick={openQuotation}
                    disabled={cart.length === 0}
                    title={t("pos.quote_only_hint")}
                    className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-transparent bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">{t("pos.quote")}</span>
                  </button>

                  {/* Primary: issue the invoice. */}
                  <button
                    type="button"
                    onClick={checkout}
                    disabled={loading || cart.length === 0}
                    className="flex h-11 flex-1 items-center justify-center rounded-2xl bg-gradient-to-r from-primary to-primary/90 px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:shadow-primary/35 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                      <span>{t("pos.checkout")}</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
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

      {/* Unified Operation Success Experience (after a confirmed sale) */}
      <OperationSuccessModal
        open={Boolean(saleSuccess)}
        onClose={() => setSaleSuccess(null)}
        operationId={saleSuccess?.id}
        title={lang === "ar" ? "تمت عملية البيع بنجاح" : "Sale Completed Successfully"}
        subtitle={
          saleSuccess
            ? lang === "ar"
              ? `تم إصدار الفاتورة رقم #${saleSuccess.number} بنجاح`
              : `Invoice #${saleSuccess.number} issued successfully`
            : undefined
        }
        amount={saleSuccess?.total}
        currency={saleSuccess?.currency}
        referenceNumber={saleSuccess?.number}
        customer={saleSuccess?.customer}
        invoice={saleSuccess?.invoice}
        eventType="invoice_created"
      />

      {/* Post-Sale Print Dialog */}
      {postSaleDoc && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="panel-elevated w-full max-w-md rounded-3xl p-6 shadow-2xl border border-border/80">
            {/* Header */}
            <div className="mb-5 flex items-center justify-between border-b border-border/60 pb-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Printer className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground">
                    {lang === "ar" ? "طباعة الفاتورة" : "Print Invoice"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {lang === "ar"
                      ? `فاتورة #${postSaleDoc.number}`
                      : `Invoice #${postSaleDoc.number}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPostSaleDoc(null)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Template Selector */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {lang === "ar" ? "اختر قالب الطباعة" : "Choose print template"}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: "thermal",
                      icon: Receipt,
                      ar: "فاتورة حرارية",
                      en: "Thermal 80mm",
                      sub_ar: "طابعة مدمجة",
                      sub_en: "Compact printer",
                    },
                    {
                      id: "standard",
                      icon: FileText,
                      ar: "A4 عادي",
                      en: "Standard A4",
                      sub_ar: "تصميم أعمال",
                      sub_en: "Business format",
                    },
                    {
                      id: "elegant",
                      icon: Sparkles,
                      ar: "A4 فاخر",
                      en: "Elegant A4",
                      sub_ar: "لمسات ذهبية",
                      sub_en: "Gold accents",
                    },
                  ] as const
                ).map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => setSelectedTemplate(tmpl.id as InvoiceTemplate)}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-all duration-150 ${
                      selectedTemplate === tmpl.id
                        ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/30"
                        : "border-border/80 hover:border-primary/40 hover:bg-surface-2 text-muted-foreground"
                    }`}
                  >
                    <tmpl.icon className="h-5 w-5" />
                    <span className="text-xs font-semibold leading-tight">
                      {lang === "ar" ? tmpl.ar : tmpl.en}
                    </span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {lang === "ar" ? tmpl.sub_ar : tmpl.sub_en}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Save as default */}
            <label className="flex items-center gap-2 mb-5 cursor-pointer group">
              <input
                type="checkbox"
                className="rounded border-border accent-primary"
                checked={defaultTemplate === selectedTemplate}
                onChange={(e) => {
                  if (e.target.checked) {
                    setDefaultTemplate(selectedTemplate);
                    localStorage.setItem("pos_default_template", selectedTemplate);
                  }
                }}
              />
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition">
                {lang === "ar" ? "حفظ كقالب افتراضي" : "Save as default template"}
              </span>
            </label>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPostSaleDoc(null)}
                className="flex-1 flex items-center justify-center gap-2 h-10 rounded-2xl border border-border/80 text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
              >
                <SkipForward className="h-4 w-4" />
                <span>{lang === "ar" ? "تخطي — بدون طباعة" : "Skip — no print"}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const rtl = lang === "ar";
                  const labels = {
                    invoice: rtl ? "فاتورة" : "Invoice",
                    date: rtl ? "التاريخ" : "Date",
                    billTo: rtl ? "العميل" : "Bill To",
                    warehouse: rtl ? "المستودع" : "Warehouse",
                    payment: rtl ? "الدفع" : "Payment",
                    status: rtl ? "الحالة" : "Status",
                    product: rtl ? "المنتج" : "Product",
                    qty: rtl ? "الكمية" : "Qty",
                    price: rtl ? "السعر" : "Price",
                    total: rtl ? "الإجمالي" : "Total",
                    subtotal: rtl ? "المجموع" : "Subtotal",
                    tax: rtl ? "الضريبة" : "Tax",
                    discount: rtl ? "الخصم" : "Discount",
                    grandTotal: rtl ? "الإجمالي الكلي" : "Grand Total",
                    paid: rtl ? "المدفوع" : "Paid",
                    balance: rtl ? "المتبقي" : "Balance",
                    thanks: rtl ? "شكراً لتعاملكم معنا" : "Thank you for your business",
                    poweredBy: "Vortex ERP",
                  };
                  printInvoice(postSaleDoc!, selectedTemplate, labels, rtl);
                  setPostSaleDoc(null);
                }}
                className="flex-1 flex items-center justify-center gap-2 h-10 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-95 transition shadow-md shadow-primary/25"
              >
                <Printer className="h-4 w-4" />
                <span>{lang === "ar" ? "طباعة الآن" : "Print now"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Customer — the SAME form used by the Customers page. On save the
          new customer is selected for this sale and the cart is left intact. */}
      <CustomerFormDialog
        open={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        onSaved={(record) => {
          setCustomers((current) =>
            [...current.filter((c) => c.id !== record.id), record].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          );
          setCustomerId(record.id);
          toast.success(
            lang === "ar" ? "تمت إضافة العميل واختياره بنجاح" : "Customer added and selected",
          );
        }}
      />

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
              <h3 className="font-bold text-foreground">
                {lang === "ar" ? "إضافة خدمة أو أجرة" : "Add service"}
              </h3>
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
                placeholder={
                  lang === "ar" ? "اسم الخدمة (مثال: تغيير زيت أو صيانة)" : "Service name"
                }
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

      {/* Mobile product picker — reuses the SAME filtered products & search state. */}
      <MobileProductPicker
        open={mobilePickerOpen && !isDesktop}
        onClose={() => setMobilePickerOpen(false)}
        search={search}
        onSearchChange={setSearch}
        title={t("pos.add_product_title")}
        searchPlaceholder={t("pos.search_product")}
        emptyLabel={t("pos.no_products")}
        inputRef={searchRef}
        products={filtered.slice(0, 200).map((p) => {
          const stock = stockMap[p.id] ?? 0;
          return {
            id: p.id,
            name: lang === "ar" && p.name_ar ? p.name_ar : p.name,
            meta: p.barcode || p.sku || null,
            value: money(Number(p.sale_price)),
            sub: `${t("pos.stock")}: ${stock}`,
            disabled: p.is_service !== true && stock <= 0,
          };
        })}
        onSelect={(id) => {
          const product = products.find((p) => p.id === id);
          if (product) addToCart(product);
          setMobilePickerOpen(false);
        }}
      />

      {/* Quotation preview — purely a document preview; nothing is persisted. */}
      {quoteRequest ? (
        <UniversalPrintPreview
          open
          onOpenChange={(open) => {
            if (!open) setQuoteRequest(null);
          }}
          request={quoteRequest}
          title={t("pos.quote_preview_title")}
          rtl={lang === "ar"}
        />
      ) : null}
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold
          ? "font-bold text-sm text-foreground pt-1 border-t border-border/40"
          : "text-muted-foreground"
      }`}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
