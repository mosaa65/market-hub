import { createClient } from "@supabase/supabase-js";

const url = "https://kwzqvgdyadylwnvjghqn.supabase.co";
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const sb = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function test() {
  console.log("Checking if RPCs exist...");
  // Let's check RPC names in information_schema.routines
  const { data: routines } = await sb.from("products").select("id").limit(1);
  console.log("Client connected OK:", Boolean(routines));
}

test().catch(console.error);
