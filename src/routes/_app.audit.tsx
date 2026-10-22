import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  History,
  Shield,
  Filter,
  Download,
  RefreshCw,
  User,
  Clock,
  Copy,
  Check,
  Eye,
  PlusCircle,
  Edit3,
  Trash2,
  LogIn,
  AlertTriangle,
  ArrowUpDown,
  Calendar,
  Layers,
  FileText,
  SlidersHorizontal,
  ShieldCheck,
  ArrowDownRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  VortexMetricCard,
  VortexSearchInput,
  VortexFilterSheet,
  VortexFilterSection,
  VortexDateBadge,
} from "@/components/vortex-ui";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toSystemDigits, formatLuxuryDate } from "@/lib/format-preferences";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/audit")({
  head: () => ({ meta: [{ title: "سجل الأحداث — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="audit">
      <AuditPage />
    </ModuleGuard>
  ),
});

interface Log {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: any;
  created_at: string;
}

// Entity names translation dictionary
// Entity names comprehensive translation dictionary
const ENTITY_TRANSLATIONS: Record<string, { label: string; icon?: any }> = {
  customer: { label: "العملاء" },
  customers: { label: "العملاء" },
  supplier: { label: "الموردين" },
  suppliers: { label: "الموردين" },
  sale: { label: "المبيعات" },
  sales: { label: "المبيعات" },
  pos: { label: "نقاط البيع" },
  order: { label: "الطلبات" },
  orders: { label: "الطلبات" },
  invoice: { label: "الفواتير" },
  invoices: { label: "الفواتير" },
  purchase: { label: "المشتريات" },
  purchases: { label: "المشتريات" },
  purchase_return: { label: "مرتجعات المشتريات" },
  purchase_returns: { label: "مرتجعات المشتريات" },
  sales_return: { label: "مرتجعات المبيعات" },
  sales_returns: { label: "مرتجعات المبيعات" },
  product: { label: "المنتجات والأصناف" },
  products: { label: "المنتجات والأصناف" },
  item: { label: "الأصناف" },
  items: { label: "الأصناف" },
  category: { label: "التصنيفات" },
  categories: { label: "التصنيفات" },
  brand: { label: "العلامات التجارية" },
  brands: { label: "العلامات التجارية" },
  unit: { label: "وحدات القياس" },
  units: { label: "وحدات القياس" },
  inventory: { label: "المخزون والجرد" },
  inventory_adjustment: { label: "تسويات المخزون" },
  adjustment: { label: "تسويات الجرد" },
  batch: { label: "الدفعات وتواريخ الصلاحية" },
  batches: { label: "الدفعات وتواريخ الصلاحية" },
  warehouse: { label: "المستودعات والفروع" },
  warehouses: { label: "المستودعات والفروع" },
  payment: { label: "السندات والتحصيلات" },
  payments: { label: "السندات والتحصيلات" },
  customer_payments: { label: "تحصيلات العملاء" },
  supplier_payments: { label: "مدفوعات الموردين" },
  settlement: { label: "التسويات المالية" },
  settlements: { label: "التسويات المالية" },
  user: { label: "المستخدمين والموظفين" },
  users: { label: "المستخدمين والموظفين" },
  profile: { label: "الملف الشخصي" },
  profiles: { label: "الملفات الشخصية" },
  role: { label: "الصلاحيات والأدوار" },
  roles: { label: "الصلاحيات والأدوار" },
  permission: { label: "أذونات النظام" },
  permissions: { label: "أذونات النظام" },
  setting: { label: "إعدادات النظام" },
  settings: { label: "إعدادات النظام" },
  company: { label: "بيانات المنشأة" },
  organization: { label: "المنشأة" },
  session: { label: "جلسات العمل" },
  sessions: { label: "جلسات العمل" },
  auth: { label: "الأمان وتسجيل الدخول" },
  loyalty: { label: "برنامج الولاء والنقاط" },
  barcode: { label: "الباركود والملصقات" },
  barcodes: { label: "الباركود والملصقات" },
  account: { label: "دليل الحسابات المالية" },
  accounts: { label: "دليل الحسابات المالية" },
  journal_entry: { label: "القيود اليومية" },
  journal_entries: { label: "القيود اليومية" },
  debt: { label: "الديون والمستحقات" },
  debts: { label: "الديون والمستحقات" },
  audit_log: { label: "سجل التدقيق" },
  audit: { label: "سجل التدقيق" },
};

// Comprehensive Dictionary for Payload Field Keys
const FIELD_TRANSLATIONS: Record<string, string> = {
  id: "معرف السجل",
  name: "الاسم",
  full_name: "الاسم الكامل",
  display_name: "الاسم المعروض",
  email: "البريد الإلكتروني",
  phone: "رقم الهاتف",
  mobile: "رقم الجوال",
  status: "الحالة",
  role: "الصلاحية / الدور",
  roles: "الأدوار والصلاحيات",
  balance: "الرصيد المالي",
  amount: "المبلغ",
  total: "الإجمالي",
  total_amount: "المبلغ الإجمالي",
  subtotal: "المجموع الفرعي",
  tax: "مبلغ الضريبة",
  tax_amount: "مبلغ الضريبة",
  tax_rate: "نسبة الضريبة",
  discount: "الخصم",
  discount_amount: "قيمة الخصم",
  price: "سعر البيع",
  selling_price: "سعر البيع",
  cost: "سعر التكلفة",
  cost_price: "سعر التكلفة",
  quantity: "الكمية",
  qty: "الكمية",
  stock: "الرصيد المخزني",
  min_stock: "الحد الأدنى للطلب",
  barcode: "رمز الباركود",
  sku: "رمز الصنف (SKU)",
  unit: "الوحدة",
  unit_name: "اسم الوحدة",
  category: "التصنيف",
  category_id: "معرف التصنيف",
  brand: "العلامة التجارية",
  brand_id: "معرف العلامة",
  warehouse: "المستودع",
  warehouse_id: "معرف المستودع",
  customer: "العميل",
  customer_id: "معرف العميل",
  supplier: "المورد",
  supplier_id: "معرف المورد",
  invoice: "الفاتورة",
  invoice_id: "معرف الفاتورة",
  invoice_number: "رقم الفاتورة",
  reference_number: "رقم المرجع / الإيصال",
  receipt_number: "رقم السند",
  payment_method: "طريقة الدفع",
  notes: "ملاحظات",
  note: "ملاحظة",
  description: "الوصف والتفاصيل",
  address: "العنوان",
  city: "المدينة",
  country: "الدولة",
  created_at: "تاريخ الإنشاء",
  updated_at: "تاريخ آخر تعديل",
  deleted_at: "تاريخ الحذف",
  date: "التاريخ",
  payment_date: "تاريخ السداد",
  due_date: "تاريخ الاستحقاق",
  expiry_date: "تاريخ الانتهاء",
  production_date: "تاريخ الإنتاج",
  batch_number: "رقم الدفعة (التشغيلة)",
  is_active: "الحالة التشغيلية",
  enabled: "التفعيل",
  disabled: "التعطيل",
  ip_address: "عنوان IP",
  user_agent: "المتصفح والجهاز",
  actor_id: "معرف المستخدم المنفذ",
  entity_type: "نوع الكيان",
  entity_id: "معرف الكيان",
  action: "نوع الإجراء",
  old_values: "القيم السابقة قبل التعديل",
  new_values: "القيم الجديدة بعد التعديل",
  changes: "الحقول المعدلة",
  items_count: "عدد الأصناف",
  currency: "العملة",
  credit_limit: "سقف المديونية (الائتمان)",
};

// Common Value Translations
const VALUE_TRANSLATIONS: Record<string, string> = {
  active: "نشط",
  inactive: "غير نشط",
  enabled: "مفعل",
  disabled: "معطل",
  pending: "قيد المعالجة / معلق",
  completed: "مكتمل بنجاح",
  paid: "مدفوع بالكامل",
  unpaid: "غير مدفوع",
  partially_paid: "مدفوع جزئياً",
  cancelled: "ملغي",
  draft: "مسودة غير معتمدة",
  posted: "مرحل ومعتمد",
  // Payment ENUM values, mirroring the `audit.value.*` keys in the i18n
  // dictionary. This is a generic value dictionary for the audit log — the same
  // table also translates statuses, roles and booleans — not an option list, so
  // it stays a lookup rather than calling the catalogue (an audit row can carry
  // any value, payment or not). `split` is included so the two dictionaries
  // cannot drift: it was the one ENUM value missing from the pair.
  cash: "نقداً (كاش)",
  card: "بطاقة مدى / شبكة",
  bank_transfer: "حوالة بنكية",
  credit: "آجل / ذمم",
  mobile_money: "محفظة إلكترونية",
  cheque: "شيك مصرفي",
  split: "دفع بأكثر من طريقة",
  admin: "مدير النظام",
  manager: "مشرف عام",
  cashier: "كاشير / بائع",
  user: "مستخدم",
  true: "نعم (مفعل)",
  false: "لا (معطل)",
  null: "غير محدد",
  undefined: "غير متوفر",
};

export function translateFieldKey(key: string): string {
  const cleanKey = key.trim().toLowerCase();
  if (FIELD_TRANSLATIONS[cleanKey]) {
    return FIELD_TRANSLATIONS[cleanKey];
  }
  // If formatted like snake_case or camelCase, give a readable attempt
  return cleanKey.replace(/_/g, " ");
}

/**
 * ترجمة مفاتيح حقول الـ payload عبر نظام الترجمة المركزي.
 * تُستخدم عندما يكون مترجم i18n متاحًا، وإلا تُستعمل القواميس المضمّنة أعلاه.
 */
export function translateFieldKeyI18n(
  key: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const dictKey = `audit.field.${key.trim().toLowerCase()}`;
  const translated = t(dictKey);
  if (translated !== dictKey) return translated;
  return translateFieldKey(key);
}

export function translateValue(val: any): string {
  if (val === null || val === undefined) return "غير محدد";
  if (typeof val === "boolean") return val ? "نعم (مفعل)" : "لا (معطل)";
  const str = String(val).trim().toLowerCase();
  if (VALUE_TRANSLATIONS[str]) {
    return VALUE_TRANSLATIONS[str];
  }
  return String(val);
}

/** ترجمة قيم الـ payload عبر نظام الترجمة المركزي مع الرجوع للقاموس المضمّن. */
export function translateValueI18n(
  val: any,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  if (val === null || val === undefined) return t("audit.value.unspecified");
  if (typeof val === "boolean") return val ? t("audit.value.yes") : t("audit.value.no");
  const str = String(val).trim().toLowerCase();
  const dictKey = `audit.value.${str}`;
  const translated = t(dictKey);
  if (translated !== dictKey) return translated;
  return String(val);
}

// Action categories & styling
//
// labels are i18n keys (audit.action.*) resolved at render time so the page
// has no hard-coded UI copy outside the translation dictionaries.
interface ActionMeta {
  labelKey: string;
  type: "create" | "update" | "delete" | "auth" | "other";
  badgeClass: string;
  icon: any;
  /** Raw action shown only when no translation key exists for it. */
  fallbackLabel?: string;
}

function getActionMeta(action: string): ActionMeta {
  const act = action.toLowerCase().trim();

  // Explicit mappings first
  const explicitActions: Record<string, ActionMeta> = {
    login: {
      labelKey: "audit.action.login",
      type: "auth",
      badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
      icon: LogIn,
    },
    signin: {
      labelKey: "audit.action.login",
      type: "auth",
      badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
      icon: LogIn,
    },
    logout: {
      labelKey: "audit.action.logout",
      type: "auth",
      badgeClass: "bg-muted text-muted-foreground border-border",
      icon: History,
    },
    password_reset: {
      labelKey: "audit.action.password_reset",
      type: "auth",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      icon: ShieldCheck,
    },
    reset_password: {
      labelKey: "audit.action.password_reset",
      type: "auth",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      icon: ShieldCheck,
    },
    role_change: {
      labelKey: "audit.action.role_change",
      type: "update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: ShieldCheck,
    },
    create: {
      labelKey: "audit.action.create",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    insert: {
      labelKey: "audit.action.insert",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    add: {
      labelKey: "audit.action.add",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    update: {
      labelKey: "audit.action.update",
      type: "update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: Edit3,
    },
    edit: {
      labelKey: "audit.action.edit",
      type: "update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: Edit3,
    },
    modify: {
      labelKey: "audit.action.modify",
      type: "update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: Edit3,
    },
    delete: {
      labelKey: "audit.action.delete",
      type: "delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    },
    remove: {
      labelKey: "audit.action.remove",
      type: "delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    },
    cancel: {
      labelKey: "audit.action.cancel",
      type: "delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    },
    void: {
      labelKey: "audit.action.void",
      type: "delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    },
    export: {
      labelKey: "audit.action.export",
      type: "other",
      badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      icon: ArrowDownRight,
    },
    export_csv: {
      labelKey: "audit.action.export_csv",
      type: "other",
      badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      icon: ArrowDownRight,
    },
    print: {
      labelKey: "audit.action.print",
      type: "other",
      badgeClass: "bg-muted text-foreground border-border",
      icon: FileText,
    },
    payment: {
      labelKey: "audit.action.payment",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    collect: {
      labelKey: "audit.action.collect",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    refund: {
      labelKey: "audit.action.refund",
      type: "delete",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      icon: Trash2,
    },
    status_change: {
      labelKey: "audit.action.status_change",
      type: "update",
      badgeClass: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
      icon: Edit3,
    },
    transfer: {
      labelKey: "audit.action.transfer",
      type: "other",
      badgeClass: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
      icon: History,
    },
    adjustment: {
      labelKey: "audit.action.adjustment",
      type: "update",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      icon: Edit3,
    },
    sync: {
      labelKey: "audit.action.sync",
      type: "other",
      badgeClass: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
      icon: RefreshCw,
    },
  };

  if (explicitActions[act]) {
    return explicitActions[act];
  }

  // Substring checks
  if (
    act.includes("create") ||
    act.includes("insert") ||
    act.includes("add") ||
    act.includes("new")
  ) {
    return {
      type: "create" as const,
      labelKey: "audit.action.group.create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    };
  }
  if (
    act.includes("update") ||
    act.includes("edit") ||
    act.includes("modify") ||
    act.includes("patch") ||
    act.includes("change")
  ) {
    return {
      type: "update" as const,
      labelKey: "audit.action.group.update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: Edit3,
    };
  }
  if (
    act.includes("delete") ||
    act.includes("remove") ||
    act.includes("destroy") ||
    act.includes("cancel") ||
    act.includes("void")
  ) {
    return {
      type: "delete" as const,
      labelKey: "audit.action.group.delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    };
  }
  if (act.includes("login") || act.includes("signin") || act.includes("auth")) {
    return {
      type: "auth" as const,
      labelKey: "audit.action.login",
      badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
      icon: LogIn,
    };
  }
  if (act.includes("export") || act.includes("download")) {
    return {
      type: "other" as const,
      labelKey: "audit.action.export",
      badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      icon: ArrowDownRight,
    };
  }

  return {
    type: "other",
    labelKey: "audit.action.group.other",
    badgeClass: "bg-muted text-muted-foreground border-border",
    icon: History,
    fallbackLabel: act.replace(/_/g, " "),
  };
}

/** ترجمة نتيجة `getActionMeta` إلى نص جاهز للعرض. */
function actionLabel(
  meta: ActionMeta,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const translated = t(meta.labelKey);
  if (translated !== meta.labelKey) return translated;
  return meta.fallbackLabel ?? meta.labelKey;
}

function getRelativeTime(
  dateStr: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const now = new Date().getTime();
  const date = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return t("audit.time.now");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("audit.time.minutes", toSystemDigits(diffMin));
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("audit.time.hours", toSystemDigits(diffHour));
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return t("audit.time.yesterday");
  if (diffDay < 30) return t("audit.time.days", toSystemDigits(diffDay));
  const diffMonth = Math.floor(diffDay / 30);
  return t("audit.time.months", toSystemDigits(diffMonth));
}

function AuditPage() {
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const allowed = hasRole("owner") || hasRole("manager");
  const actionText = useCallback((action: string) => actionLabel(getActionMeta(action), t), [t]);

  const [rows, setRows] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const fetchLogs = async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      setRows((data ?? []) as Log[]);

      const ids = Array.from(new Set((data ?? []).map((r: any) => r.actor_id).filter(Boolean)));
      if (ids.length) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id,full_name")
          .in("id", ids as string[]);
        const m: Record<string, string> = {};
        (ps ?? []).forEach((p: any) => {
          m[p.id] = p.full_name ?? t("audit.unknown_actor");
        });
        setProfiles(m);
      }
    } catch (err: any) {
      toast.error(err.message || t("audit.load_failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [allowed]);

  // Unique entities & actors for filters
  const uniqueEntities = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.entity_type))).filter(Boolean);
  }, [rows]);

  const uniqueActors = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
  }, [rows]);

  // Filtered rows
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = new Date();

    return rows.filter((r) => {
      // Search
      if (q) {
        const actorName =
          r.actor_id && profiles[r.actor_id] ? profiles[r.actor_id].toLowerCase() : "";
        const entityTranslated =
          ENTITY_TRANSLATIONS[r.entity_type.toLowerCase()]?.label.toLowerCase() || "";
        const actionMeta = getActionMeta(r.action);
        const matchesAction =
          r.action.toLowerCase().includes(q) || actionText(r.action).toLowerCase().includes(q);
        const matchesEntity =
          r.entity_type.toLowerCase().includes(q) || entityTranslated.includes(q);
        const matchesActor =
          actorName.includes(q) || (r.actor_id && r.actor_id.toLowerCase().includes(q));
        const matchesEntityId = r.entity_id && r.entity_id.toLowerCase().includes(q);
        if (!matchesAction && !matchesEntity && !matchesActor && !matchesEntityId) return false;
      }

      // Action type
      if (actionFilter !== "all") {
        const meta = getActionMeta(r.action);
        if (meta.type !== actionFilter) return false;
      }

      // Entity
      if (entityFilter !== "all" && r.entity_type !== entityFilter) return false;

      // Actor
      if (actorFilter !== "all" && r.actor_id !== actorFilter) return false;

      // Date
      if (dateFilter !== "all") {
        const logDate = new Date(r.created_at);
        const diffHours = (now.getTime() - logDate.getTime()) / (1000 * 3600);
        if (dateFilter === "today" && diffHours > 24) return false;
        if (dateFilter === "week" && diffHours > 24 * 7) return false;
        if (dateFilter === "month" && diffHours > 24 * 30) return false;
      }

      return true;
    });
  }, [rows, search, actionFilter, entityFilter, actorFilter, dateFilter, profiles, actionText]);

  // Statistics
  const stats = useMemo(() => {
    const total = rows.length;
    const now = new Date();
    const todayCount = rows.filter((r) => {
      const d = new Date(r.created_at);
      return d.toDateString() === now.toDateString();
    }).length;

    const criticalCount = rows.filter((r) => {
      const m = getActionMeta(r.action);
      return m.type === "delete" || m.type === "update";
    }).length;

    const activeUsersCount = new Set(rows.map((r) => r.actor_id).filter(Boolean)).size;

    return { total, todayCount, criticalCount, activeUsersCount };
  }, [rows]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (actionFilter !== "all") count++;
    if (entityFilter !== "all") count++;
    if (actorFilter !== "all") count++;
    if (dateFilter !== "all") count++;
    return count;
  }, [actionFilter, entityFilter, actorFilter, dateFilter]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(t("audit.copied_id"));
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) {
      toast.info(t("audit.export_empty"));
      return;
    }
    const headers = [
      t("audit.id"),
      t("audit.detail.timestamp"),
      t("audit.actor"),
      t("audit.field.action"),
      t("audit.entity"),
      t("audit.detail.entity_id"),
    ];
    const csvRows = filtered.map((r) => [
      r.id,
      new Date(r.created_at).toISOString(),
      r.actor_id ? (profiles[r.actor_id] ?? r.actor_id) : "—",
      r.action,
      r.entity_type,
      r.entity_id ?? "—",
    ]);

    const csvContent =
      "\uFEFF" + [headers.join(","), ...csvRows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(t("audit.export_done"));
  };

  if (!allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
        <Card className="border-border/60 shadow-sm rounded-3xl">
          <CardContent className="p-12 text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-600">
              <Shield className="size-7" />
            </div>
            <h3 className="text-lg font-bold text-foreground mb-1">
              {t("audit.restricted_title")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("audit.restricted")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header with actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            {t("audit.title")}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {t("audit.subtitle.long")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            disabled={loading}
            className="rounded-2xl gap-2 h-10 px-3.5 border-border/70 hover:bg-muted"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin text-primary")} />
            <span className="hidden sm:inline">{t("audit.refresh")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="rounded-2xl gap-2 h-10 px-3.5 border-border/70 hover:bg-muted"
          >
            <Download className="size-4 text-emerald-600" />
            <span>{t("audit.export_csv")}</span>
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <VortexMetricCard
          title={t("audit.kpi.total")}
          value={toSystemDigits(stats.total)}
          currency=""
          subtitle={t("audit.kpi.total_hint")}
          icon={<History className="size-5" />}
          iconClassName="bg-primary/10 text-primary"
        />
        <VortexMetricCard
          title={t("audit.kpi.today")}
          value={toSystemDigits(stats.todayCount)}
          currency=""
          subtitle={t("audit.kpi.today_hint")}
          icon={<Calendar className="size-5" />}
          iconClassName="bg-emerald-500/10 text-emerald-600"
          highlight={stats.todayCount > 0}
        />
        <VortexMetricCard
          title={t("audit.kpi.critical")}
          value={toSystemDigits(stats.criticalCount)}
          currency=""
          subtitle={t("audit.kpi.critical_hint")}
          icon={<AlertTriangle className="size-5" />}
          iconClassName="bg-amber-500/10 text-amber-600"
        />
        <VortexMetricCard
          title={t("audit.kpi.users")}
          value={toSystemDigits(stats.activeUsersCount)}
          currency=""
          subtitle={t("audit.kpi.users_hint")}
          icon={<User className="size-5" />}
          iconClassName="bg-purple-500/10 text-purple-600"
        />
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="w-full sm:flex-1">
          <VortexSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("audit.search_long")}
            className="w-full"
          />
        </div>

        {/* Action quick filter pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
          <Button
            size="sm"
            variant={actionFilter === "all" ? "default" : "outline"}
            onClick={() => setActionFilter("all")}
            className="rounded-full text-xs h-9 px-3 shrink-0"
          >
            {t("audit.filter.all")}
          </Button>
          <Button
            size="sm"
            variant={actionFilter === "create" ? "default" : "outline"}
            onClick={() => setActionFilter("create")}
            className="rounded-full text-xs h-9 px-3 shrink-0 gap-1"
          >
            <PlusCircle className="size-3.5 text-emerald-500" />
            {t("audit.filter.create")}
          </Button>
          <Button
            size="sm"
            variant={actionFilter === "update" ? "default" : "outline"}
            onClick={() => setActionFilter("update")}
            className="rounded-full text-xs h-9 px-3 shrink-0 gap-1"
          >
            <Edit3 className="size-3.5 text-blue-500" />
            {t("audit.filter.update")}
          </Button>
          <Button
            size="sm"
            variant={actionFilter === "delete" ? "default" : "outline"}
            onClick={() => setActionFilter("delete")}
            className="rounded-full text-xs h-9 px-3 shrink-0 gap-1"
          >
            <Trash2 className="size-3.5 text-rose-500" />
            {t("audit.filter.delete")}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setFilterSheetOpen(true)}
            className={cn(
              "rounded-full text-xs h-9 px-3.5 shrink-0 gap-1.5 border-dashed border-border/80",
              activeFiltersCount > 0 && "border-primary bg-primary/10 text-primary font-bold",
            )}
          >
            <Filter className="size-3.5" />
            <span>{t("audit.filter.advanced")}</span>
            {activeFiltersCount > 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px] font-black">
                {toSystemDigits(activeFiltersCount)}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Audit List Table / Cards */}
      <Card className="rounded-3xl border border-border/70 shadow-sm overflow-hidden bg-card">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-16 text-center">
              <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-muted/60 text-muted-foreground">
                <History className="size-8 opacity-60" />
              </div>
              <h3 className="text-base font-bold text-foreground mb-1">{t("audit.empty.title")}</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {t("audit.empty.hint")}
              </p>
              {(search || activeFiltersCount > 0) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setActionFilter("all");
                    setEntityFilter("all");
                    setActorFilter("all");
                    setDateFilter("all");
                  }}
                  className="mt-4 rounded-2xl text-xs"
                >
                  {t("audit.filter.reset")}
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filtered.map((log) => {
                const actionMeta = getActionMeta(log.action);
                const ActionIcon = actionMeta.icon;
                const entityName =
                  ENTITY_TRANSLATIONS[log.entity_type.toLowerCase()]?.label || log.entity_type;
                const actorName = log.actor_id
                  ? (profiles[log.actor_id] ?? log.actor_id.slice(0, 8))
                  : t("audit.system_actor");
                const isCopied = copiedId === log.id;

                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    {/* Left/Main Column: Actor + Action + Entity */}
                    <div className="flex items-start sm:items-center gap-3.5">
                      {/* Action Icon Badge */}
                      <div
                        className={cn(
                          "grid size-11 place-items-center rounded-2xl shrink-0 border transition-transform group-hover:scale-105",
                          actionMeta.badgeClass,
                        )}
                      >
                        <ActionIcon className="size-5" />
                      </div>

                      {/* Info details */}
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-foreground">
                            {actionLabel(actionMeta, t)}
                          </span>
                          <span className="text-muted-foreground/60 text-xs">•</span>
                          <Badge
                            variant="secondary"
                            className="rounded-lg text-[11px] font-bold px-2 py-0.5 bg-muted/80 text-foreground"
                          >
                            {entityName}
                          </Badge>
                          {log.entity_id && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(log.entity_id!, log.id + "_entity");
                              }}
                              className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground bg-muted/40 px-1.5 py-0.5 rounded-md border border-border/40"
                              title={t("audit.copy_entity_id")}
                            >
                              <span>#{log.entity_id.slice(0, 8)}</span>
                              {copiedId === log.id + "_entity" ? (
                                <Check className="size-3 text-emerald-500" />
                              ) : (
                                <Copy className="size-3 opacity-60" />
                              )}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 font-medium text-foreground/80">
                            <User className="size-3 text-primary" />
                            {actorName}
                          </span>
                          <span className="text-muted-foreground/40">•</span>
                          <span className="flex items-center gap-1 text-[11px]">
                            <Clock className="size-3 text-muted-foreground" />
                            {getRelativeTime(log.created_at, t)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Luxury Date Badge & View button */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/30">
                      <VortexDateBadge date={log.created_at} size="sm" variant="subtle" showTime />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-xl text-muted-foreground group-hover:text-foreground group-hover:bg-muted"
                      >
                        <Eye className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Advanced Filters Sheet */}
      <VortexFilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        title={t("audit.filter.sheet_title")}
        subtitle={t("audit.filter.sheet_subtitle")}
        activeFiltersCount={activeFiltersCount}
        onReset={() => {
          setActionFilter("all");
          setEntityFilter("all");
          setActorFilter("all");
          setDateFilter("all");
          setFilterSheetOpen(false);
        }}
        onApply={() => setFilterSheetOpen(false)}
      >
        <div className="space-y-6">
          {/* Action Filter */}
          <VortexFilterSection
            title={t("audit.filter.action_title")}
            description={t("audit.filter.action_desc")}
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "all", label: t("audit.filter.action.all") },
                { id: "create", label: t("audit.filter.action.create") },
                { id: "update", label: t("audit.filter.action.update") },
                { id: "delete", label: t("audit.filter.action.delete") },
                { id: "auth", label: t("audit.filter.action.auth") },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setActionFilter(opt.id)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-2xl border text-xs font-bold transition-all text-right",
                    actionFilter === opt.id
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-border/60 hover:bg-muted text-muted-foreground",
                  )}
                >
                  <span>{opt.label}</span>
                  {actionFilter === opt.id && <Check className="size-4 text-primary" />}
                </button>
              ))}
            </div>
          </VortexFilterSection>

          {/* Date Filter */}
          <VortexFilterSection
            title={t("audit.filter.date_title")}
            description={t("audit.filter.date_desc")}
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "all", label: t("audit.filter.date.all") },
                { id: "today", label: t("audit.filter.date.today") },
                { id: "week", label: t("audit.filter.date.week") },
                { id: "month", label: t("audit.filter.date.month") },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDateFilter(opt.id)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-2xl border text-xs font-bold transition-all text-right",
                    dateFilter === opt.id
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-border/60 hover:bg-muted text-muted-foreground",
                  )}
                >
                  <span>{opt.label}</span>
                  {dateFilter === opt.id && <Check className="size-4 text-primary" />}
                </button>
              ))}
            </div>
          </VortexFilterSection>

          {/* Entity Filter */}
          {uniqueEntities.length > 0 && (
            <VortexFilterSection
              title={t("audit.filter.entity_title")}
              description={t("audit.filter.entity_desc")}
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEntityFilter("all")}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
                    entityFilter === "all"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 hover:bg-muted text-muted-foreground",
                  )}
                >
                  {t("audit.filter.all")} ({toSystemDigits(rows.length)})
                </button>
                {uniqueEntities.map((ent) => {
                  const entLabel = ENTITY_TRANSLATIONS[ent.toLowerCase()]?.label || ent;
                  const count = rows.filter((r) => r.entity_type === ent).length;
                  return (
                    <button
                      key={ent}
                      type="button"
                      onClick={() => setEntityFilter(ent)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
                        entityFilter === ent
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/60 hover:bg-muted text-muted-foreground",
                      )}
                    >
                      {entLabel} ({toSystemDigits(count)})
                    </button>
                  );
                })}
              </div>
            </VortexFilterSection>
          )}

          {/* Actor Filter */}
          {uniqueActors.length > 0 && (
            <VortexFilterSection
              title={t("audit.filter.actor_title")}
              description={t("audit.filter.actor_desc")}
            >
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setActorFilter("all")}
                  className={cn(
                    "w-full flex items-center justify-between p-2.5 rounded-2xl border text-xs font-bold transition-all",
                    actorFilter === "all"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-muted text-muted-foreground",
                  )}
                >
                  <span>{t("audit.filter.actor.all")}</span>
                  {actorFilter === "all" && <Check className="size-4 text-primary" />}
                </button>
                {uniqueActors.map((actorId) => {
                  const name = profiles[actorId] || actorId.slice(0, 8);
                  const count = rows.filter((r) => r.actor_id === actorId).length;
                  return (
                    <button
                      key={actorId}
                      type="button"
                      onClick={() => setActorFilter(actorId)}
                      className={cn(
                        "w-full flex items-center justify-between p-2.5 rounded-2xl border text-xs font-bold transition-all",
                        actorFilter === actorId
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/60 hover:bg-muted text-muted-foreground",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <User className="size-3.5 text-primary" />
                        {name}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {t("audit.filter.events_count", toSystemDigits(count))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </VortexFilterSection>
          )}
        </div>
      </VortexFilterSheet>

      {/* Log Detail Sheet */}
      <Sheet open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <SheetContent side="left" className="sm:max-w-xl w-full p-0 flex flex-col">
          {selectedLog && (
            <>
              {/* Sheet Header */}
              <div className="p-6 border-b border-border/60 bg-muted/20">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const meta = getActionMeta(selectedLog.action);
                      const Icon = meta.icon;
                      return (
                        <div
                          className={cn(
                            "grid size-10 place-items-center rounded-2xl border",
                            meta.badgeClass,
                          )}
                        >
                          <Icon className="size-5" />
                        </div>
                      );
                    })()}
                    <div>
                      <SheetTitle className="text-lg font-black text-foreground">
                        {actionLabel(getActionMeta(selectedLog.action), t)}
                      </SheetTitle>
                      <SheetDescription className="text-xs text-muted-foreground">
                        {t("audit.detail.log_id")} {selectedLog.id}
                      </SheetDescription>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(selectedLog.id, "sheet_id")}
                    className="rounded-xl h-8 px-2.5 gap-1.5 text-xs"
                  >
                    {copiedId === "sheet_id" ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="size-3.5 text-muted-foreground" />
                    )}
                    <span>{t("audit.copy_id")}</span>
                  </Button>
                </div>
              </div>

              {/* Sheet Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Meta details card */}
                <div className="grid grid-cols-2 gap-3 p-4 rounded-3xl bg-card border border-border/70">
                  <div>
                    <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                      {t("audit.detail.actor")}
                    </span>
                    <span className="text-sm font-black text-foreground flex items-center gap-1.5">
                      <User className="size-4 text-primary" />
                      {selectedLog.actor_id
                        ? (profiles[selectedLog.actor_id] ?? selectedLog.actor_id.slice(0, 8))
                        : t("audit.system_actor")}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                      {t("audit.detail.entity")}
                    </span>
                    <span className="text-sm font-black text-foreground flex items-center gap-1.5">
                      <Layers className="size-4 text-blue-500" />
                      {ENTITY_TRANSLATIONS[selectedLog.entity_type.toLowerCase()]?.label ||
                        selectedLog.entity_type}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                      {t("audit.detail.entity_id")}
                    </span>
                    <span className="font-mono text-xs text-foreground/80 break-all">
                      {selectedLog.entity_id ?? "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                      {t("audit.detail.timestamp")}
                    </span>
                    <span className="text-xs font-bold text-foreground">
                      {formatLuxuryDate(selectedLog.created_at, { showDayName: true }).full}
                      {" - "}
                      {new Date(selectedLog.created_at).toLocaleTimeString("ar-YE")}
                    </span>
                  </div>
                </div>

                {/* Payload Changes Card */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-foreground flex items-center gap-1.5">
                      <FileText className="size-4 text-primary" />
                      {t("audit.detail.payload")}
                    </span>
                    {selectedLog.payload && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleCopy(JSON.stringify(selectedLog.payload, null, 2), "payload_copy")
                        }
                        className="h-7 text-[11px] rounded-lg gap-1 text-muted-foreground hover:text-foreground"
                      >
                        {copiedId === "payload_copy" ? (
                          <Check className="size-3 text-emerald-500" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                        <span>{t("audit.copy_json")}</span>
                      </Button>
                    )}
                  </div>

                  {selectedLog.payload ? (
                    typeof selectedLog.payload === "object" &&
                    Object.keys(selectedLog.payload).length > 0 ? (
                      <div className="space-y-3">
                        {/* Fully Translated Field Table */}
                        <div className="rounded-2xl border border-border/70 overflow-hidden bg-card text-xs shadow-xs">
                          <div className="bg-muted/50 px-3.5 py-2 border-b border-border/60 flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                            <span>{t("audit.detail.field")}</span>
                            <span>{t("audit.detail.value")}</span>
                          </div>
                          <div className="divide-y divide-border/40">
                            {Object.entries(selectedLog.payload).map(([k, v]) => {
                              const arabicField = translateFieldKeyI18n(k, t);
                              const isComplex = typeof v === "object" && v !== null;
                              const translatedVal = isComplex
                                ? JSON.stringify(v)
                                : translateValueI18n(v, t);

                              return (
                                <div
                                  key={k}
                                  className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 hover:bg-muted/30 transition"
                                >
                                  <div className="flex flex-col">
                                    <span className="font-bold text-foreground text-[12px]">
                                      {arabicField}
                                    </span>
                                    <span className="font-mono text-[10px] text-muted-foreground dir-ltr text-right">
                                      {k}
                                    </span>
                                  </div>
                                  <div className="sm:text-end">
                                    {isComplex ? (
                                      <pre className="inline-block max-w-full p-2 rounded-lg bg-muted text-[11px] font-mono text-foreground/90 overflow-x-auto dir-ltr text-left">
                                        {translatedVal}
                                      </pre>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 font-semibold text-foreground text-[12px] bg-muted/50 px-2.5 py-1 rounded-lg">
                                        {translatedVal}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Raw JSON viewer toggle / block */}
                        <details className="text-xs rounded-2xl border border-border/50 p-3 bg-muted/20 group">
                          <summary className="font-bold cursor-pointer text-muted-foreground select-none flex items-center justify-between hover:text-foreground">
                            <span>{t("audit.detail.raw_json")}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Payload Code
                            </span>
                          </summary>
                          <pre className="mt-3 p-3 rounded-xl bg-background border border-border/40 font-mono text-[11px] overflow-x-auto text-foreground/90 dir-ltr text-left">
                            {JSON.stringify(selectedLog.payload, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ) : (
                      <pre className="p-4 rounded-2xl bg-muted/40 border border-border/50 font-mono text-xs overflow-x-auto text-foreground dir-ltr text-left">
                        {JSON.stringify(selectedLog.payload, null, 2)}
                      </pre>
                    )
                  ) : (
                    <div className="p-8 text-center rounded-2xl border border-dashed border-border/70 text-muted-foreground text-xs">
                      {t("audit.detail.payload_empty")}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
