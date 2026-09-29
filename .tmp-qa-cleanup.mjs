// TEMPORARY cleanup with retry. The Supabase auth admin endpoint is currently
// returning 500 ("Database error finding users"), so we poll until it recovers
// and then delete the QA account. Safe to run repeatedly.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = "qa-products@example.com";
const attempts = Number(process.argv[2] ?? 12);

for (let i = 1; i <= attempts; i++) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (!error) {
    const target = data?.users?.find((u) => u.email === EMAIL);
    if (!target) {
      console.log(`attempt ${i}: auth API healthy, no QA user present — nothing to do`);
      process.exit(0);
    }
    const { error: delError } = await admin.auth.admin.deleteUser(target.id);
    console.log(
      delError
        ? `attempt ${i}: delete failed — ${delError.message}`
        : `attempt ${i}: DELETED QA user ${target.id}`,
    );
    process.exit(delError ? 1 : 0);
  }

  console.log(`attempt ${i}: auth API still failing (${error.message ?? "500"})`);
  await new Promise((r) => setTimeout(r, Math.min(30000, 3000 * i)));
}

console.log("gave up — auth API did not recover in this window");
process.exit(1);