import { connect } from '../../scripts/db-run.mjs';
const c = await connect();
await c.connect();
const r = await c.query(`
with d as (select pg_get_functiondef('public.generate_tax_declaration(date,date)'::regprocedure) def)
select position('invoice_date' in def) pos_in_full,
       position('invoice_date' in regexp_replace(def, '--[^\\n]*', '', 'g')) pos_no_line_comments,
       position('invoice_date' in regexp_replace(regexp_replace(def, '--[^\\n]*', '', 'g'), '/\\*.*?\\*/', '', 'gs')) pos_no_comments,
       substr(def, greatest(position('invoice_date' in def) - 120, 1), 200) ctx
from d`);
console.log(r.rows[0]);
const sig = await c.query("select pg_get_functiondef('public.generate_tax_declaration(date,date)'::regprocedure) as def");
const def = sig.rows[0].def;
const i = def.indexOf('invoice_date');
console.log('LAST 300 CHARS:\n', def.slice(-300));
console.log('COUNT invoice_date:', def.split('invoice_date').length - 1);
if (i > -1) console.log('CTX:', JSON.stringify(def.slice(i - 150, i + 60)));
await c.end();
