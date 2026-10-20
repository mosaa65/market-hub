select c.relname,
  has_table_privilege('authenticated', c.oid, 'SELECT') as g_sel,
  has_table_privilege('authenticated', c.oid, 'INSERT') as g_ins,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as g_upd,
  has_table_privilege('authenticated', c.oid, 'DELETE') as g_del
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and (
  (has_table_privilege('authenticated', c.oid, 'SELECT') and not exists (select 1 from pg_policy pp where pp.polrelid=c.oid and pp.polcmd in ('r','*') ))
  or (has_table_privilege('authenticated', c.oid, 'INSERT') and not exists (select 1 from pg_policy pp where pp.polrelid=c.oid and pp.polcmd in ('a','*') ))
  or (has_table_privilege('authenticated', c.oid, 'UPDATE') and not exists (select 1 from pg_policy pp where pp.polrelid=c.oid and pp.polcmd in ('w','*') ))
  or (has_table_privilege('authenticated', c.oid, 'DELETE') and not exists (select 1 from pg_policy pp where pp.polrelid=c.oid and pp.polcmd in ('d','*') ))
)
order by c.relname;
