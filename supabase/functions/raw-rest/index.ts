/**
 * raw-rest — بروكسي REST للقراءة فقط فوق Supabase
 *
 * لماذا؟
 *   بعض المتصفحات/الامتدادات تحقن خاصية `fetch` معدّلة تُحمّل قيمة مختلقة
 *   (مثل "treasury") في أي معامل استعلام نصّي يبدأ بـ `eq.` — فيفشل الطلب
 *   بـ 400 على جداول مثل purchase_invoices / purchase_returns / suppliers.
 *
 * الحل:
 *   نمرّر مسار PostgREST كما هو (`path` + `query`) عبر مصوّر، وتبني الدالة
 *   الـ URL داخل Edge Runtime حيث لا يوجد حقن. الدالة تقرأ فقط (GET) ولا
 *   تُعيد أي كتابة على قاعدة البيانات.
 *
 * ملاحظة أمنية: الدالة تعمل بمفتاح الخدمة، لذلك تتحقق أولًا من هوية المستخدم
 *   (رمز الوصول) قبل تمرير أي طلب — لا تُقبل الطلبات المجهولة.
 */

/**
 * أنواع Deno المتاحة في وقت التشغيل داخل Edge Runtime فقط.
 * تُعرَّف محليًا حتى لا يحتاج المشروع إلى حزمة @deno/types، وليعمل الفحص
 * في محرر VS Code بلا أخطاء كاذبة. ليست جزءًا من حزمة المتصفح.
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, prefer, accept-profile, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** المسارات المسموح بها — قراءة فقط */
const ALLOWED_PREFIXES = [
  "suppliers",
  "purchase_invoices",
  "purchase_returns",
  "purchase_invoice_items",
  "products",
];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return json({ message: "Method not allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ message: "Proxy is not configured" }, 500);
  }

  // 1) لا نمرّر طلبًا مجهولًا
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({ message: "Missing authorization" }, 401);
  }

  const url = new URL(req.url);
  const path = (url.searchParams.get("path") ?? "").replace(/^\/+|\/+$/g, "");
  const query = url.searchParams.get("query") ?? "";

  const table = path.split("/")[0];
  if (!table || !ALLOWED_PREFIXES.includes(table)) {
    return json({ message: `Table not allowed: ${table || "(empty)"}` }, 400);
  }

  // 2) تحقّق من هوية المستخدم قبل استخدام مفتاح الخدمة
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY },
  });
  if (!userRes.ok) {
    return json({ message: "Invalid session" }, 401);
  }

  // 3) تمرير الطلب كما هو إلى PostgREST
  const target = `${SUPABASE_URL}/rest/v1/${path}${query ? `?${query}` : ""}`;
  const upstream = await fetch(target, {
    method: "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
      "Accept-Profile": "public",
    },
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
});
