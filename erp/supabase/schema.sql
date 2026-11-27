-- =====================================================================================
-- Lowcaps ERP: database for Supabase
--
-- How to install: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to run again after an update: it creates or replaces things, and never deletes data.
--
-- Design: the browser never reads or writes tables directly. Every action goes through one
-- of the functions in the "API" section below. Each function checks who is calling
-- (auth.uid()), whether their account is active, and whether they are an admin, and
-- validates the input. Direct table access is revoked and row level security is on with
-- no policies, so the public "anon" key cannot reach the data by any other route.
-- =====================================================================================

create schema if not exists private;
revoke all on schema private from public;

-- -------------------------------------------------------------------------------------
-- Tables
-- -------------------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  email      text not null,
  role       text not null default 'staff' check (role in ('admin', 'manager', 'staff')),
  active     boolean not null default false,   -- new sign-ups wait for an admin's approval
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(btrim(name)) between 1 and 200),
  kind       text not null default 'company' check (kind in ('company', 'individual')),
  status     text not null default 'lead'    check (status in ('lead', 'active', 'inactive')),
  trn        text check (trn ~ '^\d{15}$'),   -- UAE Tax Registration Number
  email      text check (char_length(email) <= 200),
  phone      text check (phone ~ '^[+0-9 ()-]{6,20}$'),
  address    text check (char_length(address) <= 500),
  city       text check (char_length(city) <= 100),
  country    text default 'United Arab Emirates' check (char_length(country) <= 100),
  source     text check (char_length(source) <= 100),
  services   text check (char_length(services) <= 200),
  notes      text check (char_length(notes) <= 5000),
  owner_id   uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  job_title   text check (char_length(job_title) <= 100),
  email       text check (char_length(email) <= 200),
  phone       text check (phone ~ '^[+0-9 ()-]{6,20}$'),
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.activities (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('note', 'call', 'meeting', 'email', 'follow_up')),
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  due_at      date,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint activities_due_only_for_follow_ups check ((kind = 'follow_up') = (due_at is not null)),
  constraint activities_done_only_for_follow_ups check (kind = 'follow_up' or not done)
);

create index if not exists customers_status_idx    on public.customers (status);
create index if not exists customers_owner_idx     on public.customers (owner_id);
create index if not exists contacts_customer_idx   on public.contacts (customer_id);
create index if not exists activities_customer_idx on public.activities (customer_id);
create index if not exists activities_open_due_idx on public.activities (due_at) where kind = 'follow_up' and not done;

-- Kinds of work a task can be (editable by managers in the ERP).
create table if not exists public.work_types (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(btrim(name)) between 1 and 100),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists work_types_name_key on public.work_types (lower(name));

-- A piece of work a manager assigns to a team member.
create table if not exists public.tasks (
  id           bigint generated always as identity primary key,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  description  text check (char_length(description) <= 5000),
  customer_id  bigint references public.customers (id) on delete set null,
  work_type_id bigint references public.work_types (id) on delete set null,
  assigned_to  uuid references public.profiles (id) on delete set null,
  priority     text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status       text not null default 'new' check (status in ('new', 'in_progress', 'waiting', 'done', 'cancelled')),
  due_date     date,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_assigned_idx on public.tasks (assigned_to);
create index if not exists tasks_customer_idx on public.tasks (customer_id);
create index if not exists tasks_status_idx   on public.tasks (status);

-- History of a task: comments, status changes and (re)assignments.
create table if not exists public.task_updates (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references public.tasks (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('created', 'comment', 'status', 'assigned')),
  body        text check (char_length(body) <= 5000),
  from_status text,
  to_status   text,
  created_at  timestamptz not null default now()
);
create index if not exists task_updates_task_idx on public.task_updates (task_id);

-- Databases set up before managers existed: allow the new role.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'manager', 'staff'));

-- Starting list of work types (only when the list is empty).
insert into public.work_types (name)
select x from unnest(array['Sea freight', 'Air freight', 'Land transport', 'Customs clearance', 'Documentation', 'Other']) as x
where not exists (select 1 from public.work_types);

-- Lock the tables: only the API functions below (which run as the table owner) can use them.
alter table public.profiles   enable row level security;
alter table public.customers  enable row level security;
alter table public.contacts   enable row level security;
alter table public.activities enable row level security;
alter table public.work_types   enable row level security;
alter table public.tasks        enable row level security;
alter table public.task_updates enable row level security;
revoke all on public.profiles, public.customers, public.contacts, public.activities,
              public.work_types, public.tasks, public.task_updates from public, anon, authenticated;

