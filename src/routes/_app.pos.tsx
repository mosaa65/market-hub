import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Plus,
  Trash2,
  ScanBarcode,
  Loader2,
  X,
  Filter,
  ChevronDown,
  UserPlus,
  Warehouse as WarehouseIcon,
  Wrench,
  ShoppingBag,
  Sparkles,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  Layers,
  Smartphone,
  CreditCard,
  Banknote,
  Clock,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
import { useIsDesktop, useMediaQuery } from "@/hooks/use-media-query";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { CartLine as CartLineRow } from "@/components/commerce/cart-line";
import { MobileProductPicker } from "@/components/commerce/mobile-product-picker";
import { RecordsSortPanel } from "@/components/ui/records-panels";
import { RecordsToolbar } from "@/components/ui/records-toolbar";
import type { DataTableSort } from "@/components/ui/data-table";
import { CustomerFormDialog } from "@/components/contacts/customer-form-dialog";
import { UniversalPrintPreview } from "@/components/universal-print-preview";
import type { InvoiceDoc } from "@/lib/pdf";
import { getUnifiedPrintSettings, printUnifiedDocument, type PrintRequest } from "@/lib/printing";
import { OperationSuccessModal } from "@/components/communication";
import { PosBatchSelectorModal } from "@/components/batches/pos-batch-selector-modal";
import { useBatchSettings } from "@/hooks/use-batch-settings";
import { useCashboxes } from "@/hooks/use-cashboxes";
import { useCompanyBankAccounts } from "@/hooks/use-company-bank-accounts";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import type { CustomerContext, InvoiceContext } from "@/lib/communication";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import { usePaymentPanel } from "@/components/payments/payment-panel";
import { resolvePaidAmount } from "@/lib/payments/payment-rules";
import { useFormNavigationScope } from "@/hooks/use-form-navigation";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import {
  SplitPaymentDialog,
  type SplitPaymentValues,
} from "@/components/ui/payment-method/split-payment-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import { AmountInput } from "@/components/commerce/amount-input";
import { PartyPicker } from "@/components/commerce/party-picker";
import { PosTotalsCard } from "@/components/commerce/pos-totals-card";
import { PosDatePicker } from "@/components/commerce/pos-date-picker";

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
  is_service?: boolean | null;
  item_nature?: string | null;
  inventory_policy?: string | null;
  tracking?: string | null;
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
  base_price?: number;
  tax_rate: number;
  quantity: number;
  is_service?: boolean;
  item_nature?: string;
  inventory_policy?: string;
  batch_id?: string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
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
  is_system?: boolean | null;
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

interface SplitPaymentLine {
  key: string;
  methodId: string;
  amount: string;
  autoAmount?: boolean;
  reference?: string;
}

// Split allocations are persisted through the guarded split RPC and each tender
// is validated before checkout, so the cashier can use multiple methods safely.
const POS_SPLIT_LEDGER_POSTING_READY = true;

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
      description: "يتم خصم الكميات من المستودع المحدد عند اعتماد عملية البيع.",
      icon: <Scale className="h-4 w-4" />,
    },
    {
      title: "حفظ وطباعة فوري",
      description: "إتمام الفاتورة وطباعة الإيصال الحراري من شاشة الكاشير.",
      icon: <Zap className="h-4 w-4" />,
    },
  ],
  matrixTitle: "مصفوفة الأثر المالي والمخزني لعمليات الكاشير",
  matrixDescription: "تأثير طرق الدفع وحركة نقطة البيع على الحسابات والمخزون.",
  impactMatrix: {
    columns: [
      { key: "paymentType", label: "طريقة العملية", className: "w-[20%]" },
      { key: "inventoryImpact", label: "التأثير المخزني", className: "w-[25%]" },
      { key: "accountingImpact", label: "الأثر المالي", className: "w-[30%]" },
      { key: "controls", label: "الضوابط", className: "w-[25%]" },
    ],
    rows: [
      {
        badge: { label: "نقدي", variant: "emerald" },
        fields: {
          paymentType: "بيع نقدي",
          inventoryImpact: "خصم الكمية",
          accountingImpact: "إثبات التحصيل",
          controls: "مطابقة المقبوض",
        },
      },
      {
        badge: { label: "إلكتروني", variant: "blue" },
        fields: {
          paymentType: "شبكة/بطاقة",
          inventoryImpact: "خصم الكمية",
          accountingImpact: "إثبات تحصيل البنك",
          controls: "مطابقة إشعار الدفع",
        },
      },
      {
        badge: { label: "آجل", variant: "purple" },
        fields: {
          paymentType: "ذمم العميل",
          inventoryImpact: "خصم الكمية",
          accountingImpact: "إثبات الدين",
          controls: "التحقق من الحد الائتماني",
        },
      },
      {
        badge: { label: "تحويل", variant: "amber" },
        fields: {
          paymentType: "حوالة بنكية",
          inventoryImpact: "خصم الكمية",
          accountingImpact: "إثبات التحصيل البنكي",
          controls: "حفظ مرجع الحوالة",
        },
      },
    ],
  },
  stepsTitle: "خطوات البيع",
  steps: [
    {
      number: "1",
      title: "إضافة الأصناف",
      description: "ابحث باسم الصنف أو امسح باركوده لإضافته.",
    },
    { number: "2", title: "مراجعة السلة", description: "راجع الكمية والسعر والخصم." },
    {
      number: "3",
      title: "تحديد العميل والدفع",
      description: "اختر العميل وطريقة الدفع المناسبة.",
    },
    { number: "4", title: "اعتماد الفاتورة", description: "اعتمد البيع واطبع الإيصال عند الحاجة." },
  ],
  rulesTitle: "إرشادات السلامة والرقابة التشغيلية",
  rules: [
    {
      type: "danger",
      title: "توفر المخزون",
      description: "تحقق من الكميات المتاحة قبل اعتماد البيع.",
    },
    { type: "warning", title: "الأسعار والخصومات", description: "تخضع لتفويض المستخدم." },
    {
      type: "info",
      title: "حفظ الجلسة",
      description: "السلة محفوظة في ذاكرة الشاشة خلال الجلسة الحالية.",
    },
  ],
  footerTip: "فورتيكس ERP — نظام الكاشير ونقاط البيع السريعة المعتمد",
};

