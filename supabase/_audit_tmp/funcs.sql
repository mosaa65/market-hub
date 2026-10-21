select p.proname as name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as secdef,
  p.provolatile as vol,
  (p.proconfig is null) as no_config,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x,
  p.proowner::regrole::text as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by p.proname;
