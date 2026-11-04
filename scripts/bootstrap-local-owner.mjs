import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const apiUrl = process.env.SUPABASE_BOOTSTRAP_URL;
const secretKey = process.env.SUPABASE_BOOTSTRAP_SECRET_KEY;
const databasePassword = process.env.SUPABASE_BOOTSTRAP_DB_PASSWORD;
const email = process.env.SUPABASE_BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
const fullName = process.env.SUPABASE_BOOTSTRAP_OWNER_NAME?.trim();
const password = process.env.SUPABASE_BOOTSTRAP_OWNER_PASSWORD;

if (apiUrl !== "http://localhost:8000" || !secretKey || !databasePassword) {
  throw new Error("Local owner bootstrap requires the local Docker API and private stack credentials.");
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  throw new Error("Enter a valid owner email address.");
}
if (!fullName || fullName.length < 2 || fullName.length > 120) {
  throw new Error("Enter the owner's name (2 to 120 characters).");
}
if (!password || password.length < 16 || password.length > 128) {
  throw new Error("The owner password must be 16 to 128 characters.");
}

const { Client } = pg;
const database = new Client({
  connectionString: "postgresql://postgres@127.0.0.1:5433/postgres?sslmode=disable",
  password: databasePassword,
  connectionTimeoutMillis: 10000,
  ssl: false,
});
const admin = createClient(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await database.connect();
let createdUserId;
try {
  const state = await database.query(`
    SELECT
      (SELECT count(*)::int FROM public.profiles) AS profiles,
      (SELECT count(*)::int FROM public.user_roles) AS roles
  `);
  if (state.rows[0]?.profiles !== 0 || state.rows[0]?.roles !== 0) {
    throw new Error("First-owner bootstrap is allowed only before any app profile or role exists.");
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user?.id) {
    throw new Error(`Supabase Auth could not create the owner account: ${error?.message ?? "missing user id"}`);
  }
  createdUserId = data.user.id;

  await database.query("BEGIN");
  const profile = await database.query(
    "SELECT id FROM public.profiles WHERE id = $1::uuid AND is_active = true",
    [createdUserId],
  );
  const roles = await database.query("SELECT count(*)::int AS count FROM public.user_roles");
  if (profile.rowCount !== 1 || roles.rows[0]?.count !== 0) {
    throw new Error("The new Auth account did not produce the expected clean profile state.");
  }
  await database.query(
    "INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, 'owner'::public.app_role)",
    [createdUserId],
  );
  await database.query("COMMIT");
  console.log(`Initial store owner created: ${email} (${createdUserId}).`);
} catch (error) {
  try {
    await database.query("ROLLBACK");
  } catch {
    // Keep the original bootstrap failure as the actionable error.
  }
  if (createdUserId) {
    console.error(`Auth user ${createdUserId} may exist without an owner role; inspect it before retrying.`);
  }
  throw error;
} finally {
  await database.end();
}
