/**
 * Print Transport & ESC/POS tests.
 *
 * يتحقق من:
 *   • توليد أوامر ESC/POS بايت-ببايت (كود حقيقي، بلا عتاد).
 *   • أن النقل المباشر **لا يدّعي** الطباعة عند غياب الوكيل المحلي.
 *   • أن الـ fallback إلى المتصفح يعمل.
 *   • أن الـ mapper الحراري يغطي كل أنواع المستندات.
 *   • أن جداول القدرات غير مكررة (adapters تقرأ من transports).
 *
 * يُشغّل بـ: npx tsx src/lib/printing/__tests__/transports.test.ts
 */

import { buildEscPosBytes, CMD, toHex, charSize, separator, columnsForWidthMm } from "../escpos";
import {
  browserTransport,
  escposTransport,
  getPrintTransport,
  getPrintTransports,
  isTransportAvailable,
  pdfTransport,
  printWithFallback,
  type LocalPrintAgent,
} from "../transports";
import { renderThermalEscPos } from "../thermal-escpos";
import { PRINT_ADAPTER_META, transportForMethod } from "../adapters";
import { getDocumentTypeMeta } from "../document-types";
import type { PrintRequest } from "../engine";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) passed += 1;
  else failures.push(name);
}

const baseDoc = {
  title: "فاتورة مبيعات",
  number: "INV-2026-0001",
  date: "2026-10-05",
  partyName: "شركة الأمل",
  partyPhone: "771234567",
  warehouse: "المستودع الرئيسي",
  payment: "نقداً",
  lines: [
    { product: "مرفاع هيدروليكي", qty: 2, unit: "حبة", price: 150, total: 300, code: "HYD-3T" },
    { product: "طقم مفاتيح", qty: 5, unit: "طقم", price: 45, total: 225, code: "RNG-12" },
  ],
  subtotal: 525,
  tax: 78.75,
  discount: 10,
  total: 593.75,
  paid: 600,
  currency: "ر.ي",
};

const request = (over: Partial<PrintRequest> = {}): PrintRequest =>
  ({ doc: { ...baseDoc, docType: "customer_invoice" }, rtl: true, ...over }) as PrintRequest;

/* ───────────────────────── 1. ESC/POS byte building ─────────────────────── */

const initBytes = buildEscPosBytes({ blocks: [{ text: "x" }] });
check("ESC/POS starts with ESC @ (init)", initBytes[0] === 0x1b && initBytes[1] === 0x40);

const alignBytes = buildEscPosBytes({ blocks: [{ text: "x", align: "center" }] });
check(
  "ESC/POS center alignment emits ESC a 1",
  alignBytes.includes(0x1b) && alignBytes.join(",").includes("27,97,1"),
);

const boldBytes = buildEscPosBytes({ blocks: [{ text: "x", bold: true }] });
const boldHex = toHex(boldBytes);
check("ESC/POS bold on emits ESC E 1", boldHex.includes("1b 45 01"));
check("ESC/POS bold off emits ESC E 0", boldHex.includes("1b 45 00"));

check("charSize(2x2) = GS ! 0x11", charSize({ width: 2, height: 2 }).join(",") === "29,33,17");
check("charSize(1x1) = GS ! 0x00", charSize({ width: 1, height: 1 }).join(",") === "29,33,0");
check("charSize clamps above 8", charSize({ width: 99, height: 99 })[2] === 0x77);

const cutBytes = buildEscPosBytes({ blocks: [{ text: "x" }], cut: true });
check("ESC/POS cut emits GS V 0", toHex(cutBytes).includes("1d 56 00"));
check("no cut command when cut=false", !toHex(initBytes).includes("1d 56 00"));

check("line feed uses ESC d n", CMD.FEED(3).join(",") === "27,100,3");
check("separator respects width", separator("-", 10) === "----------");
check("columnsForWidthMm(80) = 42", columnsForWidthMm(80) === 42);
check("columnsForWidthMm(58) = 32", columnsForWidthMm(58) === 32);

// كل كتلة تنتهي بأمر تغذية سطر ESC d 1 — وإلا التصقت الأسطر على الورق.
const twoBlocks = buildEscPosBytes({ blocks: [{ text: "a" }, { text: "b" }] });
const twoBlocksHex = toHex(twoBlocks);
check(
  "each block is followed by ESC d 1 (line feed)",
  twoBlocksHex.includes("1b 64 01") && twoBlocksHex.split("1b 64 01").length - 1 === 2,
);
const twoBlocksText = new TextDecoder().decode(twoBlocks);
check("both block texts are emitted", twoBlocksText.includes("a") && twoBlocksText.includes("b"));

/* ───────────────────────── 2. Thermal ESC/POS mapper ───────────────────── */

