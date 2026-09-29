import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  Calendar,
  Layers,
  FileText,
  ShieldCheck,
  ArrowDownRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import {
  VortexMetricCard,
  VortexSearchInput,
  VortexFilterSheet,
  VortexFilterSection,
  VortexDateBadge,
} from "@/components/vortex-ui";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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

type Lang = "ar" | "en";

/**
 * The activity trail lives in `system_activity_logs`, which is filled by a
 * database trigger on every INSERT/UPDATE/DELETE across all public tables — so
 * it records far more than what the client writes by hand.
 */
const ACTIVITY_LOG_TABLE = "system_activity_logs" as const;

interface Log {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  /** Full row image before the change — only present for UPDATE and DELETE. */
  old_data?: Record<string, unknown> | null;
  /** Full row image after the change — only present for INSERT and UPDATE. */
  new_data?: Record<string, unknown> | null;
  details?: { message_key?: string; table?: string; record_id?: string } | null;
  created_at: string;
}

/**
 * The record the log row describes: the new state when it exists (INSERT and
 * UPDATE), otherwise the removed row (DELETE).
 */
function logRecord(log: Log): Record<string, unknown> | null {
  return log.new_data ?? log.old_data ?? null;
}

/**
 * Fields that only describe *where* the row lives, never the change itself.
 * They are noise in a before/after diff, so they are kept out of the main table
 * and remain visible in the raw JSON viewer.
 */
const DIFF_NOISE_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "search_vector",
  "tsv",
  "embedding",
]);
type ChangeKind = "added" | "removed" | "changed" | "same";
type DiffRow = {
  key: string;
  /** Value to display: the new one, or the removed one for a DELETE. */
  value: unknown;
  /** Value as it was before, when it differs from `value`. */
  before?: unknown;
  kind: ChangeKind;
};

/**
 * Builds the before/after view of a single log entry.
 *
 * DELETE rows only carry `old_data`, so every field is reported as removed;
 * UPDATE rows carry both images and are diffed field by field.
 */
function buildDiffRows(log: Log): DiffRow[] {
  const next: Record<string, unknown> | null = log.new_data ?? null;
  const previous: Record<string, unknown> | null = log.old_data ?? null;

  if (!next && !previous) return [];

  // A deletion has no "after" image at all: show what was removed.
  if (!next && previous) {
    return Object.entries(previous).map(([key, value]) => ({
      key,
      value,
      kind: DIFF_NOISE_KEYS.has(key) ? ("same" as ChangeKind) : ("removed" as ChangeKind),
    }));
  }

  //
  // INSERT and UPDATE both carry an "after" image, and only UPDATE carries a
  // "before" image too. So from here `next` is guaranteed and `previous` may be
  // null (INSERT).
  //
  const after: Record<string, unknown> = next!;
  const beforeImage: Record<string, unknown> | null = previous;

  const rows: DiffRow[] = [];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(after)) {
    seen.add(key);
    // No previous image (INSERT) means everything is new.
    if (!beforeImage) {
      rows.push({
        key,
        value,
        kind: DIFF_NOISE_KEYS.has(key) ? ("same" as ChangeKind) : ("added" as ChangeKind),
      });
      continue;
    }
    const before = beforeImage[key];
    const differs = JSON.stringify(before) !== JSON.stringify(value);
    rows.push({
      key,
      value,
      before: differs ? before : undefined,
      kind:
        differs && !DIFF_NOISE_KEYS.has(key) ? ("changed" as ChangeKind) : ("same" as ChangeKind),
    });
  }

  // Fields that were dropped by the update.
  for (const [key, before] of Object.entries(beforeImage ?? ({} as Record<string, unknown>))) {
    if (seen.has(key)) continue;
    rows.push({
      key,
      value: null,
      before,
      kind: DIFF_NOISE_KEYS.has(key) ? ("same" as ChangeKind) : ("removed" as ChangeKind),
    });
  }

  return rows;
}