-- -------------------------------------------------------------------------------------
-- New sign-ups get a profile that has no access until an admin approves it
-- -------------------------------------------------------------------------------------

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), 'User'), 100),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function private.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end $$;

drop trigger if exists lowcaps_on_auth_user_created on auth.users;
create trigger lowcaps_on_auth_user_created
  after insert on auth.users for each row execute function private.handle_new_user();

drop trigger if exists lowcaps_on_auth_user_email_changed on auth.users;
create trigger lowcaps_on_auth_user_email_changed
  after update of email on auth.users for each row
  when (old.email is distinct from new.email) execute function private.handle_user_email_change();

-- -------------------------------------------------------------------------------------
-- Helpers (in the "private" schema, which the API does not expose)
-- -------------------------------------------------------------------------------------

-- "Today" in the business's time zone, used for overdue follow-ups.
create or replace function private.today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Dubai')::date $$;

create or replace function private.priority_rank(p text) returns int
language sql immutable as $$
  select case p when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end
$$;

-- The caller's profile; raises unless they are signed in and approved.
create or replace function private.current_member() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'Please sign in' using errcode = '28000';
  end if;
  if not me.active then
    raise exception 'Your account is waiting for an administrator to give it access' using errcode = '42501';
  end if;
  return me;
end $$;

create or replace function private.current_manager() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  if me.role not in ('admin', 'manager') then
    raise exception 'Only managers can do this' using errcode = '42501';
  end if;
  return me;
end $$;

create or replace function private.current_admin() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  if me.role <> 'admin' then
    raise exception 'Only administrators can do this' using errcode = '42501';
  end if;
  return me;
end $$;

-- Validate an input object against rules and return the cleaned values.
-- Raises one error listing every bad field, as JSON in the error "detail", e.g. {"email":"Invalid email address"}.
-- rule keys: type (text|enum|bool|date|uuid|int), required, max, values, format (email|phone|trn), default
create or replace function private.clean(input jsonb, rules jsonb) returns jsonb
language plpgsql immutable as $$
declare
  f    text;
  r    jsonb;
  v    text;
  ok   boolean;
  res  jsonb := '{}';
  errs jsonb := '{}';
begin
  if input is null or jsonb_typeof(input) <> 'object' then
    raise exception 'Expected an object' using errcode = '22023';
  end if;

  for f, r in select key, value from jsonb_each(rules) loop
    if r ->> 'type' = 'bool' then
      res := res || jsonb_build_object(f, coalesce(input -> f in ('true'::jsonb, '1'::jsonb, '"true"'::jsonb), false));
      continue;
    end if;

    v := nullif(btrim(input ->> f), '');
    if v is null then
      if coalesce((r ->> 'required')::boolean, false) then
        errs := errs || jsonb_build_object(f, 'Required');
      else
        res := res || jsonb_build_object(f, r -> 'default');
      end if;
      continue;
    end if;

    if r ? 'max' and char_length(v) > (r ->> 'max')::int then
      errs := errs || jsonb_build_object(f, format('Must be %s characters or fewer', r ->> 'max'));
      continue;
    end if;

    if r ->> 'type' = 'enum' and not ((r -> 'values') ? v) then
      errs := errs || jsonb_build_object(f, 'Must be one of: ' ||
        (select string_agg(x, ', ') from jsonb_array_elements_text(r -> 'values') as x));
      continue;
    end if;

    if r ->> 'type' = 'date' then
      ok := v ~ '^\d{4}-\d{2}-\d{2}$';
      if ok then
        begin
          perform v::date;
        exception when others then
          ok := false;
        end;
      end if;
      if not ok then
        errs := errs || jsonb_build_object(f, 'Use a date like 2026-01-31');
        continue;
      end if;
    end if;

    if r ->> 'type' = 'int' and v !~ '^\d{1,18}$' then
      errs := errs || jsonb_build_object(f, 'Invalid');
      continue;
    end if;

    if r ->> 'type' = 'uuid' and v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      errs := errs || jsonb_build_object(f, 'Invalid');
      continue;
    end if;

    case r ->> 'format'
      when 'email' then
        if v !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
          errs := errs || jsonb_build_object(f, 'Invalid email address');
          continue;
        end if;
      when 'phone' then
        if v !~ '^[+0-9 ()-]{6,20}$' then
          errs := errs || jsonb_build_object(f, 'Invalid phone number');
          continue;
        end if;
      when 'trn' then
        v := regexp_replace(v, '[\s-]', '', 'g');
        if v !~ '^\d{15}$' then
          errs := errs || jsonb_build_object(f, 'TRN must be 15 digits');
          continue;
        end if;
      else
        null;
    end case;

    res := res || jsonb_build_object(f, v);
  end loop;

  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  return res;
