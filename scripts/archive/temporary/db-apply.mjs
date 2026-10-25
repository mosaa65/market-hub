// تطبيق migration على القاعدة المتصلة + تحقق بعد التطبيق.
// الاستخدام: node scripts/db-apply.mjs supabase/migrations/<file>.sql
import fs from 'node:fs';
import { connect } from './db-run.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/db-apply.mjs <file.sql>');
  process.exit(1);
}
const sql = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const client = await connect();
await client.connect();
try {
  await client.query('begin');
  await client.query(sql);
  await client.query('commit');
  console.log('APPLIED OK:', file);
} catch (e) {
  await client.query('rollback');
  console.error('FAILED:', e.message);
  process.exitCode = 1;
}
await client.end();