// Entity names translation dictionary
// Entity names comprehensive translation dictionary
const ENTITY_TRANSLATIONS: Record<string, { label: string; label_en?: string; icon?: any }> = {
  customer: { label: "العملاء", label_en: "Customers" },
  customers: { label: "العملاء", label_en: "Customers" },
  supplier: { label: "الموردين", label_en: "Suppliers" },
  suppliers: { label: "الموردين", label_en: "Suppliers" },
  sale: { label: "المبيعات", label_en: "Sales" },
  sales: { label: "المبيعات", label_en: "Sales" },
  pos: { label: "نقاط البيع", label_en: "Point of sale" },
  order: { label: "الطلبات", label_en: "Orders" },
  orders: { label: "الطلبات", label_en: "Orders" },
  invoice: { label: "الفواتير", label_en: "Invoices" },
  invoices: { label: "الفواتير", label_en: "Invoices" },
  purchase: { label: "المشتريات", label_en: "Purchases" },
  purchases: { label: "المشتريات", label_en: "Purchases" },
  purchase_return: { label: "مرتجعات المشتريات", label_en: "Purchase returns" },
  purchase_returns: { label: "مرتجعات المشتريات", label_en: "Purchase returns" },
  sales_return: { label: "مرتجعات المبيعات", label_en: "Sales returns" },
  sales_returns: { label: "مرتجعات المبيعات", label_en: "Sales returns" },
  product: { label: "المنتجات والأصناف", label_en: "Products & items" },
  products: { label: "المنتجات والأصناف", label_en: "Products & items" },
  item: { label: "الأصناف", label_en: "Items" },
  items: { label: "الأصناف", label_en: "Items" },
  category: { label: "التصنيفات", label_en: "Categories" },
  categories: { label: "التصنيفات", label_en: "Categories" },
  brand: { label: "العلامات التجارية", label_en: "Brands" },
  brands: { label: "العلامات التجارية", label_en: "Brands" },
  unit: { label: "وحدات القياس", label_en: "Units of measure" },
  units: { label: "وحدات القياس", label_en: "Units of measure" },
  inventory: { label: "المخزون والجرد", label_en: "Inventory" },
  inventory_adjustment: { label: "تسويات المخزون", label_en: "Inventory adjustments" },
  adjustment: { label: "تسويات الجرد", label_en: "Stock adjustments" },
  batch: { label: "الدفعات وتواريخ الصلاحية", label_en: "Batches & expiry" },
  batches: { label: "الدفعات وتواريخ الصلاحية", label_en: "Batches & expiry" },
  warehouse: { label: "المستودعات والفروع", label_en: "Warehouses & branches" },
  warehouses: { label: "المستودعات والفروع", label_en: "Warehouses & branches" },
  payment: { label: "السندات والتحصيلات", label_en: "Vouchers & collections" },
  payments: { label: "السندات والتحصيلات", label_en: "Vouchers & collections" },
  customer_payments: { label: "تحصيلات العملاء", label_en: "Customer collections" },
  supplier_payments: { label: "مدفوعات الموردين", label_en: "Supplier payments" },
  settlement: { label: "التسويات المالية", label_en: "Settlements" },
  settlements: { label: "التسويات المالية", label_en: "Settlements" },
  user: { label: "المستخدمين والموظفين", label_en: "Users & staff" },
  users: { label: "المستخدمين والموظفين", label_en: "Users & staff" },
  profile: { label: "الملف الشخصي", label_en: "Profile" },
  profiles: { label: "الملفات الشخصية", label_en: "Profiles" },
  role: { label: "الصلاحيات والأدوار", label_en: "Roles & permissions" },
  roles: { label: "الصلاحيات والأدوار", label_en: "Roles & permissions" },
  user_roles: { label: "أدوار المستخدمين", label_en: "User roles" },
  permission: { label: "أذونات النظام", label_en: "System permissions" },
  permissions: { label: "أذونات النظام", label_en: "System permissions" },
  setting: { label: "إعدادات النظام", label_en: "System settings" },
  settings: { label: "إعدادات النظام", label_en: "System settings" },
  company: { label: "بيانات المنشأة", label_en: "Company details" },
  company_settings: { label: "إعدادات المنشأة", label_en: "Company settings" },
  organization: { label: "المنشأة", label_en: "Organization" },
  session: { label: "جلسات العمل", label_en: "Sessions" },
  sessions: { label: "جلسات العمل", label_en: "Sessions" },
  auth: { label: "الأمان وتسجيل الدخول", label_en: "Auth & sign-in" },
  loyalty: { label: "برنامج الولاء والنقاط", label_en: "Loyalty & points" },
  barcode: { label: "الباركود والملصقات", label_en: "Barcodes & labels" },
  barcodes: { label: "الباركود والملصقات", label_en: "Barcodes & labels" },
  account: { label: "دليل الحسابات المالية", label_en: "Chart of accounts" },
  accounts: { label: "دليل الحسابات المالية", label_en: "Chart of accounts" },
  journal_entry: { label: "القيود اليومية", label_en: "Journal entries" },
  journal_entries: { label: "القيود اليومية", label_en: "Journal entries" },
  debt: { label: "الديون والمستحقات", label_en: "Debts & receivables" },
  debts: { label: "الديون والمستحقات", label_en: "Debts & receivables" },
  audit_log: { label: "سجل التدقيق", label_en: "Audit trail" },
  audit_logs: { label: "سجل التدقيق", label_en: "Audit trail" },
  audit: { label: "سجل التدقيق", label_en: "Audit trail" },
  system_activity_logs: { label: "سجل الأحداث", label_en: "Activity log" },
  stock_movements: { label: "حركات المخزون", label_en: "Stock movements" },
  stock_positions: { label: "أرصدة المخزون", label_en: "Stock positions" },
  item_policies: { label: "سياسات الأصناف", label_en: "Item policies" },
  platform_admins: { label: "مديرو المنصة", label_en: "Platform admins" },
  vehicle_makes: { label: "ماركات المركبات", label_en: "Vehicle makes" },
  vehicle_models: { label: "موديلات المركبات", label_en: "Vehicle models" },
  quality_grades: { label: "درجات الجودة", label_en: "Quality grades" },
  countries_of_origin: { label: "بلدان المنشأ", label_en: "Countries of origin" },
};

