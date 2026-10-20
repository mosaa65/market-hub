// Can a signed-in user actually READ anything? This is the real end-to-end test:
// RLS policies call public.is_staff(auth.uid()) / has_role(...) as the invoker.
import { connect } from '../../scripts/db-run.mjs';

const ADMIN = 'a0000000-0000-4000-a000-000000000001';
const tables = ['products', 'customers', 'sales_invoices', 'expenses', 'warehouses', 'company_settings', 'user_roles', 'profiles', 'platform_admins'];

const c = await connect();
c.on('error', () => { });
await c.connect();
await c.query('begin');
await c.query(`set local role authenticated`);
await c.query(`select set_config('request.jwt.claims', $1, true)`, [
  JSON.stringify({ sub: ADMIN, role: 'authenticated', aud: 'authenticated' }),
]);
for (const t of tables) {
  try {
    const r = await c.query(`select count(*)::int n from public.${t}`);
    console.log(`  ${t.padEnd(24)} rows=${r.rows[0].n}`);
  } catch (e) {
    console.log(`  ${t.padEnd(24)} ERROR ${e.code} ${e.message}`);
  }
}
await c.query('rollback');
await c.end();
