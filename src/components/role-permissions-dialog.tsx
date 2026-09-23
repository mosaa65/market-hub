import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  Crown,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  Lock,
  ShoppingCart,
  Package,
  Boxes,
  Truck,
  Wallet,
  BarChart3,
  Settings,
  Users,
} from "lucide-react";

export type RoleDefinition = {
  id: "superadmin" | "owner" | "manager" | "accountant" | "cashier" | "warehouse";
  title: { ar: string; en: string };
  scope: { ar: string; en: string };
  badgeClass: string;
  icon: any;
  summary: { ar: string; en: string };
  primaryDuties: { ar: string[]; en: string[] };
  criticalRestrictions: { ar: string[]; en: string[] };
};

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: "superadmin",
    title: { ar: "سوبر أدمن (مدير المنصة)", en: "Platform Superadmin" },
    scope: { ar: "مستوى البنية السحابية الشاملة", en: "Global Platform SaaS Layer" },
    badgeClass: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40",
    icon: Crown,
    summary: {
      ar: "المسؤول الأعلى عن إدارة خوادم وتراخيص المنصة السحابية والتحكم في باقات وموديلات المستأجرين وسجلات الأمان الشاملة.",
      en: "Highest platform administrator responsible for subscriptions, module licenses, and global infrastructure.",
    },
    primaryDuties: {
      ar: [
        "إدارة وتفعيل باقات النظام وتراخيص المستأجرين",
        "تفعيل وتعطيل الوحدات الموديلية والـ Add-ons السحابية",
        "مراقبة سجلات التدقيق الشاملة على مستوى السيرفر (Audit Trail)",
        "إدارة مفاتيح الأمان وتراخيص الحصص للمستودعات والمستخدمين",
      ],
      en: [
        "Manage platform tenant subscriptions and quotas",
        "Enable/disable modular system extensions and add-ons",
        "Inspect platform security and system-wide audit logs",
        "Enforce license keys and resource allocations",
      ],
    },
    criticalRestrictions: {
      ar: [
        "لا يختلط بجدول موظفي المتجر المحلي العاديين",
        "صلاحياته سيادية على مستوى المنصة السحابية بالكامل",
      ],
      en: ["Isolated from normal tenant staff roster", "Sovereign platform-level permissions"],
    },
  },
  {
    id: "owner",
    title: { ar: "المالك (صاحب المنشأة)", en: "Tenant Owner" },
    scope: { ar: "إدارة المنشأة والمتجر بالكامل", en: "Full Store & Business Sovereignty" },
    badgeClass: "bg-primary/20 text-primary border-primary/40",
    icon: ShieldCheck,
    summary: {
      ar: "المفوض المالي والإداري الأول لصاحب العمل؛ يملك السيطرة الكاملة على العمليات والموظفين والأرباح والتقارير الختامية للمتجر.",
      en: "Business owner with unrestricted governance over store operations, staff roles, and financials.",
    },
    primaryDuties: {
      ar: [
        "إضافة وحذف الموظفين وتعيين وتعديل أدوارهم وصلاحياتهم",
        "الاطلاع على أرباح المنشأة وتكاليف المنتجات والقوائم المالية",
        "التحكم في إعدادات المنشأة والفروع والمستودعات والضريبة",
        "ترقية أو طلب تغيير باقة المتجر والوحدات الإضافية",
      ],
      en: [
        "Add/remove employees and grant role privileges",
        "Full visibility into profits, product costs, and balance sheets",
        "Configure company profile, branches, warehouses, and taxes",
        "Manage subscription upgrades and store modules",
      ],
    },
    criticalRestrictions: {
      ar: [
        "لا يمكن لأي دور آخر تعديل أو حذف حسابه",
        "يتحمل المسؤولية القانونية والمحاسبية عن كافة بيانات المتجر",
      ],
      en: [
        "Cannot be deleted or demoted by other roles",
        "Ultimate legal and operational custodian",
      ],
    },
  },
  {
    id: "manager",
    title: { ar: "المدير (مدير العمليات)", en: "Operations Manager" },
    scope: { ar: "العمليات التشغيلية اليومية للمتجر", en: "Store Operations & Daily Workflow" },
    badgeClass: "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/40",
    icon: ShieldCheck,
    summary: {
      ar: "المسؤول عن إدارة المبيعات والمشتريات والمخازن والعملاء والموردين ومتابعة أداء الموظفين دون المساس بإعدادات المنشأة السيادية.",
      en: "Oversees sales, purchases, inventory, suppliers, and staff daily workflow without store sovereignty.",
    },
    primaryDuties: {
      ar: [
        "إدارة فواتير المبيعات والمشتريات والطلبيات",
        "متابعة المخزون والجرد والتحويلات بين المستودعات",
        "إدارة ملفات العملاء والموردين وخطوط الائتمان",
        "تعديل أسعار بيع المنتجات والعروض الترويجية",
      ],
      en: [
        "Manage sales, purchases, and order fulfillment",
        "Supervise inventory, cycle counts, and transfers",
        "Manage customer and vendor profiles and credit terms",
        "Update product retail prices and promo discounts",
      ],
    },
    criticalRestrictions: {
      ar: [
        "محظور: حذف أو تعديل صلاحيات حساب المالك",
        "محظور: تغيير بيانات السجل التجاري أو فروع المنشأة الحساسة",
      ],
      en: [
        "Forbidden: Delete or modify Owner accounts",
        "Forbidden: Modify business registration or primary branches",
      ],
    },
  },
  {
    id: "accountant",
    title: { ar: "المحاسب (الإدارة المالية)", en: "Accountant" },
    scope: { ar: "الرقابة المالية والدورة المستندية", en: "Financial & Ledger Control" },
    badgeClass: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
    icon: Wallet,
    summary: {
      ar: "المسؤول عن القيود المحاسبية، متابعة الذمم المدينة والدائنة، سندات القبض والصرف، وإعداد ميزان المراجعة والقوائم المالية الختامية.",
      en: "Manages financial entries, customer/vendor statements, receivables, vouchers, and balance sheets.",
    },
    primaryDuties: {
      ar: [
        "تسجيل وتدقيق سندات القبض والصرف والمصروفات اليومية",
        "متابعة كشوفات حسابات العملاء والموردين وجدولة الديون",
        "إعداد دفتر اليومية، ميزان المراجعة، وقائمة الدخل",
        "مراجعة تكاليف المنتجات وهوامش الربح للتسويات الضريبية والمالية",
      ],
      en: [
        "Record and audit receipt/payment vouchers and expenses",
        "Track customer and supplier balances and debt aging",
        "Compile general ledger, trial balance, and income statements",
        "Analyze cost prices and profit margins for accounting audits",
      ],
    },
    criticalRestrictions: {
      ar: [
        "محظور: تعديل أسعار البيع أو شطب المنتجات من المخازن",
        "محظور: إدارة المستخدمين أو تعديل الإعدادات الإدارية",
        "محظور: إصدار فواتير بيع كاشير مباشر",
      ],
      en: [
        "Forbidden: Modify retail prices or delete catalog products",
        "Forbidden: Manage user accounts or company settings",
        "Forbidden: Operate POS checkout cash registers",
      ],
    },
  },
  {
    id: "cashier",
    title: { ar: "الكاشير (نقطة البيع)", en: "Cashier (POS)" },
    scope: { ar: "البيع المباشر وخدمة العملاء", en: "Front Desk & POS Checkout" },
    badgeClass: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40",
    icon: ShoppingCart,
    summary: {
      ar: "المسؤول المباشر عن واجهة البيع السريعة، مسح الباركود، تحصيل المبالغ النقدية وطباعة الفواتير ومرتجعات العملاء.",
      en: "Operates fast checkout counter, barcode scanning, payment collection, and direct receipt printing.",
    },
    primaryDuties: {
      ar: [
        "تشغيل شاشة نقطة البيع (POS) وقراءة الباركود",
        "إصدار فواتير البيع النقدية والآجلة للعملاء",
        "إجراء مرتجعات المبيعات المباشرة وفق سياسة الاسترجاع",
        "استلام المدفوعات النقدية وطباعة الإيصالات الحرارية",
      ],
      en: [
        "Operate POS screen and barcode scanners",
        "Generate cash and credit customer sales invoices",
        "Process authorized customer sales returns",
        "Collect cash payments and print thermal receipts",
      ],
    },
    criticalRestrictions: {
      ar: [
        "محظور قطعياً: الاطلاع على تكاليف الشراء (Cost Price) وأرباح المنتجات",
        "محظور قطعياً: الوصول للتقارير الختامية، دفتر اليومية، والميزانية",
        "محظور: حذف الفواتير المحررة أو تعديل الأسعار الرسمية دون إذن",
        "محظور: إدارة المستخدمين أو الوصول للمشتريات والموردين",
      ],
      en: [
        "Strictly Forbidden: View product cost prices or profit margins",
        "Strictly Forbidden: Access balance sheets or general ledger",
        "Forbidden: Delete posted invoices or override catalog prices",
        "Forbidden: Manage users, purchases, or vendor ledgers",
      ],
    },
  },
  {
    id: "warehouse",
    title: { ar: "أمين المستودع (المخازن)", en: "Warehouse Keeper" },
    scope: { ar: "حركة البضائع اللوجستية والجرد", en: "Inventory & Stock Logistics" },
    badgeClass: "bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/40",
    icon: Boxes,
    summary: {
      ar: "المسؤول عن استلام شحنات البضائع، الجرد المخزني، التحويلات بين الفروع والمستودعات، وتتبع الدفعات وتواريخ الصلاحية والرفوف.",
      en: "Responsible for receiving purchase shipments, cycle counts, warehouse transfers, and batch tracking.",
    },
    primaryDuties: {
      ar: [
        "استقبال بضائع فواتير الشراء وتأكيد إدخالها للمخزن",
        "إجراء الجرد المخزني الفعلي ومطابقة الأرصدة",
        "تنفيذ التحويلات المخزنية بين الفروع والمستودعات",
        "تتبع أرقام التشغيلات (Batches) وتواريخ الصلاحية والرفوف",
        "طباعة ملصقات الباركود والبطاقات التعريفية للبضائع",
      ],
      en: [
        "Receive purchase goods and confirm warehouse intake",
        "Conduct physical inventory cycle counts",
        "Execute inter-warehouse stock transfers",
        "Track lot/batch numbers, expiry dates, and shelf locations",
        "Generate and print item barcode label stickers",
      ],
    },
    criticalRestrictions: {
      ar: [
        "محظور: بيع البضائع أو فتح واجهة الكاشير POS",
        "محظور: الاطلاع على الأرباح المالية أو كشوفات حسابات العملاء",
        "محظور: الوصول لسجلات المحاسبة الختامية والقيود المالية",
        "محظور: إضافة أو تعديل أدوار المستخدمين",
      ],
      en: [
        "Forbidden: Issue sales receipts or access POS register",
        "Forbidden: View net profits or customer balance sheets",
        "Forbidden: View financial journals or general ledger",
        "Forbidden: Modify user accounts or system settings",
      ],
    },
  },
];

