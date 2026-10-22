import { connect } from "./db-run.mjs";

const c = await connect();
await c.connect();

const subs = await c.query(`SELECT * FROM public.tenant_subscriptions`);
console.log("SUBSCRIPTIONS:", JSON.stringify(subs.rows, null, 2));

try {
  const tm = await c.query(`SELECT * FROM public.tenant_modules`);
  console.log("TENANT_MODULES:", JSON.stringify(tm.rows, null, 2));
} catch (e) {
  console.log("tenant_modules error:", e.message);
}

const plans = await c.query(`SELECT * FROM public.platform_plans`);
console.log("PLANS:", JSON.stringify(plans.rows, null, 2));

const userRoles = await c.query(`SELECT * FROM public.user_roles`);
console.log("USER_ROLES:", JSON.stringify(userRoles.rows, null, 2));

await c.end();
