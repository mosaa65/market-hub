import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const KEY = env.SUPABASE_SECRET_KEY;
const BASE = env.SUPABASE_URL;

async function q(p) {
  const r = await fetch(`${BASE}/rest/v1/${p}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) return { __err: `${r.status} ${(await r.text()).slice(0, 160)}` };
  return r.json();
}

const lines = [];
const p = (s) => lines.push(s);

// الوحدات: ما هي فعلاً، ومن يستخدمها
const units = await q("units?select=id,name,name_ar,short_name");
const prods = await q("products?select=id,sku,name_ar,unit_id,item_class,inventory_policy");
const useCount = new Map();
for (const x of prods) useCount.set(x.unit_id, (useCount.get(x.unit_id) ?? 0) + 1);

p("=== الوحدات واستخدامها ===");
for (const u of units) {
  p(
    `${(u.name ?? "-").padEnd(16)} ${(u.name_ar ?? "").padEnd(22)} مستخدمة في ${
      useCount.get(u.id) ?? 0
    } صنف`,
  );
}

// التصنيفات ومن يستخدمها
const cats = await q("categories?select=id,name,name_ar");
const catCount = await q("products?select=category_id");
const cCount = new Map();
for (const x of catCount) if (x.category_id) cCount.set(x.category_id, (cCount.get(x.category_id) ?? 0) + 1);

p("\n=== التصنيفات واستخدامها ===");
for (const c of cats) {
  p(`${(c.name_ar ?? c.name ?? "").padEnd(28)} ${cCount.get(c.id) ?? 0} صنف`);
}

// فواتير البيع: ماذا بيع فعلاً
const invItems = await q(
  "sales_invoice_items?select=product_id,quantity,unit_price,total,line_type,stock_effect",
);
p(`\n=== بنود فواتير البيع (${invItems.length}) ===`);
const soldAgg = new Map();
for (const it of invItems) {
  const k = it.product_id;
  const cur = soldAgg.get(k) ?? { qty: 0, revenue: 0, lines: 0 };
  cur.qty += Number(it.quantity || 0);
  cur.revenue += Number(it.total || 0);
  cur.lines += 1;
  soldAgg.set(k, cur);
}
const byId = new Map(prods.map((x) => [x.id, x]));
for (const [pid, a] of soldAgg) {
  const pr = byId.get(pid);
  p(
    `  ${(pr?.sku ?? "?").padEnd(16)} ${String(pr?.item_class).padEnd(15)} qty=${a.qty
      .toFixed(2)
      .padStart(10)} rev=${a.revenue.toFixed(0).padStart(10)} lines=${a.lines}  ${pr?.name_ar ?? ""}`,
  );
}

// حركات المخزون
const mov = await q("stock_movements?select=product_id,movement_type,quantity");
p(`\n=== حركات المخزون (${mov.length}) ===`);
const mType = new Map();
for (const m of mov) mType.set(m.movement_type, (mType.get(m.movement_type) ?? 0) + 1);
for (const [k, v] of mType) p(`  ${k}: ${v}`);

const movProd = new Set(mov.map((m) => m.product_id).filter(Boolean));
p(`منتجات لها حركات: ${movProd.size}`);
for (const x of prods.filter((x) => movProd.has(x.id)))
  p(`  ${x.sku.padEnd(16)} ${String(x.item_class).padEnd(15)} ${x.name_ar}`);

// الأصناف التي بلا أي أثر
const linked = new Set([...soldAgg.keys(), ...movProd]);
const orphan = prods.filter((x) => !linked.has(x.id));
p(`\n=== أصناف بلا أي حركة أو بيع (${orphan.length}) — مرشحة للتنظيف ===`);
for (const x of orphan) p(`  ${x.sku.padEnd(16)} ${String(x.item_class).padEnd(15)} ${x.name_ar}`);

console.log(lines.join("\n"));