const escposDoc = renderThermalEscPos(request());
check("mapper produces blocks", escposDoc.blocks.length > 10);
check("mapper sets paper columns", escposDoc.columns === 42);
check("mapper requests paper cut", escposDoc.cut === true);

const fullText = escposDoc.blocks.map((b) => b.text).join("\n");
check("mapper prints document number", fullText.includes("INV-2026-0001"));
check("mapper prints party name", fullText.includes("شركة الأمل"));
check(
  "mapper prints both line items",
  fullText.includes("مرفاع هيدروليكي") && fullText.includes("طقم مفاتيح"),
);
check("mapper prints grand total", fullText.includes("الإجمالي"));
check("mapper prints item dividers", fullText.includes("...."));
check("mapper prints signatures", fullText.includes("توقيع المستلم"));

// خيارات الإظهار/الإخفاء
const noPrices = renderThermalEscPos(request(), { showPrices: false });
const noPricesText = noPrices.blocks.map((b) => b.text).join("\n");
check("showPrices:false hides totals", !noPricesText.includes("الإجمالي"));
check("showPrices:false hides item prices", !noPricesText.includes("150.00"));

const noCustomer = renderThermalEscPos(request(), { showCustomer: false });
check(
  "showCustomer:false hides party",
  !noCustomer.blocks
    .map((b) => b.text)
    .join("\n")
    .includes("شركة الأمل"),
);

const noDividers = renderThermalEscPos(request(), { showDividers: false });
const hasItemDivider = (doc: typeof noDividers) => doc.blocks.some((b) => /^\.{2,}$/.test(b.text));
check("dividers are present by default", hasItemDivider(escposDoc));
check("showDividers:false removes item dividers", !hasItemDivider(noDividers));

// 58mm يقلّل الأعمدة
const narrow = renderThermalEscPos(request({ paperId: "thermal-58" }));
check("58mm narrows columns to 32", narrow.columns === 32);

// LTR
const ltr = renderThermalEscPos(request({ rtl: false }));
const ltrText = ltr.blocks.map((b) => b.text).join("\n");
check("LTR uses English labels", ltrText.includes("Total") && ltrText.includes("Customer"));

// كل أنواع المستندات تُنتج مستندًا صالحًا
const ALL_DOC_TYPES = [
  "customer_invoice",
  "purchase_invoice",
  "sales_return",
  "purchase_return",
  "payment_receipt",
  "customer_statement",
  "supplier_statement",
  "stock_transfer",
  "inventory_document",
  "report",
  "mill_document",
  "daily_ticket",
  "audit_record",
] as const;

for (const type of ALL_DOC_TYPES) {
  const doc = renderThermalEscPos(request({ documentType: type }));
  const ok = doc.blocks.length > 0 && doc.blocks.every((b) => typeof b.text === "string");
  check(`thermal mapper handles ${type}`, ok);
}

// مستند بلا بنود لا ينهار
const empty = renderThermalEscPos(
  request({ doc: { ...baseDoc, docType: "customer_invoice", lines: [] } }),
);
check("mapper handles empty line list", empty.blocks.length > 0);

/* ───────────────────────── 3. Transport honesty ────────────────────────── */

const transports = getPrintTransports();
check("three transports are registered", transports.length === 3);
check("transport ids are unique", new Set(transports.map((t) => t.id)).size === 3);

check(
  "escpos capability: direct output true",
  getPrintTransport("escpos").capabilities.supportsDirectOutput,
);
check(
  "browser capability: direct output false",
  !getPrintTransport("browser").capabilities.supportsDirectOutput,
);
check(
  "escpos declares paper cut + native barcode support",
  getPrintTransport("escpos").capabilities.supportsPaperCut &&
    getPrintTransport("escpos").capabilities.supportsNativeBarcode,
);

// ⚠️ الأهم: بلا وكيل محلي، ESC/POS لا يطبع شيئًا ولا يكذب.
const escposNoAgent = await escposTransport.print({
  output: { escpos: escposDoc },
  copies: 1,
});
check("escpos without agent fails", !escposNoAgent.ok);
check("escpos without agent reports agent_required", escposNoAgent.reason === "agent_required");
check("escpos without agent sends zero copies", escposNoAgent.copiesSent === 0);
check(
  "escpos without agent explains itself",
  Boolean(escposNoAgent.message && escposNoAgent.message.includes("local print agent")),
);

check("isTransportAvailable(escpos) false without agent", !isTransportAvailable("escpos"));
check(
  "isTransportAvailable(escpos) true with agent",
  isTransportAvailable("escpos", {
    agent: { isAvailable: async () => true, send: async () => {} },
  }),
);

// مع وكيل محلي: يرسل البايتات فعليًا (نقل حقيقي، مُحاكى في الاختبار)
const sent: Uint8Array[] = [];
const fakeAgent: LocalPrintAgent = {
  isAvailable: async () => true,
  send: async (bytes) => {
    sent.push(bytes);
  },
};