// Comprehensive Dictionary for Payload Field Keys
// `ar` is the display label, `en` keeps the schema key readable in English mode.
const FIELD_TRANSLATIONS: Record<string, { ar: string; en: string }> = {
  id: { ar: "معرف السجل", en: "Record ID" },
  name: { ar: "الاسم", en: "Name" },
  name_ar: { ar: "الاسم العربي", en: "Arabic name" },
  full_name: { ar: "الاسم الكامل", en: "Full name" },
  display_name: { ar: "الاسم المعروض", en: "Display name" },
  email: { ar: "البريد الإلكتروني", en: "Email" },
  phone: { ar: "رقم الهاتف", en: "Phone" },
  mobile: { ar: "رقم الجوال", en: "Mobile" },
  status: { ar: "الحالة", en: "Status" },
  role: { ar: "الصلاحية / الدور", en: "Role" },
  roles: { ar: "الأدوار والصلاحيات", en: "Roles" },
  balance: { ar: "الرصيد المالي", en: "Balance" },
  amount: { ar: "المبلغ", en: "Amount" },
  total: { ar: "الإجمالي", en: "Total" },
  total_amount: { ar: "المبلغ الإجمالي", en: "Total amount" },
  subtotal: { ar: "المجموع الفرعي", en: "Subtotal" },
  tax: { ar: "مبلغ الضريبة", en: "Tax" },
  tax_amount: { ar: "مبلغ الضريبة", en: "Tax amount" },
  tax_rate: { ar: "نسبة الضريبة", en: "Tax rate" },
  discount: { ar: "الخصم", en: "Discount" },
  discount_amount: { ar: "قيمة الخصم", en: "Discount amount" },
  price: { ar: "سعر البيع", en: "Sale price" },
  selling_price: { ar: "سعر البيع", en: "Sale price" },
  cost: { ar: "سعر التكلفة", en: "Cost price" },
  cost_price: { ar: "سعر التكلفة", en: "Cost price" },
  quantity: { ar: "الكمية", en: "Quantity" },
  qty: { ar: "الكمية", en: "Quantity" },
  stock: { ar: "الرصيد المخزني", en: "Stock balance" },
  min_stock: { ar: "الحد الأدنى للطلب", en: "Reorder level" },
  barcode: { ar: "رمز الباركود", en: "Barcode" },
  sku: { ar: "رمز الصنف (SKU)", en: "SKU" },
  unit: { ar: "الوحدة", en: "Unit" },
  unit_name: { ar: "اسم الوحدة", en: "Unit name" },
  unit_id: { ar: "معرف الوحدة", en: "Unit ID" },
  category: { ar: "التصنيف", en: "Category" },
  category_id: { ar: "معرف التصنيف", en: "Category ID" },
  brand: { ar: "العلامة التجارية", en: "Brand" },
  brand_id: { ar: "معرف العلامة", en: "Brand ID" },
  warehouse: { ar: "المستودع", en: "Warehouse" },
  warehouse_id: { ar: "معرف المستودع", en: "Warehouse ID" },
  customer: { ar: "العميل", en: "Customer" },
  customer_id: { ar: "معرف العميل", en: "Customer ID" },
  supplier: { ar: "المورد", en: "Supplier" },
  supplier_id: { ar: "معرف المورد", en: "Supplier ID" },
  invoice: { ar: "الفاتورة", en: "Invoice" },
  invoice_id: { ar: "معرف الفاتورة", en: "Invoice ID" },
  invoice_number: { ar: "رقم الفاتورة", en: "Invoice number" },
  reference_number: { ar: "رقم المرجع / الإيصال", en: "Reference number" },
  receipt_number: { ar: "رقم السند", en: "Receipt number" },
  payment_method: { ar: "طريقة الدفع", en: "Payment method" },
  notes: { ar: "ملاحظات", en: "Notes" },
  note: { ar: "ملاحظة", en: "Note" },
  description: { ar: "الوصف والتفاصيل", en: "Description" },
  address: { ar: "العنوان", en: "Address" },
  city: { ar: "المدينة", en: "City" },
  country: { ar: "الدولة", en: "Country" },
  created_at: { ar: "تاريخ الإنشاء", en: "Created at" },
  updated_at: { ar: "تاريخ آخر تعديل", en: "Updated at" },
  deleted_at: { ar: "تاريخ الحذف", en: "Deleted at" },
  date: { ar: "التاريخ", en: "Date" },
  payment_date: { ar: "تاريخ السداد", en: "Payment date" },
  due_date: { ar: "تاريخ الاستحقاق", en: "Due date" },
  expiry_date: { ar: "تاريخ الانتهاء", en: "Expiry date" },
  production_date: { ar: "تاريخ الإنتاج", en: "Production date" },
  batch_number: { ar: "رقم الدفعة (التشغيلة)", en: "Batch number" },
  is_active: { ar: "الحالة التشغيلية", en: "Active state" },
  enabled: { ar: "التفعيل", en: "Enabled" },
  disabled: { ar: "التعطيل", en: "Disabled" },
  ip_address: { ar: "عنوان IP", en: "IP address" },
  user_agent: { ar: "المتصفح والجهاز", en: "Browser & device" },
  actor_id: { ar: "معرف المستخدم المنفذ", en: "Actor ID" },
  entity_type: { ar: "نوع الكيان", en: "Entity type" },
  entity_id: { ar: "معرف الكيان", en: "Entity ID" },
  action: { ar: "نوع الإجراء", en: "Action" },
  old_values: { ar: "القيم السابقة قبل التعديل", en: "Values before the change" },
  new_values: { ar: "القيم الجديدة بعد التعديل", en: "Values after the change" },
  changes: { ar: "الحقول المعدلة", en: "Changed fields" },
  items_count: { ar: "عدد الأصناف", en: "Item count" },
  currency: { ar: "العملة", en: "Currency" },
  credit_limit: { ar: "سقف المديونية (الائتمان)", en: "Credit limit" },
  item_nature: { ar: "طبيعة الصنف", en: "Item nature" },
  inventory_policy: { ar: "سياسة المخزون", en: "Inventory policy" },
  tracking: { ar: "التتبع الدقيق", en: "Detailed tracking" },
  costing_method: { ar: "طريقة التكلفة", en: "Costing method" },
  is_sellable: { ar: "يظهر في المبيعات", en: "Available for sales" },
  is_purchasable: { ar: "يظهر في المشتريات", en: "Available for purchases" },
  shelf_location: { ar: "موقع الرف", en: "Shelf location" },
  origin_id: { ar: "معرف بلد المنشأ", en: "Origin ID" },
  quality_grade_id: { ar: "معرف درجة الجودة", en: "Quality grade ID" },
  sort_order: { ar: "الترتيب", en: "Sort order" },
  code: { ar: "الكود", en: "Code" },
  short_name: { ar: "الرمز المختصر", en: "Short name" },
  make_id: { ar: "معرف الماركة", en: "Make ID" },
  short_name_ar: { ar: "الرمز المختصر بالعربية", en: "Short name (Arabic)" },
  details: { ar: "تفاصيل العملية", en: "Operation details" },
  old_data: { ar: "البيانات السابقة", en: "Previous data" },
  new_data: { ar: "البيانات الجديدة", en: "New data" },
  payload: { ar: "بيانات العملية", en: "Operation payload" },
};

