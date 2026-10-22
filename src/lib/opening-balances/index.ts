/**
 * Market-Hub ERP — Opening balances: data access layer.
 *
 * الأرصدة الافتتاحية: قيد موازنة محاسبي للأصول والالتزامات وحقوق الملكية.
 * يدعم إدخال الأكياس والسعة للمخزون، وتوجيه الحسابات المحاسبية بدقة لدفتر الأستاذ العام.
 */
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type OpeningSection =
  "STOCK" | "RECEIVABLE" | "PAYABLE" | "CASH" | "BANK" | "ASSET" | "LIABILITY" | "CAPITAL";

export type OpeningStatus = "DRAFT" | "POSTED" | "REVERSED";

export const OPENING_SECTIONS: {
  value: OpeningSection;
  label: string;
  hint: string;
  needsRef: "customer" | "supplier" | "item" | null;
  needsQty: boolean;
  defaultAccountCode: string;
}[] = [
  {
    value: "STOCK",
    label: "مخزون بضاعة وحبوب",
    hint: "كمية × تكلفة، يُرحَّل لمخزون المستودع وطبقات التكلفة (حـ/ 1311 أو 1313)",
    needsRef: "item",
    needsQty: true,
    defaultAccountCode: "1311",
  },
  {
    value: "RECEIVABLE",
    label: "ذمم عملاء (مدين)",
    hint: "أرصدة افتتاحية مستحقة على العملاء في كشف حساب العميل (حـ/ 1211)",
    needsRef: "customer",
    needsQty: false,
    defaultAccountCode: "1211",
  },
  {
    value: "CASH",
    label: "نقدية بالصندوق",
    hint: "رصيد النقدية الفعلي في صندوق المتجر والدرج (حـ/ 1101)",
    needsRef: null,
    needsQty: false,
    defaultAccountCode: "1101",
  },
  {
    value: "BANK",
    label: "أرصدة بنكية ومحافظ",
    hint: "أرصدة الحسابات البنكية والمحافظ الإلكترونية (حـ/ 1111 أو 1131)",
    needsRef: null,
    needsQty: false,
    defaultAccountCode: "1111",
  },
  {
    value: "ASSET",
    label: "أصول ثابتة",
    hint: "قيمة الآلات، المعدات، وسائل النقل، والأثاث المكتبي (حـ/ 1411 أو 1421)",
    needsRef: null,
    needsQty: false,
    defaultAccountCode: "1411",
  },
  {
    value: "PAYABLE",
    label: "ذمم موردين (دائن)",
    hint: "أرصدة افتتاحية مستحقة للموردين كالتزام على المنشأة (حـ/ 2111)",
    needsRef: "supplier",
    needsQty: false,
    defaultAccountCode: "2111",
  },
  {
    value: "LIABILITY",
    label: "التزامات أخرى",
    hint: "ديون وقروض أو مستحقات أخرى على المنشأة (حـ/ 2211 أو 2221)",
    needsRef: null,
    needsQty: false,
    defaultAccountCode: "2111",
  },
  {
    value: "CAPITAL",
    label: "رأس المال (موازنة)",
    hint: "الرقم المحاسبي الذي يتوازن عليه القيد الافتتاحي (حـ/ 3111)",
    needsRef: null,
    needsQty: false,
    defaultAccountCode: "3111",
  },
];

export interface OpeningLine {
  id: string;
  section: OpeningSection;
  side: "DEBIT" | "CREDIT";
  description: string;
  product_id: string | null;
  warehouse_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  quantity: number | null;
  unit_cost: number | null;
  amount: number;
  ledger_account_code?: string | null;
}

export interface OpeningDocument {
  id: string;
  document_number: string;
  effective_date: string;
  status: OpeningStatus;
  fiscal_year: number;
  notes: string | null;
  created_at: string;
}

