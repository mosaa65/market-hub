import { createClient } from "@supabase/supabase-js";

const url = "https://kwzqvgdyadylwnvjghqn.supabase.co";
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const sb = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
  const { data: cat, error: e1 } = await sb.from("categories").select("id, name, name_ar");
  console.log("Categories:", cat?.length, cat?.map(c => c.name_ar));

  const { data: prods, error: e2 } = await sb.from("products").select("id, sku, name_ar, sale_price").ilike("sku", "%FLOUR%");
  console.log("Flour products:", prods?.length, prods);

  const { data: allProds, error: e2b } = await sb.from("products").select("id, sku, name_ar, item_nature, is_service");
  console.log("All products total:", allProds?.length);

  const { data: units, error: e3 } = await sb.from("units").select("id, name, name_ar");
  console.log("Units:", units?.length, units?.map(u => u.name_ar));

  const { data: settings, error: e4 } = await sb.from("company_settings").select("*").limit(1);
  console.log("Company settings:", settings?.[0]?.name, settings?.[0]?.business_type);
}

main().catch(console.error);