const withAgent = await escposTransport.print(
  { output: { escpos: escposDoc }, copies: 2 },
  { agent: fakeAgent },
);
check("escpos with agent succeeds", withAgent.ok);
check("escpos with agent sends requested copies", withAgent.copiesSent === 2);
check("escpos with agent sent real bytes twice", sent.length === 2);
check("escpos bytes are non-empty", sent[0] instanceof Uint8Array && sent[0].length > 50);
check("escpos sent bytes start with ESC @", sent[0][0] === 0x1b && sent[0][1] === 0x40);

// وكيل غير متاح
const unavailableAgent: LocalPrintAgent = { isAvailable: async () => false, send: async () => {} };
const unavailable = await escposTransport.print(
  { output: { escpos: escposDoc }, copies: 1 },
  { agent: unavailableAgent },
);
check("escpos reports agent_unavailable", unavailable.reason === "agent_unavailable");
check("escpos unavailable sends nothing", unavailable.copiesSent === 0);

// وكيل يفشل
const failingAgent: LocalPrintAgent = {
  isAvailable: async () => true,
  send: async () => {
    throw new Error("USB write failed");
  },
};
const failed = await escposTransport.print(
  { output: { escpos: escposDoc }, copies: 1 },
  { agent: failingAgent },
);
check("escpos reports transport_error on failure", failed.reason === "transport_error");
check("escpos surfaces the agent error message", failed.message === "USB write failed");

// مخرَج غير مدعوم
const wrongOutput = await escposTransport.print({ output: { html: "<html>" }, copies: 1 });
check("escpos rejects html-only output", wrongOutput.reason === "unsupported_output");

/* ───────────────────────── 4. Fallback behaviour ───────────────────────── */

// ESC/POS بلا وكيل + HTML متاح → يسقط إلى المتصفح ولا يترك المستخدم بلا مخرَج
const fallback = await printWithFallback("escpos", {
  output: { html: "<html>x</html>", escpos: escposDoc },
  copies: 1,
});
check("escpos falls back to browser when agent missing", fallback.ok);
check("fallback reports which transport was used", fallback.fellBackTo === "browser");
check("fallback preserves the original reason", fallback.reason === "agent_required");

// browser لا يسقط إلى نفسه
const browserDirect = await printWithFallback("browser", {
  output: { html: "<html>x</html>" },
  copies: 1,
});
check("browser transport prints directly", browserDirect.ok && !browserDirect.fellBackTo);

// pdf
const pdfResult = await pdfTransport.print({ output: { html: "<html>x</html>" }, copies: 5 });
check("pdf always sends exactly one copy", pdfResult.copiesSent === 1);
check(
  "pdf rejects escpos-only output",
  !(await pdfTransport.print({ output: { escpos: escposDoc }, copies: 1 })).ok,
);

// المتصفح يرفض مخرَجًا بلا HTML
const browserNoHtml = await browserTransport.print({ output: { escpos: escposDoc }, copies: 1 });
check("browser rejects escpos-only output", browserNoHtml.reason === "unsupported_output");

/* ───────────────────────── 5. No duplicated capability tables ──────────── */

check(
  "adapter meta capabilities come from transports (browser)",
  PRINT_ADAPTER_META.browser.capabilities.supportsCopies ===
    getPrintTransport("browser").capabilities.supportsCopies,
);
check(
  "adapter meta capabilities come from transports (pdf)",
  PRINT_ADAPTER_META.pdf.capabilities.supportsCopies ===
    getPrintTransport("pdf").capabilities.supportsCopies,
);
check(
  "thermal settings method maps to browser transport (not ESC/POS)",
  transportForMethod("thermal") === "browser",
);
check("pdf settings method maps to pdf transport", transportForMethod("pdf") === "pdf");
check(
  "browser settings method maps to browser transport",
  transportForMethod("browser") === "browser",
);
check(
  "thermal adapter is not advertised as direct output",
  !PRINT_ADAPTER_META.thermal.capabilities.supportsDirectOutput,
);
check(
  "escpos transport is NOT exposed as a settings method",
  !Object.keys(PRINT_ADAPTER_META).includes("escpos"),
);

/* ───────────────────────── 6. Document type metadata ───────────────────── */

for (const type of ALL_DOC_TYPES) {
  const meta = getDocumentTypeMeta(type);
  check(
    `document type meta for ${type} has Arabic + English names`,
    Boolean(meta.nameAr && meta.nameEn),
  );
}

if (failures.length > 0) {
  throw new Error(`Transport/ESC-POS tests failed:\n - ${failures.join("\n - ")}`);
}

console.log(`Transport/ESC-POS tests passed: ${passed}`);