end $$;

-- Customers matching the list filters. owner: '' (anyone), 'me', 'none', or a user id.
create or replace function private.filtered_customers(p_q text, p_status text, p_owner text, p_me uuid)
returns setof public.customers
language plpgsql stable set search_path = '' as $$
declare
  pat       text;
  v_owner   uuid;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if p_owner ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_owner := p_owner::uuid;
  elsif p_owner = 'me' then
    v_owner := p_me;
  end if;

  return query
  select c.* from public.customers c
  where (pat is null
         or c.name ilike pat or c.email ilike pat or c.phone ilike pat or c.trn ilike pat or c.city ilike pat
         or exists (select 1 from public.contacts k
                    where k.customer_id = c.id and (k.name ilike pat or k.email ilike pat or k.phone ilike pat)))
    and (coalesce(p_status, '') not in ('lead', 'active', 'inactive') or c.status = p_status)
    and (case
           when v_owner is not null then c.owner_id = v_owner
           when p_owner = 'none' then c.owner_id is null
           else true
         end);
end $$;

-- -------------------------------------------------------------------------------------
-- API: the functions the ERP pages call (supabase.rpc('name', {...}))
-- -------------------------------------------------------------------------------------

-- The signed-in user's own profile, including whether they have access yet.
create or replace function public.me() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('id', id, 'name', name, 'email', email, 'role', role, 'active', active)
  from public.profiles where id = auth.uid()
$$;

create or replace function public.dashboard() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
  t  date := private.today();
begin
  return json_build_object(
    'today', t,
    'counts', (select json_build_object(
                 'lead',     count(*) filter (where status = 'lead'),
                 'active',   count(*) filter (where status = 'active'),
                 'inactive', count(*) filter (where status = 'inactive'))
               from public.customers),
    'newThisMonth', (select count(*) from public.customers
                     where created_at >= (date_trunc('month', t::timestamp) at time zone 'Asia/Dubai')),
    'myCustomers', (select count(*) from public.customers where owner_id = me.id),
    'overdue', coalesce((
      select json_agg(x order by x.due_at, x.id) from (
        select a.id, a.body, a.due_at, a.customer_id, c.name as customer_name, u.name as user_name
        from public.activities a
        join public.customers c on c.id = a.customer_id
        left join public.profiles u on u.id = a.user_id
        where a.kind = 'follow_up' and not a.done and a.due_at < t
        order by a.due_at, a.id limit 20) x), '[]'),
    'upcoming', coalesce((
      select json_agg(x order by x.due_at, x.id) from (
        select a.id, a.body, a.due_at, a.customer_id, c.name as customer_name, u.name as user_name
        from public.activities a
        join public.customers c on c.id = a.customer_id
        left join public.profiles u on u.id = a.user_id
        where a.kind = 'follow_up' and not a.done and a.due_at between t and t + 7
        order by a.due_at, a.id limit 20) x), '[]'),
    'recent', coalesce((
      select json_agg(x order by x.created_at desc, x.id desc) from (
        select a.id, a.kind, a.body, a.created_at, a.customer_id, c.name as customer_name, u.name as user_name
        from public.activities a
        join public.customers c on c.id = a.customer_id
        left join public.profiles u on u.id = a.user_id
        where a.kind <> 'follow_up'
        order by a.created_at desc, a.id desc limit 8) x), '[]'),
    'myTasks', coalesce((
      select json_agg(x order by x.ord) from (
        select t2.id, t2.title, t2.status, t2.priority, t2.due_date, t2.customer_id,
               c.name as customer_name, w.name as work_type,
               row_number() over (order by t2.due_date nulls last, private.priority_rank(t2.priority) desc, t2.id) as ord
        from public.tasks t2
        left join public.customers c on c.id = t2.customer_id
        left join public.work_types w on w.id = t2.work_type_id
        where t2.assigned_to = me.id and t2.status in ('new', 'in_progress', 'waiting')
        order by ord limit 10) x), '[]'),
    'myOpenTasks', (select count(*) from public.tasks
                    where assigned_to = me.id and status in ('new', 'in_progress', 'waiting')),
    'overdueTasks', (select count(*) from public.tasks
                     where status in ('new', 'in_progress', 'waiting') and due_date < t),
    'unassignedTasks', (select count(*) from public.tasks
                        where status in ('new', 'in_progress', 'waiting') and assigned_to is null)
  );
