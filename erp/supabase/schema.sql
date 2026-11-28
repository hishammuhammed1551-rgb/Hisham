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
  role       text not null default 'staff' check (role in ('admin', 'manager', 'staff', 'employee')),
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

-- Lowcaps' own details, printed on every invoice (one row).
create table if not exists public.company_settings (
  id                 int primary key default 1 check (id = 1),
  legal_name         text not null default 'Lowcaps' check (char_length(btrim(legal_name)) between 1 and 200),
  address            text check (char_length(address) <= 500),
  phone              text check (char_length(phone) <= 50),
  email              text check (char_length(email) <= 200),
  trn                text check (trn ~ '^\d{15}$'),
  bank_name          text check (char_length(bank_name) <= 200),
  account_name       text check (char_length(account_name) <= 200),
  iban               text check (char_length(iban) <= 50),
  swift              text check (char_length(swift) <= 20),
  payment_terms_days int not null default 30 check (payment_terms_days between 0 and 365),
  invoice_notes      text check (char_length(invoice_notes) <= 2000),
  updated_at         timestamptz not null default now()
);
insert into public.company_settings (id) values (1) on conflict (id) do nothing;

-- Running invoice numbers per type and year: PRO-2026-0001, INV-2026-0001.
create table if not exists public.invoice_counters (
  kind text not null,
  year int  not null,
  last int  not null default 0,
  primary key (kind, year)
);

-- Proforma and tax invoices. Customer and supplier details are copied in when the invoice is saved,
-- so a sent invoice never changes if the customer or company details change later.
create table if not exists public.invoices (
  id               bigint generated always as identity primary key,
  kind             text not null check (kind in ('proforma', 'tax')),
  number           text not null unique,
  status           text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'cancelled')),
  task_id          bigint references public.tasks (id) on delete set null,
  customer_id      bigint references public.customers (id) on delete set null,
  proforma_id      bigint references public.invoices (id) on delete set null,
  issue_date       date not null,
  due_date         date,
  supply_date      date,
  customer_name    text not null,
  customer_address text,
  customer_trn     text,
  customer_email   text,
  supplier         jsonb not null default '{}',
  notes            text check (char_length(notes) <= 2000),
  subtotal         numeric(14, 2) not null default 0,
  vat_total        numeric(14, 2) not null default 0,
  total            numeric(14, 2) not null default 0,
  sent_at          timestamptz,
  sent_to          text,
  paid_at          timestamptz,
  cancelled_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists invoices_task_idx     on public.invoices (task_id);
create index if not exists invoices_customer_idx on public.invoices (customer_id);

-- vat_code: standard (5%), zero (0%, zero-rated), exempt, out_of_scope (e.g. disbursements)
create table if not exists public.invoice_lines (
  id          bigint generated always as identity primary key,
  invoice_id  bigint not null references public.invoices (id) on delete cascade,
  position    int not null,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity    numeric(12, 3) not null check (quantity > 0),
  unit_price  numeric(14, 2) not null check (unit_price >= 0),
  vat_code    text not null check (vat_code in ('standard', 'zero', 'exempt', 'out_of_scope')),
  net         numeric(14, 2) not null,
  vat         numeric(14, 2) not null
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

-- Money received against an invoice. Bounced cheques stay on record but don't count as paid.
create table if not exists public.payments (
  id            bigint generated always as identity primary key,
  invoice_id    bigint not null references public.invoices (id) on delete restrict,
  amount        numeric(14, 2) not null check (amount > 0),
  method        text not null check (method in ('bank_transfer', 'cash', 'cheque', 'other')),
  paid_on       date not null,
  reference     text check (char_length(reference) <= 100),
  cheque_bank   text check (char_length(cheque_bank) <= 100),
  cheque_date   date,
  cheque_status text check (cheque_status in ('pending', 'cleared', 'bounced')),
  notes         text check (char_length(notes) <= 1000),
  recorded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint payments_cheque_status_only_for_cheques check ((method = 'cheque') = (cheque_status is not null))
);
create index if not exists payments_invoice_idx on public.payments (invoice_id);

-- HR settings (on the same one-row settings table).
alter table public.company_settings add column if not exists office_lat double precision;
alter table public.company_settings add column if not exists office_lng double precision;
alter table public.company_settings add column if not exists office_radius_m int not null default 200;
alter table public.company_settings add column if not exists work_start time not null default '09:00';
alter table public.company_settings add column if not exists weekend_days int[] not null default '{0,6}';  -- 0 = Sunday ... 6 = Saturday
alter table public.company_settings add column if not exists annual_leave_days int not null default 30;
alter table public.company_settings add column if not exists medical_leave_days int not null default 15;

-- One HR record per user. Who sees what is decided in the functions below.
create table if not exists public.employees (
  profile_id          uuid primary key references public.profiles (id) on delete cascade,
  employee_no         text check (char_length(employee_no) <= 30),
  designation         text check (char_length(designation) <= 100),
  department          text check (char_length(department) <= 100),
  joining_date        date,
  work_phone          text check (char_length(work_phone) <= 30),
  date_of_birth       date,
  gender              text check (gender in ('male', 'female')),
  nationality         text check (char_length(nationality) <= 60),
  personal_email      text check (char_length(personal_email) <= 200),
  personal_phone      text check (char_length(personal_phone) <= 30),
  address             text check (char_length(address) <= 500),
  emergency_name      text check (char_length(emergency_name) <= 100),
  emergency_relation  text check (char_length(emergency_relation) <= 50),
  emergency_phone     text check (char_length(emergency_phone) <= 30),
  emirates_id         text check (char_length(emirates_id) <= 30),
  emirates_id_expiry  date,
  passport_no         text check (char_length(passport_no) <= 30),
  passport_expiry     date,
  visa_expiry         date,
  bank_name           text check (char_length(bank_name) <= 100),
  iban                text check (char_length(iban) <= 50),
  basic_salary        numeric(12, 2) not null default 0 check (basic_salary >= 0),
  housing_allowance   numeric(12, 2) not null default 0 check (housing_allowance >= 0),
  transport_allowance numeric(12, 2) not null default 0 check (transport_allowance >= 0),
  other_allowance     numeric(12, 2) not null default 0 check (other_allowance >= 0),
  annual_leave_days   int check (annual_leave_days between 0 and 366),   -- empty = company default
  medical_leave_days  int check (medical_leave_days between 0 and 366),
  status              text not null default 'active' check (status in ('active', 'left')),
  leaving_date        date,
  notes               text check (char_length(notes) <= 2000),
  updated_at          timestamptz not null default now()
);

-- One attendance record per person per day: sign in on arrival, sign out when leaving.
-- A remark is required when signing in or out away from the office (or without location).
create table if not exists public.attendance (
  id             bigint generated always as identity primary key,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  work_date      date not null,
  sign_in        timestamptz,
  sign_out       timestamptz,
  in_lat         double precision,
  in_lng         double precision,
  in_distance_m  int,
  in_at_office   boolean,
  in_remark      text check (char_length(in_remark) <= 300),
  out_lat        double precision,
  out_lng        double precision,
  out_distance_m int,
  out_at_office  boolean,
  out_remark     text check (char_length(out_remark) <= 300),
  edited_by      uuid references public.profiles (id) on delete set null,
  edit_note      text check (char_length(edit_note) <= 300),
  unique (profile_id, work_date)
);
create index if not exists attendance_date_idx on public.attendance (work_date);

create table if not exists public.leave_requests (
  id            bigint generated always as identity primary key,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('annual', 'medical')),
  start_date    date not null,
  end_date      date not null,
  days          numeric(5, 1) not null check (days > 0),
  reason        text check (char_length(reason) <= 1000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_requests_profile_idx on public.leave_requests (profile_id, start_date);

-- Monthly payslips. Employees only ever see their own, and only once published.
create table if not exists public.payslips (
  id                  bigint generated always as identity primary key,
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  period              date not null check (extract(day from period) = 1),   -- first day of the month
  basic_salary        numeric(12, 2) not null default 0 check (basic_salary >= 0),
  housing_allowance   numeric(12, 2) not null default 0 check (housing_allowance >= 0),
  transport_allowance numeric(12, 2) not null default 0 check (transport_allowance >= 0),
  other_allowance     numeric(12, 2) not null default 0 check (other_allowance >= 0),
  overtime            numeric(12, 2) not null default 0 check (overtime >= 0),
  bonus               numeric(12, 2) not null default 0 check (bonus >= 0),
  deductions          numeric(12, 2) not null default 0 check (deductions >= 0),
  deduction_note      text check (char_length(deduction_note) <= 300),
  notes               text check (char_length(notes) <= 1000),
  status              text not null default 'draft' check (status in ('draft', 'published')),
  published_at        timestamptz,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (profile_id, period),
  check (basic_salary + housing_allowance + transport_allowance + other_allowance + overtime + bonus >= deductions)
);

-- -------------------------------------------------------------------------------------
-- Finance: chart of accounts and the double-entry ledger
-- -------------------------------------------------------------------------------------

-- type decides the normal side and the report section; subtype groups accounts within reports and
-- tells the automatic postings what an account is for. system_key marks the accounts automatic
-- postings use (they can be renamed but not removed or retyped).
create table if not exists public.accounts (
  id             bigint generated always as identity primary key,
  code           text not null unique check (code ~ '^\d{3,6}$'),
  name           text not null check (char_length(btrim(name)) between 1 and 100),
  type           text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  subtype        text not null check (subtype in ('cash', 'bank', 'pdc', 'receivable', 'current_asset', 'fixed_asset', 'vat_input',
                                                 'payable', 'vat_output', 'customer_advance', 'current_liability', 'long_term_liability',
                                                 'equity', 'retained_earnings', 'opening_equity',
                                                 'revenue', 'other_income', 'cost_of_sales', 'expense')),
  system_key     text unique,
  bank_name      text check (char_length(bank_name) <= 100),
  account_number text check (char_length(account_number) <= 50),
  description    text check (char_length(description) <= 300),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

insert into public.accounts (code, name, type, subtype, system_key)
select x.code, x.name, x.type, x.subtype, x.system_key
from (values
  ('1010', 'Cash in hand',                          'asset',     'cash',                'cash'),
  ('1020', 'Petty cash',                            'asset',     'cash',                'petty_cash'),
  ('1100', 'Bank - current account',                'asset',     'bank',                'bank'),
  ('1150', 'Cheques in hand (not yet cleared)',     'asset',     'pdc',                 'pdc'),
  ('1200', 'Accounts receivable',                   'asset',     'receivable',          'ar'),
  ('1300', 'Customs duty & disbursements recoverable', 'asset',  'current_asset',       'disbursements'),
  ('1350', 'Prepaid expenses',                      'asset',     'current_asset',       'prepaid'),
  ('1360', 'Staff advances',                        'asset',     'current_asset',       null),
  ('1400', 'VAT input (recoverable)',               'asset',     'vat_input',           'vat_input'),
  ('1500', 'Security deposits',                     'asset',     'current_asset',       null),
  ('1600', 'Office equipment & furniture',          'asset',     'fixed_asset',         null),
  ('1610', 'Vehicles',                              'asset',     'fixed_asset',         null),
  ('1690', 'Accumulated depreciation',              'asset',     'fixed_asset',         null),
  ('2100', 'Accounts payable',                      'liability', 'payable',             'ap'),
  ('2150', 'Customer advances',                     'liability', 'customer_advance',    'customer_advances'),
  ('2200', 'VAT output',                            'liability', 'vat_output',          'vat_output'),
  ('2210', 'VAT payable to FTA',                    'liability', 'current_liability',   'vat_payable'),
  ('2300', 'Accrued expenses',                      'liability', 'current_liability',   'accruals'),
  ('2310', 'Salaries payable',                      'liability', 'current_liability',   'salaries_payable'),
  ('2400', 'End of service benefits provision',     'liability', 'long_term_liability', null),
  ('3100', 'Owner''s capital',                      'equity',    'equity',              null),
  ('3200', 'Owner''s drawings',                     'equity',    'equity',              null),
  ('3300', 'Retained earnings',                     'equity',    'retained_earnings',   'retained_earnings'),
  ('3900', 'Opening balance equity',                'equity',    'opening_equity',      'opening_equity'),
  ('4100', 'Sea freight revenue',                   'income',    'revenue',             null),
  ('4110', 'Air freight revenue',                   'income',    'revenue',             null),
  ('4120', 'Land transport revenue',                'income',    'revenue',             null),
  ('4130', 'Customs clearance fees',                'income',    'revenue',             null),
  ('4140', 'Documentation fees',                    'income',    'revenue',             null),
  ('4150', 'PRO & visa services',                   'income',    'revenue',             null),
  ('4190', 'Other operating revenue',               'income',    'revenue',             'revenue_other'),
  ('4900', 'Other income',                          'income',    'other_income',        null),
  ('5100', 'Freight & carrier costs',               'expense',   'cost_of_sales',       null),
  ('5110', 'Port & handling charges',               'expense',   'cost_of_sales',       null),
  ('5120', 'Transport subcontractors',              'expense',   'cost_of_sales',       null),
  ('6100', 'Salaries & wages',                      'expense',   'expense',             'salaries'),
  ('6110', 'Staff allowances & benefits',           'expense',   'expense',             null),
  ('6120', 'Visa & labour costs',                   'expense',   'expense',             null),
  ('6200', 'Office rent',                           'expense',   'expense',             null),
  ('6210', 'Utilities & telecom',                   'expense',   'expense',             null),
  ('6300', 'Vehicle fuel & maintenance',            'expense',   'expense',             null),
  ('6400', 'Bank charges',                          'expense',   'expense',             'bank_charges'),
  ('6500', 'Professional fees',                     'expense',   'expense',             null),
  ('6600', 'Office supplies & printing',            'expense',   'expense',             null),
  ('6700', 'Depreciation',                          'expense',   'expense',             null),
  ('6800', 'Marketing',                             'expense',   'expense',             null),
  ('6900', 'Miscellaneous expenses',                'expense',   'expense',             null)
) as x(code, name, type, subtype, system_key)
where not exists (select 1 from public.accounts);

-- Revenue account per type of work, used when a tax invoice is posted.
alter table public.work_types add column if not exists revenue_account_id bigint references public.accounts (id) on delete set null;
update public.work_types w set revenue_account_id = a.id
from public.accounts a
where w.revenue_account_id is null and a.code = case lower(w.name)
  when 'sea freight' then '4100' when 'air freight' then '4110' when 'land transport' then '4120'
  when 'customs clearance' then '4130' when 'documentation' then '4140' else null end;

-- Optional income account chosen on an invoice line (otherwise worked out when posting).
alter table public.invoice_lines add column if not exists account_id bigint references public.accounts (id) on delete set null;

-- Which account a payment was received into, and whether its posting credited receivables or customer advances.
alter table public.payments add column if not exists account_id bigint references public.accounts (id) on delete set null;
alter table public.payments add column if not exists posted_side text check (posted_side in ('ar', 'advance'));

-- Books closed up to this date (nothing can be posted on or before it).
alter table public.company_settings add column if not exists books_locked_until date;

create table if not exists public.journals (
  id             bigint generated always as identity primary key,
  number         text not null unique,
  entry_date     date not null,
  kind           text not null check (kind in ('journal', 'adjustment', 'accrual', 'prepayment', 'opening', 'invoice', 'payment',
                                               'reversal', 'bank_receipt', 'bank_payment', 'transfer')),
  memo           text check (char_length(memo) <= 500),
  reference      text check (char_length(reference) <= 100),
  source_type    text check (source_type in ('invoice', 'payment')),
  source_id      bigint,
  reverses_id    bigint references public.journals (id) on delete set null,
  reversed_by_id bigint references public.journals (id) on delete set null,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists journals_source_idx on public.journals (source_type, source_id);
create index if not exists journals_date_idx on public.journals (entry_date);

create table if not exists public.journal_lines (
  id          bigint generated always as identity primary key,
  journal_id  bigint not null references public.journals (id) on delete cascade,
  line_no     int not null,
  account_id  bigint not null references public.accounts (id) on delete restrict,
  description text check (char_length(description) <= 300),
  debit       numeric(14, 2) not null default 0 check (debit >= 0),
  credit      numeric(14, 2) not null default 0 check (credit >= 0),
  customer_id bigint references public.customers (id) on delete set null,
  constraint journal_lines_one_side check ((debit > 0) <> (credit > 0))
);
create index if not exists journal_lines_journal_idx on public.journal_lines (journal_id);
create index if not exists journal_lines_account_idx on public.journal_lines (account_id);

-- Debits must equal credits in every journal. Checked when the transaction commits, so it holds
-- however the lines were written.
create or replace function private.check_journal_balanced() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  jid bigint := coalesce(new.journal_id, old.journal_id);
  dr  numeric;
  cr  numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into dr, cr from public.journal_lines where journal_id = jid;
  if dr <> cr then
    raise exception 'Journal entry % does not balance: debits % and credits %', jid, dr, cr using errcode = '23514';
  end if;
  return null;
end $$;
drop trigger if exists journal_lines_balanced on public.journal_lines;
create constraint trigger journal_lines_balanced
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function private.check_journal_balanced();

-- -------------------------------------------------------------------------------------
-- Finance phase 2: suppliers, purchase invoices (bills), supplier credit notes, payment vouchers
-- -------------------------------------------------------------------------------------

alter table public.journals drop constraint if exists journals_kind_check;
alter table public.journals add constraint journals_kind_check check (kind in ('journal', 'adjustment', 'accrual', 'prepayment', 'opening',
  'invoice', 'payment', 'reversal', 'bank_receipt', 'bank_payment', 'transfer', 'bill', 'supplier_credit', 'supplier_payment', 'vat_settlement'));
alter table public.journals drop constraint if exists journals_source_type_check;
alter table public.journals add constraint journals_source_type_check check (source_type in ('invoice', 'payment', 'bill', 'supplier_payment'));

create table if not exists public.suppliers (
  id                         bigint generated always as identity primary key,
  name                       text not null check (char_length(btrim(name)) between 1 and 200),
  trn                        text check (trn ~ '^\d{15}$'),
  email                      text check (char_length(email) <= 200),
  phone                      text check (char_length(phone) <= 30),
  address                    text check (char_length(address) <= 500),
  country                    text default 'United Arab Emirates' check (char_length(country) <= 100),
  payment_terms_days         int not null default 30 check (payment_terms_days between 0 and 365),
  default_expense_account_id bigint references public.accounts (id) on delete set null,
  notes                      text check (char_length(notes) <= 2000),
  active                     boolean not null default true,
  created_at                 timestamptz not null default now()
);

alter table public.journal_lines add column if not exists supplier_id bigint references public.suppliers (id) on delete set null;

-- kind: bill (purchase invoice) or credit_note (from the supplier). supplier_ref is the supplier's own document number.
-- vat_total: VAT charged by the supplier; rcm_vat: VAT self-accounted under the reverse charge (not paid to the supplier).
create table if not exists public.bills (
  id               bigint generated always as identity primary key,
  kind             text not null check (kind in ('bill', 'credit_note')),
  number           text not null unique,
  supplier_id      bigint not null references public.suppliers (id) on delete restrict,
  supplier_ref     text not null check (char_length(btrim(supplier_ref)) between 1 and 60),
  bill_date        date not null,
  due_date         date,
  status           text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  notes            text check (char_length(notes) <= 1000),
  subtotal         numeric(14, 2) not null default 0,
  vat_total        numeric(14, 2) not null default 0,
  rcm_vat          numeric(14, 2) not null default 0,
  total            numeric(14, 2) not null default 0,
  amount_allocated numeric(14, 2) not null default 0,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  posted_at        timestamptz,
  cancelled_at     timestamptz
);
-- The same supplier document number can't be entered twice (cancelled ones don't count).
create unique index if not exists bills_supplier_ref_key on public.bills (supplier_id, kind, lower(btrim(supplier_ref))) where status <> 'cancelled';
create index if not exists bills_supplier_idx on public.bills (supplier_id);

create table if not exists public.bill_lines (
  id          bigint generated always as identity primary key,
  bill_id     bigint not null references public.bills (id) on delete cascade,
  position    int not null,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  account_id  bigint not null references public.accounts (id) on delete restrict,
  quantity    numeric(12, 3) not null check (quantity > 0),
  unit_price  numeric(14, 2) not null check (unit_price >= 0),
  vat_code    text not null check (vat_code in ('standard', 'zero', 'exempt', 'out_of_scope', 'reverse_charge', 'import_goods')),
  recoverable boolean not null default true,
  net         numeric(14, 2) not null,
  vat         numeric(14, 2) not null
);
create index if not exists bill_lines_bill_idx on public.bill_lines (bill_id);

-- Payment vouchers. Money not allocated to bills is an advance to the supplier.
create table if not exists public.supplier_payments (
  id          bigint generated always as identity primary key,
  number      text not null unique,
  supplier_id bigint not null references public.suppliers (id) on delete restrict,
  paid_on     date not null,
  amount      numeric(14, 2) not null check (amount > 0),
  method      text not null check (method in ('bank_transfer', 'cash', 'cheque', 'other')),
  account_id  bigint not null references public.accounts (id) on delete restrict,
  reference   text check (char_length(reference) <= 100),
  notes       text check (char_length(notes) <= 1000),
  status      text not null default 'posted' check (status in ('posted', 'void')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  voided_at   timestamptz
);
create index if not exists supplier_payments_supplier_idx on public.supplier_payments (supplier_id);

-- What settles a bill: a payment voucher or a supplier credit note, in full or in part.
create table if not exists public.bill_allocations (
  id             bigint generated always as identity primary key,
  bill_id        bigint not null references public.bills (id) on delete cascade,
  payment_id     bigint references public.supplier_payments (id) on delete cascade,
  credit_note_id bigint references public.bills (id) on delete cascade,
  amount         numeric(14, 2) not null check (amount > 0),
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  check ((payment_id is null) <> (credit_note_id is null))
);
create index if not exists bill_allocations_bill_idx on public.bill_allocations (bill_id);

-- -------------------------------------------------------------------------------------
-- Finance phase 3: customer credit notes, receipt vouchers, recurring invoices,
-- bank statement import and reconciliation, petty cash
-- -------------------------------------------------------------------------------------

alter table public.journals drop constraint if exists journals_kind_check;
alter table public.journals add constraint journals_kind_check check (kind in ('journal', 'adjustment', 'accrual', 'prepayment', 'opening',
  'invoice', 'payment', 'reversal', 'bank_receipt', 'bank_payment', 'transfer', 'bill', 'supplier_credit', 'supplier_payment', 'vat_settlement',
  'credit_note', 'receipt', 'petty_cash'));
alter table public.journals drop constraint if exists journals_source_type_check;
alter table public.journals add constraint journals_source_type_check check (source_type in ('invoice', 'payment', 'bill', 'supplier_payment',
  'credit_note', 'receipt', 'petty_cash'));

-- Tax credit notes to customers, always against one of our tax invoices. Customer and company details are
-- copied in when saved, like invoices. amount_applied: how much has been set against invoices.
create table if not exists public.credit_notes (
  id               bigint generated always as identity primary key,
  number           text not null unique,
  invoice_id       bigint not null references public.invoices (id) on delete restrict,
  customer_id      bigint references public.customers (id) on delete set null,
  customer_name    text not null,
  customer_address text,
  customer_trn     text,
  customer_email   text,
  supplier         jsonb not null default '{}',
  issue_date       date not null,
  reason           text not null check (char_length(btrim(reason)) between 1 and 500),
  notes            text check (char_length(notes) <= 1000),
  status           text not null default 'draft' check (status in ('draft', 'issued', 'cancelled')),
  subtotal         numeric(14, 2) not null default 0,
  vat_total        numeric(14, 2) not null default 0,
  total            numeric(14, 2) not null default 0,
  amount_applied   numeric(14, 2) not null default 0,
  sent_at          timestamptz,
  sent_to          text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  issued_at        timestamptz,
  cancelled_at     timestamptz
);
create index if not exists credit_notes_invoice_idx on public.credit_notes (invoice_id);
create index if not exists credit_notes_customer_idx on public.credit_notes (customer_id);

create table if not exists public.credit_note_lines (
  id             bigint generated always as identity primary key,
  credit_note_id bigint not null references public.credit_notes (id) on delete cascade,
  position       int not null,
  description    text not null check (char_length(btrim(description)) between 1 and 500),
  quantity       numeric(12, 3) not null check (quantity > 0),
  unit_price     numeric(14, 2) not null check (unit_price >= 0),
  vat_code       text not null check (vat_code in ('standard', 'zero', 'exempt', 'out_of_scope')),
  net            numeric(14, 2) not null,
  vat            numeric(14, 2) not null
);
create index if not exists credit_note_lines_cn_idx on public.credit_note_lines (credit_note_id);

-- Receipt vouchers: money received from a customer, set against one or more tax invoices; the rest
-- is held as an advance (customer advances) until set against a later invoice.
create table if not exists public.receipts (
  id            bigint generated always as identity primary key,
  number        text not null unique,
  customer_id   bigint not null references public.customers (id) on delete restrict,
  received_on   date not null,
  amount        numeric(14, 2) not null check (amount > 0),
  method        text not null check (method in ('bank_transfer', 'cash', 'cheque', 'other')),
  account_id    bigint not null references public.accounts (id) on delete restrict,
  reference     text check (char_length(reference) <= 100),
  cheque_bank   text check (char_length(cheque_bank) <= 100),
  cheque_date   date,
  cheque_status text check (cheque_status in ('pending', 'cleared', 'bounced')),
  notes         text check (char_length(notes) <= 1000),
  status        text not null default 'posted' check (status in ('posted', 'void')),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  constraint receipts_cheque_status_only_for_cheques check ((method = 'cheque') = (cheque_status is not null))
);
create index if not exists receipts_customer_idx on public.receipts (customer_id);

-- What settles a tax invoice besides direct payments: a receipt voucher or a credit note, in full or in part.
create table if not exists public.receivable_allocations (
  id             bigint generated always as identity primary key,
  invoice_id     bigint not null references public.invoices (id) on delete cascade,
  receipt_id     bigint references public.receipts (id) on delete cascade,
  credit_note_id bigint references public.credit_notes (id) on delete cascade,
  amount         numeric(14, 2) not null check (amount > 0),
  journal_id     bigint references public.journals (id) on delete set null,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  check ((receipt_id is null) <> (credit_note_id is null))
);
create index if not exists receivable_allocations_invoice_idx on public.receivable_allocations (invoice_id);
create index if not exists receivable_allocations_receipt_idx on public.receivable_allocations (receipt_id);
create index if not exists receivable_allocations_cn_idx on public.receivable_allocations (credit_note_id);

-- Recurring invoices: a template that creates a draft tax invoice every period.
-- lines: [{description, quantity, unit_price, vat_code}]; "{period}" in a description becomes e.g. "November 2026".
create table if not exists public.recurring_invoices (
  id              bigint generated always as identity primary key,
  customer_id     bigint not null references public.customers (id) on delete cascade,
  title           text not null check (char_length(btrim(title)) between 1 and 200),
  every_months    int not null check (every_months in (1, 2, 3, 6, 12)),
  next_date       date not null,
  end_date        date,
  due_days        int not null default 30 check (due_days between 0 and 365),
  lines           jsonb not null,
  notes           text check (char_length(notes) <= 2000),
  active          boolean not null default true,
  last_invoice_id bigint references public.invoices (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.invoices add column if not exists recurring_id bigint references public.recurring_invoices (id) on delete set null;

-- Bank statement lines imported from the bank's CSV. amount: + money in, - money out.
-- journal_line_id: the ledger line it was matched to (reconciled).
create table if not exists public.bank_imports (
  id          bigint generated always as identity primary key,
  account_id  bigint not null references public.accounts (id) on delete cascade,
  file_name   text check (char_length(file_name) <= 200),
  line_count  int not null default 0,
  skipped     int not null default 0,
  imported_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.bank_statement_lines (
  id              bigint generated always as identity primary key,
  account_id      bigint not null references public.accounts (id) on delete cascade,
  import_id       bigint references public.bank_imports (id) on delete cascade,
  txn_date        date not null,
  description     text not null check (char_length(description) <= 500),
  reference       text check (char_length(reference) <= 100),
  amount          numeric(14, 2) not null check (amount <> 0),
  balance         numeric(14, 2),
  journal_line_id bigint unique references public.journal_lines (id) on delete set null,
  matched_by      uuid references public.profiles (id) on delete set null,
  matched_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists bank_statement_lines_account_idx on public.bank_statement_lines (account_id, txn_date);

-- Petty cash spending (with input VAT where there's a valid tax receipt). Top-ups are bank transfers.
create table if not exists public.petty_cash_expenses (
  id                 bigint generated always as identity primary key,
  number             text not null unique,
  account_id         bigint not null references public.accounts (id) on delete restrict,
  spent_on           date not null,
  payee              text not null check (char_length(btrim(payee)) between 1 and 200),
  payee_trn          text check (payee_trn ~ '^\d{15}$'),
  description        text not null check (char_length(btrim(description)) between 1 and 500),
  expense_account_id bigint not null references public.accounts (id) on delete restrict,
  vat_code           text not null check (vat_code in ('standard', 'zero', 'exempt', 'out_of_scope')),
  recoverable        boolean not null default true,
  net                numeric(14, 2) not null check (net > 0),
  vat                numeric(14, 2) not null default 0,
  total              numeric(14, 2) not null,
  receipt_ref        text check (char_length(receipt_ref) <= 100),
  status             text not null default 'posted' check (status in ('posted', 'void')),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  voided_at          timestamptz
);
create index if not exists petty_cash_expenses_date_idx on public.petty_cash_expenses (spent_on);

-- -------------------------------------------------------------------------------------
-- Finance phase 4: departments and profitability tags, recurring journals,
-- accruals and prepayments schedules
-- -------------------------------------------------------------------------------------

alter table public.journals drop constraint if exists journals_source_type_check;
alter table public.journals add constraint journals_source_type_check check (source_type in ('invoice', 'payment', 'bill', 'supplier_payment',
  'credit_note', 'receipt', 'petty_cash', 'schedule'));

create table if not exists public.departments (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(btrim(name)) between 1 and 100),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists departments_name_key on public.departments (lower(name));

alter table public.work_types add column if not exists department_id bigint references public.departments (id) on delete set null;

-- Standard departments (on first install of this phase); linked to the standard types of work near the end of this file.
insert into public.departments (name)
select x from unnest(array['Freight forwarding', 'Customs clearance', 'Transport', 'PRO services', 'Administration']) x
where not exists (select 1 from public.departments);

-- Profitability tags on income and expense lines.
alter table public.journal_lines add column if not exists work_type_id bigint references public.work_types (id) on delete set null;
alter table public.journal_lines add column if not exists department_id bigint references public.departments (id) on delete set null;
create index if not exists journal_lines_customer_idx on public.journal_lines (customer_id) where customer_id is not null;

-- Optional tags on bills (a cost for a customer's job, a service, a department) and petty cash.
alter table public.bills add column if not exists customer_id bigint references public.customers (id) on delete set null;
alter table public.bills add column if not exists work_type_id bigint references public.work_types (id) on delete set null;
alter table public.bills add column if not exists department_id bigint references public.departments (id) on delete set null;
alter table public.petty_cash_expenses add column if not exists department_id bigint references public.departments (id) on delete set null;

-- Which accounts are what for the cash flow statement.
update public.accounts set system_key = 'accum_depreciation' where code = '1690' and system_key is null
  and not exists (select 1 from public.accounts where system_key = 'accum_depreciation');
update public.accounts set system_key = 'eosb' where code = '2400' and system_key is null
  and not exists (select 1 from public.accounts where system_key = 'eosb');

-- Recurring journals: the same entry every period (rent accrual, depreciation, standing orders...).
-- lines: [{account_id, debit, credit, description, customer_id}]; "{period}" in the memo becomes e.g. "November 2026".
create table if not exists public.recurring_journals (
  id              bigint generated always as identity primary key,
  memo            text not null check (char_length(btrim(memo)) between 1 and 500),
  reference       text check (char_length(reference) <= 100),
  every_months    int not null check (every_months in (1, 2, 3, 6, 12)),
  next_date       date not null,
  end_date        date,
  department_id   bigint references public.departments (id) on delete set null,
  lines           jsonb not null,
  active          boolean not null default true,
  last_journal_id bigint references public.journals (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.journals add column if not exists recurring_journal_id bigint references public.recurring_journals (id) on delete set null;

-- Prepayments (paid in advance, expensed month by month) and accruals (expense built up month by month
-- before the bill arrives). One posting per month at the month end.
create table if not exists public.schedules (
  id                 bigint generated always as identity primary key,
  kind               text not null check (kind in ('prepayment', 'accrual')),
  name               text not null check (char_length(btrim(name)) between 1 and 200),
  total              numeric(14, 2) not null check (total > 0),
  months             int not null check (months between 1 and 120),
  start_month        date not null check (extract(day from start_month) = 1),
  expense_account_id bigint not null references public.accounts (id) on delete restrict,
  balance_account_id bigint not null references public.accounts (id) on delete restrict,
  department_id      bigint references public.departments (id) on delete set null,
  notes              text check (char_length(notes) <= 1000),
  active             boolean not null default true,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);
create table if not exists public.schedule_postings (
  id          bigint generated always as identity primary key,
  schedule_id bigint not null references public.schedules (id) on delete cascade,
  period      date not null,
  amount      numeric(14, 2) not null,
  journal_id  bigint references public.journals (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (schedule_id, period)
);

-- Running totals on each invoice, kept up to date by private.refresh_invoice_payments().
alter table public.invoices add column if not exists amount_paid numeric(14, 2) not null default 0;
alter table public.invoices add column if not exists payment_reminded_at timestamptz;
alter table public.invoices add column if not exists payment_reminded_to text;

-- Invoices marked "paid" before payments were recorded get one payment for the full amount, so balances add up.
insert into public.payments (invoice_id, amount, method, paid_on, notes)
select i.id, i.total, 'other', coalesce(i.paid_at, i.updated_at)::date, 'Marked as paid before payments were recorded'
from public.invoices i
where i.status = 'paid' and i.total > 0 and not exists (select 1 from public.payments p where p.invoice_id = i.id);
update public.invoices i set amount_paid = coalesce((
  select sum(p.amount) from public.payments p where p.invoice_id = i.id and p.cheque_status is distinct from 'bounced'), 0);

-- Kinds of recurring service (VAT return every 3 months, trade license every year, ...).
create table if not exists public.renewal_types (
  id              bigint generated always as identity primary key,
  name            text not null check (char_length(btrim(name)) between 1 and 100),
  interval_months int  not null default 12 check (interval_months between 1 and 120),
  remind_days     int  not null default 30 check (remind_days between 0 and 365),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index if not exists renewal_types_name_key on public.renewal_types (lower(name));

insert into public.renewal_types (name, interval_months, remind_days)
select x.name, x.months, x.days
from (values ('VAT return filing', 3, 15), ('Trade license renewal', 12, 30), ('Residence visa renewal', 24, 30),
             ('Emirates ID renewal', 24, 30), ('Corporate tax return', 12, 30), ('Other', 12, 30)) as x(name, months, days)
where not exists (select 1 from public.renewal_types);

-- A customer's recurring service, e.g. "Trade license renewal" for "License no. 12345", next due 2027-01-15.
create table if not exists public.renewals (
  id               bigint generated always as identity primary key,
  customer_id      bigint not null references public.customers (id) on delete cascade,
  type_id          bigint references public.renewal_types (id) on delete set null,
  reference        text check (char_length(reference) <= 200),
  interval_months  int  not null check (interval_months between 1 and 120),
  due_date         date not null,
  remind_days      int  not null check (remind_days between 0 and 365),
  assigned_to      uuid references public.profiles (id) on delete set null,
  notes            text check (char_length(notes) <= 2000),
  active           boolean not null default true,
  last_reminded_at timestamptz,
  last_reminded_to text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists renewals_customer_idx on public.renewals (customer_id);
create index if not exists renewals_due_idx      on public.renewals (due_date) where active;

-- History of a renewal: created, reminded, renewed (with old and new due dates), task created.
create table if not exists public.renewal_events (
  id         bigint generated always as identity primary key,
  renewal_id bigint not null references public.renewals (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  kind       text not null check (kind in ('created', 'reminded', 'renewed', 'task', 'stopped', 'restarted')),
  body       text check (char_length(body) <= 2000),
  old_due    date,
  new_due    date,
  created_at timestamptz not null default now()
);
create index if not exists renewal_events_renewal_idx on public.renewal_events (renewal_id);

-- Tasks can be started from a renewal.
alter table public.tasks add column if not exists renewal_id bigint references public.renewals (id) on delete set null;

-- Databases set up before managers existed: allow the new role.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'manager', 'staff', 'employee'));

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
alter table public.company_settings enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.invoices         enable row level security;
alter table public.invoice_lines    enable row level security;
alter table public.renewal_types    enable row level security;
alter table public.renewals         enable row level security;
alter table public.renewal_events   enable row level security;
alter table public.payments         enable row level security;
alter table public.employees        enable row level security;
alter table public.attendance       enable row level security;
alter table public.leave_requests   enable row level security;
alter table public.payslips         enable row level security;
alter table public.accounts         enable row level security;
alter table public.journals         enable row level security;
alter table public.journal_lines    enable row level security;
alter table public.suppliers         enable row level security;
alter table public.bills             enable row level security;
alter table public.bill_lines        enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.bill_allocations  enable row level security;
alter table public.credit_notes           enable row level security;
alter table public.credit_note_lines      enable row level security;
alter table public.receipts               enable row level security;
alter table public.receivable_allocations enable row level security;
alter table public.recurring_invoices     enable row level security;
alter table public.bank_imports           enable row level security;
alter table public.bank_statement_lines   enable row level security;
alter table public.petty_cash_expenses    enable row level security;
alter table public.departments            enable row level security;
alter table public.recurring_journals     enable row level security;
alter table public.schedules              enable row level security;
alter table public.schedule_postings      enable row level security;
revoke all on public.profiles, public.customers, public.contacts, public.activities,
              public.work_types, public.tasks, public.task_updates,
              public.company_settings, public.invoice_counters, public.invoices, public.invoice_lines,
              public.renewal_types, public.renewals, public.renewal_events, public.payments,
              public.employees, public.attendance, public.leave_requests, public.payslips,
              public.accounts, public.journals, public.journal_lines,
              public.suppliers, public.bills, public.bill_lines, public.supplier_payments, public.bill_allocations,
              public.credit_notes, public.credit_note_lines, public.receipts, public.receivable_allocations, public.recurring_invoices,
              public.bank_imports, public.bank_statement_lines, public.petty_cash_expenses,
              public.departments, public.recurring_journals, public.schedules, public.schedule_postings
  from public, anon, authenticated;

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

-- The caller's profile; raises unless they are signed in and approved. Used by the HR functions,
-- which every role (including "employee") can use.
create or replace function private.current_person() returns public.profiles
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

-- Like current_person, but for the business side of the ERP (customers, tasks, invoices, ...):
-- accounts with the "employee" role only have access to HR.
create or replace function private.current_member() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_person();
begin
  if me.role = 'employee' then
    raise exception 'Your account has access to HR only' using errcode = '42501';
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
                        where status in ('new', 'in_progress', 'waiting') and assigned_to is null),
    -- Finished tasks for a customer that have no tax invoice yet (for managers to invoice).
    'toInvoice', coalesce((
      select json_agg(x order by x.completed_at desc nulls last, x.id desc) from (
        select t2.id, t2.title, t2.completed_at, c.name as customer_name
        from public.tasks t2 join public.customers c on c.id = t2.customer_id
        where t2.status = 'done'
          and not exists (select 1 from public.invoices i
                          where i.task_id = t2.id and i.kind = 'tax' and i.status <> 'cancelled')
        order by t2.completed_at desc nulls last, t2.id desc limit 10) x), '[]'),
    'unpaid', (select json_build_object('count', count(*), 'total', coalesce(sum(total - amount_paid), 0))
               from public.invoices where kind = 'tax' and status = 'sent' and total > amount_paid),
    -- Money owed on sent tax invoices; overdue = past the payment due date.
    'receivables', (select json_build_object(
        'outstanding', coalesce(sum(total - amount_paid), 0),
        'overdue', coalesce(sum(total - amount_paid) filter (where due_date < t), 0),
        'overdueCount', count(*) filter (where due_date < t))
      from public.invoices where kind = 'tax' and status = 'sent' and total > amount_paid),
    'overdueInvoices', coalesce((
      select json_agg(x order by x.due_date, x.id) from (
        select i.id, i.number, i.customer_id, i.customer_name, i.due_date, i.total, i.amount_paid,
               i.total - i.amount_paid as balance, i.payment_reminded_at
        from public.invoices i
        where i.kind = 'tax' and i.status = 'sent' and i.total > i.amount_paid and i.due_date < t
        order by i.due_date, i.id limit 10) x), '[]'),
    -- Active renewals inside their reminder window (or overdue), soonest first.
    'renewalsDue', coalesce((
      select json_agg(x order by x.due_date, x.id) from (
        select r.id, r.reference, r.due_date, r.last_reminded_at, r.customer_id, c.name as customer_name,
               rt.name as type_name, u.name as assignee_name
        from public.renewals r
        join public.customers c on c.id = r.customer_id
        left join public.renewal_types rt on rt.id = r.type_id
        left join public.profiles u on u.id = r.assigned_to
        where r.active and r.due_date - r.remind_days <= t
        order by r.due_date, r.id limit 15) x), '[]'),
    'renewalsDueCount', (select count(*) from public.renewals r where r.active and r.due_date - r.remind_days <= t),
    'renewalsOverdue', (select count(*) from public.renewals r where r.active and r.due_date < t)
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
        where t.customer_id = c.id), '[]'),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
            'issue_date', i.issue_date, 'total', i.total, 'amount_paid', i.amount_paid)
          order by i.issue_date desc, i.id desc)
        from public.invoices i where i.customer_id = c.id), '[]'),
      'balance', (
        select jsonb_build_object(
          'outstanding', coalesce(sum(i.total - i.amount_paid), 0),
          'overdue', coalesce(sum(i.total - i.amount_paid) filter (where i.due_date < private.today()), 0))
        from public.invoices i
        where i.customer_id = c.id and i.kind = 'tax' and i.status = 'sent' and i.total > i.amount_paid),
      'renewals', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', r.id, 'reference', r.reference, 'due_date', r.due_date, 'active', r.active,
            'remind_days', r.remind_days, 'type_name', rt.name, 'interval_months', r.interval_months)
          order by not r.active, r.due_date, r.id)
        from public.renewals r left join public.renewal_types rt on rt.id = r.type_id
        where r.customer_id = c.id), '[]')))
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
  if exists (select 1 from public.receipts where customer_id = p_id) then
    raise exception 'This customer has receipt vouchers, so it can''t be deleted. Set it to inactive instead.' using errcode = '22023';
  end if;
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
      "role": {"type": "enum", "required": true, "values": ["admin", "manager", "staff", "employee"]}}');
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
        where x.task_id = t.id), '[]'),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', i.id, 'kind', i.kind, 'number', i.number, 'status', i.status, 'due_date', i.due_date,
            'issue_date', i.issue_date, 'total', i.total, 'amount_paid', i.amount_paid)
          order by i.created_at, i.id)
        from public.invoices i where i.task_id = t.id), '[]')))
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
      'id', w.id, 'name', w.name, 'active', w.active, 'revenue_account_id', w.revenue_account_id, 'department_id', w.department_id,
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
-- API: company settings and invoices
-- -------------------------------------------------------------------------------------

