-- 1) functions with mutable search_path (excluding extensions/auth/storage internals)
select 'search_path' as rule, n.nspname as schema, p.proname as name
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public')
  and p.prokind = 'f'
  and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));

-- 2) public tables without RLS
select 'rls_disabled' as rule, c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;

-- 3) views owned by postgres that are security definer (bypass RLS) exposed to authenticated
select 'view_secdef' as rule, c.relname, pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='v'
  and ('security_invoker=false' = any(coalesce(c.reloptions,'{}')) or coalesce(array_length(c.reloptions,1),0)=0)
  and has_table_privilege('authenticated', c.oid, 'SELECT');

-- 4) anon grants on public tables/sequences
select 'anon_grant' as rule, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';

-- 5) tables with RLS enabled but FORCE not set and owned by non-superuser (informational)
select 'rls_no_force' as rule, count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity;

-- 6) public tables with no policies at all
select 'no_policy' as rule, c.relname
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not exists (select 1 from pg_policy p where p.polrelid=c.oid);

-- 7) dependency on missing functions (broken triggers / defaults)
select 'orphan_trigger' as rule, t.tgname, c.relname
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal and t.tgenabled='D' ;
