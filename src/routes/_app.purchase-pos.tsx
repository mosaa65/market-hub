import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Building2,
  Plus,
  Trash2,
  ScanBarcode,
  Loader2,
  UserPlus,
  ShoppingBag,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { PageGuideButton, type PageGuideConfig } from "@/components/page-guide";
import { DollarSign, Archive, Zap, Truck } from "lucide-react";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { fuzzyMatch } from "@/lib/fuzzy-search";
import { useKeyboardWedge } from "@/hooks/use-keyboard-wedge";
import { useCatalogModules } from "@/lib/catalog-modules";
import { useIsDesktop, useMediaQuery } from "@/hooks/use-media-query";
import { CartLine as CartLineRow } from "@/components/commerce/cart-line";
import { MobileProductPicker } from "@/components/commerce/mobile-product-picker";
import { TableToolbar, type FilterValues } from "@/components/ui/table-toolbar";
import { RecordsViewToggle } from "@/components/ui/records-view-toggle";
import { PaymentMethodPicker } from "@/components/ui/payment-method";
import { AmountInput } from "@/components/commerce/amount-input";
import { PosDatePicker } from "@/components/commerce/pos-date-picker";
import { PartyPicker } from "@/components/commerce/party-picker";
import { PosTotalsCard } from "@/components/commerce/pos-totals-card";
import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import { SupplierFormDialog } from "@/components/contacts/supplier-form-dialog";
import { UniversalPrintPreview } from "@/components/universal-print-preview";
import { getUnifiedPrintSettings, printUnifiedDocument, type PrintRequest } from "@/lib/printing";
import { translateRpcError } from "@/lib/errors/rpc-errors";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import {
  SplitPaymentEditor,
  type SplitPaymentEditorLine,
} from "@/components/payments/split-payment-editor";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";
import {
  toLegacyPaymentValue,
  getPaymentMethodDefinition,
  paymentUiText,
} from "@/lib/payments/payment-methods";

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
  tracking?: "NONE" | "BATCH" | "SERIAL" | null;
  is_custody_item?: boolean;
  is_purchasable?: boolean;
  is_active?: boolean;
  image_url: string | null;
  category_id?: string | null;
  brand_id?: string | null;
  unit_id?: string | null;
  purchase_uoms?: PurchaseUom[];
  origin_id?: string | null;
  quality_grade_id?: string | null;
  unit?: { short_name: string; name_ar: string | null; name: string } | null;
  category?: { name: string; name_ar: string | null } | null;
  brand?: { name: string; name_ar: string | null } | null;
  origin?: { name: string; name_ar: string | null; code?: string } | null;
  quality?: { name: string; name_ar: string | null; code?: string } | null;
}

interface PurchaseUom {
  unit_id: string;
  factor_to_base: number;
  purchase_price: number;
  label: string;
  quantity_increment: number;
  is_default_purchase: boolean;
}

interface CartLine {
  line_id: string;
  product_id: string;
  name: string;
  sku: string | null;
  unit_cost: number;
  tax_rate: number;
  quantity: number;
  quantity_increment: number;
  uom_id: string | null;
  uom_factor: number;
  uom_label: string;
  purchase_uoms: PurchaseUom[];
  tracking: "NONE" | "BATCH" | "SERIAL";
  batch_number: string;
  expiry_date: string;
}

interface Warehouse {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Supplier {
  id: string;
  name: string;
  is_system?: boolean | null;
  phone?: string | null;
  balance?: number | null;
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
  const { t, lang } = useI18n();
  const { config: catalogConfig } = useCatalogModules();
  const { methods: purchasePaymentMethods } = usePaymentMethodsForContext("purchases");
  const { roles } = useAuth();
  // Suppliers are RLS-restricted to owner/manager/accountant; cashiers must not
  // be shown an "add supplier" action they cannot complete.
  const canManageSuppliers =
    roles.includes("owner") || roles.includes("manager") || roles.includes("accountant");

  const [products, setProducts] = useState<Product[]>([]);
  const [unitBarcodeMap, setUnitBarcodeMap] = useState<
    Record<string, { product_id: string; uom_id: string }>
  >({});
  const [purchaseUomsLoaded, setPurchaseUomsLoaded] = useState(false);
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
  const [catalogSort, setCatalogSort] = useState("name_asc");
  const [catalogTableSort, setCatalogTableSort] = useState<{
    key: string;
    direction: "asc" | "desc";
  }>({
    key: "name",
    direction: "asc",
  });
  const [viewMode, setViewMode] = usePersistedViewMode("purchase-pos-catalog", "cards");
  const [catalogVisibleLimit, setCatalogVisibleLimit] = useState(60);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogComplete, setCatalogComplete] = useState(false);
  const catalogScrollRootRef = useRef<HTMLDivElement | null>(null);
  const catalogSentinelRef = useRef<HTMLDivElement | null>(null);

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
  const [paidManuallyEdited, setPaidManuallyEdited] = useState(false);
  const [discount, setDiscount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [splitPaymentLines, setSplitPaymentLines] = useState<SplitPaymentEditorLine[]>([]);
  const selectedPurchasePaymentMethod = purchasePaymentMethods.find(
    (method) => method.id === paymentMethod,
  );
  const splitPaymentMethods = purchasePaymentMethods
    .filter((method) => !method.isCreditTerm && method.legacyValue !== "split")
    .map((method) => ({
      id: method.id,
      nameAr: method.nameAr,
      nameEn: method.nameEn,
      legacyValue: method.legacyValue,
      requiresReference: method.requiresReference,
    }));
  const [paymentSelection, setPaymentSelection] = useState<PaymentSettlementSelection>({
    method: "cash",
  });
  const [note, setNote] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transferRef, setTransferRef] = useState("");