type CapabilityGroup = {
  category: { ar: string; en: string };
  features: {
    name: { ar: string; en: string };
    superadmin: "full" | "partial" | "none";
    owner: "full" | "partial" | "none";
    manager: "full" | "partial" | "none";
    accountant: "full" | "partial" | "none";
    cashier: "full" | "partial" | "none";
    warehouse: "full" | "partial" | "none";
    notes?: { ar: string; en: string };
  }[];
};

export const CAPABILITY_MATRIX: CapabilityGroup[] = [
  {
    category: { ar: "إدارة المنصة والتراخيص (Platform & Licensing)", en: "Platform & Licensing" },
    features: [
      {
        name: {
          ar: "تعديل باقات النظام وترقية التراخيص",
          en: "Modify Platform Plans & Subscriptions",
        },
        superadmin: "full",
        owner: "full",
        manager: "none",
        accountant: "none",
        cashier: "none",
        warehouse: "none",
        notes: {
          ar: "السوبر أدمن يمتلك التحكم بالمنصة والمالك يمتلك ترقية اشتراكه",
          en: "Superadmin manages SaaS tier; Owner manages tenant upgrade",
        },
      },
      {
        name: {
          ar: "التحكم بالوحدات الموديلية والـ Add-ons",
          en: "Toggle System Modules & Add-ons",
        },
        superadmin: "full",
        owner: "full",
        manager: "none",
        accountant: "none",
        cashier: "none",
        warehouse: "none",
      },
      {
        name: { ar: "سجل التدقيق الشامل للمنصة (Platform Audit)", en: "Platform Audit Logs" },
        superadmin: "full",
        owner: "full",
        manager: "partial",
        accountant: "none",
        cashier: "none",
        warehouse: "none",
      },
    ],
  },
  {
    category: { ar: "إدارة المستخدمين والأدوار (Users & Governance)", en: "Users & Governance" },
    features: [
      {
        name: { ar: "إضافة وتعيين أدوار الموظفين بالمتجر", en: "Add & Assign Store Roles" },
        superadmin: "full",
        owner: "full",
        manager: "none",
        accountant: "none",
        cashier: "none",
        warehouse: "none",
        notes: {
          ar: "حصري للمالك (والسوبر أدمن في حالات الدعم)",
          en: "Restricted to Owner (and Superadmin for support)",
        },
      },
      {
        name: { ar: "حذف أو تعديل حساب المالك", en: "Modify or Demote Owner Account" },
        superadmin: "full",
        owner: "full",
        manager: "none",
        accountant: "none",
        cashier: "none",
        warehouse: "none",
        notes: {
          ar: "مستحيل على أي دور تشغيلي آخر",
          en: "Strictly protected from operational staff",
        },
      },
    ],
  },
  {
    category: { ar: "المبيعات ونقاط البيع (Sales & POS)", en: "Sales & POS" },
    features: [
      {
        name: { ar: "تشغيل نقطة البيع POS وإصدار الفواتير", en: "Operate POS Counter & Checkout" },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "none",
        cashier: "full",
        warehouse: "none",
      },
      {
        name: { ar: "مرتجعات المبيعات وتسوية الذمم", en: "Sales Returns & Balance Adjustment" },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "full",
        cashier: "partial",
        warehouse: "none",
        notes: {
          ar: "الكاشير يرجع الفاتورة المباشرة فقط، المحاسب والمدير يسويان الحساب",
          en: "Cashier processes direct return; Accountant adjusts ledger",
        },
      },
    ],
  },
  {
    category: { ar: "إدارة المنتجات والتسعير (Products & Pricing)", en: "Products & Pricing" },
    features: [
      {
        name: {
          ar: "إضافة وتعديل بيانات المنتجات وسعر البيع",
          en: "Create & Update Product Retail Prices",
        },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "partial",
        cashier: "none",
        warehouse: "none",
      },
      {
        name: {
          ar: "الاطلاع على سعر التكلفة (Cost Price) وهامش الربح",
          en: "View Purchase Cost & Profit Margins",
        },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "full",
        cashier: "none",
        warehouse: "none",
        notes: {
          ar: "سري للغاية: محجوب تماماً عن الكاشير وأمين المستودع",
          en: "Strictly hidden from Cashiers and Warehouse Keepers",
        },
      },
    ],
  },
  {
    category: { ar: "المستودعات والمخزون (Inventory & Logistics)", en: "Inventory & Logistics" },
    features: [
      {
        name: {
          ar: "الجرد المخزني وتعديل الأرصدة الفعلية",
          en: "Cycle Counts & Stock Adjustments",
        },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "partial",
        cashier: "none",
        warehouse: "full",
      },
      {
        name: { ar: "التحويلات بين المستودعات والفروع", en: "Inter-Warehouse Stock Transfers" },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "none",
        cashier: "none",
        warehouse: "full",
      },
      {
        name: {
          ar: "تتبع الدفعات وتواريخ الصلاحية والباركود",
          en: "Batches, Expiry Tracking & Barcode Labels",
        },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "none",
        cashier: "none",
        warehouse: "full",
      },
    ],
  },
  {
    category: { ar: "المشتريات والموردون (Purchases & Vendors)", en: "Purchases & Vendors" },
    features: [
      {
        name: { ar: "إنشاء واعتماد فواتير المشتريات", en: "Create Purchase Invoices" },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "full",
        cashier: "none",
        warehouse: "partial",
        notes: {
          ar: "أمين المستودع يؤكد استلام الأصناف فقط",
          en: "Warehouse confirms physical receipt only",
        },
      },
      {
        name: { ar: "إدارة حسابات الموردين والدفعات", en: "Vendor Accounts & Disbursements" },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "full",
        cashier: "none",
        warehouse: "none",
      },
    ],
  },
  {
    category: {
      ar: "المالية والمحاسبة المتقدمة (Accounting & Reports)",
      en: "Accounting & Financials",
    },
    features: [
      {
        name: { ar: "سندات القبض ومتابعة ديون العملاء", en: "Receivables & Debt Aging Ledger" },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "full",
        cashier: "none",
        warehouse: "none",
      },
      {
        name: { ar: "المصروفات التشغيلية والتدفق النقدي", en: "Operating Expenses & Cashflow" },
        superadmin: "full",
        owner: "full",
        manager: "full",
        accountant: "full",
        cashier: "none",
        warehouse: "none",
      },
      {
        name: {
          ar: "دفتر اليومية، ميزان المراجعة، والقوائم المالية",
          en: "Journal, Trial Balance & Income Statement",
        },
        superadmin: "full",
        owner: "full",
        manager: "partial",
        accountant: "full",
        cashier: "none",
        warehouse: "none",
        notes: {
          ar: "محجوب عن الكاشير وأمين المخزن تماماً",
          en: "Strictly hidden from Cashiers & Warehouse",
        },
      },
    ],
  },
];

