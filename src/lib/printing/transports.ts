/**
 * Print Transports — فصل الطباعة عن وسيلة النقل.
 *
 * البنية المعمارية:
 *
 *   Document → Profile → Template → Theme → Rendered Output → **Transport**
 *
 * `PrintTransport` هو الحد الوحيد الذي يعرف "كيف يخرج" المستند. لا صفحة
 * مبيعات ولا مخزون ولا مطحنة تعرف أي شيء عن النقل.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ حالة ESC/POS المباشر في هذه النسخة — بيان صريح بلا ادّعاء زائف     │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ Web App لا يستطيع فتح socket خام إلى طابعة على الشبكة، ولا الوصول  │
 * │ إلى USB/Serial بدون تدخّل من المستخدم أو خدمة محلية. لذلك:         │
 * │                                                                     │
 * │  • `escpos` Transport مُنفَّذ بالكامل على مستوى **توليد الأوامر**   │
 * │    (buildEscPosBytes) — وهو كود حقيقي قابل للاختبار.               │
 * │  • **الإرسال الفعلي** إلى الطابعة غير متاح: يُرجِع                 │
 * │    `{ ok: false, reason: "agent_required" }` ولا يطبع شيئًا.       │
 * │  • عند توفر Local Print Agent (خدمة سطح مكتب على 127.0.0.1)، يُمرَّر  │
 * │    `PrintTransportContext.agent` فيصبح الإرسال حقيقيًا بلا تغيير    │
 * │    أي مستند.                                                        │
 * │                                                                     │
 * │ البديل الحالي المعتمد: Browser Print مع ملف الورق الحراري          │
 * │ (thermal-58 / thermal-80). لا نسمّيه ESC/POS.                      │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import { openPrintWindow } from "@/lib/print/print-window";
import { buildEscPosBytes, type EscPosDocument } from "./escpos";

export type PrintTransportId = "browser" | "pdf" | "escpos";

export interface PrintTransportCapabilities {
  /** يقبل أكثر من نسخة في عملية واحدة. */
  supportsCopies: boolean;
  /** يمكن معاينة المخرَج قبل الإرسال. */
  supportsPreview: boolean;
  /** يحترم ملفات الورق (A4/A5/58/80). */
  supportsPaperProfiles: boolean;
  /** يخرج مباشرة بلا مربّع حوار للمستخدم. */
  supportsDirectOutput: boolean;
  /** يستطيع قص الورق. */
  supportsPaperCut: boolean;
  /** يستطيع طباعة رموز QR/Barcode عبر أوامر الطابعة. */
  supportsNativeBarcode: boolean;
}

/** مخرَج مُجهَّز — إما HTML (للمتصفح) أو بايتات ESC/POS. */
export interface RenderedPrintOutput {
  /** HTML جاهز للطباعة (browser / pdf). */
  html?: string;
  /** مستند ESC/POS نصي (escpos). */
  escpos?: EscPosDocument;
  /** ملف الورق المستخدم — للمعاينة والتشخيص. */
  paperId?: string;
}

export interface PrintJob {
  output: RenderedPrintOutput;
  copies: number;
  /** عنوان المستند — يُستخدم في title المخرَج ورسائل الخطأ. */
  title?: string;
}

export type PrintFailureReason =
  "agent_required" | "agent_unavailable" | "unsupported_output" | "transport_error";

export interface PrintResult {
  ok: boolean;
  /** عدد النسخ التي أُرسلت فعلًا. */
  copiesSent: number;
  reason?: PrintFailureReason;
  message?: string;
}

/**
 * واجهة Local Print Agent المستقبلية.
 *
 * خدمة سطح مكتب محلية (Windows/macOS) تستقبل بايتات ESC/POS وترسلها إلى
 * الطابعة عبر USB/Serial/Network. المشروع **لا يتضمن** هذا الـ agent؛
 * الواجهة هنا لتوثيق الحد المعماري بدقة، وأي تنفيذ مستقبلي يلتزم بها فقط.
 */
export interface LocalPrintAgent {
  /** هل الـ agent متاح الآن؟ */
  isAvailable(): Promise<boolean>;
  /** يرسل البايتات إلى الطابعة المحددة. */
  send(bytes: Uint8Array, options?: { printerName?: string }): Promise<void>;
}

export interface PrintTransportContext {
  /** الـ agent المحلي إن وُجد. غيابه يعني: ESC/POS غير متاح للإرسال. */
  agent?: LocalPrintAgent;
}

export interface PrintTransport {
  id: PrintTransportId;
  nameAr: string;
  nameEn: string;
  capabilities: PrintTransportCapabilities;
  print(job: PrintJob, context?: PrintTransportContext): Promise<PrintResult>;
}

