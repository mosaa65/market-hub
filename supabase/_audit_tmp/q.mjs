// runner: node supabase/_audit_tmp/q.mjs "<sql>"   |   node .../q.mjs file.sql
import fs from 'node:fs';
import { connect } from '../../scripts/db-run.mjs';

const arg = process.argv.slice(2).join(' ');
const sql = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
const client = await connect();
await client.connect();
try {
  const res = await client.query(sql);
  const list = Array.isArray(res) ? res : [res];
  for (const r of list) {
    if (r.rows?.length) console.table(r.rows);
    else console.log(`(${r.command} ${r.rowCount ?? ''})`);
  }
} catch (e) {
  console.error('ERROR:', e.message, e.detail ?? '', e.hint ?? '');
  process.exitCode = 1;
}
await client.end();
