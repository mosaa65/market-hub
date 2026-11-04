/**
 * كيف تشغّل هذا الملف:
 *   node --test src/lib/expenses/__tests__/phase1-accounting-fixes.test.mjs
 *
 * ملاحظة: لا يتصل هذا الاختبار بأي قاعدة بيانات. يقرأ ملفات الـ migration
 * والنموذج والهوك كنصوص، ويتحقق من **عقود** الإصلاحات الأربعة للمرحلة الأولى،
 * لأن الانحراف الصامت في RPC واحد (توقيع أو شرط) يغيّر أثره المحاسبي كاملاً
 * دون أن تظهر رسالة خطأ في الواجهة.
 *
 * 1. لا يُرحَّل DRAFT دون اعتماد مسجّل: post_expense يُعاد تعريفه بالكامل في
 *    9916، ولا يفتح الترحيل المباشر إلا عبر allow_draft_post + صلاحية owner
 *    + سبب موثّق.
 * 2. مصروف المورد يكتب في دفتر المورد الفرعي عند الترحيل والسداد والعكس.
 * 3. تكلفة الإنتاج تستخدم الجزء المؤهل من الضريبة غير المستردة مرة واحدة.
 * 4. الترحيل والسداد idempotent، والقيد لا يتكرر لمستند واحد.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");

const read = (...parts) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");

const M9916 = "supabase/migrations/9916_phase1_expense_control_ledger_and_production_tax.sql";
const M9906 = "supabase/migrations/9906_company_production_orders_and_costing.sql";
const M9913 = "supabase/migrations/9913_expense_accounting_lifecycle_integrity.sql";
const FORM = "src/components/expenses/expense-form.tsx";
const HOOK = "src/hooks/use-expenses.ts";
const DRAWER = "src/components/expenses/expense-detail-drawer.tsx";

/** يستخرج جسم دالة SQL من أول CREATE يعرّفها حتى آخر $function$; قبلها. */
function sqlFunctionBody(sql, name) {
  const start = sql.search(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`, "m"),
  );
  assert.notEqual(start, -1, `تعريف الدالة ${name} غير موجود`);
  const end = sql.indexOf("\n$function$;", start);
  assert.notEqual(end, -1, `نهاية الدالة ${name} غير موجودة`);
  return sql.slice(start, end);
}

/** يستخرج كتلة الدالة من ملف يبدأ جسدها فعلاً (لا من ملف يُعيد تعريفها فقط). */
function sqlFunctionSignature(sql, name) {
  const body = sqlFunctionBody(sql, name);
  return body.slice(0, body.indexOf("AS $function$"));
}

const migration = read(M9916);
const production = read(M9906);
const lifecycle = read(M9913);
const form = read(FORM);
const hook = read(HOOK);
const drawer = read(DRAWER);

/* ── 1. لا يتخطى الترحيل قرار الاعتماد ─────────────────────────────────────── */

test("post_expense لا يقبل DRAFT بلا allow_draft_post وصلاحية owner وسبب موثّق", () => {
  const body = sqlFunctionBody(migration, "post_expense");
  assert.match(body, /IF v_from = 'DRAFT' THEN/, "لا بد من فرع صريح للترحيل من المسودة");
  assert.match(
    body,
    /public\.has_role\(v_user, 'owner'\)\s+AND\s+coalesce\(v_entry\.allow_draft_post, false\)/,
    "شرط الترحيل المباشر يجب أن يجمع توقيع المالك مع allow_draft_post",
  );
  assert.match(
    body,
    /expense_require_override_reason\(v_entry\.draft_post_reason\)/,
    "سبب التجاوز يجب أن يكون مكتوباً في المستند نفسه",
  );
  // لا يكفي امتلاك expense.approve كما كان في 9913 (السطر 748).
  assert.doesNotMatch(
    body,
    /expense_can\(v_user, 'expense\.approve'\)/,
    "لا يجوز أن يبقى شرط الصلاحية وحده مبرّراً لترحيل المسودة",
  );
});

test("9913 ما زال يحتوي التجاوز القديم — ولهذا وجب إعادة تعريف post_expense", () => {
  const old = sqlFunctionBody(lifecycle, "post_expense");
  assert.match(
    old,
    /v_from NOT IN \('APPROVED', 'DRAFT'\)/,
    "الدليل على وجود الاستثناء الأصلي: قبول DRAFT في 9913",
  );
});

test("توقيع post_expense لم يتغير حتى لا تنكسر العملاء الحاليون", () => {
  const signature = sqlFunctionSignature(migration, "post_expense");
  assert.match(signature, /p_idempotency_key text DEFAULT NULL/);
  assert.match(signature, /p_cashbox_id uuid DEFAULT NULL/);
  assert.match(signature, /p_bank_account_id uuid DEFAULT NULL/);
  assert.match(signature, /p_payment_method_id text DEFAULT NULL/);
  assert.doesNotMatch(signature, /p_override/i, "لا معاملات جديدة تُضاف لعقد RPC قائم");
});

test("decide_expense هو المسار الوحيد الذي يفتح الترحيل المباشر", () => {
  const decide = sqlFunctionBody(migration, "decide_expense");
  assert.match(decide, /status NOT IN \('SUBMITTED', 'DRAFT'\)/);
  assert.match(decide, /allow_draft_post = CASE WHEN p_approve AND v_entry\.status = 'DRAFT' THEN true/);
  assert.match(decide, /v_reason IS NULL AND v_entry\.status = 'DRAFT'/, "سبب مكتوب إلزامي");
  assert.match(
    decide,
    /created_by = v_user\s+AND NOT \(public\.has_role\(v_user, 'owner'\)/,
    "المحاسب/المدير لا يعتمدان مستنديهما",
  );
  assert.match(migration, /BEFORE UPDATE OF draft_post_reason/, "سبب التجاوز لا يُعاد كتابته");
});

test("لوحة المستند لا تعرض زر ترحيل على المسودة، والنموذج يمر عبر الاعتماد أولاً", () => {
  assert.doesNotMatch(
    drawer,
    /entry\.status === "DRAFT"[^\n]*\n[\s\S]{0,400}mutations\.post\.mutateAsync/,
    "لا زر ترحيل مباشر لمستند DRAFT",
  );
  assert.match(
    form,
    /directDraftPost[\s\S]{0,600}mutations\.decide\.mutateAsync/,
    "التجاوز يمر عبر قرار اعتماد مسجّل ثم ترحيل",
  );
  assert.match(form, /const submitForApproval = submit && !directDraftPost;/);
  assert.match(form, /hasRole\("owner"\) && ownerDraftOverride/, "التجاوز للمالك فقط");
});

/* ── 2. مصروف المورد يصل إلى دفتر المورد الفرعي ─────────────────────────────── */

test("ترحيل مصروف مورد يكتب استحقاقاً في دفتر المورد بمفتاح مصدر فريد", () => {
  const body = sqlFunctionBody(migration, "post_expense");
  assert.match(
    body,
    /payee_type = 'SUPPLIER' AND v_entry\.supplier_id IS NOT NULL THEN\s+PERFORM public\.expense_write_supplier_ledger\(/,
    "الاستحقاق يجب أن يمر على دفتر المورد لا على حساب AP العام فقط",
  );
  assert.match(body, /'EXP-' \|\| p_entry_id::text/, "مفتاح المصدر نصفه معرّف المستند");
});

test("السداد يخصم الذمة في دفتر المورد، بالتزامن مع قيد الأستاذ", () => {
  const body = sqlFunctionBody(migration, "record_expense_payment");
  assert.match(body, /expense_write_supplier_ledger\([\s\S]{0,200}'EXPPAY-' \|\| v_payment_id::text/);
  assert.match(body, /v_credit_acct := public\.expense_posting_account_code\(v_payable_role\)/);
  assert.match(body, /v_credit_acct, 'debit', v_amount/, "قيد السداد: مدين الالتزام");
  assert.match(body, /v_cash_acct, 'credit', v_amount/, "قيد السداد: دائن النقدية/البنك");
});

test("العكس يمحو حركة المورد ويقيد حركة عكسية بنفس المرجع", () => {
  const body = sqlFunctionBody(migration, "reverse_expense");
  assert.match(body, /expense_reverse_supplier_ledger\(\s*v_entry\.supplier_id, 'EXP-' \|\| p_entry_id::text/);
  const helper = sqlFunctionBody(migration, "expense_reverse_supplier_ledger");
  assert.match(helper, /v_original\.credit > 0[\s\S]{0,160}'DEBIT', v_original\.credit/);
  assert.match(helper, /v_original\.debit > 0[\s\S]{0,160}'CREDIT', v_original\.debit/);
});

test("توازن حركة المورد: اشتراك/استحقاق بالدائن ودفعة بالمدين على نفس المصدر", () => {
  const helper = sqlFunctionBody(migration, "expense_write_supplier_ledger");
  assert.match(helper, /'CREDIT' THEN v_amount ELSE 0 END/);
  assert.match(helper, /'DEBIT' THEN v_amount ELSE 0 END/);
  // الرصيد يتحرك بمقدار الحركة نفسها، فيبقى كشف المورد مساوياً لحساب 2111 بعد الترحيل.
  assert.match(helper, /coalesce\(balance, 0\) \+ v_amount/);
  assert.match(helper, /coalesce\(balance, 0\) - v_amount/);
});

/* ── 3. الضريبة غير القابلة للاسترداد في تكلفة الإنتاج ─────────────────────── */

test("الجزء المؤهل = الصافي + الضريبة غير المستردة فقط", () => {
  const helper = sqlFunctionBody(migration, "expense_line_production_base_amount");
  assert.match(helper, /WHEN coalesce\(p_tax_recoverable, false\) THEN 0 ELSE coalesce\(p_tax_amount, 0\) END/);
});

test("حساب المتاح يطرح المحمَّل سابقاً من الجزء المؤهل (منع الرسملة المزدوجة)", () => {
  const body = sqlFunctionBody(migration, "production_expense_line_available");
  assert.match(body, /public\.expense_line_production_base_amount\(l\.net_amount, l\.tax_amount, e\.tax_recoverable\)/);
  assert.match(body, /coalesce\(\([\s\S]*?sum\(a\.amount\)[\s\S]*?\), 0\)/);
  assert.match(body, /available_amount numeric/);
});

test("إكمال التشغيلة يقرأ المتاح من الدالة الجديدة لا من net_amount وحدها", () => {
  const body = sqlFunctionBody(migration, "complete_production_order");
  assert.match(body, /FROM public\.production_expense_line_available\(v_expense_line\.id\) r/);
  assert.doesNotMatch(
    body,
    /v_available:=round\(v_expense_line\.net_amount-v_already_allocated,2\)/,
    "السطر الأصلي في 9906 هو سبب استبعاد الضريبة، ولا يجوز بقاؤه",
  );
  assert.match(body, /IF v_line_cost>v_available THEN/);
  assert.match(body, /IF v_expense_category_eligible IS NOT TRUE THEN/, "غير المؤهل لا يُرسمل");
});

test("ملف 9906 الأصلي لم يُعدّل: الإصلاح إعادة تعريف مقيَّدة في 9916", () => {
  assert.match(
    production,
    /v_available:=round\(v_expense_line\.net_amount-v_already_allocated,2\);/,
    "تاريخ الت migrations محفوظ كما هو",
  );
});

/* ── 4. منع التكرار (idempotency) ──────────────────────────────────────────── */

test("الترحيل لا ينشئ قيداً ثانياً لنفس المستند", () => {
  const body = sqlFunctionBody(migration, "post_expense");
  assert.match(
    body,
    /FROM public\.journal_entries je\s+WHERE je\.source_type = 'expense' AND je\.source_id = p_entry_id[\s\S]{0,120}RAISE EXCEPTION/,
    "قيد الأستاذ المصدرى فريد لكل مصروف",
  );
});

test("أزرار الترحيل والسداد في الواجهة تستخدم مفاتيح ثابتة قابلة لإعادة المحاولة", () => {
  assert.match(hook, /p_idempotency_key: input\.payNow \? `post:\$\{input\.id\}` : null/);
  assert.match(hook, /input\.idempotencyKey \|\| makeIdempotencyKey\(`pay:\$\{input\.id\}`\)/);
  assert.match(drawer, /idempotencyKey: `pay:\$\{entry\.id\}:\$\{payAttemptKey\}`/);
  assert.match(drawer, /setPayAttemptKey/, "مفتاح جديد لكل نافذة وليس لكل نقرة");
});

test("السداد يعيد المستند عند تكرار المفتاح، ويرفض إعادة استعماله بمبلغ مختلف", () => {
  // النفح الفعلي داخل body: (1) البحث عن المفتاح في expense_payments،
  // (2) مقارنة المستند والمبلغ، (3) رمي الخطأ. ترتيب التعليقات بين (1) و(2)
  // ليس جزءاً من العقد، لذلك نطابق كل خطوة مستقلة بدل مسافة ثابتة.
  const body = sqlFunctionBody(migration, "record_expense_payment");
  const lookupAt = body.search(/WHERE idempotency_key = v_key;/);
  const rejectAt = body.search(/already used for a different payment/);
  const returnAt = body.search(/RETURN v_entry;/);
  assert.ok(lookupAt >= 0, "الاستعلام عن مفتاح الدفعة يجب أن يكون بالمفتاح الفريد");
  assert.ok(rejectAt > lookupAt, "رفض إعادة استعمال المفتاح بمبلغ مختلف يأتي بعد البحث عنه");
  assert.ok(returnAt > lookupAt, "إعادة المستند عند إعادة الطلب بالنفس المفتاح");
  assert.match(
    body,
    /v_existing\.entry_id <> p_entry_id OR v_existing\.amount <> v_amount/,
    "مقارنة المستند والمبلغ قبل إعادة المستند",
  );
});

test("إنشاء المصروف يملك مفتاح idempotency وفهرساً فريداً (يحافظ على 9913)", () => {
  assert.match(lifecycle, /uq_expense_create_idempotency/);
  assert.match(lifecycle, /pg_advisory_xact_lock\(hashtextextended\(v_user::text \|\| ':' \|\| v_idempotency_key, 0\)\)/);
  assert.match(lifecycle, /WHERE created_by = v_user AND create_idempotency_key = v_idempotency_key/);
});

/* ── سلامة الـ migration ───────────────────────────────────────────────────── */

test("9916 معاملة واحدة: BEGIN ثم COMMIT واحد في النهاية بلا backfill", () => {
  const beginCount = (migration.match(/^BEGIN;$/gm) || []).length;
  const commitCount = (migration.match(/^COMMIT;$/gm) || []).length;
  assert.equal(beginCount, 1, "BEGIN واحد");
  assert.equal(commitCount, 1, "COMMIT واحد؛ أي جزء يُطبَّق كاملاً أو لا يُطبَّق");
  assert.match(migration.trimEnd(), /COMMIT;\n/);
  assert.doesNotMatch(migration, /^\s*BACKFILL\b/im);
  assert.doesNotMatch(migration, /DELETE FROM/i, "لا حذف بيانات");
});

test("9916 لا يعدّل مخطط 9906، ويعيد تعريف الدوال بنفس التوقيع والملكية", () => {
  for (const name of ["post_expense", "record_expense_payment", "reverse_expense", "decide_expense"]) {
    const body = sqlFunctionBody(migration, name);
    assert.match(body, /LANGUAGE plpgsql/, `${name} بلغة plpgsql`);
    assert.match(body, /SECURITY DEFINER/, `${name} يحتفظ بحدود الصلاحيات`);
    assert.match(body, /SET search_path = public/, `${name} لا يعتمد على search_path المستدعي`);
  }
  const signature = sqlFunctionSignature(migration, "record_expense_payment");
  for (const arg of ["p_entry_id", "p_amount", "p_payment_date", "p_idempotency_key", "p_cashbox_id"]) {
    assert.match(signature, new RegExp(arg), `التوقيع يحتفظ بـ ${arg}`);
  }
});

test("التوازن المحاسبي: قيد الاستحقاق (مدين مصروف + دائن التزام) والسداد (مدين التزام + دائن نقد)", () => {
  const body = sqlFunctionBody(migration, "post_expense");
  assert.match(body, /'debit', r\.debit_amount/);
  assert.match(
    body,
    /public\.expense_posting_account_code\(v_payable_role\),\s+'credit', round\(v_entry\.total_amount, 2\)/,
    "الاستحقاق يُقيد بكامل إجمالي المستند مقابل حساب الالتزام",
  );
  assert.match(body, /WHEN v_entry\.tax_recoverable THEN 0 ELSE l\.tax_amount END/, "الضريبة غير المستردة داخل حساب المصروف");
});
