import { createClient } from "@supabase/supabase-js";

const url = "https://kwzqvgdyadylwnvjghqn.supabase.co";
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const sb = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
  const { data: prods } = await sb.from("products").select("id, sku, name_ar, item_nature, is_service, sale_price, cost_price, categories(name_ar)").order("sku");
  console.log("=== ALL PRODUCTS IN DB ===");
  for (const p of prods || []) {
    console.log(`${p.sku} | ${p.name_ar} | price: ${p.sale_price} | nature: ${p.item_nature} | service: ${p.is_service} | cat: ${p.categories?.name_ar}`);
  }

  const { data: expCat } = await sb.from("expense_categories").select("id, name, name_ar");
  console.log("=== EXPENSE CATEGORIES ===", expCat);
}

main().catch(console.error);