create or replace function public.get_company_settings() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  return (select to_json(s) from public.company_settings s where id = 1);
end $$;

create or replace function public.save_company_settings(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_admin();
  d  jsonb := private.clean(p_data, '{
    "legal_name":         {"type": "text", "required": true, "max": 200},
    "address":            {"type": "text", "max": 500},
    "phone":              {"type": "text", "max": 50},
    "email":              {"type": "text", "max": 200, "format": "email"},
    "trn":                {"type": "text", "format": "trn"},
    "bank_name":          {"type": "text", "max": 200},
    "account_name":       {"type": "text", "max": 200},
    "iban":               {"type": "text", "max": 50},
    "swift":              {"type": "text", "max": 20},
    "payment_terms_days": {"type": "int"},
    "invoice_notes":      {"type": "text", "max": 2000}
  }');
begin
  if coalesce((d ->> 'payment_terms_days')::int, 0) > 365 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = '{"payment_terms_days": "Use 0 to 365 days"}';
  end if;
  update public.company_settings set
    legal_name = d ->> 'legal_name', address = d ->> 'address', phone = d ->> 'phone', email = d ->> 'email',
    trn = d ->> 'trn', bank_name = d ->> 'bank_name', account_name = d ->> 'account_name',
    iban = upper(replace(d ->> 'iban', ' ', '')), swift = upper(d ->> 'swift'),
    payment_terms_days = coalesce((d ->> 'payment_terms_days')::int, 30),
    invoice_notes = d ->> 'invoice_notes', updated_at = now()
  where id = 1;
end $$;

-- Next number for an invoice type in a year, e.g. INV-2026-0007. Never reused, even if an invoice is cancelled.
create or replace function private.next_invoice_number(p_kind text, p_date date) returns text
language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from p_date)::int;
  n int;
begin
  insert into public.invoice_counters (kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = public.invoice_counters.last + 1
  returning last into n;
  return format('%s-%s-%s', case p_kind when 'tax' then 'INV' else 'PRO' end, y, lpad(n::text, 4, '0'));
end $$;

-- Create (p_id null) or edit a draft invoice. Managers and admins only. Returns its id.
-- p_data: kind ('proforma' | 'tax', only on create), task_id, customer_id, proforma_id, issue_date,
--         due_date, supply_date, notes, lines: [{description, quantity, unit_price, vat_code}]
create or replace function public.save_invoice(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  d     jsonb := private.clean(p_data, '{
    "kind":        {"type": "enum", "values": ["proforma", "tax"], "default": "proforma"},
    "task_id":     {"type": "int"},
    "customer_id": {"type": "int", "required": true},
    "proforma_id": {"type": "int"},
    "issue_date":  {"type": "date", "required": true},
    "due_date":    {"type": "date"},
    "supply_date": {"type": "date"},
    "notes":       {"type": "text", "max": 2000}
  }');
  v_old     public.invoices;
  v_kind    text;
  v_id      bigint;
  cust      public.customers;
  co        public.company_settings;
  lines     jsonb := p_data -> 'lines';
  ln        jsonb;
  i         int := 0;
  qty       numeric;
  price     numeric;
  net       numeric;
  vat       numeric;
  sub_total numeric := 0;
  vat_sum   numeric := 0;
  errs      jsonb := '{}';
  line_errs text[] := '{}';
  clean_lines jsonb := '[]';
begin
  if p_id is not null then
    select * into v_old from public.invoices where id = p_id;
    if v_old.id is null then
      raise exception 'Invoice not found' using errcode = 'P0002';
    end if;
    if v_old.status <> 'draft' then
      raise exception 'This invoice has already been sent, so it can''t be changed. Cancel it and create a new one instead.'
        using errcode = '22023';
    end if;
    v_kind := v_old.kind;
  else
    v_kind := d ->> 'kind';
  end if;

  select * into cust from public.customers where id = (d ->> 'customer_id')::bigint;
  if cust.id is null and d ->> 'customer_id' is not null then
    errs := errs || '{"customer_id": "Pick a customer from the list"}';
  end if;
  if d ->> 'task_id' is not null and not exists (select 1 from public.tasks where id = (d ->> 'task_id')::bigint) then
    errs := errs || '{"task_id": "Task not found"}';
  end if;
  if d ->> 'proforma_id' is not null and not exists (
       select 1 from public.invoices where id = (d ->> 'proforma_id')::bigint and kind = 'proforma') then
    errs := errs || '{"proforma_id": "Proforma invoice not found"}';
  end if;
  if (d ->> 'due_date')::date < (d ->> 'issue_date')::date then
    errs := errs || '{"due_date": "Can''t be before the invoice date"}';
  end if;

  select * into co from public.company_settings where id = 1;
  if v_kind = 'tax' and co.trn is null then
    raise exception 'Add Lowcaps'' TRN under Company settings before creating a tax invoice' using errcode = '22023';
  end if;

  -- Lines
  if lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    errs := errs || '{"lines": "Add at least one charge"}';
  elsif jsonb_array_length(lines) > 100 then
    errs := errs || '{"lines": "At most 100 lines"}';
  else
    for ln in select value from jsonb_array_elements(lines) loop
      i := i + 1;
      begin
        qty := nullif(btrim(ln ->> 'quantity'), '')::numeric;
        price := nullif(btrim(ln ->> 'unit_price'), '')::numeric;
      exception when others then
        line_errs := line_errs || format('Line %s: quantity and price must be numbers', i);
        continue;
      end;
      if nullif(btrim(ln ->> 'description'), '') is null then
        line_errs := line_errs || format('Line %s: add a description', i);
      elsif char_length(btrim(ln ->> 'description')) > 500 then
        line_errs := line_errs || format('Line %s: description is too long', i);
      elsif qty is null or qty <= 0 or qty >= 1000000000 or scale(qty) > 3 then
        line_errs := line_errs || format('Line %s: quantity must be more than 0', i);
      elsif price is null or price < 0 or price >= 1000000000000 or scale(price) > 2 then
        line_errs := line_errs || format('Line %s: price must be 0 or more, with at most 2 decimals', i);
      elsif coalesce(ln ->> 'vat_code', '') not in ('standard', 'zero', 'exempt', 'out_of_scope') then
        line_errs := line_errs || format('Line %s: pick a VAT treatment', i);
      else
        net := round(qty * price, 2);
        vat := case when ln ->> 'vat_code' = 'standard' then round(net * 0.05, 2) else 0 end;
        sub_total := sub_total + net;
        vat_sum := vat_sum + vat;
        clean_lines := clean_lines || jsonb_build_object('description', btrim(ln ->> 'description'), 'quantity', qty,
          'unit_price', price, 'vat_code', ln ->> 'vat_code', 'net', net, 'vat', vat);
      end if;
    end loop;
    if array_length(line_errs, 1) > 0 then
      errs := errs || jsonb_build_object('lines', array_to_string(line_errs, '. '));
    end if;
  end if;

  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  if p_id is null then
    insert into public.invoices (kind, number, task_id, customer_id, proforma_id, issue_date, due_date, supply_date,
                                 customer_name, customer_address, customer_trn, customer_email, supplier, notes,
                                 subtotal, vat_total, total, created_by)
    values (v_kind, private.next_invoice_number(v_kind, (d ->> 'issue_date')::date),
            (d ->> 'task_id')::bigint, cust.id, (d ->> 'proforma_id')::bigint, (d ->> 'issue_date')::date,
            (d ->> 'due_date')::date, (d ->> 'supply_date')::date,
            cust.name, concat_ws(E'\n', cust.address, cust.city, cust.country), cust.trn, cust.email,
            to_jsonb(co) - 'id' - 'updated_at', d ->> 'notes', sub_total, vat_sum, sub_total + vat_sum, me.id)
    returning id into v_id;
    -- Advance payments taken against the proforma now count towards the tax invoice.
    if v_kind = 'tax' and d ->> 'proforma_id' is not null then
      update public.payments set invoice_id = v_id where invoice_id = (d ->> 'proforma_id')::bigint;
      perform private.refresh_invoice_payments((d ->> 'proforma_id')::bigint);
      perform private.refresh_invoice_payments(v_id);
      if (select amount_paid from public.invoices where id = v_id) > sub_total + vat_sum then
        raise exception 'Please fix the highlighted fields' using errcode = '22023',
          detail = format('{"lines": "The total can''t be less than the AED %s already paid on the proforma"}',
                          to_char((select amount_paid from public.invoices where id = v_id), 'FM999,999,999,990.00'));
      end if;
    end if;
  else
    if v_old.amount_paid > sub_total + vat_sum then
      raise exception 'Please fix the highlighted fields' using errcode = '22023',
        detail = format('{"lines": "The total can''t be less than the AED %s already paid"}',
                        to_char(v_old.amount_paid, 'FM999,999,999,990.00'));
    end if;
    v_id := p_id;
    update public.invoices set
      task_id = (d ->> 'task_id')::bigint, customer_id = cust.id, proforma_id = (d ->> 'proforma_id')::bigint,
      issue_date = (d ->> 'issue_date')::date, due_date = (d ->> 'due_date')::date, supply_date = (d ->> 'supply_date')::date,
      customer_name = cust.name, customer_address = concat_ws(E'\n', cust.address, cust.city, cust.country),
      customer_trn = cust.trn, customer_email = cust.email, supplier = to_jsonb(co) - 'id' - 'updated_at',
      notes = d ->> 'notes', subtotal = sub_total, vat_total = vat_sum, total = sub_total + vat_sum, updated_at = now()
    where id = v_id;
    delete from public.invoice_lines where invoice_id = v_id;
  end if;

  insert into public.invoice_lines (invoice_id, position, description, quantity, unit_price, vat_code, net, vat)
  select v_id, x.ord, x.l ->> 'description', (x.l ->> 'quantity')::numeric, (x.l ->> 'unit_price')::numeric,
         x.l ->> 'vat_code', (x.l ->> 'net')::numeric, (x.l ->> 'vat')::numeric
  from jsonb_array_elements(clean_lines) with ordinality as x(l, ord);

  if d ->> 'task_id' is not null then
    insert into public.task_updates (task_id, user_id, kind, body)
    select (d ->> 'task_id')::bigint, me.id, 'comment',
           format('%s %s %s (AED %s)', case when p_id is null then 'Created' else 'Updated' end,
                  case v_kind when 'tax' then 'tax invoice' else 'proforma invoice' end,
                  (select number from public.invoices where id = v_id), to_char(sub_total + vat_sum, 'FM999,999,999,990.00'));
  end if;
  return v_id;
end $$;

create or replace function public.get_invoice(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_member();
  result json;
begin
  select json_build_object(
    'today', private.today(),
    'invoice', to_jsonb(i) || jsonb_build_object(
      'task_title', t.title,
      'task_status', t.status,
      'proforma_number', p.number,
      'created_by_name', u.name,
      'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from public.invoice_lines l
                         where l.invoice_id = i.id), '[]'),
      'payments', coalesce((select jsonb_agg(to_jsonb(pm) || jsonb_build_object('recorded_by_name', pu.name,
                                               'account_name', (select name from public.accounts where id = pm.account_id))
                                             order by pm.paid_on desc, pm.id desc)
                            from public.payments pm left join public.profiles pu on pu.id = pm.recorded_by
                            where pm.invoice_id = i.id), '[]'),
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'created_at', a.created_at,
                                 'receipt_id', a.receipt_id, 'credit_note_id', a.credit_note_id,
                                 'source', coalesce((select number from public.receipts where id = a.receipt_id),
                                                    (select number from public.credit_notes where id = a.credit_note_id))) order by a.id)
                               from public.receivable_allocations a where a.invoice_id = i.id), '[]'),
      'credit_notes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'issue_date', c.issue_date,
                                  'status', c.status, 'total', c.total) order by c.id)
                                from public.credit_notes c where c.invoice_id = i.id), '[]'),
      'open_credits', case when i.kind = 'tax' and i.status = 'sent' and i.total > i.amount_paid
                           then private.customer_open_credits(i.customer_id) else '[]'::jsonb end,
      -- Email addresses the invoice could go to: the customer's, then its contacts' (main contact first).
      'recipients', coalesce((
        select jsonb_agg(distinct_emails.email order by distinct_emails.rank, distinct_emails.email) from (
          select lower(e.email) as email, min(e.rank) as rank from (
            select c.email, 0 as rank from public.customers c where c.id = i.customer_id and c.email is not null
            union all
            select k.email, case when k.is_primary then 1 else 2 end from public.contacts k
            where k.customer_id = i.customer_id and k.email is not null) e
          group by lower(e.email)) distinct_emails), '[]')))
  into result
  from public.invoices i
  left join public.tasks t    on t.id = i.task_id
  left join public.invoices p on p.id = i.proforma_id
  left join public.profiles u on u.id = i.created_by
  where i.id = p_id;
  if result is null then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- kind: '' | 'proforma' | 'tax'; status: '' | 'draft' | 'sent' | 'paid' | 'cancelled' | 'unpaid' (sent, not paid)
create or replace function public.list_invoices(
  p_q text default null, p_kind text default null, p_status text default null, p_page int default 1
) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me        public.profiles := private.current_member();
  page_size constant int := 25;
  pg        int := greatest(coalesce(p_page, 1), 1);
  pat       text;
  total     bigint;
  v_rows    json;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with f as (
    select i.* from public.invoices i
    left join public.tasks t on t.id = i.task_id
    where (pat is null or i.number ilike pat or i.customer_name ilike pat or t.title ilike pat)
      and (coalesce(p_kind, '') not in ('proforma', 'tax') or i.kind = p_kind)
      and (case coalesce(p_status, '')
             when 'unpaid' then i.status = 'sent' and i.total > i.amount_paid
             when 'partial' then i.status = 'sent' and i.amount_paid > 0 and i.total > i.amount_paid
             when 'overdue' then i.kind = 'tax' and i.status = 'sent' and i.total > i.amount_paid and i.due_date < private.today()
             when '' then true
             else i.status = p_status
           end)
  )
  select (select count(*) from f),
         coalesce((select json_agg(x order by x.issue_date desc, x.id desc) from (
           select f.id, f.kind, f.number, f.status, f.issue_date, f.due_date, f.customer_id, f.customer_name,
                  f.task_id, t.title as task_title, f.total, f.amount_paid, f.sent_at
           from f left join public.tasks t on t.id = f.task_id
           order by f.issue_date desc, f.id desc
           limit page_size offset (pg - 1) * page_size) x), '[]')
  into total, v_rows;

  return json_build_object('invoices', v_rows, 'total', total, 'page', pg, 'pageSize', page_size,
                           'today', private.today());
end $$;

