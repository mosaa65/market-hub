import type { DocumentType } from "@/lib/templates";

export type PrintingDocumentType =
  | DocumentType
  | "customer_statement"
  | "supplier_statement"
  | "report"
  | "mill_document"
  | "daily_ticket"
  | "audit_record";

export interface DocumentTypeMeta {
  id: PrintingDocumentType;
  nameAr: string;
  nameEn: string;
  category: "sales" | "purchases" | "inventory" | "finance" | "reports" | "milling" | "admin";
  aliases: string[];
}

export const DOCUMENT_TYPES: DocumentTypeMeta[] = [
  {
    id: "customer_invoice",
    nameAr: "فاتورة مبيعات",
    nameEn: "Sales invoice",
    category: "sales",
    aliases: ["بيع", "sales", "invoice"],
  },
  {
    id: "purchase_invoice",
    nameAr: "فاتورة شراء",
    nameEn: "Purchase invoice",
    category: "purchases",
    aliases: ["شراء", "purchases", "po"],
  },
  {
    id: "sales_return",
    nameAr: "مرتجع مبيعات",
    nameEn: "Sales return",
    category: "sales",
    aliases: ["مرتجع", "return"],
  },
  {
    id: "purchase_return",
    nameAr: "مرتجع مشتريات",
    nameEn: "Purchase return",
    category: "purchases",
    aliases: ["مرتجع شراء"],
  },
  {
    id: "payment_receipt",
    nameAr: "سند قبض/صرف",
    nameEn: "Payment receipt",
    category: "finance",
    aliases: ["سند", "قبض", "صرف", "payment"],
  },
  {
    id: "customer_statement",
    nameAr: "كشف حساب عميل",
    nameEn: "Customer statement",
    category: "finance",
    aliases: ["كشف عميل", "statement"],
  },
  {
    id: "supplier_statement",
    nameAr: "كشف حساب مورد",
    nameEn: "Supplier statement",
    category: "finance",
    aliases: ["كشف مورد"],
  },
  {
    id: "stock_transfer",
    nameAr: "تحويل مخزني",
    nameEn: "Stock transfer",
    category: "inventory",
    aliases: ["تحويل", "transfer"],
  },
  {
    id: "inventory_document",
    nameAr: "مستند حركة مخزون",
    nameEn: "Inventory movement",
    category: "inventory",
    aliases: ["مخزون", "inventory", "movement"],
  },
  {
    id: "report",
    nameAr: "تقرير",
    nameEn: "Report",
    category: "reports",
    aliases: ["تقارير", "reports"],
  },
  {
    id: "mill_document",
    nameAr: "مستند مطحنة",
    nameEn: "Mill document",
    category: "milling",
    aliases: ["مطحنة", "طحن", "mill"],
  },
  {
    id: "daily_ticket",
    nameAr: "تذكرة يومية",
    nameEn: "Daily ticket",
    category: "milling",
    aliases: ["تذكرة", "ticket"],
  },
  {
    id: "audit_record",
    nameAr: "سجل عمليات",
    nameEn: "Operations record",
    category: "admin",
    aliases: ["سجل", "تدقيق", "audit"],
  },
];

export function getDocumentTypeMeta(type: PrintingDocumentType): DocumentTypeMeta {
  return (
    DOCUMENT_TYPES.find((item) => item.id === type) ?? {
      id: type,
      nameAr: "مستند",
      nameEn: "Document",
      category: "admin",
      aliases: [],
    }
  );
}
