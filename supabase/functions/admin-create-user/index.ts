// ==========================================================
// supabase/functions/admin-create-user/index.ts
// Provisions a store staff account (Auth user + profile + role) from the
// Users & Permissions screen, without the user having to sign up first.
//
// SECURITY MODEL
//   * Runs on Supabase's edge runtime. The service-role/secret key NEVER
//     leaves this process; the browser only ever holds the publishable key.
//   * The caller must present a valid Supabase access token. The token is
//     verified against the project JWKS, and the caller's authorisation is
//     then re-derived SERVER-SIDE from the database — never from the request
//     body, and never from a client-supplied role list.
//   * The store role is validated against a hard allow-list, so `superadmin`,
//     `admin` or any unknown value is rejected here even if the UI is bypassed.
//   * The generated password is returned exactly once in the success response.
//     It is never written to the database, to logs, or to any other store.
// ==========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ---------- Types ----------

type StoreRole = "owner" | "manager" | "accountant" | "cashier" | "warehouse";

/**
 * Structural type for the admin client. Declared locally because the Deno edge
 * runtime has no `@supabase/supabase-js` type resolution at build time; the
 * real client is created with `createClient()` below.
 */
type SupabaseAdminClient = ReturnType<typeof createClient<any, "public", any>>;

interface CreateUserRequest {
  email?: unknown;
  full_name?: unknown;
  phone?: unknown;
  role?: unknown;
  language?: unknown;
}

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_input"
  | "invalid_role"
  | "email_taken"
  | "quota_exceeded"
  | "not_configured"
  | "role_link_failed"
  | "orphan_user"
  | "server_error";

const STORE_ROLES: readonly StoreRole[] = [
  "owner",
  "manager",
  "accountant",
  "cashier",
  "warehouse",
];

/** Anything that must never be provisioned through this endpoint. */
const FORBIDDEN_ROLE_VALUES = new Set([
  "superadmin",
  "super_admin",
  "platform_admin",
  "platformadmin",
  "admin",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?";

// ---------- CORS ----------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// ---------- Helpers ----------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function fail(code: ErrorCode, messageAr: string, status: number, extra?: object): Response {
  return json({ ok: false, code, message: messageAr, ...extra }, status);
}

/** Cryptographically secure password generator (edge runtime Web Crypto). */
function generatePassword(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // Rejection-free mapping over a 64-char alphabet (256 % 64 === 0), so the
  // distribution stays uniform.
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[bytes[i]! % PASSWORD_ALPHABET.length];
  }
  return out;
}

function asTrimmedString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/**
 * Deletes an account that was just created in this same request but could not
 * be linked. Returns the explicit failure response: the operation is never
 * reported as a success when it was not. Only the id created moments ago is
 * ever passed here, so no pre-existing user or data can be affected.
 */
async function rollbackOrphan(
  admin: SupabaseAdminClient,
  userId: string,
  orphanMessageAr: string,
  cleanCode: ErrorCode = "orphan_user",
): Promise<Response> {
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    console.error("[admin-create-user] rollback failed:", error.message);
    return fail("orphan_user", orphanMessageAr, 500, { user_id: userId });
  }

  return fail(
    cleanCode,
    cleanCode === "role_link_failed"
      ? "فشل إسناد الدور، وتم التراجع عن إنشاء الحساب. لم يُضف أي مستخدم."
      : "تعذر استكمال إنشاء المستخدم، وتم التراجع عن العملية بالكامل. لم يُضف أي مستخدم.",
    500,
  );
}

