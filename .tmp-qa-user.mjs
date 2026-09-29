// TEMPORARY test helper — creates or deletes a QA user via the Supabase admin API.
// Not part of the app; deleted after the UI check.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = "qa-products@example.com";
const password = "Qa-Test-1234!";
const action = process.argv[2];

const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) console.error("listUsers:", JSON.stringify(listError));
const existing = list?.users?.find((u) => u.email === email);
console.log("users scanned:", list?.users?.length ?? 0, "| match:", existing?.email ?? "none");

if (action === "delete") {
  if (existing) {
    await admin.auth.admin.deleteUser(existing.id);
    console.log("deleted", existing.id);
  } else {
    console.log("no such user");
  }
  process.exit(0);
}

let userId = existing?.id;

if (!existing) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    console.error("createUser failed:", error.message);
    process.exit(1);
  }
  userId = data.user.id;
  console.log("created", userId);
} else {
  console.log("reusing", userId);
}

// Grant a role so the app lets the user through the permission gate.
const { error: roleError } = await admin
  .from("user_roles")
  .upsert({ user_id: userId, role: "owner" }, { onConflict: "user_id,role" });
if (roleError) console.error("role upsert:", roleError.message);

const { error: profileError } = await admin
  .from("profiles")
  .upsert({ id: userId, full_name: "QA User", email }, { onConflict: "id" });
if (profileError) console.error("profile upsert:", profileError.message);

console.log("READY", email, password);
