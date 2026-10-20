// Execute each exposed function as a real signed-in user (JWT claims + authenticated role).
// One connection per call: a hung call can never poison the next one.
// usage: node smoke.mjs <admin-uuid> <only-name|all> <from> <count>
import { connect } from '../../scripts/db-run.mjs';

const ADMIN = process.argv[2] ?? 'a0000000-0000-4000-a000-000000000001';
const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3] : null;
const from = Number(process.argv[4] ?? 0);
const count = Number(process.argv[5] ?? 20);

const base = await connect();
await base.connect();
const { rows: fns } = await base.query(`
  select p.proname,
         pg_get_function_identity_arguments(p.oid) args,
         (select string_agg(format_type(t, null), ',' order by o)
            from unnest(p.proargtypes::oid[]) with ordinality u(t, o)) as argtypes,
         p.prosecdef as secdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  order by p.proname`);
await base.end();

const target = only ? fns.filter((f) => f.proname === only) : fns.slice(from, from + count);
const results = [];

for (const f of target) {
  // unknown => PostgreSQL infers from context; typed only for plain type names
  const types = (f.argtypes ?? '')
    .split(',')
    .filter(Boolean)
    .map((t) => (/^[a-z_][a-z0-9_]*(\[\])?$/.test(t) ? t : 'unknown'));
  const sql = types.length
    ? `select * from public.${f.proname}(${types.map((t, i) => `$${i + 1}::${t}`).join(',')}) limit 1`
    : `select * from public.${f.proname}() limit 1`;

  const c = await connect();
  c.on('error', () => {});
  let outcome = 'ok';
  try {
    await c.connect();
    await c.query('begin');
    await c.query(`set local statement_timeout = '2000ms'`);
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: ADMIN, role: 'authenticated', aud: 'authenticated', device_id: 'smoke-device' }),
    ]);
    await c.query(sql, types.map(() => null));
  } catch (e) {
    outcome = `${e.code ?? ''} ${e.message}`.replace(/\s+/g, ' ').slice(0, 160);
  }
  try { await c.query('rollback'); } catch {}
  try { await c.end(); } catch {}
  results.push({ fn: f.proname, secdef: f.secdef, outcome });
  console.log(`[${results.length}/${target.length}] ${f.proname}: ${outcome}`);
}

const bad = results.filter((r) => r.outcome !== 'ok');
console.log(`checked ${results.length}, non-ok ${bad.length}`);
