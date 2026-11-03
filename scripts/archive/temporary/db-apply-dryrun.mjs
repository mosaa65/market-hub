// يُشغّل ملف SQL داخل معاملة واحدة ثم يُلغيها دائماً (dry-run).
//
// الاستخدام:
//   node scripts/db-apply-dryrun.mjs <path/to/file.sql> [-v]
//
// الغرض: التحقق أن ملف الهجرة يُطبَّق نظيفاً على المخطط الحالي دون أي أثر، وفي
// الحالات التي يرفض فيها SQL هيكل COMMIT/ROLLBACK من pg (حيث rollback داخلي)
// يُواصل في نفس المعاملة. لا يُنشئ جدولاً ولا يكتب شيئاً بعد الانتهاء.
import fs from 'node:fs';
import { connect } from './db-run.mjs';

const file = process.argv[2];
const verbose = process.argv.includes('-v');
if (!file) {
  console.error('usage: node scripts/db-apply-dryrun.mjs <file.sql> [-v]');
  process.exit(2);
}

const sql = fs.readFileSync(file, 'utf8');
const client = await connect();
await client.connect();

let failed = false;
let notices = 0;

// ملاحظات RAISE NOTICE وربّما بيانات الفحص تُطبع هنا.
client.on('notice', (n) => {
  notices += 1;
  console.log(`NOTICE: ${n.message}`);
});

try {
  // savepoint خارجي: نتجنب BEGIN/COMMIT داخل الملف نفسه عبر استبدالها بـ
  // savepoint/release حتى لا تُغلق المعاملة التي نديرها.
  await client.query('BEGIN');
  await client.query("SET client_min_messages TO notice");
  const body = sql
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
  if (verbose) console.log(`applying ${file} (${body.length} chars)`);
  await client.query(body);
  console.log(`PASS: ${file} applied cleanly inside a transaction (rolled back)`);
} catch (e) {
  failed = true;
  console.error(`FAIL: ${file}`);
  console.error(`  ${e.message}`);
  if (e.detail) console.error(`  detail: ${e.detail}`);
  if (e.hint) console.error(`  hint: ${e.hint}`);
  if (e.where) console.error(`  at: ${e.where}`);
} finally {
  await client.query('ROLLBACK').catch(() => { });
  await client.end();
}

if (notices) console.log(`(${notices} notice(s) above)`);
process.exit(failed ? 1 : 0);
