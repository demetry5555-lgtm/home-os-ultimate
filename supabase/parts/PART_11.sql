-- HOME OS PART 11 OF 12 (part 9B is the repair for part 9; part 11 fixes invitation codes)
-- Mirrors the hosted setup page exactly. Hardened: safe to re-run any part.

-- HOME OS ULTIMATE - PART 11 (fix): invitation codes.
-- pgcrypto lives in the extensions schema on Supabase; the invitation
-- functions were looking in public only. Run once after part 10.

create extension if not exists pgcrypto with schema extensions;

alter function public.create_invitation(text) set search_path = public, extensions;
alter function public.accept_invitation(text, text) set search_path = public, extensions;

-- Verification: every row should read "N of N".
select 'pgcrypto installed' as check, count(*)::text || ' of 1' as ok
  from pg_extension where extname = 'pgcrypto'
union all
select 'invitation functions see extensions schema', count(*)::text || ' of 2'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('create_invitation','accept_invitation')
   and array_to_string(p.proconfig, ',') like '%extensions%';


select 'HOME OS ULTIMATE: database ready ✅' as status,
       (select count(*) from pg_tables where schemaname = 'public') as tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as functions;
