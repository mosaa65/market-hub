import { createClient } from "@supabase/supabase-js";

const url = "https://kwzqvgdyadylwnvjghqn.supabase.co";
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const sb = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const millingExpenseCategories = [
  { name: "milling_diesel", name_ar: "ديزل ووقود المولدات والماكينات" },
  { name: "milling_electricity", name_ar: "كهرباء صناعية وتشغيلية للمطحنة" },
  { name: "milling_maintenance", name_ar: "صيانة وتغيير سيور ومطارق وسلندرات" },
  { name: "milling_labour", name_ar: "أجور عمالة ورديات الطحن والتحميل" },
  { name: "milling_packaging_supplies", name_ar: "مستلزمات تشغيل وخيوط وإبر حياكة" },
  { name: "milling_general", name_ar: "مصروفات إدارية ونثرية للمطحنة" }
];

async function seedExpenseCategories() {
  console.log("Seeding expense categories for the mill...");
  for (const cat of millingExpenseCategories) {
    const { data: existing } = await sb.from("expense_categories").select("id").eq("name", cat.name).maybeSingle();
    if (!existing) {
      const { data, error } = await sb.from("expense_categories").insert(cat).select();
      if (error) console.error("Error inserting", cat.name, error);
      else console.log("Inserted category:", cat.name_ar);
    } else {
      console.log("Category already exists:", cat.name_ar);
    }
  }

  // Also check product prices for milling services (e.g., bag milling fee)
  const { data: srvBag } = await sb.from("products").select("id, sku, sale_price").eq("sku", "SRV-MILL-BAG50").maybeSingle();
  if (srvBag && (Number(srvBag.sale_price) === 0 || !srvBag.sale_price)) {
    await sb.from("products").update({ sale_price: 1000 }).eq("id", srvBag.id);
    console.log("Updated default sale price for SRV-MILL-BAG50 to 1000 YER");
  }

  const { data: srvTon } = await sb.from("products").select("id, sku, sale_price").eq("sku", "SRV-MILL-TON").maybeSingle();
  if (srvTon && (Number(srvTon.sale_price) === 0 || !srvTon.sale_price)) {
    await sb.from("products").update({ sale_price: 18000 }).eq("id", srvTon.id);
    console.log("Updated default sale price for SRV-MILL-TON to 18000 YER");
  }

  console.log("Seed completed successfully!");
}

seedExpenseCategories().catch(console.error);
