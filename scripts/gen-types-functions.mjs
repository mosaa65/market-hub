// توليد تعريفات Functions لتحديث src/integrations/supabase/types.ts من القاعدة المتصلة.
// الاستخدام: node scripts/gen-types-functions.mjs
import { connect } from './db-run.mjs';

const client = await connect();
await client.connect();
const { rows } = await client.query(`
  select p.proname,
         p.proargnames as names,
         pg_get_function_result(p.oid) as result,
         pg_get_function_arguments(p.oid) as args,
         pg_get_function_identity_arguments(p.oid) as identity
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  order by p.proname, p.oid
`);

const ts = (t) => {
  const x = (t || '').trim();
  if (x.endsWith('[]')) return `${ts(x.slice(0, -2))}[]`;
  if (/^uuid$/.test(x)) return 'string';
  if (/^(numeric|integer|bigint|smallint|real|double precision)/.test(x)) return 'number';
  if (/^boolean$/.test(x)) return 'boolean';
  if (/^jsonb?$/.test(x)) return 'Json';
  return 'string';
};

const out = [];
for (const r of rows) {
  const names = r.names || [];
  const parts = r.args
    .split(/,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter(Boolean);
  const isSetof = /^TABLE|^SETOF/i.test(r.result);
  const ret = isSetof ? 'Json[]' : ts(r.result);
  const argLines = parts.map((p, i) => {
    const name = names[i] || `arg${i + 1}`;
    const type = p.replace(/\s+DEFAULT\s+.*$/i, '').trim();
    const t = type.split(/\s+/)[0] + (type.includes('[]') ? '[]' : '');
    const optional = /DEFAULT/i.test(p);
    return `          ${name}${optional ? '?' : ''}: ${ts(t)};`;
  });
  out.push(
    `      ${r.proname}: {\n        Args: {\n${argLines.join('\n')}\n        };\n        Returns: ${ret};\n      };`,
  );
}
console.log(out.join('\n'));
await client.end();
