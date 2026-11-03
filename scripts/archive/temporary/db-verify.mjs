// ============================================================================
// db-verify.mjs — فحص صحة قاعدة البيانات والصلاحيات بعد كل بناء أو نشر.
//
// الاستخدام:
//   node scripts/db-verify.mjs            ← يطبع التقرير ويخرج بـ 1 إن وُجد خلل
//   node scripts/db-verify.mjs --quiet    ← الأخطاء فقط
//
// لماذا هذا الملف؟
//   كل عطل كُشف يدويًا في السحابة (دوال بلا EXECUTE، حساب منصة بلا دور متجر،
//   دالة تقرأ عمودًا غير موجود، سياسة RLS بلا GRANT) كان يمكن أن يظهر
//   لحظة البناء. هذه الفحوصات تجعل «البناء الصحيح» حالة يتحقق منها الأمر
//   لا استنتاجًا من قراءة الملفات.
//
// يعتمد على SUPABASE_DB_* في .env (أو .temp/pooler-url للاتصال عبر Pooler).
// ============================================================================
import { connect } from './db-run.mjs';

const quiet = process.argv.includes('--quiet');
const failures = [];
const notes = [];
const say = (...a) => { if (!quiet) console.log(...a); };

const client = await connect();
await client.connect();

async function check(title, sql, { failWhen = (rows) => rows.length > 0, expect = 'لا صفوف' } = {}) {
  const { rows } = await client.query(sql);
  const bad = failWhen(rows);
  if (bad) {
    failures.push({ title, rows });
    console.log(`\n✗ ${title}`);
    console.table(rows);
  } else {
    say(`✓ ${title} (${expect})`);
  }
  return rows;
}

say(`\n== فحص قاعدة البيانات: ${new Date().toISOString()} ==\n`);

// ── 1) RLS ───────────────────────────────────────────────────────────────────
await check('كل جداول public عليها RLS', `
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);

await check('كل جدول عليه سياسة واحدة على الأقل', `
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`);

// ── 2) الدوال ────────────────────────────────────────────────────────────────
await check('لا دالة SECURITY DEFINER بلا search_path ثابت', `
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
    and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`);

await check('لا دالة قابلة للتنفيذ من anon', `
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'EXECUTE')`);

await check('دوال المصروفات المكشوفة للواجهة قابلة للتنفيذ', `
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and p.proname = any (array[
      'create_expense','update_expense','submit_expense','decide_expense','post_expense',
      'close_expense','cancel_expense','reverse_expense','record_expense_payment',
      'reverse_expense_payment','list_expenses','expense_detail','expense_summary',
      'expense_report','expense_lookups','save_expense_category','delete_expense_category'])
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')`);

await check('مساعدات RLS قابلة للتنفيذ من authenticated', `
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and p.proname in ('has_role','is_staff','is_platform_admin','is_platform_superadmin')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')`);

await check('الإقرار الضريبي لا يقرأ عمودًا غير موجود', `
  select 'generate_tax_declaration' as fn
  where position('invoice_date' in regexp_replace(
          pg_get_functiondef('public.generate_tax_declaration(date,date)'::regprocedure),
          '--[^\\n]*', '', 'g')) > 0
    and not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and column_name = 'invoice_date')`);

// ── 3) العروض ────────────────────────────────────────────────────────────────
await check('كل عروض public تعمل security_invoker', `
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%'`);

// ── 4) حسابات المنصة ─────────────────────────────────────────────────────────
if (await client.query(`select to_regprocedure('public.platform_admin_audit()') is not null as ok`)
  .then((r) => r.rows[0].ok)) {
  await check('كل حسابات المنصة مكتملة (تقرير platform_admin_audit)', `
    select email, platform_role, problems
    from public.platform_admin_audit()
    where problems <> '{}'::text[]`);
} else {
  notes.push('platform_admin_audit() غير موجودة — طبّق 41 أولًا.');
}

// ── 5) seeds: لا حساب منصة بلا دور متجر ──────────────────────────────────────
await check('كل مسؤول منصة له دور متجر (وإلا RLS يخفي كل شيء)', `
  select pa.user_id, pa.role from public.platform_admins pa
  where not exists (select 1 from public.user_roles r where r.user_id = pa.user_id)`);

await check('توجد هوية بريد لكل مسؤول منصة يملك بريدًا', `
  select pa.user_id from public.platform_admins pa
  join auth.users u on u.id = pa.user_id
  where u.email is not null
    and not exists (select 1 from auth.identities i
                    where i.user_id = pa.user_id and i.provider = 'email')`);

await check('لا يقل السوبر أدمن النشط عن واحد', `
  select count(*)::int as active_superadmins from public.platform_admins
  where role = 'superadmin' and is_active having count(*) = 0`);

// ── 6) منح الكتابة بلا سياسة (إعداد خاطئ صامت) ───────────────────────────────
await check('لا جدول يمنح authenticated صلاحية كتابة بلا سياسة مقابلة', `
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (
      (has_table_privilege('authenticated', c.oid, 'INSERT')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd in ('a','*')))
      or (has_table_privilege('authenticated', c.oid, 'UPDATE')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd in ('w','*')))
      or (has_table_privilege('authenticated', c.oid, 'DELETE')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd in ('d','*')))
    )`);

await client.end();

// ── الخلاصة ──────────────────────────────────────────────────────────────────
if (notes.length) console.log('\nملاحظات:\n  - ' + notes.join('\n  - '));
if (failures.length) {
  console.error(`\n✗ فشل ${failures.length} فحصًا.\n`);
  process.exit(1);
}
console.log('\n✓ كل الفحوصات ناجحة.\n');
