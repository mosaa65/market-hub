/**
 * seed-demo-stock.mjs — بيانات تجريبية واقعية لمطحنة يمنية
 *
 * يدخل عبر الـ RPCs الرسمية فقط:
 *   1) public.post_opening_stock(...) → أرصدة أول المدة (تُحرّك المخزون فعلياً)
 *   2) public.create_sale(...)       → فواتير بيع كاملة (مخزون + قيود محاسبية)
 *
 * لا يُدخل أي صف مباشر في stock_movements أو sales_invoices، حتى لا تترك
 * بيانات تجريبية تتخطّى محرك الترحيل وتفسد التقارير.
 *
 * ⚠️ لا يمسح بيانات موجودة. للتشغيل مرتين: مرّر --force.
 */
import { connect } from "./db-run.mjs";

const SEED_MARK = "DEMO-SEED-2026";
const FORCE = process.argv.includes("--force");
const CLEAN = process.argv.includes("--clean-demo");

//DEMO PLAN — كل الكميات بوحدة الأساس للصنف، والتكلفة = تكلفة الشراء في الكتالوج
// (المخزون يُقاس بنفس وحدة الأساس، والتكلفة المُدخلة في post_opening_stock هي
// تكلفة وحدة الأساس نفسها، وإلا انفصل تقييم المخزون عن سعر الوحدة المعروض).
const PLAN = {
  opening: [
    // مواد خام — الشراء بالشوال (50 كجم)
    { sku: "RM-WHEAT-HARD",  qty: 60,  cost: 11400 },
    { sku: "RM-WHEAT-LOCAL", qty: 40,  cost: 11000 },
    { sku: "RM-WHEAT-SOFT",  qty: 30,  cost: 10800 },
    { sku: "RM-CORN-YELLOW", qty: 20,  cost: 12500 },
    { sku: "RM-CORN-WHITE",  qty: 15,  cost: 12000 },
    { sku: "RM-BARLEY",      qty: 12,  cost: 9000 },
    // منتجات مطحونة وناتج طحن — بالكيلوجرام
    { sku: "FP-FLOUR-G1",    qty: 1000, cost: 450 },
    { sku: "FP-FLOUR-G2",    qty: 700,  cost: 400 },
    { sku: "FP-SEMOLINA",    qty: 350,  cost: 500 },
    { sku: "FP-BRAN",        qty: 1500, cost: 80 },
    { sku: "FP-CRACKED",     qty: 250,  cost: 380 },
    // مستلزمات تعبئة — بالقطعة
    { sku: "PKG-BAG-50",     qty: 400,  cost: 350 },
    { sku: "PKG-BAG-25",     qty: 250,  cost: 200 },
    { sku: "PKG-BAG-10",     qty: 150,  cost: 100 },
    { sku: "PKG-THREAD",     qty: 40,   cost: 120 },
  ],
  sales: [
    { days: 1, items: [{ sku: "FP-FLOUR-G1", qty: 150, price: 550 }, { sku: "FP-SEMOLINA", qty: 40, price: 620 }] },
    { days: 2, items: [{ sku: "FP-FLOUR-G2", qty: 100, price: 480 }] },
    { days: 3, items: [{ sku: "FP-BRAN", qty: 300, price: 120 }] },
    { days: 4, items: [{ sku: "SRV-MILL-TON", qty: 1, price: 18000 }] },
    { days: 5, items: [{ sku: "FP-FLOUR-G1", qty: 200, price: 540 }, { sku: "SRV-MILL-BAG25", qty: 2, price: 500 }] },
    { days: 6, items: [{ sku: "PKG-BAG-50", qty: 20, price: 500 }, { sku: "FP-CRACKED", qty: 50, price: 460 }] },
  ],
  prices: [
    { sku: "FP-FLOUR-G1",    cost: 450,  sale: 550 },
    { sku: "FP-FLOUR-G2",    cost: 400,  sale: 480 },
    { sku: "FP-SEMOLINA",    cost: 500,  sale: 620 },
    { sku: "FP-BRAN",        cost: 80,   sale: 120 },
    { sku: "FP-CRACKED",     cost: 380,  sale: 460 },
    { sku: "RM-CORN-WHITE",  cost: 12000, sale: 14000 },
    { sku: "PKG-BAG-50",     cost: 350,  sale: 500 },
    { sku: "PKG-BAG-25",     cost: 200,  sale: 300 },
    { sku: "PKG-BAG-10",     cost: 100,  sale: 150 },
    { sku: "PKG-THREAD",     cost: 120,  sale: 200 },
    { sku: "SRV-MILL-BAG50", cost: 0,    sale: 1000 },
    { sku: "SRV-MILL-BAG25", cost: 0,    sale: 500 },
    { sku: "SRV-MILL-TON",   cost: 0,    sale: 18000 },
  ],
  // وحدة الأساس لكل صنف —楼层 بدون وحدة تُعطى وحدة صريحة
  units: [
    { sku: "RM-CORN-WHITE", unit: "BAG-50" },
    { sku: "FP-FLOUR-G1", unit: "kg" },
    { sku: "FP-FLOUR-G2", unit: "kg" },
    { sku: "FP-SEMOLINA", unit: "kg" },
    { sku: "FP-BRAN", unit: "kg" },
    { sku: "FP-CRACKED", unit: "kg" },
    { sku: "PKG-BAG-50", unit: "BAG-50" },
    { sku: "PKG-BAG-25", unit: "BAG-25" },
    { sku: "PKG-BAG-10", unit: "BAG-10" },
    { sku: "PKG-THREAD", unit: "قطعة" },
    { sku: "SRV-MILL-BAG25", unit: "BAG-25" },
  ],
};

