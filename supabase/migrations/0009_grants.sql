-- 0009: table grants for the authenticated role (repairs live installs).
-- RPCs are SECURITY DEFINER and worked without these; every direct table
-- read (profiles, families, invitations, accounts, ...) failed with 42501.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