// ---------- Handler ----------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return fail("invalid_input", "طريقة الطلب غير مدعومة.", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  // Prefer the new-style secret key, fall back to the legacy service-role key.
  const adminKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SB_SECRET_KEY") ??
    "";
  const jwksUrl =
    Deno.env.get("SUPABASE_JWKS_URL") ??
    (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : "");

  if (!supabaseUrl || !adminKey || !jwksUrl) {
    // Never echo which key is missing in detail; that is an operator concern.
    console.error("[admin-create-user] missing server configuration");
    return fail(
      "not_configured",
      "خدمة إنشاء المستخدمين غير مهيّأة على السيرفر. يرجى مراجعة إعدادات المشروع.",
      500,
    );
  }

  // ---- 1) Verify the caller's token ----
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return fail("unauthorized", "يجب تسجيل الدخول لإتمام هذه العملية.", 401);
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return fail("unauthorized", "يجب تسجيل الدخول لإتمام هذه العملية.", 401);
  }

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claimsData, error: claimsError } = await admin.auth.getClaims(token);
  const callerId = (claimsData?.claims?.sub as string | undefined) ?? undefined;
  if (claimsError || !callerId) {
    return fail("unauthorized", "جلسة الدخول غير صالحة أو منتهية. يرجى إعادة تسجيل الدخول.", 401);
  }

  // ---- 2) Re-derive the caller's authorisation from the database ----
  // IMPORTANT: `is_platform_superadmin()` returns true for ANY store `owner`
  // (see migration 20260917200000), so it must never be the sole gate here.
  // We require either an explicit store `owner` role or an explicit, active
  // row in platform_admins with a privileged tier.
  const [ownerRoleRes, platformAdminRes] = await Promise.all([
    admin.from("user_roles").select("id").eq("user_id", callerId).eq("role", "owner").maybeSingle(),
    admin
      .from("platform_admins")
      .select("role, is_active")
      .eq("user_id", callerId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const isStoreOwner = Boolean(ownerRoleRes.data);
  const platformRole = (platformAdminRes.data?.role as string | undefined) ?? "";
  const isPlatformPrivileged = platformRole === "superadmin" || platformRole === "admin";

  if (!isStoreOwner && !isPlatformPrivileged) {
    return fail("forbidden", "لا تملك صلاحية إضافة مستخدمين إلى هذا المتجر.", 403);
  }

  // ---- 3) Validate the payload ----
  let payload: CreateUserRequest;
  try {
    payload = (await req.json()) as CreateUserRequest;
  } catch {
    return fail("invalid_input", "تعذر قراءة بيانات الطلب.", 400);
  }

  const email = asTrimmedString(payload.email, 255).toLowerCase();
  const fullName = asTrimmedString(payload.full_name, 120);
  const phone = asTrimmedString(payload.phone, 40);
  const rawRole = asTrimmedString(payload.role, 40).toLowerCase();
  const language = asTrimmedString(payload.language, 5) === "en" ? "en" : "ar";

  if (!email || !EMAIL_RE.test(email)) {
    return fail("invalid_input", "يرجى إدخال بريد إلكتروني صحيح.", 400);
  }
  if (fullName.length < 2) {
    return fail("invalid_input", "يرجى إدخال اسم المستخدم (حرفان على الأقل).", 400);
  }

  // Reject privileged/unknown roles before the allow-list so the error message
  // is explicit rather than a generic "invalid role".
  if (FORBIDDEN_ROLE_VALUES.has(rawRole)) {
    return fail("invalid_role", "لا يمكن إنشاء حساب بهذه الصلاحية من لوحة المتجر.", 400);
  }
  if (!STORE_ROLES.includes(rawRole as StoreRole)) {
    return fail(
      "invalid_role",
      "الدور المحدد غير مسموح. يرجى اختيار دور من قائمة أدوار المتجر.",
      400,
    );
  }
  const role = rawRole as StoreRole;

  // Refuse to provision while the tenant has no roles at all: the
  // `bootstrap_first_owner` trigger would silently make the new account an
  // owner, which would then collide with the role we are about to insert.
  const { count: roleCount, error: roleCountError } = await admin
    .from("user_roles")
    .select("id", { count: "exact", head: true });
  if (roleCountError) {
    console.error("[admin-create-user] role count failed:", roleCountError.message);
    return fail("server_error", "تعذر التحقق من حالة المتجر. يرجى المحاولة مرة أخرى.", 500);
  }
  if (!roleCount) {
    return fail(
      "forbidden",
      "لا يوجد مالك للمتجر بعد، ولا يمكن إنشاء موظفين قبل تعيين المالك الأول.",
      403,
    );
  }

  // ---- 4) Quota check (server-side, before anything is created) ----
  const { data: subscription } = await admin
    .from("tenant_subscriptions")
    .select("plan_id, platform_plans(max_users, name)")
    .eq("tenant_id", "default")
    .maybeSingle();

  const plan = (subscription as { platform_plans?: { max_users?: number | null } } | null)
    ?.platform_plans;
  const maxUsers =
    typeof plan?.max_users === "number" && plan.max_users > 0 ? plan.max_users : null;

  if (maxUsers !== null) {
    const { count: userCount, error: countError } = await admin
      .from("user_roles")
      .select("id", { count: "exact", head: true });
    if (countError) {
      console.error("[admin-create-user] quota count failed:", countError.message);
      return fail("server_error", "تعذر التحقق من حصة المستخدمين. يرجى المحاولة مرة أخرى.", 500);
    }
    if ((userCount ?? 0) >= maxUsers) {
      return fail(
        "quota_exceeded",
        `تم الوصول إلى الحد الأقصى لعدد المستخدمين في باقتك الحالية (${maxUsers}). يرجى ترقية الباقة للمتابعة.`,
        403,
      );
    }
  }

  // ---- 5) Create the Auth user ----
  const password = generatePassword(16);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    // The admin hands the credentials over physically; the user never receives
    // an email in this flow, so the address must be pre-confirmed or GoTrue
    // would refuse every sign-in.
    email_confirm: true,
    user_metadata: { full_name: fullName, language },
  });

  if (createError || !created?.user) {
    const message = (createError?.message ?? "").toLowerCase();
    if (
      message.includes("already") ||
      message.includes("registered") ||
      message.includes("exists") ||
      message.includes("duplicate")
    ) {
      return fail("email_taken", "هذا البريد الإلكتروني مسجّل مسبقًا.", 409);
    }
    console.error("[admin-create-user] createUser failed:", createError?.message);
    return fail("server_error", "تعذر إنشاء حساب المستخدم. يرجى المحاولة مرة أخرى.", 500);
  }

  const newUserId = created.user.id;

  // ---- 6) Confirm/extend the profile created by `handle_new_user` ----
  // `handle_new_user` already inserted the row on auth.users INSERT, so this
  // is normally an UPDATE. The insert is a defensive fallback for the case
  // where that trigger is ever missing, so the account is never left without
  // a profile row.
  const profileFields = {
    full_name: fullName,
    phone: phone || null,
    language,
    // Migration 20260918000100 adds this column; it MUST be applied before
    // this function is deployed, otherwise this write fails here.
    is_active: true,
  };

  const { data: updatedProfiles, error: profileUpdateError } = await admin
    .from("profiles")
    .update(profileFields)
    .eq("id", newUserId)
    .select("id");

  let profileStepError = profileUpdateError;

  if (!profileStepError && (!updatedProfiles || updatedProfiles.length === 0)) {
    const { error: profileInsertError } = await admin
      .from("profiles")
      .insert({ id: newUserId, ...profileFields });
    profileStepError = profileInsertError;
  }

  if (profileStepError) {
    console.error("[admin-create-user] profile step failed:", profileStepError.message);
    return await rollbackOrphan(
      admin,
      newUserId,
      "تم إنشاء الحساب لكن تعذر إكمال ملفه الشخصي، ولم نتمكن من الحذف تلقائيًا. راجع قائمة المستخدمين قبل إعادة المحاولة.",
    );
  }

  // ---- 7) Link the store role ----
  const { error: roleError } = await admin.from("user_roles").insert({ user_id: newUserId, role });

  if (roleError) {
    console.error("[admin-create-user] role link failed:", roleError.code ?? roleError.message);
    // Clean up the freshly created account so no orphan is left behind. This
    // only ever touches the user created moments ago in this request — never
    // an existing user or any business data.
    return await rollbackOrphan(
      admin,
      newUserId,
      "تم إنشاء الحساب لكن فشل إسناد الدور، ولم نتمكن من حذف الحساب تلقائيًا. افتح قائمة المستخدمين وأكمل إسناد الدور يدويًا.",
      "role_link_failed",
    );
  }

  // ---- 8) Success: the password is returned exactly once, never stored ----
  return json({
    ok: true,
    user_id: newUserId,
    email,
    full_name: fullName,
    role,
    password,
  });
});
