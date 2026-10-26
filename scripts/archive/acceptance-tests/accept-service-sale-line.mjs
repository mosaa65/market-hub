// التحقق من قبول create_sale لبند خدمة بلا product_id (تذكرة الطحن)
import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();
let pass = 0, fail = 0;
const ok = (l, v, want) => {
  const good = String(v) === String(want);
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${l}  →  ${v}${good ? "" : `   (expected ${want})`}`);
};
const q = (s, p = []) => c.query(s, p);

const owner = (await q(`select pr.id from profiles pr join user_roles r on r.user_id=pr.id where r.role='owner' limit 1`)).rows[0].id;
const wh = (await q(`select id from warehouses where is_active order by is_default desc limit 1`)).rows[0].id;
const cust = (await q(`select id from customers where is_active limit 1`)).rows[0]?.id;

await q("begin");
await q(`set local role authenticated`);
await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);

// ── تذكرة طحن: بند خدمة بلا صنف في الكتالوج ──
const inv = (await q(`
  select public.create_sale(
    _warehouse_id   => $1::uuid,
    _customer_id    => $2::uuid,
    _payment_method => 'cash'::text,
    _paid           => 3000::numeric,
    _discount       => 0::numeric,
    _note           => 'تذكرة طحن — اختبار'::text,
    _items          => '[{"product_id":null,"quantity":10,"unit_price":300,
                          "tax_rate":0,"is_service":true,
                          "name":"طحن 10 شوال — دقيق نمرة 1"}]'::jsonb)`,

  [wh, cust])).rows[0].create_sale;
ok("the engine accepts an ad-hoc service line", typeof inv, "string");

const item = (await q(`select line_type::text lt, stock_effect::text se, quantity, unit_price, total,
                              product_id from sales_invoice_items where invoice_id=$1`, [inv])).rows[0];
ok("classified as an ad-hoc service", item.lt, "AD_HOC_SERVICE");
ok("with NO stock effect", item.se, "NONE");
ok("and no catalogue product was created or referenced", item.product_id, null);
ok("quantity recorded", Number(item.quantity), 10);
ok("total = 10 x 300", Number(item.total), 3000);

const hat = (await q(`select total, paid, status::text st from sales_invoices where id=$1`, [inv])).rows[0];
ok("invoice totals the ticket", Number(hat.total), 3000);
ok("fully paid in cash", Number(hat.paid), 3000);

// لا حركة مخزون للخدمة
ok("no stock movement was created for the service",
  Number((await q(`select count(*)::int n from stock_movements where source_id=$1`, [inv])).rows[0].n), 0);

// ── بند كتالوجي عادي ما زال يعمل بجانب الخدمة ──
const prod = (await q(`select id, sale_price, tax_rate from products
                        where item_nature='GOOD' and inventory_policy='TRACKED' and is_active and is_sellable limit 1`)).rows[0];
// A tracked good needs stock to leave, so it is seeded through the real engine
// rather than the test weakening the stock check.
await q("set local role service_role");
await q(`select public.post_stock_delta(p_product_id=>$1::uuid,p_warehouse_id=>$2::uuid,
          p_signed_qty=>10::numeric,p_unit_cost=>1,p_movement_kind=>'RECEIPT',
          p_source_type=>'acceptance',p_owner_type=>'COMPANY',p_owner_id=>NULL)`, [prod.id, wh]);
await q("set local role authenticated");
await q(`set local "request.jwt.claims" = '{"role":"authenticated","sub":"${owner}"}'`);
const inv2 = (await q(`
  select public.create_sale(
    _warehouse_id   => $1::uuid, _customer_id => $2::uuid,
    _payment_method => 'credit'::text,
    _paid => 0::numeric, _discount => 0::numeric, _note => 'مختلط'::text,
    _items => $3::jsonb)`,
  [wh, cust, JSON.stringify([
    { product_id: prod.id, quantity: 2, unit_price: Number(prod.sale_price), tax_rate: Number(prod.tax_rate), is_service: false, name: "منتج" },
    { product_id: null, quantity: 1, unit_price: 500, tax_rate: 0, is_service: true, name: "خدمة" },
  ])])).rows[0].create_sale;
const kinds = (await q(`select line_type::text lt, count(*)::int n from sales_invoice_items
                         where invoice_id=$1 group by 1 order by 1`, [inv2])).rows;
ok("a mixed invoice carries both line kinds",
  kinds.map((k) => k.lt).join(",").includes("AD_HOC_SERVICE") && kinds.length >= 2, true);
ok("credit sale collects nothing", Number((await q(`select paid from sales_invoices where id=$1`, [inv2])).rows[0].paid), 0);

await q("rollback");
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
await c.end();