export function RolePermissionsDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [activeTab, setActiveTab] = useState<"matrix" | "cards" | "rules">("matrix");

  const renderBadge = (status: "full" | "partial" | "none") => {
    if (status === "full") {
      return (
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 stroke-[2.5]" />
        </span>
      );
    }
    if (status === "partial") {
      return (
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 stroke-[2.5]" />
        </span>
      );
    }
    return (
      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-muted/60 text-muted-foreground/50">
        <XCircle className="h-4 w-4 stroke-[1.8]" />
      </span>
    );
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            className="gap-2 rounded-full border-primary/40 text-xs font-semibold"
          >
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>
              {isAr ? "دليل ومصفوفة مقارنة الصلاحيات والأدوار" : "Role Permissions Matrix & Guide"}
            </span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto custom-scrollbar p-6">
        <DialogHeader className="pb-4 border-b border-border/70">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/15 text-primary border border-primary/25">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <span>
                  {isAr
                    ? "دليل ومصفوفة مقارنة صلاحيات أدوار النظام"
                    : "System Roles & Permissions Matrix"}
                </span>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono border-primary/30 text-primary"
                >
                  Vortex RBAC Matrix
                </Badge>
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "توضيح دقيق للفروق الأمنية والوظيفية بين السوبر أدمن، المالك، المدير، المحاسب، الكاشير، وأمين المستودع."
                  : "Comprehensive breakdown of functional privileges and security constraints across system roles."}
              </p>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex items-center gap-2 mt-4 pt-2">
            <button
              onClick={() => setActiveTab("matrix")}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                activeTab === "matrix"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-surface text-muted-foreground hover:text-foreground border border-border",
              )}
            >
              {isAr ? "مصفوفة الصلاحيات المقارنة (Matrix)" : "Permissions Matrix"}
            </button>
            <button
              onClick={() => setActiveTab("cards")}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                activeTab === "cards"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-surface text-muted-foreground hover:text-foreground border border-border",
              )}
            >
              {isAr ? "البطاقات التعريفية للأدوار" : "Role Profiles"}
            </button>
            <button
              onClick={() => setActiveTab("rules")}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                activeTab === "rules"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-surface text-muted-foreground hover:text-foreground border border-border",
              )}
            >
              {isAr ? "الضوابط والمحظورات الأمنية" : "Security Rules"}
            </button>
          </div>
        </DialogHeader>

        {/* Tab 1: Matrix View */}
        {activeTab === "matrix" && (
          <div className="space-y-6 pt-4">
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 p-3 rounded-2xl bg-surface border border-border/70 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center font-bold">
                  ✓
                </span>
                <span className="text-foreground font-medium">
                  {isAr ? "صلاحية كاملة (Full Access)" : "Full Access"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center font-bold">
                  !
                </span>
                <span className="text-foreground font-medium">
                  {isAr ? "صلاحية مقيدة / قراءة فقط (Partial / View)" : "Partial / View"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-bold">
                  ✕
                </span>
                <span className="text-muted-foreground">
                  {isAr ? "محظور تماماً (Forbidden)" : "Restricted / None"}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/80 bg-surface/80 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 text-start font-bold min-w-[220px]">
                      {isAr ? "الوظيفة / الصلاحية" : "Module / Capability"}
                    </th>
                    <th className="px-3 py-3 text-center font-bold text-amber-500">
                      {isAr ? "السوبر أدمن" : "Superadmin"}
                    </th>
                    <th className="px-3 py-3 text-center font-bold text-primary">
                      {isAr ? "المالك" : "Owner"}
                    </th>
                    <th className="px-3 py-3 text-center font-bold text-blue-500">
                      {isAr ? "المدير" : "Manager"}
                    </th>
                    <th className="px-3 py-3 text-center font-bold text-emerald-500">
                      {isAr ? "المحاسب" : "Accountant"}
                    </th>
                    <th className="px-3 py-3 text-center font-bold text-cyan-500">
                      {isAr ? "الكاشير" : "Cashier"}
                    </th>
                    <th className="px-3 py-3 text-center font-bold text-orange-500">
                      {isAr ? "المستودع" : "Warehouse"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {CAPABILITY_MATRIX.map((group, gIdx) => (
                    <>
                      <tr
                        key={`group-${gIdx}`}
                        className="bg-surface/90 font-bold text-foreground/90"
                      >
                        <td colSpan={7} className="px-4 py-2 text-[11px] text-primary">
                          {isAr ? group.category.ar : group.category.en}
                        </td>
                      </tr>
                      {group.features.map((f, fIdx) => (
                        <tr
                          key={`feat-${gIdx}-${fIdx}`}
                          className="hover:bg-accent/30 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-medium text-foreground">
                            <div>{isAr ? f.name.ar : f.name.en}</div>
                            {f.notes && (
                              <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                                * {isAr ? f.notes.ar : f.notes.en}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">{renderBadge(f.superadmin)}</td>
                          <td className="px-3 py-2.5 text-center">{renderBadge(f.owner)}</td>
                          <td className="px-3 py-2.5 text-center">{renderBadge(f.manager)}</td>
                          <td className="px-3 py-2.5 text-center">{renderBadge(f.accountant)}</td>
                          <td className="px-3 py-2.5 text-center">{renderBadge(f.cashier)}</td>
                          <td className="px-3 py-2.5 text-center">{renderBadge(f.warehouse)}</td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Role Profiles Cards */}
        {activeTab === "cards" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
            {ROLE_DEFINITIONS.map((r) => {
              const Icon = r.icon;
              return (
                <div
                  key={r.id}
                  className="rounded-2xl border border-border/80 bg-surface/90 p-5 space-y-3.5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          "grid h-9 w-9 place-items-center rounded-xl border",
                          r.badgeClass,
                        )}
                      >
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-foreground">
                          {isAr ? r.title.ar : r.title.en}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {isAr ? r.scope.ar : r.scope.en}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] font-semibold", r.badgeClass)}
                    >
                      {r.id.toUpperCase()}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {isAr ? r.summary.ar : r.summary.en}
                  </p>

                  {/* Duties */}
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] font-bold text-foreground/90 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span>{isAr ? "المسؤوليات والصلاحيات الرئيسية:" : "Key Privileges:"}</span>
                    </div>
                    <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside ps-1">
                      {(isAr ? r.primaryDuties.ar : r.primaryDuties.en).map((duty, dIdx) => (
                        <li key={dIdx} className="leading-snug">
                          {duty}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Restrictions */}
                  <div className="space-y-1.5 pt-1 border-t border-border/60">
                    <div className="text-[11px] font-bold text-destructive/90 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-destructive" />
                      <span>{isAr ? "الحدود والمحظورات الأمنية:" : "Security Boundaries:"}</span>
                    </div>
                    <ul className="space-y-1 text-xs text-destructive/80 list-disc list-inside ps-1">
                      {(isAr ? r.criticalRestrictions.ar : r.criticalRestrictions.en).map(
                        (rest, rIdx) => (
                          <li key={rIdx} className="leading-snug">
                            {rest}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab 3: Security & Governance Rules */}
        {activeTab === "rules" && (
          <div className="space-y-4 pt-4 text-xs leading-relaxed text-foreground">
            <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-600 dark:text-amber-400 text-sm">
                <ShieldAlert className="h-4 w-4" />
                <span>
                  {isAr
                    ? "1. الفصل الحاسم بين السوبر أدمن والمالك"
                    : "1. Separation of Superadmin & Tenant Owner"}
                </span>
              </div>
              <p className="text-muted-foreground">
                {isAr
                  ? "السوبر أدمن يختص بإدارة سيرفرات المنصة السحابية والتراخيص والباقات عبر جدول مستقل تماماً (platform_admins)، ولا يجب خلطه أو عرضه ضمن كشف موظفي المتجر العاديين. في المقابل، المالك هو صاحب المنشأة التجارية المخول وحده بإدارة فروع ونشاط المتجر."
                  : "Superadmin manages SaaS infrastructure and licensing via platform_admins table, isolated from store staff. The Owner governs store operations."}
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-destructive/30 bg-destructive/5 space-y-2">
              <div className="flex items-center gap-2 font-bold text-destructive text-sm">
                <Lock className="h-4 w-4" />
                <span>
                  {isAr
                    ? "2. حجب تكلفة الشراء (Cost Price) وهوامش الربح عن الكاشير والمستودع"
                    : "2. Cost Price Secrecy"}
                </span>
              </div>
              <p className="text-muted-foreground">
                {isAr
                  ? "من أكبر الأخطاء الإدارية تمكين الكاشير أو أمين المستودع من رؤية سعر تكلفة شراء المنتج أو أرباح البيع. النظام يقوم بحجب عمود التكلفة وحقوله تلقائياً عن أي مستخدم بدور كاشير أو مستودع، ويقصره على المالك والمدير والمحاسب."
                  : "Cost prices and net profit margins are strictly hidden from Cashiers and Warehouse Keepers to prevent price leakage."}
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-blue-500/30 bg-blue-500/5 space-y-2">
              <div className="flex items-center gap-2 font-bold text-blue-600 dark:text-blue-400 text-sm">
                <Users className="h-4 w-4" />
                <span>
                  {isAr
                    ? "3. حصرية إدارة وتوزيع الأدوار للمالك فقط"
                    : "3. Role Governance Exclusivity"}
                </span>
              </div>
              <p className="text-muted-foreground">
                {isAr
                  ? "لا يحق لأي مدير أو محاسب إضافة مستخدمين جدد أو ترقية أنفسهم. إدارة المستخدمين وتعيين صلاحيات كل موظف هي صلاحية سيادية للمالك وحده لحماية أمان المنشأة."
                  : "Only the Owner has the sovereign privilege to invite employees and grant or revoke operational roles."}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
