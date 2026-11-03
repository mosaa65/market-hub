/**
-- Market Hub ERP: Treasury, Cashboxes, Bank Accounts & Cheques Types
*/

export interface Cashbox {
  id: string;
  name_ar: string;
  name_en?: string | null;
  code: string;
  warehouse_id?: string | null;
  account_id: string;
  account?: {
    id: string;
    code: string;
    name_ar: string;
  } | null;
  is_default: boolean;
  is_active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type BankAccountKind = "BANK" | "WALLET" | "POS_TERMINAL";

export interface CompanyBankAccount {
  id: string;
  name_ar: string;
  name_en?: string | null;
  kind: BankAccountKind;
  bank_name: string;
  account_number?: string | null;
  iban?: string | null;
  currency: string;
  account_id: string;
  account?: {
    id: string;
    code: string;
    name_ar: string;
  } | null;
  is_default: boolean;
  is_active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type ChequeStatus = "UNDER_COLLECTION" | "CLEARED" | "BOUNCED" | "RETURNED";

export interface ChequeRecord {
  id: string;
  cheque_number: string;
  bank_name: string;
  drawer_name?: string | null;
  due_date: string;
  amount: number;
  status: ChequeStatus;
  customer_id?: string | null;
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
  } | null;
  invoice_id?: string | null;
  payment_id?: string | null;
  clearing_bank_account_id?: string | null;
  clearing_journal_entry_id?: string | null;
  cleared_at?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentSettlementSelection {
  /** القناة الأساسية: cash, card, mobile_money, bank_transfer, cheque, credit, split */
  method: string;
  /** المعرف الكتالوجي الدقيق لطريقة الدفع (مثل jaib, one_cash, kuraimi_bank, cash) */
  paymentMethodId?: string | null;
  /** الصندوق المحدد عند الدفع نقداً */
  cashboxId?: string | null;
  cashboxName?: string | null;
  /** الحساب البنكي أو المحفظة المحددة عند التحويل البنكي أو المحافظ الإلكترونية */
  bankAccountId?: string | null;
  bankAccountName?: string | null;
  /** رقم المرجع / رقم الحوالة / رقم إشعار المحفظة */
  reference?: string | null;
  paymentReference?: string | null;
  /** الحساب المالي المرتبط من دليل الحسابات (شجرة الحسابات) */
  chartAccountId?: string | null;
  /** بيانات الشيك إذا كانت طريقة الدفع شيك */
  chequeNumber?: string | null;
  chequeBank?: string | null;
  chequeDueDate?: string | null;
  chequeDrawer?: string | null;
  cheque?: {
    chequeNumber: string;
    bankName: string;
    dueDate: string;
    drawerName?: string | null;
  } | null;
}
