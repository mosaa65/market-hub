// يُسجّل نسخة هجرة طُبّقت يدوياً في supabase_migrations.schema_migrations.
//
// الاستخدام:
//   node scripts/db-register-migration.mjs 43 audit_remediation_delivery_blockers
//
// ⚠️ لا يُشغّل ملف الهجرة ولا يتحقق من أثره. يُنفَّذ فقط بعد تطبيق الملف على
// قاعدة البيانات (أو التحقق من أن كل تغييراته موجودة)، والغرض إبقاء CLI
// (`supabase db push`) متزامناً مع حالة القاعدة الحقيقية. يعمل داخل معاملة
// واحدة: إما السطر يُكتب أو لا شيء.
import { connect } from './db-run.mjs';

const version = process.argv[2];
const name = process.argv[3];
if (!version || !name) {
  console.error('usage: node scripts/db-register-migration.mjs <version> <name>');
  process.exit(2);
}

const client = await connect();
await client.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, name)
     VALUES ($1, $2)
     ON CONFLICT (version) DO NOTHING
     RETURNING version, name`,
    [version, name],
  );
  await client.query('COMMIT');
  if (rows.length) {
    console.log(`registered ${rows[0].version} — ${rows[0].name}`);
  } else {
    console.log(`already registered: ${version}`);
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => { });
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