export interface OpeningSummary extends OpeningDocument {
  total_debits: number;
  total_credits: number;
  is_balanced: boolean;
  capital_required_now: number;
  stock_amount: number;
  receivable_amount: number;
  payable_amount: number;
  cash_amount: number;
  bank_amount: number;
  asset_amount: number;
  liability_amount: number;
  capital_amount: number;
}

export interface OpeningLineDraft {
  section: OpeningSection;
  description: string;
  amount: number;
  product_id?: string | null;
  warehouse_id?: string | null;
  customer_id?: string | null;
  supplier_id?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  ledger_account_code?: string | null;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

/* ---------------------------------------------------------------- reads */

export async function fetchOpeningDocuments(): Promise<OpeningSummary[]> {
  return unwrap(
    await db
      .from("opening_balance_summary")
      .select("*")
      .order("effective_date", { ascending: false })
      .limit(100),
    "تعذّر تحميل الأرصدة الافتتاحية",
  );
}

export async function fetchOpeningLines(documentId: string): Promise<OpeningLine[]> {
  return unwrap(
    await db.from("opening_balance_lines").select("*").eq("document_id", documentId),
    "تعذّر تحميل بنود الرصيد الافتتاحي",
  );
}

export async function fetchStockableItems(): Promise<
  {
    id: string;
    sku: string;
    name: string;
    name_ar: string | null;
    package_weight_kg?: number | null;
    cost_price?: number | null;
  }[]
> {
  const rows = unwrap(
    await db
      .from("products")
      .select("id, sku, name, name_ar, package_weight_kg, cost_price")
      .eq("item_nature", "GOOD")
      .eq("inventory_policy", "TRACKED")
      .eq("is_active", true)
      .order("name_ar"),
    "تعذّر تحميل أصناف المخزون",
  );
  return rows as any[];
}

export async function fetchCustomers(): Promise<{ id: string; name: string }[]> {
  return unwrap(
    await db.from("customers").select("id, name").eq("is_active", true).order("name"),
    "تعذّر تحميل العملاء",
  ) as { id: string; name: string }[];
}

export async function fetchSuppliers(): Promise<{ id: string; name: string }[]> {
  return unwrap(
    await db.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    "تعذّر تحميل الموردين",
  ) as { id: string; name: string }[];
}

export async function fetchWarehouses(): Promise<
  { id: string; name_ar: string | null; name: string }[]
> {
  return unwrap(
    await db.from("warehouses").select("id, name, name_ar").eq("is_active", true).order("name_ar"),
    "تعذّر تحميل المستودعات",
  ) as { id: string; name_ar: string | null; name: string }[];
}

export async function fetchAccounts(): Promise<
  { id: string; code: string; name_ar: string; account_type: string }[]
> {
  return unwrap(
    await db
      .from("accounts")
      .select("id, code, name_ar, account_type")
      .eq("is_active", true)
      .eq("is_postable", true)
      .order("code"),
    "تعذّر تحميل الحسابات القابلة للترحيل",
  ) as { id: string; code: string; name_ar: string; account_type: string }[];
}

/* --------------------------------------------------------------- writes */

export async function createOpeningDocument(input: {
  effectiveDate: string;
  lines: OpeningLineDraft[];
  notes?: string;
}): Promise<string> {
  const { data, error } = await db.rpc("create_opening_balance", {
    _effective_date: input.effectiveDate,
    _lines: input.lines,
    _notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function updateOpeningDocument(input: {
  documentId: string;
  effectiveDate: string;
  lines: OpeningLineDraft[];
  notes?: string;
}): Promise<string> {
  const { data, error } = await db.rpc("update_opening_balance", {
    _document_id: input.documentId,
    _effective_date: input.effectiveDate,
    _lines: input.lines,
    _notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function postOpeningDocument(documentId: string): Promise<void> {
  const { error } = await db.rpc("post_opening_balance", { _document_id: documentId });
  if (error) throw new Error(error.message);
}

export async function reverseOpeningDocument(documentId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("reverse_opening_balance", {
    _document_id: documentId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------- helpers */

export const yer = (v: number | null | undefined) =>
  `${(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ر.ي`;
