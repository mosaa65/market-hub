/**
 * Market-Hub ERP — Milling module barrel.
 *
 * The simplified mill has ONE data layer: custody (docs/milling/00 — ق9).
 * Intake, milling, delivery, adjustments and the statement all go through
 * `custody.ts` — one ledger line per movement, balances always derived.
 *
 * Everything the old module held (jobs, agreements, grain grades, packaging
 * units, print tickets) was removed with the old system; see
 * docs/milling/01_التحليل_المعمق_وحذف_التعقيد.md.
 */

export {
  // types
  type CustodyEntryType,
  type ProductOption,
  type CustodyBalance,
  type CustodyStatementRow,
  type CustodyMoneyRow,
  type CustodyLossRow,
  type CustodyLine,
  type OpResult,
  type CustodyIntakeInput,
  type CustodyMillingInput,
  type CustodyDeliveryInput,
  type CustodyAdjustmentInput,
  type MillingServiceDocument,
  type MillingServiceDocumentCreated,
  type MillingDocumentLine,
  type MillingDocumentDetails,
  // reads
  fetchGrainItems,
  fetchOutputItems,
  fetchServiceItem,
  fetchMillingServiceDocument,
  fetchMillingDocuments,
  fetchMillingDocumentDetails,
  fetchCustodyBalances,
  fetchCustodyStatement,
  fetchCustodyServiceMoney,
  fetchCustomerOpenInvoices,
  fetchUnlinkedMillingEntries,
  fetchDetectedLoss,
  fetchCustodyDocNumber,
  // writes (RPC only)
  custodyIntake,
  createMillingServiceDocument,
  processMillingServiceDocument,
  deliverMillingServiceDocument,
  custodyMilling,
  custodyDelivery,
  custodyAdjustment,
  linkCustodyInvoice,
  smartManufacture,
  type UnlinkedMillingEntry,
  // print vouchers (05 §بند 8.4)
  buildCustodyVoucher,
  custodyVoucherToDoc,
  buildCustodyDeliveryDoc,
  buildMillingDocumentUnifiedDoc,
  type CustodyVoucherData,
  // helpers
  translateCustodyError,
  capacityKgOf,
  syncAutoWeightOnItemChange,
  MILLING_MODULE_ID,
} from "./custody";
