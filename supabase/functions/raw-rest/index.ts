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
 * كل طلب يمرر رمز المستخدم نفسه إلى PostgREST، فتظل سياسات RLS مطبقة.
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
const API_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function isPrivilegedKey(key: string): boolean {
  if (/^sb_secret_/i.test(key)) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized)).role === "service_role";
  } catch {
    return false;
  }
}

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
  if (!SUPABASE_URL || !API_KEY || isPrivilegedKey(API_KEY)) {
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

  if (!ALLOWED_PREFIXES.includes(path)) {
    return json({ message: `Table not allowed: ${path || "(empty)"}` }, 400);
  }

  // 2) تحقّق من الجلسة؛ هذا لا يمنح صلاحيات إضافية.
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: API_KEY },
  });
  if (!userRes.ok) {
    return json({ message: "Invalid session" }, 401);
  }

  // 3) تمرير هوية المستخدم إلى PostgREST كي تنطبق RLS على الصفوف.
  const target = new URL(`/rest/v1/${path}`, SUPABASE_URL);
  if (query) target.search = query;
  const upstream = await fetch(target, {
    method: "GET",
    headers: {
      apikey: API_KEY,
      Authorization: `Bearer ${token}`,
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