-- Record that the invoice was emailed (after the manager sent it from their own mailbox).
create or replace function public.mark_invoice_sent(p_id bigint, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_id;
  if inv.id is null then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if inv.status = 'cancelled' then
    raise exception 'This invoice is cancelled' using errcode = '22023';
  end if;
  update public.invoices set status = case when status = 'draft' then 'sent' else status end,
    sent_at = now(), sent_to = left(nullif(btrim(p_to), ''), 500), updated_at = now()
  where id = p_id;
  perform private.refresh_invoice_payments(p_id);
  perform private.post_invoice(p_id);
  if inv.task_id is not null then
    insert into public.task_updates (task_id, user_id, kind, body)
    values (inv.task_id, me.id, 'comment',
            format('Sent %s %s to %s', case inv.kind when 'tax' then 'tax invoice' else 'proforma invoice' end,
                   inv.number, coalesce(nullif(btrim(p_to), ''), 'the customer')));
  end if;
end $$;

-- Kept for older versions of the ERP pages: invoices are now paid by recording payments.
create or replace function public.set_invoice_paid(p_id bigint, p_paid boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  raise exception 'Use "Record payment" on the invoice instead (refresh the page to get the latest version)' using errcode = '22023';
end $$;

-- Invoices are never deleted (their numbers must stay in sequence); they are cancelled instead.
create or replace function public.cancel_invoice(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  if exists (select 1 from public.payments where invoice_id = p_id) then
    raise exception 'This invoice has payments recorded. Delete them first if the invoice really is to be cancelled.' using errcode = '22023';
  end if;
  if exists (select 1 from public.receivable_allocations where invoice_id = p_id) then
    raise exception 'Receipts or credit notes are set against this invoice. Remove them first.' using errcode = '22023';
  end if;
  if exists (select 1 from public.credit_notes where invoice_id = p_id and status <> 'cancelled') then
    raise exception 'This invoice has a credit note. Cancel the credit note first.' using errcode = '22023';
  end if;
  update public.invoices set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = p_id and status <> 'cancelled';
  if found then
    perform private.unpost_invoice(p_id, me.id);
    return;
  end if;
  if not found and not exists (select 1 from public.invoices where id = p_id) then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- API: renewals (recurring services per customer)
-- -------------------------------------------------------------------------------------

create or replace function public.list_renewal_types() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  return coalesce((select json_agg(json_build_object(
      'id', rt.id, 'name', rt.name, 'interval_months', rt.interval_months, 'remind_days', rt.remind_days, 'active', rt.active,
      'renewals', (select count(*) from public.renewals r where r.type_id = rt.id and r.active))
    order by not rt.active, lower(rt.name)) from public.renewal_types rt), '[]');
end $$;

-- Add (p_id null) or edit a renewal type. Managers and admins only.
create or replace function public.save_renewal_type(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_manager();
  d    jsonb := private.clean(p_data, '{
    "name":            {"type": "text", "required": true, "max": 100},
    "interval_months": {"type": "int", "required": true},
    "remind_days":     {"type": "int", "required": true},
    "active":          {"type": "bool"}
  }');
  errs jsonb := '{}';
  v_id bigint;
begin
  if (d ->> 'interval_months')::int not between 1 and 120 then errs := errs || '{"interval_months": "Use 1 to 120 months"}'; end if;
  if (d ->> 'remind_days')::int > 365 then errs := errs || '{"remind_days": "Use 0 to 365 days"}'; end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  begin
    if p_id is null then
      insert into public.renewal_types (name, interval_months, remind_days, active)
      values (d ->> 'name', (d ->> 'interval_months')::int, (d ->> 'remind_days')::int, coalesce((p_data ->> 'active')::boolean, true))
      returning id into v_id;
      return v_id;
    end if;
    update public.renewal_types set name = d ->> 'name', interval_months = (d ->> 'interval_months')::int,
      remind_days = (d ->> 'remind_days')::int, active = (d ->> 'active')::boolean
    where id = p_id;
    if not found then
      raise exception 'Renewal type not found' using errcode = 'P0002';
    end if;
    return p_id;
  exception when unique_violation then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = '{"name": "This renewal type already exists"}';
  end;
end $$;

-- window: 'due' (inside the reminder window or overdue, the default), 'overdue', '30', '90' (due within N days),
--         'all' (all active), 'stopped'. assignee: '' | 'me' | 'none' | user id.
create or replace function public.list_renewals(
  p_q text default null, p_window text default 'due', p_type bigint default null,
  p_assignee text default null, p_page int default 1
) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me         public.profiles := private.current_member();
  t          date := private.today();
  page_size  constant int := 25;
  pg         int := greatest(coalesce(p_page, 1), 1);
  win        text := coalesce(nullif(p_window, ''), 'due');
  pat        text;
  v_assignee uuid;
  total      bigint;
  v_rows     json;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if p_assignee ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_assignee := p_assignee::uuid;
  elsif p_assignee = 'me' then
    v_assignee := me.id;
  end if;

  with f as (
    select r.*, c.name as customer_name, rt.name as type_name, u.name as assignee_name
    from public.renewals r
    join public.customers c on c.id = r.customer_id
    left join public.renewal_types rt on rt.id = r.type_id
    left join public.profiles u on u.id = r.assigned_to
    where (pat is null or c.name ilike pat or r.reference ilike pat or rt.name ilike pat)
      and (case win
             when 'stopped' then not r.active
             when 'all' then r.active
             when 'overdue' then r.active and r.due_date < t
             when '30' then r.active and r.due_date <= t + 30
             when '90' then r.active and r.due_date <= t + 90
             else r.active and r.due_date - r.remind_days <= t
           end)
      and (p_type is null or r.type_id = p_type)
      and (case
             when v_assignee is not null then r.assigned_to = v_assignee
             when p_assignee = 'none' then r.assigned_to is null
             else true
           end)
  )
  select (select count(*) from f),
         coalesce((select json_agg(x order by x.due_date, x.id) from (
           select f.id, f.customer_id, f.customer_name, f.type_id, f.type_name, f.reference, f.due_date, f.remind_days,
                  f.interval_months, f.active, f.assigned_to, f.assignee_name, f.last_reminded_at
           from f order by f.due_date, f.id
           limit page_size offset (pg - 1) * page_size) x), '[]')
  into total, v_rows;

  return json_build_object('renewals', v_rows, 'total', total, 'page', pg, 'pageSize', page_size, 'today', t);
end $$;

create or replace function public.get_renewal(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_member();
  result json;
begin
  select json_build_object(
    'today', private.today(),
    'renewal', to_jsonb(r) || jsonb_build_object(
      'customer_name', c.name,
      'type_name', rt.name,
      'assignee_name', u.name,
      'created_by_name', cb.name,
      'events', coalesce((
        select jsonb_agg(to_jsonb(e) || jsonb_build_object('user_name', eu.name) order by e.created_at desc, e.id desc)
        from public.renewal_events e left join public.profiles eu on eu.id = e.user_id
        where e.renewal_id = r.id), '[]'),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object('id', tk.id, 'title', tk.title, 'status', tk.status, 'due_date', tk.due_date)
          order by tk.created_at desc)
        from public.tasks tk where tk.renewal_id = r.id), '[]'),
      'recipients', coalesce((
        select jsonb_agg(e.email order by e.rank, e.email) from (
          select lower(x.email) as email, min(x.rank) as rank from (
            select c.email, 0 as rank where c.email is not null
            union all
            select k.email, case when k.is_primary then 1 else 2 end from public.contacts k
            where k.customer_id = c.id and k.email is not null) x
          group by lower(x.email)) e), '[]')))
  into result
  from public.renewals r
  join public.customers c on c.id = r.customer_id
  left join public.renewal_types rt on rt.id = r.type_id
  left join public.profiles u on u.id = r.assigned_to
  left join public.profiles cb on cb.id = r.created_by
  where r.id = p_id;
  if result is null then
    raise exception 'Renewal not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- Add (p_id null) or edit a renewal. Anyone with access can (like customers).
-- Repeat period and reminder days default to the renewal type's when left empty.
create or replace function public.save_renewal(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_member();
  d     jsonb := private.clean(p_data, '{
    "customer_id":     {"type": "int", "required": true},
    "type_id":         {"type": "int", "required": true},
    "reference":       {"type": "text", "max": 200},
    "due_date":        {"type": "date", "required": true},
    "interval_months": {"type": "int"},
    "remind_days":     {"type": "int"},
    "assigned_to":     {"type": "uuid"},
    "notes":           {"type": "text", "max": 2000}
  }');
  rt    public.renewal_types;
  v_old public.renewals;
  errs  jsonb := '{}';
  v_id  bigint;
  months int;
  days   int;
begin
  if p_id is not null then
    select * into v_old from public.renewals where id = p_id;
    if v_old.id is null then
      raise exception 'Renewal not found' using errcode = 'P0002';
    end if;
  end if;
  select * into rt from public.renewal_types where id = (d ->> 'type_id')::bigint;
  if rt.id is null or (not rt.active and rt.id is distinct from v_old.type_id) then
    errs := errs || '{"type_id": "Pick a renewal type from the list"}';
  end if;
  if not exists (select 1 from public.customers where id = (d ->> 'customer_id')::bigint) then
    errs := errs || '{"customer_id": "Pick a customer from the list"}';
  end if;
  if d ->> 'assigned_to' is not null and (d ->> 'assigned_to')::uuid is distinct from v_old.assigned_to
     and not exists (select 1 from public.profiles where id = (d ->> 'assigned_to')::uuid and active) then
    errs := errs || '{"assigned_to": "Pick a team member who has access"}';
  end if;
  months := coalesce((d ->> 'interval_months')::int, rt.interval_months);
  days := coalesce((d ->> 'remind_days')::int, rt.remind_days);
  if months not between 1 and 120 then errs := errs || '{"interval_months": "Use 1 to 120 months"}'; end if;
  if days > 365 then errs := errs || '{"remind_days": "Use 0 to 365 days"}'; end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  if p_id is null then
    insert into public.renewals (customer_id, type_id, reference, interval_months, due_date, remind_days, assigned_to, notes, created_by)
    values ((d ->> 'customer_id')::bigint, rt.id, d ->> 'reference', months, (d ->> 'due_date')::date, days,
            (d ->> 'assigned_to')::uuid, d ->> 'notes', me.id)
    returning id into v_id;
    insert into public.renewal_events (renewal_id, user_id, kind, new_due)
    values (v_id, me.id, 'created', (d ->> 'due_date')::date);
    return v_id;
  end if;

  update public.renewals set customer_id = (d ->> 'customer_id')::bigint, type_id = rt.id, reference = d ->> 'reference',
    interval_months = months, due_date = (d ->> 'due_date')::date, remind_days = days,
    assigned_to = (d ->> 'assigned_to')::uuid, notes = d ->> 'notes', updated_at = now()
  where id = p_id;
  return p_id;
end $$;

-- The service was renewed: move the due date on (by default one repeat period after the current due date).
create or replace function public.mark_renewed(p_id bigint, p_new_due date default null, p_note text default null) returns date
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_member();
  r     public.renewals;
  v_new date;
begin
  select * into r from public.renewals where id = p_id;
  if r.id is null then
    raise exception 'Renewal not found' using errcode = 'P0002';
  end if;
  v_new := coalesce(p_new_due, (r.due_date + make_interval(months => r.interval_months))::date);
  if v_new <= r.due_date then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = '{"new_due": "The next due date must be after the current one"}';
  end if;
  if char_length(p_note) > 2000 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"note": "Too long"}';
  end if;
  update public.renewals set due_date = v_new, active = true, last_reminded_at = null, last_reminded_to = null, updated_at = now()
  where id = p_id;
  insert into public.renewal_events (renewal_id, user_id, kind, body, old_due, new_due)
  values (p_id, me.id, 'renewed', nullif(btrim(p_note), ''), r.due_date, v_new);
  return v_new;
end $$;

-- Record that the customer was reminded (after it was emailed from the user's own mailbox).
create or replace function public.mark_renewal_reminded(p_id bigint, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  update public.renewals set last_reminded_at = now(), last_reminded_to = left(nullif(btrim(p_to), ''), 500), updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'Renewal not found' using errcode = 'P0002';
  end if;
  insert into public.renewal_events (renewal_id, user_id, kind, body)
  values (p_id, me.id, 'reminded', 'Reminded ' || coalesce(nullif(btrim(p_to), ''), 'the customer'));
end $$;

-- Stop a service the customer no longer takes from Lowcaps (or start it again).
create or replace function public.set_renewal_active(p_id bigint, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
  r  public.renewals;
begin
  select * into r from public.renewals where id = p_id;
  if r.id is null then
    raise exception 'Renewal not found' using errcode = 'P0002';
  end if;
  if r.active = coalesce(p_active, false) then
    return;
  end if;
  update public.renewals set active = coalesce(p_active, false), updated_at = now() where id = p_id;
  insert into public.renewal_events (renewal_id, user_id, kind)
  values (p_id, me.id, case when p_active then 'restarted' else 'stopped' end);
end $$;

-- Start the work for a renewal as a task (managers create tasks). Returns the task id.
create or replace function public.create_renewal_task(p_id bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  r     public.renewals;
  title text;
  v_id  bigint;
begin
  select * into r from public.renewals where id = p_id;
  if r.id is null then
    raise exception 'Renewal not found' using errcode = 'P0002';
  end if;
  select left(concat_ws(': ', rt.name, nullif(r.reference, '')), 200) into title
  from public.renewal_types rt where rt.id = r.type_id;
  insert into public.tasks (title, description, customer_id, assigned_to, due_date, created_by, renewal_id)
  values (coalesce(title, 'Renewal'), format('Renewal due on %s.', to_char(r.due_date, 'DD Mon YYYY')), r.customer_id,
          (select id from public.profiles where id = r.assigned_to and active), r.due_date, me.id, r.id)
  returning id into v_id;
  insert into public.task_updates (task_id, user_id, kind, body) values (v_id, me.id, 'created', 'Created the task from a renewal');
  insert into public.renewal_events (renewal_id, user_id, kind, body) values (p_id, me.id, 'task', 'Created a task: ' || coalesce(title, 'Renewal'));
  return v_id;
end $$;

create or replace function public.delete_renewal(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  delete from public.renewals where id = p_id;
  if not found then
    raise exception 'Renewal not found' using errcode = 'P0002';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- API: payments
-- -------------------------------------------------------------------------------------

-- Recalculate what has been paid on an invoice and set it to paid / back to sent.
-- Drafts stay drafts (they become paid when sent, if already paid in full).
create or replace function private.refresh_invoice_payments(p_invoice_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  paid numeric;
  last_paid date;
begin
  select coalesce(sum(amount), 0), max(paid_on) into paid, last_paid
  from public.payments where invoice_id = p_invoice_id and cheque_status is distinct from 'bounced';
  -- Receipt vouchers and credit notes set against the invoice count too.
  select paid + coalesce(sum(a.amount), 0), greatest(last_paid, max(a.created_at)::date) into paid, last_paid
  from public.receivable_allocations a where a.invoice_id = p_invoice_id;
  update public.invoices set
    amount_paid = paid,
    status = case
      when status in ('sent', 'paid') and paid >= total and total > 0 then 'paid'
      when status = 'paid' then 'sent'
      else status
    end,
    paid_at = case when status in ('sent', 'paid') and paid >= total and total > 0 then coalesce(paid_at, last_paid::timestamptz, now()) end,
    updated_at = now()
  where id = p_invoice_id;
end $$;

-- Record money received against an invoice (part or full). Managers and admins only. Returns the payment id.
-- p_data: amount, method (bank_transfer | cash | cheque | other), paid_on, reference, cheque_bank, cheque_date, notes
create or replace function public.record_payment(p_invoice_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  d      jsonb := private.clean(p_data, '{
    "method":      {"type": "enum", "required": true, "values": ["bank_transfer", "cash", "cheque", "other"]},
    "paid_on":     {"type": "date", "required": true},
    "reference":   {"type": "text", "max": 100},
    "cheque_bank": {"type": "text", "max": 100},
    "cheque_date": {"type": "date"},
    "account_id":  {"type": "int"},
    "notes":       {"type": "text", "max": 1000}
  }');
  inv    public.invoices;
  amt    numeric;
  errs   jsonb := '{}';
  v_id   bigint;
  label  text;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.id is null then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if inv.status = 'cancelled' then
    raise exception 'This invoice is cancelled' using errcode = '22023';
  end if;

  begin
    amt := nullif(btrim(p_data ->> 'amount'), '')::numeric;
  exception when others then
    amt := null;
  end;
  if amt is null or amt <= 0 or scale(amt) > 2 then
    errs := errs || '{"amount": "Enter an amount above 0, with at most 2 decimals"}';
  elsif amt > inv.total - inv.amount_paid then
    errs := errs || jsonb_build_object('amount', format('More than the balance of AED %s',
                                                        to_char(inv.total - inv.amount_paid, 'FM999,999,999,990.00')));
  end if;
  if (d ->> 'paid_on')::date > private.today() then
    errs := errs || '{"paid_on": "Can''t be in the future"}';
  end if;
  if d ->> 'method' = 'cheque' and d ->> 'reference' is null then
    errs := errs || '{"reference": "Enter the cheque number"}';
  end if;
  if d ->> 'account_id' is not null and not exists (
       select 1 from public.accounts where id = (d ->> 'account_id')::bigint and subtype in ('bank', 'cash') and active) then
    errs := errs || '{"account_id": "Pick a bank or cash account"}';
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  insert into public.payments (invoice_id, amount, method, paid_on, reference, cheque_bank, cheque_date, cheque_status, notes, recorded_by, account_id)
  values (p_invoice_id, amt, d ->> 'method', (d ->> 'paid_on')::date, d ->> 'reference',
          case when d ->> 'method' = 'cheque' then d ->> 'cheque_bank' end,
          case when d ->> 'method' = 'cheque' then (d ->> 'cheque_date')::date end,
          case when d ->> 'method' = 'cheque' then 'pending' end, d ->> 'notes', me.id, (d ->> 'account_id')::bigint)
  returning id into v_id;
  perform private.refresh_invoice_payments(p_invoice_id);
  perform private.post_payment(v_id, me.id);

  if inv.task_id is not null then
    label := case d ->> 'method' when 'bank_transfer' then 'bank transfer' when 'cheque' then 'cheque' when 'cash' then 'cash' else 'payment' end;
    insert into public.task_updates (task_id, user_id, kind, body)
    values (inv.task_id, me.id, 'comment',
            format('Received AED %s by %s for %s', to_char(amt, 'FM999,999,999,990.00'), label, inv.number));
  end if;
  return v_id;
end $$;

-- A cheque was cleared by the bank, or bounced (a bounced cheque no longer counts as paid).
create or replace function public.set_cheque_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  pm  public.payments;
begin
  select * into pm from public.payments where id = p_id;
  if pm.id is null then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  if pm.method <> 'cheque' then
    raise exception 'Only cheques can be cleared or bounced' using errcode = '22023';
  end if;
  if coalesce(p_status, '') not in ('pending', 'cleared', 'bounced') then
    raise exception 'Unknown cheque status' using errcode = '22023';
  end if;
  if pm.cheque_status = 'bounced' and p_status <> 'bounced'
     and pm.amount > (select total - amount_paid from public.invoices where id = pm.invoice_id) then
    raise exception 'The invoice has been paid since; this cheque can''t count again' using errcode = '22023';
  end if;
  update public.payments set cheque_status = p_status where id = p_id;
  perform private.post_cheque_change(p_id, pm.cheque_status, p_status, me.id);
  perform private.refresh_invoice_payments(pm.invoice_id);
end $$;

-- Remove a payment entered by mistake.
create or replace function public.delete_payment(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  inv bigint;
begin
  perform private.unpost_payment(p_id, me.id);
  delete from public.payments where id = p_id returning invoice_id into inv;
  if inv is null then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  perform private.refresh_invoice_payments(inv);
end $$;

-- Record that a payment reminder was emailed (from the user's own mailbox).
create or replace function public.mark_payment_reminded(p_invoice_id bigint, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  inv public.invoices;
begin
  update public.invoices set payment_reminded_at = now(), payment_reminded_to = left(nullif(btrim(p_to), ''), 500)
  where id = p_invoice_id returning * into inv;
  if inv.id is null then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if inv.task_id is not null then
    insert into public.task_updates (task_id, user_id, kind, body)
    values (inv.task_id, me.id, 'comment', format('Sent a payment reminder for %s (balance AED %s) to %s', inv.number,
            to_char(inv.total - inv.amount_paid, 'FM999,999,999,990.00'), coalesce(nullif(btrim(p_to), ''), 'the customer')));
  end if;
end $$;

-- method: '' | bank_transfer | cash | cheque | other; cheques: '' | pending | cleared | bounced
create or replace function public.list_payments(
  p_q text default null, p_method text default null, p_cheque_status text default null, p_page int default 1
) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me        public.profiles := private.current_member();
  page_size constant int := 25;
  pg        int := greatest(coalesce(p_page, 1), 1);
  pat       text;
  total     bigint;
  amount    numeric;
  v_rows    json;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  with f as (
    select pm.*, i.number as invoice_number, i.customer_id, i.customer_name, u.name as recorded_by_name
    from public.payments pm
    join public.invoices i on i.id = pm.invoice_id
    left join public.profiles u on u.id = pm.recorded_by
    where (pat is null or i.number ilike pat or i.customer_name ilike pat or pm.reference ilike pat)
      and (coalesce(p_method, '') = '' or pm.method = p_method)
      and (coalesce(p_cheque_status, '') = '' or pm.cheque_status = p_cheque_status)
  )
  select (select count(*) from f),
         (select coalesce(sum(f.amount) filter (where f.cheque_status is distinct from 'bounced'), 0) from f),
         coalesce((select json_agg(x order by x.paid_on desc, x.id desc) from (
           select * from f order by f.paid_on desc, f.id desc
           limit page_size offset (pg - 1) * page_size) x), '[]')
  into total, amount, v_rows;
  return json_build_object('payments', v_rows, 'total', total, 'amount', amount, 'page', pg, 'pageSize', page_size,
                           'today', private.today());
end $$;

-- -------------------------------------------------------------------------------------
-- API: HR (employee records, attendance, leave, payslips). Every role can use these;
-- managers and admins see everyone's full details, others their own plus colleagues' basics.
-- -------------------------------------------------------------------------------------

create or replace function private.is_hr_manager(p public.profiles) returns boolean
language sql immutable as $$ select p.role in ('admin', 'manager') $$;

-- Straight-line distance in metres between two points (haversine).
create or replace function private.distance_m(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision) returns double precision
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Leave days between two dates, skipping the company's weekend days.
create or replace function private.count_leave_days(p_start date, p_end date) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from generate_series(p_start, p_end, interval '1 day') as d
  where extract(dow from d)::int <> all (coalesce((select weekend_days from public.company_settings where id = 1), '{}'::int[]))
$$;

create or replace function private.leave_entitlement(p_profile uuid, p_kind text) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(case p_kind when 'annual' then e.annual_leave_days else e.medical_leave_days end,
                  case p_kind when 'annual' then c.annual_leave_days else c.medical_leave_days end)
  from public.company_settings c left join public.employees e on e.profile_id = p_profile
  where c.id = 1
$$;

-- {entitled, taken, pending, remaining} for one person, kind and year.
create or replace function private.leave_balance(p_profile uuid, p_kind text, p_year int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with x as (
    select private.leave_entitlement(p_profile, p_kind) as entitled,
           coalesce(sum(days) filter (where status = 'approved'), 0) as taken,
           coalesce(sum(days) filter (where status = 'pending'), 0) as pending
    from public.leave_requests
    where profile_id = p_profile and kind = p_kind and extract(year from start_date)::int = p_year
  )
  select jsonb_build_object('entitled', entitled, 'taken', taken, 'pending', pending,
                            'remaining', entitled - taken - pending)
  from x
$$;

create or replace function public.get_hr_settings() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_person();
begin
  return (select json_build_object(
    'office_lat', office_lat, 'office_lng', office_lng, 'office_radius_m', office_radius_m,
    'office_set', office_lat is not null and office_lng is not null,
    'work_start', to_char(work_start, 'HH24:MI'), 'weekend_days', weekend_days,
    'annual_leave_days', annual_leave_days, 'medical_leave_days', medical_leave_days)
    from public.company_settings where id = 1);
end $$;

-- Admins: office location, work start time, weekend days, default leave entitlements.
create or replace function public.save_hr_settings(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_admin();
  errs   jsonb := '{}';
  lat    double precision;
  lng    double precision;
  radius int;
  start  time;
  annual int;
  medical int;
  weekend int[];
begin
  begin
    lat := nullif(btrim(p_data ->> 'office_lat'), '')::double precision;
    lng := nullif(btrim(p_data ->> 'office_lng'), '')::double precision;
  exception when others then
    errs := errs || '{"office_lat": "Enter the location as numbers, e.g. 25.3463 and 56.3418"}';
  end;
  if errs = '{}' and ((lat is null) <> (lng is null) or lat not between -90 and 90 or lng not between -180 and 180) then
    errs := errs || '{"office_lat": "Enter both latitude (-90 to 90) and longitude (-180 to 180), or neither"}';
  end if;
  begin
    radius := coalesce(nullif(btrim(p_data ->> 'office_radius_m'), '')::int, 200);
    annual := coalesce(nullif(btrim(p_data ->> 'annual_leave_days'), '')::int, 30);
    medical := coalesce(nullif(btrim(p_data ->> 'medical_leave_days'), '')::int, 15);
  exception when others then
    errs := errs || '{"office_radius_m": "Use whole numbers"}';
  end;
  if radius not between 20 and 5000 then errs := errs || '{"office_radius_m": "Use 20 to 5000 metres"}'; end if;
  if annual not between 0 and 366 then errs := errs || '{"annual_leave_days": "Use 0 to 366 days"}'; end if;
  if medical not between 0 and 366 then errs := errs || '{"medical_leave_days": "Use 0 to 366 days"}'; end if;
  begin
    start := coalesce(nullif(btrim(p_data ->> 'work_start'), ''), '09:00')::time;
  exception when others then
    errs := errs || '{"work_start": "Use a time like 09:00"}';
  end;
  begin
    select coalesce(array_agg(distinct x::int order by x::int), '{}') into weekend
    from jsonb_array_elements_text(coalesce(p_data -> 'weekend_days', '[]')) as x;
  exception when others then
    errs := errs || '{"weekend_days": "Pick the weekend days"}';
  end;
  if weekend is not null and (cardinality(weekend) > 6 or exists (select 1 from unnest(weekend) w where w not between 0 and 6)) then
    errs := errs || '{"weekend_days": "Pick at most 6 weekend days"}';
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  update public.company_settings set office_lat = lat, office_lng = lng, office_radius_m = radius, work_start = start,
    weekend_days = weekend, annual_leave_days = annual, medical_leave_days = medical, updated_at = now()
  where id = 1;
end $$;

-- Everyone: name, designation, department, email and work phone of active colleagues.
-- Managers also get employee no., joining date and people who have left.
create or replace function public.hr_directory() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_person();
  mgr boolean := private.is_hr_manager(me);
begin
  return coalesce((select json_agg(json_build_object(
      'id', p.id, 'name', p.name, 'email', p.email, 'role', p.role,
      'designation', e.designation, 'department', e.department, 'work_phone', e.work_phone,
      'employee_no', case when mgr then e.employee_no end,
      'joining_date', case when mgr or p.id = me.id then e.joining_date end,
      'status', coalesce(e.status, 'active'))
    order by coalesce(e.status, 'active'), lower(p.name))
    from public.profiles p left join public.employees e on e.profile_id = p.id
    where p.active and (mgr or coalesce(e.status, 'active') = 'active')), '[]');
end $$;

-- Full record for managers and for the person themself; basic details for anyone else.
create or replace function public.get_employee(p_id uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_person();
  p   public.profiles;
  e   public.employees;
begin
  select * into p from public.profiles where id = p_id;
  if p.id is null or (not p.active and not private.is_hr_manager(me)) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  select * into e from public.employees where profile_id = p_id;
  if private.is_hr_manager(me) or me.id = p_id then
    return (coalesce(to_jsonb(e), '{}') || jsonb_build_object(
      'id', p.id, 'name', p.name, 'email', p.email, 'role', p.role, 'active', p.active, 'full', true,
      'status', coalesce(e.status, 'active'),
      'annual_entitled', private.leave_entitlement(p.id, 'annual'),
      'medical_entitled', private.leave_entitlement(p.id, 'medical'),
      'today', private.today()))::json;
  end if;
  return json_build_object('id', p.id, 'name', p.name, 'email', p.email, 'role', p.role, 'full', false,
    'designation', e.designation, 'department', e.department, 'work_phone', e.work_phone);
end $$;

create or replace function private.money(p_data jsonb, p_key text, inout errs jsonb, out val numeric)
language plpgsql immutable as $$
declare
  v text := nullif(btrim(p_data ->> p_key), '');
begin
  if v is null then
    val := 0;
  elsif v ~ '^\d{1,10}(\.\d{1,2})?$' then
    val := v::numeric;
  else
    errs := errs || jsonb_build_object(p_key, 'Enter an amount like 4500 or 4500.50');
    val := 0;
  end if;
end $$;

-- Managers and admins: create or update someone's HR record.
create or replace function public.save_employee(p_id uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_manager();
  d    jsonb := private.clean(p_data, '{
    "employee_no":        {"type": "text", "max": 30},
    "designation":        {"type": "text", "max": 100},
    "department":         {"type": "text", "max": 100},
    "joining_date":       {"type": "date"},
    "work_phone":         {"type": "text", "max": 30},
    "date_of_birth":      {"type": "date"},
    "gender":             {"type": "enum", "values": ["male", "female"]},
    "nationality":        {"type": "text", "max": 60},
    "personal_email":     {"type": "text", "max": 200, "format": "email"},
    "personal_phone":     {"type": "text", "max": 30},
    "address":            {"type": "text", "max": 500},
    "emergency_name":     {"type": "text", "max": 100},
    "emergency_relation": {"type": "text", "max": 50},
    "emergency_phone":    {"type": "text", "max": 30},
    "emirates_id":        {"type": "text", "max": 30},
    "emirates_id_expiry": {"type": "date"},
    "passport_no":        {"type": "text", "max": 30},
    "passport_expiry":    {"type": "date"},
    "visa_expiry":        {"type": "date"},
    "bank_name":          {"type": "text", "max": 100},
    "iban":               {"type": "text", "max": 50},
    "annual_leave_days":  {"type": "int"},
    "medical_leave_days": {"type": "int"},
    "status":             {"type": "enum", "values": ["active", "left"], "default": "active"},
    "leaving_date":       {"type": "date"},
    "notes":              {"type": "text", "max": 2000}
  }');
  errs jsonb := '{}';
  basic numeric; housing numeric; transport numeric; other numeric;
begin
  if not exists (select 1 from public.profiles where id = p_id) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  select x.errs, x.val into errs, basic from private.money(p_data, 'basic_salary', errs) x;
  select x.errs, x.val into errs, housing from private.money(p_data, 'housing_allowance', errs) x;
  select x.errs, x.val into errs, transport from private.money(p_data, 'transport_allowance', errs) x;
  select x.errs, x.val into errs, other from private.money(p_data, 'other_allowance', errs) x;
  if (d ->> 'annual_leave_days')::int > 366 then errs := errs || '{"annual_leave_days": "Use 0 to 366 days"}'; end if;
  if (d ->> 'medical_leave_days')::int > 366 then errs := errs || '{"medical_leave_days": "Use 0 to 366 days"}'; end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  insert into public.employees as e (profile_id, employee_no, designation, department, joining_date, work_phone,
    date_of_birth, gender, nationality, personal_email, personal_phone, address, emergency_name, emergency_relation,
    emergency_phone, emirates_id, emirates_id_expiry, passport_no, passport_expiry, visa_expiry, bank_name, iban,
    basic_salary, housing_allowance, transport_allowance, other_allowance, annual_leave_days, medical_leave_days,
    status, leaving_date, notes, updated_at)
  values (p_id, d ->> 'employee_no', d ->> 'designation', d ->> 'department', (d ->> 'joining_date')::date, d ->> 'work_phone',
    (d ->> 'date_of_birth')::date, d ->> 'gender', d ->> 'nationality', d ->> 'personal_email', d ->> 'personal_phone',
    d ->> 'address', d ->> 'emergency_name', d ->> 'emergency_relation', d ->> 'emergency_phone', d ->> 'emirates_id',
    (d ->> 'emirates_id_expiry')::date, d ->> 'passport_no', (d ->> 'passport_expiry')::date, (d ->> 'visa_expiry')::date,
    d ->> 'bank_name', upper(replace(d ->> 'iban', ' ', '')), basic, housing, transport, other,
    (d ->> 'annual_leave_days')::int, (d ->> 'medical_leave_days')::int, d ->> 'status', (d ->> 'leaving_date')::date,
    d ->> 'notes', now())
  on conflict (profile_id) do update set
    employee_no = excluded.employee_no, designation = excluded.designation, department = excluded.department,
    joining_date = excluded.joining_date, work_phone = excluded.work_phone, date_of_birth = excluded.date_of_birth,
    gender = excluded.gender, nationality = excluded.nationality, personal_email = excluded.personal_email,
    personal_phone = excluded.personal_phone, address = excluded.address, emergency_name = excluded.emergency_name,
    emergency_relation = excluded.emergency_relation, emergency_phone = excluded.emergency_phone,
    emirates_id = excluded.emirates_id, emirates_id_expiry = excluded.emirates_id_expiry,
    passport_no = excluded.passport_no, passport_expiry = excluded.passport_expiry, visa_expiry = excluded.visa_expiry,
    bank_name = excluded.bank_name, iban = excluded.iban, basic_salary = excluded.basic_salary,
    housing_allowance = excluded.housing_allowance, transport_allowance = excluded.transport_allowance,
    other_allowance = excluded.other_allowance, annual_leave_days = excluded.annual_leave_days,
    medical_leave_days = excluded.medical_leave_days, status = excluded.status, leaving_date = excluded.leaving_date,
    notes = excluded.notes, updated_at = now();
end $$;

-- ---------- attendance ----------

-- Sign in (p_action 'in') on arrival or sign out ('out') when leaving, with the device's location if available.
-- Away from the office (or with no location) a remark saying why is required.
create or replace function public.attendance_sign(p_action text, p_lat double precision, p_lng double precision,
                                                  p_accuracy double precision, p_remark text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me       public.profiles := private.current_person();
  co       public.company_settings;
  t        date := private.today();
  rec      public.attendance;
  dist     int;
  at_off   boolean;
  remark   text := nullif(btrim(p_remark), '');
begin
  if p_action not in ('in', 'out') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  if char_length(remark) > 300 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"remark": "Keep it under 300 characters"}';
  end if;
  select * into co from public.company_settings where id = 1;
  if co.office_lat is not null and p_lat is not null and p_lng is not null then
    dist := round(private.distance_m(co.office_lat, co.office_lng, p_lat, p_lng));
  end if;
  at_off := case when co.office_lat is null then null else coalesce(dist <= co.office_radius_m, false) end;
  if at_off is false and remark is null then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = jsonb_build_object('remark', case when dist is null
        then 'Your location isn''t available. Add a remark saying where you are, e.g. "Client visit at Sharjah port".'
        else format('You''re about %s m from the office. Add a remark saying why, e.g. "Client visit at Sharjah port".',
                    to_char(dist, 'FM999,999,990')) end)::text;
  end if;

  select * into rec from public.attendance where profile_id = me.id and work_date = t;
  if p_action = 'in' then
    if rec.sign_in is not null then
      raise exception 'You already signed in today at %', to_char(rec.sign_in at time zone 'Asia/Dubai', 'HH24:MI') using errcode = '22023';
    end if;
    insert into public.attendance (profile_id, work_date, sign_in, in_lat, in_lng, in_distance_m, in_at_office, in_remark)
    values (me.id, t, now(), p_lat, p_lng, dist, at_off, remark)
    on conflict (profile_id, work_date) do update set sign_in = excluded.sign_in, in_lat = excluded.in_lat,
      in_lng = excluded.in_lng, in_distance_m = excluded.in_distance_m, in_at_office = excluded.in_at_office,
      in_remark = excluded.in_remark
    returning * into rec;
  else
    if rec.sign_in is null then
      raise exception 'Sign in first' using errcode = '22023';
    end if;
    if rec.sign_out is not null then
      raise exception 'You already signed out today at %', to_char(rec.sign_out at time zone 'Asia/Dubai', 'HH24:MI') using errcode = '22023';
    end if;
    update public.attendance set sign_out = now(), out_lat = p_lat, out_lng = p_lng, out_distance_m = dist,
      out_at_office = at_off, out_remark = remark
    where id = rec.id returning * into rec;
  end if;
  return to_json(rec);
end $$;

-- One person's attendance for a month (their own, or anyone's for managers), with approved leave.
create or replace function public.my_attendance(p_month date default null, p_profile uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_person();
  target uuid := coalesce(p_profile, me.id);
  m      date := date_trunc('month', coalesce(p_month, private.today()))::date;
  m_end  date := (date_trunc('month', coalesce(p_month, private.today())) + interval '1 month - 1 day')::date;
begin
  if target <> me.id and not private.is_hr_manager(me) then
    raise exception 'You can only see your own attendance' using errcode = '42501';
  end if;
  return json_build_object(
    'month', m, 'today', private.today(),
    'name', (select name from public.profiles where id = target),
    'work_start', (select to_char(work_start, 'HH24:MI') from public.company_settings where id = 1),
    'weekend_days', (select weekend_days from public.company_settings where id = 1),
    'days', coalesce((select json_agg(a order by a.work_date) from public.attendance a
                      where a.profile_id = target and a.work_date between m and m_end), '[]'),
    'leaves', coalesce((select json_agg(json_build_object('kind', l.kind, 'start_date', l.start_date, 'end_date', l.end_date))
                        from public.leave_requests l
                        where l.profile_id = target and l.status = 'approved' and l.start_date <= m_end and l.end_date >= m), '[]'));
end $$;

-- Managers: everyone's attendance for one day.
create or replace function public.team_attendance(p_date date default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  d  date := coalesce(p_date, private.today());
begin
  return json_build_object(
    'date', d, 'today', private.today(),
    'work_start', (select to_char(work_start, 'HH24:MI') from public.company_settings where id = 1),
    'weekend', extract(dow from d)::int = any (coalesce((select weekend_days from public.company_settings where id = 1), '{}'::int[])),
    'people', coalesce((select json_agg(x order by lower(x.name)) from (
      select p.id, p.name, e.designation, a.sign_in, a.sign_out, a.in_at_office, a.in_distance_m, a.in_remark,
             a.out_at_office, a.out_distance_m, a.out_remark, a.edit_note,
             (a.sign_in at time zone 'Asia/Dubai')::time > (select work_start from public.company_settings where id = 1) as late,
             (select l.kind from public.leave_requests l where l.profile_id = p.id and l.status = 'approved'
                and d between l.start_date and l.end_date limit 1) as on_leave
      from public.profiles p
      left join public.employees e on e.profile_id = p.id
      left join public.attendance a on a.profile_id = p.id and a.work_date = d
      where p.active and coalesce(e.status, 'active') = 'active') x), '[]'));
end $$;

-- Managers: correct a day's record (times as HH:MM, Dubai time). Both empty removes the record.
create or replace function public.save_attendance(p_profile uuid, p_date date, p_in text, p_out text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  t_in  timestamptz;
  t_out timestamptz;
  errs  jsonb := '{}';
begin
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  begin
    t_in := ((p_date + nullif(btrim(p_in), '')::time) at time zone 'Asia/Dubai');
  exception when others then errs := errs || '{"in": "Use a time like 09:05"}';
  end;
  begin
    t_out := ((p_date + nullif(btrim(p_out), '')::time) at time zone 'Asia/Dubai');
  exception when others then errs := errs || '{"out": "Use a time like 18:00"}';
  end;
  if t_out is not null and t_in is null then errs := errs || '{"in": "Add the sign-in time too"}'; end if;
  if t_out <= t_in then errs := errs || '{"out": "Must be after the sign-in time"}'; end if;
  if char_length(p_note) > 300 then errs := errs || '{"note": "Keep it under 300 characters"}'; end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  if t_in is null then
    delete from public.attendance where profile_id = p_profile and work_date = p_date;
    return;
  end if;
  insert into public.attendance (profile_id, work_date, sign_in, sign_out, edited_by, edit_note)
  values (p_profile, p_date, t_in, t_out, me.id, coalesce(nullif(btrim(p_note), ''), 'Corrected by ' || me.name))
  on conflict (profile_id, work_date) do update set sign_in = excluded.sign_in, sign_out = excluded.sign_out,
    edited_by = excluded.edited_by, edit_note = excluded.edit_note;
end $$;

-- ---------- leave ----------

-- Balances and requests for a person (own, or anyone's for managers) in a year.
create or replace function public.leave_summary(p_profile uuid default null, p_year int default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_person();
  target uuid := coalesce(p_profile, me.id);
  y      int := coalesce(p_year, extract(year from private.today())::int);
begin
  if target <> me.id and not private.is_hr_manager(me) then
    raise exception 'You can only see your own leave' using errcode = '42501';
  end if;
  return json_build_object(
    'year', y, 'today', private.today(),
    'weekend_days', (select weekend_days from public.company_settings where id = 1),
    'annual', private.leave_balance(target, 'annual', y),
    'medical', private.leave_balance(target, 'medical', y),
    'requests', coalesce((select json_agg(to_jsonb(l) || jsonb_build_object('decided_by_name', u.name)
                                          order by l.start_date desc, l.id desc)
                          from public.leave_requests l left join public.profiles u on u.id = l.decided_by
                          where l.profile_id = target and extract(year from l.start_date)::int = y), '[]'));
end $$;

-- Ask for annual or medical leave (for yourself). Goes to managers for approval.
create or replace function public.request_leave(p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_person();
  d    jsonb := private.clean(p_data, '{
    "kind":       {"type": "enum", "required": true, "values": ["annual", "medical"]},
    "start_date": {"type": "date", "required": true},
    "end_date":   {"type": "date", "required": true},
    "reason":     {"type": "text", "max": 1000}
  }');
  s    date := (d ->> 'start_date')::date;
  e    date := (d ->> 'end_date')::date;
  n    int;
  bal  jsonb;
  v_id bigint;
begin
  if e < s then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"end_date": "Must be on or after the first day"}';
  end if;
  if extract(year from s) <> extract(year from e) then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = '{"end_date": "Leave can''t cross into the next year; send two requests (up to 31 Dec, and from 1 Jan)"}';
  end if;
  n := private.count_leave_days(s, e);
  if n = 0 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"end_date": "Those dates are all weekend days"}';
  end if;
  if exists (select 1 from public.leave_requests where profile_id = me.id and status in ('pending', 'approved')
             and start_date <= e and end_date >= s) then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = '{"start_date": "You already have leave requested or approved on some of these days"}';
  end if;
  bal := private.leave_balance(me.id, d ->> 'kind', extract(year from s)::int);
  if n > (bal ->> 'remaining')::numeric then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = jsonb_build_object('end_date', format('That is %s days, but you only have %s %s leave days left this year (including requests waiting for approval)',
                                                    n, trim_scale((bal ->> 'remaining')::numeric), d ->> 'kind'))::text;
  end if;
  insert into public.leave_requests (profile_id, kind, start_date, end_date, days, reason)
  values (me.id, d ->> 'kind', s, e, n, d ->> 'reason')
  returning id into v_id;
  return v_id;
end $$;

-- Withdraw your own pending request; managers can also cancel approved leave.
create or replace function public.cancel_leave(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_person();
  r  public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_id;
  if r.id is null or (r.profile_id <> me.id and not private.is_hr_manager(me)) then
    raise exception 'Leave request not found' using errcode = 'P0002';
  end if;
  if r.status = 'approved' and not private.is_hr_manager(me) then
    raise exception 'Approved leave can only be cancelled by a manager' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'This request is already %', r.status using errcode = '22023';
  end if;
  update public.leave_requests set status = 'cancelled',
    decided_by = case when me.id <> r.profile_id then me.id else decided_by end,
    decided_at = case when me.id <> r.profile_id then now() else decided_at end
  where id = p_id;
end $$;

-- Managers approve or reject. Managers can't decide their own requests (an admin or another manager does).
create or replace function public.decide_leave(p_id bigint, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  r   public.leave_requests;
  bal jsonb;
begin
  select * into r from public.leave_requests where id = p_id;
  if r.id is null then
    raise exception 'Leave request not found' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request is already %', r.status using errcode = '22023';
  end if;
  if r.profile_id = me.id and me.role <> 'admin' then
    raise exception 'Another manager or an administrator has to decide your own leave' using errcode = '42501';
  end if;
  if char_length(p_note) > 500 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"note": "Keep it under 500 characters"}';
  end if;
  if p_approve then
    bal := private.leave_balance(r.profile_id, r.kind, extract(year from r.start_date)::int);
    if (bal ->> 'taken')::numeric + r.days > (bal ->> 'entitled')::numeric then
      raise exception 'Approving would go over % days of % leave for the year. Change their entitlement first if this is agreed.',
        bal ->> 'entitled', r.kind using errcode = '22023';
    end if;
  end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = me.id, decided_at = now(), decision_note = nullif(btrim(p_note), '')
  where id = p_id;
end $$;

-- Managers: everyone's requests (default: waiting for approval). Others: their own.
create or replace function public.list_leave_requests(p_status text default 'pending', p_year int default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_person();
  mgr boolean := private.is_hr_manager(me);
begin
  return coalesce((select json_agg(x order by x.start_date desc, x.id desc) from (
    select l.*, p.name, e.designation, u.name as decided_by_name,
           (private.leave_balance(l.profile_id, l.kind, extract(year from l.start_date)::int) ->> 'remaining')::numeric as remaining,
           private.leave_balance(l.profile_id, l.kind, extract(year from l.start_date)::int) ->> 'entitled' as entitled
    from public.leave_requests l
    join public.profiles p on p.id = l.profile_id
    left join public.employees e on e.profile_id = l.profile_id
    left join public.profiles u on u.id = l.decided_by
    where (mgr or l.profile_id = me.id)
      and (coalesce(p_status, '') = '' or l.status = p_status)
      and (p_year is null or extract(year from l.start_date)::int = p_year)
    order by l.start_date desc, l.id desc limit 200) x), '[]');
end $$;

-- ---------- payslips ----------

-- Managers: payslips for a month (default this month) plus who has none yet, or all of one person's.
-- Everyone else: their own published payslips.
create or replace function public.list_payslips(p_period date default null, p_profile uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_person();
  per date := date_trunc('month', coalesce(p_period, private.today()))::date;
begin
  if not private.is_hr_manager(me) then
    return json_build_object('mine', true, 'payslips', coalesce((
      select json_agg(json_build_object('id', s.id, 'period', s.period, 'published_at', s.published_at,
        'net', s.basic_salary + s.housing_allowance + s.transport_allowance + s.other_allowance + s.overtime + s.bonus - s.deductions)
        order by s.period desc)
      from public.payslips s where s.profile_id = me.id and s.status = 'published'), '[]'));
  end if;
  return json_build_object('mine', false, 'period', per,
    'payslips', coalesce((
      select json_agg(json_build_object('id', s.id, 'profile_id', s.profile_id, 'name', p.name, 'designation', e.designation,
        'period', s.period, 'status', s.status, 'published_at', s.published_at,
        'gross', s.basic_salary + s.housing_allowance + s.transport_allowance + s.other_allowance + s.overtime + s.bonus,
        'deductions', s.deductions,
        'net', s.basic_salary + s.housing_allowance + s.transport_allowance + s.other_allowance + s.overtime + s.bonus - s.deductions)
        order by case when p_profile is null then lower(p.name) end, s.period desc)
      from public.payslips s join public.profiles p on p.id = s.profile_id left join public.employees e on e.profile_id = s.profile_id
      where (p_profile is null and s.period = per) or s.profile_id = p_profile), '[]'),
    'missing', case when p_profile is null then coalesce((
      select json_agg(json_build_object('id', p.id, 'name', p.name, 'basic_salary', coalesce(e.basic_salary, 0)) order by lower(p.name))
      from public.profiles p left join public.employees e on e.profile_id = p.id
      where p.active and coalesce(e.status, 'active') = 'active'
        and not exists (select 1 from public.payslips s where s.profile_id = p.id and s.period = per)), '[]') end);
end $$;

create or replace function public.get_payslip(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_person();
  s  public.payslips;
begin
  select * into s from public.payslips where id = p_id;
  if s.id is null or (not private.is_hr_manager(me) and (s.profile_id <> me.id or s.status <> 'published')) then
    raise exception 'Payslip not found' using errcode = 'P0002';
  end if;
  return (select json_build_object(
    'payslip', to_jsonb(s) || jsonb_build_object(
      'gross', s.basic_salary + s.housing_allowance + s.transport_allowance + s.other_allowance + s.overtime + s.bonus,
      'net', s.basic_salary + s.housing_allowance + s.transport_allowance + s.other_allowance + s.overtime + s.bonus - s.deductions),
    'employee', json_build_object('name', p.name, 'email', p.email, 'employee_no', e.employee_no, 'designation', e.designation,
      'department', e.department, 'joining_date', e.joining_date, 'bank_name', e.bank_name, 'iban', e.iban),
    'company', json_build_object('legal_name', c.legal_name, 'address', c.address, 'phone', c.phone, 'email', c.email))
    from public.profiles p left join public.employees e on e.profile_id = p.id, public.company_settings c
    where p.id = s.profile_id and c.id = 1);
end $$;

-- Managers: create (p_id null) or edit a draft payslip. Amounts left empty count as 0.
create or replace function public.save_payslip(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_manager();
  d    jsonb := private.clean(p_data, '{
    "profile_id":     {"type": "uuid"},
    "period":         {"type": "date"},
    "deduction_note": {"type": "text", "max": 300},
    "notes":          {"type": "text", "max": 1000}
  }');
  errs jsonb := '{}';
  v_old public.payslips;
  basic numeric; housing numeric; transport numeric; other numeric; ot numeric; v_bonus numeric; ded numeric;
  v_id bigint;
begin
  if p_id is not null then
    select * into v_old from public.payslips where id = p_id;
    if v_old.id is null then
      raise exception 'Payslip not found' using errcode = 'P0002';
    end if;
    if v_old.status <> 'draft' then
      raise exception 'This payslip is published. Unpublish it first to make changes.' using errcode = '22023';
    end if;
  else
    if d ->> 'profile_id' is null or not exists (select 1 from public.profiles where id = (d ->> 'profile_id')::uuid) then
      errs := errs || '{"profile_id": "Pick an employee"}';
    end if;
    if d ->> 'period' is null then errs := errs || '{"period": "Pick the month"}'; end if;
  end if;
  select x.errs, x.val into errs, basic from private.money(p_data, 'basic_salary', errs) x;
  select x.errs, x.val into errs, housing from private.money(p_data, 'housing_allowance', errs) x;
  select x.errs, x.val into errs, transport from private.money(p_data, 'transport_allowance', errs) x;
  select x.errs, x.val into errs, other from private.money(p_data, 'other_allowance', errs) x;
  select x.errs, x.val into errs, ot from private.money(p_data, 'overtime', errs) x;
  select x.errs, x.val into errs, v_bonus from private.money(p_data, 'bonus', errs) x;
  select x.errs, x.val into errs, ded from private.money(p_data, 'deductions', errs) x;
  if errs = '{}' and ded > basic + housing + transport + other + ot + v_bonus then
    errs := errs || '{"deductions": "Deductions can''t be more than the total earnings"}';
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  if p_id is null then
    begin
      insert into public.payslips (profile_id, period, basic_salary, housing_allowance, transport_allowance, other_allowance,
                                   overtime, bonus, deductions, deduction_note, notes, created_by)
      values ((d ->> 'profile_id')::uuid, date_trunc('month', (d ->> 'period')::date)::date, basic, housing, transport, other,
              ot, v_bonus, ded, d ->> 'deduction_note', d ->> 'notes', me.id)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Please fix the highlighted fields' using errcode = '22023',
        detail = '{"period": "This employee already has a payslip for that month"}';
    end;
    return v_id;
  end if;
  update public.payslips set basic_salary = basic, housing_allowance = housing, transport_allowance = transport,
    other_allowance = other, overtime = ot, bonus = v_bonus, deductions = ded, deduction_note = d ->> 'deduction_note',
    notes = d ->> 'notes'
  where id = p_id;
  return p_id;
end $$;

-- Managers: draft payslips for everyone active with a salary set, from their salary package. Returns how many were created.
create or replace function public.generate_payslips(p_period date) returns int
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  per date := date_trunc('month', coalesce(p_period, private.today()))::date;
  n   int;
begin
  insert into public.payslips (profile_id, period, basic_salary, housing_allowance, transport_allowance, other_allowance, created_by)
  select p.id, per, e.basic_salary, e.housing_allowance, e.transport_allowance, e.other_allowance, me.id
  from public.profiles p join public.employees e on e.profile_id = p.id
  where p.active and e.status = 'active' and e.basic_salary > 0
    and not exists (select 1 from public.payslips s where s.profile_id = p.id and s.period = per);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.set_payslip_published(p_id bigint, p_published boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  update public.payslips set status = case when p_published then 'published' else 'draft' end,
    published_at = case when p_published then now() end
  where id = p_id;
  if not found then
    raise exception 'Payslip not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.delete_payslip(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  st text;
begin
  select status into st from public.payslips where id = p_id;
  if st is null then
    raise exception 'Payslip not found' using errcode = 'P0002';
  end if;
  if st <> 'draft' then
    raise exception 'Unpublish the payslip before deleting it' using errcode = '22023';
  end if;
  delete from public.payslips where id = p_id;
end $$;

-- The HR home page in one call: today's attendance, leave balances, latest payslips, approvals waiting.
create or replace function public.my_hr() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_person();
  y  int := extract(year from private.today())::int;
begin
  return json_build_object(
    'today', private.today(),
    'designation', (select designation from public.employees where profile_id = me.id),
    'attendance', (select to_json(a) from public.attendance a where a.profile_id = me.id and a.work_date = private.today()),
    'on_leave', (select l.kind from public.leave_requests l where l.profile_id = me.id and l.status = 'approved'
                 and private.today() between l.start_date and l.end_date limit 1),
    'settings', public.get_hr_settings(),
    'annual', private.leave_balance(me.id, 'annual', y),
    'medical', private.leave_balance(me.id, 'medical', y),
    'payslips', coalesce((select json_agg(x order by x.period desc) from (
      select s.id, s.period,
             s.basic_salary + s.housing_allowance + s.transport_allowance + s.other_allowance + s.overtime + s.bonus - s.deductions as net
      from public.payslips s where s.profile_id = me.id and s.status = 'published' order by s.period desc limit 3) x), '[]'),
    'pendingApprovals', case when private.is_hr_manager(me) then
      (select count(*) from public.leave_requests where status = 'pending' and (profile_id <> me.id or me.role = 'admin')) end,
    'expiringDocuments', case when private.is_hr_manager(me) then coalesce((
      select json_agg(x order by x.expiry) from (
        select p.id, p.name, doc.label, doc.expiry
        from public.employees e join public.profiles p on p.id = e.profile_id
        cross join lateral (values ('Visa', e.visa_expiry), ('Emirates ID', e.emirates_id_expiry), ('Passport', e.passport_expiry))
          as doc(label, expiry)
        where p.active and e.status = 'active' and doc.expiry is not null and doc.expiry <= private.today() + 60
        order by doc.expiry limit 20) x), '[]') end);
end $$;

-- -------------------------------------------------------------------------------------
-- Finance: posting engine (used by invoices, payments and the finance pages)
-- -------------------------------------------------------------------------------------

-- The account automatic postings use for a purpose, e.g. private.acct('ar').
create or replace function private.acct(p_key text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare
  v bigint;
begin
  select id into v from public.accounts where system_key = p_key;
  if v is null then
    raise exception 'The "%" account is missing from the chart of accounts', p_key using errcode = 'P0002';
  end if;
  return v;
end $$;

-- First day of the financial year containing a date (Jan-Dec).
create or replace function private.fy_start(p_date date) returns date
language sql immutable as $$ select make_date(extract(year from p_date)::int, 1, 1) $$;

create or replace function private.next_journal_number(p_date date) returns text
language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from p_date)::int;
  n int;
begin
  insert into public.invoice_counters (kind, year, last) values ('journal', y, 1)
  on conflict (kind, year) do update set last = public.invoice_counters.last + 1
  returning last into n;
  return format('JV-%s-%s', y, lpad(n::text, 4, '0'));
end $$;

-- Write a journal entry. p_lines: [{account_id, debit, credit, description, customer_id}]. Zero lines are skipped.
-- Returns the new id, or null if every line was zero. Debits must equal credits.
create or replace function private.post_journal(p_date date, p_kind text, p_memo text, p_reference text,
                                                p_source_type text, p_source_id bigint, p_lines jsonb, p_user uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  locked date := (select books_locked_until from public.company_settings where id = 1);
  dr     numeric := 0;
  cr     numeric := 0;
  ln     jsonb;
  n      int := 0;
  v_id   bigint;
begin
  if p_date is null then
    raise exception 'The entry needs a date' using errcode = '22023';
  end if;
  if locked is not null and p_date <= locked then
    raise exception 'The books are closed up to %. Use a later date, or ask an administrator to reopen them.', to_char(locked, 'DD Mon YYYY')
      using errcode = '22023';
  end if;
  select coalesce(sum((l ->> 'debit')::numeric), 0), coalesce(sum((l ->> 'credit')::numeric), 0) into dr, cr
  from jsonb_array_elements(p_lines) l;
  if dr <> cr then
    raise exception 'Debits (AED %) and credits (AED %) must be equal', to_char(dr, 'FM999,999,999,990.00'), to_char(cr, 'FM999,999,999,990.00')
      using errcode = '22023';
  end if;
  if dr = 0 then
    return null;
  end if;
  insert into public.journals (number, entry_date, kind, memo, reference, source_type, source_id, created_by)
  values (private.next_journal_number(p_date), p_date, p_kind, left(p_memo, 500), left(p_reference, 100), p_source_type, p_source_id, p_user)
  returning id into v_id;
  for ln in select value from jsonb_array_elements(p_lines) loop
    if coalesce((ln ->> 'debit')::numeric, 0) = 0 and coalesce((ln ->> 'credit')::numeric, 0) = 0 then
      continue;
    end if;
    n := n + 1;
    insert into public.journal_lines (journal_id, line_no, account_id, description, debit, credit, customer_id, supplier_id, work_type_id, department_id)
    values (v_id, n, (ln ->> 'account_id')::bigint, left(ln ->> 'description', 300),
            coalesce((ln ->> 'debit')::numeric, 0), coalesce((ln ->> 'credit')::numeric, 0), (ln ->> 'customer_id')::bigint,
            (ln ->> 'supplier_id')::bigint, (ln ->> 'work_type_id')::bigint, (ln ->> 'department_id')::bigint);
  end loop;
  return v_id;
end $$;

-- Reverse an entry: same lines with debit and credit swapped, linked both ways.
create or replace function private.reverse_journal(p_id bigint, p_date date, p_memo text, p_user uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  j     public.journals;
  v_id  bigint;
begin
  select * into j from public.journals where id = p_id for update;
  if j.id is null then
    raise exception 'Journal entry not found' using errcode = 'P0002';
  end if;
  if j.reversed_by_id is not null then
    raise exception 'This entry has already been reversed' using errcode = '22023';
  end if;
  if j.reverses_id is not null then
    raise exception 'This entry is itself a reversal' using errcode = '22023';
  end if;
  v_id := private.post_journal(p_date, 'reversal', coalesce(p_memo, 'Reversal of ' || j.number || coalesce(': ' || j.memo, '')),
    j.number, j.source_type, j.source_id,
    (select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit, 'credit', debit,
                                         'description', description, 'customer_id', customer_id, 'supplier_id', supplier_id,
                                         'work_type_id', work_type_id, 'department_id', department_id) order by line_no)
     from public.journal_lines where journal_id = p_id), p_user);
  update public.journals set reverses_id = p_id where id = v_id;
  update public.journals set reversed_by_id = v_id where id = p_id;
  return v_id;
end $$;

-- Post a tax invoice once it is issued: Dr receivables / Cr income (per line) / Cr VAT output.
-- Disbursement (out of scope) lines go to "disbursements recoverable"; others to the line's account,
-- the task's type of work's revenue account, or "other operating revenue".
-- Advances already received against the invoice then move from customer advances to receivables.
create or replace function private.post_invoice(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv   public.invoices;
  lines jsonb;
  pm    public.payments;
begin
  select * into inv from public.invoices where id = p_id;
  if inv.id is null or inv.kind <> 'tax' or inv.status not in ('sent', 'paid') then
    return;
  end if;
  if exists (select 1 from public.journals where source_type = 'invoice' and source_id = p_id and kind = 'invoice' and reversed_by_id is null) then
    return;
  end if;
  lines := jsonb_build_array(jsonb_build_object('account_id', private.acct('ar'), 'debit', inv.total, 'credit', 0,
                                                'description', inv.customer_name, 'customer_id', inv.customer_id));
  lines := lines || coalesce((
    select jsonb_agg(jsonb_build_object('account_id', x.acct, 'debit', 0, 'credit', x.amount, 'description', inv.number))
    from (
      select coalesce(l.account_id,
                      case when l.vat_code = 'out_of_scope' then private.acct('disbursements') end,
                      w.revenue_account_id, private.acct('revenue_other')) as acct,
             sum(l.net) as amount
      from public.invoice_lines l
      left join public.tasks t on t.id = inv.task_id
      left join public.work_types w on w.id = t.work_type_id
      where l.invoice_id = p_id
      group by 1) x), '[]');
  if inv.vat_total > 0 then
    lines := lines || jsonb_build_object('account_id', private.acct('vat_output'), 'debit', 0, 'credit', inv.vat_total,
                                         'description', 'VAT on ' || inv.number);
  end if;
  perform private.post_journal(inv.issue_date, 'invoice', format('Tax invoice %s - %s', inv.number, inv.customer_name),
                               inv.number, 'invoice', p_id, lines, inv.created_by);
  perform private.tag_journal((select max(id) from public.journals where source_type = 'invoice' and source_id = p_id and kind = 'invoice'),
                              inv.customer_id, (select work_type_id from public.tasks where id = inv.task_id), null);

  for pm in select * from public.payments where invoice_id = p_id and posted_side = 'advance' order by id loop
    if pm.cheque_status is distinct from 'bounced' then
      perform private.post_journal(greatest(inv.issue_date, pm.paid_on), 'payment',
        format('Advance applied to %s - %s', inv.number, inv.customer_name), inv.number, 'payment', pm.id,
        jsonb_build_array(
          jsonb_build_object('account_id', private.acct('customer_advances'), 'debit', pm.amount, 'credit', 0, 'customer_id', inv.customer_id),
          jsonb_build_object('account_id', private.acct('ar'), 'debit', 0, 'credit', pm.amount, 'customer_id', inv.customer_id)),
        inv.created_by);
    end if;
    update public.payments set posted_side = 'ar' where id = pm.id;
  end loop;
end $$;

-- Undo an invoice's posting (when it is cancelled).
create or replace function private.unpost_invoice(p_id bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  jid bigint;
begin
  for jid in select id from public.journals where source_type = 'invoice' and source_id = p_id and kind = 'invoice' and reversed_by_id is null loop
    perform private.reverse_journal(jid, private.today(), null, p_user);
  end loop;
end $$;

-- Where a payment's money sits for a cheque state: cheques in hand while pending, the bank once
-- cleared, and back on the customer's account (receivables or advances) if bounced.
create or replace function private.payment_account(pm public.payments, p_state text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_state = 'pending' then
    return private.acct('pdc');
  elsif p_state = 'bounced' then
    return case when pm.posted_side = 'advance' then private.acct('customer_advances') else private.acct('ar') end;
  end if;
  return coalesce(pm.account_id, case when pm.method = 'cash' then private.acct('cash') else private.acct('bank') end);
end $$;

-- Post a payment when recorded: Dr bank/cash (or cheques in hand) / Cr receivables, or customer
-- advances when the invoice is a proforma or a tax invoice not yet issued.
create or replace function private.post_payment(p_id bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pm   public.payments;
  inv  public.invoices;
  side text;
  state text;
begin
  select * into pm from public.payments where id = p_id;
  if pm.id is null or pm.posted_side is not null then
    return;
  end if;
  select * into inv from public.invoices where id = pm.invoice_id;
  side := case when inv.kind = 'tax' and inv.status in ('sent', 'paid') then 'ar' else 'advance' end;
  update public.payments set posted_side = side where id = p_id returning * into pm;
  state := coalesce(pm.cheque_status, 'cleared');
  if state = 'bounced' then
    return;   -- (only when catching up older records) a bounced cheque never moved any money
  end if;
  perform private.post_journal(pm.paid_on, 'payment',
    format('%s received for %s - %s', case pm.method when 'cheque' then 'Cheque ' || coalesce(pm.reference, '')
                                                     when 'cash' then 'Cash' when 'bank_transfer' then 'Bank transfer' else 'Payment' end,
           inv.number, inv.customer_name),
    coalesce(pm.reference, inv.number), 'payment', p_id,
    jsonb_build_array(
      jsonb_build_object('account_id', private.payment_account(pm, state), 'debit', pm.amount, 'credit', 0),
      jsonb_build_object('account_id', case side when 'ar' then private.acct('ar') else private.acct('customer_advances') end,
                         'debit', 0, 'credit', pm.amount, 'customer_id', inv.customer_id)),
    p_user);
end $$;

-- A cheque moved from one state to another: move the money between the matching accounts.
create or replace function private.post_cheque_change(p_id bigint, p_from text, p_to text, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pm  public.payments;
  inv public.invoices;
  dr  bigint;
  cr  bigint;
begin
  select * into pm from public.payments where id = p_id;
  if pm.id is null or p_from is not distinct from p_to then
    return;
  end if;
  select * into inv from public.invoices where id = pm.invoice_id;
  dr := private.payment_account(pm, p_to);
  cr := private.payment_account(pm, p_from);
  perform private.post_journal(private.today(), 'payment',
    format('Cheque %s %s - %s', coalesce(pm.reference, ''), case p_to when 'cleared' then 'cleared' when 'bounced' then 'bounced' else 'back to not cleared' end,
           inv.customer_name),
    coalesce(pm.reference, inv.number), 'payment', p_id,
    jsonb_build_array(
      jsonb_build_object('account_id', dr, 'debit', pm.amount, 'credit', 0,
                         'customer_id', case when dr in (private.acct('ar'), private.acct('customer_advances')) then inv.customer_id end),
      jsonb_build_object('account_id', cr, 'debit', 0, 'credit', pm.amount,
                         'customer_id', case when cr in (private.acct('ar'), private.acct('customer_advances')) then inv.customer_id end)),
    p_user);
end $$;

-- A payment deleted as a mistake: reverse everything it posted.
create or replace function private.unpost_payment(p_id bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  jid bigint;
begin
  for jid in select id from public.journals where source_type = 'payment' and source_id = p_id
             and reversed_by_id is null and reverses_id is null order by id desc loop
    perform private.reverse_journal(jid, greatest(private.today(), (select entry_date from public.journals where id = jid)), null, p_user);
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- API: finance (managers and admins; the chart of accounts and closing the books: admins)
-- -------------------------------------------------------------------------------------

-- Signed balance in the account's normal direction: debit-normal for assets and expenses.
create or replace function private.normal_balance(p_type text, p_dr numeric, p_cr numeric) returns numeric
language sql immutable as $$ select case when p_type in ('asset', 'expense') then p_dr - p_cr else p_cr - p_dr end $$;

create or replace function public.list_accounts(p_include_inactive boolean default true) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  fy date := private.fy_start(private.today());
begin
  return coalesce((select json_agg(x order by x.code) from (
    select a.id, a.code, a.name, a.type, a.subtype, a.system_key, a.bank_name, a.account_number, a.description, a.active,
           coalesce((select private.normal_balance(a.type, sum(l.debit), sum(l.credit))
                     from public.journal_lines l join public.journals j on j.id = l.journal_id
                     where l.account_id = a.id and (a.type not in ('income', 'expense') or j.entry_date >= fy)), 0) as balance,
           exists (select 1 from public.journal_lines l where l.account_id = a.id) as used
    from public.accounts a where p_include_inactive or a.active) x), '[]');
end $$;

create or replace function public.save_account(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_admin();
  d    jsonb := private.clean(p_data, '{
    "code":           {"type": "text", "required": true, "max": 6},
    "name":           {"type": "text", "required": true, "max": 100},
    "type":           {"type": "enum", "required": true, "values": ["asset", "liability", "equity", "income", "expense"]},
    "subtype":        {"type": "text", "required": true, "max": 30},
    "bank_name":      {"type": "text", "max": 100},
    "account_number": {"type": "text", "max": 50},
    "description":    {"type": "text", "max": 300},
    "active":         {"type": "bool"}
  }');
  old  public.accounts;
  errs jsonb := '{}';
  ok   boolean;
  v_id bigint;
begin
  if p_id is not null then
    select * into old from public.accounts where id = p_id;
    if old.id is null then
      raise exception 'Account not found' using errcode = 'P0002';
    end if;
  end if;
  if d ->> 'code' !~ '^\d{3,6}$' then errs := errs || '{"code": "Use 3 to 6 digits"}'; end if;
  ok := case d ->> 'type'
    when 'asset' then d ->> 'subtype' in ('cash', 'bank', 'pdc', 'receivable', 'current_asset', 'fixed_asset', 'vat_input')
    when 'liability' then d ->> 'subtype' in ('payable', 'vat_output', 'customer_advance', 'current_liability', 'long_term_liability')
    when 'equity' then d ->> 'subtype' in ('equity', 'retained_earnings', 'opening_equity')
    when 'income' then d ->> 'subtype' in ('revenue', 'other_income')
    else d ->> 'subtype' in ('cost_of_sales', 'expense') end;
  if not ok then errs := errs || '{"subtype": "Pick a group that matches the type"}'; end if;
  if old.system_key is not null and (d ->> 'type' <> old.type or d ->> 'subtype' <> old.subtype or not (d ->> 'active')::boolean) then
    errs := errs || '{"type": "This account is used by automatic postings: its type and group can''t change and it can''t be switched off"}';
  elsif old.id is not null and d ->> 'type' <> old.type and exists (select 1 from public.journal_lines where account_id = p_id) then
    errs := errs || '{"type": "This account already has entries, so its type can''t change"}';
  end if;
  if exists (select 1 from public.accounts where code = d ->> 'code' and id is distinct from p_id) then
    errs := errs || '{"code": "Another account already uses this code"}';
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  if p_id is null then
    insert into public.accounts (code, name, type, subtype, bank_name, account_number, description, active)
    values (d ->> 'code', d ->> 'name', d ->> 'type', d ->> 'subtype', d ->> 'bank_name', d ->> 'account_number', d ->> 'description',
            coalesce((p_data ->> 'active')::boolean, true))
    returning id into v_id;
    return v_id;
  end if;
  update public.accounts set code = d ->> 'code', name = d ->> 'name', type = d ->> 'type', subtype = d ->> 'subtype',
    bank_name = d ->> 'bank_name', account_number = d ->> 'account_number', description = d ->> 'description',
    active = (d ->> 'active')::boolean
  where id = p_id;
  return p_id;
end $$;

create or replace function public.get_finance_settings() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  return (select json_build_object('books_locked_until', books_locked_until, 'today', private.today(),
                                   'fy_start', private.fy_start(private.today()))
          from public.company_settings where id = 1);
end $$;

-- Close the books up to a date (nothing can be posted on or before it). Empty reopens them.
create or replace function public.set_books_locked_until(p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_admin();
begin
  if p_date > private.today() then
    raise exception 'You can''t close the books for a future date' using errcode = '22023';
  end if;
  update public.company_settings set books_locked_until = p_date where id = 1;
end $$;

-- Manual journal entry. p_data: entry_date, kind (journal | adjustment | accrual | prepayment | opening),
-- memo, reference, reverse_on (optional: posts the reversal on that date too),
-- lines: [{account_id, description, debit, credit, customer_id}]
create or replace function public.post_manual_journal(p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  d     jsonb := private.clean(p_data, '{
    "entry_date": {"type": "date", "required": true},
    "kind":       {"type": "enum", "values": ["journal", "adjustment", "accrual", "prepayment", "opening"], "default": "journal"},
    "memo":       {"type": "text", "required": true, "max": 500},
    "reference":  {"type": "text", "max": 100},
    "reverse_on": {"type": "date"},
    "department_id": {"type": "int"}
  }');
  ln    jsonb;
  i     int := 0;
  dr    numeric;
  cr    numeric;
  acc   public.accounts;
  errs  text[] := '{}';
  clean jsonb := '[]';
  tdr   numeric := 0;
  tcr   numeric := 0;
  v_id  bigint;
begin
  if jsonb_typeof(p_data -> 'lines') <> 'array' or jsonb_array_length(p_data -> 'lines') < 2 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"lines": "Add at least two lines"}';
  end if;
  for ln in select value from jsonb_array_elements(p_data -> 'lines') loop
    i := i + 1;
    begin
      dr := coalesce(nullif(btrim(ln ->> 'debit'), '')::numeric, 0);
      cr := coalesce(nullif(btrim(ln ->> 'credit'), '')::numeric, 0);
    exception when others then
      errs := errs || format('Line %s: amounts must be numbers', i);
      continue;
    end;
    if dr = 0 and cr = 0 then
      continue;
    end if;
    select * into acc from public.accounts where id = nullif(ln ->> 'account_id', '')::bigint;
    if acc.id is null or not acc.active then
      errs := errs || format('Line %s: pick an account', i);
    elsif dr < 0 or cr < 0 or (dr > 0 and cr > 0) or scale(dr) > 2 or scale(cr) > 2 then
      errs := errs || format('Line %s: enter either a debit or a credit, 0 or more, with at most 2 decimals', i);
    elsif d ->> 'kind' = 'opening' and acc.type in ('income', 'expense') then
      errs := errs || format('Line %s: opening balances are for balance sheet accounts only (not income or expenses)', i);
    else
      tdr := tdr + dr;
      tcr := tcr + cr;
      clean := clean || jsonb_build_object('account_id', acc.id, 'debit', dr, 'credit', cr,
        'description', nullif(btrim(ln ->> 'description'), ''),
        'customer_id', case when acc.subtype in ('receivable', 'customer_advance') then nullif(ln ->> 'customer_id', '')::bigint end);
    end if;
  end loop;
  if array_length(errs, 1) > 0 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = jsonb_build_object('lines', array_to_string(errs, '. '))::text;
  end if;
  if tdr = 0 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"lines": "Enter the amounts"}';
  end if;
  if tdr <> tcr then
    raise exception 'Please fix the highlighted fields' using errcode = '22023',
      detail = jsonb_build_object('lines', format('Debits (AED %s) and credits (AED %s) differ by AED %s',
        to_char(tdr, 'FM999,999,999,990.00'), to_char(tcr, 'FM999,999,999,990.00'), to_char(abs(tdr - tcr), 'FM999,999,999,990.00')))::text;
  end if;
  if (d ->> 'reverse_on')::date <= (d ->> 'entry_date')::date then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"reverse_on": "Must be after the entry date"}';
  end if;
  v_id := private.post_journal((d ->> 'entry_date')::date, d ->> 'kind', d ->> 'memo', d ->> 'reference', null, null, clean, me.id);
  perform private.tag_journal(v_id, null, null, (d ->> 'department_id')::bigint);
  if d ->> 'reverse_on' is not null then
    perform private.reverse_journal(v_id, (d ->> 'reverse_on')::date, null, me.id);
  end if;
  return v_id;
end $$;

-- Reverse an entry. Automatic entries are changed through their invoice or payment instead.
create or replace function public.reverse_entry(p_id bigint, p_date date, p_memo text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  j  public.journals;
begin
  select * into j from public.journals where id = p_id;
  if j.id is null then
    raise exception 'Journal entry not found' using errcode = 'P0002';
  end if;
  if j.source_type is not null then
    raise exception 'This entry was made automatically from an % - cancel or correct the % instead', j.source_type, j.source_type
      using errcode = '22023';
  end if;
  if p_date < j.entry_date then
    raise exception 'The reversal can''t be dated before the entry' using errcode = '22023';
  end if;
  return private.reverse_journal(p_id, coalesce(p_date, private.today()), nullif(btrim(p_memo), ''), me.id);
end $$;

-- Money in / money out of a bank or cash account, or a transfer between two of them.
-- p_data: kind (in | out | transfer), entry_date, account_id (the bank/cash account), other_account_id
-- (what it was for; for a transfer, the account the money goes to), amount, memo, reference
create or replace function public.bank_transaction(p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  d     jsonb := private.clean(p_data, '{
    "kind":             {"type": "enum", "required": true, "values": ["in", "out", "transfer"]},
    "entry_date":       {"type": "date", "required": true},
    "account_id":       {"type": "int", "required": true},
    "other_account_id": {"type": "int", "required": true},
    "memo":             {"type": "text", "required": true, "max": 500},
    "reference":        {"type": "text", "max": 100}
  }');
  bank  public.accounts;
  other public.accounts;
  amt   numeric;
  errs  jsonb := '{}';
begin
  select * into bank from public.accounts where id = (d ->> 'account_id')::bigint;
  select * into other from public.accounts where id = (d ->> 'other_account_id')::bigint;
  if bank.id is null or bank.subtype not in ('bank', 'cash') or not bank.active then
    errs := errs || '{"account_id": "Pick a bank or cash account"}';
  end if;
  if other.id is null or not other.active or other.id = bank.id then
    errs := errs || '{"other_account_id": "Pick a different account"}';
  elsif d ->> 'kind' = 'transfer' and other.subtype not in ('bank', 'cash') then
    errs := errs || '{"other_account_id": "Transfers go to another bank or cash account"}';
  end if;
  begin
    amt := nullif(btrim(p_data ->> 'amount'), '')::numeric;
  exception when others then amt := null;
  end;
  if amt is null or amt <= 0 or scale(amt) > 2 then
    errs := errs || '{"amount": "Enter an amount above 0, with at most 2 decimals"}';
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  return private.post_journal((d ->> 'entry_date')::date,
    case d ->> 'kind' when 'in' then 'bank_receipt' when 'out' then 'bank_payment' else 'transfer' end,
    d ->> 'memo', d ->> 'reference', null, null,
    case when d ->> 'kind' = 'in' then jsonb_build_array(
        jsonb_build_object('account_id', bank.id, 'debit', amt, 'credit', 0),
        jsonb_build_object('account_id', other.id, 'debit', 0, 'credit', amt))
      else jsonb_build_array(
        jsonb_build_object('account_id', other.id, 'debit', amt, 'credit', 0),
        jsonb_build_object('account_id', bank.id, 'debit', 0, 'credit', amt)) end,
    me.id);
end $$;

-- Bank and cash accounts (and cheques in hand) with their balances.
create or replace function public.cash_accounts() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  return coalesce((select json_agg(x order by x.subtype desc, x.code) from (
    select a.id, a.code, a.name, a.subtype, a.bank_name, a.account_number, a.active,
           coalesce((select sum(l.debit - l.credit) from public.journal_lines l where l.account_id = a.id), 0) as balance
    from public.accounts a where a.subtype in ('bank', 'cash', 'pdc')) x), '[]');
end $$;

-- kind: '' | manual (journal, adjustment, accrual, prepayment, opening) | automatic | a single kind
create or replace function public.list_journals(
  p_q text default null, p_kind text default null, p_from date default null, p_to date default null, p_page int default 1
) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me        public.profiles := private.current_manager();
  page_size constant int := 50;
  pg        int := greatest(coalesce(p_page, 1), 1);
  pat       text;
  total     bigint;
  v_rows    json;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  with f as (
    select j.* from public.journals j
    where (pat is null or j.number ilike pat or j.memo ilike pat or j.reference ilike pat)
      and (case coalesce(p_kind, '')
             when '' then true
             when 'manual' then j.kind in ('journal', 'adjustment', 'accrual', 'prepayment', 'opening', 'bank_receipt', 'bank_payment', 'transfer')
             when 'automatic' then j.source_type is not null
             else j.kind = p_kind end)
      and (p_from is null or j.entry_date >= p_from)
      and (p_to is null or j.entry_date <= p_to)
  )
  select (select count(*) from f),
         coalesce((select json_agg(x order by x.entry_date desc, x.id desc) from (
           select f.id, f.number, f.entry_date, f.kind, f.memo, f.reference, f.source_type, f.source_id, f.reverses_id, f.reversed_by_id,
                  (select sum(debit) from public.journal_lines where journal_id = f.id) as amount
           from f order by f.entry_date desc, f.id desc limit page_size offset (pg - 1) * page_size) x), '[]')
  into total, v_rows;
  return json_build_object('journals', v_rows, 'total', total, 'page', pg, 'pageSize', page_size);
end $$;

create or replace function public.get_journal(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  result json;
begin
  select json_build_object(
    'journal', to_jsonb(j) || jsonb_build_object(
      'created_by_name', u.name,
      'reverses_number', (select number from public.journals where id = j.reverses_id),
      'reversed_by_number', (select number from public.journals where id = j.reversed_by_id),
      'source', case j.source_type
        when 'invoice' then (select jsonb_build_object('label', i.number, 'invoice_id', i.id) from public.invoices i where i.id = j.source_id)
        when 'payment' then coalesce(
          (select jsonb_build_object('label', 'Payment on ' || i.number, 'invoice_id', i.id)
           from public.payments p join public.invoices i on i.id = p.invoice_id where p.id = j.source_id),
          jsonb_build_object('label', 'Deleted payment'))
        when 'bill' then (select jsonb_build_object('label', b.number || ' (' || b.supplier_ref || ')', 'bill_id', b.id) from public.bills b where b.id = j.source_id)
        when 'supplier_payment' then (select jsonb_build_object('label', sp.number, 'supplier_payment_id', sp.id) from public.supplier_payments sp where sp.id = j.source_id)
        when 'credit_note' then (select jsonb_build_object('label', c.number, 'credit_note_id', c.id) from public.credit_notes c where c.id = j.source_id)
        when 'receipt' then (select jsonb_build_object('label', r.number, 'receipt_id', r.id) from public.receipts r where r.id = j.source_id)
        when 'petty_cash' then (select jsonb_build_object('label', e.number || ' - ' || e.payee, 'petty_cash', true) from public.petty_cash_expenses e where e.id = j.source_id) end,
      'lines', (select jsonb_agg(jsonb_build_object('account_id', l.account_id, 'code', a.code, 'account', a.name,
                  'description', l.description, 'debit', l.debit, 'credit', l.credit,
                  'customer_id', l.customer_id, 'customer_name', c.name,
                  'supplier_id', l.supplier_id, 'supplier_name', sup.name) order by l.line_no)
                from public.journal_lines l join public.accounts a on a.id = l.account_id
                left join public.customers c on c.id = l.customer_id
                left join public.suppliers sup on sup.id = l.supplier_id
                where l.journal_id = j.id)))
  into result
  from public.journals j left join public.profiles u on u.id = j.created_by
  where j.id = p_id;
  if result is null then
    raise exception 'Journal entry not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- Ledger of one account between two dates: opening balance, each line with a running balance, closing balance.
-- Income and expense accounts start from zero at the beginning of each financial year.
create or replace function public.account_ledger(p_account bigint, p_from date, p_to date, p_customer bigint default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me      public.profiles := private.current_manager();
  a       public.accounts;
  f       date := coalesce(p_from, private.fy_start(private.today()));
  t       date := coalesce(p_to, private.today());
  opening numeric;
begin
  select * into a from public.accounts where id = p_account;
  if a.id is null then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  select coalesce(private.normal_balance(a.type, sum(l.debit), sum(l.credit)), 0) into opening
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.account_id = a.id and j.entry_date < f
    and (a.type not in ('income', 'expense') or j.entry_date >= private.fy_start(f))
    and (p_customer is null or l.customer_id = p_customer);
  return json_build_object(
    'account', to_jsonb(a), 'from', f, 'to', t, 'opening', opening,
    'customer', (select name from public.customers where id = p_customer),
    'lines', coalesce((select json_agg(x order by x.entry_date, x.journal_id, x.line_id) from (
      select j.id as journal_id, l.id as line_id, j.number, j.entry_date, j.kind, j.memo, j.source_type, j.source_id,
             l.description, l.debit, l.credit, l.customer_id, c.name as customer_name, l.supplier_id,
             (select name from public.suppliers where id = l.supplier_id) as supplier_name,
             opening + sum(private.normal_balance(a.type, l.debit, l.credit)) over (order by j.entry_date, j.id, l.id) as balance
      from public.journal_lines l join public.journals j on j.id = l.journal_id
      left join public.customers c on c.id = l.customer_id
      where l.account_id = a.id and j.entry_date between f and t and (p_customer is null or l.customer_id = p_customer)) x), '[]'),
    'closing', opening + coalesce((select sum(private.normal_balance(a.type, l.debit, l.credit))
      from public.journal_lines l join public.journals j on j.id = l.journal_id
      where l.account_id = a.id and j.entry_date between f and t and (p_customer is null or l.customer_id = p_customer)), 0));
end $$;

-- Trial balance between two dates: opening, debits, credits and closing for each account (signed: + debit, - credit).
-- Income and expense accounts open at zero each financial year; earlier years' profit shows in retained earnings.
create or replace function public.trial_balance(p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  f     date := coalesce(p_from, private.fy_start(private.today()));
  t     date := coalesce(p_to, private.today());
  fy    date := private.fy_start(f);
  prior numeric;
  rows  json;
begin
  -- Profit or loss of earlier years (debit - credit of income and expense accounts before this financial year).
  select coalesce(sum(l.debit - l.credit), 0) into prior
  from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
  where a.type in ('income', 'expense') and j.entry_date < fy;

  select coalesce(json_agg(x order by x.code), '[]') into rows from (
    select a.id, a.code, a.name, a.type, a.subtype,
           coalesce(sum(l.debit - l.credit) filter (where j.entry_date < f and (a.type not in ('income', 'expense') or j.entry_date >= fy)), 0)
             + case when a.system_key = 'retained_earnings' then prior else 0 end as opening,
           coalesce(sum(l.debit) filter (where j.entry_date between f and t), 0) as debit,
           coalesce(sum(l.credit) filter (where j.entry_date between f and t), 0) as credit
    from public.accounts a
    left join public.journal_lines l on l.account_id = a.id
    left join public.journals j on j.id = l.journal_id and j.entry_date <= t
    group by a.id
    having a.system_key = 'retained_earnings' and prior <> 0
        or coalesce(sum(l.debit - l.credit) filter (where j.entry_date < f and (a.type not in ('income', 'expense') or j.entry_date >= fy)), 0) <> 0
        or coalesce(sum(l.debit) filter (where j.entry_date between f and t), 0) <> 0
        or coalesce(sum(l.credit) filter (where j.entry_date between f and t), 0) <> 0) x;
  return json_build_object('from', f, 'to', t, 'rows', rows);
end $$;

-- Profit and loss between two dates, by account (amounts positive when they add to profit or cost).
create or replace function public.profit_loss(p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  f  date := coalesce(p_from, private.fy_start(private.today()));
  t  date := coalesce(p_to, private.today());
begin
  return json_build_object('from', f, 'to', t, 'rows', coalesce((select json_agg(x order by x.code) from (
    select a.id, a.code, a.name, a.type, a.subtype, private.normal_balance(a.type, sum(l.debit), sum(l.credit)) as amount
    from public.accounts a
    join public.journal_lines l on l.account_id = a.id
    join public.journals j on j.id = l.journal_id
    where a.type in ('income', 'expense') and j.entry_date between f and t
    group by a.id
    having sum(l.debit) <> sum(l.credit)) x), '[]'));
end $$;

-- Balance sheet at a date. Profit of earlier years is added to retained earnings; this year's profit is shown separately.
create or replace function public.balance_sheet(p_as_of date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  t      date := coalesce(p_as_of, private.today());
  fy     date := private.fy_start(t);
  prior  numeric;
  profit numeric;
begin
  select coalesce(sum(l.credit - l.debit) filter (where j.entry_date < fy), 0),
         coalesce(sum(l.credit - l.debit) filter (where j.entry_date between fy and t), 0)
  into prior, profit
  from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
  where a.type in ('income', 'expense') and j.entry_date <= t;

  return json_build_object('as_of', t, 'fy_start', fy, 'current_year_profit', profit,
    'rows', coalesce((select json_agg(x order by x.code) from (
      select a.id, a.code, a.name, a.type, a.subtype,
             coalesce(private.normal_balance(a.type, sum(l.debit), sum(l.credit)), 0)
               + case when a.system_key = 'retained_earnings' then prior else 0 end as amount
      from public.accounts a
      left join public.journal_lines l on l.account_id = a.id
      left join public.journals j on j.id = l.journal_id
      where a.type in ('asset', 'liability', 'equity') and (j.id is null or j.entry_date <= t)
      group by a.id
      having coalesce(sum(l.debit), 0) <> coalesce(sum(l.credit), 0) or (a.system_key = 'retained_earnings' and prior <> 0)) x), '[]'));
end $$;

-- Finance home page: bank and cash, receivables, VAT, this month's and this year's results, recent entries.
create or replace function public.finance_overview() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  t  date := private.today();
  m  date := date_trunc('month', t)::date;
  fy date := private.fy_start(t);
  q  date := date_trunc('quarter', t)::date;
begin
  return json_build_object(
    'today', t, 'month_start', m, 'fy_start', fy, 'quarter_start', q,
    'books_locked_until', (select books_locked_until from public.company_settings where id = 1),
    'cash', public.cash_accounts(),
    'receivables', (select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines l where l.account_id = private.acct('ar')),
    'advances', (select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines l where l.account_id = private.acct('customer_advances')),
    'payables', (select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines l where l.account_id = private.acct('ap')),
    'recurring_due', (select count(*) from public.recurring_invoices where active and next_date <= t),
    'journals_due', (select count(*) from public.recurring_journals where active and next_date <= t),
    'schedules_due', (select coalesce(sum((r ->> 'due')::int), 0) from json_array_elements(public.list_schedules() -> 'rows') r),
    'unreconciled', (select count(*) from public.bank_statement_lines where journal_line_id is null),
    'vat_output_quarter', (select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines l join public.journals j on j.id = l.journal_id
                           where l.account_id = private.acct('vat_output') and j.entry_date between q and t),
    'month', (select json_build_object(
                'income', coalesce(sum(l.credit - l.debit) filter (where a.type = 'income'), 0),
                'expenses', coalesce(sum(l.debit - l.credit) filter (where a.type = 'expense'), 0))
              from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
              where j.entry_date between m and t),
    'year', (select json_build_object(
                'income', coalesce(sum(l.credit - l.debit) filter (where a.type = 'income'), 0),
                'expenses', coalesce(sum(l.debit - l.credit) filter (where a.type = 'expense'), 0))
              from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
              where j.entry_date between fy and t),
    'recent', coalesce((select json_agg(x order by x.entry_date desc, x.id desc) from (
      select j.id, j.number, j.entry_date, j.kind, j.memo, (select sum(debit) from public.journal_lines where journal_id = j.id) as amount
      from public.journals j order by j.entry_date desc, j.id desc limit 8) x), '[]'));
end $$;

-- Income account for a type of work (used when its tasks' invoices are posted).
create or replace function public.set_work_type_account(p_id bigint, p_account_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  if p_account_id is not null and not exists (select 1 from public.accounts where id = p_account_id and type = 'income' and active) then
    raise exception 'Pick an income account' using errcode = '22023';
  end if;
  update public.work_types set revenue_account_id = p_account_id where id = p_id;
  if not found then
    raise exception 'Type of work not found' using errcode = 'P0002';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- API: suppliers, bills, payment vouchers, allocations, payables reports, VAT return
-- -------------------------------------------------------------------------------------

create or replace function private.next_doc_number(p_kind text, p_prefix text, p_date date) returns text
language plpgsql security definer set search_path = '' as $$
declare
  y int := extract(year from p_date)::int;
  n int;
begin
  insert into public.invoice_counters (kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = public.invoice_counters.last + 1
  returning last into n;
  return format('%s-%s-%s', p_prefix, y, lpad(n::text, 4, '0'));
end $$;

-- Recalculate how much of a bill is settled (or of a credit note is used).
create or replace function private.refresh_bill(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bills b set amount_allocated = coalesce((
    select sum(a.amount) from public.bill_allocations a
    where (b.kind = 'bill' and a.bill_id = b.id) or (b.kind = 'credit_note' and a.credit_note_id = b.id)), 0)
  where b.id = p_id;
end $$;

-- Unallocated part of a payment voucher.
create or replace function private.payment_unallocated(p_id bigint) returns numeric
language sql stable security definer set search_path = '' as $$
  select p.amount - coalesce((select sum(a.amount) from public.bill_allocations a where a.payment_id = p.id), 0)
  from public.supplier_payments p where p.id = p_id and p.status = 'posted'
$$;

create or replace function public.supplier_options() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  return coalesce((select json_agg(json_build_object('id', id, 'name', name, 'trn', trn, 'payment_terms_days', payment_terms_days,
      'default_expense_account_id', default_expense_account_id, 'active', active) order by lower(name)) from public.suppliers), '[]');
end $$;

-- Suppliers with what is owed to them (positive) from the ledger, overdue bills and unused advances/credits.
create or replace function public.list_suppliers(p_q text default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  t   date := private.today();
  pat text;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return coalesce((select json_agg(x order by lower(x.name)) from (
    select s.id, s.name, s.trn, s.email, s.phone, s.payment_terms_days, s.active,
           coalesce((select sum(l.credit - l.debit) from public.journal_lines l where l.supplier_id = s.id and l.account_id = private.acct('ap')), 0) as balance,
           coalesce((select sum(b.total - b.amount_allocated) from public.bills b
                     where b.supplier_id = s.id and b.kind = 'bill' and b.status = 'posted' and b.total > b.amount_allocated
                       and coalesce(b.due_date, b.bill_date) < t), 0) as overdue,
           coalesce((select sum(private.payment_unallocated(p.id)) from public.supplier_payments p where p.supplier_id = s.id and p.status = 'posted'), 0)
             + coalesce((select sum(b.total - b.amount_allocated) from public.bills b
                         where b.supplier_id = s.id and b.kind = 'credit_note' and b.status = 'posted'), 0) as unallocated
    from public.suppliers s
    where pat is null or s.name ilike pat or s.trn ilike pat or s.email ilike pat) x), '[]');
end $$;

create or replace function public.save_supplier(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_manager();
  d    jsonb := private.clean(p_data, '{
    "name":                       {"type": "text", "required": true, "max": 200},
    "trn":                        {"type": "text", "format": "trn"},
    "email":                      {"type": "text", "max": 200, "format": "email"},
    "phone":                      {"type": "text", "max": 30},
    "address":                    {"type": "text", "max": 500},
    "country":                    {"type": "text", "max": 100, "default": "United Arab Emirates"},
    "payment_terms_days":         {"type": "int"},
    "default_expense_account_id": {"type": "int"},
    "notes":                      {"type": "text", "max": 2000},
    "active":                     {"type": "bool"}
  }');
  v_id bigint;
begin
  if coalesce((d ->> 'payment_terms_days')::int, 30) > 365 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"payment_terms_days": "Use 0 to 365 days"}';
  end if;
  if d ->> 'default_expense_account_id' is not null and not exists (
       select 1 from public.accounts where id = (d ->> 'default_expense_account_id')::bigint and active and type in ('expense', 'asset')
         and subtype not in ('bank', 'cash', 'pdc', 'receivable', 'vat_input')) then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"default_expense_account_id": "Pick an expense or asset account"}';
  end if;
  if p_id is null then
    insert into public.suppliers (name, trn, email, phone, address, country, payment_terms_days, default_expense_account_id, notes, active)
    values (d ->> 'name', d ->> 'trn', d ->> 'email', d ->> 'phone', d ->> 'address', d ->> 'country',
            coalesce((d ->> 'payment_terms_days')::int, 30), (d ->> 'default_expense_account_id')::bigint, d ->> 'notes',
            coalesce((p_data ->> 'active')::boolean, true))
    returning id into v_id;
    return v_id;
  end if;
  update public.suppliers set name = d ->> 'name', trn = d ->> 'trn', email = d ->> 'email', phone = d ->> 'phone', address = d ->> 'address',
    country = d ->> 'country', payment_terms_days = coalesce((d ->> 'payment_terms_days')::int, 30),
    default_expense_account_id = (d ->> 'default_expense_account_id')::bigint, notes = d ->> 'notes', active = (d ->> 'active')::boolean
  where id = p_id;
  if not found then
    raise exception 'Supplier not found' using errcode = 'P0002';
  end if;
  return p_id;
end $$;

create or replace function public.get_supplier(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  r  json;
begin
  select json_build_object(
    'today', private.today(),
    'supplier', to_jsonb(s) || jsonb_build_object(
      'balance', coalesce((select sum(l.credit - l.debit) from public.journal_lines l where l.supplier_id = s.id and l.account_id = private.acct('ap')), 0),
      'default_account_name', (select code || ' · ' || name from public.accounts where id = s.default_expense_account_id)),
    'bills', coalesce((select json_agg(json_build_object('id', b.id, 'kind', b.kind, 'number', b.number, 'supplier_ref', b.supplier_ref,
        'bill_date', b.bill_date, 'due_date', b.due_date, 'status', b.status, 'total', b.total, 'amount_allocated', b.amount_allocated)
        order by b.bill_date desc, b.id desc) from public.bills b where b.supplier_id = s.id), '[]'),
    'payments', coalesce((select json_agg(json_build_object('id', p.id, 'number', p.number, 'paid_on', p.paid_on, 'amount', p.amount,
        'method', p.method, 'status', p.status, 'unallocated', coalesce(private.payment_unallocated(p.id), 0))
        order by p.paid_on desc, p.id desc) from public.supplier_payments p where p.supplier_id = s.id), '[]'))
  into r from public.suppliers s where s.id = p_id;
  if r is null then
    raise exception 'Supplier not found' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- Create (p_id null) or edit a draft bill or supplier credit note. Returns its id.
-- p_data: kind (create only), supplier_id, supplier_ref, bill_date, due_date, notes,
--         lines: [{description, account_id, quantity, unit_price, vat_code, recoverable}]
create or replace function public.save_bill(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  d      jsonb := private.clean(p_data, '{
    "kind":         {"type": "enum", "values": ["bill", "credit_note"], "default": "bill"},
    "supplier_id":  {"type": "int", "required": true},
    "supplier_ref": {"type": "text", "required": true, "max": 60},
    "bill_date":    {"type": "date", "required": true},
    "due_date":     {"type": "date"},
    "notes":        {"type": "text", "max": 1000},
    "customer_id":  {"type": "int"},
    "work_type_id": {"type": "int"},
    "department_id": {"type": "int"}
  }');
  v_old  public.bills;
  v_kind text;
  v_id   bigint;
  ln     jsonb;
  i      int := 0;
  qty    numeric;
  price  numeric;
  net    numeric;
  vat    numeric;
  acc    public.accounts;
  errs   jsonb := '{}';
  lerrs  text[] := '{}';
  clean  jsonb := '[]';
  sub    numeric := 0;
  vat_s  numeric := 0;
  vat_r  numeric := 0;
  dup    text;
begin
  if p_id is not null then
    select * into v_old from public.bills where id = p_id;
    if v_old.id is null then
      raise exception 'Bill not found' using errcode = 'P0002';
    end if;
    if v_old.status <> 'draft' then
      raise exception 'Only drafts can be changed. Cancel this one and enter it again if it is wrong.' using errcode = '22023';
    end if;
    v_kind := v_old.kind;
  else
    v_kind := d ->> 'kind';
  end if;
  if not exists (select 1 from public.suppliers where id = (d ->> 'supplier_id')::bigint) then
    errs := errs || '{"supplier_id": "Pick a supplier"}';
  end if;
  if (d ->> 'due_date')::date < (d ->> 'bill_date')::date then
    errs := errs || '{"due_date": "Can''t be before the document date"}';
  end if;
  select number into dup from public.bills
  where supplier_id = (d ->> 'supplier_id')::bigint and kind = v_kind and status <> 'cancelled'
    and lower(btrim(supplier_ref)) = lower(btrim(d ->> 'supplier_ref')) and id is distinct from p_id;
  if dup is not null then
    errs := errs || jsonb_build_object('supplier_ref', format('Already entered as %s: the same supplier document can''t be entered twice', dup));
  end if;

  if jsonb_typeof(p_data -> 'lines') <> 'array' or jsonb_array_length(p_data -> 'lines') = 0 then
    errs := errs || '{"lines": "Add at least one line"}';
  else
    for ln in select value from jsonb_array_elements(p_data -> 'lines') loop
      i := i + 1;
      begin
        qty := nullif(btrim(ln ->> 'quantity'), '')::numeric;
        price := nullif(btrim(ln ->> 'unit_price'), '')::numeric;
      exception when others then
        lerrs := lerrs || format('Line %s: quantity and price must be numbers', i);
        continue;
      end;
      select * into acc from public.accounts where id = nullif(ln ->> 'account_id', '')::bigint;
      if nullif(btrim(ln ->> 'description'), '') is null then
        lerrs := lerrs || format('Line %s: add a description', i);
      elsif acc.id is null or not acc.active or acc.type not in ('expense', 'asset')
            or acc.subtype in ('bank', 'cash', 'pdc', 'receivable', 'vat_input') then
        lerrs := lerrs || format('Line %s: pick an expense, cost or asset account', i);
      elsif qty is null or qty <= 0 or scale(qty) > 3 then
        lerrs := lerrs || format('Line %s: quantity must be more than 0', i);
      elsif price is null or price < 0 or scale(price) > 2 then
        lerrs := lerrs || format('Line %s: price must be 0 or more, with at most 2 decimals', i);
      elsif coalesce(ln ->> 'vat_code', '') not in ('standard', 'zero', 'exempt', 'out_of_scope', 'reverse_charge', 'import_goods') then
        lerrs := lerrs || format('Line %s: pick a VAT treatment', i);
      else
        net := round(qty * price, 2);
        vat := case when ln ->> 'vat_code' in ('standard', 'reverse_charge', 'import_goods') then round(net * 0.05, 2) else 0 end;
        sub := sub + net;
        if ln ->> 'vat_code' = 'standard' then vat_s := vat_s + vat; else vat_r := vat_r + vat; end if;
        clean := clean || jsonb_build_object('description', btrim(ln ->> 'description'), 'account_id', acc.id, 'quantity', qty,
          'unit_price', price, 'vat_code', ln ->> 'vat_code', 'net', net, 'vat', vat,
          'recoverable', coalesce((ln ->> 'recoverable')::boolean, true));
      end if;
    end loop;
    if array_length(lerrs, 1) > 0 then
      errs := errs || jsonb_build_object('lines', array_to_string(lerrs, '. '));
    end if;
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  if p_id is null then
    insert into public.bills (kind, number, supplier_id, supplier_ref, bill_date, due_date, notes, subtotal, vat_total, rcm_vat, total, created_by,
                              customer_id, work_type_id, department_id)
    values (v_kind, private.next_doc_number(case v_kind when 'bill' then 'bill' else 'supplier_credit' end,
                                           case v_kind when 'bill' then 'BILL' else 'SCN' end, (d ->> 'bill_date')::date),
            (d ->> 'supplier_id')::bigint, btrim(d ->> 'supplier_ref'), (d ->> 'bill_date')::date, (d ->> 'due_date')::date, d ->> 'notes',
            sub, vat_s, vat_r, sub + vat_s, me.id,
            (d ->> 'customer_id')::bigint, (d ->> 'work_type_id')::bigint, (d ->> 'department_id')::bigint)
    returning id into v_id;
  else
    v_id := p_id;
    update public.bills set supplier_id = (d ->> 'supplier_id')::bigint, supplier_ref = btrim(d ->> 'supplier_ref'),
      bill_date = (d ->> 'bill_date')::date, due_date = (d ->> 'due_date')::date, notes = d ->> 'notes',
      subtotal = sub, vat_total = vat_s, rcm_vat = vat_r, total = sub + vat_s,
      customer_id = (d ->> 'customer_id')::bigint, work_type_id = (d ->> 'work_type_id')::bigint, department_id = (d ->> 'department_id')::bigint
    where id = v_id;
    delete from public.bill_lines where bill_id = v_id;
  end if;
  insert into public.bill_lines (bill_id, position, description, account_id, quantity, unit_price, vat_code, recoverable, net, vat)
  select v_id, x.ord, x.l ->> 'description', (x.l ->> 'account_id')::bigint, (x.l ->> 'quantity')::numeric, (x.l ->> 'unit_price')::numeric,
         x.l ->> 'vat_code', (x.l ->> 'recoverable')::boolean, (x.l ->> 'net')::numeric, (x.l ->> 'vat')::numeric
  from jsonb_array_elements(clean) with ordinality as x(l, ord);
  return v_id;
exception when unique_violation then
  raise exception 'Please fix the highlighted fields' using errcode = '22023',
    detail = '{"supplier_ref": "This supplier document has already been entered"}';
end $$;

-- Post a draft bill (or credit note) to the ledger:
--   Dr each line's account (net, plus VAT that can't be recovered) / Dr VAT input (recoverable VAT)
--   Cr Accounts payable (the supplier's total); reverse charge VAT is also credited to VAT output.
-- A credit note posts the same the other way round.
create or replace function public.post_bill(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  b     public.bills;
  s     public.suppliers;
  dr    jsonb;
  lines jsonb;
  vin   numeric;
  vout  numeric;
  sign  int;
begin
  select * into b from public.bills where id = p_id for update;
  if b.id is null then
    raise exception 'Bill not found' using errcode = 'P0002';
  end if;
  if b.status <> 'draft' then
    raise exception 'This is already %', b.status using errcode = '22023';
  end if;
  select * into s from public.suppliers where id = b.supplier_id;
  sign := case b.kind when 'bill' then 1 else -1 end;

  select coalesce(jsonb_agg(jsonb_build_object('account_id', x.account_id, 'amount', x.amount)), '[]') into dr from (
    select l.account_id, sum(l.net + case when not l.recoverable then l.vat else 0 end) as amount
    from public.bill_lines l where l.bill_id = p_id group by l.account_id) x;
  select coalesce(sum(vat) filter (where recoverable), 0), coalesce(sum(vat) filter (where vat_code in ('reverse_charge', 'import_goods')), 0)
  into vin, vout from public.bill_lines where bill_id = p_id;

  lines := (select coalesce(jsonb_agg(jsonb_build_object('account_id', (e ->> 'account_id')::bigint,
              'debit', case when sign = 1 then (e ->> 'amount')::numeric else 0 end,
              'credit', case when sign = 1 then 0 else (e ->> 'amount')::numeric end, 'description', b.supplier_ref)), '[]')
            from jsonb_array_elements(dr) e);
  if vin > 0 then
    lines := lines || jsonb_build_object('account_id', private.acct('vat_input'), 'debit', case when sign = 1 then vin else 0 end,
                                         'credit', case when sign = 1 then 0 else vin end, 'description', 'VAT on ' || b.supplier_ref);
  end if;
  if vout > 0 then
    lines := lines || jsonb_build_object('account_id', private.acct('vat_output'), 'debit', case when sign = 1 then 0 else vout end,
                                         'credit', case when sign = 1 then vout else 0 end, 'description', 'Reverse charge VAT on ' || b.supplier_ref);
  end if;
  lines := lines || jsonb_build_object('account_id', private.acct('ap'), 'debit', case when sign = 1 then 0 else b.total end,
                                       'credit', case when sign = 1 then b.total else 0 end, 'description', s.name, 'supplier_id', s.id);

  perform private.post_journal(b.bill_date, case b.kind when 'bill' then 'bill' else 'supplier_credit' end,
    format('%s %s from %s (%s)', case b.kind when 'bill' then 'Bill' else 'Credit note' end, b.number, s.name, b.supplier_ref),
    b.supplier_ref, 'bill', p_id, lines, me.id);
  perform private.tag_journal((select max(id) from public.journals where source_type = 'bill' and source_id = p_id),
                              b.customer_id, b.work_type_id, b.department_id);
  update public.bills set status = 'posted', posted_at = now() where id = p_id;
end $$;

-- Cancel: drafts simply; posted ones are reversed (only when nothing is allocated against them).
create or replace function public.cancel_bill(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  b   public.bills;
  jid bigint;
begin
  select * into b from public.bills where id = p_id for update;
  if b.id is null then
    raise exception 'Bill not found' using errcode = 'P0002';
  end if;
  if b.status = 'cancelled' then
    return;
  end if;
  if exists (select 1 from public.bill_allocations where bill_id = p_id or credit_note_id = p_id) then
    raise exception 'Payments or credit notes are allocated to this. Remove those allocations first.' using errcode = '22023';
  end if;
  for jid in select id from public.journals where source_type = 'bill' and source_id = p_id and reversed_by_id is null and reverses_id is null loop
    perform private.reverse_journal(jid, greatest(private.today(), b.bill_date), null, me.id);
  end loop;
  update public.bills set status = 'cancelled', cancelled_at = now() where id = p_id;
end $$;

create or replace function public.get_bill(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  r  json;
begin
  select json_build_object(
    'today', private.today(),
    'bill', to_jsonb(b) || jsonb_build_object(
      'supplier_name', s.name, 'supplier_trn', s.trn,
      'lines', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('account', a.code || ' · ' || a.name) order by l.position)
                         from public.bill_lines l join public.accounts a on a.id = l.account_id where l.bill_id = b.id), '[]'),
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('id', al.id, 'amount', al.amount, 'created_at', al.created_at,
          'bill_id', al.bill_id, 'bill_number', bb.number,
          'source', case when al.payment_id is not null then (select number from public.supplier_payments where id = al.payment_id)
                         else (select number from public.bills where id = al.credit_note_id) end,
          'payment_id', al.payment_id, 'credit_note_id', al.credit_note_id) order by al.id)
        from public.bill_allocations al join public.bills bb on bb.id = al.bill_id
        where al.bill_id = b.id or al.credit_note_id = b.id), '[]'),
      'journal_id', (select id from public.journals where source_type = 'bill' and source_id = b.id and reverses_id is null order by id limit 1)),
    -- for a bill: the supplier's unused payments and credit notes; for a credit note: the supplier's unpaid bills
    'open_items', case when b.kind = 'bill' then coalesce((
        select jsonb_agg(x) from (
          select 'payment' as type, p.id, p.number, p.paid_on as date, private.payment_unallocated(p.id) as available
          from public.supplier_payments p where p.supplier_id = b.supplier_id and p.status = 'posted' and private.payment_unallocated(p.id) > 0
          union all
          select 'credit_note', c.id, c.number, c.bill_date, c.total - c.amount_allocated
          from public.bills c where c.supplier_id = b.supplier_id and c.kind = 'credit_note' and c.status = 'posted' and c.total > c.amount_allocated) x), '[]')
      else coalesce((select jsonb_agg(jsonb_build_object('type', 'bill', 'id', o.id, 'number', o.number, 'date', o.bill_date,
          'available', o.total - o.amount_allocated))
        from public.bills o where o.supplier_id = b.supplier_id and o.kind = 'bill' and o.status = 'posted' and o.total > o.amount_allocated), '[]') end)
  into r
  from public.bills b join public.suppliers s on s.id = b.supplier_id
  where b.id = p_id;
  if r is null then
    raise exception 'Bill not found' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- status: '' | draft | open (posted, not fully settled) | overdue | paid | cancelled
create or replace function public.list_bills(p_q text default null, p_kind text default null, p_status text default null,
                                             p_supplier bigint default null, p_page int default 1) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me        public.profiles := private.current_manager();
  t         date := private.today();
  page_size constant int := 25;
  pg        int := greatest(coalesce(p_page, 1), 1);
  pat       text;
  total     bigint;
  v_rows    json;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  with f as (
    select b.*, s.name as supplier_name from public.bills b join public.suppliers s on s.id = b.supplier_id
    where (pat is null or b.number ilike pat or b.supplier_ref ilike pat or s.name ilike pat)
      and (coalesce(p_kind, '') = '' or b.kind = p_kind)
      and (p_supplier is null or b.supplier_id = p_supplier)
      and (case coalesce(p_status, '')
             when '' then true
             when 'open' then b.status = 'posted' and b.total > b.amount_allocated
             when 'overdue' then b.status = 'posted' and b.kind = 'bill' and b.total > b.amount_allocated and coalesce(b.due_date, b.bill_date) < t
             when 'paid' then b.status = 'posted' and b.total <= b.amount_allocated
             else b.status = p_status end)
  )
  select (select count(*) from f), coalesce((select json_agg(x order by x.bill_date desc, x.id desc) from (
    select f.id, f.kind, f.number, f.supplier_id, f.supplier_name, f.supplier_ref, f.bill_date, f.due_date, f.status, f.total, f.amount_allocated
    from f order by f.bill_date desc, f.id desc limit page_size offset (pg - 1) * page_size) x), '[]')
  into total, v_rows;
  return json_build_object('bills', v_rows, 'total', total, 'page', pg, 'pageSize', page_size, 'today', t);
end $$;

-- Pay a supplier from a bank or cash account (payment voucher), allocating it to bills.
-- p_data: supplier_id, paid_on, amount, method, account_id, reference, notes, allocations: [{bill_id, amount}]
-- Whatever is not allocated stays as an advance to the supplier.
create or replace function public.record_supplier_payment(p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  d     jsonb := private.clean(p_data, '{
    "supplier_id": {"type": "int", "required": true},
    "paid_on":     {"type": "date", "required": true},
    "method":      {"type": "enum", "required": true, "values": ["bank_transfer", "cash", "cheque", "other"]},
    "account_id":  {"type": "int", "required": true},
    "reference":   {"type": "text", "max": 100},
    "notes":       {"type": "text", "max": 1000}
  }');
  s     public.suppliers;
  amt   numeric;
  errs  jsonb := '{}';
  al    jsonb;
  b     public.bills;
  a_amt numeric;
  alloc numeric := 0;
  lerrs text[] := '{}';
  v_id  bigint;
  num   text;
begin
  select * into s from public.suppliers where id = (d ->> 'supplier_id')::bigint;
  if s.id is null then errs := errs || '{"supplier_id": "Pick a supplier"}'; end if;
  if not exists (select 1 from public.accounts where id = (d ->> 'account_id')::bigint and subtype in ('bank', 'cash') and active) then
    errs := errs || '{"account_id": "Pick a bank or cash account"}';
  end if;
  begin
    amt := nullif(btrim(p_data ->> 'amount'), '')::numeric;
  exception when others then amt := null;
  end;
  if amt is null or amt <= 0 or scale(amt) > 2 then
    errs := errs || '{"amount": "Enter an amount above 0, with at most 2 decimals"}';
  end if;
  if (d ->> 'paid_on')::date > private.today() then
    errs := errs || '{"paid_on": "Can''t be in the future"}';
  end if;
  for al in select value from jsonb_array_elements(coalesce(p_data -> 'allocations', '[]')) loop
    begin
      a_amt := coalesce(nullif(btrim(al ->> 'amount'), '')::numeric, 0);
    exception when others then a_amt := -1;
    end;
    continue when a_amt = 0;
    select * into b from public.bills where id = (al ->> 'bill_id')::bigint;
    if b.id is null or b.kind <> 'bill' or b.status <> 'posted' or b.supplier_id is distinct from s.id then
      lerrs := lerrs || 'An allocation is to a bill that isn''t open for this supplier';
    elsif a_amt < 0 or scale(a_amt) > 2 or a_amt > b.total - b.amount_allocated then
      lerrs := lerrs || format('%s: allocate between 0 and its balance of AED %s', b.number, to_char(b.total - b.amount_allocated, 'FM999,999,999,990.00'));
    else
      alloc := alloc + a_amt;
    end if;
  end loop;
  if amt is not null and alloc > amt then
    lerrs := lerrs || format('Allocations (AED %s) add up to more than the payment', to_char(alloc, 'FM999,999,999,990.00'));
  end if;
  if array_length(lerrs, 1) > 0 then errs := errs || jsonb_build_object('allocations', array_to_string(lerrs, '. ')); end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  num := private.next_doc_number('supplier_payment', 'PV', (d ->> 'paid_on')::date);
  insert into public.supplier_payments (number, supplier_id, paid_on, amount, method, account_id, reference, notes, created_by)
  values (num, s.id, (d ->> 'paid_on')::date, amt, d ->> 'method', (d ->> 'account_id')::bigint, d ->> 'reference', d ->> 'notes', me.id)
  returning id into v_id;
  perform private.post_journal((d ->> 'paid_on')::date, 'supplier_payment', format('Payment %s to %s', num, s.name),
    coalesce(d ->> 'reference', num), 'supplier_payment', v_id,
    jsonb_build_array(
      jsonb_build_object('account_id', private.acct('ap'), 'debit', amt, 'credit', 0, 'description', s.name, 'supplier_id', s.id),
      jsonb_build_object('account_id', (d ->> 'account_id')::bigint, 'debit', 0, 'credit', amt, 'description', s.name)),
    me.id);
  for al in select value from jsonb_array_elements(coalesce(p_data -> 'allocations', '[]')) loop
    a_amt := coalesce(nullif(btrim(al ->> 'amount'), '')::numeric, 0);
    continue when a_amt = 0;
    insert into public.bill_allocations (bill_id, payment_id, amount, created_by) values ((al ->> 'bill_id')::bigint, v_id, a_amt, me.id);
    perform private.refresh_bill((al ->> 'bill_id')::bigint);
  end loop;
  return v_id;
end $$;

-- Void a payment voucher entered by mistake: reverses it and frees its allocations.
create or replace function public.void_supplier_payment(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  p   public.supplier_payments;
  bid bigint;
  jid bigint;
begin
  select * into p from public.supplier_payments where id = p_id for update;
  if p.id is null then
    raise exception 'Payment voucher not found' using errcode = 'P0002';
  end if;
  if p.status = 'void' then
    return;
  end if;
  for jid in select id from public.journals where source_type = 'supplier_payment' and source_id = p_id and reversed_by_id is null and reverses_id is null loop
    perform private.reverse_journal(jid, greatest(private.today(), p.paid_on), null, me.id);
  end loop;
  for bid in delete from public.bill_allocations where payment_id = p_id returning bill_id loop
    perform private.refresh_bill(bid);
  end loop;
  update public.supplier_payments set status = 'void', voided_at = now() where id = p_id;
end $$;

-- Apply an unused payment or credit note to a bill (no ledger effect: both are already in payables).
create or replace function public.allocate_to_bill(p_bill_id bigint, p_source_type text, p_source_id bigint, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  b     public.bills;
  avail numeric;
  src_supplier bigint;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if b.id is null or b.kind <> 'bill' or b.status <> 'posted' then
    raise exception 'Pick a posted bill' using errcode = '22023';
  end if;
  if p_source_type = 'payment' then
    select supplier_id, private.payment_unallocated(id) into src_supplier, avail from public.supplier_payments where id = p_source_id and status = 'posted';
  elsif p_source_type = 'credit_note' then
    select supplier_id, total - amount_allocated into src_supplier, avail from public.bills
    where id = p_source_id and kind = 'credit_note' and status = 'posted';
  end if;
  if src_supplier is null or src_supplier <> b.supplier_id then
    raise exception 'That payment or credit note isn''t available for this supplier' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > avail or p_amount > b.total - b.amount_allocated then
    raise exception 'Allocate more than 0, up to AED % (what''s left on both)', to_char(least(avail, b.total - b.amount_allocated), 'FM999,999,999,990.00')
      using errcode = '22023';
  end if;
  insert into public.bill_allocations (bill_id, payment_id, credit_note_id, amount, created_by)
  values (p_bill_id, case when p_source_type = 'payment' then p_source_id end, case when p_source_type = 'credit_note' then p_source_id end,
          round(p_amount, 2), me.id);
  perform private.refresh_bill(p_bill_id);
  if p_source_type = 'credit_note' then perform private.refresh_bill(p_source_id); end if;
end $$;

create or replace function public.remove_allocation(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  al public.bill_allocations;
begin
  delete from public.bill_allocations where id = p_id returning * into al;
  if al.id is null then
    raise exception 'Allocation not found' using errcode = 'P0002';
  end if;
  perform private.refresh_bill(al.bill_id);
  if al.credit_note_id is not null then perform private.refresh_bill(al.credit_note_id); end if;
end $$;

create or replace function public.get_supplier_payment(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  r  json;
begin
  select json_build_object('payment', to_jsonb(p) || jsonb_build_object(
      'supplier_name', s.name, 'supplier_trn', s.trn, 'account', a.code || ' · ' || a.name,
      'unallocated', coalesce(private.payment_unallocated(p.id), 0), 'created_by_name', u.name,
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('id', al.id, 'bill_id', b.id, 'number', b.number, 'supplier_ref', b.supplier_ref,
          'amount', al.amount) order by al.id) from public.bill_allocations al join public.bills b on b.id = al.bill_id where al.payment_id = p.id), '[]'),
      'journal_id', (select id from public.journals where source_type = 'supplier_payment' and source_id = p.id and reverses_id is null order by id limit 1)),
    'company', (select json_build_object('legal_name', legal_name, 'address', address, 'trn', trn) from public.company_settings where id = 1))
  into r
  from public.supplier_payments p join public.suppliers s on s.id = p.supplier_id join public.accounts a on a.id = p.account_id
  left join public.profiles u on u.id = p.created_by
  where p.id = p_id;
  if r is null then
    raise exception 'Payment voucher not found' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- Supplier statement of account from the payables ledger: opening, each document, running balance (owed = positive).
create or replace function public.supplier_statement(p_supplier bigint, p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me      public.profiles := private.current_manager();
  f       date := coalesce(p_from, private.fy_start(private.today()));
  t       date := coalesce(p_to, private.today());
  opening numeric;
begin
  select coalesce(sum(l.credit - l.debit), 0) into opening
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.supplier_id = p_supplier and l.account_id = private.acct('ap') and j.entry_date < f;
  return json_build_object('from', f, 'to', t, 'opening', opening,
    'supplier', (select to_jsonb(s) from public.suppliers s where s.id = p_supplier),
    'company', (select json_build_object('legal_name', legal_name, 'address', address, 'trn', trn) from public.company_settings where id = 1),
    'lines', coalesce((select json_agg(x order by x.entry_date, x.journal_id) from (
      select j.id as journal_id, j.entry_date, j.number, j.kind, j.memo, j.reference, l.debit, l.credit,
             opening + sum(l.credit - l.debit) over (order by j.entry_date, j.id, l.id) as balance
      from public.journal_lines l join public.journals j on j.id = l.journal_id
      where l.supplier_id = p_supplier and l.account_id = private.acct('ap') and j.entry_date between f and t) x), '[]'),
    'closing', opening + coalesce((select sum(l.credit - l.debit) from public.journal_lines l join public.journals j on j.id = l.journal_id
      where l.supplier_id = p_supplier and l.account_id = private.acct('ap') and j.entry_date between f and t), 0));
end $$;

-- Payables ageing at a date: open bill balances by days past due, per supplier, less unused advances and credit notes.
create or replace function public.payables_ageing(p_as_of date default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  t  date := coalesce(p_as_of, private.today());
begin
  return json_build_object('as_of', t, 'rows', coalesce((select json_agg(x order by lower(x.name)) from (
    select s.id, s.name,
           coalesce(sum(o.bal) filter (where o.days <= 0), 0) as current,
           coalesce(sum(o.bal) filter (where o.days between 1 and 30), 0) as d30,
           coalesce(sum(o.bal) filter (where o.days between 31 and 60), 0) as d60,
           coalesce(sum(o.bal) filter (where o.days between 61 and 90), 0) as d90,
           coalesce(sum(o.bal) filter (where o.days > 90), 0) as d90plus,
           coalesce((select sum(private.payment_unallocated(p.id)) from public.supplier_payments p
                     where p.supplier_id = s.id and p.status = 'posted' and p.paid_on <= t), 0)
             + coalesce((select sum(c.total - c.amount_allocated) from public.bills c
                         where c.supplier_id = s.id and c.kind = 'credit_note' and c.status = 'posted' and c.bill_date <= t), 0) as unallocated
    from public.suppliers s
    left join lateral (
      select b.total - b.amount_allocated as bal, t - coalesce(b.due_date, b.bill_date) as days
      from public.bills b where b.supplier_id = s.id and b.kind = 'bill' and b.status = 'posted' and b.bill_date <= t and b.total > b.amount_allocated) o on true
    group by s.id
    having coalesce(sum(o.bal), 0) > 0
        or coalesce((select sum(private.payment_unallocated(p.id)) from public.supplier_payments p where p.supplier_id = s.id and p.status = 'posted'), 0) > 0) x), '[]'));
end $$;

-- VAT return (FTA VAT 201) for a period, worked out from tax invoices and posted bills, with the VAT ledger
-- (every VAT-relevant line) and the movement on the VAT accounts in the ledger as a cross-check.
-- Emirate split of box 1 is not tracked: all standard-rated sales are reported under the company's emirate.
create or replace function public.vat_return(p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  f  date := p_from;
  t  date := p_to;
  r  record;
begin
  if f is null or t is null or t < f then
    raise exception 'Pick the period (from and to dates)' using errcode = '22023';
  end if;
  return (
    with sales as (
      select 'sale' as side, 'invoice' as doc_type, i.issue_date as date, i.number as document, i.id as doc_id, i.customer_name as party, i.customer_trn as party_trn,
             l.description, l.vat_code, true as recoverable, l.net, l.vat
      from public.invoices i join public.invoice_lines l on l.invoice_id = i.id
      where i.kind = 'tax' and i.status in ('sent', 'paid') and i.issue_date between f and t
      union all
      select 'sale', 'credit_note', c.issue_date, c.number, c.id, c.customer_name, c.customer_trn, l.description, l.vat_code, true, -l.net, -l.vat
      from public.credit_notes c join public.credit_note_lines l on l.credit_note_id = c.id
      where c.status = 'issued' and c.issue_date between f and t
    ), purchases as (
      select 'purchase' as side, 'bill' as doc_type, b.bill_date, b.number || ' (' || b.supplier_ref || ')', b.id, s.name, s.trn, l.description, l.vat_code, l.recoverable,
             case b.kind when 'bill' then l.net else -l.net end, case b.kind when 'bill' then l.vat else -l.vat end
      from public.bills b join public.bill_lines l on l.bill_id = b.id join public.suppliers s on s.id = b.supplier_id
      where b.status = 'posted' and b.bill_date between f and t
      union all
      select 'purchase', 'petty_cash', e.spent_on, e.number, e.id, e.payee, e.payee_trn, e.description, e.vat_code, e.recoverable, e.net, e.vat
      from public.petty_cash_expenses e
      where e.status = 'posted' and e.spent_on between f and t
    ), all_lines as (
      select *, case
        when side = 'sale' and vat_code = 'standard' then '1'
        when side = 'sale' and vat_code = 'zero' then '4'
        when side = 'sale' and vat_code = 'exempt' then '5'
        when side = 'purchase' and vat_code = 'reverse_charge' then '3 / 10'
        when side = 'purchase' and vat_code = 'import_goods' then '6 / 10'
        when side = 'purchase' and vat_code = 'standard' and recoverable then '9'
        else '' end as box
      from (select * from sales union all select * from purchases) u
    )
    select json_build_object(
      'from', f, 'to', t,
      'emirate', 'Sharjah',
      'box1',  json_build_object('amount', coalesce(sum(net) filter (where side = 'sale' and vat_code = 'standard'), 0),
                                 'vat', coalesce(sum(vat) filter (where side = 'sale' and vat_code = 'standard'), 0)),
      'box3',  json_build_object('amount', coalesce(sum(net) filter (where side = 'purchase' and vat_code = 'reverse_charge'), 0),
                                 'vat', coalesce(sum(vat) filter (where side = 'purchase' and vat_code = 'reverse_charge'), 0)),
      'box4',  json_build_object('amount', coalesce(sum(net) filter (where side = 'sale' and vat_code = 'zero'), 0)),
      'box5',  json_build_object('amount', coalesce(sum(net) filter (where side = 'sale' and vat_code = 'exempt'), 0)),
      'box6',  json_build_object('amount', coalesce(sum(net) filter (where side = 'purchase' and vat_code = 'import_goods'), 0),
                                 'vat', coalesce(sum(vat) filter (where side = 'purchase' and vat_code = 'import_goods'), 0)),
      'box9',  json_build_object('amount', coalesce(sum(net) filter (where side = 'purchase' and vat_code = 'standard' and recoverable), 0),
                                 'vat', coalesce(sum(vat) filter (where side = 'purchase' and vat_code = 'standard' and recoverable), 0)),
      'box10', json_build_object('amount', coalesce(sum(net) filter (where side = 'purchase' and vat_code in ('reverse_charge', 'import_goods') and recoverable), 0),
                                 'vat', coalesce(sum(vat) filter (where side = 'purchase' and vat_code in ('reverse_charge', 'import_goods') and recoverable), 0)),
      'ledger', coalesce(json_agg(json_build_object('side', side, 'doc_type', doc_type, 'date', date, 'document', document, 'doc_id', doc_id, 'party', party,
                  'party_trn', party_trn, 'description', description, 'vat_code', vat_code, 'recoverable', recoverable, 'net', net, 'vat', vat, 'box', box)
                  order by date, document) filter (where vat_code <> 'out_of_scope'), '[]'),
      'gl', (select json_build_object(
                'vat_output', coalesce(sum(l.credit - l.debit) filter (where l.account_id = private.acct('vat_output')), 0),
                'vat_input', coalesce(sum(l.debit - l.credit) filter (where l.account_id = private.acct('vat_input')), 0))
             from public.journal_lines l join public.journals j on j.id = l.journal_id
             where j.entry_date between f and t and j.kind <> 'vat_settlement'),
      'settled', (select json_build_object('id', j.id, 'number', j.number) from public.journals j
                  where j.kind = 'vat_settlement' and j.reference = format('VAT %s to %s', f, t) and j.reversed_by_id is null limit 1))
    from all_lines);
end $$;

-- Move the period's VAT output and input into "VAT payable to FTA" (Dr output / Cr input / Cr payable, or the other way if refundable).
create or replace function public.post_vat_settlement(p_from date, p_to date) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_manager();
  outv numeric;
  inv  numeric;
  ref  text := format('VAT %s to %s', p_from, p_to);
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick the period' using errcode = '22023';
  end if;
  if exists (select 1 from public.journals where kind = 'vat_settlement' and reference = ref and reversed_by_id is null) then
    raise exception 'The VAT for this period has already been recorded' using errcode = '22023';
  end if;
  select coalesce(sum(l.credit - l.debit) filter (where l.account_id = private.acct('vat_output')), 0),
         coalesce(sum(l.debit - l.credit) filter (where l.account_id = private.acct('vat_input')), 0)
  into outv, inv
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where j.entry_date between p_from and p_to and j.kind <> 'vat_settlement';
  if outv = 0 and inv = 0 then
    raise exception 'There is no VAT to record for this period' using errcode = '22023';
  end if;
  return private.post_journal(p_to, 'vat_settlement', format('VAT return %s to %s', to_char(p_from, 'DD Mon YYYY'), to_char(p_to, 'DD Mon YYYY')),
    ref, null, null, jsonb_build_array(
      jsonb_build_object('account_id', private.acct('vat_output'), 'debit', greatest(outv, 0), 'credit', greatest(-outv, 0)),
      jsonb_build_object('account_id', private.acct('vat_input'), 'debit', greatest(-inv, 0), 'credit', greatest(inv, 0)),
      jsonb_build_object('account_id', private.acct('vat_payable'), 'debit', greatest(inv - outv, 0), 'credit', greatest(outv - inv, 0))),
    me.id);
end $$;


-- -------------------------------------------------------------------------------------
-- API: customer credit notes, receipt vouchers, statements, receivables ageing,
-- recurring invoices, bank statement import and reconciliation, petty cash
-- -------------------------------------------------------------------------------------

-- Check sales lines [{description, quantity, unit_price, vat_code}] the way invoices do.
-- Returns {lines: [... with net and vat], subtotal, vat, error}.
create or replace function private.check_sales_lines(p_lines jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  ln    jsonb;
  i     int := 0;
  qty   numeric;
  price numeric;
  net   numeric;
  vat   numeric;
  sub   numeric := 0;
  vsum  numeric := 0;
  errs  text[] := '{}';
  res   jsonb := '[]';
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('error', 'Add at least one line');
  elsif jsonb_array_length(p_lines) > 100 then
    return jsonb_build_object('error', 'At most 100 lines');
  end if;
  for ln in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    begin
      qty := nullif(btrim(ln ->> 'quantity'), '')::numeric;
      price := nullif(btrim(ln ->> 'unit_price'), '')::numeric;
    exception when others then
      errs := errs || format('Line %s: quantity and price must be numbers', i);
      continue;
    end;
    if nullif(btrim(ln ->> 'description'), '') is null then
      errs := errs || format('Line %s: add a description', i);
    elsif char_length(btrim(ln ->> 'description')) > 500 then
      errs := errs || format('Line %s: description is too long', i);
    elsif qty is null or qty <= 0 or qty >= 1000000000 or scale(qty) > 3 then
      errs := errs || format('Line %s: quantity must be more than 0', i);
    elsif price is null or price < 0 or price >= 1000000000000 or scale(price) > 2 then
      errs := errs || format('Line %s: price must be 0 or more, with at most 2 decimals', i);
    elsif coalesce(ln ->> 'vat_code', '') not in ('standard', 'zero', 'exempt', 'out_of_scope') then
      errs := errs || format('Line %s: pick a VAT treatment', i);
    else
      net := round(qty * price, 2);
      vat := case when ln ->> 'vat_code' = 'standard' then round(net * 0.05, 2) else 0 end;
      sub := sub + net;
      vsum := vsum + vat;
      res := res || jsonb_build_object('description', btrim(ln ->> 'description'), 'quantity', qty,
        'unit_price', price, 'vat_code', ln ->> 'vat_code', 'net', net, 'vat', vat);
    end if;
  end loop;
  if array_length(errs, 1) > 0 then
    return jsonb_build_object('error', array_to_string(errs, '. '));
  end if;
  return jsonb_build_object('lines', res, 'subtotal', sub, 'vat', vsum);
end $$;

create or replace function private.refresh_credit_note(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.credit_notes set amount_applied = coalesce((select sum(amount) from public.receivable_allocations where credit_note_id = p_id), 0)
  where id = p_id;
end $$;

-- What is left of a receipt to set against invoices (nothing once void or the cheque bounced).
create or replace function private.receipt_unallocated(p_id bigint) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when r.status = 'void' or r.cheque_status = 'bounced' then 0
              else r.amount - coalesce((select sum(a.amount) from public.receivable_allocations a where a.receipt_id = r.id), 0) end
  from public.receipts r where r.id = p_id
$$;

-- Income account a credit note line reverses: the invoice's own account for that kind of line, the
-- task's type of work, or other operating revenue (disbursements: "disbursements recoverable").
create or replace function private.credit_line_account(p_invoice_id bigint, p_vat_code text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  return coalesce(
    (select l.account_id from public.invoice_lines l where l.invoice_id = p_invoice_id and l.vat_code = p_vat_code and l.account_id is not null limit 1),
    case when p_vat_code = 'out_of_scope' then private.acct('disbursements') end,
    (select w.revenue_account_id from public.tasks t join public.work_types w on w.id = t.work_type_id where t.id = inv.task_id),
    private.acct('revenue_other'));
end $$;

-- Customer's credits not yet used: receipts with money left and issued credit notes not fully applied.
create or replace function private.customer_open_credits(p_customer bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.date, x.number), '[]') from (
    select 'receipt' as type, r.id, r.number, r.received_on as date, private.receipt_unallocated(r.id) as available
    from public.receipts r where r.customer_id = p_customer and private.receipt_unallocated(r.id) > 0
    union all
    select 'credit_note', c.id, c.number, c.issue_date, c.total - c.amount_applied
    from public.credit_notes c where c.customer_id = p_customer and c.status = 'issued' and c.total > c.amount_applied) x
$$;

-- Customer's tax invoices with a balance, oldest first.
create or replace function private.customer_open_invoices(p_customer bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'issue_date', i.issue_date, 'due_date', i.due_date,
                                               'total', i.total, 'balance', i.total - i.amount_paid) order by i.issue_date, i.id), '[]')
  from public.invoices i
  where i.customer_id = p_customer and i.kind = 'tax' and i.status = 'sent' and i.total > i.amount_paid
$$;

-- Set part of a receipt against an invoice: moves it from customer advances to receivables.
create or replace function private.allocate_receipt(r public.receipts, inv public.invoices, p_amount numeric, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  jid bigint;
begin
  jid := private.post_journal(greatest(r.received_on, inv.issue_date, coalesce((select books_locked_until + 1 from public.company_settings where id = 1), r.received_on)),
    'receipt', format('%s set against %s - %s', r.number, inv.number, inv.customer_name), r.number, 'receipt', r.id,
    jsonb_build_array(
      jsonb_build_object('account_id', private.acct('customer_advances'), 'debit', p_amount, 'credit', 0, 'customer_id', r.customer_id),
      jsonb_build_object('account_id', private.acct('ar'), 'debit', 0, 'credit', p_amount, 'customer_id', r.customer_id, 'description', inv.number)),
    p_user);
  insert into public.receivable_allocations (invoice_id, receipt_id, amount, journal_id, created_by) values (inv.id, r.id, p_amount, jid, p_user);
  perform private.refresh_invoice_payments(inv.id);
end $$;

-- ---------- credit notes ----------

-- Create (p_id null) or edit a draft credit note. p_data: invoice_id (on create), issue_date, reason, notes,
-- lines: [{description, quantity, unit_price, vat_code}]
create or replace function public.save_credit_note(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  d     jsonb := private.clean(p_data, '{
    "invoice_id": {"type": "int"},
    "issue_date": {"type": "date", "required": true},
    "reason":     {"type": "text", "required": true, "max": 500},
    "notes":      {"type": "text", "max": 1000}
  }');
  v_old public.credit_notes;
  inv   public.invoices;
  cust  public.customers;
  co    public.company_settings;
  chk   jsonb := private.check_sales_lines(p_data -> 'lines');
  errs  jsonb := '{}';
  other numeric;
  v_id  bigint;
begin
  if p_id is not null then
    select * into v_old from public.credit_notes where id = p_id;
    if v_old.id is null then
      raise exception 'Credit note not found' using errcode = 'P0002';
    end if;
    if v_old.status <> 'draft' then
      raise exception 'This credit note has been issued, so it can''t be changed' using errcode = '22023';
    end if;
    select * into inv from public.invoices where id = v_old.invoice_id;
  else
    select * into inv from public.invoices where id = (d ->> 'invoice_id')::bigint;
    if inv.id is null or inv.kind <> 'tax' or inv.status not in ('sent', 'paid') then
      raise exception 'A credit note is issued against a tax invoice that has been sent' using errcode = '22023';
    end if;
  end if;
  if (d ->> 'issue_date')::date < inv.issue_date then
    errs := errs || jsonb_build_object('issue_date', format('Can''t be before the invoice date (%s)', to_char(inv.issue_date, 'DD Mon YYYY')));
  end if;
  if chk ? 'error' then
    errs := errs || jsonb_build_object('lines', chk ->> 'error');
  else
    select coalesce(sum(total), 0) into other from public.credit_notes
    where invoice_id = inv.id and status <> 'cancelled' and id is distinct from p_id;
    if (chk ->> 'subtotal')::numeric + (chk ->> 'vat')::numeric > inv.total - other then
      errs := errs || jsonb_build_object('lines', format('The credit can''t be more than AED %s (the invoice total%s)',
        to_char(inv.total - other, 'FM999,999,999,990.00'), case when other > 0 then ' less earlier credit notes' else '' end));
    elsif (chk ->> 'subtotal')::numeric + (chk ->> 'vat')::numeric <= 0 then
      errs := errs || '{"lines": "The credit must be more than 0"}';
    end if;
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  select * into cust from public.customers where id = inv.customer_id;
  select * into co from public.company_settings where id = 1;
  if p_id is null then
    insert into public.credit_notes (number, invoice_id, customer_id, customer_name, customer_address, customer_trn, customer_email, supplier,
                                     issue_date, reason, notes, subtotal, vat_total, total, created_by)
    values (private.next_doc_number('credit_note', 'CN', (d ->> 'issue_date')::date), inv.id, inv.customer_id,
            coalesce(cust.name, inv.customer_name), coalesce(concat_ws(E'\n', cust.address, cust.city, cust.country), inv.customer_address),
            coalesce(cust.trn, inv.customer_trn), coalesce(cust.email, inv.customer_email), to_jsonb(co) - 'id' - 'updated_at',
            (d ->> 'issue_date')::date, d ->> 'reason', d ->> 'notes', (chk ->> 'subtotal')::numeric, (chk ->> 'vat')::numeric,
            (chk ->> 'subtotal')::numeric + (chk ->> 'vat')::numeric, me.id)
    returning id into v_id;
  else
    v_id := p_id;
    update public.credit_notes set issue_date = (d ->> 'issue_date')::date, reason = d ->> 'reason', notes = d ->> 'notes',
      supplier = to_jsonb(co) - 'id' - 'updated_at',
      subtotal = (chk ->> 'subtotal')::numeric, vat_total = (chk ->> 'vat')::numeric, total = (chk ->> 'subtotal')::numeric + (chk ->> 'vat')::numeric
    where id = v_id;
    delete from public.credit_note_lines where credit_note_id = v_id;
  end if;
  insert into public.credit_note_lines (credit_note_id, position, description, quantity, unit_price, vat_code, net, vat)
  select v_id, x.ord, x.l ->> 'description', (x.l ->> 'quantity')::numeric, (x.l ->> 'unit_price')::numeric,
         x.l ->> 'vat_code', (x.l ->> 'net')::numeric, (x.l ->> 'vat')::numeric
  from jsonb_array_elements(chk -> 'lines') with ordinality as x(l, ord);
  return v_id;
end $$;

-- Issue a draft credit note: Dr income (per line) / Dr VAT output / Cr receivables, then set it against
-- the invoice's balance (any rest stays as a credit for the customer).
create or replace function public.issue_credit_note(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  cn    public.credit_notes;
  inv   public.invoices;
  co    public.company_settings;
  lines jsonb;
  apply numeric;
begin
  select * into cn from public.credit_notes where id = p_id for update;
  if cn.id is null then
    raise exception 'Credit note not found' using errcode = 'P0002';
  end if;
  if cn.status <> 'draft' then
    raise exception 'Only a draft can be issued' using errcode = '22023';
  end if;
  select * into co from public.company_settings where id = 1;
  if co.trn is null then
    raise exception 'Add Lowcaps'' TRN under Company settings before issuing a tax credit note' using errcode = '22023';
  end if;
  select * into inv from public.invoices where id = cn.invoice_id;
  if inv.status = 'cancelled' then
    raise exception 'The invoice has been cancelled' using errcode = '22023';
  end if;
  lines := coalesce((
    select jsonb_agg(jsonb_build_object('account_id', x.acct, 'debit', x.amount, 'credit', 0, 'description', cn.number))
    from (select private.credit_line_account(cn.invoice_id, l.vat_code) as acct, sum(l.net) as amount
          from public.credit_note_lines l where l.credit_note_id = p_id group by 1) x), '[]');
  if cn.vat_total > 0 then
    lines := lines || jsonb_build_object('account_id', private.acct('vat_output'), 'debit', cn.vat_total, 'credit', 0, 'description', 'VAT on ' || cn.number);
  end if;
  lines := lines || jsonb_build_object('account_id', private.acct('ar'), 'debit', 0, 'credit', cn.total, 'description', cn.customer_name,
                                       'customer_id', cn.customer_id);
  perform private.post_journal(cn.issue_date, 'credit_note', format('Credit note %s - %s (on %s)', cn.number, cn.customer_name, inv.number),
                               cn.number, 'credit_note', cn.id, lines, me.id);
  perform private.tag_journal((select max(id) from public.journals where source_type = 'credit_note' and source_id = cn.id and kind = 'credit_note'),
                              cn.customer_id, (select work_type_id from public.tasks where id = inv.task_id), null);
  update public.credit_notes set status = 'issued', issued_at = now(), supplier = to_jsonb(co) - 'id' - 'updated_at' where id = p_id;
  apply := least(cn.total, inv.total - inv.amount_paid);
  if apply > 0 then
    insert into public.receivable_allocations (invoice_id, credit_note_id, amount, created_by) values (inv.id, cn.id, apply, me.id);
    perform private.refresh_invoice_payments(inv.id);
    perform private.refresh_credit_note(cn.id);
  end if;
  if inv.task_id is not null then
    insert into public.task_updates (task_id, user_id, kind, body)
    values (inv.task_id, me.id, 'comment', format('Issued credit note %s (AED %s) on %s', cn.number, to_char(cn.total, 'FM999,999,999,990.00'), inv.number));
  end if;
end $$;

-- Cancel a credit note (a draft, or an issued one entered by mistake: its entry is reversed and its uses removed).
create or replace function public.cancel_credit_note(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  cn  public.credit_notes;
  iid bigint;
  jid bigint;
begin
  select * into cn from public.credit_notes where id = p_id for update;
  if cn.id is null then
    raise exception 'Credit note not found' using errcode = 'P0002';
  end if;
  if cn.status = 'cancelled' then
    return;
  end if;
  if cn.status = 'issued' then
    for iid in delete from public.receivable_allocations where credit_note_id = p_id returning invoice_id loop
      perform private.refresh_invoice_payments(iid);
    end loop;
    for jid in select id from public.journals where source_type = 'credit_note' and source_id = p_id and reversed_by_id is null and reverses_id is null loop
      perform private.reverse_journal(jid, greatest(private.today(), cn.issue_date), null, me.id);
    end loop;
  end if;
  update public.credit_notes set status = 'cancelled', cancelled_at = now(), amount_applied = 0 where id = p_id;
end $$;

create or replace function public.mark_credit_note_sent(p_id bigint, p_to text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  update public.credit_notes set sent_at = now(), sent_to = left(nullif(btrim(p_to), ''), 500) where id = p_id and status = 'issued';
  if not found then
    raise exception 'Issue the credit note before sending it' using errcode = '22023';
  end if;
end $$;

create or replace function public.get_credit_note(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  result json;
begin
  select json_build_object('today', private.today(),
    'credit_note', to_jsonb(c) || jsonb_build_object(
      'invoice_number', i.number, 'invoice_date', i.issue_date, 'invoice_total', i.total,
      'created_by_name', u.name,
      'journal_id', (select j.id from public.journals j where j.source_type = 'credit_note' and j.source_id = c.id and j.kind = 'credit_note' order by j.id limit 1),
      'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from public.credit_note_lines l where l.credit_note_id = c.id), '[]'),
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'invoice_id', a.invoice_id, 'invoice_number', ai.number,
                                 'amount', a.amount, 'created_at', a.created_at) order by a.id)
                               from public.receivable_allocations a join public.invoices ai on ai.id = a.invoice_id where a.credit_note_id = c.id), '[]'),
      'open_invoices', case when c.status = 'issued' and c.total > c.amount_applied then private.customer_open_invoices(c.customer_id) else '[]'::jsonb end,
      'recipients', coalesce((
        select jsonb_agg(e.email order by e.rank, e.email) from (
          select lower(x.email) as email, min(x.rank) as rank from (
            select cu.email, 0 as rank from public.customers cu where cu.id = c.customer_id and cu.email is not null
            union all
            select k.email, case when k.is_primary then 1 else 2 end from public.contacts k where k.customer_id = c.customer_id and k.email is not null) x
          group by lower(x.email)) e), '[]')))
  into result
  from public.credit_notes c join public.invoices i on i.id = c.invoice_id left join public.profiles u on u.id = c.created_by
  where c.id = p_id;
  if result is null then
    raise exception 'Credit note not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- status: '' | draft | issued | cancelled | unused (issued with credit left)
create or replace function public.list_credit_notes(p_q text default null, p_status text default null, p_page int default 1) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me        public.profiles := private.current_manager();
  page_size constant int := 25;
  pg        int := greatest(coalesce(p_page, 1), 1);
  pat       text;
  total     bigint;
  v_rows    json;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  with f as (
    select c.*, i.number as invoice_number from public.credit_notes c join public.invoices i on i.id = c.invoice_id
    where (pat is null or c.number ilike pat or c.customer_name ilike pat or i.number ilike pat or c.reason ilike pat)
      and (case coalesce(p_status, '') when '' then true when 'unused' then c.status = 'issued' and c.total > c.amount_applied else c.status = p_status end))
  select (select count(*) from f), coalesce((select json_agg(x order by x.issue_date desc, x.id desc) from (
    select f.id, f.number, f.invoice_id, f.invoice_number, f.customer_id, f.customer_name, f.issue_date, f.reason, f.status, f.total, f.amount_applied
    from f order by f.issue_date desc, f.id desc limit page_size offset (pg - 1) * page_size) x), '[]')
  into total, v_rows;
  return json_build_object('credit_notes', v_rows, 'total', total, 'page', pg, 'pageSize', page_size);
end $$;

-- Set a receipt's unallocated money or a credit note's unused credit against a tax invoice of the same customer.
create or replace function public.apply_customer_credit(p_invoice_id bigint, p_source_type text, p_source_id bigint, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  inv public.invoices;
  r   public.receipts;
  cn  public.credit_notes;
  avail numeric;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null or inv.kind <> 'tax' or inv.status <> 'sent' then
    raise exception 'Credits can only be set against a sent tax invoice with a balance' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then
    raise exception 'Enter an amount above 0' using errcode = '22023';
  end if;
  if p_amount > inv.total - inv.amount_paid then
    raise exception 'More than the invoice balance of AED %', to_char(inv.total - inv.amount_paid, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  if p_source_type = 'receipt' then
    select * into r from public.receipts where id = p_source_id for update;
    avail := private.receipt_unallocated(r.id);
    if r.id is null or r.customer_id is distinct from inv.customer_id then
      raise exception 'That receipt is not from this customer' using errcode = '22023';
    end if;
    if p_amount > coalesce(avail, 0) then
      raise exception 'Only AED % of % is left to use', to_char(coalesce(avail, 0), 'FM999,999,999,990.00'), r.number using errcode = '22023';
    end if;
    perform private.allocate_receipt(r, inv, p_amount, me.id);
  elsif p_source_type = 'credit_note' then
    select * into cn from public.credit_notes where id = p_source_id for update;
    if cn.id is null or cn.customer_id is distinct from inv.customer_id or cn.status <> 'issued' then
      raise exception 'That credit note is not an issued one for this customer' using errcode = '22023';
    end if;
    if p_amount > cn.total - cn.amount_applied then
      raise exception 'Only AED % of % is left to use', to_char(cn.total - cn.amount_applied, 'FM999,999,999,990.00'), cn.number using errcode = '22023';
    end if;
    insert into public.receivable_allocations (invoice_id, credit_note_id, amount, created_by) values (inv.id, cn.id, p_amount, me.id);
    perform private.refresh_invoice_payments(inv.id);
    perform private.refresh_credit_note(cn.id);
  else
    raise exception 'Unknown credit type' using errcode = '22023';
  end if;
end $$;

-- Undo setting a receipt or credit note against an invoice.
create or replace function public.remove_receivable_allocation(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  a   public.receivable_allocations;
  r   public.receipts;
  inv public.invoices;
begin
  select * into a from public.receivable_allocations where id = p_id for update;
  if a.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if a.receipt_id is not null then
    select * into r from public.receipts where id = a.receipt_id;
    select * into inv from public.invoices where id = a.invoice_id;
    perform private.post_journal(private.today(), 'receipt', format('%s taken off %s - %s', r.number, inv.number, inv.customer_name),
      r.number, 'receipt', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', private.acct('ar'), 'debit', a.amount, 'credit', 0, 'customer_id', r.customer_id, 'description', inv.number),
        jsonb_build_object('account_id', private.acct('customer_advances'), 'debit', 0, 'credit', a.amount, 'customer_id', r.customer_id)),
      me.id);
  end if;
  delete from public.receivable_allocations where id = p_id;
  perform private.refresh_invoice_payments(a.invoice_id);
  if a.credit_note_id is not null then
    perform private.refresh_credit_note(a.credit_note_id);
  end if;
end $$;

-- ---------- receipt vouchers ----------

-- Record money received from a customer. p_data: customer_id, received_on, amount, method, account_id, reference,
-- cheque_bank, cheque_date, notes, allocations: [{invoice_id, amount}]. The rest is held as an advance.
create or replace function public.record_receipt(p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  d     jsonb := private.clean(p_data, '{
    "customer_id": {"type": "int", "required": true},
    "received_on": {"type": "date", "required": true},
    "method":      {"type": "enum", "required": true, "values": ["bank_transfer", "cash", "cheque", "other"]},
    "account_id":  {"type": "int", "required": true},
    "reference":   {"type": "text", "max": 100},
    "cheque_bank": {"type": "text", "max": 100},
    "cheque_date": {"type": "date"},
    "notes":       {"type": "text", "max": 1000}
  }');
  cust  public.customers;
  amt   numeric;
  errs  jsonb := '{}';
  al    jsonb;
  inv   public.invoices;
  a_amt numeric;
  alloc numeric := 0;
  lerrs text[] := '{}';
  r     public.receipts;
  cheque boolean := d ->> 'method' = 'cheque';
begin
  select * into cust from public.customers where id = (d ->> 'customer_id')::bigint;
  if cust.id is null then errs := errs || '{"customer_id": "Pick a customer"}'; end if;
  if not exists (select 1 from public.accounts where id = (d ->> 'account_id')::bigint and subtype in ('bank', 'cash') and active) then
    errs := errs || '{"account_id": "Pick a bank or cash account"}';
  end if;
  begin
    amt := nullif(btrim(p_data ->> 'amount'), '')::numeric;
  exception when others then amt := null;
  end;
  if amt is null or amt <= 0 or scale(amt) > 2 or amt >= 1000000000000 then
    errs := errs || '{"amount": "Enter an amount above 0, with at most 2 decimals"}';
  end if;
  if (d ->> 'received_on')::date > private.today() then
    errs := errs || '{"received_on": "Can''t be in the future"}';
  end if;
  if cheque and d ->> 'reference' is null then
    errs := errs || '{"reference": "Enter the cheque number"}';
  end if;
  for al in select value from jsonb_array_elements(coalesce(p_data -> 'allocations', '[]')) loop
    begin
      a_amt := coalesce(nullif(btrim(al ->> 'amount'), '')::numeric, 0);
    exception when others then a_amt := -1;
    end;
    continue when a_amt = 0;
    select * into inv from public.invoices where id = (al ->> 'invoice_id')::bigint;
    if inv.id is null or inv.kind <> 'tax' or inv.status <> 'sent' or inv.customer_id is distinct from cust.id then
      lerrs := lerrs || 'An allocation is to an invoice that isn''t open for this customer';
    elsif a_amt < 0 or scale(a_amt) > 2 or a_amt > inv.total - inv.amount_paid then
      lerrs := lerrs || format('%s: between 0 and its balance of AED %s', inv.number, to_char(inv.total - inv.amount_paid, 'FM999,999,999,990.00'));
    else
      alloc := alloc + a_amt;
    end if;
  end loop;
  if amt is not null and alloc > amt then
    lerrs := lerrs || format('Allocations (AED %s) add up to more than the amount received', to_char(alloc, 'FM999,999,999,990.00'));
  end if;
  if array_length(lerrs, 1) > 0 then errs := errs || jsonb_build_object('allocations', array_to_string(lerrs, '. ')); end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;

  insert into public.receipts (number, customer_id, received_on, amount, method, account_id, reference, cheque_bank, cheque_date, cheque_status, notes, created_by)
  values (private.next_doc_number('receipt', 'RV', (d ->> 'received_on')::date), cust.id, (d ->> 'received_on')::date, amt, d ->> 'method',
          (d ->> 'account_id')::bigint, d ->> 'reference', case when cheque then d ->> 'cheque_bank' end,
          case when cheque then (d ->> 'cheque_date')::date end, case when cheque then 'pending' end, d ->> 'notes', me.id)
  returning * into r;
  -- Money in: the bank or cash account (cheques in hand until cleared) against customer advances.
  perform private.post_journal(r.received_on, 'receipt',
    format('Receipt %s from %s%s', r.number, cust.name, case when cheque then ' (cheque ' || r.reference || ')' else '' end),
    coalesce(r.reference, r.number), 'receipt', r.id,
    jsonb_build_array(
      jsonb_build_object('account_id', case when cheque then private.acct('pdc') else r.account_id end, 'debit', amt, 'credit', 0, 'description', cust.name),
      jsonb_build_object('account_id', private.acct('customer_advances'), 'debit', 0, 'credit', amt, 'description', cust.name, 'customer_id', cust.id)),
    me.id);
  for al in select value from jsonb_array_elements(coalesce(p_data -> 'allocations', '[]')) loop
    a_amt := coalesce(nullif(btrim(al ->> 'amount'), '')::numeric, 0);
    continue when a_amt = 0;
    select * into inv from public.invoices where id = (al ->> 'invoice_id')::bigint for update;
    perform private.allocate_receipt(r, inv, a_amt, me.id);
  end loop;
  return r.id;
end $$;

-- Undo everything a receipt did (void, or its cheque bounced): reverse its entries and free the invoices.
create or replace function private.unwind_receipt(p_id bigint, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  iid bigint;
  j   public.journals;
begin
  for j in select * from public.journals where source_type = 'receipt' and source_id = p_id and reversed_by_id is null and reverses_id is null order by id desc loop
    perform private.reverse_journal(j.id, greatest(private.today(), j.entry_date), null, p_user);
  end loop;
  for iid in delete from public.receivable_allocations where receipt_id = p_id returning invoice_id loop
    perform private.refresh_invoice_payments(iid);
  end loop;
end $$;

create or replace function public.void_receipt(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  r  public.receipts;
begin
  select * into r from public.receipts where id = p_id for update;
  if r.id is null then
    raise exception 'Receipt not found' using errcode = 'P0002';
  end if;
  if r.status = 'void' then
    return;
  end if;
  if r.cheque_status is distinct from 'bounced' then
    perform private.unwind_receipt(p_id, me.id);
  end if;
  update public.receipts set status = 'void', voided_at = now() where id = p_id;
end $$;

-- A receipt's cheque cleared (cheques in hand -> bank) or bounced (everything it did is undone).
create or replace function public.set_receipt_cheque(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  r  public.receipts;
begin
  select * into r from public.receipts where id = p_id for update;
  if r.id is null then
    raise exception 'Receipt not found' using errcode = 'P0002';
  end if;
  if r.method <> 'cheque' or r.status <> 'posted' then
    raise exception 'Only a cheque receipt that is not void can change' using errcode = '22023';
  end if;
  if r.cheque_status = 'bounced' then
    raise exception 'This cheque bounced. Record a new receipt when the customer pays again.' using errcode = '22023';
  end if;
  if p_status = 'cleared' and r.cheque_status = 'pending' then
    perform private.post_journal(private.today(), 'receipt', format('Cheque %s cleared - %s', r.reference, r.number), r.reference, 'receipt', r.id,
      jsonb_build_array(jsonb_build_object('account_id', r.account_id, 'debit', r.amount, 'credit', 0),
                        jsonb_build_object('account_id', private.acct('pdc'), 'debit', 0, 'credit', r.amount)), me.id);
  elsif p_status = 'bounced' then
    perform private.unwind_receipt(p_id, me.id);
  elsif p_status is distinct from r.cheque_status then
    raise exception 'Unknown cheque status' using errcode = '22023';
  end if;
  update public.receipts set cheque_status = p_status where id = p_id;
end $$;

create or replace function public.get_receipt(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  result json;
begin
  select json_build_object('today', private.today(),
    'company', (select json_build_object('legal_name', legal_name, 'address', address, 'trn', trn, 'phone', phone, 'email', email)
                from public.company_settings where id = 1),
    'receipt', to_jsonb(r) || jsonb_build_object(
      'customer_name', c.name, 'customer_trn', c.trn, 'customer_address', concat_ws(E'\n', c.address, c.city, c.country),
      'account', (select code || ' · ' || name from public.accounts where id = r.account_id),
      'created_by_name', u.name,
      'unallocated', private.receipt_unallocated(r.id),
      'journal_id', (select j.id from public.journals j where j.source_type = 'receipt' and j.source_id = r.id order by j.id limit 1),
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'invoice_id', a.invoice_id, 'invoice_number', i.number,
                                 'amount', a.amount, 'created_at', a.created_at) order by a.id)
                               from public.receivable_allocations a join public.invoices i on i.id = a.invoice_id where a.receipt_id = r.id), '[]'),
      'open_invoices', case when private.receipt_unallocated(r.id) > 0 then private.customer_open_invoices(r.customer_id) else '[]'::jsonb end))
  into result
  from public.receipts r join public.customers c on c.id = r.customer_id left join public.profiles u on u.id = r.created_by
  where r.id = p_id;
  if result is null then
    raise exception 'Receipt not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- status: '' | unallocated (money left to set against invoices) | cheques (not cleared) | void
create or replace function public.list_receipts(p_q text default null, p_status text default null, p_customer bigint default null, p_page int default 1) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me        public.profiles := private.current_manager();
  page_size constant int := 25;
  pg        int := greatest(coalesce(p_page, 1), 1);
  pat       text;
  total     bigint;
  amount    numeric;
  v_rows    json;
begin
  if nullif(btrim(p_q), '') is not null then
    pat := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  with f as (
    select r.*, c.name as customer_name, private.receipt_unallocated(r.id) as unallocated
    from public.receipts r join public.customers c on c.id = r.customer_id
    where (pat is null or r.number ilike pat or c.name ilike pat or r.reference ilike pat)
      and (p_customer is null or r.customer_id = p_customer)
      and (case coalesce(p_status, '')
             when '' then true
             when 'unallocated' then private.receipt_unallocated(r.id) > 0
             when 'cheques' then r.cheque_status = 'pending' and r.status = 'posted'
             when 'void' then r.status = 'void' or r.cheque_status = 'bounced'
             else false end))
  select (select count(*) from f),
         (select coalesce(sum(f.amount) filter (where f.status = 'posted' and f.cheque_status is distinct from 'bounced'), 0) from f),
         coalesce((select json_agg(x order by x.received_on desc, x.id desc) from (
           select f.id, f.number, f.customer_id, f.customer_name, f.received_on, f.amount, f.method, f.reference, f.cheque_status, f.status, f.unallocated
           from f order by f.received_on desc, f.id desc limit page_size offset (pg - 1) * page_size) x), '[]')
  into total, amount, v_rows;
  return json_build_object('receipts', v_rows, 'total', total, 'amount', amount, 'page', pg, 'pageSize', page_size);
end $$;

-- Customers with what they owe, for picking on the receipt form.
create or replace function public.receivable_customers() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  return coalesce((select json_agg(x order by lower(x.name)) from (
    select c.id, c.name, c.status,
           coalesce((select sum(i.total - i.amount_paid) from public.invoices i
                     where i.customer_id = c.id and i.kind = 'tax' and i.status = 'sent'), 0) as balance
    from public.customers c where c.status <> 'inactive'
       or exists (select 1 from public.invoices i where i.customer_id = c.id and i.kind = 'tax' and i.status = 'sent')) x), '[]');
end $$;

create or replace function public.customer_open_items(p_customer bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  return json_build_object('invoices', private.customer_open_invoices(p_customer), 'credits', private.customer_open_credits(p_customer));
end $$;

-- ---------- customer statements and receivables ageing ----------

-- Statement of account from the ledger (receivables and advances for the customer). Entries that only move money
-- between the two (an advance set against an invoice) net to nothing and are left out.
create or replace function public.customer_statement(p_customer bigint, p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me      public.profiles := private.current_manager();
  f       date := coalesce(p_from, private.fy_start(private.today()));
  t       date := coalesce(p_to, private.today());
  opening numeric;
  accts   bigint[] := array[private.acct('ar'), private.acct('customer_advances')];
  c       public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  select coalesce(sum(l.debit - l.credit), 0) into opening
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.customer_id = p_customer and l.account_id = any(accts) and j.entry_date < f;
  return (
    with per_journal as (
      select j.id as journal_id, j.entry_date, j.number, j.kind, j.memo, j.reference, j.source_type, j.source_id,
             sum(l.debit) - least(sum(l.debit), sum(l.credit)) as debit,
             sum(l.credit) - least(sum(l.debit), sum(l.credit)) as credit
      from public.journal_lines l join public.journals j on j.id = l.journal_id
      where l.customer_id = p_customer and l.account_id = any(accts) and j.entry_date between f and t
      group by j.id
      having sum(l.debit) <> sum(l.credit)
    )
    select json_build_object('from', f, 'to', t, 'opening', opening, 'today', private.today(),
      'customer', jsonb_build_object('id', c.id, 'name', c.name, 'trn', c.trn, 'email', c.email,
                                     'address', concat_ws(E'\n', c.address, c.city, c.country)),
      'company', (select json_build_object('legal_name', legal_name, 'address', address, 'trn', trn, 'phone', phone, 'email', email,
                                           'account_name', account_name, 'bank_name', bank_name, 'iban', iban, 'swift', swift)
                  from public.company_settings where id = 1),
      'lines', coalesce((select json_agg(x order by x.entry_date, x.journal_id) from (
        select p.*, coalesce(
                 case p.source_type when 'invoice' then (select number from public.invoices where id = p.source_id)
                                    when 'credit_note' then (select number from public.credit_notes where id = p.source_id)
                                    when 'receipt' then (select number from public.receipts where id = p.source_id)
                                    when 'payment' then (select 'Payment on ' || i.number from public.payments pm join public.invoices i on i.id = pm.invoice_id where pm.id = p.source_id) end,
                 p.reference, p.number) as document,
               opening + sum(p.debit - p.credit) over (order by p.entry_date, p.journal_id) as balance
        from per_journal p) x), '[]'),
      'closing', opening + coalesce((select sum(debit - credit) from per_journal), 0),
      'open_invoices', (select coalesce(jsonb_agg(o || jsonb_build_object('days', private.today() - coalesce((o ->> 'due_date')::date, (o ->> 'issue_date')::date))), '[]')
                        from jsonb_array_elements(private.customer_open_invoices(p_customer)) o),
      'credits', private.customer_open_credits(p_customer),
      'recipients', coalesce((
        select jsonb_agg(e.email order by e.rank, e.email) from (
          select lower(x.email) as email, min(x.rank) as rank from (
            select c.email, 0 as rank where c.email is not null
            union all
            select k.email, case when k.is_primary then 1 else 2 end from public.contacts k where k.customer_id = c.id and k.email is not null) x
          group by lower(x.email)) e), '[]')));
end $$;

-- Receivables ageing at a date: open tax invoice balances by days past due, per customer, with unused credits.
create or replace function public.receivables_ageing(p_as_of date default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  t  date := coalesce(p_as_of, private.today());
begin
  return json_build_object('as_of', t, 'rows', coalesce((select json_agg(x order by lower(x.name)) from (
    select c.id, c.name, x2.current, x2.d30, x2.d60, x2.d90, x2.d90plus, cr.unallocated
    from public.customers c
    cross join lateral (
      select coalesce(sum(i.total - i.amount_paid) filter (where t - coalesce(i.due_date, i.issue_date) <= 0), 0) as current,
             coalesce(sum(i.total - i.amount_paid) filter (where t - coalesce(i.due_date, i.issue_date) between 1 and 30), 0) as d30,
             coalesce(sum(i.total - i.amount_paid) filter (where t - coalesce(i.due_date, i.issue_date) between 31 and 60), 0) as d60,
             coalesce(sum(i.total - i.amount_paid) filter (where t - coalesce(i.due_date, i.issue_date) between 61 and 90), 0) as d90,
             coalesce(sum(i.total - i.amount_paid) filter (where t - coalesce(i.due_date, i.issue_date) > 90), 0) as d90plus
      from public.invoices i
      where i.customer_id = c.id and i.kind = 'tax' and i.status = 'sent' and i.issue_date <= t and i.total > i.amount_paid) x2
    cross join lateral (
      select coalesce((select sum(private.receipt_unallocated(r.id)) from public.receipts r where r.customer_id = c.id and r.received_on <= t), 0)
           + coalesce((select sum(n.total - n.amount_applied) from public.credit_notes n
                       where n.customer_id = c.id and n.status = 'issued' and n.issue_date <= t), 0) as unallocated) cr
    where x2.current + x2.d30 + x2.d60 + x2.d90 + x2.d90plus > 0 or cr.unallocated > 0) x), '[]'));
end $$;

-- ---------- recurring invoices ----------

create or replace function public.save_recurring_invoice(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_manager();
  d    jsonb := private.clean(p_data, '{
    "customer_id":  {"type": "int", "required": true},
    "title":        {"type": "text", "required": true, "max": 200},
    "every_months": {"type": "enum", "required": true, "values": ["1", "2", "3", "6", "12"]},
    "next_date":    {"type": "date", "required": true},
    "end_date":     {"type": "date"},
    "due_days":     {"type": "int", "default": "30"},
    "notes":        {"type": "text", "max": 2000},
    "active":       {"type": "bool"}
  }');
  chk  jsonb := private.check_sales_lines(p_data -> 'lines');
  errs jsonb := '{}';
  v_id bigint;
begin
  if not exists (select 1 from public.customers where id = (d ->> 'customer_id')::bigint) then
    errs := errs || '{"customer_id": "Pick a customer"}';
  end if;
  if (d ->> 'due_days')::int > 365 then
    errs := errs || '{"due_days": "At most 365 days"}';
  end if;
  if (d ->> 'end_date')::date < (d ->> 'next_date')::date then
    errs := errs || '{"end_date": "Can''t be before the next invoice date"}';
  end if;
  if chk ? 'error' then
    errs := errs || jsonb_build_object('lines', chk ->> 'error');
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  if p_id is null then
    insert into public.recurring_invoices (customer_id, title, every_months, next_date, end_date, due_days, lines, notes, active, created_by)
    values ((d ->> 'customer_id')::bigint, d ->> 'title', (d ->> 'every_months')::int, (d ->> 'next_date')::date, (d ->> 'end_date')::date,
            (d ->> 'due_days')::int, chk -> 'lines', d ->> 'notes', true, me.id)
    returning id into v_id;
  else
    update public.recurring_invoices set customer_id = (d ->> 'customer_id')::bigint, title = d ->> 'title', every_months = (d ->> 'every_months')::int,
      next_date = (d ->> 'next_date')::date, end_date = (d ->> 'end_date')::date, due_days = (d ->> 'due_days')::int, lines = chk -> 'lines',
      notes = d ->> 'notes', active = (d ->> 'active')::boolean
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Recurring invoice not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.list_recurring_invoices() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  return json_build_object('today', private.today(), 'rows', coalesce((select json_agg(x order by x.active desc, x.next_date, x.id) from (
    select r.id, r.title, r.customer_id, c.name as customer_name, r.every_months, r.next_date, r.end_date, r.active,
           (select sum(round(round((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric, 2)
                             * case when l ->> 'vat_code' = 'standard' then 1.05 else 1 end, 2)) from jsonb_array_elements(r.lines) l) as total,
           r.last_invoice_id, (select number from public.invoices where id = r.last_invoice_id) as last_invoice_number,
           r.active and r.next_date <= private.today() as due
    from public.recurring_invoices r join public.customers c on c.id = r.customer_id) x), '[]'));
end $$;

create or replace function public.get_recurring_invoice(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  result json;
begin
  select json_build_object('today', private.today(), 'recurring', to_jsonb(r) || jsonb_build_object('customer_name', c.name,
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'issue_date', i.issue_date, 'status', i.status,
                            'total', i.total, 'amount_paid', i.amount_paid) order by i.issue_date desc, i.id desc)
                          from public.invoices i where i.recurring_id = r.id), '[]')))
  into result
  from public.recurring_invoices r join public.customers c on c.id = r.customer_id where r.id = p_id;
  if result is null then
    raise exception 'Recurring invoice not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

create or replace function public.delete_recurring_invoice(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  delete from public.recurring_invoices where id = p_id;
  if not found then
    raise exception 'Recurring invoice not found' using errcode = 'P0002';
  end if;
end $$;

-- Create the draft tax invoices that are due (for one template, or all), catching up missed periods
-- (at most 12 per template per run). Returns the invoices created.
create or replace function public.run_recurring_invoices(p_id bigint default null) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me      public.profiles := private.current_manager();
  r       public.recurring_invoices;
  n       int;
  period  text;
  inv_id  bigint;
  created jsonb := '[]';
begin
  for r in select * from public.recurring_invoices
           where active and next_date <= private.today() and (p_id is null or id = p_id)
           order by next_date, id for update loop
    n := 0;
    while r.active and r.next_date <= private.today() and n < 12 loop
      period := case when r.every_months = 1 then to_char(r.next_date, 'FMMonth YYYY')
                     else to_char(r.next_date, 'Mon YYYY') || ' - ' || to_char((r.next_date + make_interval(months => r.every_months))::date - 1, 'Mon YYYY') end;
      inv_id := public.save_invoice(null, jsonb_build_object(
        'kind', 'tax', 'customer_id', r.customer_id, 'issue_date', r.next_date, 'due_date', r.next_date + r.due_days,
        'supply_date', r.next_date, 'notes', r.notes,
        'lines', (select jsonb_agg(l || jsonb_build_object('description', replace(l ->> 'description', '{period}', period)))
                  from jsonb_array_elements(r.lines) l)));
      update public.invoices set recurring_id = r.id where id = inv_id;
      created := created || jsonb_build_object('id', inv_id, 'number', (select number from public.invoices where id = inv_id), 'title', r.title);
      r.next_date := (r.next_date + make_interval(months => r.every_months))::date;
      r.active := r.end_date is null or r.next_date <= r.end_date;
      update public.recurring_invoices set next_date = r.next_date, active = r.active, last_invoice_id = inv_id where id = r.id;
      n := n + 1;
    end loop;
  end loop;
  return json_build_object('created', created);
end $$;

-- ---------- bank statement import and reconciliation ----------

-- p_lines: [{date, description, reference, amount (+ in / - out), balance}]. Lines already imported
-- (same account, date, amount, description and reference) are skipped.
create or replace function public.import_bank_statement(p_account bigint, p_file_name text, p_lines jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me      public.profiles := private.current_manager();
  ln      jsonb;
  i       int := 0;
  dt      date;
  amt     numeric;
  bal     numeric;
  descr   text;
  ref     text;
  errs    text[] := '{}';
  imp     bigint;
  added   int := 0;
  n_skip  int := 0;
begin
  if not exists (select 1 from public.accounts where id = p_account and subtype = 'bank') then
    raise exception 'Pick a bank account' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'The file has no transactions' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'At most 5,000 lines at a time' using errcode = '22023';
  end if;
  insert into public.bank_imports (account_id, file_name, imported_by) values (p_account, left(p_file_name, 200), me.id) returning id into imp;
  for ln in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    begin
      dt := (ln ->> 'date')::date;
      amt := round(nullif(btrim(ln ->> 'amount'), '')::numeric, 2);
      bal := round(nullif(btrim(ln ->> 'balance'), '')::numeric, 2);
    exception when others then
      errs := errs || format('Line %s: date or amount not understood', i);
      continue;
    end;
    descr := left(coalesce(nullif(btrim(ln ->> 'description'), ''), '(no description)'), 500);
    ref := left(nullif(btrim(ln ->> 'reference'), ''), 100);
    if dt is null or amt is null then
      errs := errs || format('Line %s: date or amount missing', i);
      continue;
    end if;
    if amt = 0 or abs(amt) >= 1000000000000 then
      n_skip := n_skip + 1;
      continue;
    end if;
    if exists (select 1 from public.bank_statement_lines s where s.account_id = p_account and s.txn_date = dt and s.amount = amt
               and s.description = descr and s.reference is not distinct from ref) then
      n_skip := n_skip + 1;
      continue;
    end if;
    insert into public.bank_statement_lines (account_id, import_id, txn_date, description, reference, amount, balance)
    values (p_account, imp, dt, descr, ref, amt, bal);
    added := added + 1;
  end loop;
  if array_length(errs, 1) > 0 then
    raise exception 'Some lines could not be read: %', array_to_string(errs[1:5], '; ') || case when array_length(errs, 1) > 5 then '…' else '' end
      using errcode = '22023';
  end if;
  update public.bank_imports set line_count = added, skipped = n_skip where id = imp;
  return json_build_object('import_id', imp, 'imported', added, 'skipped', n_skip);
end $$;

-- Ledger lines on a bank account still to be matched (left out: entries that were reversed together with their reversal).
create or replace function private.unmatched_bank_ledger(p_account bigint, p_as_of date) returns table (
  line_id bigint, journal_id bigint, number text, entry_date date, memo text, reference text, amount numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, j.id, j.number, j.entry_date, coalesce(l.description, j.memo), j.reference, l.debit - l.credit
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.account_id = p_account and j.entry_date <= p_as_of and l.debit <> l.credit
    and not exists (select 1 from public.bank_statement_lines s where s.journal_line_id = l.id)
    and not (j.reversed_by_id is not null and not exists (
               select 1 from public.journal_lines l2 join public.bank_statement_lines s2 on s2.journal_line_id = l2.id
               where l2.journal_id in (j.id, j.reversed_by_id)))
    and not (j.reverses_id is not null and not exists (
               select 1 from public.journal_lines l2 join public.bank_statement_lines s2 on s2.journal_line_id = l2.id
               where l2.journal_id in (j.id, j.reverses_id)))
$$;

create or replace function public.bank_reconciliation(p_account bigint, p_as_of date default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  t     date := coalesce(p_as_of, private.today());
  a     public.accounts;
  book  numeric;
  s_bal  numeric;
  s_date date;
  uncl  numeric;
  unst  numeric;
begin
  select * into a from public.accounts where id = p_account and subtype = 'bank';
  if a.id is null then
    raise exception 'Bank account not found' using errcode = 'P0002';
  end if;
  select coalesce(sum(l.debit - l.credit), 0) into book
  from public.journal_lines l join public.journals j on j.id = l.journal_id where l.account_id = a.id and j.entry_date <= t;
  select s.balance, s.txn_date into s_bal, s_date from public.bank_statement_lines s
  where s.account_id = a.id and s.txn_date <= t and s.balance is not null order by s.txn_date desc, s.id desc limit 1;
  select coalesce(sum(amount), 0) into uncl from private.unmatched_bank_ledger(a.id, t);
  select coalesce(sum(amount), 0) into unst from public.bank_statement_lines where account_id = a.id and txn_date <= t and journal_line_id is null;
  return json_build_object(
    'account', jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'bank_name', a.bank_name, 'account_number', a.account_number),
    'as_of', t, 'book_balance', book,
    'statement_balance', s_bal, 'statement_date', s_date,
    'uncleared_ledger', uncl, 'unrecorded_statement', unst,
    'expected_statement_balance', book - uncl + unst,
    'statement_lines', coalesce((select json_agg(x order by x.txn_date, x.id) from (
      select s.id, s.txn_date, s.description, s.reference, s.amount, s.balance,
             (select jsonb_build_object('line_id', u.line_id, 'number', u.number, 'entry_date', u.entry_date, 'memo', u.memo)
              from private.unmatched_bank_ledger(a.id, s.txn_date + 10) u
              where u.amount = s.amount and abs(u.entry_date - s.txn_date) <= 10
              order by abs(u.entry_date - s.txn_date), u.line_id limit 1) as suggestion
      from public.bank_statement_lines s where s.account_id = a.id and s.journal_line_id is null and s.txn_date <= t) x), '[]'),
    'ledger_lines', coalesce((select json_agg(u order by u.entry_date, u.line_id) from private.unmatched_bank_ledger(a.id, t) u), '[]'),
    'matched', coalesce((select json_agg(x order by x.txn_date desc, x.id desc) from (
      select s.id, s.txn_date, s.description, s.amount, j.id as journal_id, j.number, j.entry_date
      from public.bank_statement_lines s join public.journal_lines l on l.id = s.journal_line_id join public.journals j on j.id = l.journal_id
      where s.account_id = a.id order by s.txn_date desc, s.id desc limit 50) x), '[]'),
    'imports', coalesce((select json_agg(x order by x.id desc) from (
      select i.id, i.file_name, i.line_count, i.skipped, i.created_at, u.name as imported_by_name,
             (select min(txn_date) from public.bank_statement_lines where import_id = i.id) as first_date,
             (select max(txn_date) from public.bank_statement_lines where import_id = i.id) as last_date
      from public.bank_imports i left join public.profiles u on u.id = i.imported_by
      where i.account_id = a.id order by i.id desc limit 10) x), '[]'));
end $$;

create or replace function public.match_bank_line(p_statement_line bigint, p_journal_line bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  s  public.bank_statement_lines;
  l  public.journal_lines;
begin
  select * into s from public.bank_statement_lines where id = p_statement_line for update;
  select * into l from public.journal_lines where id = p_journal_line;
  if s.id is null or l.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if s.journal_line_id is not null then
    raise exception 'This bank line is already matched' using errcode = '22023';
  end if;
  if l.account_id <> s.account_id then
    raise exception 'That entry is on a different account' using errcode = '22023';
  end if;
  if l.debit - l.credit <> s.amount then
    raise exception 'The amounts differ (bank AED %, ledger AED %)', to_char(s.amount, 'FM999,999,999,990.00'),
      to_char(l.debit - l.credit, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  if exists (select 1 from public.bank_statement_lines where journal_line_id = l.id) then
    raise exception 'That ledger entry is already matched to another bank line' using errcode = '22023';
  end if;
  update public.bank_statement_lines set journal_line_id = l.id, matched_by = me.id, matched_at = now() where id = s.id;
end $$;

create or replace function public.unmatch_bank_line(p_statement_line bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  update public.bank_statement_lines set journal_line_id = null, matched_by = null, matched_at = null where id = p_statement_line;
  if not found then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
end $$;

-- Match every bank line that has exactly one ledger entry of the same amount within 10 days (closest date first).
create or replace function public.auto_match_bank(p_account bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  s   public.bank_statement_lines;
  hit bigint;
  n   int := 0;
begin
  for s in select * from public.bank_statement_lines where account_id = p_account and journal_line_id is null order by txn_date, id loop
    select u.line_id into hit from private.unmatched_bank_ledger(p_account, s.txn_date + 10) u
    where u.amount = s.amount and abs(u.entry_date - s.txn_date) <= 10
    order by abs(u.entry_date - s.txn_date), u.line_id limit 1;
    if hit is not null then
      update public.bank_statement_lines set journal_line_id = hit, matched_by = me.id, matched_at = now() where id = s.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Record a bank line that isn't in the books yet (bank charges, interest, a direct debit...) and match it.
create or replace function public.bank_line_entry(p_statement_line bigint, p_other_account bigint, p_memo text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  s     public.bank_statement_lines;
  other public.accounts;
  jid   bigint;
  lid   bigint;
begin
  select * into s from public.bank_statement_lines where id = p_statement_line for update;
  if s.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if s.journal_line_id is not null then
    raise exception 'This bank line is already matched' using errcode = '22023';
  end if;
  select * into other from public.accounts where id = p_other_account and active;
  if other.id is null or other.id = s.account_id then
    raise exception 'Pick the account for the other side' using errcode = '22023';
  end if;
  if other.system_key in ('ar', 'ap', 'customer_advances') then
    raise exception 'Customer and supplier money goes through a receipt or payment voucher instead' using errcode = '22023';
  end if;
  jid := private.post_journal(s.txn_date, case when s.amount > 0 then 'bank_receipt' else 'bank_payment' end,
    coalesce(nullif(btrim(p_memo), ''), s.description), s.reference, null, null,
    jsonb_build_array(
      jsonb_build_object('account_id', s.account_id, 'debit', greatest(s.amount, 0), 'credit', greatest(-s.amount, 0), 'description', s.description),
      jsonb_build_object('account_id', other.id, 'debit', greatest(-s.amount, 0), 'credit', greatest(s.amount, 0), 'description', s.description)),
    me.id);
  select id into lid from public.journal_lines where journal_id = jid and account_id = s.account_id;
  update public.bank_statement_lines set journal_line_id = lid, matched_by = me.id, matched_at = now() where id = s.id;
  return jid;
end $$;

create or replace function public.delete_bank_import(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  delete from public.bank_imports where id = p_id;
  if not found then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;
end $$;

-- ---------- petty cash ----------

-- p_data: account_id (a cash account; default petty cash), spent_on, payee, payee_trn, description, expense_account_id,
-- vat_code, recoverable, total (amount paid, VAT included), receipt_ref
create or replace function public.record_petty_cash(p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  d     jsonb := private.clean(p_data, '{
    "account_id":         {"type": "int"},
    "spent_on":           {"type": "date", "required": true},
    "payee":              {"type": "text", "required": true, "max": 200},
    "payee_trn":          {"type": "text", "format": "trn"},
    "description":        {"type": "text", "required": true, "max": 500},
    "expense_account_id": {"type": "int", "required": true},
    "vat_code":           {"type": "enum", "required": true, "values": ["standard", "zero", "exempt", "out_of_scope"]},
    "recoverable":        {"type": "bool"},
    "receipt_ref":        {"type": "text", "max": 100},
    "department_id":      {"type": "int"}
  }');
  box   bigint := coalesce((d ->> 'account_id')::bigint, private.acct('petty_cash'));
  exp   public.accounts;
  tot   numeric;
  vat   numeric;
  net   numeric;
  rec   boolean := (d ->> 'recoverable')::boolean and d ->> 'vat_code' = 'standard';
  errs  jsonb := '{}';
  v_id  bigint;
  num   text;
begin
  if not exists (select 1 from public.accounts where id = box and subtype = 'cash' and active) then
    errs := errs || '{"account_id": "Pick a cash account"}';
  end if;
  select * into exp from public.accounts where id = (d ->> 'expense_account_id')::bigint and active;
  if exp.id is null or exp.type not in ('expense', 'asset') or exp.subtype in ('bank', 'cash', 'pdc', 'receivable', 'vat_input') then
    errs := errs || '{"expense_account_id": "Pick an expense account"}';
  end if;
  begin
    tot := nullif(btrim(p_data ->> 'total'), '')::numeric;
  exception when others then tot := null;
  end;
  if tot is null or tot <= 0 or scale(tot) > 2 or tot >= 1000000000 then
    errs := errs || '{"total": "Enter the amount paid, above 0"}';
  end if;
  if (d ->> 'spent_on')::date > private.today() then
    errs := errs || '{"spent_on": "Can''t be in the future"}';
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  vat := case when d ->> 'vat_code' = 'standard' then round(tot * 5 / 105, 2) else 0 end;
  net := tot - vat;
  num := private.next_doc_number('petty_cash', 'PC', (d ->> 'spent_on')::date);
  insert into public.petty_cash_expenses (number, account_id, spent_on, payee, payee_trn, description, expense_account_id, vat_code,
                                          recoverable, net, vat, total, receipt_ref, created_by, department_id)
  values (num, box, (d ->> 'spent_on')::date, d ->> 'payee', d ->> 'payee_trn', d ->> 'description', exp.id, d ->> 'vat_code',
          rec or d ->> 'vat_code' <> 'standard', net, vat, tot, d ->> 'receipt_ref', me.id, (d ->> 'department_id')::bigint)
  returning id into v_id;
  perform private.post_journal((d ->> 'spent_on')::date, 'petty_cash', format('%s %s - %s', num, d ->> 'payee', d ->> 'description'),
    coalesce(d ->> 'receipt_ref', num), 'petty_cash', v_id,
    jsonb_build_array(
      jsonb_build_object('account_id', exp.id, 'debit', net + case when rec then 0 else vat end, 'credit', 0, 'description', d ->> 'description'),
      jsonb_build_object('account_id', private.acct('vat_input'), 'debit', case when rec then vat else 0 end, 'credit', 0, 'description', 'VAT on ' || num),
      jsonb_build_object('account_id', box, 'debit', 0, 'credit', tot, 'description', d ->> 'payee')),
    me.id);
  perform private.tag_journal((select max(id) from public.journals where source_type = 'petty_cash' and source_id = v_id), null, null, (d ->> 'department_id')::bigint);
  return v_id;
end $$;

create or replace function public.void_petty_cash(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  e   public.petty_cash_expenses;
  jid bigint;
begin
  select * into e from public.petty_cash_expenses where id = p_id for update;
  if e.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if e.status = 'void' then
    return;
  end if;
  for jid in select id from public.journals where source_type = 'petty_cash' and source_id = p_id and reversed_by_id is null and reverses_id is null loop
    perform private.reverse_journal(jid, greatest(private.today(), e.spent_on), null, me.id);
  end loop;
  update public.petty_cash_expenses set status = 'void', voided_at = now() where id = p_id;
end $$;

-- Petty cash book for a period: cash accounts with balances, spending, and top-ups / other money in.
create or replace function public.petty_cash(p_from date, p_to date, p_account bigint default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me  public.profiles := private.current_manager();
  f   date := coalesce(p_from, date_trunc('month', private.today())::date);
  t   date := coalesce(p_to, private.today());
  box bigint := coalesce(p_account, private.acct('petty_cash'));
begin
  return json_build_object('from', f, 'to', t, 'account_id', box,
    'accounts', coalesce((select json_agg(x order by x.code) from (
      select a.id, a.code, a.name, a.active, coalesce((select sum(l.debit - l.credit) from public.journal_lines l where l.account_id = a.id), 0) as balance
      from public.accounts a where a.subtype = 'cash') x), '[]'),
    'opening', coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journals j on j.id = l.journal_id
                         where l.account_id = box and j.entry_date < f), 0),
    'closing', coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journals j on j.id = l.journal_id
                         where l.account_id = box and j.entry_date <= t), 0),
    'expenses', coalesce((select json_agg(x order by x.spent_on desc, x.id desc) from (
      select e.id, e.number, e.spent_on, e.payee, e.payee_trn, e.description, e.vat_code, e.recoverable, e.net, e.vat, e.total, e.receipt_ref, e.status,
             a.code || ' · ' || a.name as expense_account,
             (select j.id from public.journals j where j.source_type = 'petty_cash' and j.source_id = e.id order by j.id limit 1) as journal_id
      from public.petty_cash_expenses e join public.accounts a on a.id = e.expense_account_id
      where e.account_id = box and e.spent_on between f and t) x), '[]'),
    'money_in', coalesce((select json_agg(x order by x.entry_date desc, x.id desc) from (
      select j.id, j.number, j.entry_date, j.memo, l.debit as amount
      from public.journal_lines l join public.journals j on j.id = l.journal_id
      where l.account_id = box and l.debit > 0 and j.entry_date between f and t and coalesce(j.source_type, '') <> 'petty_cash') x), '[]'));
end $$;


-- -------------------------------------------------------------------------------------
-- API: departments, profitability tags, cash flow, detailed trial balance, profitability,
-- recurring journals, accruals and prepayments schedules
-- -------------------------------------------------------------------------------------

-- Tag a journal's income and expense lines (where not tagged yet) with customer, type of work and department.
-- The department defaults to the type of work's department.
create or replace function private.tag_journal(p_journal bigint, p_customer bigint, p_work_type bigint, p_department bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dep bigint := coalesce(p_department, (select department_id from public.work_types where id = p_work_type));
begin
  if p_journal is null or (p_customer is null and p_work_type is null and dep is null) then
    return;
  end if;
  update public.journal_lines l set
    customer_id = coalesce(l.customer_id, p_customer),
    work_type_id = coalesce(l.work_type_id, p_work_type),
    department_id = coalesce(l.department_id, dep)
  from public.accounts a
  where a.id = l.account_id and a.type in ('income', 'expense') and l.journal_id = p_journal;
end $$;

create or replace function public.list_departments() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_member();
begin
  return coalesce((select json_agg(json_build_object('id', d.id, 'name', d.name, 'active', d.active,
      'work_types', (select coalesce(json_agg(w.name order by lower(w.name)), '[]') from public.work_types w where w.department_id = d.id))
    order by not d.active, lower(d.name)) from public.departments d), '[]');
end $$;

create or replace function public.save_department(p_id bigint, p_name text, p_active boolean default true) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_manager();
  v_id bigint;
begin
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 100 then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"name": "Enter a name (up to 100 characters)"}';
  end if;
  begin
    if p_id is null then
      insert into public.departments (name, active) values (btrim(p_name), coalesce(p_active, true)) returning id into v_id;
    else
      update public.departments set name = btrim(p_name), active = coalesce(p_active, true) where id = p_id returning id into v_id;
      if v_id is null then
        raise exception 'Department not found' using errcode = 'P0002';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = '{"name": "There is already a department with this name"}';
  end;
  return v_id;
end $$;

create or replace function public.set_work_type_department(p_id bigint, p_department bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  if p_department is not null and not exists (select 1 from public.departments where id = p_department) then
    raise exception 'Department not found' using errcode = 'P0002';
  end if;
  update public.work_types set department_id = p_department where id = p_id;
  if not found then
    raise exception 'Type of work not found' using errcode = 'P0002';
  end if;
end $$;

-- Tags to pick from on forms: customers, types of work, departments.
create or replace function public.profit_tags() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  return json_build_object(
    'customers', coalesce((select json_agg(json_build_object('id', id, 'name', name) order by lower(name)) from public.customers where status <> 'inactive'), '[]'),
    'work_types', coalesce((select json_agg(json_build_object('id', id, 'name', name, 'department_id', department_id) order by lower(name)) from public.work_types where active), '[]'),
    'departments', coalesce((select json_agg(json_build_object('id', id, 'name', name) order by lower(name)) from public.departments where active), '[]'));
end $$;

-- ---------- reports ----------

-- Cash flow statement (indirect method) for a period: profit, then the cash effect of the movement on every
-- other balance sheet account, grouped as operating, investing and financing. Opening balance entries are left out.
create or replace function public.cash_flow(p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  f  date := coalesce(p_from, private.fy_start(private.today()));
  t  date := coalesce(p_to, private.today());
begin
  if t < f then
    raise exception 'The end date is before the start date' using errcode = '22023';
  end if;
  return (
    with mv as (
      select a.id, a.code, a.name, a.type, a.subtype, a.system_key,
             coalesce(sum(l.credit - l.debit) filter (where j.kind <> 'opening'), 0) as effect
      from public.accounts a
      join public.journal_lines l on l.account_id = a.id
      join public.journals j on j.id = l.journal_id
      where j.entry_date between f and t
      group by a.id
    ), classed as (
      select mv.*, case
          when type in ('income', 'expense') then 'profit'
          when subtype in ('cash', 'bank') then 'cash'
          when system_key = 'accum_depreciation' then 'adjustment'
          when system_key = 'eosb' then 'adjustment'
          when subtype = 'fixed_asset' then 'investing'
          when subtype in ('long_term_liability', 'equity', 'retained_earnings', 'opening_equity') then 'financing'
          else 'operating' end as grp
      from mv where effect <> 0
    ), cash as (
      select coalesce(sum(l.debit - l.credit) filter (where j.entry_date < f or (j.kind = 'opening' and j.entry_date <= t)), 0) as start_bal,
             coalesce(sum(l.debit - l.credit) filter (where j.entry_date <= t), 0) as end_bal
      from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
      where a.subtype in ('cash', 'bank')
    )
    select json_build_object('from', f, 'to', t,
      'profit', coalesce((select sum(effect) from classed where grp = 'profit'), 0),
      'adjustments', coalesce((select json_agg(json_build_object('code', code, 'name', name, 'amount', effect) order by code) from classed where grp = 'adjustment'), '[]'),
      'working_capital', coalesce((select json_agg(json_build_object('code', code, 'name', name, 'amount', effect) order by code) from classed where grp = 'operating'), '[]'),
      'investing', coalesce((select json_agg(json_build_object('code', code, 'name', name, 'amount', effect) order by code) from classed where grp = 'investing'), '[]'),
      'financing', coalesce((select json_agg(json_build_object('code', code, 'name', name, 'amount', effect) order by code) from classed where grp = 'financing'), '[]'),
      'operating_total', coalesce((select sum(effect) from classed where grp in ('profit', 'adjustment', 'operating')), 0),
      'investing_total', coalesce((select sum(effect) from classed where grp = 'investing'), 0),
      'financing_total', coalesce((select sum(effect) from classed where grp = 'financing'), 0),
      'cash_start', (select start_bal from cash),
      'cash_end', (select end_bal from cash),
      'cash_accounts', coalesce((select json_agg(json_build_object('code', code, 'name', name, 'change', -effect) order by code) from classed where grp = 'cash'), '[]')));
end $$;

-- Customer and supplier breakdown of receivables, customer advances and payables, for the detailed trial balance.
create or replace function public.trial_balance_parties(p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  f  date := coalesce(p_from, private.fy_start(private.today()));
  t  date := coalesce(p_to, private.today());
begin
  return coalesce((select json_agg(x order by x.account_id, lower(x.name)) from (
    select l.account_id,
           case when a.subtype = 'payable' then 'supplier' else 'customer' end as party_type,
           coalesce(l.customer_id, l.supplier_id) as party_id,
           coalesce(c.name, s.name, 'Not linked to a customer or supplier') as name,
           coalesce(sum(l.debit - l.credit) filter (where j.entry_date < f), 0) as opening,
           coalesce(sum(l.debit) filter (where j.entry_date >= f), 0) as debit,
           coalesce(sum(l.credit) filter (where j.entry_date >= f), 0) as credit
    from public.journal_lines l
    join public.journals j on j.id = l.journal_id
    join public.accounts a on a.id = l.account_id
    left join public.customers c on c.id = l.customer_id and a.subtype <> 'payable'
    left join public.suppliers s on s.id = l.supplier_id and a.subtype = 'payable'
    where a.subtype in ('receivable', 'customer_advance', 'payable') and j.entry_date <= t
    group by l.account_id, a.subtype, coalesce(l.customer_id, l.supplier_id), coalesce(c.name, s.name, 'Not linked to a customer or supplier')
    having coalesce(sum(l.debit - l.credit) filter (where j.entry_date < f), 0) <> 0
        or coalesce(sum(l.debit) filter (where j.entry_date >= f), 0) <> 0
        or coalesce(sum(l.credit) filter (where j.entry_date >= f), 0) <> 0) x), '[]');
end $$;

-- Profit by customer, type of work or department: income, direct costs (cost of sales) and other expenses
-- on lines tagged with it. Untagged lines are shown together as "Not assigned".
create or replace function public.profitability(p_from date, p_to date, p_by text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  f  date := coalesce(p_from, private.fy_start(private.today()));
  t  date := coalesce(p_to, private.today());
  v_by text := coalesce(nullif(p_by, ''), 'customer');
begin
  if v_by not in ('customer', 'work_type', 'department') then
    raise exception 'Unknown grouping' using errcode = '22023';
  end if;
  return json_build_object('from', f, 'to', t, 'by', v_by, 'rows', coalesce((select json_agg(x order by x.key is null, x.revenue desc, lower(x.name)) from (
    select k.key,
           coalesce(case v_by when 'customer' then (select name from public.customers where id = k.key)
                            when 'work_type' then (select name from public.work_types where id = k.key)
                            else (select name from public.departments where id = k.key) end, 'Not assigned') as name,
           coalesce(sum(l.credit - l.debit) filter (where a.type = 'income'), 0) as revenue,
           coalesce(sum(l.debit - l.credit) filter (where a.subtype = 'cost_of_sales'), 0) as direct_costs,
           coalesce(sum(l.debit - l.credit) filter (where a.type = 'expense' and a.subtype <> 'cost_of_sales'), 0) as other_expenses
    from public.journal_lines l
    join public.journals j on j.id = l.journal_id
    join public.accounts a on a.id = l.account_id
    cross join lateral (select case v_by when 'customer' then l.customer_id when 'work_type' then l.work_type_id else l.department_id end as key) k
    where a.type in ('income', 'expense') and j.entry_date between f and t
    group by k.key
    having sum(l.debit) <> 0 or sum(l.credit) <> 0) x), '[]'));
end $$;

-- ---------- recurring journals ----------

-- Check journal lines [{account_id, debit, credit, description, customer_id}]: returns {lines, total, error}.
create or replace function private.check_journal_lines(p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ln    jsonb;
  i     int := 0;
  dr    numeric;
  cr    numeric;
  acc   public.accounts;
  errs  text[] := '{}';
  res   jsonb := '[]';
  tdr   numeric := 0;
  tcr   numeric := 0;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) < 2 then
    return '{"error": "Add at least two lines"}';
  end if;
  for ln in select value from jsonb_array_elements(p_lines) loop
    i := i + 1;
    begin
      dr := coalesce(nullif(btrim(ln ->> 'debit'), '')::numeric, 0);
      cr := coalesce(nullif(btrim(ln ->> 'credit'), '')::numeric, 0);
    exception when others then
      errs := errs || format('Line %s: amounts must be numbers', i);
      continue;
    end;
    continue when dr = 0 and cr = 0;
    select * into acc from public.accounts where id = nullif(ln ->> 'account_id', '')::bigint;
    if acc.id is null or not acc.active then
      errs := errs || format('Line %s: pick an account', i);
    elsif dr < 0 or cr < 0 or (dr > 0 and cr > 0) or scale(dr) > 2 or scale(cr) > 2 then
      errs := errs || format('Line %s: enter either a debit or a credit, 0 or more, with at most 2 decimals', i);
    else
      tdr := tdr + dr;
      tcr := tcr + cr;
      res := res || jsonb_build_object('account_id', acc.id, 'debit', dr, 'credit', cr, 'description', nullif(btrim(ln ->> 'description'), ''),
        'customer_id', case when acc.subtype in ('receivable', 'customer_advance') then nullif(ln ->> 'customer_id', '')::bigint end);
    end if;
  end loop;
  if array_length(errs, 1) > 0 then
    return jsonb_build_object('error', array_to_string(errs, '. '));
  elsif tdr = 0 then
    return '{"error": "Enter the amounts"}';
  elsif tdr <> tcr then
    return jsonb_build_object('error', format('Debits (AED %s) and credits (AED %s) differ by AED %s',
      to_char(tdr, 'FM999,999,999,990.00'), to_char(tcr, 'FM999,999,999,990.00'), to_char(abs(tdr - tcr), 'FM999,999,999,990.00')));
  end if;
  return jsonb_build_object('lines', res, 'total', tdr);
end $$;

create or replace function public.save_recurring_journal(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me   public.profiles := private.current_manager();
  d    jsonb := private.clean(p_data, '{
    "memo":          {"type": "text", "required": true, "max": 500},
    "reference":     {"type": "text", "max": 100},
    "every_months":  {"type": "enum", "required": true, "values": ["1", "2", "3", "6", "12"]},
    "next_date":     {"type": "date", "required": true},
    "end_date":      {"type": "date"},
    "department_id": {"type": "int"},
    "active":        {"type": "bool"}
  }');
  chk  jsonb := private.check_journal_lines(p_data -> 'lines');
  errs jsonb := '{}';
  v_id bigint;
begin
  if chk ? 'error' then
    errs := errs || jsonb_build_object('lines', chk ->> 'error');
  end if;
  if (d ->> 'end_date')::date < (d ->> 'next_date')::date then
    errs := errs || '{"end_date": "Can''t be before the next date"}';
  end if;
  if d ->> 'department_id' is not null and not exists (select 1 from public.departments where id = (d ->> 'department_id')::bigint) then
    errs := errs || '{"department_id": "Pick a department"}';
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  if p_id is null then
    insert into public.recurring_journals (memo, reference, every_months, next_date, end_date, department_id, lines, active, created_by)
    values (d ->> 'memo', d ->> 'reference', (d ->> 'every_months')::int, (d ->> 'next_date')::date, (d ->> 'end_date')::date,
            (d ->> 'department_id')::bigint, chk -> 'lines', true, me.id)
    returning id into v_id;
  else
    update public.recurring_journals set memo = d ->> 'memo', reference = d ->> 'reference', every_months = (d ->> 'every_months')::int,
      next_date = (d ->> 'next_date')::date, end_date = (d ->> 'end_date')::date, department_id = (d ->> 'department_id')::bigint,
      lines = chk -> 'lines', active = (d ->> 'active')::boolean
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Recurring journal not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.list_recurring_journals() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  return json_build_object('today', private.today(), 'rows', coalesce((select json_agg(x order by x.active desc, x.next_date, x.id) from (
    select r.id, r.memo, r.every_months, r.next_date, r.end_date, r.active,
           (select sum((l ->> 'debit')::numeric) from jsonb_array_elements(r.lines) l) as amount,
           r.last_journal_id, (select number from public.journals where id = r.last_journal_id) as last_journal_number,
           r.active and r.next_date <= private.today() as due
    from public.recurring_journals r) x), '[]'));
end $$;

create or replace function public.get_recurring_journal(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me     public.profiles := private.current_manager();
  result json;
begin
  select json_build_object('today', private.today(), 'recurring', to_jsonb(r) || jsonb_build_object(
    'department_name', (select name from public.departments where id = r.department_id),
    'lines', (select coalesce(jsonb_agg(l || jsonb_build_object('code', a.code, 'account', a.name,
                'customer_name', (select name from public.customers where id = (l ->> 'customer_id')::bigint)) order by n), '[]')
              from jsonb_array_elements(r.lines) with ordinality as x(l, n) join public.accounts a on a.id = (l ->> 'account_id')::bigint),
    'journals', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'number', j.number, 'entry_date', j.entry_date, 'memo', j.memo,
                   'reversed', j.reversed_by_id is not null) order by j.entry_date desc, j.id desc)
                 from public.journals j where j.recurring_journal_id = r.id), '[]')))
  into result
  from public.recurring_journals r where r.id = p_id;
  if result is null then
    raise exception 'Recurring journal not found' using errcode = 'P0002';
  end if;
  return result;
end $$;

create or replace function public.delete_recurring_journal(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  delete from public.recurring_journals where id = p_id;
  if not found then
    raise exception 'Recurring journal not found' using errcode = 'P0002';
  end if;
end $$;

-- Post the recurring journals that are due (one, or all), catching up missed periods (at most 12 per run each).
create or replace function public.run_recurring_journals(p_id bigint default null) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me      public.profiles := private.current_manager();
  r       public.recurring_journals;
  n       int;
  period  text;
  jid     bigint;
  created jsonb := '[]';
begin
  for r in select * from public.recurring_journals
           where active and next_date <= private.today() and (p_id is null or id = p_id)
           order by next_date, id for update loop
    n := 0;
    while r.active and r.next_date <= private.today() and n < 12 loop
      period := case when r.every_months = 1 then to_char(r.next_date, 'FMMonth YYYY')
                     else to_char(r.next_date, 'Mon YYYY') || ' - ' || to_char((r.next_date + make_interval(months => r.every_months))::date - 1, 'Mon YYYY') end;
      jid := private.post_journal(r.next_date, 'journal', replace(r.memo, '{period}', period), r.reference, null, null,
        (select jsonb_agg(l || jsonb_build_object('department_id', r.department_id)) from jsonb_array_elements(r.lines) l), me.id);
      -- Department only on income and expense lines
      update public.journal_lines l set department_id = null from public.accounts a
      where l.journal_id = jid and a.id = l.account_id and a.type not in ('income', 'expense');
      update public.journals set recurring_journal_id = r.id where id = jid;
      created := created || jsonb_build_object('id', jid, 'number', (select number from public.journals where id = jid), 'memo', r.memo);
      r.next_date := (r.next_date + make_interval(months => r.every_months))::date;
      r.active := r.end_date is null or r.next_date <= r.end_date;
      update public.recurring_journals set next_date = r.next_date, active = r.active, last_journal_id = jid where id = r.id;
      n := n + 1;
    end loop;
  end loop;
  return json_build_object('created', created);
end $$;

-- ---------- accruals and prepayments schedules ----------

-- The schedule's months: period (first of month), posting date (month end), amount (the last month takes the rounding).
create or replace function private.schedule_plan(s public.schedules) returns table (n int, period date, post_on date, amount numeric)
language sql immutable as $$
  select g.n, (s.start_month + make_interval(months => g.n - 1))::date,
         ((s.start_month + make_interval(months => g.n))::date - 1),
         case when g.n < s.months then round(s.total / s.months, 2) else s.total - round(s.total / s.months, 2) * (s.months - 1) end
  from generate_series(1, s.months) as g(n)
$$;

create or replace function public.save_schedule(p_id bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me    public.profiles := private.current_manager();
  d     jsonb := private.clean(p_data, '{
    "kind":               {"type": "enum", "required": true, "values": ["prepayment", "accrual"]},
    "name":               {"type": "text", "required": true, "max": 200},
    "months":             {"type": "int", "required": true},
    "start_month":        {"type": "date", "required": true},
    "expense_account_id": {"type": "int", "required": true},
    "balance_account_id": {"type": "int"},
    "department_id":      {"type": "int"},
    "notes":              {"type": "text", "max": 1000},
    "active":             {"type": "bool"}
  }');
  tot   numeric;
  errs  jsonb := '{}';
  exp   public.accounts;
  bal   bigint;
  old_s public.schedules;
  v_id  bigint;
begin
  begin
    tot := nullif(btrim(p_data ->> 'total'), '')::numeric;
  exception when others then tot := null;
  end;
  if tot is null or tot <= 0 or scale(tot) > 2 or tot >= 1000000000000 then
    errs := errs || '{"total": "Enter the total amount, above 0"}';
  end if;
  if (d ->> 'months')::int not between 1 and 120 then
    errs := errs || '{"months": "Between 1 and 120 months"}';
  end if;
  select * into exp from public.accounts where id = (d ->> 'expense_account_id')::bigint and active;
  if exp.id is null or exp.type <> 'expense' then
    errs := errs || '{"expense_account_id": "Pick an expense account"}';
  end if;
  bal := coalesce((d ->> 'balance_account_id')::bigint, case d ->> 'kind' when 'prepayment' then private.acct('prepaid') else private.acct('accruals') end);
  if not exists (select 1 from public.accounts where id = bal and active and
                 ((d ->> 'kind' = 'prepayment' and type = 'asset' and subtype = 'current_asset') or
                  (d ->> 'kind' = 'accrual' and type = 'liability' and subtype = 'current_liability'))) then
    errs := errs || jsonb_build_object('balance_account_id', case d ->> 'kind' when 'prepayment' then 'Pick a current asset account (e.g. Prepaid expenses)'
                                                                                 else 'Pick a current liability account (e.g. Accrued expenses)' end);
  end if;
  if errs <> '{}' then
    raise exception 'Please fix the highlighted fields' using errcode = '22023', detail = errs::text;
  end if;
  if p_id is null then
    insert into public.schedules (kind, name, total, months, start_month, expense_account_id, balance_account_id, department_id, notes, created_by)
    values (d ->> 'kind', d ->> 'name', tot, (d ->> 'months')::int, date_trunc('month', (d ->> 'start_month')::date)::date,
            exp.id, bal, (d ->> 'department_id')::bigint, d ->> 'notes', me.id)
    returning id into v_id;
  else
    select * into old_s from public.schedules where id = p_id for update;
    if old_s.id is null then
      raise exception 'Schedule not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.schedule_postings where schedule_id = p_id)
       and (old_s.kind <> d ->> 'kind' or old_s.total <> tot or old_s.months <> (d ->> 'months')::int
            or old_s.start_month <> date_trunc('month', (d ->> 'start_month')::date)::date
            or old_s.expense_account_id <> exp.id or old_s.balance_account_id <> bal) then
      raise exception 'Months have already been posted, so only the name, department, notes and active can change. Undo the postings first to change the amounts.'
        using errcode = '22023';
    end if;
    update public.schedules set kind = d ->> 'kind', name = d ->> 'name', total = tot, months = (d ->> 'months')::int,
      start_month = date_trunc('month', (d ->> 'start_month')::date)::date, expense_account_id = exp.id, balance_account_id = bal,
      department_id = (d ->> 'department_id')::bigint, notes = d ->> 'notes', active = (d ->> 'active')::boolean
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.list_schedules() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  t  date := private.today();
begin
  return json_build_object('today', t, 'rows', coalesce((select json_agg(x order by x.active desc, x.kind, lower(x.name)) from (
    select s.id, s.kind, s.name, s.total, s.months, s.start_month, s.active,
           ea.code || ' · ' || ea.name as expense_account,
           coalesce((select sum(p.amount) from public.schedule_postings p where p.schedule_id = s.id), 0) as posted,
           (select count(*) from public.schedule_postings p where p.schedule_id = s.id) as months_posted,
           case when s.active then (select count(*) from private.schedule_plan(s) pl
                                    where pl.post_on <= t and not exists (select 1 from public.schedule_postings p where p.schedule_id = s.id and p.period = pl.period))
                else 0 end as due
    from public.schedules s join public.accounts ea on ea.id = s.expense_account_id) x), '[]'));
end $$;

create or replace function public.get_schedule(p_id bigint) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  s  public.schedules;
begin
  select * into s from public.schedules where id = p_id;
  if s.id is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  return json_build_object('today', private.today(), 'schedule', to_jsonb(s) || jsonb_build_object(
    'expense_account', (select code || ' · ' || name from public.accounts where id = s.expense_account_id),
    'balance_account', (select code || ' · ' || name from public.accounts where id = s.balance_account_id),
    'department_name', (select name from public.departments where id = s.department_id)),
    'plan', (select coalesce(json_agg(json_build_object('n', x.n, 'period', x.period, 'post_on', x.post_on, 'amount', x.amount,
               'posting_id', x.posting_id, 'journal_id', x.journal_id, 'journal_number', x.journal_number, 'balance_after', x.balance_after) order by x.n), '[]')
             from (select pl.n, pl.period, pl.post_on, pl.amount, p.id as posting_id, p.journal_id, j.number as journal_number,
                          s.total - sum(pl.amount) over (order by pl.n) as balance_after
                   from private.schedule_plan(s) pl
                   left join public.schedule_postings p on p.schedule_id = s.id and p.period = pl.period
                   left join public.journals j on j.id = p.journal_id) x));
end $$;

create or replace function public.delete_schedule(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
begin
  if exists (select 1 from public.schedule_postings where schedule_id = p_id) then
    raise exception 'Months have been posted. Undo them first, or stop the schedule instead.' using errcode = '22023';
  end if;
  delete from public.schedules where id = p_id;
  if not found then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
end $$;

-- Post every month that has ended (by p_up_to, default today) and isn't posted yet, for one schedule or all.
-- Prepayment: Dr expense / Cr prepaid. Accrual: Dr expense / Cr accrued expenses.
create or replace function public.run_schedules(p_id bigint default null, p_up_to date default null) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me      public.profiles := private.current_manager();
  t       date := coalesce(p_up_to, private.today());
  s       public.schedules;
  pl      record;
  jid     bigint;
  created jsonb := '[]';
begin
  if t > private.today() then
    raise exception 'Months can only be posted once they have ended' using errcode = '22023';
  end if;
  for s in select * from public.schedules where active and (p_id is null or id = p_id) order by id for update loop
    for pl in select * from private.schedule_plan(s) x
              where x.post_on <= t and not exists (select 1 from public.schedule_postings p where p.schedule_id = s.id and p.period = x.period)
              order by x.n loop
      jid := private.post_journal(pl.post_on, s.kind,
        format('%s: %s (month %s of %s, %s)', case s.kind when 'prepayment' then 'Prepayment' else 'Accrual' end, s.name, pl.n, s.months, to_char(pl.period, 'FMMonth YYYY')),
        null, 'schedule', s.id,
        jsonb_build_array(
          jsonb_build_object('account_id', s.expense_account_id, 'debit', pl.amount, 'credit', 0, 'description', s.name, 'department_id', s.department_id),
          jsonb_build_object('account_id', s.balance_account_id, 'debit', 0, 'credit', pl.amount, 'description', s.name)),
        me.id);
      insert into public.schedule_postings (schedule_id, period, amount, journal_id) values (s.id, pl.period, pl.amount, jid);
      created := created || jsonb_build_object('schedule', s.name, 'period', pl.period, 'amount', pl.amount, 'journal_id', jid);
    end loop;
  end loop;
  return json_build_object('created', created);
end $$;

-- Undo one month's posting (reverses its entry).
create or replace function public.undo_schedule_posting(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_manager();
  p  public.schedule_postings;
begin
  select * into p from public.schedule_postings where id = p_id for update;
  if p.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if p.journal_id is not null and exists (select 1 from public.journals where id = p.journal_id and reversed_by_id is null) then
    perform private.reverse_journal(p.journal_id, greatest(private.today(), (select entry_date from public.journals where id = p.journal_id)), null, me.id);
  end if;
  delete from public.schedule_postings where id = p_id;
end $$;

-- Revenue account for the standard types of work (where not chosen yet).
update public.work_types w set revenue_account_id = a.id
from public.accounts a
where w.revenue_account_id is null and a.code = case lower(w.name)
  when 'sea freight' then '4100' when 'air freight' then '4110' when 'land transport' then '4120'
  when 'customs clearance' then '4130' when 'documentation' then '4140' else null end;

-- Departments for the standard types of work (only while no type of work has a department yet).
update public.work_types w set department_id = d.id from public.departments d
where w.department_id is null and not exists (select 1 from public.work_types x where x.department_id is not null)
  and d.name = case lower(w.name)
    when 'sea freight' then 'Freight forwarding' when 'air freight' then 'Freight forwarding'
    when 'land transport' then 'Transport' when 'customs clearance' then 'Customs clearance'
    when 'documentation' then 'Customs clearance' else null end;

-- Post invoices and payments recorded before the finance module existed (runs once; safe to re-run).
do $$
declare
  r record;
begin
  for r in select i.id from public.invoices i
           where i.kind = 'tax' and i.status in ('sent', 'paid')
             and not exists (select 1 from public.journals j where j.source_type = 'invoice' and j.source_id = i.id)
           order by i.issue_date, i.id loop
    perform private.post_invoice(r.id);
  end loop;
  for r in select p.id from public.payments p where p.posted_side is null order by p.paid_on, p.id loop
    perform private.post_payment(r.id, null);
  end loop;
  -- Profitability tags on income lines of invoices and credit notes posted before phase 4 (and their reversals).
  for r in select j.id as jid, i.customer_id, t.work_type_id from public.journals j
           join public.invoices i on i.id = j.source_id left join public.tasks t on t.id = i.task_id
           where j.source_type = 'invoice'
             and exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id
                         where l.journal_id = j.id and a.type = 'income' and l.customer_id is null) loop
    perform private.tag_journal(r.jid, r.customer_id, r.work_type_id, null);
  end loop;
  for r in select j.id as jid, c.customer_id, t.work_type_id from public.journals j
           join public.credit_notes c on c.id = j.source_id join public.invoices i on i.id = c.invoice_id left join public.tasks t on t.id = i.task_id
           where j.source_type = 'credit_note'
             and exists (select 1 from public.journal_lines l join public.accounts a on a.id = l.account_id
                         where l.journal_id = j.id and a.type = 'income' and l.customer_id is null) loop
    perform private.tag_journal(r.jid, r.customer_id, r.work_type_id, null);
  end loop;
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
    'public.save_work_type(bigint, text, boolean)',
    'public.get_company_settings()',
    'public.save_company_settings(jsonb)',
    'public.save_invoice(bigint, jsonb)',
    'public.get_invoice(bigint)',
    'public.list_invoices(text, text, text, int)',
    'public.mark_invoice_sent(bigint, text)',
    'public.set_invoice_paid(bigint, boolean)',
    'public.cancel_invoice(bigint)',
    'public.list_renewal_types()',
    'public.save_renewal_type(bigint, jsonb)',
    'public.list_renewals(text, text, bigint, text, int)',
    'public.get_renewal(bigint)',
    'public.save_renewal(bigint, jsonb)',
    'public.mark_renewed(bigint, date, text)',
    'public.mark_renewal_reminded(bigint, text)',
    'public.set_renewal_active(bigint, boolean)',
    'public.create_renewal_task(bigint)',
    'public.delete_renewal(bigint)',
    'public.record_payment(bigint, jsonb)',
    'public.set_cheque_status(bigint, text)',
    'public.delete_payment(bigint)',
    'public.mark_payment_reminded(bigint, text)',
    'public.list_payments(text, text, text, int)',
    'public.get_hr_settings()',
    'public.save_hr_settings(jsonb)',
    'public.my_hr()',
    'public.hr_directory()',
    'public.get_employee(uuid)',
    'public.save_employee(uuid, jsonb)',
    'public.attendance_sign(text, double precision, double precision, double precision, text)',
    'public.my_attendance(date, uuid)',
    'public.team_attendance(date)',
    'public.save_attendance(uuid, date, text, text, text)',
    'public.leave_summary(uuid, int)',
    'public.request_leave(jsonb)',
    'public.cancel_leave(bigint)',
    'public.decide_leave(bigint, boolean, text)',
    'public.list_leave_requests(text, int)',
    'public.list_payslips(date, uuid)',
    'public.get_payslip(bigint)',
    'public.save_payslip(bigint, jsonb)',
    'public.generate_payslips(date)',
    'public.set_payslip_published(bigint, boolean)',
    'public.delete_payslip(bigint)',
    'public.list_accounts(boolean)',
    'public.save_account(bigint, jsonb)',
    'public.get_finance_settings()',
    'public.set_books_locked_until(date)',
    'public.post_manual_journal(jsonb)',
    'public.reverse_entry(bigint, date, text)',
    'public.bank_transaction(jsonb)',
    'public.cash_accounts()',
    'public.list_journals(text, text, date, date, int)',
    'public.get_journal(bigint)',
    'public.account_ledger(bigint, date, date, bigint)',
    'public.trial_balance(date, date)',
    'public.profit_loss(date, date)',
    'public.balance_sheet(date)',
    'public.finance_overview()',
    'public.set_work_type_account(bigint, bigint)',
    'public.supplier_options()',
    'public.list_suppliers(text)',
    'public.save_supplier(bigint, jsonb)',
    'public.get_supplier(bigint)',
    'public.save_bill(bigint, jsonb)',
    'public.post_bill(bigint)',
    'public.cancel_bill(bigint)',
    'public.get_bill(bigint)',
    'public.list_bills(text, text, text, bigint, int)',
    'public.record_supplier_payment(jsonb)',
    'public.void_supplier_payment(bigint)',
    'public.allocate_to_bill(bigint, text, bigint, numeric)',
    'public.remove_allocation(bigint)',
    'public.get_supplier_payment(bigint)',
    'public.supplier_statement(bigint, date, date)',
    'public.payables_ageing(date)',
    'public.vat_return(date, date)',
    'public.post_vat_settlement(date, date)',
    'public.save_credit_note(bigint, jsonb)',
    'public.issue_credit_note(bigint)',
    'public.cancel_credit_note(bigint)',
    'public.mark_credit_note_sent(bigint, text)',
    'public.get_credit_note(bigint)',
    'public.list_credit_notes(text, text, int)',
    'public.apply_customer_credit(bigint, text, bigint, numeric)',
    'public.remove_receivable_allocation(bigint)',
    'public.record_receipt(jsonb)',
    'public.void_receipt(bigint)',
    'public.set_receipt_cheque(bigint, text)',
    'public.get_receipt(bigint)',
    'public.list_receipts(text, text, bigint, int)',
    'public.receivable_customers()',
    'public.customer_open_items(bigint)',
    'public.customer_statement(bigint, date, date)',
    'public.receivables_ageing(date)',
    'public.save_recurring_invoice(bigint, jsonb)',
    'public.list_recurring_invoices()',
    'public.get_recurring_invoice(bigint)',
    'public.delete_recurring_invoice(bigint)',
    'public.run_recurring_invoices(bigint)',
    'public.import_bank_statement(bigint, text, jsonb)',
    'public.bank_reconciliation(bigint, date)',
    'public.match_bank_line(bigint, bigint)',
    'public.unmatch_bank_line(bigint)',
    'public.auto_match_bank(bigint)',
    'public.bank_line_entry(bigint, bigint, text)',
    'public.delete_bank_import(bigint)',
    'public.record_petty_cash(jsonb)',
    'public.void_petty_cash(bigint)',
    'public.petty_cash(date, date, bigint)',
    'public.list_departments()',
    'public.save_department(bigint, text, boolean)',
    'public.set_work_type_department(bigint, bigint)',
    'public.profit_tags()',
    'public.cash_flow(date, date)',
    'public.trial_balance_parties(date, date)',
    'public.profitability(date, date, text)',
    'public.save_recurring_journal(bigint, jsonb)',
    'public.list_recurring_journals()',
    'public.get_recurring_journal(bigint)',
    'public.delete_recurring_journal(bigint)',
    'public.run_recurring_journals(bigint)',
    'public.save_schedule(bigint, jsonb)',
    'public.list_schedules()',
    'public.get_schedule(bigint)',
    'public.delete_schedule(bigint)',
    'public.run_schedules(bigint, date)',
    'public.undo_schedule_posting(bigint)'
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
