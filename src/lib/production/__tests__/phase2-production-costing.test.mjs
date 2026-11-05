/**
 * كيف تشغّل هذا الملف:
 *   node --test src/lib/production/__tests__/phase2-production-costing.test.mjs
 *
 * لا يتصل هذا الاختبار بأي قاعدة بيانات. يقرأ ملفات الـ migration والواجهة
 * كنصوص ويتحقق من **عقود** المرحلة الثانية، لأن أي انحراف صامت في RPC واحد
 * يغيّر أثر التكلفة على المخزون والأستاذ دون أن تظهر رسالة خطأ.
 *
 * المرحلة الثانية:
 *   1. وحدات القياس في smart_manufacture تُطبع إلى وحدة الأساس قبل أي مقارنة.
 *   2. فصل مرحلة convert_stock اليدوي عن دورة الإنتاج.
 *   3. حماية سطور أمر الإنتاج من التعديل/الحذف بعد الترحيل.
 *   4. توزيع التكلفة المشتركة بلا تحريف السطر الأخير + ميزان كتلة.
 *   5. production_order_cost_detail تعرض المصادر والتوزيع بلا حساب في الواجهة.
 *   6. العكس ممنوع بعد أي أثر لاحق على الناتج.
 *   7. العزل بين مخزون الشركة وحبوب العملاء محفوظ (مساري البيع والطحن).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");

const read = (...parts) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");

const M9917 = "supabase/migrations/9917_phase2_production_unification_and_costing.sql";
const M9923 = "supabase/migrations/9923_phase1_expense_control_ledger_and_production_tax.sql";
const M9906 = "supabase/migrations/9906_company_production_orders_and_costing.sql";
const M43 = "supabase/migrations/43_audit_remediation_delivery_blockers.sql";
const M48 = "supabase/migrations/48_convert_stock_unit_count.sql";
const M33 = "supabase/migrations/33_milling_smart_manufacture_accounting.sql";
const PROD_LIB = "src/lib/production/production-orders.ts";
const CUSTODY = "src/lib/milling/custody.ts";
const DRAWER = "src/components/production/production-cost-detail-drawer.tsx";
const HISTORY = "src/routes/_app.milling.production-orders.tsx";
const MANUFACTURE = "src/routes/_app.milling.manufacture.tsx";
const TYPES = "src/integrations/supabase/types.ts";
const PHASE1 = "src/lib/expenses/__tests__/phase1-accounting-fixes.test.mjs";

/** يقرأ جسم تعريف دالة SQL بالاسم ومجموعة المعاملات الفعلية.
 *  دالة واحدة قد تُعرَّف عدة مرات بأغلفة مختلفة؛ لذا نطابق أول تعريف يحتوي
 *  كل اسم معامل مطلوب في توقيعه. يتوقف الاستخراج عند نهاية $function$;
 *  الخاصة بذلك التعريف فقط (لا عند أول نهاية في الملف).
 *
 *  معامل مطلوب يبدأ بـ '!' يعني "غائب" عن التوقيع: لازم لتمييز المغلف الرقيق
 *  (5 معاملات) عن المصدر الموسّع (6 معاملات)، لأن اسم _notes موجود في كليهما. */
