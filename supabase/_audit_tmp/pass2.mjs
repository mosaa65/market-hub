// Executes every exposed RPC as a real signed-in user and classifies the outcome:
//   OK          — returned (possibly an empty set)
//   BUSINESS    — raised on purpose by the function body (P0001..P0003, 22023, 23514, 42501 from a RAISE)
//   PLUMBING    — infrastructure error that means the function is broken:
//                 undefined_column/function/table, permission denied, unique violation, not-null, others
import { connect } from '../../scripts/db-run.mjs';

const ADMIN = process.argv[2] ?? 'a0000000-0000-4000-a000-000000000001';
const from = Number(process.argv[3] ?? 0);
const count = Number(process.argv[4] ?? 15);

const base = await connect();
await base.connect();
const { rows: fns } = await base.query(`
  select p.proname,
         pg_get_function_identity_arguments(p.oid) args,
         (select string_agg(format_type(t, null), ',' order by o)
            from unnest(p.proargtypes::oid[]) with ordinality u(t, o)) as argtypes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  order by p.proname`);
await base.end();

const BUSINESS = new Set(['P0001', 'P0002', 'P0003', '22023', '23514', 'P0004']);
const rows = [];
for (const f of fns.slice(from, from + count)) {
  const types = (f.argtypes ?? '').split(',').filter(Boolean).map((t) => (/^[a-z_][a-z0-9_]*(\[\])?$/.test(t) ? t : 'unknown'));
  const sql = types.length
    ? `select * from public.${f.proname}(${types.map((t, i) => `$${i + 1}::${t}`).join(',')}) limit 1`
    : `select * from public.${f.proname}() limit 1`;
  const c = await connect();
  c.on('error', () => { });
  let code = 'OK';
  let msg = '';
  try {
    await c.connect();
    await c.query('begin');
    await c.query(`set local statement_timeout = '2500ms'`);
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: ADMIN, role: 'authenticated', aud: 'authenticated', device_id: 'smoke' }),
    ]);
    await c.query(sql, types.map(() => null));
  } catch (e) {
    code = e.code ?? 'ERR';
    msg = String(e.message ?? '').replace(/\s+/g, ' ').slice(0, 150);
  }
  try { await c.query('rollback'); } catch { }
  try { await c.end(); } catch { }
  rows.push({ fn: f.proname, code, msg });
}
const broken = rows.filter((r) => r.code !== 'OK' && !BUSINESS.has(r.code));
for (const r of rows) console.log(`${BUSINESS.has(r.code) || r.code === 'OK' ? '  ' : '!!'} ${r.fn} [${r.code}] ${r.msg}`);
console.log(`checked ${rows.length} — broken ${broken.length}`);