// Common Value Translations
const VALUE_TRANSLATIONS: Record<string, { ar: string; en: string }> = {
  active: { ar: "نشط", en: "Active" },
  inactive: { ar: "غير نشط", en: "Inactive" },
  enabled: { ar: "مفعل", en: "Enabled" },
  disabled: { ar: "معطل", en: "Disabled" },
  pending: { ar: "قيد المعالجة / معلق", en: "Pending" },
  completed: { ar: "مكتمل بنجاح", en: "Completed" },
  paid: { ar: "مدفوع بالكامل", en: "Paid" },
  unpaid: { ar: "غير مدفوع", en: "Unpaid" },
  partially_paid: { ar: "مدفوع جزئياً", en: "Partially paid" },
  cancelled: { ar: "ملغي", en: "Cancelled" },
  draft: { ar: "مسودة غير معتمدة", en: "Draft" },
  posted: { ar: "مرحل ومعتمد", en: "Posted" },
  cash: { ar: "نقداً (كاش)", en: "Cash" },
  card: { ar: "بطاقة مدى / شبكة", en: "Card" },
  bank_transfer: { ar: "حوالة بنكية", en: "Bank transfer" },
  credit: { ar: "آجل / ذمم", en: "Credit" },
  mobile_money: { ar: "محفظة إلكترونية", en: "Mobile money" },
  cheque: { ar: "شيك مصرفي", en: "Cheque" },
  admin: { ar: "مدير النظام", en: "Administrator" },
  manager: { ar: "مشرف عام", en: "Manager" },
  cashier: { ar: "كاشير / بائع", en: "Cashier" },
  user: { ar: "مستخدم", en: "User" },
  owner: { ar: "مالك المنشأة", en: "Owner" },
  insert: { ar: "إدراج سجل", en: "Insert" },
  update: { ar: "تعديل بيانات", en: "Update" },
  delete: { ar: "حذف نهائي", en: "Delete" },
  good: { ar: "سلعة", en: "Good" },
  service: { ar: "خدمة", en: "Service" },
  tracked: { ar: "متتبع", en: "Tracked" },
  untracked: { ar: "غير متتبع", en: "Untracked" },
  customer_owned: { ar: "مملوك للعميل", en: "Customer-owned" },
  none: { ar: "بدون", en: "None" },
  batch: { ar: "دفعات", en: "Batch" },
  serial: { ar: "أرقام تسلسلية", en: "Serial" },
  moving_average: { ar: "المتوسط المرجح", en: "Moving average" },
  fifo: { ar: "الوارد أولاً صادر أولاً", en: "FIFO" },
  standard: { ar: "تكلفة معيارية", en: "Standard cost" },
  true: { ar: "نعم (مفعل)", en: "Yes (enabled)" },
  false: { ar: "لا (معطل)", en: "No (disabled)" },
  null: { ar: "غير محدد", en: "Not set" },
  undefined: { ar: "غير متوفر", en: "Unavailable" },
};

export function translateFieldKey(key: string, lang: Lang = "ar"): string {
  const cleanKey = key.trim().toLowerCase();
  const known = FIELD_TRANSLATIONS[cleanKey];
  if (known) return lang === "ar" ? known.ar : known.en;
  // If formatted like snake_case or camelCase, give a readable attempt
  return cleanKey.replace(/_/g, " ");
}

export function translateValue(val: any, lang: Lang = "ar"): string {
  if (val === null || val === undefined) return lang === "ar" ? "غير محدد" : "Not set";
  if (typeof val === "boolean") {
    return val
      ? lang === "ar"
        ? "نعم (مفعل)"
        : "Yes (enabled)"
      : lang === "ar"
        ? "لا (معطل)"
        : "No (disabled)";
  }
  const str = String(val).trim().toLowerCase();
  const known = VALUE_TRANSLATIONS[str];
  if (known) return lang === "ar" ? known.ar : known.en;
  return String(val);
}