end $$;

create or replace function public.list_customers(
  p_q text default null, p_status text default null, p_owner text default null,
  p_sort text default 'name', p_page int default 1
) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me        public.profiles := private.current_member();
  page_size constant int := 25;
  pg        int := greatest(coalesce(p_page, 1), 1);
  srt       text := case when p_sort in ('newest', 'updated') then p_sort else 'name' end;
  total     bigint;
  v_rows    json;
begin
  select count(*) into total from private.filtered_customers(p_q, p_status, p_owner, me.id);

  select coalesce(json_agg(x order by x.ord), '[]') into v_rows from (
    select c.id, c.name, c.kind, c.status, c.email, c.phone, c.city, c.updated_at, c.owner_id,
           u.name as owner_name,
           (select k.name from public.contacts k where k.customer_id = c.id
             order by k.is_primary desc, k.id limit 1) as contact_name,
           (select count(*) from public.activities a
             where a.customer_id = c.id and a.kind = 'follow_up' and not a.done) as open_follow_ups,
           row_number() over (order by
             case when srt = 'name' then lower(c.name) end asc,
             case when srt = 'newest' then c.created_at end desc,
             case when srt = 'updated' then c.updated_at end desc,
             c.id desc) as ord
    from private.filtered_customers(p_q, p_status, p_owner, me.id) c
    left join public.profiles u on u.id = c.owner_id
    order by ord
    limit page_size offset (pg - 1) * page_size
  ) x;

  return json_build_object('customers', v_rows, 'total', total, 'page', pg, 'pageSize', page_size);
end $$;

-- All matching customers, for the CSV export.
create or replace function public.export_customers(
  p_q text default null, p_status text default null, p_owner text default null
) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  return coalesce((
    select json_agg(x order by lower(x.name), x.id) from (
      select c.id, c.name, c.kind, c.status, c.trn, c.email, c.phone, c.address, c.city, c.country,
             c.source, c.services, u.name as owner, c.created_at
      from private.filtered_customers(p_q, p_status, p_owner, me.id) c
      left join public.profiles u on u.id = c.owner_id) x), '[]');
end $$;

create or replace function public.get_customer(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_member();
  result json;
begin
  select json_build_object(
    'today', private.today(),
    'customer', to_jsonb(c) || jsonb_build_object(
      'owner_name', o.name,
      'created_by_name', cb.name,
      'contacts', coalesce((
        select jsonb_agg(to_jsonb(k) order by k.is_primary desc, lower(k.name), k.id)
        from public.contacts k where k.customer_id = c.id), '[]'),
      'activities', coalesce((
        select jsonb_agg(to_jsonb(a) || jsonb_build_object('user_name', u.name) order by a.created_at desc, a.id desc)
        from public.activities a left join public.profiles u on u.id = a.user_id
        where a.customer_id = c.id), '[]'),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'due_date', t.due_date,
            'assigned_to', t.assigned_to, 'assignee_name', u.name, 'work_type', w.name)
          order by t.status in ('done', 'cancelled'), t.due_date nulls last, t.id desc)
        from public.tasks t
        left join public.profiles u on u.id = t.assigned_to
        left join public.work_types w on w.id = t.work_type_id
        where t.customer_id = c.id), '[]')))
  into result
  from public.customers c
  left join public.profiles o  on o.id = c.owner_id
  left join public.profiles cb on cb.id = c.created_by
  where c.id = p_id;

  if result is null then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- Create (p_id null) or update a customer. Returns its id.