function sqlFunction(sql, name, requiredParams = []) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`, "g");
  let match;
  while ((match = re.exec(sql))) {
    const end = sql.indexOf("\n$function$;", match.index);
    assert.notEqual(end, -1, `نهاية الدالة ${name} غير موجودة`);
    const body = sql.slice(match.index, end);
    const signature = body.slice(0, body.indexOf("AS $function$"));
    const matchesAll = requiredParams.every((raw) => {
      const absent = raw.startsWith("!");
      const param = absent ? raw.slice(1) : raw;
      return absent ? !signature.includes(param) : signature.includes(param);
    });
    if (matchesAll) return body;
  }
  assert.fail(`لا يوجد تعريف للدالة ${name} يطابق المعاملات [${requiredParams.join(", ")}]`);
}

const phase2 = read(M9917);
const phase1 = read(M9923);
const modern = read(M9906);
const legacy43 = read(M43);
const legacy33 = read(M33);
const convert = read(M48);
const prodLib = read(PROD_LIB);
const custody = read(CUSTODY);
const drawer = read(DRAWER);
const history = read(HISTORY);
const manufacture = read(MANUFACTURE).replace(/\r\n/g, "\n");
const genericTypes = read(TYPES);
const phase1Test = read(PHASE1);

const SOURCE_PARAMS = ["_grain_uom_id uuid"];
const WRAPPER5_PARAMS = ["_notes text", "!_grain_uom_id"];
const WRAPPER7_PARAMS = ["_grain_uom_id uuid", "_output_uom_id uuid"];

function smartSource(sql) {
  return sqlFunction(sql, "smart_manufacture", SOURCE_PARAMS);
}

/* ── 1. وحدات القياس في smart_manufacture ─────────────────────────────────── */

test("smart_manufacture يحوّل كميات المدخل والنواتج إلى وحدة الأساس عبر production_quantity_in_base", () => {
  const body = smartSource(phase2);
  assert.match(
    body,
    /v_grain_base_qty := public\.production_quantity_in_base\(\s*v_grain_product\.id, coalesce\(_grain_qty, 0\), _grain_uom_id\)/,
    "كمية القمح يجب أن تُحوَّل بوحدة الحبة الصحيحة قبل أي مقارنة",
  );
  assert.match(
    body,
    /v_base numeric := public\.production_quantity_in_base\(v_output_product\.id, r\.qty, r\.uom_id\)/,
    "كل ناتج يُحوَّل إلى وحدة أساسه قبل التقييم والتوزيع",
  );
  assert.match(body, /p_signed_qty => -v_grain_base_qty/, "الصرف يُسجل بوحدة الأساس المحوّلة");
  assert.match(body, /p_signed_qty => v_base/, "الاستلام يُسجل بوحدة الأساس المحوّلة");
});

test("smart_manufacture ينهي مقارنة أعداد الوحدات ويستعمل مكافئ الكتلة", () => {
  const body = smartSource(phase2);
  assert.doesNotMatch(
    body,
    /IF v_total_output_qty > _grain_qty THEN/,
    "لا مقارنة بين كمية القمح وكمية النواتج نفسها (وحدات مختلفة)",
  );
  assert.match(body, /v_output_mass_kg > v_grain_mass_kg/, "فحص الكتلة بدل الأعداد");
  assert.match(body, /v_waste_mass_kg := greatest\(0, v_grain_mass_kg - v_output_mass_kg\)/);
  assert.match(
    body,
    /IF NOT v_all_mass OR v_grain_mass_kg IS NULL THEN/,
    "رفض الفاقد بلا أساس كتلي",
  );
});

test("smart_manufacture يحتفظ بتوقيع 5 معاملات للتوافق الخلفي ويعرّف 6 معاملات", () => {
  const source = smartSource(phase2);
  assert.match(source, /_grain_uom_id uuid/);
  const wrapper5 = sqlFunction(phase2, "smart_manufacture", WRAPPER5_PARAMS);
  assert.match(
    wrapper5,
    /_warehouse_id uuid,\s*_grain_item_id uuid,\s*_grain_qty numeric,\s*_outputs jsonb,\s*_notes text\s*\)/,
  );
  assert.match(
    wrapper5,
    /RETURN public\.smart_manufacture\([\s\S]*NULL::uuid\)/,
    "الغلاف يفوّر وحدة الأساس",
  );
  const wrapper7 = sqlFunction(phase2, "smart_manufacture", WRAPPER7_PARAMS);
  assert.match(wrapper7, /_output_uom_id uuid/);
  assert.match(
    phase2,
    /GRANT EXECUTE ON FUNCTION public\.smart_manufacture\(uuid, uuid, numeric, jsonb, text\)\s+TO authenticated, service_role/,
  );
});

test("smart_manufacture يرفض حبوب العميل ويستخدم المصدر الفريد v_doc_id", () => {
  const body = smartSource(phase2);
  assert.match(body, /v_grain_product\.is_custody_item IS TRUE/);
  assert.match(body, /v_grain_product\.inventory_policy = 'CUSTOMER_OWNED'/);
  assert.match(body, /p_source_type => 'smart_manufacture',\s*p_source_id => v_doc_id/);
  assert.doesNotMatch(body, /p_source_id => _grain_item_id/, "الحركات لا تُنسب لصنف القمح");
  assert.match(body, /'waste_basis', 'MASS_KG'/);
});

test("smart_manufacture لا يفتح مسار إنتاج لعملية بلا تكلفة قابلة للتوزيع", () => {
  const body = smartSource(phase2);
  assert.match(body, /v_allocatable_cost <= 0 THEN/, "لا ترحيل بلا تكلفة");
  assert.match(
    body,
    /company_costing_method\(\) IS DISTINCT FROM 'MOVING_AVERAGE'/,
    "طريقة تكلفة غير مدعومة توقف المسار",
  );
});

test("الواجهة ترسل grainUomId وuom_id لكل ناتج للمسار القديم", () => {
  assert.match(custody, /_grain_uom_id: input\.grainUomId \|\| null/);
  assert.match(custody, /qty: o\.qty,\s*uom_id: o\.uomId \|\| null/);
  assert.match(genericTypes, /_grain_uom_id\?: string \| null;/);
});

test("الواجهة لا ترسل خصائص غير موجودة في توقيع RPC", () => {
  // 9917: custody.ts أرسل _grain_uom_id مع حمولة _outputs التي تحتوي uom_id،
  // فلم يطابق أي توقيع. 9918 يعرّف مغلف jsonb بنفس المفاتيح.
  assert.match(custody, /smart_manufacture/);
  assert.match(
    hardening,
    /CREATE OR REPLACE FUNCTION public\.smart_manufacture\(\s*p_payload jsonb\s*\)/,
  );
  assert.match(
    hardening,
    /GRANT EXECUTE ON FUNCTION public\.smart_manufacture\(jsonb\) TO authenticated, service_role/,
  );
});

/* ── 2. فصل مرحلة التحويل اليدوي ───────────────────────────────────────────── */

test("مسار الإنتاج الحديث يستعمل مصادر صرف/استلام خاصة به لا stock_conversion", () => {
  const complete = sqlFunction(phase2, "complete_production_order");
  assert.match(complete, /'PRODUCTION','production_material',v_material_id/);
  assert.match(complete, /'PRODUCTION','production_output',v_output_id/);
  assert.doesNotMatch(complete, /'stock_conversion'/, "تشغيلة الإنتاج لا تُخلط مع تحويل يدوي");
});

test("convert_stock يبقى على مصدره الخاص ويرفض أصناف العهدة", () => {
  const fn = sqlFunction(phase2, "convert_stock", ["_loss_qty numeric"]);
  assert.match(fn, /p_source_type => 'stock_conversion'/);
  assert.match(fn, /inventory_policy = 'CUSTOMER_OWNED'/);
});

test("حركات الإنتاج تحمل production_order_id (عمود صريح + trigger ربط)", () => {
  assert.match(
    phase2,
    /ADD COLUMN IF NOT EXISTS production_order_id uuid\s+REFERENCES public\.production_orders\(id\) ON DELETE RESTRICT/,
  );
  const link = sqlFunction(phase2, "production_link_movement_to_order");
  for (const type of [
    "production_material",
    "production_output",
    "production_reversal_material",
    "production_reversal_output",
  ]) {
    assert.match(link, new RegExp(`NEW\\.source_type = '${type}'`), `ربط ${type}`);
  }
  assert.match(phase2, /CREATE TRIGGER stock_movements_link_production_order/);
});

/* ── 3. حماية سطور أمر الإنتاج بعد الترحيل ─────────────────────────────────── */

test("سطور الأمر لا تُعدّل ولا تُحذف بعد الترحيل", () => {
  const guard = sqlFunction(phase2, "production_guard_posted_void_output");
  assert.match(guard, /v_status IS NOT NULL AND v_status <> 'DRAFT'/);
  assert.match(guard, /USING ERRCODE = 'restrict_violation'/);
  assert.match(phase2, /production_materials_locked_after_post/);
  assert.match(phase2, /production_outputs_locked_after_post/);
  assert.match(phase2, /production_losses_locked_after_post/);
  assert.match(phase2, /production_cost_allocations_no_delete/);
});

test("حماية التخصيص تمنع الحذف فقط ولا تعطّل إنشاء الأمر", () => {
  const stillOk = sqlFunction(phase2, "production_guard_cost_allocation_write");
  assert.match(stillOk, /IF TG_OP = 'DELETE' THEN/);
  assert.match(stillOk, /RETURN NEW;/);
});

/* ── 4. دورة الإنتاج الحديثة والتفاصيل ─────────────────────────────────────── */

test("complete_production_order يحتفظ بتوقيع 9916 ومنطق الضريبة من المرحلة الأولى", () => {
  const complete = sqlFunction(phase2, "complete_production_order");
  assert.match(
    complete,
    /p_order_id uuid,\s*p_materials jsonb,\s*p_outputs jsonb,\s*p_expenses jsonb DEFAULT '\[\]'::jsonb,\s*p_losses jsonb DEFAULT '\[\]'::jsonb/,
  );
  assert.match(
    complete,
    /FROM public\.production_expense_line_available\(v_expense_line\.id\) r/,
    "الضريبة غير المستردة وطرح المحمَّل سابقاً من المرحلة الأولى يجب أن يبقى",
  );
  // 9917 كانت تعيد كتابة الجسم وتغيّر معنى الحقول: v_factor يحمل تكلفة الوحدة
  // وتُكتب في unit_cost، فيظهر تكلفة الوحدة مضاعفة بعدد الوحدات. 9918 يحرّر
  // أسماء مستقلة لكل معنى حتى لا يسجل المواد تكلفة الوحدة في العمود الخطأ.
  assert.match(
    hardening,
    /v_material_movement_cost/,
    "تكلفة حركة المادة تُحفظ باسم مستقل عن معامل التحويل (9918)",
  );
  assert.match(
    hardening,
    /unit_cost=coalesce\(v_material_movement_cost,0\)\/nullif\(v_base_qty,0\)/,
    "unit_cost للمادة = تكلفة الحركة ÷ كمية الأساس (9918)",
  );
  assert.match(complete, /'1312','debit'/, "WIP مدين لصرف المواد والمصروف");
  assert.match(complete, /'1312','credit',v_total_wip/, "إقفال WIP بعد الترحيل");
  assert.match(complete, /'5911','debit',v_abnormal_cost/, "الفاقد غير الطبيعي مصروف مستقل");
});

test("complete_production_order يستخدم قفل التزامن وتوزيع التكلفة المشتركة", () => {
  const complete = sqlFunction(phase2, "complete_production_order");
  assert.match(
    complete,
    /PERFORM public\.production_lock_material_scope\(v_order\.warehouse_id, v_lock_products\)/,
  );
  assert.match(
    complete,
    /PERFORM public\.production_allocate_joint_cost\(v_order\.id, v_remaining_wip\)/,
  );
  assert.doesNotMatch(
    complete,
    /IF v_batch_line\.rn=v_output_count THEN\s*v_allocated:=v_remaining_wip;/,
    "لا تكرار لحمل المتبقي على آخر سطر داخل الدالة",
  );
});

test("distribution function يحمل المخرجات الواحدة كل WIP ويرفض وزن صفر", () => {
  const fn = sqlFunction(phase2, "production_allocate_joint_cost", ["p_total_allocatable numeric"]);
  assert.match(fn, /IF v_count = 1 THEN/);
  assert.match(fn, /v_total_weight <= 0 THEN/);
  assert.match(fn, /abs\(v_delta\) > 0\.005/);
  assert.match(fn, /allocation_value_per_base/);
});

test("الفاقد العددي يقبل product_id من مخرجات الأمر ويُحفظ بوحدة كتلة", () => {
  const complete = sqlFunction(phase2, "complete_production_order");
  assert.match(complete, /IF nullif\(v_loss->>'product_id',''\) IS NOT NULL THEN/);
  assert.match(complete, /صنف الفاقد يجب أن يكون أحد مخرجات نفس التشغيلة/);
  assert.match(complete, /coalesce\(nullif\(v_loss->>'uom_id',''\)::uuid, v_kg_factor\)/);
});

test("production_order_cost_detail موجود في العقد ويُقرأ من الواجهة بلا حساب محلي", () => {
  const detail = sqlFunction(phase2, "production_order_cost_detail");
  for (const key of [
    "'order'",
    "'materials'",
    "'cost_sources'",
    "'outputs'",
    "'losses'",
    "'journals'",
    "'excluded_expenses'",
    "'summary'",
  ]) {
    assert.match(detail, new RegExp(key), `المفتاح ${key} في تفاصيل التكلفة`);
  }
  assert.match(phase2, /EXECUTE 'SELECT public\.rpc_allowlist\(\)' INTO v_current/);
  assert.match(phase2, /v_additions text\[\] := ARRAY\['production_order_cost_detail'\]::text\[\]/);
  assert.match(
    phase2,
    /GRANT EXECUTE ON FUNCTION public\.production_order_cost_detail\(uuid\)\s+TO authenticated, service_role/,
  );
  assert.match(prodLib, /db\.rpc\("production_order_cost_detail"/);
  assert.match(drawer, /loadProductionOrderCostDetail/);
  assert.match(drawer, /m\.total_cost|totals\.materials/, "الواجهة تعرض القيم القادمة من الخادم");
});

test("صفحة سجل الإنتاج تفتح تفاصيل التكلفة من كل سطر", () => {
  assert.match(history, /ProductionCostDetailDrawer/);
  assert.match(history, /setCostOrder\(order\)/);
  assert.match(history, /open=\{Boolean\(costOrder\)\}/);
});

test("production_order_cost_check يكشف عدم توازن WIP مقابل المخرجات", () => {
  const fn = sqlFunction(phase2, "production_order_cost_check", ["p_order_id uuid"]);
  assert.match(fn, /material_cost \+ o\.conversion_cost/);
  assert.match(fn, /wip_balanced/);
  assert.match(phase2, /v_additions text\[\] := ARRAY\['production_order_cost_check'\]::text\[\]/);
});

/* ── 5. العكس والأثر اللاحق ────────────────────────────────────────────────── */

test("العكس يُعاد تعريفه بنفس التوقيع ويستدعي حارس الأثر اللاحق أولاً", () => {
  const reverse = sqlFunction(phase2, "reverse_production_order", ["p_reason text"]);
  assert.match(reverse, /p_order_id uuid,\s*p_reason text/);
  const guardPos = reverse.indexOf("production_output_has_downstream_use");
  const firstStock = reverse.indexOf("PERFORM public.post_stock_delta");
  assert.ok(guardPos > 0 && firstStock > guardPos, "الفحص يسبق أي حركة عكسية");
  assert.match(reverse, /لا يمكن عكس تشغيلة تعيد إنتاج الصنف نفسه المستخدم كمدخل/);
  assert.match(reverse, /reverse_journal_entry\(/);
  assert.match(reverse, /status='REVERSED',reversed_at=now\(\),reversed_by=v_user/);
});

test("production_output_has_downstream_use يتجاهل حركات نفس الأمر فقط", () => {
  const fn = sqlFunction(phase2, "production_output_has_downstream_use");
  assert.match(
    fn,
    /NOT \(sm\.source_type IN \('production_output','production_reversal_output'\)\s+AND sm\.source_id = o\.id\)/,
  );
  assert.match(fn, /sm\.owner_type = 'COMPANY'/);
});

/* ── 6. العزل بين مخزون الشركة وحبوب العملاء ──────────────────────────────── */

test("guard_production_company_stock_scope يمنع أصناف العهدة في مخزون الشركة", () => {
  const guard = sqlFunction(phase2, "guard_production_company_stock_scope");
  assert.match(guard, /is_custody_item IS TRUE/);
  assert.match(guard, /inventory_policy = 'CUSTOMER_OWNED'::public\.inventory_policy/);
  assert.match(phase2, /CREATE TRIGGER inventory_guard_company_scope/);
  assert.match(phase2, /NEW\.owner_type = 'COMPANY'::public\.owner_type/);
  assert.match(phase2, /CREATE TRIGGER item_cost_layers_guard_company_scope/);
});

test("أمر الإنتاج الشركة لا يستقبل أصنافاً للعميل لا كمادة ولا كمنتج", () => {
  const complete = sqlFunction(phase2, "complete_production_order");
  assert.match(complete, /مادة الأمر لا يمكن أن تكون صنف أمانة مملوكاً للعميل/);
  assert.match(complete, /ناتج التشغيلة لا يمكن أن يكون صنف أمانة مملوكاً للعميل/);
});

/* ── 7. سلامة الـ migration وعدم المساس بـ Phase 1 ─────────────────────────── */

test("9917 و9918 كلاهما معاملة واحدة، بلا backfill وبلا DELETE", () => {
  for (const [label, sql] of [
    ["9917", phase2],
    ["9918", hardening],
  ]) {
    const begins = (sql.match(/^BEGIN;$/gm) || []).length;
    const commits = (sql.match(/^COMMIT;$/gm) || []).length;
    assert.equal(begins, 1, `${label}: BEGIN واحد`);
    assert.equal(commits, 1, `${label}: COMMIT واحد`);
    assert.doesNotMatch(sql, /^\s*DELETE FROM/im, `${label}: بلا DELETE`);
    assert.doesNotMatch(
      sql,
      // المسموح: تحديثات داخل دورة الأمر نفسها (خطوة الحالة أو سطر أُنشئ في
      // هذه المعاملة)؛ الممنوع: تعديل جفي على بيانات أمر قائم. يُترك للتحقق
      // الدلالي في 9917، والاختبار هنا يضمن فقط غياب DELETE وغياب تعديل مباشر
      // على production_orders بخلاف تغيير الحالة.
      /^\s*UPDATE public\.production_orders\s+SET\b(?![^\n]*status=('POSTED'|'REVERSED'))/m,
      `${label}: بلا تعديل على سطور أمر قائم خارج العكس`,
    );
  }
});

test("9918 يُصلح تعارض v_factor في 9917 ولا يعيده", () => {
  // العلة الأصلية:
  //   SELECT sm.id,sm.total_cost,sm.unit_cost INTO v_movement_id,v_line_cost,v_factor
  //   UPDATE production_order_materials SET total_cost=v_line_cost, unit_cost=v_factor
  // فتقفز تكلفة الوحدة إلى (تكلفة الحركة × معامل التحويل). هذا يُبطل تفاصيل
  // التكلفة ولو كان مجموع total_cost سليماً. 9918 يُعيد كتابة الجسم بأسماء
  // مستقلة؛ فلا يجوز أن يعود هذا النمط إلى 9917 أو 9918.
  assert.match(
    phase2,
    /INTO v_movement_id,v_line_cost,v_factor/,
    "9917 هو موقع العلة (توثيق لا سبب لتمريره)",
  );
  assert.doesNotMatch(
    hardening,
    /INTO v_movement_id,v_line_cost,v_factor/,
    "تكلفة الحركة لا تُدخل في متغير معامل التحويل",
  );
  assert.doesNotMatch(
    hardening,
    /total_cost=coalesce\(v_line_cost,0\),unit_cost=coalesce\(v_factor,0\)/,
    "unit_cost لا يأخذ قيمة v_factor",
  );
});

/* ── 9. 9918: تقوية العقود بعد مراجعة 9917 ────────────────────────────────── */

const M9918 = "supabase/migrations/9918_phase2_production_contract_hardening.sql";
const hardening = read(M9918);

function smartHardened(sql) {
  return sqlFunction(sql, "smart_manufacture", ["_grain_uom_id uuid", "_grain_qty numeric"]);
}

test("9918: 9917 لم يتضمن توقيعاً يطابق مفاتيح الواجهة، و9918 يعرّف مغلف jsonb", () => {
  assert.doesNotMatch(phase2, /smart_manufacture\(\s*p_payload jsonb\s*\)/, "لم يُعالج في 9917");
  assert.match(
    hardening,
    /CREATE OR REPLACE FUNCTION public\.smart_manufacture\(\s*p_payload jsonb\s*\)/,
  );
  const payload = sqlFunction(hardening, "smart_manufacture", ["p_payload jsonb"]);
  for (const key of [
    "_warehouse_id",
    "_grain_item_id",
    "_grain_qty",
    "_outputs",
    "_notes",
    "_grain_uom_id",
  ]) {
    assert.ok(payload.includes(key), `مفتاح ${key} في الحمولة`);
  }
});

test("9918: المصدر الموسّع يتحقق من رصيد القمح ومخزون الشركة للنواتج", () => {
  const body = smartHardened(hardening);
  assert.match(body, /رصيد القمح غير كافٍ/, "فحص رصيد الشركة قبل الصرف");
  assert.match(body, /FROM public\.inventory i/);
  assert.match(body, /public\.production_product_is_company_stock\(v_output_product\.id\)/);
  assert.match(body, /length\(coalesce\(_notes, ''\)\) > 2000/);
});

test("9918: حركات المخزون COMPANY ترفض أصناف العهدة على مستوى stock_movements", () => {
  const guard = sqlFunction(hardening, "guard_company_stock_movement_scope");
  assert.match(guard, /NEW\.owner_type <> 'COMPANY'::public\.owner_type/);
  assert.match(guard, /is_custody_item IS TRUE/);
  assert.match(guard, /inventory_policy = 'CUSTOMER_OWNED'::public\.inventory_policy/);
  assert.match(hardening, /CREATE TRIGGER stock_movements_guard_company_scope/);
  assert.match(hardening, /WHEN \(NEW\.owner_type = 'COMPANY'::public\.owner_type\)/);
});

test("9918: تفاصيل التكلفة تعيد تدقيق WIP من الخادم وLEFT JOIN للتصنيف", () => {
  const detail = sqlFunction(hardening, "production_order_cost_detail");
  assert.match(detail, /wip_balanced/);
  assert.match(detail, /rounding_variance/);
  assert.match(detail, /material_subtotal/);
  assert.match(detail, /LEFT JOIN public\.expense_categories c ON c\.id = l\.category_id/);
});

test("9918: سجل الإنتاج RPC خفيف والواجهة تقرأه بدل select عام", () => {
  const historyFn = sqlFunction(hardening, "production_order_history", ["p_limit integer"]);
  assert.match(historyFn, /LIMIT v_limit/);
  assert.match(historyFn, /least\(greatest\(coalesce\(p_limit, 250\), 1\), 500\)/);
  assert.match(prodLib, /db\.rpc\("production_order_history"/);
  assert.doesNotMatch(prodLib, /from\("production_orders"\)\s*\.select\(\s*"id,order_number/);
});

test("9918: صفحة التصنيع ترسل الفاقد العددي بصنف الناتج", () => {
  assert.match(manufacture, /product_id: line\.productId \|\| null/);
  assert.match(manufacture, /uom_id: line\.productId \? null : line\.uomId \|\| null/);
  assert.match(
    manufacture,
    /product\.item_class === "FINISHED_GOOD" \|\|\s*\(product\.item_class === "BY_PRODUCT" && product\.is_sellable\)/,
    "المنتج التام لا يشترط is_sellable؛ الناتج الجانبي يشترطه",
  );
});

test("9916 و9906 لم يُعاد كتابتهما من المرحلة الثانية", () => {
  assert.match(
    phase1,
    /v_available:=round\(v_expense_line\.net_amount-v_already_allocated,2\)|production_expense_line_available\(v_expense_line\.id\)/,
  );
  assert.match(modern, /v_available:=round\(v_expense_line\.net_amount-v_already_allocated,2\);/);
  assert.match(
    legacy33,
    /v_waste_qty := greatest\(0, coalesce\(_grain_qty, 0\) - v_total_output_qty\)/,
    "تاريخ 33 محفوظ كمرجع للتدقيق",
  );
  assert.match(legacy43, /p_source_id => v_doc_id/, "43 محفوظ كما هو أيضاً");
  assert.match(convert, /FIXED_MANUAL/, "48 محفوظ كما هو");
});

test("عقود المرحلة الأولى لا تزال مفصله من هذا الملف", () => {
  assert.ok(
    phase1Test.includes("post_expense لا يقبل DRAFT"),
    "اختبارات المرحلة الأولى تملك مصدرها المستقل",
  );
});

/* ── 8. الواجهة: معلومات التكلفة تعرض دون كسر التدفق ─────────────────────── */

test("نموذج التصنيع يعرض المتاح والمحمَّل سابقاً ويقسّم الفاقد لوحدة الصنف", () => {
  assert.match(manufacture, /المتاح \$\{fmtNum\(Number\(source\.available_amount\)\)\}/);
  assert.match(manufacture, /محمّل سابقاً/);
  assert.match(manufacture, /uom_id: line\.uomId \|\| null/);
});

test("ProductionLossInput يقبل حقل product_id و mass_kg الاختياريين", () => {
  assert.match(prodLib, /product_id\?: string \| null;/);
  assert.match(prodLib, /mass_kg\?: number \| null;/);
});