// Action categories & styling
function getActionMeta(action: string, lang: Lang = "ar") {
  const act = action.toLowerCase().trim();
  const ar = lang === "ar";

  // Explicit mappings first
  const explicitActions: Record<
    string,
    {
      label: string;
      label_en: string;
      type: "create" | "update" | "delete" | "auth" | "other";
      badgeClass: string;
      icon: any;
    }
  > = {
    login: {
      label: "تسجيل دخول",
      label_en: "Sign-in",
      type: "auth",
      badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
      icon: LogIn,
    },
    signin: {
      label: "تسجيل دخول",
      label_en: "Sign-in",
      type: "auth",
      badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
      icon: LogIn,
    },
    logout: {
      label: "تسجيل خروج",
      label_en: "Sign-out",
      type: "auth",
      badgeClass: "bg-muted text-muted-foreground border-border",
      icon: History,
    },
    password_reset: {
      label: "إعادة ضبط كلمة المرور",
      label_en: "Password reset",
      type: "auth",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      icon: ShieldCheck,
    },
    reset_password: {
      label: "إعادة ضبط كلمة المرور",
      label_en: "Password reset",
      type: "auth",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      icon: ShieldCheck,
    },
    role_change: {
      label: "تعديل الصلاحيات",
      label_en: "Permissions changed",
      type: "update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: ShieldCheck,
    },
    create: {
      label: "إضافة جديدة",
      label_en: "Created",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    insert: {
      label: "إدراج سجل",
      label_en: "Record inserted",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    add: {
      label: "إضافة",
      label_en: "Added",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    update: {
      label: "تعديل بيانات",
      label_en: "Record updated",
      type: "update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: Edit3,
    },
    edit: {
      label: "تعديل",
      label_en: "Edited",
      type: "update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: Edit3,
    },
    modify: {
      label: "تحديث",
      label_en: "Modified",
      type: "update",
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      icon: Edit3,
    },
    delete: {
      label: "حذف نهائي",
      label_en: "Permanently deleted",
      type: "delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    },
    remove: {
      label: "إزالة",
      label_en: "Removed",
      type: "delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    },
    cancel: {
      label: "إلغاء العملية",
      label_en: "Operation cancelled",
      type: "delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    },
    void: {
      label: "إبطال الفاتورة",
      label_en: "Invoice voided",
      type: "delete",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    },
    export: {
      label: "تصدير بيانات",
      label_en: "Data exported",
      type: "other",
      badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      icon: ArrowDownRight,
    },
    export_csv: {
      label: "تصدير CSV",
      label_en: "CSV exported",
      type: "other",
      badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      icon: ArrowDownRight,
    },
    print: {
      label: "طباعة مستند",
      label_en: "Document printed",
      type: "other",
      badgeClass: "bg-muted text-foreground border-border",
      icon: FileText,
    },
    payment: {
      label: "تسجيل دفعة",
      label_en: "Payment recorded",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    collect: {
      label: "تحصيل مالي",
      label_en: "Collection recorded",
      type: "create",
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      icon: PlusCircle,
    },
    refund: {
      label: "استرداد مالي",
      label_en: "Refund",
      type: "delete",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      icon: Trash2,
    },
    status_change: {
      label: "تغيير الحالة",
      label_en: "Status changed",
      type: "update",
      badgeClass: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
      icon: Edit3,
    },
    transfer: {
      label: "نقل وتحويل",
      label_en: "Transfer",
      type: "other",
      badgeClass: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
      icon: History,
    },
    adjustment: {
      label: "تسوية جرد",
      label_en: "Stock adjustment",
      type: "update",
      badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      icon: Edit3,
    },
    sync: {
      label: "مزامنة سحابية",
      label_en: "Cloud sync",
      type: "other",
      badgeClass: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
      icon: RefreshCw,
    },
  };

  const explicit = explicitActions[act];
  if (explicit) {
    return { ...explicit, label: ar ? explicit.label : explicit.label_en };
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
      label: ar ? "إضافة / إنشاء" : "Created",
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
      label: ar ? "تعديل وتحديث" : "Updated",
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
      label: ar ? "حذف أو إلغاء" : "Deleted or cancelled",
      badgeClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
      icon: Trash2,
    };
  }
  if (act.includes("login") || act.includes("signin") || act.includes("auth")) {
    return {
      type: "auth" as const,
      label: ar ? "تسجيل دخول" : "Sign-in",
      badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
      icon: LogIn,
    };
  }
  if (act.includes("export") || act.includes("download")) {
    return {
      type: "other" as const,
      label: ar ? "تصدير بيانات" : "Data exported",
      badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
      icon: ArrowDownRight,
    };
  }

  return {
    type: "other" as const,
    label: act.replace(/_/g, " "),
    badgeClass: "bg-muted text-muted-foreground border-border",
    icon: History,
  };
}

function getRelativeTime(dateStr: string, lang: Lang = "ar"): string {
  const ar = lang === "ar";
  const now = new Date().getTime();
  const date = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - date) / 1000);
  const n = (value: number) => (ar ? toSystemDigits(value) : String(value));

  if (diffSec < 60) return ar ? "الآن" : "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return ar ? `منذ ${n(diffMin)} دقيقة` : `${n(diffMin)} min ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return ar ? `منذ ${n(diffHour)} ساعة` : `${n(diffHour)} h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return ar ? "أمس" : "yesterday";
  if (diffDay < 30) return ar ? `منذ ${n(diffDay)} يوم` : `${n(diffDay)} d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return ar ? `منذ ${n(diffMonth)} شهر` : `${n(diffMonth)} mo ago`;
}

function AuditPage() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { hasRole } = useAuth();
  const allowed = hasRole("owner") || hasRole("manager");

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
      const { data, error } = await (supabase as any)
        .from(ACTIVITY_LOG_TABLE)
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
          m[p.id] = p.full_name ?? "غير معرّف";
        });
        setProfiles(m);
      }
    } catch (err: any) {
      toast.error(err.message || "تعذر جلب سجلات الأحداث");
    } finally {
      setLoading(false);
    }
  };

  //
  // Live trail: a new activity row appears at the top of the list the moment the
  // trigger writes it, without waiting for a manual refresh.
  //
  useRealtimeTable<Log>({
    table: ACTIVITY_LOG_TABLE as string,
    onInsert: (newLog) => {
      setRows((current) =>
        [newLog, ...current.filter((row) => row.id !== newLog.id)].slice(0, 500),
      );
      const actorId = newLog.actor_id;
      if (!actorId) return;
      void supabase
        .from("profiles")
        .select("id,full_name")
        .eq("id", actorId)
        .maybeSingle()
        .then(({ data: profile }) => {
          if (!profile) return;
          setProfiles((current) => ({
            ...current,
            [profile.id]: profile.full_name ?? "غير معرّف",
          }));
        });
    },
    onUpdate: (updatedLog) =>
      setRows((current) =>
        current.map((row) => (row.id === updatedLog.id ? { ...row, ...updatedLog } : row)),
      ),
    onDelete: (oldLog) => setRows((current) => current.filter((row) => row.id !== oldLog.id)),
  });

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
        const entityEntry = ENTITY_TRANSLATIONS[r.entity_type.toLowerCase()];
        const entityTranslated =
          (ar ? entityEntry?.label : entityEntry?.label_en)?.toLowerCase() ?? "";
        const actionMeta = getActionMeta(r.action, lang);
        const matchesAction =
          r.action.toLowerCase().includes(q) || actionMeta.label.toLowerCase().includes(q);
        const matchesEntity =
          r.entity_type.toLowerCase().includes(q) || entityTranslated.includes(q);
        const matchesActor =
          actorName.includes(q) || (r.actor_id && r.actor_id.toLowerCase().includes(q));
        const matchesEntityId = r.entity_id && r.entity_id.toLowerCase().includes(q);
        if (!matchesAction && !matchesEntity && !matchesActor && !matchesEntityId) return false;
      }

      // Action type
      if (actionFilter !== "all") {
        const meta = getActionMeta(r.action, lang);
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
  }, [rows, search, actionFilter, entityFilter, actorFilter, dateFilter, profiles, ar, lang]);

  // Statistics
  const stats = useMemo(() => {
    const total = rows.length;
    const now = new Date();
    const todayCount = rows.filter((r) => {
      const d = new Date(r.created_at);
      return d.toDateString() === now.toDateString();
    }).length;

    const criticalCount = rows.filter((r) => {
      const m = getActionMeta(r.action, lang);
      return m.type === "delete" || m.type === "update";
    }).length;

    const activeUsersCount = new Set(rows.map((r) => r.actor_id).filter(Boolean)).size;

    return { total, todayCount, criticalCount, activeUsersCount };
  }, [rows, lang]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (actionFilter !== "all") count++;
    if (entityFilter !== "all") count++;
    if (actorFilter !== "all") count++;
    if (dateFilter !== "all") count++;
    return count;
  }, [actionFilter, entityFilter, actorFilter, dateFilter]);

  //
  // The record behind the open detail sheet. `system_activity_logs` stores the
  // before/after row images in `old_data` and `new_data`, so the payload table
  // shows the current state and what each value was before the change.
  //
  const selectedRecord = useMemo(
    () => (selectedLog ? logRecord(selectedLog) : null),
    [selectedLog],
  );

  const fieldRows = useMemo(() => (selectedLog ? buildDiffRows(selectedLog) : []), [selectedLog]);

  /** How many fields were added, changed, or removed by this operation. */
  const changeSummary = useMemo(() => {
    const summary = { added: 0, changed: 0, removed: 0 };
    for (const row of fieldRows) {
      if (row.kind === "added") summary.added++;
      else if (row.kind === "changed") summary.changed++;
      else if (row.kind === "removed") summary.removed++;
    }
    return summary;
  }, [fieldRows]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(ar ? "تم نسخ المعرّف" : "ID copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) {
      toast.info(ar ? "لا توجد سجلات للتصدير" : "No records to export");
      return;
    }
    const headers = ar
      ? ["المعرف", "التاريخ والوقت", "المستخدم", "الإجراء", "نوع الكيان", "معرف الكيان"]
      : ["ID", "Date & time", "User", "Action", "Entity", "Entity ID"];
    const csvRows = filtered.map((r) => [
      r.id,
      new Date(r.created_at).toISOString(),
      r.actor_id ? (profiles[r.actor_id] ?? r.actor_id) : "—",
      getActionMeta(r.action, lang).label,
      ENTITY_TRANSLATIONS[r.entity_type.toLowerCase()]?.[ar ? "label" : "label_en"] ??
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
    toast.success(ar ? "تم تصدير سجلات التدقيق بنجاح" : "Audit logs exported successfully");
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
              {ar ? "صلاحية محظورة" : "Access denied"}
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
            {ar
              ? "سجل وتتبع فوري لجميع العمليات الحساسة والأحداث في النظام بدقة عالية"
              : "A live, precise trail of every sensitive operation and event in the system"}
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
            <span className="hidden sm:inline">{ar ? "تحديث" : "Refresh"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="rounded-2xl gap-2 h-10 px-3.5 border-border/70 hover:bg-muted"
          >
            <Download className="size-4 text-emerald-600" />
            <span>{ar ? "تصدير CSV" : "Export CSV"}</span>
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <VortexMetricCard
          title={ar ? "إجمالي الأحداث" : "Total events"}
          value={toSystemDigits(stats.total)}
          currency=""
          subtitle={ar ? "آخر 500 عملية" : "Last 500 operations"}
          icon={<History className="size-5" />}
          iconClassName="bg-primary/10 text-primary"
        />
        <VortexMetricCard
          title={ar ? "أحداث اليوم" : "Today's events"}
          value={toSystemDigits(stats.todayCount)}
          currency=""
          subtitle={ar ? "خلال الـ 24 ساعة الماضية" : "Within the last 24 hours"}
          icon={<Calendar className="size-5" />}
          iconClassName="bg-emerald-500/10 text-emerald-600"
          highlight={stats.todayCount > 0}
        />
        <VortexMetricCard
          title={ar ? "عمليات حساسة" : "Sensitive operations"}
          value={toSystemDigits(stats.criticalCount)}
          currency=""
          subtitle={ar ? "تعديل وحذف للبيانات" : "Updates and deletions"}
          icon={<AlertTriangle className="size-5" />}
          iconClassName="bg-amber-500/10 text-amber-600"
        />
        <VortexMetricCard
          title={ar ? "المستخدمون النشطون" : "Active users"}
          value={toSystemDigits(stats.activeUsersCount)}
          currency=""
          subtitle={ar ? "أصحاب الأنشطة المسجلة" : "Users with recorded activity"}
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
            placeholder={
              ar
                ? "ابحث باسم المستخدم، الكيان، الإجراء، أو المعرف..."
                : "Search by user, entity, action, or ID..."
            }
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
            {ar ? "الكل" : "All"}
          </Button>
          <Button
            size="sm"
            variant={actionFilter === "create" ? "default" : "outline"}
            onClick={() => setActionFilter("create")}
            className="rounded-full text-xs h-9 px-3 shrink-0 gap-1"
          >
            <PlusCircle className="size-3.5 text-emerald-500" />
            {ar ? "إنشاء" : "Created"}
          </Button>
          <Button
            size="sm"
            variant={actionFilter === "update" ? "default" : "outline"}
            onClick={() => setActionFilter("update")}
            className="rounded-full text-xs h-9 px-3 shrink-0 gap-1"
          >
            <Edit3 className="size-3.5 text-blue-500" />
            {ar ? "تعديل" : "Updated"}
          </Button>
          <Button
            size="sm"
            variant={actionFilter === "delete" ? "default" : "outline"}
            onClick={() => setActionFilter("delete")}
            className="rounded-full text-xs h-9 px-3 shrink-0 gap-1"
          >
            <Trash2 className="size-3.5 text-rose-500" />
            {ar ? "حذف" : "Deleted"}
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
            <span>{ar ? "فلاتر متقدمة" : "Advanced filters"}</span>
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
              <h3 className="text-base font-bold text-foreground mb-1">
                {ar ? "لا توجد سجلات مطابقة" : "No matching records"}
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {ar
                  ? "لم يتم العثور على أي أحداث تطابق معايير البحث والفلترة المحددة حالياً."
                  : "No events match the current search and filter criteria."}
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
                  {ar ? "إعادة ضبط الفلاتر" : "Reset filters"}
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filtered.map((log) => {
                const actionMeta = getActionMeta(log.action, lang);
                const ActionIcon = actionMeta.icon;
                const entityEntry = ENTITY_TRANSLATIONS[log.entity_type.toLowerCase()];
                const entityName =
                  (ar ? entityEntry?.label : entityEntry?.label_en) || log.entity_type;
                const actorName = log.actor_id
                  ? (profiles[log.actor_id] ?? log.actor_id.slice(0, 8))
                  : ar
                    ? "النظام التلقائي"
                    : "System (automatic)";

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
                            {actionMeta.label}
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
                              title={ar ? "نسخ معرف الكيان" : "Copy entity ID"}
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
                            {getRelativeTime(log.created_at, lang)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Luxury Date Badge & View button */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/30">
                      <div className="flex items-center gap-2">
                        {!ar && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {new Date(log.created_at).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        <VortexDateBadge date={log.created_at} size="sm" />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={ar ? "عرض التفاصيل" : "View details"}
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
        title={ar ? "تصفية سجل الأحداث" : "Filter the activity log"}
        subtitle={
          ar
            ? "حدد معايير الفلترة المتقدمة لتدقيق العمليات بدقة"
            : "Set advanced criteria to audit operations precisely"
        }
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
            title={ar ? "نوع العملية" : "Operation type"}
            description={
              ar ? "تصفية حسب طبيعة الإجراء المتخذ" : "Filter by the nature of the action taken"
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "all", label: ar ? "جميع العمليات" : "All operations" },
                { id: "create", label: ar ? "إنشاء جديد" : "Created" },
                { id: "update", label: ar ? "تعديل بيانات" : "Updated" },
                { id: "delete", label: ar ? "حذف أو إلغاء" : "Deleted or cancelled" },
                { id: "auth", label: ar ? "تسجيل الدخول" : "Sign-in" },
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
            title={ar ? "الفترة الزمنية" : "Time range"}
            description={
              ar ? "تصفية الأحداث بحسب تاريخ الحدوث" : "Filter events by when they happened"
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "all", label: ar ? "كامل السجل" : "Entire log" },
                { id: "today", label: ar ? "اليوم فقط" : "Today" },
                { id: "week", label: ar ? "آخر 7 أيام" : "Last 7 days" },
                { id: "month", label: ar ? "آخر 30 يوماً" : "Last 30 days" },
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
              title={ar ? "الكيان المتأثر" : "Affected entity"}
              description={
                ar
                  ? "الجدول أو القسم الذي وقع عليه التغيير"
                  : "The table or section the change landed on"
              }
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
                  {ar ? "الكل" : "All"} ({toSystemDigits(rows.length)})
                </button>
                {uniqueEntities.map((ent) => {
                  const entEntry = ENTITY_TRANSLATIONS[ent.toLowerCase()];
                  const entLabel = (ar ? entEntry?.label : entEntry?.label_en) || ent;
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
              title={ar ? "المستخدم المسؤول" : "Responsible user"}
              description={
                ar ? "تصفية الأحداث حسب من قام بالعملية" : "Filter events by who performed them"
              }
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
                  <span>{ar ? "جميع المستخدمين" : "All users"}</span>
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
                        {toSystemDigits(count)} {ar ? "حدث" : count === 1 ? "event" : "events"}
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
                      const meta = getActionMeta(selectedLog.action, lang);
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
                        {getActionMeta(selectedLog.action, lang).label}
                      </SheetTitle>
                      <SheetDescription className="text-xs text-muted-foreground">
                        {ar ? "معرف السجل" : "Record ID"}: {selectedLog.id}
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
                    <span>{ar ? "نسخ المعرف" : "Copy ID"}</span>
                  </Button>
                </div>
              </div>

              {/* Sheet Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Meta details card */}
                <div className="grid grid-cols-2 gap-3 p-4 rounded-3xl bg-card border border-border/70">
                  <div>
                    <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                      {ar ? "المستخدم القائم بالحدث" : "Performed by"}
                    </span>
                    <span className="text-sm font-black text-foreground flex items-center gap-1.5">
                      <User className="size-4 text-primary" />
                      {selectedLog.actor_id
                        ? (profiles[selectedLog.actor_id] ?? selectedLog.actor_id.slice(0, 8))
                        : ar
                          ? "النظام التلقائي"
                          : "System (automatic)"}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                      {ar ? "الكيان المتأثر" : "Affected entity"}
                    </span>
                    <span className="text-sm font-black text-foreground flex items-center gap-1.5">
                      <Layers className="size-4 text-blue-500" />
                      {(() => {
                        const entry = ENTITY_TRANSLATIONS[selectedLog.entity_type.toLowerCase()];
                        return (ar ? entry?.label : entry?.label_en) || selectedLog.entity_type;
                      })()}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                      {ar ? "معرف الكيان" : "Entity ID"}
                    </span>
                    <span className="font-mono text-xs text-foreground/80 break-all">
                      {selectedLog.entity_id ?? "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                      {ar ? "التاريخ والوقت" : "Date & time"}
                    </span>
                    <span className="text-xs font-bold text-foreground">
                      {ar
                        ? formatLuxuryDate(selectedLog.created_at, { showDayName: true }).full
                        : new Date(selectedLog.created_at).toLocaleDateString("en-GB", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                      {" - "}
                      {new Date(selectedLog.created_at).toLocaleTimeString(ar ? "ar-SA" : "en-GB")}
                    </span>
                  </div>
                </div>

                {/* Payload Changes Card */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-foreground flex items-center gap-1.5">
                      <FileText className="size-4 text-primary" />
                      {ar ? "بيانات العملية (Payload)" : "Operation payload"}
                    </span>
                    {selectedRecord && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleCopy(JSON.stringify(selectedRecord, null, 2), "payload_copy")
                        }
                        className="h-7 text-[11px] rounded-lg gap-1 text-muted-foreground hover:text-foreground"
                      >
                        {copiedId === "payload_copy" ? (
                          <Check className="size-3 text-emerald-500" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                        <span>{ar ? "نسخ JSON" : "Copy JSON"}</span>
                      </Button>
                    )}
                  </div>

                  {selectedRecord ? (
                    Object.keys(selectedRecord).length > 0 ? (
                      <div className="space-y-3">
                        {/* Fully Translated Field Table */}
                        <div className="rounded-2xl border border-border/70 overflow-hidden bg-card text-xs shadow-xs">
                          <div className="bg-muted/50 px-3.5 py-2 border-b border-border/60 flex items-center justify-between gap-2 text-[11px] font-bold text-muted-foreground">
                            <span>{ar ? "الحقل / البيان" : "Field"}</span>
                            <span className="flex items-center gap-2">
                              {changeSummary.added > 0 && (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                                  {toSystemDigits(changeSummary.added)} {ar ? "مضاف" : "added"}
                                </span>
                              )}
                              {changeSummary.changed > 0 && (
                                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">
                                  {toSystemDigits(changeSummary.changed)} {ar ? "معدّل" : "changed"}
                                </span>
                              )}
                              {changeSummary.removed > 0 && (
                                <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:text-rose-400">
                                  {toSystemDigits(changeSummary.removed)} {ar ? "محذوف" : "removed"}
                                </span>
                              )}
                              <span>{ar ? "القيمة المسجلة" : "Recorded value"}</span>
                            </span>
                          </div>
                          <div className="divide-y divide-border/40">
                            {fieldRows.map(({ key, value, before, kind }) => {
                              const fieldLabel = translateFieldKey(key, lang);
                              const isComplex = typeof value === "object" && value !== null;
                              const translatedVal = isComplex
                                ? JSON.stringify(value)
                                : translateValue(value, lang);
                              // Fields carrying no business meaning stay readable
                              // but are not highlighted as a change.
                              const tone =
                                kind === "added"
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : kind === "changed"
                                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                    : kind === "removed"
                                      ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 line-through opacity-80"
                                      : "bg-muted/50 text-foreground";

                              return (
                                <div
                                  key={key}
                                  className={cn(
                                    "p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 transition",
                                    kind === "same" ? "hover:bg-muted/30" : "bg-muted/20",
                                  )}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      aria-hidden
                                      className={cn(
                                        "size-1.5 shrink-0 rounded-full",
                                        kind === "added" && "bg-emerald-500",
                                        kind === "changed" && "bg-amber-500",
                                        kind === "removed" && "bg-rose-500",
                                        kind === "same" && "bg-transparent",
                                      )}
                                    />
                                    <span className="flex flex-col min-w-0">
                                      <span className="font-bold text-foreground text-[12px]">
                                        {fieldLabel}
                                      </span>
                                      <span className="font-mono text-[10px] text-muted-foreground dir-ltr text-right">
                                        {key}
                                      </span>
                                    </span>
                                  </div>
                                  <div className="sm:text-end flex flex-col items-end gap-1">
                                    {before !== undefined && (
                                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground line-through text-right break-all">
                                        {typeof before === "object" && before !== null
                                          ? JSON.stringify(before)
                                          : translateValue(before, lang)}
                                      </span>
                                    )}
                                    {isComplex ? (
                                      <pre className="inline-block max-w-full p-2 rounded-lg bg-muted text-[11px] font-mono text-foreground/90 overflow-x-auto dir-ltr text-left">
                                        {translatedVal}
                                      </pre>
                                    ) : (
                                      <span
                                        className={cn(
                                          "inline-flex items-center gap-1 font-semibold text-[12px] px-2.5 py-1 rounded-lg break-all",
                                          tone,
                                        )}
                                      >
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
                            <span>
                              {ar ? "عرض البيانات التقنية الخام (JSON)" : "Show raw JSON payload"}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Payload Code
                            </span>
                          </summary>
                          <pre className="mt-3 p-3 rounded-xl bg-background border border-border/40 font-mono text-[11px] overflow-x-auto text-foreground/90 dir-ltr text-left">
                            {JSON.stringify(selectedRecord, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ) : (
                      <pre className="p-4 rounded-2xl bg-muted/40 border border-border/50 font-mono text-xs overflow-x-auto text-foreground dir-ltr text-left">
                        {JSON.stringify(selectedRecord, null, 2)}
                      </pre>
                    )
                  ) : (
                    <div className="p-8 text-center rounded-2xl border border-dashed border-border/70 text-muted-foreground text-xs">
                      {ar
                        ? "لا توجد بيانات تفصيلية إضافية مسجلة لهذه العملية"
                        : "No extra detail was recorded for this operation"}
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