function POSPage() {
  const { isModuleEnabled } = useModules();
  const { t, lang } = useI18n();
  const { config: catalogConfig } = useCatalogModules();
  const { methods: posPaymentMethods } = usePaymentMethodsForContext("pos", {
    includeCredit: true,
  });
  const { settings: batchSettings } = useBatchSettings();
  const { activeCashboxes, defaultCashbox } = useCashboxes();
  const {
    banks: companyBanks,
    wallets: companyWallets,
    defaultBank,
    defaultWallet,
  } = useCompanyBankAccounts();
  const [settlement, setSettlement] = useState<PaymentSettlementSelection>({
    method: "cash",
    paymentMethodId: "cash",
  });
  const [batchPendingProduct, setBatchPendingProduct] = useState<Product | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
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
  const [catalogSort, setCatalogSort] = useState("name_asc");
  const [catalogTableSort, setCatalogTableSort] = useState<DataTableSort>({
    key: "name",
    direction: "asc",
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  /* Unified records vocabulary: cards (was "grid"), list (was "compact"), table. */
  const [viewMode, setViewMode] = usePersistedViewMode("pos-catalog", "cards");
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId],
  );

  // Filter States
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [selectedOrigin, setSelectedOrigin] = useState("");
  const [selectedQuality, setSelectedQuality] = useState("");
  const [selectedMake, setSelectedMake] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paid, setPaid] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [paidManuallyEdited, setPaidManuallyEdited] = useState(false);
  const [note, setNote] = useState("");
  /** Transfer reference — appended to the note on submit; no DB column needed. */
  const [transferRef, setTransferRef] = useState("");
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Mobile workspace: catalogue is never mounted behind the cart on phones.
  const isDesktop = useIsDesktop();
  // Keyboard-only operation: the checkout column is one navigation scope, so
  // arrows/Enter walk method → reference → paid → discount → note → pay without
  // ever touching the pointer. The product catalogue is deliberately outside it.
  const posFormScopeRef = useFormNavigationScope<HTMLDivElement>();
  const isTouchDevice = useMediaQuery("(pointer: coarse)");
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

  const [postSaleRequest, setPostSaleRequest] = useState<PrintRequest | null>(null);

  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitEditorOpen, setSplitEditorOpen] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPaymentLine[]>([]);
  const [splitValues, setSplitValues] = useState<SplitPaymentValues>({
    cash: 0,
    credit: 0,
    bank_transfer: 0,
    mobile_money: 0,
  });

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
  const [barcodeReaderEnabled, setBarcodeReaderEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("pos_barcode_reader_enabled") !== "false";
  });

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

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "company_settings" },
      (payload) => {
        const settings = payload.new as any;
        if (settings.enable_pos_service_fee !== undefined) {
          setEnableServiceFeeSetting(Boolean(settings.enable_pos_service_fee));
          localStorage.setItem("pos_enable_service_fee", String(settings.enable_pos_service_fee));
        }
        setCompanySettings(settings);
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
        // «عميل نقدي» المزروع (seeds/01_system/09_essential_partners) يظهر هنا
        // كأي عميل — النظام واحد، والبيع الفوري يُسجَّل عليه فعلاً بدل NULL.
        // (بند 5 في 05_خطة_التكامل_الشامل.md)
        supabase
          .from("customers")
          .select("id,name,phone,balance,credit_limit,is_system")
          .order("name"),
        (supabase.from("products") as any)
          .select(
            "id,sku,barcode,name,name_ar,sale_price,tax_rate,image_url,category_id,brand_id,unit_id,origin_id,quality_grade_id,is_active,is_service,item_nature,inventory_policy",
          )
          // خدمة الطحن لا تباع من POS: تحتاج بيانات الاستلام والأكياس والأمانة
          // الموجودة حصراً في كاونتر المطحنة. تظل الخدمة الحرة في زرها المخصص.
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

      const ws = wsRes.status === "fulfilled" ? wsRes.value.data : null;
      const cs = csRes.status === "fulfilled" ? csRes.value.data : null;
      const ps = psRes.status === "fulfilled" ? psRes.value.data : null;
      const cats = catsRes.status === "fulfilled" ? catsRes.value.data : null;
      const brs = brsRes.status === "fulfilled" ? brsRes.value.data : null;
      const uns = unsRes.status === "fulfilled" ? unsRes.value.data : null;
      const origs = origsRes.status === "fulfilled" ? origsRes.value.data : [];
      const quals = qualsRes.status === "fulfilled" ? qualsRes.value.data : [];
      const vMakes = vMakesRes.status === "fulfilled" ? vMakesRes.value.data : [];
      const vModels = vModelsRes.status === "fulfilled" ? vModelsRes.value.data : [];
      const compats = compatsRes.status === "fulfilled" ? compatsRes.value.data : [];

      const loadedWarehouses = ws ?? [];
      const loadedCustomers = cs ?? [];
      setWarehouses(loadedWarehouses);
      setCustomers(loadedCustomers);

      // اختيار العميل النقدي الحقيقي المعتمد من قاعدة البيانات تلقائياً
      const dbCash = loadedCustomers.find((c) => c.name === "عميل نقدي" || (c as any).is_system);
      if (dbCash && !customerId) {
        setCustomerId(dbCash.id);
      }

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

    const matchingProducts = products.filter((p) => {
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

    return [...matchingProducts].sort((a, b) => {
      switch (catalogSort) {
        case "name_desc":
          return (b.name_ar || b.name).localeCompare(a.name_ar || a.name, lang);
        case "price_asc":
          return Number(a.sale_price) - Number(b.sale_price);
        case "price_desc":
          return Number(b.sale_price) - Number(a.sale_price);
        case "stock_asc":
          return (stockMap[a.id] ?? 0) - (stockMap[b.id] ?? 0);
        case "stock_desc":
          return (stockMap[b.id] ?? 0) - (stockMap[a.id] ?? 0);
        default:
          return (a.name_ar || a.name).localeCompare(b.name_ar || b.name, lang);
      }
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
    catalogSort,
    stockMap,
    lang,
  ]);

  const tableRows = useMemo(() => {
    const label = (product: Product, key: string): string | number => {
      if (key === "code") return product.barcode || product.sku || "";
      if (key === "stock") return stockMap[product.id] ?? 0;
      if (key === "price") return Number(product.sale_price) || 0;
      if (key === "category") {
        const category =
          lang === "ar"
            ? product.category?.name_ar || product.category?.name
            : product.category?.name || product.category?.name_ar;
        const brand = product.brand
          ? lang === "ar"
            ? product.brand.name_ar || product.brand.name
            : product.brand.name || product.brand.name_ar
          : "";
        return `${category ?? ""} ${brand}`.trim();
      }
      return lang === "ar"
        ? product.name_ar || product.name
        : product.name || product.name_ar || "";
    };
    const direction = catalogTableSort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = label(a, catalogTableSort.key);
      const right = label(b, catalogTableSort.key);
      return typeof left === "number" && typeof right === "number"
        ? (left - right) * direction
        : String(left).localeCompare(String(right), lang, { numeric: true, sensitivity: "base" }) *
            direction;
    });
  }, [filtered, catalogTableSort, stockMap, lang]);

  function addToCart(
    p: Product,
    selectedBatch?: { id: string; batch_number: string; expiry_date: string | null } | null,
  ) {
    const prodName = lang === "ar" && p.name_ar ? p.name_ar : p.name;
    const isService = p.is_service === true;

    if (!isService) {
      // التحقق من سياسة المخزون وتتبع الدفعات (BATCH):
      const isBatchTracked =
        p.tracking === "BATCH" ||
        p.inventory_policy === "BATCH" ||
        (batchSettings?.enforce_batch_selection_on_pos &&
          (p.tracking === "BATCH" || p.inventory_policy === "BATCH"));

      if (isBatchTracked && selectedBatch === undefined) {
        if (!warehouseId) {
          toast.error(
            lang === "ar"
              ? "يرجى اختيار المستودع أولاً لاختيار الدفعة"
              : "Please select a warehouse first to choose a batch",
          );
          return;
        }
        setBatchPendingProduct(p);
        setBatchModalOpen(true);
        return;
      }

      const stock = stockMap[p.id] ?? 0;
      if (stock <= 0) {
        return toast.error(
          lang === "ar" ? `نفد المخزون من: ${prodName}` : `${p.name} ${t("pos.out_of_stock")}`,
        );
      }

      const batchId = selectedBatch?.id ?? null;
      const batchNumber = selectedBatch?.batch_number ?? null;
      const expiryDate = selectedBatch?.expiry_date ?? null;

      setCart((c) => {
        const existing = c.find((l) => l.product_id === p.id && (l.batch_id || null) === batchId);
        if (existing) {
          if (existing.quantity >= stock) {
            toast.error(
              lang === "ar"
                ? `الحد الأقصى المتاح في المخزون: ${stock}`
                : `${t("pos.max_stock")}: ${stock}`,
            );
            return c;
          }
          return c.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
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
            batch_id: batchId,
            batch_number: batchNumber,
            expiry_date: expiryDate,
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
    // Enter في حقل البحث يعمل كمسح مباشر فقط عندما يكون الباركود مفعّلاً؛
    // وإلا يُترك للبحث العادي.
    if (!catalogConfig.enableBarcode) return;
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
    // عندما يكون قارئ الباركود معطلاً من الإعدادات لا نعالج التقاطات القارئ
    // الشبكي/البلوتوث إطلاقاً — الإعداد يقود السلوك الفعلي لا الزر وحده.
    if (!catalogConfig.enableBarcode) return;
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
  // and is disabled while the camera dialog is open or the barcode reader is
  // switched off in settings.
  useKeyboardWedge({
    onScan: handleWedgeCode,
    disabled: scannerOpen || !catalogConfig.enableBarcode || !barcodeReaderEnabled,
  });

  // Financial Computations with strict 2-decimal precision
  const subtotal = Math.round(cart.reduce((s, l) => s + l.unit_price * l.quantity, 0) * 100) / 100;
  const taxTotal =
    Math.round(cart.reduce((s, l) => s + l.unit_price * l.quantity * (l.tax_rate / 100), 0) * 100) /
    100;
  const discountN = Math.round(Number(discount || 0) * 100) / 100;
  const total = Math.max(0, Math.round((subtotal + taxTotal - discountN) * 100) / 100);

  const supportedSplitMethods = useMemo(
    () =>
      posPaymentMethods.filter(
        (method) =>
          !method.isCreditTerm &&
          ["cash", "card", "bank_transfer", "mobile_money", "cheque"].includes(method.legacyValue),
      ),
    [posPaymentMethods],
  );
  const splitRows = useMemo(
    () =>
      splitPayments
        .map((line) => ({
          ...line,
          method: supportedSplitMethods.find((method) => method.id === line.methodId),
          amount: Math.max(0, Number(line.amount) || 0),
        }))
        .filter((line) => line.method && line.amount > 0),
    [splitPayments, supportedSplitMethods],
  );
  const splitPaidTotal =
    Math.round(splitRows.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const splitMethodCount = splitRows.length;
  const hasInvalidSplitLine =
    isSplitPayment &&
    splitPayments.some((line) => !Number.isFinite(Number(line.amount)) || Number(line.amount) <= 0);
  const missingSplitReference =
    isSplitPayment &&
    splitRows.some((line) => line.method?.requiresReference && !line.reference?.trim());
  const paymentSplits = splitRows.map((line) => ({
    method: line.method!.legacyValue,
    amount: Math.round(line.amount * 100) / 100,
  }));

  function startSplitPayment() {
    setSplitEditorOpen(true);
  }

  function addSplitPaymentLine() {
    const usedLegacyValues = new Set(
      splitPayments
        .map(
          (line) =>
            supportedSplitMethods.find((method) => method.id === line.methodId)?.legacyValue,
        )
        .filter(Boolean),
    );
    const nextMethod = supportedSplitMethods.find(
      (method) => !usedLegacyValues.has(method.legacyValue),
    );
    if (!nextMethod) return;
    setSplitPayments((current) => [
      ...current,
      { key: crypto.randomUUID(), methodId: nextMethod.id, amount: "", autoAmount: false },
    ]);
  }

  function updateSplitPayment(key: string, patch: Partial<SplitPaymentLine>) {
    setSplitPayments((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  useEffect(() => {
    setSplitPayments((current) =>
      current.map((line) => (line.autoAmount ? { ...line, amount: String(total) } : line)),
    );
  }, [total]);

  function removeSplitPayment(key: string) {
    setSplitPayments((current) => current.filter((line) => line.key !== key));
  }

  // Auto-Paid & Smart Payment Logic
  // إذا كانت وسيلة الدفع "آجل" وترك حقل المدفوع فارغاً، فالافتراضي هو 0 (دين بالكامل)
  // أما في الوسائل الأخرى (نقدي/بطاقة/تحويل/محفظة)، فالفارغ يعني سداد كامل المبلغ تلقائياً
  const singlePaidNum = resolvePaidAmount(total, paymentMethod, paid, paidManuallyEdited);
  const effectivePaid = isSplitPayment ? splitPaidTotal : singlePaidNum;
  const isOverpaid = effectivePaid > total;
  const remainingDebt = Math.max(0, Math.round((total - effectivePaid) * 100) / 100);

  // P1-4: the shared engine's verdict on the NON-split payment. The till keeps
  // its own split allocation (two tenders by design), but a single tender now
  // obeys exactly the same rules as the sales invoice and the milling counter:
  // debt needs a real customer, and the system cash customer cannot hold debt.
  const singlePayment = usePaymentPanel({
    total,
    state: { method: paymentMethod, paidRaw: paid, customerId },
    customers,
  });
  const selectedSingleMethod = posPaymentMethods.find((method) => method.id === paymentMethod);
  const splitDebtBlockReason =
    isSplitPayment && remainingDebt > 0
      ? !customerId
        ? lang === "ar"
          ? "اختر عميلاً لتسجيل المبلغ المتبقي كدين"
          : "Select a customer for the remaining balance"
        : selectedCustomer?.is_system
          ? lang === "ar"
            ? "لا يمكن تسجيل دين على العميل النقدي"
            : "The cash customer cannot carry a balance"
          : selectedCustomer?.credit_limit != null &&
              Number(selectedCustomer.balance ?? 0) + remainingDebt >
                Number(selectedCustomer.credit_limit)
            ? lang === "ar"
              ? "المبلغ المتبقي يتجاوز حد ائتمان العميل"
              : "The remaining balance exceeds the customer's credit limit"
            : null
      : null;

  function handlePaidChange(val: string) {
    setPaid(val);
    setPaidManuallyEdited(true);
  }

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        // لا يُفتح قارئ الكاميرا عندما يكون الباركود معطلاً من الإعدادات.
        if (!catalogConfig.enableBarcode) return;
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
    catalogConfig.enableBarcode,
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
          ? "مجموع المدفوع أكبر من إجمالي الفاتورة"
          : "Total paid cannot exceed invoice total",
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
    // Same guard the invoice form and the server apply: the seeded cash
    // customer exists to settle, never to owe.
    if (!isSplitPayment && !singlePayment.isPayable) {
      const paymentError =
        singlePayment.blockingReason === "credit_method_requires_zero_paid"
          ? lang === "ar"
            ? "الآجل لا يسجل مبلغًا مدفوعًا. للسداد الجزئي اختر وسيلة التحصيل الفعلية مثل النقد أو التحويل."
            : "Credit records no payment. For a partial payment, choose the actual tender method, such as cash or bank transfer."
          : null;
      return toast.error(
        paymentError ??
          singlePayment.blockingReason ??
          (lang === "ar" ? "بيانات الدفع غير صالحة" : "Invalid payment details"),
      );
    }
    if (!isSplitPayment && selectedSingleMethod?.requiresReference && !transferRef.trim()) {
      return toast.error(
        lang === "ar"
          ? `مرجع الدفع مطلوب: ${selectedSingleMethod.nameAr}`
          : `Payment reference required: ${selectedSingleMethod.nameEn || selectedSingleMethod.nameAr}`,
      );
    }
    if (isSplitPayment && splitMethodCount === 0) {
      return toast.error(
        lang === "ar"
          ? "يرجى توزيع مبلغ الدفع على وسيلة واحدة على الأقل"
          : "Please allocate the payment to at least one method",
      );
    }
    if (hasInvalidSplitLine) {
      return toast.error(
        lang === "ar"
          ? "أدخل مبلغاً موجباً لكل طريقة دفع مضافة"
          : "Enter a positive amount for each added payment method",
      );
    }
    if (missingSplitReference) {
      return toast.error(
        lang === "ar"
          ? "أدخل مرجع كل طريقة دفع تتطلب رقماً مرجعياً"
          : "Enter a reference for each payment method that requires one",
      );
    }
    if (splitDebtBlockReason) return toast.error(splitDebtBlockReason);

    setLoading(true);
    try {
      // Split allocations always go through the guarded split RPC overload.
      // The individual tender methods are stored in customer_payment_splits.
      let finalMethod: string = isSplitPayment
        ? "split"
        : (selectedSingleMethod?.legacyValue ?? paymentMethod);

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
      let splitNote = "";
      if (isSplitPayment) {
        const parts = splitRows.map((line) => `${line.method!.nameAr}: ${money(line.amount)}`);
        if (remainingDebt > 0)
          parts.push(`${lang === "ar" ? "آجل" : "Debt"}: ${money(remainingDebt)}`);
        splitNote = `[${lang === "ar" ? "الدفع بأكثر من طريقة" : "Split"}: ${parts.join(" | ")}]`;
      }

      const finalNote = (() => {
        const parts: string[] = [];
        if (note.trim()) parts.push(note.trim());
        if (isSplitPayment) {
          for (const line of splitPayments) {
            const method = supportedSplitMethods.find((item) => item.id === line.methodId);
            if (method?.requiresReference && line.reference?.trim()) {
              parts.push(`${method.nameAr}: ${line.reference.trim()}`);
            }
          }
        }
        // Electronic references are carried in the existing note field; this
        // preserves the RPC/offline contract while keeping the cashier context.
        if (
          (finalMethod === "bank_transfer" ||
            finalMethod === "mobile_money" ||
            selectedSingleMethod?.requiresReference ||
            paymentMethod === "bank_transfer" ||
            paymentMethod === "mobile_money") &&
          transferRef.trim()
        ) {
          const electronicLabel = selectedSingleMethod?.requiresReference
            ? selectedSingleMethod.nameAr
            : finalMethod === "mobile_money" || paymentMethod === "mobile_money"
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

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error(
          lang === "ar"
            ? "نقطة البيع تحتاج اتصالاً لإصدار فاتورة رسمية. لم يُحفظ أي بيع محلياً."
            : "POS requires a connection to issue an official invoice. No local sale was saved.",
        );
      }

      try {
        const { data, error } = await supabase.rpc("create_sale", {
          _warehouse_id: warehouseId,
          _customer_id: (customerId || null) as any,
          _payment_method: finalMethod as any,
          _paid: Math.min(Math.max(effectivePaid, 0), total),
          _discount: discountN,
          _note: finalNote as any,
          _sale_date: saleDate,
          _payment_splits: (isSplitPayment
            ? paymentSplits
            : finalMethod === "cheque" && effectivePaid > 0
              ? [{ method: "cheque", amount: Math.min(effectivePaid, total) }]
              : []) as any,
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
        // P1-4: كل خطأ من RPC يمر بطبقة الترجمة الموحدة قبل أن يراه الكاشير.
        throw new Error(
          translateRpcError(
            netErr,
            lang === "ar" ? "ar" : "en",
            lang === "ar"
              ? "تعذر إصدار الفاتورة. لم يُحفظ أو يُخصم أي بيع محلياً."
              : "Could not issue the invoice. No local sale was saved or deducted.",
          ),
        );
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

      const printSettings = getUnifiedPrintSettings();
      const printOverride = printSettings.overrides.customer_invoice;
      const printBehavior = printOverride?.behavior ?? printSettings.behavior;
      const printRequest: PrintRequest = {
        documentType: "customer_invoice",
        rtl: lang === "ar",
        templateId: printOverride?.templateId,
        theme: printOverride?.theme,
        paperId: printOverride?.paperId,
        orientation: printOverride?.orientation,
        method: printOverride?.method,
        showBarcode: printOverride?.showBarcode,
        showQrCode: printOverride?.showQrCode,
        showSignatures: printOverride?.showSignatures,
        doc: {
          docType: "customer_invoice",
          title: invoiceDoc.title,
          number: invoiceDoc.number,
          date: invoiceDoc.date,
          partyLabel: invoiceDoc.partyLabel,
          partyName: invoiceDoc.partyName,
          partyPhone: invoiceDoc.partyPhone,
          warehouse: invoiceDoc.warehouse,
          payment: invoiceDoc.payment,
          status: invoiceDoc.status,
          subtotal: invoiceDoc.subtotal,
          tax: invoiceDoc.tax,
          discount: invoiceDoc.discount,
          total: invoiceDoc.total,
          paid: invoiceDoc.paid,
          balance: remainingDebt,
          currency: invoiceDoc.currency,
          notes: invoiceDoc.notes,
          company: invoiceDoc.company,
          lines: invoiceDoc.lines.map((line) => ({
            product: line.product,
            qty: line.qty,
            price: line.price,
            total: line.total,
          })),
        },
      };

      if (printBehavior === "direct" || (printBehavior === "default" && !printSettings.preview)) {
        void printUnifiedDocument(printRequest);
      } else if (printBehavior !== "off") {
        setPostSaleRequest(printRequest);
      }

      setCart([]);
      setPaid("");
      setPaidManuallyEdited(false);
      setDiscount("");
      setNote("");
      setTransferRef("");
      setIsSplitPayment(false);
      setSplitPayments([]);
      setSplitValues({ cash: 0, credit: 0, bank_transfer: 0, mobile_money: 0 });
      const defaultCashCust = customers.find((c) => c.name === "عميل نقدي" || (c as any).is_system);
      if (defaultCashCust) setCustomerId(defaultCashCust.id);
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
      {/* ─── Compact Executive POS Workspace Shell ─── */}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--primary)_8%,transparent),transparent_48%)] p-0.5 sm:gap-2 sm:p-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(390px,450px)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="hidden min-w-0 items-center justify-end gap-2 px-1 py-0.5 sm:flex lg:col-start-2 lg:row-start-1">
          {selectedCustomer &&
            (Number(selectedCustomer.balance) !== 0 ||
              Number(selectedCustomer.credit_limit) > 0) && (
              <div className="hidden min-w-0 shrink-0 items-center gap-2 rounded-lg border border-border/70 bg-surface/70 px-2 py-1 text-[10px] font-mono xl:flex">
                {Number(selectedCustomer.balance) > 0 ? (
                  <span className="font-bold text-amber-600">
                    {lang === "ar" ? "عليه دين:" : "Debt:"}{" "}
                    {money(Number(selectedCustomer.balance))}
                  </span>
                ) : Number(selectedCustomer.balance) < 0 ? (
                  <span className="font-bold text-emerald-600">
                    {lang === "ar" ? "له رصيد:" : "Credit:"}{" "}
                    {money(Math.abs(Number(selectedCustomer.balance)))}
                  </span>
                ) : null}
                {Number(selectedCustomer.credit_limit) > 0 && (
                  <span className="border-s border-border/60 ps-2 text-muted-foreground">
                    {lang === "ar" ? "الحد:" : "Limit:"}{" "}
                    {money(Number(selectedCustomer.credit_limit))}
                  </span>
                )}
              </div>
            )}
        </div>
        {/* ─── Top Executive Command Deck ─── */}
        <header className="flex min-w-0 shrink-0 items-center justify-between gap-1 overflow-x-auto overscroll-x-contain rounded-xl border border-border/80 bg-surface/95 px-1.5 py-1.5 shadow-xs backdrop-blur-md sm:gap-2 sm:px-3 sm:py-2 lg:col-start-1 lg:row-start-1">
          {/* Quick Command Controls: Customer, Balance, Date, Warehouse, Service */}
          <div className="flex w-full min-w-0 flex-1 items-center justify-between gap-1 sm:gap-1.5">
            {/* Customer Selector with VIP Badge */}
            <div className="flex min-w-0 flex-1 items-center gap-1 2xl:flex-none">
              <PartyPicker
                options={customers}
                value={customerId}
                onChange={setCustomerId}
                lang={lang}
                label={lang === "ar" ? "العميل" : "Customer"}
                emptyLabel={t("pos.walkin")}
                kind="customer"
                className="h-10 min-w-0 flex-1 rounded-2xl border-primary/20 bg-primary/[0.035] text-xs hover:border-primary/50 hover:bg-primary/[0.07]"
              />
              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary shadow-sm transition hover:border-primary/40 hover:bg-primary/15 active:scale-95"
                title={lang === "ar" ? "إضافة عميل جديد" : "Add customer"}
                aria-label={lang === "ar" ? "إضافة عميل جديد" : "Add customer"}
              >
                <UserPlus className="h-4 w-4" />
              </button>
            </div>

            {/* Warehouse Selector (if multi_warehouse) */}
            {isModuleEnabled("multi_warehouse") && warehouses.length > 1 && (
              <div className="relative flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 text-amber-700 transition hover:bg-amber-500/15 dark:text-amber-300 sm:h-9 xl:px-3">
                <WarehouseIcon className="size-3.5 shrink-0" />
                <select
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  aria-label={lang === "ar" ? "المستودع" : "Warehouse"}
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="h-full min-w-0 max-w-[5.5rem] cursor-pointer appearance-none bg-transparent pe-4 text-[10px] font-semibold outline-none sm:max-w-24 sm:text-[11px] xl:max-w-40 xl:pe-0 xl:text-xs"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar}
                    </option>
                  ))}
                </select>
                <span className="hidden shrink-0 text-[11px] font-medium xl:inline">
                  {lang === "ar" ? "المستو��ع" : "Warehouse"}
                </span>
                <ChevronDown className="pointer-events-none absolute end-1.5 top-1/2 size-3 -translate-y-1/2 text-amber-700 dark:text-amber-300 xl:hidden" />
              </div>
            )}
            <div className="flex shrink-0 items-center gap-1 2xl:contents">
              {/* Invoice Date */}
              <PosDatePicker
                value={saleDate}
                onChange={setSaleDate}
                lang={lang}
                label={lang === "ar" ? "تاريخ الفاتورة" : "Invoice date"}
              />

              {catalogConfig.enableBarcode &&
                (isDesktop && !isTouchDevice ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = !barcodeReaderEnabled;
                      setBarcodeReaderEnabled(next);
                      localStorage.setItem("pos_barcode_reader_enabled", String(next));
                    }}
                    aria-pressed={barcodeReaderEnabled}
                    title={
                      lang === "ar"
                        ? barcodeReaderEnabled
                          ? "إيقاف قارئ الباركود"
                          : "تفعيل قارئ الباركود"
                        : barcodeReaderEnabled
                          ? "Disable barcode reader"
                          : "Enable barcode reader"
                    }
                    className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 transition xl:w-auto xl:px-3 ${barcodeReaderEnabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-border bg-surface text-muted-foreground"}`}
                  >
                    <Barcode className="h-4 w-4" />
                    <span className="hidden text-[11px] font-semibold lg:inline">
                      {lang === "ar" ? "قارئ" : "Reader"}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    title={lang === "ar" ? "مسح بالكاميرا" : "Scan with camera"}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 text-primary transition hover:bg-primary/20 xl:w-auto xl:px-3"
                  >
                    <ScanBarcode className="h-4 w-4" />
                    <span className="hidden text-[11px] font-semibold lg:inline">
                      {lang === "ar" ? "مسح" : "Scan"}
                    </span>
                  </button>
                ))}

              {/* Custom Service Fee button */}
              {enableServiceFeeSetting && (
                <button
                  type="button"
                  onClick={() => setServiceOpen(true)}
                  className="hidden h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 text-violet-700 transition hover:bg-violet-500/20 dark:text-violet-300 lg:inline-flex"
                  title={lang === "ar" ? "إضافة خدمة أو أجرة تركيب" : "Add custom labor/service"}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold">
                    {lang === "ar" ? "خدمة" : "Service"}
                  </span>
                </button>
              )}

              {/* Page Guide */}
              <PageGuideButton config={posGuideConfig} className="!size-8 shrink-0 sm:!size-9" />
            </div>
          </div>
        </header>

        {/* ─── Main Content Split: Products Catalog (Desktop) & Cart (All) ─── */}
        <div className="grid min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)] items-stretch gap-0 sm:gap-2 lg:contents lg:row-start-2">
          {/* ─── Products Panel (Desktop & Tablet) ─── */}
          {isDesktop && (
            <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border/80 bg-surface/95 p-3 shadow-sm ring-1 ring-background/40 lg:col-start-1 lg:row-start-2">
              <RecordsToolbar
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder={
                  lang === "ar"
                    ? "ابحث باسم المنتج أو الرمز أو امسح الباركود (F2)"
                    : "Search by product name or SKU, or scan barcode (F2)"
                }
                resultCount={filtered.length}
                searchRef={searchRef}
                onSearchKeyDown={handleScan}
                activeFilterCount={activeFiltersCount}
                onFilterOpen={() => setFilterOpen(true)}
                onClearFilters={resetFilters}
                filterLabel={lang === "ar" ? "فلترة" : "Filter"}
                onSortOpen={() => setSortOpen(true)}
                sortActive={catalogSort !== "name_asc"}
                sortLabel={lang === "ar" ? "ترتيب" : "Sort"}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                viewModes={["cards", "list", "table"]}
                sticky={false}
                className="mb-2.5"
              />
              <RecordsSortPanel
                open={sortOpen}
                onClose={() => setSortOpen(false)}
                options={[
                  { value: "name_asc", label: lang === "ar" ? "الاسم: أ إلى ي" : "Name: A to Z" },
                  { value: "name_desc", label: lang === "ar" ? "الاسم: ي إلى أ" : "Name: Z to A" },
                  {
                    value: "price_asc",
                    label: lang === "ar" ? "السعر: الأقل أولاً" : "Price: low to high",
                  },
                  {
                    value: "price_desc",
                    label: lang === "ar" ? "السعر: الأعلى أولاً" : "Price: high to low",
                  },
                  {
                    value: "stock_asc",
                    label: lang === "ar" ? "المخزون: الأقل أولاً" : "Stock: low to high",
                  },
                  {
                    value: "stock_desc",
                    label: lang === "ar" ? "المخزون: الأعلى أولاً" : "Stock: high to low",
                  },
                ]}
                value={catalogSort}
                onSubmit={(value) => {
                  setCatalogSort(value || "name_asc");
                  setSortOpen(false);
                }}
              />

              {/* Quick Category Chips Bar */}
              {categories.length > 0 && (
                <div className="mb-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory("")}
                    className={`h-7 shrink-0 rounded-lg px-2.5 text-xs font-medium transition ${
                      selectedCategory === ""
                        ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                        : "bg-surface border border-border/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {lang === "ar" ? "الكل" : "All"} ({products.length})
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCategory((prev) => (prev === c.id ? "" : c.id))}
                      className={`h-7 shrink-0 rounded-lg px-2.5 text-xs font-medium transition ${
                        selectedCategory === c.id
                          ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                          : "bg-surface border border-border/80 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {lang === "ar" ? c.name_ar || c.name : c.name || c.name_ar}
                    </button>
                  ))}
                </div>
              )}

              {/* Expanded Filter Panel */}
              {filterOpen && (
                <div className="mb-3 rounded-2xl border border-border/80 bg-surface/95 p-3.5 shadow-md backdrop-blur-md transition-all">
                  <div className="mb-3 flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-primary" />
                      <span className="text-xs font-bold text-foreground">
                        {lang === "ar" ? "خيارات الفرز والتصفية المتقدمة" : "Advanced Filters"}
                      </span>
                      {activeFiltersCount > 0 && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary font-mono">
                          {activeFiltersCount} {lang === "ar" ? "نشط" : "active"}
                        </span>
                      )}
                    </div>
                    {activeFiltersCount > 0 && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-surface px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive active:scale-95"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>{t("common.reset_filters")}</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {/* Category */}
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                        {t("products.category")}
                      </label>
                      <select
                        aria-label={t("products.category")}
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="h-8 w-full rounded-lg border border-border/80 bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                      >
                        <option value="">
                          {lang === "ar" ? "كل التصنيفات" : "All categories"}
                        </option>
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
                        <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                          {t("products.brand")}
                        </label>
                        <select
                          aria-label={t("products.brand")}
                          value={selectedBrand}
                          onChange={(e) => setSelectedBrand(e.target.value)}
                          className="h-8 w-full rounded-lg border border-border/80 bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        >
                          <option value="">{lang === "ar" ? "كل الماركات" : "All brands"}</option>
                          {brands.map((b) => (
                            <option key={b.id} value={b.id}>
                              {lang === "ar" ? b.name_ar || b.name : b.name || b.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Unit */}
                    {catalogConfig.enableUnits && (
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                          {t("products.unit")}
                        </label>
                        <select
                          aria-label={t("products.unit")}
                          value={selectedUnit}
                          onChange={(e) => setSelectedUnit(e.target.value)}
                          className="h-8 w-full rounded-lg border border-border/80 bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        >
                          <option value="">{lang === "ar" ? "كل الوحدات" : "All units"}</option>
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {lang === "ar" ? u.name_ar || u.name : u.name || u.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Origin */}
                    {catalogConfig.enableOrigins && (
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                          {t("products.origin")}
                        </label>
                        <select
                          aria-label={t("products.origin")}
                          value={selectedOrigin}
                          onChange={(e) => setSelectedOrigin(e.target.value)}
                          className="h-8 w-full rounded-lg border border-border/80 bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        >
                          <option value="">{lang === "ar" ? "بلد المنشأ" : "All origins"}</option>
                          {origins.map((o) => (
                            <option key={o.id} value={o.id}>
                              {lang === "ar" ? o.name_ar || o.name : o.name || o.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Quality */}
                    {catalogConfig.enableQualityGrades && (
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                          {t("products.quality_grade")}
                        </label>
                        <select
                          aria-label={t("products.quality_grade")}
                          value={selectedQuality}
                          onChange={(e) => setSelectedQuality(e.target.value)}
                          className="h-8 w-full rounded-lg border border-border/80 bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        >
                          <option value="">{lang === "ar" ? "درجة الجودة" : "All grades"}</option>
                          {qualities.map((q) => (
                            <option key={q.id} value={q.id}>
                              {lang === "ar" ? q.name_ar || q.name : q.name || q.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Vehicle Make */}
                    {catalogConfig.enableMakesAndModels && (
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                          {t("products.vehicle_make")}
                        </label>
                        <select
                          aria-label={t("products.vehicle_make")}
                          value={selectedMake}
                          onChange={(e) => handleMakeChange(e.target.value)}
                          className="h-8 w-full rounded-lg border border-border/80 bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        >
                          <option value="">{lang === "ar" ? "كل الشركات" : "All makes"}</option>
                          {makes.map((m) => (
                            <option key={m.id} value={m.id}>
                              {lang === "ar" ? m.name_ar || m.name : m.name || m.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Vehicle Model */}
                    {catalogConfig.enableMakesAndModels && (
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                          {t("products.vehicle_model")}
                        </label>
                        <select
                          aria-label={t("products.vehicle_model")}
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          disabled={!selectedMake && models.length > 20}
                          className="h-8 w-full rounded-lg border border-border/80 bg-surface px-2 text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
                        >
                          <option value="">{lang === "ar" ? "كل الموديلات" : "All models"}</option>
                          {availableModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {lang === "ar" ? m.name_ar || m.name : m.name || m.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─── Product Catalog Body: Three Distinct View Modes ─── */}
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-2">
                {filtered.length === 0 ? (
                  <div className="grid place-items-center py-20 text-center text-sm text-muted-foreground">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-surface mb-3 shadow-xs">
                      <ScanBarcode className="h-7 w-7 opacity-60 text-primary" />
                    </div>
                    <div className="font-bold text-foreground">{t("pos.no_products")}</div>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      {lang === "ar"
                        ? "لم يتم العثور على أي منتج يطابق معايير البحث أو التصفية الحالية"
                        : "No products matched your current search or filter criteria"}
                    </p>
                    {activeFiltersCount > 0 && (
                      <button
                        onClick={resetFilters}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline underline-offset-4 hover:opacity-80"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {lang === "ar" ? "إلغاء التصفية وإظهار الكل" : "Clear filters and show all"}
                      </button>
                    )}
                  </div>
                ) : viewMode === "cards" ? (
                  /* ─── Mode 1: Luxury Grid Cards ─── */
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5">
                    {filtered.map((p) => {
                      const stock = stockMap[p.id] ?? 0;
                      const low = p.is_service !== true && stock <= 0;
                      const catLabel =
                        lang === "ar"
                          ? p.category?.name_ar || p.category?.name
                          : p.category?.name || p.category?.name_ar;
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
                          className="group relative flex flex-col items-start justify-between gap-2 rounded-2xl border border-border/80 bg-white p-2.5 text-start transition-all duration-150 hover:border-primary/50 hover:shadow-md active:scale-[0.98] disabled:opacity-40 dark:bg-card"
                        >
                          <div className="w-full">
                            {/* Tags Strip */}
                            <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[10px] leading-none">
                              {/* Quality */}
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
                                </span>
                              )}

                              {/* Brand / Category */}
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

                              {/* Vehicle Fitment */}
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
                            <div className="line-clamp-2 text-xs sm:text-sm font-bold text-foreground group-hover:text-primary transition-colors leading-snug">
                              {lang === "ar" && p.name_ar ? p.name_ar : p.name}
                            </div>
                          </div>

                          {/* Price & Stock */}
                          <div className="mt-2 flex w-full items-center justify-between border-t border-border/40 pt-1.5">
                            <span className="text-xs sm:text-sm font-black text-primary font-mono [unicode-bidi:isolate]">
                              {money(Number(p.sale_price))}
                            </span>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
                                low
                                  ? "bg-destructive/15 text-destructive font-bold"
                                  : stock <= 5
                                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
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
                  </div>
                ) : viewMode === "list" ? (
                  /* ─── Mode 2: Compact Cashier List ─── */
                  <div className="space-y-1.5">
                    {filtered.map((p) => {
                      const stock = stockMap[p.id] ?? 0;
                      const low = p.is_service !== true && stock <= 0;
                      const catLabel =
                        lang === "ar"
                          ? p.category?.name_ar || p.category?.name
                          : p.category?.name || p.category?.name_ar;

                      return (
                        <div
                          key={p.id}
                          className="group flex items-center justify-between gap-2.5 rounded-xl border border-border/70 bg-white p-2 transition-all hover:border-primary/50 hover:shadow-xs dark:bg-card"
                        >
                          {/* Code / Barcode */}
                          {(p.barcode || p.sku) && (
                            <span className="hidden sm:inline-block rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shrink-0">
                              {p.barcode || p.sku}
                            </span>
                          )}

                          {/* Name & Category */}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                              {lang === "ar" && p.name_ar ? p.name_ar : p.name}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              {catLabel && (
                                <span className="truncate max-w-[120px]">{catLabel}</span>
                              )}
                              {p.brand && (
                                <span className="text-primary font-medium truncate max-w-[100px]">
                                  {lang === "ar" ? p.brand.name_ar || p.brand.name : p.brand.name}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Stock */}
                          <div className="shrink-0 text-end">
                            <span
                              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                                low
                                  ? "bg-destructive/15 text-destructive"
                                  : stock <= 5
                                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                    : "bg-muted/70 text-muted-foreground"
                              }`}
                            >
                              {low ? (lang === "ar" ? "نفد" : "0") : `${stock}`}
                            </span>
                          </div>

                          {/* Price */}
                          <div className="shrink-0 text-end font-mono text-xs sm:text-sm font-extrabold text-primary min-w-[4.5rem] [unicode-bidi:isolate]">
                            {money(Number(p.sale_price))}
                          </div>

                          {/* Quick Add Button */}
                          <button
                            type="button"
                            disabled={low}
                            onClick={() => addToCart(p)}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition hover:bg-primary hover:text-primary-foreground active:scale-90 disabled:opacity-30"
                            title={t("pos.add_to_cart")}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* ─── Mode 3: High Density Classic Table ─── */
                  <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
                    <table className="w-full text-start text-xs">
                      <thead>
                        <tr className="border-b border-border/80 bg-muted/50 text-[11px] font-bold text-muted-foreground">
                          {(
                            [
                              {
                                key: "code",
                                label: lang === "ar" ? "الباركود / الرمز" : "Barcode / SKU",
                                align: "start",
                              },
                              {
                                key: "name",
                                label: lang === "ar" ? "اسم المنتج" : "Product Name",
                                align: "start",
                              },
                              {
                                key: "category",
                                label: lang === "ar" ? "التصنيف والماركة" : "Category & Brand",
                                align: "start",
                              },
                              {
                                key: "stock",
                                label: lang === "ar" ? "المتوفر" : "Stock",
                                align: "center",
                              },
                              {
                                key: "price",
                                label: lang === "ar" ? "سعر البيع" : "Price",
                                align: "end",
                              },
                            ] as const
                          ).map((column) => {
                            const active = catalogTableSort.key === column.key;
                            const sortLabel = active
                              ? catalogTableSort.direction === "asc"
                                ? lang === "ar"
                                  ? "تصاعدي"
                                  : "ascending"
                                : lang === "ar"
                                  ? "تنازلي"
                                  : "descending"
                              : lang === "ar"
                                ? "غير مرتب"
                                : "not sorted";
                            return (
                              <th
                                key={column.key}
                                aria-sort={
                                  active
                                    ? catalogTableSort.direction === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                                className={`py-2 px-3 ${column.align === "end" ? "text-end" : column.align === "center" ? "text-center" : "text-start"}`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCatalogTableSort((current) => ({
                                      key: column.key,
                                      direction:
                                        current.key === column.key && current.direction === "asc"
                                          ? "desc"
                                          : "asc",
                                    }))
                                  }
                                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-1 transition hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                  title={`${column.label} · ${sortLabel}`}
                                >
                                  {column.label}
                                  {active ? (
                                    catalogTableSort.direction === "asc" ? (
                                      <ArrowUp className="size-3 text-primary" aria-hidden />
                                    ) : (
                                      <ArrowDown className="size-3 text-primary" aria-hidden />
                                    )
                                  ) : (
                                    <ArrowDownUp className="size-3 opacity-40" aria-hidden />
                                  )}
                                </button>
                              </th>
                            );
                          })}
                          <th className="py-2 px-3 text-center">
                            {lang === "ar" ? "إجراء" : "Action"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {tableRows.map((p) => {
                          const stock = stockMap[p.id] ?? 0;
                          const low = p.is_service !== true && stock <= 0;
                          const catLabel =
                            lang === "ar"
                              ? p.category?.name_ar || p.category?.name
                              : p.category?.name || p.category?.name_ar;

                          return (
                            <tr
                              key={p.id}
                              onClick={() => !low && addToCart(p)}
                              className={`cursor-pointer transition hover:bg-primary/[0.04] ${
                                low ? "opacity-40 cursor-not-allowed" : ""
                              }`}
                            >
                              <td className="py-2 px-3 font-mono text-[11px] text-muted-foreground">
                                {p.barcode || p.sku || "—"}
                              </td>
                              <td className="py-2 px-3 font-semibold text-foreground">
                                {lang === "ar" && p.name_ar ? p.name_ar : p.name}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {catLabel || "—"}
                                {p.brand &&
                                  ` · ${lang === "ar" ? p.brand.name_ar || p.brand.name : p.brand.name}`}
                              </td>
                              <td className="py-2 px-3 text-center font-mono font-semibold">
                                <span
                                  className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                                    low
                                      ? "bg-destructive/15 text-destructive"
                                      : stock <= 5
                                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                        : "bg-muted/70 text-foreground"
                                  }`}
                                >
                                  {low ? (lang === "ar" ? "نفد" : "0") : stock}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-end font-mono font-bold text-primary [unicode-bidi:isolate]">
                                {money(Number(p.sale_price))}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  disabled={low}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addToCart(p);
                                  }}
                                  className="inline-grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground active:scale-90 transition disabled:opacity-30"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Cart Panel (Primary Workspace on All Devices) ─── */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-primary/20 bg-surface/95 p-2 shadow-xl ring-1 ring-border/50 backdrop-blur-md sm:rounded-3xl sm:p-2.5 lg:col-start-2 lg:row-start-1 lg:row-span-2">
            {/* Cart Header */}
            <div className="mb-1 flex shrink-0 items-center justify-between border-b border-border/60 px-1 pb-1.5">
              <div className="flex items-center gap-2">
                <div className="grid size-7 place-items-center rounded-full bg-primary/10 text-primary">
                  <ShoppingCart className="h-4 w-4" />
                </div>
                <h2 className="flex items-center gap-2 text-xs sm:text-sm font-bold text-foreground">
                  <span>{t("pos.cart")}</span>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-mono font-extrabold text-primary">
                    {cart.length} {lang === "ar" ? "أصناف" : "items"}
                  </span>
                </h2>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (cart.length === 0) {
                      toast.error(lang === "ar" ? "أضف أصنافاً للسلة أولاً" : "Add items to cart first");
                      return;
                    }
                    startSplitPayment();
                  }}
                  disabled={cart.length === 0}
                  aria-pressed={isSplitPayment}
                  aria-label={lang === "ar" ? "الدفع بأكثر من طريقة (دفع مجزأ)" : "Split payment"}
                  title={
                    lang === "ar"
                      ? "الدفع بأكثر من طريقة (دفع مجزأ)"
                      : "Split payment"
                  }
                  className={`grid size-8 place-items-center rounded-full border transition disabled:opacity-40 ${isSplitPayment ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}
                >
                  <Layers className="size-4" />
                </button>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCart([]);
                      setIsSplitPayment(false);
                      setSplitPayments([]);
                      setSplitValues({ cash: 0, credit: 0, bank_transfer: 0, mobile_money: 0 });
                      const defaultCashCust = customers.find((c) => c.name === "عميل نقدي" || (c as any).is_system);
                      if (defaultCashCust) setCustomerId(defaultCashCust.id);
                      toast.success(lang === "ar" ? "تم تفريغ السلة" : "Cart cleared");
                    }}
                    className="grid size-8 shrink-0 place-items-center rounded-full border border-destructive/20 text-destructive transition hover:bg-destructive/10 active:scale-95"
                    title={lang === "ar" ? "تفريغ سلة المبيعات" : "Clear Cart"}
                    aria-label={lang === "ar" ? "تفريغ سلة المبيعات" : "Clear Cart"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                {!isDesktop && (
                  <button
                    type="button"
                    onClick={() => setMobilePickerOpen(true)}
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm active:scale-95"
                    title={t("pos.add_product")}
                    aria-label={t("pos.add_product")}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Product rows scroll while payment controls stay anchored below. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 pb-2">
              <div className="space-y-1">
                {cart.length === 0 ? (
                  <div className="grid place-items-center py-12 text-center text-muted-foreground">
                    <div className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-muted/40 mb-2">
                      <ShoppingCart className="h-6 w-6 opacity-40 text-primary" />
                    </div>
                    <div className="text-xs font-bold text-foreground">
                      {lang === "ar" ? "سلة المبيعات فارغة" : "Cart is empty"}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {isDesktop
                        ? lang === "ar"
                          ? "اختر من الفهرس أو امسح الباركود لإضافة الأصناف"
                          : "Click products from catalogue or scan barcode"
                        : lang === "ar"
                          ? "اضغط على زر إضافة منتج للبحث والإضافة"
                          : "Tap add product to search"}
                    </p>
                    {!isDesktop && (
                      <button
                        type="button"
                        onClick={() => setMobilePickerOpen(true)}
                        className="mt-3 grid size-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm active:scale-95"
                        title={t("pos.add_product")}
                      >
                        <Plus className="h-4 w-4" />
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
                      onRemove={() =>
                        setCart((c) => c.filter((x) => x.product_id !== l.product_id))
                      }
                    />
                  ))
                )}
              </div>
            </div>

            {/* Fixed payment, totals, and note footer */}
            {/* data-form-nav-scope: the counter's keyboard order. Tab and Enter
                walk method → reference → paid → discount → note → pay, so no
                mouse is needed. See src/lib/keyboard/form-navigation.ts. */}
            <div
              ref={posFormScopeRef}
              data-form-nav-scope
              className="max-h-[56dvh] shrink-0 space-y-1.5 overflow-y-auto overscroll-contain border-t border-border/70 bg-surface/95 pt-2 pr-0.5"
            >
              {/* ─── Payment & Summary Section ─── */}
              <div className="grid min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.8fr)] items-end gap-1.5">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[10px] font-semibold leading-none text-muted-foreground">
                    {lang === "ar" ? "طريقة الدفع" : "Payment method"}
                  </span>
                  <DynamicPaymentSelector
                    context="pos"
                    value={isSplitPayment ? "split" : paymentMethod}
                    settlement={settlement}
                    onSettlementChange={setSettlement}
                    compact
                    allowSplit={true}
                    onSplitClick={() => startSplitPayment()}
                    onChange={(method) => {
                      if (method === "split") {
                        startSplitPayment();
                        return;
                      }
                      setIsSplitPayment(false);
                      setSplitPayments([]);
                      setSplitValues({ cash: 0, credit: 0, bank_transfer: 0, mobile_money: 0 });
                      setPaymentMethod(method);
                      setSettlement((current) => ({ ...current, method }));
                      setPaid(method === "credit" ? "0" : "");
                      setPaidManuallyEdited(false);
                    }}
                    disabled={loading}
                    className="col-span-1 sm:col-span-2"
                  />
                </div>
                {isSplitPayment ? (
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-[10px] font-semibold leading-none text-muted-foreground">
                      {lang === "ar" ? "المبلغ المدفوع" : "Amount paid"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSplitEditorOpen(true)}
                      className="h-8 min-w-0 truncate rounded-lg border border-primary/20 bg-primary/[0.04] px-2.5 text-start text-[10px] font-medium text-primary"
                      title={lang === "ar" ? "تعديل توزيع الدفعات" : "Edit payment allocation"}
                    >
                      {money(splitPaidTotal)}
                    </button>
                  </div>
                ) : (
                  <AmountInput
                    label={lang === "ar" ? "المبلغ المدفوع" : "Amount paid"}
                    showLabel
                    dir={lang === "ar" ? "rtl" : "ltr"}
                    value={
                      paidManuallyEdited
                        ? paid || "0"
                        : paymentMethod === "credit"
                          ? "0"
                          : String(total)
                    }
                    onValueChange={handlePaidChange}
                    invalid={
                      isOverpaid ||
                      singlePayment.blockingReason === "credit_method_requires_zero_paid"
                    }
                    data-form-nav
                    placeholder={lang === "ar" ? "المدفوع" : "Paid"}
                    className="h-8 min-w-0 rounded-lg border border-border bg-background px-2 text-[10px] font-semibold outline-none focus:border-primary sm:px-2.5 sm:text-[11px]"
                  />
                )}
                <AmountInput
                  label={t("pos.discount")}
                  showLabel
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  value={discount}
                  onValueChange={setDiscount}
                  data-form-nav
                  placeholder={lang === "ar" ? "الخصم" : "Discount"}
                  className="h-8 min-w-0 rounded-lg border border-border bg-background px-2 text-[10px] font-semibold outline-none focus:border-primary sm:px-2.5 sm:text-[11px]"
                />
              </div>

              {/* Transfer reference input */}
              {!isSplitPayment &&
                (selectedSingleMethod?.requiresReference ||
                  paymentMethod === "bank_transfer" ||
                  paymentMethod === "mobile_money") && (
                  <input
                    value={transferRef}
                    onChange={(e) => setTransferRef(e.target.value)}
                    data-form-nav
                    placeholder={
                      paymentMethod === "mobile_money"
                        ? lang === "ar"
                          ? "رقم عملية المحفظة / المرجع الإلكتروني"
                          : "Wallet transaction / reference number"
                        : t("pos.pm.transfer_ref")
                    }
                    aria-label={lang === "ar" ? "مرجع الحوالة" : "Transfer reference"}
                    className="h-9 w-full rounded-xl border border-input/80 bg-background px-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                )}

              {/* Split Payment Details */}
              {isSplitPayment ? (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-primary/[0.04] px-2 py-1 text-[10px]">
                  <span className="text-muted-foreground">
                    {lang === "ar"
                      ? `دفع متعدد · ${splitRows.length} طرق`
                      : `Split payment · ${splitRows.length} methods`}
                  </span>
                  <span className="font-mono font-semibold">{money(splitPaidTotal)}</span>
                </div>
              ) : null}

              {/* Notes stay beside the payment controls, not below the totals. */}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-form-nav
                placeholder={t("pos.notes_placeholder")}
                aria-label={t("pos.notes_placeholder")}
                className="h-8 w-full rounded-xl border border-input/80 bg-background px-3 text-xs outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/20"
              />

              <PosTotalsCard
                countLabel={lang === "ar" ? "عدد الأصناف" : "Items"}
                count={cart.reduce((sum, item) => sum + item.quantity, 0)}
                rows={[
                  { label: t("pos.subtotal"), value: money(subtotal) },
                  ...(taxTotal > 0
                    ? [{ label: lang === "ar" ? "قيمة الضريبة" : "Tax", value: money(taxTotal) }]
                    : []),
                  ...(discountN > 0
                    ? [{ label: t("pos.discount"), value: `−${money(discountN)}` }]
                    : []),
                  {
                    label: lang === "ar" ? "المبلغ المدفوع" : "Amount paid",
                    value: money(effectivePaid),
                  },
                  ...(remainingDebt > 0
                    ? [
                        {
                          label: lang === "ar" ? "المتبقي على العميل" : "Customer balance",
                          value: money(remainingDebt),
                        },
                      ]
                    : []),
                ]}
                totalLabel={t("pos.total")}
                total={money(total)}
              />
              {isOverpaid && (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/10 px-2 py-1 text-[10px] font-semibold text-destructive"
                >
                  {lang === "ar"
                    ? "مجموع المدفوع أكبر من إجمالي الفاتورة"
                    : "Paid amount exceeds the invoice total"}
                </p>
              )}

              {/* P1-4: the shared debt guard — visible before the cashier
                    presses F9, using the same sentence every other screen shows. */}
              {!isSplitPayment &&
                !singlePayment.isPayable &&
                !isOverpaid &&
                singlePayment.blockingReason && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{singlePayment.blockingReason}</span>
                  </div>
                )}
            </div>

            {/* ─── Sticky Action Row ─── */}
            <div className="mt-2 shrink-0 border-t border-border/70 bg-surface/95 pb-1 pt-2">
              {isOverpaid ? (
                <button
                  type="button"
                  disabled
                  className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-destructive/60 bg-destructive text-sm font-bold text-destructive-foreground opacity-90 shadow-lg shadow-destructive/20"
                >
                  <AlertCircle className="h-4 w-4" />
                  <span>
                    {lang === "ar"
                      ? "المبلغ المدفوع أكبر من الإجمالي المطلوب!"
                      : "Paid amount exceeds total!"}
                  </span>
                </button>
              ) : (
                <div className="flex gap-2" dir={lang === "ar" ? "rtl" : "ltr"}>
                  {/* Secondary: Quotation */}
                  <button
                    type="button"
                    onClick={openQuotation}
                    disabled={cart.length === 0}
                    title={t("pos.quote_only_hint")}
                    className={`flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-border/80 bg-surface px-4 text-xs font-bold text-foreground transition hover:bg-surface-2 active:scale-95 disabled:opacity-40 ${lang === "ar" ? "order-last" : ""}`}
                  >
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">{t("pos.quote")}</span>
                  </button>

                  {/* Primary: Checkout */}
                  <button
                    type="button"
                    onClick={checkout}
                    disabled={loading || cart.length === 0}
                    className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary via-primary to-primary/90 px-4 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/25 transition hover:shadow-primary/35 hover:brightness-105 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 ${lang === "ar" ? "order-first" : ""}`}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    <span>{`${t("pos.checkout")} (F9)`}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <SplitPaymentDialog
        open={splitEditorOpen}
        onOpenChange={(open) => {
          setSplitEditorOpen(open);
          if (!open && splitPayments.length === 0) setIsSplitPayment(false);
        }}
        total={total}
        initialValues={splitValues}
        isCreditAllowed={!selectedCustomer?.is_system && Boolean(customerId)}
        creditBlockReason={
          selectedCustomer?.is_system
            ? lang === "ar"
              ? "العميل النقدي لا يمكنه الشراء بالآجل"
              : "Cash customer cannot carry credit"
            : null
        }
        onConfirm={(vals) => {
          setSplitValues(vals);
          setIsSplitPayment(true);
          setPaymentMethod("split");
          const tenderPaid = vals.cash + vals.bank_transfer + vals.mobile_money;
          setPaid(String(tenderPaid));
          setPaidManuallyEdited(true);

          const splits: SplitPaymentLine[] = [];
          if (vals.cash > 0) {
            splits.push({
              key: crypto.randomUUID(),
              methodId: supportedSplitMethods.find((m) => m.legacyValue === "cash")?.id ?? "cash",
              amount: String(vals.cash),
              autoAmount: false,
            });
          }
          if (vals.bank_transfer > 0) {
            splits.push({
              key: crypto.randomUUID(),
              methodId: supportedSplitMethods.find((m) => m.legacyValue === "bank_transfer")?.id ?? "bank_transfer",
              amount: String(vals.bank_transfer),
              reference: vals.bankReference,
              autoAmount: false,
            });
          }
          if (vals.mobile_money > 0) {
            splits.push({
              key: crypto.randomUUID(),
              methodId: supportedSplitMethods.find((m) => m.legacyValue === "mobile_money")?.id ?? "mobile_money",
              amount: String(vals.mobile_money),
              reference: vals.walletReference,
              autoAmount: false,
            });
          }
          setSplitPayments(splits);
        }}
      />

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

      {postSaleRequest ? (
        <UniversalPrintPreview
          open
          onOpenChange={(open) => {
            if (!open) setPostSaleRequest(null);
          }}
          request={postSaleRequest}
          title={lang === "ar" ? "معاينة فاتورة المبيعات" : "Sales invoice preview"}
          rtl={lang === "ar"}
        />
      ) : null}

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
              <AmountInput
                label={lang === "ar" ? "السعر المتفق عليه" : "Agreed price"}
                min={0}
                value={servicePrice}
                onValueChange={(v) => setServicePrice(v)}
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

      {batchPendingProduct ? (
        <PosBatchSelectorModal
          open={batchModalOpen}
          onOpenChange={(open) => {
            setBatchModalOpen(open);
            if (!open) setBatchPendingProduct(null);
          }}
          productId={batchPendingProduct.id}
          productName={
            lang === "ar" && batchPendingProduct.name_ar
              ? batchPendingProduct.name_ar
              : batchPendingProduct.name
          }
          warehouseId={warehouseId}
          onSelectBatch={(batch) => {
            addToCart(batchPendingProduct, batch);
            setBatchModalOpen(false);
            setBatchPendingProduct(null);
          }}
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
