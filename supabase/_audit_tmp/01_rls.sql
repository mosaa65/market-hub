-- RLS & privileges audit (read-only)
with t as (
  select c.oid, c.relname as name, c.relkind, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m')
)
select t.relkind, t.name, t.rls, t.force_rls,
  (select count(*) from pg_policy p where p.polrelid = t.oid) as policies,
  (select string_agg(distinct p.cmd, ',') from pg_policy p where p.polrelid = t.oid) as cmds,
  has_table_privilege('authenticated', t.oid, 'SELECT') as auth_sel,
  has_table_privilege('authenticated', t.oid, 'INSERT') as auth_ins,
  has_table_privilege('authenticated', t.oid, 'UPDATE') as auth_upd,
  has_table_privilege('authenticated', t.oid, 'DELETE') as auth_del,
  has_table_privilege('anon', t.oid, 'SELECT') as anon_sel,
  has_table_privilege('anon', t.oid, 'INSERT') as anon_ins,
  has_table_privilege('anon', t.oid, 'UPDATE') as anon_upd,
  has_table_privilege('anon', t.oid, 'DELETE') as anon_del,
  has_table_privilege('service_role', t.oid, 'SELECT') as svc_sel
from t
order by t.relkind, t.name;
