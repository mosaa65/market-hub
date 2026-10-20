import fs from 'node:fs';
import { connect } from '../../scripts/db-run.mjs';
const name = process.argv[2];
const c = await connect();
await c.connect();
const r = await c.query('select pg_get_functiondef($1::regprocedure) def', [name]);
fs.writeFileSync('supabase/_audit_tmp/' + name.replace(/[^a-z0-9]/gi, '_') + '.sql', r.rows[0].def);
console.log('bytes', r.rows[0].def.length);
await c.end();