  // Mobile workspace: cart-first, catalogue opened on demand.
  const isDesktop = useIsDesktop();
  const isTouchDevice = useMediaQuery("(pointer: coarse)");
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);

  // Modals
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcodeReaderEnabled, setBarcodeReaderEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("purchase_pos_barcode_reader_enabled") !== "false";
  });
  /*
   * Unified post-purchase flow — mirrors the Sales POS exactly:
   * 1. The invoice document is built into a `PrintRequest` (supplier_invoice).
   * 2. The user's print settings decide: direct thermal/browser print, the
   *    UniversalPrintPreview sheet, or nothing.
   * 3. The bespoke success popup is gone — the preview sheet is the
   *    confirmation, and the toast carries the summary.
   */
  const [purchasePrintRequest, setPurchasePrintRequest] = useState<PrintRequest | null>(null);
  const lastPurchasePrintRequestRef = useRef<PrintRequest | null>(null);
  const [quoteRequest, setQuoteRequest] = useState<PrintRequest | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const scanHandlerRef = useRef<(code: string) => void>(() => undefined);

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (warehouseId) void loadStock(warehouseId);
  }, [warehouseId]);

  useEffect(() => {
    const channel = supabase.channel("purchase-pos-live-meta");
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "suppliers" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const deleted = payload.old as { id: string };
          setSuppliers((current) => current.filter((supplier) => supplier.id !== deleted.id));
          return;
        }
        const supplier = payload.new as Supplier;
        setSuppliers((current) =>
          [...current.filter((entry) => entry.id !== supplier.id), supplier].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
      },
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "products" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const deleted = payload.old as { id: string };
          setProducts((current) => current.filter((product) => product.id !== deleted.id));
          return;
        }
        const product = payload.new as Product;
        if (!product.is_active || product.is_custody_item || !product.is_purchasable) {
          setProducts((current) => current.filter((entry) => entry.id !== product.id));
          setCart((current) => current.filter((line) => line.product_id !== product.id));
          return;
        }
        setProducts((current) =>
          current.map((entry) =>
            entry.id === product.id
              ? {
                  ...entry,
                  ...product,
                  purchase_uoms: entry.purchase_uoms,
                  category: entry.category,
                  brand: entry.brand,
                  unit: entry.unit,
                  origin: entry.origin,
                  quality: entry.quality,
                }
              : entry,
          ),
        );
        setCart((current) =>
          current.map((line) =>
            line.product_id === product.id
              ? { ...line, tracking: product.tracking ?? "NONE" }
              : line,
          ),
        );
      },
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "warehouses" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const deleted = payload.old as { id: string };
          setWarehouses((current) => current.filter((warehouse) => warehouse.id !== deleted.id));
          return;
        }
        const warehouse = payload.new as Warehouse;
        setWarehouses((current) =>
          current.some((entry) => entry.id === warehouse.id)
            ? current.map((entry) =>
                entry.id === warehouse.id ? { ...entry, ...warehouse } : entry,
              )
            : [...current, warehouse],
        );
      },
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "inventory" },
      (payload) => {
        const row = (payload.new || payload.old) as {
          product_id?: string;
          warehouse_id?: string;
          quantity?: number | null;
        };
        if (!row.product_id || row.warehouse_id !== warehouseId) return;
        setStockMap((current) => ({
          ...current,
          [row.product_id as string]:
            payload.eventType === "DELETE" ? 0 : Number(row.quantity ?? 0),
        }));
      },
    );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [warehouseId]);

  async function loadAll() {
    setPurchaseUomsLoaded(false);
    setCatalogComplete(false);
    try {
      /*
       * Fast product path for purchases: loads the first 500 items immediately
       * so the operator can start right away while the full catalog is fetched.
       */
      const fastProductQuery = (supabase.from("products") as any)
        .select(
          "id,sku,barcode,name,name_ar,cost_price,sale_price,tax_rate,tracking,is_custody_item,is_purchasable,image_url,category_id,brand_id,unit_id,origin_id,quality_grade_id,unit:units!products_unit_id_fkey(short_name,name,name_ar),category:categories(name,name_ar),brand:brands!products_brand_id_fkey(name,name_ar),origin:countries_of_origin(name,name_ar,code),quality:quality_grades(name,name_ar,code)",
        )
        .eq("is_active", true)
        .eq("is_custody_item", false)
        .eq("is_purchasable", true);

      void fastProductQuery
        .order("name")
        .order("id")
        .range(0, 499)
        .then(({ data }: { data: any[] | null }) => {
          if (data?.length) {
            setProducts((prev) => (prev.length === 0 ? (data as Product[]) : prev));
            setCatalogLoading(false);
          }
        });

      const [
        wsRes,
        supsRes,
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
        supabase.from("suppliers").select("id,name,phone,balance,is_system").order("name"),
        (async () => {
          // Complete catalog pagination with deterministic ordering
          const allItems: any[] = [];
          const pageSize = 500;
          let from = 0;
          let selectCols =
            "id,sku,barcode,name,name_ar,cost_price,sale_price,tax_rate,tracking,is_custody_item,is_purchasable,image_url,category_id,brand_id,unit_id,origin_id,quality_grade_id,unit:units!products_unit_id_fkey(short_name,name,name_ar),category:categories(name,name_ar),brand:brands!products_brand_id_fkey(name,name_ar),origin:countries_of_origin(name,name_ar,code),quality:quality_grades(name,name_ar,code)";

          while (true) {
            const query = (supabase.from("products") as any)
              .select(selectCols)
              .eq("is_active", true)
              .eq("is_custody_item", false)
              .eq("is_purchasable", true);

            const { data, error } = await query
              .order("name", { ascending: true })
              .order("id", { ascending: true })
              .range(from, from + pageSize - 1);

            if (error && from === 0 && selectCols.includes("origin_id")) {
              selectCols =
                "id,sku,barcode,name,name_ar,cost_price,sale_price,tax_rate,tracking,is_custody_item,is_purchasable,image_url,category_id,brand_id,unit_id";
              continue;
            }
            if (error) return { data: null, error };
            allItems.push(...(data ?? []));
            if (!data || data.length < pageSize) break;
            from += pageSize;
          }
          return { data: allItems, error: null };
        })(),
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
      const sups = supsRes.status === "fulfilled" ? supsRes.value.data : null;
      const ps = psRes.status === "fulfilled" && !psRes.value.error ? psRes.value.data : null;
      if (psRes.status === "rejected" || (psRes.status === "fulfilled" && psRes.value.error)) {
        console.error(
          "[purchase-pos] Failed to load the purchase product catalog:",
          psRes.status === "rejected" ? psRes.reason : psRes.value.error,
        );
      }
      const cats = catsRes.status === "fulfilled" ? catsRes.value.data : null;
      const brs = brsRes.status === "fulfilled" ? brsRes.value.data : null;
      const uns = unsRes.status === "fulfilled" ? unsRes.value.data : null;
      const origs = origsRes.status === "fulfilled" ? origsRes.value.data : [];
      const quals = qualsRes.status === "fulfilled" ? qualsRes.value.data : [];
      const vMakes = vMakesRes.status === "fulfilled" ? vMakesRes.value.data : [];
      const vModels = vModelsRes.status === "fulfilled" ? vModelsRes.value.data : [];
      const compats = compatsRes.status === "fulfilled" ? compatsRes.value.data : [];

      const loadedWarehouses = ws ?? [];
      const loadedSuppliers = sups ?? [];
      setWarehouses(loadedWarehouses);
      setSuppliers(loadedSuppliers);
      const productRows = ((ps as any) ?? []) as Product[];
      const purchaseUomsByProduct = new Map<string, PurchaseUom[]>();
      const barcodeLookup: Record<string, { product_id: string; uom_id: string }> = {};
      const chunked = <T,>(items: T[], size = 400): T[][] => {
        const chunks: T[][] = [];
        for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
        return chunks;
      };
      let unitSettingsReady = true;
      if (productRows.length) {
        const ids = productRows.map((product) => product.id);
        try {
          const idChunks = chunked(ids, 400);
          const uomRows: any[] = [];
          const companyCostRows: any[] = [];
          for (const chunk of idChunks) {
            const [uomResult, companyCostResult] = await Promise.all([
              (supabase as any)
                .from("product_uoms")
                .select(
                  "id, product_id, unit_id, factor_to_base, quantity_increment, is_default_purchase, unit:units!product_uoms_unit_id_fkey(name, name_ar, short_name)",
                )
                .in("product_id", chunk)
                .eq("is_active", true)
                .eq("can_purchase", true),
              (supabase as any)
                .from("company_items")
                .select("item_id, default_cost")
                .eq("company_id", 1)
                .eq("is_active", true)
                .in("item_id", chunk),
            ]);
            if (uomResult.error) throw uomResult.error;
            if (companyCostResult.error) throw companyCostResult.error;
            uomRows.push(...(uomResult.data ?? []));
            companyCostRows.push(...(companyCostResult.data ?? []));
          }

          if (uomRows.length) {
            const baseCosts = new Map<string, number>();
            for (const row of companyCostRows) {
              if (row.default_cost != null) baseCosts.set(row.item_id, Number(row.default_cost));
            }
            const uomIds = uomRows.map((row: any) => row.id);
            const priceRows: any[] = [];
            const barcodeRows: any[] = [];
            for (const chunk of chunked(uomIds, 400)) {
              const [priceResult, barcodeResult] = await Promise.all([
                (supabase as any)
                  .from("product_uom_prices")
                  .select("product_uom_id, purchase_price")
                  .in("product_uom_id", chunk)
                  .eq("company_id", 1),
                (supabase as any)
                  .from("product_uom_barcodes")
                  .select("product_uom_id, barcode")
                  .in("product_uom_id", chunk)
                  .eq("company_id", 1)
                  .eq("is_active", true),
              ]);
              if (priceResult.error) throw priceResult.error;
              if (barcodeResult.error) throw barcodeResult.error;
              priceRows.push(...(priceResult.data ?? []));
              barcodeRows.push(...(barcodeResult.data ?? []));
            }
            const priceById = new Map<string, number>();
            for (const row of priceRows) {
              if (row.purchase_price != null)
                priceById.set(row.product_uom_id, Number(row.purchase_price));
            }
            for (const row of uomRows as any[]) {
              const product = productRows.find((item) => item.id === row.product_id);
              const factor = Number(row.factor_to_base);
              const unit = row.unit;
              const baseCost = baseCosts.get(row.product_id) ?? Number(product?.cost_price ?? 0);
              const label = unit
                ? `${lang === "ar" ? unit.name_ar || unit.name : unit.name || unit.name_ar}${unit.short_name ? ` (${unit.short_name})` : ""}`
                : lang === "ar"
                  ? "وحدة"
                  : "Unit";
              const list = purchaseUomsByProduct.get(row.product_id) ?? [];
              list.push({
                unit_id: row.unit_id,
                factor_to_base: factor,
                purchase_price: priceById.get(row.id) ?? baseCost * factor,
                label,
                quantity_increment: Number(row.quantity_increment ?? 1),
                is_default_purchase: row.is_default_purchase === true,
              });
              purchaseUomsByProduct.set(row.product_id, list);
            }
            const rowById = new Map((uomRows as any[]).map((row) => [row.id, row]));
            for (const row of barcodeRows) {
              const uom = rowById.get(row.product_uom_id);
              if (uom)
                barcodeLookup[row.barcode] = { product_id: uom.product_id, uom_id: uom.unit_id };
            }
          }
        } catch (uomError) {
          unitSettingsReady = false;
          console.warn("[purchase-pos] Item unit settings unavailable", uomError);
        }
      }
      setUnitBarcodeMap(barcodeLookup);
      setProducts(
        productRows.map((product) => ({
          ...product,
          purchase_uoms: purchaseUomsByProduct.get(product.id) ?? [],
        })),
      );
      setPurchaseUomsLoaded(unitSettingsReady);
      setCatalogComplete(true);
      setCatalogLoading(false);
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

      // Use the stable system supplier for cash purchases. Avoid name matching,
      // which breaks when labels are renamed or translated.
      if (loadedSuppliers.length > 0) {
        const cashSupplier = loadedSuppliers.find((supplier) => supplier.is_system);
        setSupplierId((current) => current || cashSupplier?.id || loadedSuppliers[0].id);
      }
    } catch (err: any) {
      setCatalogLoading(false);
      console.error("Error loading POP meta:", err);
      toast.error(
        translateRpcError(
          err,
          lang === "ar" ? "ar" : "en",
          lang === "ar"
            ? "تعذر تحميل بيانات الشاشة (الأصناف والمستودعات والموردين). أعد المحاولة."
            : "Could not load screen data (products, warehouses, suppliers). Retry.",
        ),
      );
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
  function addToCart(p: Product, requestedUom?: PurchaseUom | null) {
    if (!purchaseUomsLoaded) {
      toast.info(
        lang === "ar"
          ? "جارٍ تحميل وحدات الشراء؛ حاول مجددًا بعد لحظة"
          : "Loading purchase units; try again in a moment.",
      );
      return;
    }
    const pName = lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar || p.name;
    const defaultUom = p.purchase_uoms?.find((unit) => unit.is_default_purchase) ??
      p.purchase_uoms?.find((unit) => unit.unit_id === p.unit_id) ?? {
        unit_id: p.unit_id ?? "",
        factor_to_base: 1,
        purchase_price: Number(p.cost_price || 0),
        label: p.unit?.short_name || (lang === "ar" ? "وحدة الأساس" : "Base unit"),
        quantity_increment: 1,
        is_default_purchase: true,
      };
    const purchaseUom = requestedUom ?? defaultUom;
    setCart((prev) => {
      const existing =
        p.tracking === "BATCH" || p.tracking === "SERIAL"
          ? undefined
          : prev.find((l) => l.product_id === p.id && l.uom_id === (purchaseUom.unit_id || null));
      if (existing) {
        return prev.map((l) =>
          l.line_id === existing.line_id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          line_id: crypto.randomUUID(),
          product_id: p.id,
          name: pName,
          sku: p.sku,
          unit_cost: Number(purchaseUom.purchase_price),
          tax_rate: Number(p.tax_rate || 0),
          quantity: 1,
          quantity_increment: purchaseUom.quantity_increment,
          uom_id: purchaseUom.unit_id || null,
          uom_factor: purchaseUom.factor_to_base,
          uom_label: purchaseUom.label,
          purchase_uoms: p.purchase_uoms ?? [],
          tracking: p.tracking ?? "NONE",
          batch_number: "",
          expiry_date: "",
        },
      ];
    });
  }

  function getDefaultPurchaseUom(product: Product): PurchaseUom {
    return (
      product.purchase_uoms?.find((unit) => unit.is_default_purchase) ??
      product.purchase_uoms?.find((unit) => unit.unit_id === product.unit_id) ?? {
        unit_id: product.unit_id ?? "",
        factor_to_base: 1,
        purchase_price: Number(product.cost_price || 0),
        label: product.unit?.short_name || (lang === "ar" ? "وحدة الأساس" : "Base unit"),
        quantity_increment: 1,
        is_default_purchase: true,
      }
    );
  }

  function updateCartLine(lineId: string, patch: Partial<CartLine>) {
    setCart((prev) =>
      prev.map((line) => {
        if (line.line_id !== lineId) return line;
        return { ...line, ...patch };
      }),
    );
  }

  /** Commit a quantity. `null` (empty field mid-edit) leaves the line intact. */
  function setQty(lineId: string, qty: number | null) {
    if (qty === null || Number.isNaN(qty)) return;
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.line_id !== lineId));
    } else {
      setCart((prev) => prev.map((l) => (l.line_id === lineId ? { ...l, quantity: qty } : l)));
    }
  }

  function setCost(lineId: string, cost: number) {
    setCart((prev) =>
      prev.map((l) => (l.line_id === lineId ? { ...l, unit_cost: Math.max(0, cost) } : l)),
    );
  }

  function changePurchaseUom(lineId: string, unitId: string) {
    const line = cart.find((entry) => entry.line_id === lineId);
    const option = line?.purchase_uoms.find((uom) => uom.unit_id === unitId);
    if (!line || !option) return;
    setCart((current) =>
      current.map((entry) =>
        entry.line_id === lineId
          ? {
              ...entry,
              uom_id: option.unit_id,
              uom_factor: option.factor_to_base,
              uom_label: option.label,
              quantity_increment: option.quantity_increment,
              unit_cost: option.purchase_price,
            }
          : entry,
      ),
    );
  }

  // Barcode Handler
  const handleBarcode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (!purchaseUomsLoaded) {
      toast.info(
        lang === "ar"
          ? "جارٍ تحميل وحدات الشراء؛ حاول مجددًا بعد لحظة"
          : "Loading purchase units; try scanning again in a moment.",
      );
      return;
    }
    const mapped = unitBarcodeMap[trimmed];
    if (mapped) {
      const product = products.find((item) => item.id === mapped.product_id);
      const uom = product?.purchase_uoms?.find((unit) => unit.unit_id === mapped.uom_id);
      if (product && uom) {
        addToCart(product, uom);
        toast.success(
          lang === "ar"
            ? `تمت إضافة: ${product.name_ar || product.name} (${uom.label})`
            : `Added: ${product.name} (${uom.label})`,
        );
        return;
      }
    }
    // Do not report a false miss while later catalog pages are still loading.
    if (!catalogComplete) {
      toast.info(
        lang === "ar"
          ? "جارٍ تحميل بقية أصناف المشتريات؛ أعد المسح بعد لحظة"
          : "Purchase catalog is still loading; scan again in a moment.",
      );
      return;
    }

    const found = products.find(
      (p) =>
        (p.barcode && p.barcode.toLowerCase() === trimmed.toLowerCase()) ||
        (p.sku && p.sku.toLowerCase() === trimmed.toLowerCase()),
    );
    if (found) {
      const baseUom =
        found.barcode?.toLowerCase() === trimmed.toLowerCase()
          ? found.purchase_uoms?.find((unit) => unit.unit_id === found.unit_id)
          : undefined;
      addToCart(found, baseUom);
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
    disabled: scannerOpen || !catalogConfig.enableBarcode || !barcodeReaderEnabled,
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
  const splitPaidN =
    Math.round(
      splitPaymentLines.reduce((sum, line) => sum + Math.max(0, Number(line.amount) || 0), 0) * 100,
    ) / 100;
  const paidN =
    paymentMethod === "credit"
      ? 0
      : paymentMethod === "split"
        ? splitPaidN
        : paidManuallyEdited
          ? Number(paid || 0)
          : total;
  const isOverpaid = Number.isFinite(paidN) && paidN > total;

  // Filter products
  const filtered = useMemo(() => {
    const q = search.trim();
    const matching = products.filter((p) => {
      if (q) {
        const matchesFuzzy =
          fuzzyMatch(p.name_ar ?? p.name, q) ||
          fuzzyMatch(p.name, q) ||
          fuzzyMatch(p.sku, q) ||
          fuzzyMatch(p.barcode, q);
        if (!matchesFuzzy) return false;
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
    return [...matching].sort((a, b) => {
      switch (catalogSort) {
        case "name_desc":
          return (b.name_ar || b.name).localeCompare(a.name_ar || a.name, lang);
        case "cost_asc":
          return getDefaultPurchaseUom(a).purchase_price - getDefaultPurchaseUom(b).purchase_price;
        case "cost_desc":
          return getDefaultPurchaseUom(b).purchase_price - getDefaultPurchaseUom(a).purchase_price;
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
    catalogConfig,
    catalogSort,
    stockMap,
    lang,
  ]);

  // Progressive rendering: 60 items per batch on desktop & mobile
  useEffect(() => {
    setCatalogVisibleLimit(60);
  }, [
    search,
    selectedCategory,
    selectedBrand,
    selectedUnit,
    selectedOrigin,
    selectedQuality,
    selectedMake,
    selectedModel,
    catalogSort,
    viewMode,
  ]);

  const visibleFiltered = useMemo(
    () => filtered.slice(0, catalogVisibleLimit),
    [filtered, catalogVisibleLimit],
  );

  useEffect(() => {
    const sentinel = catalogSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setCatalogVisibleLimit((prev) => Math.min(prev + 60, filtered.length));
        }
      },
      {
        root: catalogScrollRootRef.current,
        rootMargin: "300px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filtered.length, catalogVisibleLimit, viewMode]);

  const tableRows = useMemo(() => {
    const valueFor = (product: Product): string | number => {
      switch (catalogTableSort.key) {
        case "code":
          return product.sku || product.barcode || "";
        case "cost":
          return Number(product.cost_price) || 0;
        case "stock":
          return Number(stockMap[product.id] ?? 0);
        default:
          return lang === "ar"
            ? product.name_ar || product.name
            : product.name || product.name_ar || "";
      }
    };
    const factor = catalogTableSort.direction === "asc" ? 1 : -1;
    return [...visibleFiltered].sort((left, right) => {
      const a = valueFor(left);
      const b = valueFor(right);
      return typeof a === "number" && typeof b === "number"
        ? (a - b) * factor
        : String(a).localeCompare(String(b), lang, { numeric: true, sensitivity: "base" }) * factor;
    });
  }, [visibleFiltered, catalogTableSort, stockMap, lang]);

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
    const missingBatch = cart.find(
      (line) => line.tracking === "BATCH" && !line.batch_number.trim(),
    );
    if (missingBatch) {
      return toast.error(
        lang === "ar"
          ? `أدخل رقم الدفعة للصنف: ${missingBatch.name}`
          : `Enter a batch number for: ${missingBatch.name}`,
      );
    }

    const purchaseSplits = splitPaymentLines
      .map((line) => {
        const method = splitPaymentMethods.find((candidate) => candidate.id === line.methodId);
        return method
          ? {
              method: method.legacyValue,
              payment_method_id: method.id,
              amount: Math.round((Number(line.amount) || 0) * 100) / 100,
              reference: line.reference?.trim() || null,
            }
          : null;
      })
      .filter((line): line is NonNullable<typeof line> => Boolean(line && line.amount > 0));

    if (paymentMethod === "split") {
      if (
        purchaseSplits.length < 2 ||
        splitPaymentLines.some((line) => {
          const method = splitPaymentMethods.find((candidate) => candidate.id === line.methodId);
          return (
            !method ||
            !Number.isFinite(Number(line.amount)) ||
            Number(line.amount) <= 0 ||
            (method.requiresReference && !line.reference?.trim())
          );
        })
      ) {
        return toast.error(
          lang === "ar"
            ? "أدخل طريقتين على الأقل ومبلغًا صحيحًا ومرجع الطرق التي تتطلبه"
            : "Add at least two tenders with valid amounts and required references",
        );
      }
      if (paidN > total) {
        return toast.error(
          lang === "ar" ? "مجموع الدفع يتجاوز الإجمالي" : "Tender total exceeds the invoice total",
        );
      }
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
          (selectedPurchasePaymentMethod?.requiresReference ||
            paymentMethod === "bank_transfer" ||
            paymentMethod === "mobile_money") &&
          transferRef.trim()
        ) {
          parts.push(
            `${selectedPurchasePaymentMethod?.nameAr ?? (paymentMethod === "mobile_money" ? (lang === "ar" ? "مرجع المحفظة" : "Wallet reference") : lang === "ar" ? "رقم الحوالة" : "Transfer no.")}: ${transferRef.trim()}`,
          );
        }
        return parts.length ? parts.join(" — ") : null;
      })();

      let invoiceId: string | null = null;
      let error: any = null;

      const purchaseRpcArgs = {
        _warehouse_id: warehouseId,
        _supplier_id: supplierId,
        _payment_method:
          paymentMethod === "split"
            ? "split"
            : (selectedPurchasePaymentMethod?.legacyValue ?? toLegacyPaymentValue(paymentMethod)),
        _paid: paidN,
        _discount: discountN,
        _note: composedNote as any,
        _items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
          tax_rate: Number(l.tax_rate),
          batch_number: l.batch_number.trim() || null,
          expiry_date: l.expiry_date || null,
          uom_id: l.uom_id,
        })),
        _payment_splits: paymentMethod === "split" ? purchaseSplits : [],
      };
      // Use the current atomic RPC signature for both split and single tenders;
      // the old short overload does not accept UOM snapshots.
      const res = await (supabase.rpc as any)("create_purchase", purchaseRpcArgs);
      invoiceId = res.data;
      error = res.error;

      if (error) throw error;

      // جلب رقم الفاتورة الفعلي الذي أنشأه الـ RPC لعرضه في الطباعة والتلميح.
      let invoiceNumber: string | null = null;
      if (invoiceId) {
        try {
          const { data: invRow } = await (supabase as any)
            .from("purchase_invoices")
            .select("invoice_number")
            .eq("id", invoiceId)
            .maybeSingle();
          invoiceNumber = invRow?.invoice_number ?? null;
        } catch {
          invoiceNumber = null;
        }
      }

      // Attach treasury settlement details if provided
      if (invoiceId && paymentMethod !== "split") {
        try {
          await (supabase as any)
            .from("purchase_invoices")
            .update({
              cashbox_id: paymentSelection.cashboxId || null,
              bank_account_id: paymentSelection.bankAccountId || null,
              payment_method_id: paymentSelection.paymentMethodId || paymentMethod,
              payment_reference:
                paymentSelection.reference ||
                paymentSelection.paymentReference ||
                transferRef.trim() ||
                null,
            })
            .eq("id", invoiceId);
        } catch (updateErr) {
          console.warn("Could not attach treasury metadata to purchase_invoice:", updateErr);
        }
      }

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
          ? `تم تسجيل فاتورة الشراء وتحديث المخزون بنجاح${invoiceNumber ? ` — فاتورة #${invoiceNumber}` : ""}`
          : `Purchase recorded successfully${invoiceNumber ? ` — Invoice #${invoiceNumber}` : ""}`,
      );

      /*
       * Unified print flow — identical to the Sales POS: build the
       * supplier_invoice PrintRequest, then honor the operator's printing
       * settings (direct print / preview sheet / off). The old bespoke
       * success popup is gone; the preview sheet IS the confirmation.
       */
      const printSettings = getUnifiedPrintSettings();
      const printOverride = printSettings.overrides.purchase_invoice;
      const printBehavior = printOverride?.behavior ?? printSettings.behavior;
      const printRequest: PrintRequest = {
        documentType: "purchase_invoice",
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
          docType: "purchase_invoice",
          title: lang === "ar" ? "فاتورة مشتريات" : "Purchase Invoice",
          number: invoiceNumber ?? String(invoiceId ?? "").slice(0, 8),
          date: purchaseDate,
          partyLabel: lang === "ar" ? "المورد" : "Supplier",
          partyName: currentSup?.name ?? (lang === "ar" ? "مورد نقدي" : "Cash Supplier"),
          partyPhone: currentSup?.phone ?? undefined,
          warehouse: warehouses.find((w) => w.id === warehouseId)?.name ?? undefined,
          payment:
            lang === "ar"
              ? (selectedPurchasePaymentMethod?.nameAr ?? paymentMethod)
              : (selectedPurchasePaymentMethod?.nameEn ?? paymentMethod),
          status:
            total - paidN > 0
              ? paidN > 0
                ? lang === "ar"
                  ? "سداد جزئي"
                  : "Partial"
                : lang === "ar"
                  ? "آجل / غير مدفوع"
                  : "Unpaid"
              : lang === "ar"
                ? "مسدد بالكامل"
                : "Paid",
          currency: "",
          subtotal,
          tax: taxTotal,
          discount: discountN,
          total,
          paid: paidN,
          balance: Math.max(0, total - paidN),
          notes: composedNote ?? undefined,
          lines: cart.map((l) => ({
            product: l.uom_label ? `${l.name} (${l.uom_label})` : l.name,
            qty: l.quantity,
            price: l.unit_cost,
            total: Math.round(l.unit_cost * l.quantity * (1 + l.tax_rate / 100) * 100) / 100,
          })),
        },
      };

      lastPurchasePrintRequestRef.current = printRequest;

      if (printBehavior === "direct" || (printBehavior === "default" && !printSettings.preview)) {
        void printUnifiedDocument(printRequest);
      } else if (printBehavior !== "off") {
        setPurchasePrintRequest(printRequest);
      }

      // Reset cart and payment
      setCart([]);
      setPaid("");
      setPaidManuallyEdited(false);
      setDiscount("");
      setNote("");
      setTransferRef("");
    } catch (e: any) {
      // كل خطأ من RPC يمر بطبقة الترجمة الموحدة قبل أن يراه المستخدم.
      toast.error(
        translateRpcError(
          e,
          lang === "ar" ? "ar" : "en",
          lang === "ar"
            ? "حدث خطأ أثناء حفظ الفاتورة. لم تُحفظ أي كمية أو تُعدّل أي رصيد."
            : "Failed to record the purchase. No quantity was saved and no balance changed.",
        ),
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
          product: line.uom_label ? `${line.name} (${line.uom_label})` : line.name,
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
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--primary)_8%,transparent),transparent_48%)] p-0 sm:gap-1 sm:p-1 lg:grid-cols-[minmax(0,1fr)_clamp(360px,26vw,440px)] lg:grid-rows-[auto_minmax(0,1fr)]">
      {/* Top Bar / Header */}
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-1 self-start overflow-x-auto overscroll-x-contain rounded-xl border border-border/80 bg-surface/95 px-1.5 py-1.5 shadow-xs backdrop-blur-md sm:gap-2 sm:px-3 sm:py-2 lg:col-span-2 lg:row-start-1">
        {/* Global Toolbar Selectors */}
        <div className="flex w-full min-w-0 flex-1 items-center justify-between gap-1 sm:gap-1.5">
          {/* Warehouse Selector */}
          <div className="flex h-9 min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/[0.07] px-2 text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-300 sm:px-3">
            <Building2 className="size-4 shrink-0" />
            <select
              dir={lang === "ar" ? "rtl" : "ltr"}
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              aria-label={lang === "ar" ? "المستودع" : "Warehouse"}
              className="min-w-0 max-w-[5.5rem] cursor-pointer appearance-none bg-transparent text-[10px] font-semibold text-inherit outline-none sm:max-w-28 xl:max-w-44 xl:text-xs"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar}
                </option>
              ))}
            </select>
            <span className="hidden text-[11px] font-medium xl:inline">
              {lang === "ar" ? "المستودع" : "Warehouse"}
            </span>
          </div>

          {/* Supplier Selector with Cash Supplier Default */}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <PartyPicker
              options={suppliers}
              value={supplierId}
              onChange={setSupplierId}
              lang={lang}
              label={lang === "ar" ? "المورد" : "Supplier"}
              kind="supplier"
              className="h-10 min-w-0 flex-1 rounded-2xl border-primary/20 bg-primary/[0.035] text-xs hover:border-primary/50 hover:bg-primary/[0.07]"
            />
            <button
              type="button"
              onClick={() => setNewSupplierOpen(true)}
              title={lang === "ar" ? "إضافة مورد جديد" : "Add new supplier"}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary shadow-sm transition hover:border-primary/40 hover:bg-primary/15 active:scale-95 disabled:opacity-40"
              disabled={!canManageSuppliers}
            >
              <UserPlus className="h-4 w-4" />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1 2xl:contents">
            {/* Purchase Date */}
            <PosDatePicker
              value={purchaseDate}
              onChange={setPurchaseDate}
              lang={lang}
              label={lang === "ar" ? "تاريخ فاتورة الشراء" : "Purchase invoice date"}
            />

            {/* Page Guide Button */}
            <PageGuideButton
              config={purchasePosGuideConfig}
              className="!size-8 !rounded-full shrink-0 sm:!size-9"
            />

            {/* Barcode Camera Modal Trigger */}
            {isDesktop && !isTouchDevice && catalogConfig.enableBarcode ? (
              <button
                type="button"
                onClick={() => {
                  const next = !barcodeReaderEnabled;
                  setBarcodeReaderEnabled(next);
                  localStorage.setItem("purchase_pos_barcode_reader_enabled", String(next));
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
                <ScanBarcode className="h-4 w-4" />
                <span className="hidden text-[11px] font-semibold lg:inline">
                  {lang === "ar" ? "قارئ" : "Reader"}
                </span>
              </button>
            ) : (!isDesktop || isTouchDevice) && catalogConfig.enableBarcode ? (
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border/80 bg-surface px-2.5 text-muted-foreground shadow-2xs transition hover:bg-surface-2 hover:text-foreground xl:w-auto xl:px-3"
                title={lang === "ar" ? "مسح الباركود بالكاميرا" : "Scan barcode with camera"}
              >
                <ScanBarcode className="h-4 w-4" />
                <span className="hidden text-[11px] font-semibold lg:inline">
                  {lang === "ar" ? "مسح" : "Scan"}
                </span>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Main Content Area: Products Grid (Left) + Cart & Totals (Right) */}
      <div className="flex min-h-0 flex-col gap-0 overflow-hidden px-1.5 pb-1.5 sm:gap-2 sm:px-2 sm:pb-2 lg:contents lg:row-start-2">
        {/* Left Column: Search, Filters & Product Grid — desktop only. */}
        {isDesktop && (
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface/95 p-1.5 shadow-sm ring-1 ring-background/40 sm:rounded-3xl sm:p-2 lg:col-start-1 lg:row-start-2">
            <TableToolbar
              className="border-b border-border/60 bg-surface/50 p-3"
              lang={lang}
              search={{
                value: search,
                onValueChange: setSearch,
                dir: lang === "ar" ? "rtl" : "ltr",
                inputRef: searchRef,
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleBarcode(search);
                  }
                },
                placeholder:
                  lang === "ar"
                    ? "ابحث باسم المنتج، SKU، أو امسح الباركود (F2)..."
                    : "Search by product name, SKU, or scan barcode (F2)...",
                resultCount: filtered.length,
                resultCountText: !catalogComplete
                  ? lang === "ar"
                    ? `${filtered.length} مطابقة • ${products.length} محمّل`
                    : `${filtered.length} matches • ${products.length} loaded`
                  : visibleFiltered.length < filtered.length
                    ? `${visibleFiltered.length} / ${filtered.length}`
                    : String(filtered.length),
                loading: !catalogComplete,
              }}
              filters={{
                definitions: [
                  {
                    key: "category",
                    label: lang === "ar" ? "التصنيف" : "Category",
                    type: "select",
                    options: categories.map((item) => ({
                      value: item.id,
                      label:
                        lang === "ar" ? item.name_ar || item.name : item.name || item.name_ar || "",
                    })),
                  },
                  ...(catalogConfig.enableBrands
                    ? [
                        {
                          key: "brand",
                          label: lang === "ar" ? "الماركة" : "Brand",
                          type: "select" as const,
                          options: brands.map((item) => ({
                            value: item.id,
                            label:
                              lang === "ar"
                                ? item.name_ar || item.name
                                : item.name || item.name_ar || "",
                          })),
                        },
                      ]
                    : []),
                  ...(catalogConfig.enableUnits
                    ? [
                        {
                          key: "unit",
                          label: lang === "ar" ? "الوحدة" : "Unit",
                          type: "select" as const,
                          options: units.map((item) => ({
                            value: item.id,
                            label:
                              lang === "ar"
                                ? item.name_ar || item.name
                                : item.name || item.name_ar || "",
                          })),
                        },
                      ]
                    : []),
                  ...(catalogConfig.enableOrigins
                    ? [
                        {
                          key: "origin",
                          label: lang === "ar" ? "بلد المنشأ" : "Origin",
                          type: "select" as const,
                          options: origins.map((item) => ({
                            value: item.id,
                            label:
                              lang === "ar"
                                ? item.name_ar || item.name
                                : item.name || item.name_ar || "",
                          })),
                        },
                      ]
                    : []),
                  ...(catalogConfig.enableQualityGrades
                    ? [
                        {
                          key: "quality",
                          label: lang === "ar" ? "درجة الجودة" : "Quality grade",
                          type: "select" as const,
                          options: qualities.map((item) => ({
                            value: item.id,
                            label:
                              lang === "ar"
                                ? item.name_ar || item.name
                                : item.name || item.name_ar || "",
                          })),
                        },
                      ]
                    : []),
                ],
                values: {
                  category: selectedCategory,
                  brand: selectedBrand,
                  unit: selectedUnit,
                  origin: selectedOrigin,
                  quality: selectedQuality,
                },
                onValueChange: (values: FilterValues) => {
                  setSelectedCategory(typeof values.category === "string" ? values.category : "");
                  setSelectedBrand(typeof values.brand === "string" ? values.brand : "");
                  setSelectedUnit(typeof values.unit === "string" ? values.unit : "");
                  setSelectedOrigin(typeof values.origin === "string" ? values.origin : "");
                  setSelectedQuality(typeof values.quality === "string" ? values.quality : "");
                },
              }}
              sort={
                viewMode === "table"
                  ? undefined
                  : {
                      value: catalogSort,
                      onValueChange: setCatalogSort,
                      options: [
                        {
                          value: "name_asc",
                          label: lang === "ar" ? "الاسم: أ إلى ي" : "Name: A to Z",
                        },
                        {
                          value: "name_desc",
                          label: lang === "ar" ? "الاسم: ي إلى أ" : "Name: Z to A",
                        },
                        {
                          value: "cost_asc",
                          label: lang === "ar" ? "التكلفة: الأقل أولاً" : "Cost: low to high",
                        },
                        {
                          value: "cost_desc",
                          label: lang === "ar" ? "التكلفة: الأعلى أولاً" : "Cost: high to low",
                        },
                        {
                          value: "stock_asc",
                          label: lang === "ar" ? "المخزون: الأقل أولاً" : "Stock: low to high",
                        },
                        {
                          value: "stock_desc",
                          label: lang === "ar" ? "المخزون: الأعلى أولاً" : "Stock: high to low",
                        },
                      ],
                    }
              }
              viewToggle={<RecordsViewToggle value={viewMode} onChange={setViewMode} cycle />}
            >
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedCategory("")}
                  className={`h-7 shrink-0 rounded-lg px-2.5 text-xs font-medium ${selectedCategory === "" ? "bg-primary text-primary-foreground" : "border border-border/80 bg-surface text-muted-foreground hover:border-primary/40"}`}
                >
                  {lang === "ar" ? "الكل" : "All"} ({products.length})
                </button>
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() =>
                      setSelectedCategory((current) => (current === category.id ? "" : category.id))
                    }
                    className={`h-7 shrink-0 rounded-lg px-2.5 text-xs font-medium ${selectedCategory === category.id ? "bg-primary text-primary-foreground" : "border border-border/80 bg-surface text-muted-foreground hover:border-primary/40"}`}
                  >
                    {lang === "ar"
                      ? category.name_ar || category.name
                      : category.name || category.name_ar}
                  </button>
                ))}
              </div>
            </TableToolbar>

            {/* Products Grid */}
            <div
              ref={catalogScrollRootRef}
              className="flex-1 min-h-0 overflow-y-auto p-3 custom-scrollbar"
            >
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
              ) : viewMode === "cards" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {visibleFiltered.map((p) => {
                    const stock = stockMap[p.id] ?? 0;
                    const purchaseUom = getDefaultPurchaseUom(p);
                    const stockInPurchaseUnit =
                      stock / Math.max(purchaseUom.factor_to_base, 0.000000001);
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
                        className="card-mullak group flex h-full flex-col justify-between rounded-2xl p-3 text-start transition-all hover:shadow-md active:scale-[0.98]"
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
                              {money(purchaseUom.purchase_price)}
                            </span>
                            <span className="block truncate text-[9px] text-muted-foreground">
                              {purchaseUom.label}
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
                              {stockInPurchaseUnit}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : viewMode === "list" ? (
                <div className="space-y-1.5">
                  {visibleFiltered.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addToCart(product)}
                      className="card-mullak flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-start transition hover:shadow-sm"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {lang === "ar"
                            ? product.name_ar || product.name
                            : product.name || product.name_ar}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {product.category?.name_ar ||
                            product.category?.name ||
                            product.sku ||
                            "—"}
                          {product.barcode ? ` · ${product.barcode}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-xs font-semibold text-primary">
                          {money(getDefaultPurchaseUom(product).purchase_price)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {lang === "ar"
                            ? `المخزون: ${(stockMap[product.id] ?? 0) / Math.max(getDefaultPurchaseUom(product).factor_to_base, 0.000000001)} ${getDefaultPurchaseUom(product).label}`
                            : `Stock: ${(stockMap[product.id] ?? 0) / Math.max(getDefaultPurchaseUom(product).factor_to_base, 0.000000001)} ${getDefaultPurchaseUom(product).label}`}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-start text-xs">
                    {/* الترويسة ليست sticky: الحاوي الأب overflow-x-auto فقط،
                     * والـ sticky بداخله كان يرسم الترويسة كطبقة عائمة شفافة
                     * (تأثير غريب أثناء التمرير) بدل صف ثابت عادي. */}
                    <thead className="bg-surface-2 text-muted-foreground">
                      <tr>
                        {(
                          [
                            {
                              key: "name",
                              label: lang === "ar" ? "الصنف" : "Product",
                              align: "start",
                            },
                            {
                              key: "code",
                              label: lang === "ar" ? "الرمز" : "Code",
                              align: "start",
                            },
                            {
                              key: "cost",
                              label: lang === "ar" ? "التكلفة" : "Cost",
                              align: "end",
                            },
                            {
                              key: "stock",
                              label: lang === "ar" ? "المخزون" : "Stock",
                              align: "end",
                            },
                          ] as const
                        ).map((column) => {
                          const active = catalogTableSort.key === column.key;
                          const DirectionIcon = active
                            ? catalogTableSort.direction === "asc"
                              ? ArrowUp
                              : ArrowDown
                            : ArrowDownUp;
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
                              className={`p-1.5 sm:p-2 ${column.align === "end" ? "text-end" : "text-start"}`}
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
                                title={column.label}
                                className="inline-flex items-center gap-1 rounded-full px-1.5 py-1 transition hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                              >
                                {column.label}
                                <DirectionIcon
                                  className={`size-3 ${active ? "text-primary" : "opacity-40"}`}
                                  aria-hidden
                                />
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {tableRows.map((product) => (
                        <tr
                          key={product.id}
                          onClick={() => addToCart(product)}
                          className="cursor-pointer hover:bg-primary/5"
                        >
                          <td className="p-2 font-medium">
                            {lang === "ar"
                              ? product.name_ar || product.name
                              : product.name || product.name_ar}
                          </td>
                          <td className="p-2 font-mono text-muted-foreground">
                            {product.sku || product.barcode || "—"}
                          </td>
                          <td className="p-2 text-end">
                            {money(getDefaultPurchaseUom(product).purchase_price)}{" "}
                            <span className="text-muted-foreground">
                              /{getDefaultPurchaseUom(product).label}
                            </span>
                          </td>
                          <td className="p-2 text-end">
                            {(stockMap[product.id] ?? 0) /
                              Math.max(getDefaultPurchaseUom(product).factor_to_base, 0.000000001)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Infinite scroll sentinel */}
              {visibleFiltered.length < filtered.length && (
                <div
                  ref={catalogSentinelRef}
                  className="py-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>
                    {lang === "ar"
                      ? `جارٍ تحميل المزيد (${visibleFiltered.length} من ${filtered.length})...`
                      : `Loading more (${visibleFiltered.length} of ${filtered.length})...`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Column: Purchase Cart & Invoicing — the primary workspace. */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-primary/20 bg-surface/95 p-1.5 shadow-xl ring-1 ring-border/50 backdrop-blur-md sm:p-2 lg:col-start-2 lg:row-start-2">
          {/* Cart Header */}
          <div className="mb-2 flex shrink-0 items-center justify-between border-b border-border/60 px-1 pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-7 place-items-center rounded-full bg-primary/10 text-primary">
                <ShoppingBag className="h-4 w-4" />
              </div>
              <h2 className="flex items-center gap-2 text-xs font-bold text-foreground sm:text-sm">
                <span>{lang === "ar" ? "أصناف أمر الشراء" : "Purchase Items"}</span>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-mono font-extrabold text-primary">
                  {cart.length}
                </span>
              </h2>
            </div>
            {isDesktop ? (
              cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="grid size-8 shrink-0 place-items-center rounded-full border border-destructive/20 text-destructive transition hover:bg-destructive/10"
                  title={lang === "ar" ? "إفراغ السلة" : "Clear cart"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => setMobilePickerOpen(true)}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm active:scale-95"
                title={t("pos.add_product")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Cart lines and payment details share one scroll region. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
            <div className="my-1 space-y-1 pr-1">
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
                  <div key={line.line_id} className="space-y-2">
                    <CartLineRow
                      line={{
                        id: line.line_id,
                        name: line.name,
                        quantity: line.quantity,
                        unitPrice: line.unit_cost,
                        taxRate: line.tax_rate,
                        stock: Math.max(
                          0,
                          Number(stockMap[line.product_id] ?? 0) / (line.uom_factor || 1),
                        ),
                        unitId: line.uom_id,
                        unit: line.uom_label,
                        unitOptions: line.purchase_uoms.map((uom) => ({
                          id: uom.unit_id,
                          label: uom.label,
                        })),
                        quantityStep: line.quantity_increment,
                        unboundedQuantity: true,
                      }}
                      labels={{
                        price: lang === "ar" ? "سعر الشراء" : "Cost",
                        quantity: lang === "ar" ? "الكمية" : "Qty",
                        remove: lang === "ar" ? "حذف" : "Remove",
                        stockLabel: lang === "ar" ? "الرصيد التقريبي" : "Current stock",
                      }}
                      formatMoney={money}
                      onQuantityCommit={(next) => setQty(line.line_id, next)}
                      onPriceChange={(next) => setCost(line.line_id, next)}
                      onUnitChange={(unitId) => changePurchaseUom(line.line_id, unitId)}
                      onRemove={() => setCart((c) => c.filter((x) => x.line_id !== line.line_id))}
                    />
                    {line.tracking === "BATCH" && (
                      <div className="grid grid-cols-2 gap-2 ps-2">
                        <label className="space-y-1 text-[11px] text-muted-foreground">
                          <span>{lang === "ar" ? "رقم الدفعة *" : "Batch number *"}</span>
                          <input
                            required
                            dir="ltr"
                            value={line.batch_number}
                            onChange={(event) =>
                              updateCartLine(line.line_id, { batch_number: event.target.value })
                            }
                            className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground"
                          />
                        </label>
                        <label className="space-y-1 text-[11px] text-muted-foreground">
                          <span>{lang === "ar" ? "تاريخ الانتهاء" : "Expiry date"}</span>
                          <input
                            type="date"
                            value={line.expiry_date}
                            onChange={(event) =>
                              updateCartLine(line.line_id, { expiry_date: event.target.value })
                            }
                            className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Fixed payment and totals footer */}
          <div className="max-h-[56dvh] shrink-0 space-y-1.5 overflow-y-auto overscroll-contain border-t border-border/70 bg-surface/95 pt-2 pr-1">
            <div className="grid min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.8fr)] items-end gap-1.5">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[10px] font-semibold leading-none text-muted-foreground">
                  {lang === "ar" ? "طريقة الدفع" : "Payment method"}
                </span>
                <PaymentMethodPicker
                  context="purchases"
                  value={paymentMethod}
                  onChange={(method) => {
                    setPaymentMethod(method);
                    if (method !== "split") setSplitPaymentLines([]);
                    setPaid(method === "credit" ? "0" : "");
                    setPaidManuallyEdited(false);
                    setPaymentSelection((s) => ({
                      ...s,
                      method,
                      paymentMethodId: method === "cash" ? "cash" : s.paymentMethodId || method,
                    }));
                  }}
                  ensureIds={[paymentMethod]}
                  allowedLegacyValues={[
                    "cash",
                    "card",
                    "bank_transfer",
                    "credit",
                    "mobile_money",
                    "split",
                  ]}
                  ariaLabel={lang === "ar" ? "طريقة الدفع" : "Payment method"}
                  className="h-8 min-w-0 rounded-lg text-[10px] sm:text-xs"
                />
              </div>
              {paymentMethod === "split" && (
                <SplitPaymentEditor
                  total={total}
                  lines={splitPaymentLines}
                  methods={splitPaymentMethods}
                  onChange={setSplitPaymentLines}
                  lang={lang === "ar" ? "ar" : "en"}
                  className="col-span-full"
                />
              )}
              <AmountInput
                label={lang === "ar" ? "المبلغ المدفوع" : "Amount paid"}
                showLabel
                dir={lang === "ar" ? "rtl" : "ltr"}
                value={
                  paymentMethod === "credit"
                    ? "0"
                    : paymentMethod === "split"
                      ? String(splitPaidN)
                      : paidManuallyEdited
                        ? paid
                        : String(total)
                }
                disabled={paymentMethod === "split"}
                onValueChange={(value) => {
                  setPaid(value);
                  setPaidManuallyEdited(true);
                }}
                invalid={isOverpaid}
                placeholder={lang === "ar" ? "المدفوع" : "Paid"}
                className="h-8 rounded-lg border border-border/80 bg-surface px-2 text-[10px] outline-none focus:border-primary sm:text-[11px]"
              />
              <AmountInput
                label={lang === "ar" ? "الخصم" : "Discount"}
                showLabel
                dir={lang === "ar" ? "rtl" : "ltr"}
                value={discount}
                onValueChange={setDiscount}
                placeholder={lang === "ar" ? "الخصم" : "Discount"}
                className="h-8 rounded-lg border border-border/80 bg-surface px-2 text-[10px] outline-none focus:border-primary sm:text-[11px]"
              />
            </div>

            {/* Transfer reference input */}
            {(selectedPurchasePaymentMethod?.requiresReference ||
              paymentMethod === "bank_transfer" ||
              paymentMethod === "mobile_money") && (
              <input
                type="text"
                value={transferRef}
                onChange={(e) => {
                  setTransferRef(e.target.value);
                  setPaymentSelection((s) => ({ ...s, reference: e.target.value }));
                }}
                placeholder={
                  paymentMethod === "mobile_money"
                    ? paymentUiText("walletReference", lang === "ar" ? "ar" : "en")
                    : t("pos.pm.transfer_ref")
                }
                aria-label={
                  paymentMethod === "mobile_money"
                    ? paymentUiText("walletReference", lang === "ar" ? "ar" : "en")
                    : t("pos.pm.transfer_ref")
                }
                className="h-8 w-full rounded-xl border border-border/80 bg-surface px-2.5 text-xs text-foreground outline-none transition focus:border-primary"
              />
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

            <PosTotalsCard
              countLabel={lang === "ar" ? "عدد الأصناف" : "Items"}
              count={cart.reduce((sum, line) => sum + line.quantity, 0)}
              rows={[
                {
                  label: lang === "ar" ? "الإجمالي بدون ضريبة" : "Subtotal",
                  value: money(subtotal),
                },
                ...(taxTotal > 0
                  ? [{ label: lang === "ar" ? "قيمة الضريبة" : "Tax", value: money(taxTotal) }]
                  : []),
                ...(discountN > 0
                  ? [
                      {
                        label: lang === "ar" ? "الخصم" : "Discount",
                        value: `−${money(discountN)}`,
                      },
                    ]
                  : []),
                { label: lang === "ar" ? "المبلغ المدفوع" : "Amount paid", value: money(paidN) },
                ...(total - paidN > 0
                  ? [
                      {
                        label: lang === "ar" ? "المتبقي للمورد" : "Supplier balance",
                        value: money(total - paidN),
                      },
                    ]
                  : []),
              ]}
              totalLabel={lang === "ar" ? "الإجمالي" : "Total"}
              total={money(total)}
            />
          </div>

          {/* Actions stay outside the only scroll region. */}
          <div
            className="mt-2 flex shrink-0 gap-2 border-t border-border/70 bg-surface/95 pb-1 pt-2"
            dir={lang === "ar" ? "rtl" : "ltr"}
          >
            <button
              type="button"
              onClick={openPurchaseQuotation}
              disabled={cart.length === 0}
              className={`flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-transparent bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50 ${lang === "ar" ? "order-last" : ""}`}
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
              className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary/90 px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:shadow-primary/35 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 ${lang === "ar" ? "order-first" : ""}`}
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

      {/* Unified purchase-invoice print preview — same sheet as the Sales POS. */}
      {purchasePrintRequest ? (
        <UniversalPrintPreview
          open
          onOpenChange={(open) => {
            if (!open) setPurchasePrintRequest(null);
          }}
          request={purchasePrintRequest}
          title={lang === "ar" ? "معاينة فاتورة المشتريات" : "Purchase invoice preview"}
          rtl={lang === "ar"}
        />
      ) : null}

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
        pageSize={60}
        products={filtered.map((p) => ({
          id: p.id,
          name: (lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar) || "—",
          meta: p.sku || p.barcode || null,
          value: money(getDefaultPurchaseUom(p).purchase_price),
          sub: `${t("pos.stock")}: ${(stockMap[p.id] ?? 0) / Math.max(getDefaultPurchaseUom(p).factor_to_base, 0.000000001)} ${getDefaultPurchaseUom(p).label}`,
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

/** جسر التحويل بين سلسلة النموذج وقيمة `AmountInput` (`number | null`). */
function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