create or replace function public.save_customer(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
  d  jsonb := private.clean(p_data, '{
    "name":     {"type": "text", "required": true, "max": 200},
    "kind":     {"type": "enum", "values": ["company", "individual"], "default": "company"},
    "status":   {"type": "enum", "values": ["lead", "active", "inactive"], "default": "lead"},
    "trn":      {"type": "text", "format": "trn"},
    "email":    {"type": "text", "max": 200, "format": "email"},
    "phone":    {"type": "text", "format": "phone"},
    "address":  {"type": "text", "max": 500},
    "city":     {"type": "text", "max": 100},
    "country":  {"type": "text", "max": 100, "default": "United Arab Emirates"},
    "source":   {"type": "text", "max": 100},
    "services": {"type": "text", "max": 200},
    "notes":    {"type": "text", "max": 5000},
    "owner_id": {"type": "uuid"}
  }');
  new_id bigint;
begin
  if d ->> 'owner_id' is not null
     and not exists (select 1 from public.profiles where id = (d ->> 'owner_id')::uuid and active) then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = '{"owner_id": "Pick a user who has access"}';
  end if;

  if p_id is null then
    insert into public.customers (name, kind, status, trn, email, phone, address, city, country,
                                  source, services, notes, owner_id, created_by)
    values (d ->> 'name', d ->> 'kind', d ->> 'status', d ->> 'trn', d ->> 'email', d ->> 'phone',
            d ->> 'address', d ->> 'city', d ->> 'country', d ->> 'source', d ->> 'services',
            d ->> 'notes', (d ->> 'owner_id')::uuid, me.id)
    returning id into new_id;
    return new_id;
  end if;

  update public.customers set
    name = d ->> 'name', kind = d ->> 'kind', status = d ->> 'status', trn = d ->> 'trn',
    email = d ->> 'email', phone = d ->> 'phone', address = d ->> 'address', city = d ->> 'city',
    country = d ->> 'country', source = d ->> 'source', services = d ->> 'services',
    notes = d ->> 'notes', owner_id = (d ->> 'owner_id')::uuid, updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  return p_id;
end $$;

create or replace function public.delete_customer(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  delete from public.customers where id = p_id;
  if not found then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
end $$;

-- Create (p_id null) or update a contact. Only one contact per customer can be the main one.
create or replace function public.save_contact(p_customer_id bigint, p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_member();
  d    jsonb := private.clean(p_data, '{
    "name":       {"type": "text", "required": true, "max": 200},
    "job_title":  {"type": "text", "max": 100},
    "email":      {"type": "text", "max": 200, "format": "email"},
    "phone":      {"type": "text", "format": "phone"},
    "is_primary": {"type": "bool"}
  }');
  cust bigint := p_customer_id;
  new_id bigint;
begin
  if p_id is not null then
    select customer_id into cust from public.contacts where id = p_id;
    if cust is null then
      raise exception 'Contact not found' using errcode = 'P0002';
    end if;
  elsif not exists (select 1 from public.customers where id = cust) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;

  if (d ->> 'is_primary')::boolean then
    update public.contacts set is_primary = false where customer_id = cust and is_primary;
  end if;

  if p_id is null then
    insert into public.contacts (customer_id, name, job_title, email, phone, is_primary)
    values (cust, d ->> 'name', d ->> 'job_title', d ->> 'email', d ->> 'phone', (d ->> 'is_primary')::boolean)
    returning id into new_id;
    return new_id;
  end if;

  update public.contacts set name = d ->> 'name', job_title = d ->> 'job_title', email = d ->> 'email',
    phone = d ->> 'phone', is_primary = (d ->> 'is_primary')::boolean
  where id = p_id;
  return p_id;
end $$;

create or replace function public.delete_contact(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  delete from public.contacts where id = p_id;
  if not found then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
end $$;

-- Log a note, call, meeting, email, or a follow-up (which needs a due date).
create or replace function public.add_activity(p_customer_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
  d  jsonb := private.clean(p_data, '{
    "kind":   {"type": "enum", "required": true, "values": ["note", "call", "meeting", "email", "follow_up"]},
    "body":   {"type": "text", "required": true, "max": 5000},
    "due_at": {"type": "date"}
  }');
  new_id bigint;
begin
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  if d ->> 'kind' = 'follow_up' and d ->> 'due_at' is null then
    raise exception 'A follow-up needs a due date' using errcode = '22023',
      detail = '{"due_at": "Required for a follow-up"}';
  end if;

  insert into public.activities (customer_id, user_id, kind, body, due_at)
  values (p_customer_id, me.id, d ->> 'kind', d ->> 'body',
          case when d ->> 'kind' = 'follow_up' then (d ->> 'due_at')::date end)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.set_follow_up_done(p_id bigint, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
  k  text;
begin
  select kind into k from public.activities where id = p_id;
  if k is null then
    raise exception 'Entry not found' using errcode = 'P0002';
  end if;
  if k <> 'follow_up' then
    raise exception 'Only follow-ups can be marked done' using errcode = '22023';
  end if;
  update public.activities set done = coalesce(p_done, false) where id = p_id;
end $$;

-- Staff can delete their own entries; admins can delete any.
create or replace function public.delete_activity(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_member();
  owner uuid;
  found_row boolean;
begin
  select true, user_id into found_row, owner from public.activities where id = p_id;
  if found_row is null then
    raise exception 'Entry not found' using errcode = 'P0002';
  end if;
  if me.role <> 'admin' and owner is distinct from me.id then
    raise exception 'You can only delete your own entries' using errcode = '42501';
  end if;
  delete from public.activities where id = p_id;
end $$;

-- Everyone sees colleagues' names and roles (for picking an owner or assignee); admins also see emails and who is waiting.
create or replace function public.list_users() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  if me.role = 'admin' then
    return coalesce((select json_agg(json_build_object(
        'id', id, 'name', name, 'email', email, 'role', role, 'active', active, 'created_at', created_at)
        order by active, lower(name)) from public.profiles), '[]');
  end if;
  return coalesce((select json_agg(json_build_object('id', id, 'name', name, 'role', role, 'active', active)
      order by lower(name)) from public.profiles where active), '[]');
end $$;

create or replace function public.admin_update_user(p_id uuid, p_name text, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_admin();
  d  jsonb := private.clean(
    jsonb_build_object('name', p_name, 'role', p_role),
    '{"name": {"type": "text", "required": true, "max": 100},
      "role": {"type": "enum", "required": true, "values": ["admin", "manager", "staff"]}}');
begin
  if p_id = me.id and (d ->> 'role' <> 'admin' or not coalesce(p_active, false)) then
    raise exception 'You cannot remove your own admin access or turn off your own account' using errcode = '22023';
  end if;
  update public.profiles set name = d ->> 'name', role = d ->> 'role', active = coalesce(p_active, false)
  where id = p_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.update_my_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := private.clean(jsonb_build_object('name', p_name), '{"name": {"type": "text", "required": true, "max": 100}}');
begin
  if auth.uid() is null then
    raise exception 'Please sign in' using errcode = '28000';
  end if;
  update public.profiles set name = d ->> 'name' where id = auth.uid();
end $$;

-- -------------------------------------------------------------------------------------
-- API: tasks and work types
-- -------------------------------------------------------------------------------------

-- Tasks matching the list filters.
--   status:   'open' (new, in progress, waiting), 'all', or one status
--   assignee: '' (anyone), 'me', 'none', or a user id
create or replace function private.filtered_tasks(
  p_q text, p_status text, p_assignee text, p_work_type bigint, p_customer_id bigint, p_me uuid
) returns setof public.tasks
language plpgsql stable set search_path = '' as $$
declare
  pat        text;
  v_assignee uuid;
  v_status   text := coalesce(nullif(p_status, ''), 'open');
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if p_assignee ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_assignee := p_assignee::uuid;
  elsif p_assignee = 'me' then
    v_assignee := p_me;
  end if;

  return query
  select t.* from public.tasks t
  left join public.customers c on c.id = t.customer_id
  where (pat is null or t.title ilike pat or t.description ilike pat or c.name ilike pat)
    and (case v_status
           when 'open' then t.status in ('new', 'in_progress', 'waiting')
           when 'all' then true
           else t.status = v_status
         end)
    and (case
           when v_assignee is not null then t.assigned_to = v_assignee
           when p_assignee = 'none' then t.assigned_to is null
           else true
         end)
    and (p_work_type is null or t.work_type_id = p_work_type)
    and (p_customer_id is null or t.customer_id = p_customer_id);
end $$;

create or replace function public.list_tasks(
  p_q text default null, p_status text default 'open', p_assignee text default null,
  p_work_type bigint default null, p_customer_id bigint default null, p_page int default 1
) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me        public.profiles := private.current_member();
  page_size constant int := 25;
  pg        int := greatest(coalesce(p_page, 1), 1);
  total     bigint;
  v_rows    json;
begin
  select count(*) into total
  from private.filtered_tasks(p_q, p_status, p_assignee, p_work_type, p_customer_id, me.id);

  select coalesce(json_agg(x order by x.ord), '[]') into v_rows from (
    select t.id, t.title, t.status, t.priority, t.due_date, t.updated_at, t.customer_id, t.assigned_to,
           c.name as customer_name, w.name as work_type, u.name as assignee_name,
           row_number() over (order by t.status in ('done', 'cancelled'), t.due_date nulls last,
                              private.priority_rank(t.priority) desc, t.id desc) as ord
    from private.filtered_tasks(p_q, p_status, p_assignee, p_work_type, p_customer_id, me.id) t
    left join public.customers c on c.id = t.customer_id
    left join public.work_types w on w.id = t.work_type_id
    left join public.profiles u on u.id = t.assigned_to
    order by ord
    limit page_size offset (pg - 1) * page_size
  ) x;

  return json_build_object('tasks', v_rows, 'total', total, 'page', pg, 'pageSize', page_size,
                           'today', private.today());
end $$;

create or replace function public.get_task(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_member();
  result json;
begin
  select json_build_object(
    'today', private.today(),
    'task', to_jsonb(t) || jsonb_build_object(
      'customer_name', c.name,
      'work_type', w.name,
      'assignee_name', u.name,
      'created_by_name', cb.name,
      'updates', coalesce((
        select jsonb_agg(to_jsonb(x) || jsonb_build_object('user_name', xu.name) order by x.created_at desc, x.id desc)
        from public.task_updates x left join public.profiles xu on xu.id = x.user_id
        where x.task_id = t.id), '[]')))
  into result
  from public.tasks t
  left join public.customers c  on c.id = t.customer_id
  left join public.work_types w on w.id = t.work_type_id
  left join public.profiles u   on u.id = t.assigned_to
  left join public.profiles cb  on cb.id = t.created_by
  where t.id = p_id;

  if result is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- Create (p_id null) or edit a task. Managers and admins only. Returns its id.
create or replace function public.save_task(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  d   jsonb := private.clean(p_data, '{
    "title":        {"type": "text", "required": true, "max": 200},
    "description":  {"type": "text", "max": 5000},
    "customer_id":  {"type": "int"},
    "work_type_id": {"type": "int"},
    "assigned_to":  {"type": "uuid"},
    "priority":     {"type": "enum", "values": ["low", "normal", "high", "urgent"], "default": "normal"},
    "status":       {"type": "enum", "values": ["new", "in_progress", "waiting", "done", "cancelled"], "default": "new"},
    "due_date":     {"type": "date"}
  }');
  v_old       public.tasks;
  v_id      bigint;
  assignee  uuid := (d ->> 'assigned_to')::uuid;
  errs      jsonb := '{}';
begin
  if p_id is not null then
    select * into v_old from public.tasks where id = p_id;
    if v_old.id is null then
      raise exception 'Task not found' using errcode = 'P0002';
    end if;
  end if;

  if d ->> 'customer_id' is not null
     and not exists (select 1 from public.customers where id = (d ->> 'customer_id')::bigint) then
    errs := errs || '{"customer_id": "Pick a customer from the list"}';
  end if;
  if d ->> 'work_type_id' is not null
     and not exists (select 1 from public.work_types where id = (d ->> 'work_type_id')::bigint
                     and (active or id is not distinct from v_old.work_type_id)) then
    errs := errs || '{"work_type_id": "Pick a type of work from the list"}';
  end if;
  if assignee is not null and assignee is distinct from v_old.assigned_to
     and not exists (select 1 from public.profiles where id = assignee and active) then
    errs := errs || '{"assigned_to": "Pick a team member who has access"}';
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  if p_id is null then
    insert into public.tasks (title, description, customer_id, work_type_id, assigned_to, priority, status,
                              due_date, created_by, completed_at)
    values (d ->> 'title', d ->> 'description', (d ->> 'customer_id')::bigint, (d ->> 'work_type_id')::bigint,
            assignee, d ->> 'priority', d ->> 'status', (d ->> 'due_date')::date, me.id,
            case when d ->> 'status' = 'done' then now() end)
    returning id into v_id;
    insert into public.task_updates (task_id, user_id, kind, body)
    values (v_id, me.id, 'created', 'Created the task');
    if assignee is not null then
      insert into public.task_updates (task_id, user_id, kind, body)
      values (v_id, me.id, 'assigned', 'Assigned to ' || (select name from public.profiles where id = assignee));
    end if;
    return v_id;
  end if;

  update public.tasks set
    title = d ->> 'title', description = d ->> 'description',
    customer_id = (d ->> 'customer_id')::bigint, work_type_id = (d ->> 'work_type_id')::bigint,
    assigned_to = assignee, priority = d ->> 'priority', status = d ->> 'status',
    due_date = (d ->> 'due_date')::date, updated_at = now(),
    completed_at = case when d ->> 'status' = 'done' then coalesce(v_old.completed_at, now()) end
  where id = p_id;

  if v_old.status <> d ->> 'status' then
    insert into public.task_updates (task_id, user_id, kind, from_status, to_status)
    values (p_id, me.id, 'status', v_old.status, d ->> 'status');
  end if;
  if v_old.assigned_to is distinct from assignee then
    insert into public.task_updates (task_id, user_id, kind, body)
    values (p_id, me.id, 'assigned', coalesce('Assigned to ' || (select name from public.profiles where id = assignee), 'Unassigned'));
  end if;
  return p_id;
end $$;

-- Move a task to another status, with an optional note. The assigned person, managers and admins can.
create or replace function public.update_task_status(p_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_member();
  d    jsonb := private.clean(jsonb_build_object('status', p_status, 'note', p_note), '{
    "status": {"type": "enum", "required": true, "values": ["new", "in_progress", "waiting", "done", "cancelled"]},
    "note":   {"type": "text", "max": 5000}
  }');
  v_old  public.tasks;
begin
  select * into v_old from public.tasks where id = p_id;
  if v_old.id is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if me.role not in ('admin', 'manager') and v_old.assigned_to is distinct from me.id then
    raise exception 'Only the person this task is assigned to, or a manager, can change its status' using errcode = '42501';
  end if;
  if v_old.status = d ->> 'status' then
    return;
  end if;

  update public.tasks set status = d ->> 'status', updated_at = now(),
    completed_at = case when d ->> 'status' = 'done' then now() end
  where id = p_id;
  insert into public.task_updates (task_id, user_id, kind, body, from_status, to_status)
  values (p_id, me.id, 'status', d ->> 'note', v_old.status, d ->> 'status');
end $$;

-- Anyone with access can comment on a task.
create or replace function public.add_task_comment(p_id bigint, p_body text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_member();
  d      jsonb := private.clean(jsonb_build_object('body', p_body), '{"body": {"type": "text", "required": true, "max": 5000}}');
  new_id bigint;
begin
  if not exists (select 1 from public.tasks where id = p_id) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  insert into public.task_updates (task_id, user_id, kind, body)
  values (p_id, me.id, 'comment', d ->> 'body')
  returning id into new_id;
  update public.tasks set updated_at = now() where id = p_id;
  return new_id;
end $$;

create or replace function public.delete_task(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  delete from public.tasks where id = p_id;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
end $$;

-- Customers for the task form's customer picker.
create or replace function public.customer_options() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  return coalesce((select json_agg(json_build_object('id', id, 'name', name, 'status', status) order by lower(name), id)
                   from public.customers), '[]');
end $$;

create or replace function public.list_work_types() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  return coalesce((select json_agg(json_build_object(
      'id', w.id, 'name', w.name, 'active', w.active,
      'open_tasks', (select count(*) from public.tasks t where t.work_type_id = w.id and t.status in ('new', 'in_progress', 'waiting')))
    order by not w.active, lower(w.name)) from public.work_types w), '[]');
end $$;

-- Add (p_id null) or rename / switch on or off a type of work. Managers and admins only.
create or replace function public.save_work_type(p_id bigint, p_name text, p_active boolean default true) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  d      jsonb := private.clean(jsonb_build_object('name', p_name), '{"name": {"type": "text", "required": true, "max": 100}}');
  v_id   bigint;
begin
  begin
    if p_id is null then
      insert into public.work_types (name, active) values (d ->> 'name', coalesce(p_active, true)) returning id into v_id;
      return v_id;
    end if;
    update public.work_types set name = d ->> 'name', active = coalesce(p_active, true) where id = p_id;
    if not found then
      raise exception 'Type of work not found' using errcode = 'P0002';
    end if;
    return p_id;
  exception when unique_violation then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = '{"name": "This type of work already exists"}';
  end;
end $$;

-- -------------------------------------------------------------------------------------
-- Who may call what: signed-in users only. Helpers are not callable from the API at all.
-- -------------------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.me()',
    'public.dashboard()',
    'public.list_customers(text, text, text, text, int)',
    'public.export_customers(text, text, text)',
    'public.get_customer(bigint)',
    'public.save_customer(bigint, jsonb)',
    'public.delete_customer(bigint)',
    'public.save_contact(bigint, bigint, jsonb)',
    'public.delete_contact(bigint)',
    'public.add_activity(bigint, jsonb)',
    'public.set_follow_up_done(bigint, boolean)',
    'public.delete_activity(bigint)',
    'public.list_users()',
    'public.admin_update_user(uuid, text, text, boolean)',
    'public.update_my_name(text)',
    'public.list_tasks(text, text, text, bigint, bigint, int)',
    'public.get_task(bigint)',
    'public.save_task(bigint, jsonb)',
    'public.update_task_status(bigint, text, text)',
    'public.add_task_comment(bigint, text)',
    'public.delete_task(bigint)',
    'public.customer_options()',
    'public.list_work_types()',
    'public.save_work_type(bigint, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- Make the API pick up the new functions straight away.
notify pgrst, 'reload schema';

-- =====================================================================================
-- After running this file, make yourself the first administrator:
--   1. Open the ERP and click "Create an account".
--   2. Come back here and run (with your email):
--        update public.profiles set role = 'admin', active = true where email = 'you@example.com';
-- =====================================================================================
