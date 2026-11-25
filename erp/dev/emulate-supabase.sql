-- Recreates the parts of a Supabase database that schema.sql relies on, so it can be tested
-- on a plain local PostgreSQL. NOT for use on Supabase itself (it already has all of this).

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}',
  created_at         timestamptz not null default now()
);

-- Same definition as Supabase's auth.uid(): the "sub" claim of the caller's JWT.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase's default privileges: everything created in "public" is granted to the API roles.
-- schema.sql must revoke these itself, so the test environment starts from the same place.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