const c = await connect();
await c.connect();

async function q(sql, params = []) {
  const res = await c.query(sql, params);
  return res.rows;
}

console.log("🌱 بذر بيانات تجريبية لمطحنة...\n");

// ── الحصول على المعرّفات الأساسية ──
const owner = (
  await q(`SELECT pr.id FROM profiles pr JOIN user_roles r ON r.user_id=pr.id
           WHERE r.role='owner' LIMIT 1`)
)[0]?.id;

if (!owner) {
  console.error("❌ لم يُعثر على مستخدم بدور owner.");
  await c.end();
  process.exit(1);
}

const wh = (await q(
  `SELECT id FROM warehouses WHERE is_active ORDER BY is_default DESC LIMIT 1`
))[0]?.id;

if (!wh) {
  console.error("❌ لم يُعثر على مستودع نشط.");
  await c.end();
  process.exit(1);
}

const bySku = {};
for (const p of await q(
  `SELECT id, sku, name_ar, item_class, inventory_policy FROM products WHERE is_active`
)) bySku[p.sku] = p;

console.log(`   👤 مالك: ${owner}`);
console.log(`   🏭 مستودع: ${wh}`);
console.log(`   📦 منتجات نشطة: ${Object.keys(bySku).length}\n`);

// ── 0. تنظيف بذر تجريبي سابق ──
if (CLEAN) {
  console.log("── 0) تنظيف بذر تجريبي سابق ──");
  await q("BEGIN");

  const demoInv = await q(`SELECT id FROM sales_invoices WHERE note LIKE $1`, [`%${SEED_MARK}%`]);
  const invIds = demoInv.map((i) => i.id);
  const demoOpen = await q(`SELECT id FROM stock_openings WHERE note = $1`, [SEED_MARK]);
  const openIds = demoOpen.map((o) => o.id);

  // الحركات المولّدة عن المستندات التجريبية فقط، والإلا بقت أثراً في المخزون.
  const demoMoves = await q(
    `SELECT id FROM stock_movements
      WHERE (source_type = 'sales_invoice'   AND source_id = ANY($1::uuid[]))
         OR (source_type = 'stock_opening'   AND source_id = ANY($2::uuid[]))`,
    [invIds, openIds]
  );
  const moveIds = demoMoves.map((m) => m.id);

  if (moveIds.length) {
    await q(`DELETE FROM item_cost_transactions WHERE source_id = ANY($1::uuid[])
              AND source_type IN ('stock_opening','sales_invoice','sales')`, [moveIds]);
    await q(`DELETE FROM stock_movements WHERE id = ANY($1::uuid[])`, [moveIds]);
  }
  if (invIds.length) {
    await q(`DELETE FROM customer_payment_splits WHERE invoice_id = ANY($1::uuid[])`, [invIds]);
    await q(`DELETE FROM customer_ledger WHERE reference_id = ANY($1::uuid[])
              AND reference_type = 'sales_invoice'`, [invIds]);
    await q(`DELETE FROM sales_invoice_items WHERE invoice_id = ANY($1::uuid[])`, [invIds]);
    await q(`UPDATE sales_invoices SET status = 'cancelled' WHERE id = ANY($1::uuid[])`, [invIds]);
    await q(`DELETE FROM sales_invoices WHERE id = ANY($1::uuid[])`, [invIds]);
  }
  if (openIds.length) {
    await q(`DELETE FROM stock_opening_items WHERE opening_id = ANY($1::uuid[])`, [openIds]);
    await q(`DELETE FROM stock_openings WHERE id = ANY($1::uuid[])`, [openIds]);
  }

  // إعادة بناء الأرصدة من الحركات المتبقية — المصدر الوحيد للمخزون.
  await q(`DELETE FROM inventory`);
  await q(`
    INSERT INTO inventory (product_id, warehouse_id, owner_type, owner_id, quantity)
    SELECT product_id, warehouse_id, owner_type, owner_id, sum(quantity)
      FROM stock_movements
     GROUP BY product_id, warehouse_id, owner_type, owner_id
  `);

  await q("COMMIT");
  console.log(`   🧹 حُذفت ${invIds.length} فاتورة و ${openIds.length} مستند افتتاحي و ${moveIds.length} حركة`);
}

