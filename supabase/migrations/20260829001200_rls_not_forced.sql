-- Undo `force row level security`. It would have locked the application out of
-- its own record, and the read half would have done it silently.
--
-- 20260829000900_security.sql enabled RLS on every ashwini table with no
-- policies, then added FORCE. Its comment claimed the app is fine because it
-- "connects as a role with BYPASSRLS or as the owner". The second half is
-- wrong: FORCE exists precisely to make RLS apply to the owner too. With zero
-- policies that denies the owner everything.
--
-- Measured against Postgres 16, as a non-superuser owner without BYPASSRLS:
--
--   with FORCE      select → 0 rows, no error.  insert → "new row violates
--                   row-level security policy".
--   without FORCE   select → all rows.          insert → succeeds.
--
-- The select is the dangerous one. A health record that answers "no history"
-- instead of failing is worse than one that refuses to start, and this would
-- have surfaced as an empty check-in list rather than an error.
--
-- Whether it bites depends on whether the connecting role happens to hold
-- BYPASSRLS. Supabase's `postgres` role may well have it — that is not
-- documented either way, and a health record should not rest on an undocumented
-- attribute of a managed role that could change.
--
-- Nothing is given up. FORCE was buying nothing here:
--
--   * `ashwini` sits outside `public`, so PostgREST does not serve it. That is
--     the real control.
--   * `revoke all on schema ashwini from public` denies anon and authenticated
--     at the schema level — "permission denied for schema ashwini", before RLS
--     is ever consulted. A stronger barrier than a policy check.
--   * RLS stays ENABLED with no policies, so if the schema were ever added to
--     Exposed Schemas by accident, those roles still get nothing.
--
-- FORCE only ever governs the owner, and in a single-subject schema the owner
-- is the application, which is meant to read everything. There are no policies
-- expressing who may see what because there is only one subject. FORCE is a
-- multi-tenant tool applied to a single-tenant schema.

do $$
declare
  target record;
begin
  for target in
    select tablename from pg_tables where schemaname = 'ashwini'
  loop
    execute format('alter table ashwini.%I no force row level security', target.tablename);
  end loop;
end;
$$;

comment on schema ashwini is
  'Private health records. Kept out of `public` so Supabase PostgREST does not serve it, revoked from PUBLIC, and RLS-enabled with no policies as a further layer. Do not add this schema to the project Exposed Schemas, and do not FORCE row level security: the application is the table owner and FORCE would deny it its own record.';
