import { connect } from '../../scripts/db-run.mjs';
const c = await connect();
await c.connect();
try {
  await c.query('begin');
  await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: 'a0000000-0000-4000-a000-000000000001', role: 'authenticated' }),
  ]);
  const r = await c.query('select * from activate_fixed_asset($1::uuid) limit 1', [null]);
  console.log('OK', r.rows);
} catch (e) {
  console.log('ERR', e.code, '|', e.message, '|', e.detail ?? '');
}
await c.end();