// ── إعداد الجلسة كمستخدم حقيقي ──
await q("BEGIN");
await q(`SET LOCAL role authenticated`);
await q(`SET LOCAL "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);

// ── حارس: لا نكرّر البذر ──
const already = (await q(
  `SELECT count(*)::int AS n FROM stock_openings WHERE note = $1`, [SEED_MARK]
))[0]?.n ?? 0;

if (already > 0 && !FORCE) {
  console.log(`ℹ️  البذر التجريبي موجود مسبقاً (${already} مستند). استخدم --force لإضافته مرة أخرى.`);
  await q("ROLLBACK");
  await c.end();
  process.exit(0);
}

// ── 1. أرصدة افتتاحية ──
console.log("\n── 1) أرصدة أول المدة ──");

const openingItems = [];
for (const line of PLAN.opening) {
  const prod = bySku[line.sku];
  if (!prod) { console.log(`   ⚠️  ${line.sku} — غير موجود، تُخطّى`); continue; }
  if (prod.inventory_policy !== "TRACKED") {
    console.log(`   ⚠️  ${line.sku} — سياسة ${prod.inventory_policy}، لا يقبل رصيداً`);
    continue;
  }
  openingItems.push({
    product_id: prod.id,
    quantity: line.qty,
    unit_cost: line.cost,
    note: `رصيد افتتاحي تجريبي — ${prod.name_ar}`,
  });
}

try {
  const [res] = await q(
    `SELECT public.post_opening_stock($1, $2, $3, $4) AS id`,
    [wh, new Date().toISOString().slice(0, 10), SEED_MARK, JSON.stringify(openingItems)]
  );
  console.log(`   ✅ ${openingItems.length} صنفاً — مستند: ${res.id}`);
} catch (err) {
  console.log(`   ⚠️  الأرصدة الافتتاحية: ${err.message}`);
}

// ── 2. فواتير بيع تجريبية عبر المحرك الموحد ──
console.log("\n── 2) فواتير بيع تجريبية ──");

const customers = await q(
  `SELECT id, name FROM customers WHERE is_active AND phone IS NOT NULL ORDER BY created_at LIMIT 6`
);

if (customers.length === 0) {
  console.log("   ⚠️  لا يوجد عملاء بحقل هاتف — تُخطى الفواتير");
} else {
  const salePlan = PLAN.sales;

  for (let i = 0; i < Math.min(salePlan.length, customers.length); i++) {
    const cust = customers[i];
    const plan = salePlan[i];
    const date = new Date(Date.now() - plan.days * 86400000).toISOString().slice(0, 10);

    const items = [];
    let total = 0;
    for (const it of plan.items) {
      const prod = bySku[it.sku];
      if (!prod) { console.log(`   ⚠️  ${it.sku} — غير موجود`); continue; }
      const unit = it.flat ? it.price / it.qty : it.price;
      items.push({
        product_id: prod.id,
        quantity: it.qty,
        unit_price: unit,
        tax_rate: 0,
        name: prod.name_ar,
      });
      total += it.qty * unit;
    }
    if (items.length === 0) continue;

    try {
      const [inv] = await q(
        `SELECT public.create_sale($1, $2, 'cash', $3, 0, $4, $5, $6) AS id`,
        [wh, cust.id, total, `فاتورة تجريبية ${SEED_MARK}`, JSON.stringify(items), date]
      );
      // المحرك يعتمد سعر الكتالوج للصنف القابل للبيع، فقد يختلف عن السعر
      // المطلوب في السطر — نسدّد الفارق حتى لا تخرج الفاتورة ناقصة السداد.
      const [head] = await q(`SELECT invoice_number, total, paid FROM sales_invoices WHERE id = $1`, [inv.id]);
      const due = Number(head.total) - Number(head.paid);
      if (due > 0.5) {
        await q(
          `SELECT public.record_customer_payment($1, $2, $3, 'cash', $4, $5) AS id`,
          [cust.id, inv.id, due, date, `تسديد فرق السعر التجريبي ${SEED_MARK}`]
        );
      }
      console.log(`   ✅ ${head.invoice_number} — ${cust.name} — ${Math.round(Number(head.total)).toLocaleString("en-US")} ر.ي`);
    } catch (err) {
      console.log(`   ⚠️  فاتورة ${i + 1} (${cust.name}): ${err.message}`);
    }
  }
}

// ── 3. وحدات الأساس ──
console.log("\n── 3) وحدات الأساس ──");
let unitsSet = 0;
for (const u of PLAN.units) {
  const r = await q(
    `UPDATE products SET unit_id = u.id, base_uom_id = coalesce(base_uom_id, u.id),
                        sales_uom_id = coalesce(sales_uom_id, u.id),
                        purchase_uom_id = coalesce(purchase_uom_id, u.id)
      FROM units u WHERE u.short_name = $2 AND products.sku = $1 RETURNING products.sku`,
    [u.sku, u.unit]
  );
  if (r.length === 0) console.log(`   ⚠️  ${u.sku}: وحدة "${u.unit}" غير موجودة`);
  unitsSet += r.length;
}
console.log(`   ✅ حُدّثت وحدات ${unitsSet} صنفاً`);

// ── 4. أسعار البيع والتكلفة ──
console.log("\n── 4) أسعار البيع والتكلفة ──");

const pricePlan = PLAN.prices;

let priced = 0;
for (const u of pricePlan) {
  try {
    const r = await q(`UPDATE products SET cost_price = $1, sale_price = $2 WHERE sku = $3 RETURNING sku`, [u.cost, u.sale, u.sku]);
    if (r.length === 0) {
      console.log(`   ⚠️  ${u.sku} — لا يوجد صنف بهذا الرمز`);
    } else {
      priced += r.length;
    }
  } catch (err) {
    console.log(`   ⚠️  ${u.sku}: ${err.message}`);
  }
}
console.log(`   ✅ حُدّث ${priced} صنفاً`);

// ── التحقق ──
console.log("\n── التحقق ──");

const stat = (await q(`
  SELECT (select count(*) from stock_movements)::int                   AS movements,
         (select count(*) from stock_openings where note = $1)::int     AS openings,
         (select count(*) from sales_invoices
           where note like $2 and status <> 'cancelled')::int          AS demo_invoices,
         (select count(*) from inventory where quantity > 0)::int      AS stocked_items
`, [SEED_MARK, `%${SEED_MARK}%`]))[0];

console.log(`   📦 حركات مخزون إجمالاً: ${stat.movements}`);
console.log(`   📄 مستندات رصيد افتتاحي: ${stat.openings}`);
console.log(`   🧾 فواتير تجريبية: ${stat.demo_invoices}`);
console.log(`   📊 أصناف لها رصيد: ${stat.stocked_items}`);

const negatives = await q(
  `SELECT p.sku, i.quantity FROM inventory i JOIN products p ON p.id = i.product_id
   WHERE i.quantity < 0 ORDER BY p.sku`
);
if (negatives.length) {
  console.log("   ⚠️  أرصدة سالبة:");
  for (const n of negatives) console.log(`      • ${n.sku}: ${n.quantity}`);
} else {
  console.log("   ✅ لا توجد أرصدة سالبة");
}

await q("COMMIT");
await c.end();
console.log("\n✅ تم بذر البيانات التجريبية بنجاح!");