const CAPS = {
  browser: {
    supportsCopies: true,
    supportsPreview: true,
    supportsPaperProfiles: true,
    supportsDirectOutput: false,
    supportsPaperCut: false,
    supportsNativeBarcode: false,
  },
  pdf: {
    supportsCopies: false,
    supportsPreview: true,
    supportsPaperProfiles: true,
    supportsDirectOutput: false,
    supportsPaperCut: false,
    supportsNativeBarcode: false,
  },
  escpos: {
    supportsCopies: true,
    supportsPreview: false,
    supportsPaperProfiles: false,
    supportsDirectOutput: true,
    supportsPaperCut: true,
    supportsNativeBarcode: true,
  },
} as const satisfies Record<PrintTransportId, PrintTransportCapabilities>;

/**
 * طباعة المتصفح — الـ fallback المعتمد حاليًا.
 * لا يُسمّى ESC/POS: يمرّر HTML عبر مربّع حوار المتصفح.
 */
export const browserTransport: PrintTransport = {
  id: "browser",
  nameAr: "طباعة المتصفح",
  nameEn: "Browser print",
  capabilities: { ...CAPS.browser },
  async print(job) {
    const html = job.output.html;
    if (!html) return { ok: false, copiesSent: 0, reason: "unsupported_output" };
    const copies = Math.max(1, Math.min(20, job.copies || 1));
    for (let i = 0; i < copies; i += 1) openPrintWindow(html);
    return { ok: true, copiesSent: copies };
  },
};

/**
 * تصدير PDF — يمرّر عبر مربّع حوار المتصفح ويُطلب من المستخدم «حفظ كـ PDF».
 * نسخة واحدة فقط: تكرار النافذة لا ينتج ملفات متعددة.
 */
export const pdfTransport: PrintTransport = {
  id: "pdf",
  nameAr: "ملف PDF",
  nameEn: "PDF file",
  capabilities: { ...CAPS.pdf },
  async print(job) {
    const html = job.output.html;
    if (!html) return { ok: false, copiesSent: 0, reason: "unsupported_output" };
    openPrintWindow(html);
    return { ok: true, copiesSent: 1 };
  },
};

/**
 * ESC/POS — النقل المباشر.
 *
 * **يولّد** البايتات فعليًا (كود حقيقي مُختبر)، ثم:
 *  • إن وُجد `context.agent` → يرسلها ويُرجع `ok: true`.
 *  • إن غاب → يُرجع `ok: false, reason: "agent_required"` **ولا يطبع شيئًا**.
 *
 * لا يوجد أي مسار بديل "شبه مباشر" (لا قيادة أوامر نظام من المتصفح، ولا
 * فتح socket خام، ولا استدعاء طابعة وهمي). البديل هو Browser Print.
 */
export const escposTransport: PrintTransport = {
  id: "escpos",
  nameAr: "ESC/POS مباشر (يتطلب وكيل طباعة محلي)",
  nameEn: "Direct ESC/POS (requires local print agent)",
  capabilities: { ...CAPS.escpos },
  async print(job, context) {
    if (!job.output.escpos) {
      return { ok: false, copiesSent: 0, reason: "unsupported_output" };
    }
    const agent = context?.agent;
    if (!agent) {
      return {
        ok: false,
        copiesSent: 0,
        reason: "agent_required",
        message:
          "Direct ESC/POS printing requires a local print agent on this machine; use browser print with a thermal paper profile instead.",
      };
    }
    try {
      if (!(await agent.isAvailable())) {
        return { ok: false, copiesSent: 0, reason: "agent_unavailable" };
      }
      const copies = Math.max(1, Math.min(20, job.copies || 1));
      for (let i = 0; i < copies; i += 1) {
        await agent.send(buildEscPosBytes(job.output.escpos));
      }
      return { ok: true, copiesSent: copies };
    } catch (error) {
      return {
        ok: false,
        copiesSent: 0,
        reason: "transport_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

const TRANSPORTS: Record<PrintTransportId, PrintTransport> = {
  browser: browserTransport,
  pdf: pdfTransport,
  escpos: escposTransport,
};

export function getPrintTransport(id: PrintTransportId): PrintTransport {
  return TRANSPORTS[id];
}

export function getPrintTransports(): PrintTransport[] {
  return Object.values(TRANSPORTS);
}

/** هل يمكن لهذا النقل الإخراج فعليًا الآن (بمعطيات السياق الحالية)؟ */
export function isTransportAvailable(
  id: PrintTransportId,
  context?: PrintTransportContext,
): boolean {
  if (id === "escpos") return Boolean(context?.agent);
  return true;
}

/**
 * يُنفّذ المهمة عبر النقل المطلوب، ويسقط إلى `browser` عند تعذّر النقل
 * المباشر. هذا هو السلوك المعتمد: المستخدم لا يبقى بلا مخرَج أبدًا،
 * لكنه يُبلَّغ بسبب عدم استخدام ESC/POS.
 */
export async function printWithFallback(
  id: PrintTransportId,
  job: PrintJob,
  context?: PrintTransportContext,
): Promise<PrintResult & { fellBackTo?: PrintTransportId }> {
  const transport = getPrintTransport(id);
  const result = await transport.print(job, context);
  if (result.ok || id === "browser") return result;
  if (!job.output.html) return result;
  const fallback = await browserTransport.print({ ...job, copies: job.copies }, context);
  return { ...fallback, fellBackTo: "browser", reason: result.reason };
}
