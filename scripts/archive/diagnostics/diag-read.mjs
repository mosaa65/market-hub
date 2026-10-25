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

const URL_BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;

async function q(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" },
  });
  const text = await res.text();
  if (!res.ok) return { error: `${res.status} ${text.slice(0, 200)}` };
  return JSON.parse(text || "[]");
}

const lines = [];
const p = (s) => lines.push(s);

const products = await q(
  "products?select=sku,name_ar,item_class,inventory_policy,is_sellable,is_purchasable,is_service,is_active",
);
if (products.error) {
  p("PRODUCTS ERROR: " + products.error);
} else {
  p(`=== المنتجات (${products.length}) ===`);
  for (const x of products) {
    p(
      `${(x.sku ?? "").padEnd(16)} | ${String(x.item_class ?? "-").padEnd(16)} | ${String(
        x.inventory_policy,
      ).padEnd(15)} | sell=${x.is_sellable ? "Y" : "n"} buy=${x.is_purchasable ? "Y" : "n"} svc=${
        x.is_service ? "Y" : "n"
      } | ${x.name_ar}`,
    );
  }
}

const cats = await q("categories?select=name_ar");
if (!cats.error) {
  p(`\n=== التصنيفات (${cats.length}) ===`);
  p(cats.map((c) => c.name_ar).join(" · "));
}

const units = await q("units?select=name_ar,short_name");
if (!units.error) {
  p(`\n=== الوحدات (${units.length}) ===`);
  p(units.map((u) => `${u.name_ar}(${u.short_name})`).join(" · "));
}

p("");
for (const [label, path] of [
  ["sales_invoices", "sales_invoices?select=id&limit=1"],
  ["purchase_invoices", "purchase_invoices?select=id&limit=1"],
  ["inventory", "inventory?select=id&limit=1"],
  ["stock_movements", "stock_movements?select=id&limit=1"],
  ["milling_intake_receipts", "milling_intake_receipts?select=id&limit=1"],
  ["milling_jobs", "milling_jobs?select=id&limit=1"],
  ["production_orders", "production_orders?select=id&limit=1"],
  ["customers", "customers?select=id&limit=1"],
]) {
  const r = await q(path);
  p(
    `${label.padEnd(26)}: ${
      r.error ? "n/a (" + r.error.slice(0, 40) + ")" : r.length ? "HAS ROWS" : "empty"
    }`,
  );
}

console.log(lines.join("\n"));
