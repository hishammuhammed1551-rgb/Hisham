'use strict';

// End-to-end tests of supabase/schema.sql through the official supabase-js client,
// against a real local PostgreSQL and the auth/RPC stand-in.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createClient } = require('@supabase/supabase-js');
const { startLocalDb } = require('../local-db');
const { createStandIn } = require('../stand-in');

let db;
let server;
let base;

before(async () => {
  db = await startLocalDb({ port: 54331 });
  server = http.createServer(createStandIn({ pool: db.pool }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.stop();
});

const newClient = () => createClient(base, 'local-dev-anon-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function signUp(name, email, password = 'long-enough-password') {
  const sb = newClient();
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
  assert.equal(error, null);
  return { sb, id: data.user.id };
}

const promote = (email, role = 'admin') =>
  db.pool.query("update public.profiles set role = $2, active = true where email = $1", [email, role]);

/** Call an RPC and return { data, error } where error has code/message/fields. */
async function call(sb, fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (!error) return { data, error: null };
  let fields = {};
  try { fields = JSON.parse(error.details || '{}'); } catch { /* not JSON */ }
  return { data: null, error: { code: error.code, message: error.message, fields } };
}

let admin;
let staff;
let customerId;

test('new sign-ups get a profile with no access until an admin approves them', async () => {
  admin = await signUp('Aisha Admin', 'admin@example.com');
  staff = await signUp('Sami Staff', 'sami@example.com');

  const me = await call(staff.sb, 'me');
  assert.deepEqual({ ...me.data, id: undefined },
    { id: undefined, name: 'Sami Staff', email: 'sami@example.com', role: 'staff', active: false });

  const blocked = await call(staff.sb, 'dashboard');
  assert.equal(blocked.error.code, '42501');
  assert.match(blocked.error.message, /waiting for an administrator/);

  // The owner makes themselves admin once with the SQL line from schema.sql.
  await promote('admin@example.com');
  const users = await call(admin.sb, 'list_users');
  assert.deepEqual(users.data.map(u => [u.email, u.active]), [['sami@example.com', false], ['admin@example.com', true]],
    'waiting users are listed first for admins');

  assert.equal((await call(staff.sb, 'admin_update_user', { p_id: staff.id, p_name: 'Sami', p_role: 'admin', p_active: true })).error.code,
    '42501', 'a waiting user cannot approve themselves');
  assert.equal((await call(admin.sb, 'admin_update_user', { p_id: staff.id, p_name: 'Sami Staff', p_role: 'staff', p_active: true })).error, null);
  assert.equal((await call(staff.sb, 'dashboard')).error, null);

  const staffView = await call(staff.sb, 'list_users');
  assert.equal(staffView.data[0].email, undefined, 'staff do not see colleagues\' emails');
});

test('signed-out visitors and the anon key cannot call anything or read tables', async () => {
  const anon = newClient();
  const res = await call(anon, 'list_customers', {});
  assert.equal(res.error.code, '42501');

  const client = await db.pool.connect();
  try {
    for (const [role, claims] of [['anon', { role: 'anon' }], ['authenticated', { role: 'authenticated', sub: admin.id }]]) {
      await client.query('begin');
      await client.query("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)", [role, JSON.stringify(claims)]);
      await assert.rejects(client.query('select * from public.customers'), /permission denied/, `${role} cannot read tables directly`);
      await client.query('rollback');
      await client.query('begin');
      await client.query("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)", [role, JSON.stringify(claims)]);
      await assert.rejects(client.query("select private.clean('{}', '{}')"), /permission denied/, `${role} cannot call private helpers`);
      await client.query('rollback');
    }
  } finally {
    client.release();
  }
});

test('create, validate, read and update a customer', async () => {
  const bad = await call(staff.sb, 'save_customer', { p_id: null, p_data: { name: '', email: 'not-an-email', trn: '123', status: 'vip' } });
  assert.equal(bad.error.code, '22023');
  assert.deepEqual(Object.keys(bad.error.fields).sort(), ['email', 'name', 'status', 'trn']);

  const created = await call(staff.sb, 'save_customer', { p_id: null, p_data: {
    name: 'Gulf Traders LLC', status: 'lead', email: 'ops@gulftraders.ae', phone: '+971 9 238 0000',
    trn: '100-1234-5678-9012', city: 'Khor Fakkan', services: 'Shipping, Customs', owner_id: staff.id,
  } });
  assert.equal(created.error, null);
  customerId = created.data;
  assert.equal(typeof customerId, 'number');

  const got = (await call(staff.sb, 'get_customer', { p_id: customerId })).data.customer;
  assert.equal(got.trn, '100123456789012', 'TRN is normalised to digits');
  assert.equal(got.owner_name, 'Sami Staff');
  assert.equal(got.created_by_name, 'Sami Staff');
  assert.equal(got.country, 'United Arab Emirates');

  const unknownOwner = await call(staff.sb, 'save_customer', { p_id: customerId, p_data: { ...got, owner_id: '00000000-0000-0000-0000-000000000000' } });
  assert.deepEqual(unknownOwner.error.fields, { owner_id: 'Pick a user who has access' });

  assert.equal((await call(staff.sb, 'save_customer', { p_id: customerId, p_data: { ...got, status: 'active' } })).error, null);
  assert.equal((await call(staff.sb, 'get_customer', { p_id: customerId })).data.customer.status, 'active');
  assert.equal((await call(staff.sb, 'get_customer', { p_id: 999999 })).error.code, 'P0002');
});

test('contacts: only one main contact per customer', async () => {
  const a = await call(staff.sb, 'save_contact', { p_customer_id: customerId, p_id: null, p_data: { name: 'Omar', email: 'omar@gulftraders.ae', is_primary: true } });
  const b = await call(staff.sb, 'save_contact', { p_customer_id: customerId, p_id: null, p_data: { name: 'Lina', is_primary: true } });
  assert.equal(a.error, null);
  assert.equal(b.error, null);
  let contacts = (await call(staff.sb, 'get_customer', { p_id: customerId })).data.customer.contacts;
  assert.deepEqual(contacts.map(c => [c.name, c.is_primary]), [['Lina', true], ['Omar', false]]);

  assert.equal((await call(staff.sb, 'save_contact', { p_customer_id: null, p_id: a.data, p_data: { name: 'Omar K', is_primary: false } })).error, null);
  assert.equal((await call(staff.sb, 'delete_contact', { p_id: b.data })).error, null);
  contacts = (await call(staff.sb, 'get_customer', { p_id: customerId })).data.customer.contacts;
  assert.deepEqual(contacts.map(c => c.name), ['Omar K']);
  assert.equal((await call(staff.sb, 'save_contact', { p_customer_id: 999999, p_id: null, p_data: { name: 'X' } })).error.code, 'P0002');
});

test('search, filters and pagination', async () => {
  await call(staff.sb, 'save_customer', { p_id: null, p_data: { name: 'Sharjah Steel 100% Co', status: 'lead' } });
  await call(admin.sb, 'save_customer', { p_id: null, p_data: { name: 'Fujairah Foods', status: 'inactive', city: 'Fujairah' } });

  const byContact = (await call(staff.sb, 'list_customers', { p_q: 'omar' })).data;
  assert.deepEqual(byContact.customers.map(c => c.name), ['Gulf Traders LLC']);
  assert.equal(byContact.customers[0].contact_name, 'Omar K');

  const pct = (await call(staff.sb, 'list_customers', { p_q: '100%' })).data;
  assert.deepEqual(pct.customers.map(c => c.name), ['Sharjah Steel 100% Co'], '% is matched literally');

  assert.equal((await call(staff.sb, 'list_customers', { p_status: 'inactive' })).data.total, 1);
  assert.equal((await call(staff.sb, 'list_customers', { p_owner: 'me' })).data.total, 1);
  assert.equal((await call(staff.sb, 'list_customers', { p_owner: 'none' })).data.total, 2);
  assert.equal((await call(staff.sb, 'list_customers', { p_owner: staff.id })).data.total, 1);

  const all = (await call(staff.sb, 'list_customers', {})).data;
  assert.equal(all.total, 3);
  assert.equal(all.pageSize, 25);
  assert.deepEqual(all.customers.map(c => c.name), ['Fujairah Foods', 'Gulf Traders LLC', 'Sharjah Steel 100% Co']);

  const newest = (await call(staff.sb, 'list_customers', { p_sort: 'newest' })).data;
  assert.equal(newest.customers[0].name, 'Fujairah Foods');

  for (let i = 0; i < 25; i++) await call(admin.sb, 'save_customer', { p_id: null, p_data: { name: `Bulk ${String(i).padStart(2, '0')}` } });
  const p2 = (await call(staff.sb, 'list_customers', { p_page: 2 })).data;
  assert.equal(p2.total, 28);
  assert.equal(p2.customers.length, 3);
  const exported = (await call(staff.sb, 'export_customers', { p_q: 'bulk' })).data;
  assert.equal(exported.length, 25);
});

test('activities, follow-ups and the dashboard', async () => {
  const noDate = await call(staff.sb, 'add_activity', { p_customer_id: customerId, p_data: { kind: 'follow_up', body: 'Send quote' } });
  assert.deepEqual(noDate.error.fields, { due_at: 'Required for a follow-up' });
  const badDate = await call(staff.sb, 'add_activity', { p_customer_id: customerId, p_data: { kind: 'follow_up', body: 'x', due_at: '2026-02-30' } });
  assert.deepEqual(badDate.error.fields, { due_at: 'Use a date like 2026-01-31' });

  const overdue = await call(staff.sb, 'add_activity', { p_customer_id: customerId, p_data: { kind: 'follow_up', body: 'Chase BL copy', due_at: '2020-01-01' } });
  const call1 = await call(staff.sb, 'add_activity', { p_customer_id: customerId, p_data: { kind: 'call', body: 'Discussed LCL rates', due_at: '2020-01-01' } });
  assert.equal(overdue.error, null);
  assert.equal(call1.error, null);

  let dash = (await call(staff.sb, 'dashboard')).data;
  assert.deepEqual(dash.counts, { lead: 26, active: 1, inactive: 1 });
  assert.equal(dash.myCustomers, 1);
  assert.equal(dash.newThisMonth, 28);
  assert.match(dash.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(dash.overdue.map(a => a.body), ['Chase BL copy']);
  assert.deepEqual(dash.recent.map(a => a.body), ['Discussed LCL rates']);

  const detail = (await call(staff.sb, 'get_customer', { p_id: customerId })).data.customer;
  assert.equal(detail.activities.find(a => a.kind === 'call').due_at, null, 'only follow-ups keep a due date');
  assert.equal(detail.activities[0].user_name, 'Sami Staff');

  assert.equal((await call(staff.sb, 'set_follow_up_done', { p_id: call1.data, p_done: true })).error.code, '22023');
  assert.equal((await call(staff.sb, 'set_follow_up_done', { p_id: overdue.data, p_done: true })).error, null);
  dash = (await call(staff.sb, 'dashboard')).data;
  assert.equal(dash.overdue.length, 0);

  const adminNote = await call(admin.sb, 'add_activity', { p_customer_id: customerId, p_data: { kind: 'note', body: 'VIP' } });
  assert.equal((await call(staff.sb, 'delete_activity', { p_id: adminNote.data })).error.code, '42501', 'staff cannot delete others\' entries');
  assert.equal((await call(staff.sb, 'delete_activity', { p_id: call1.data })).error, null);
  assert.equal((await call(admin.sb, 'delete_activity', { p_id: adminNote.data })).error, null, 'admins can delete any entry');
});

test('staff cannot delete customers; only admins manage users; turning a user off blocks them at once', async () => {
  assert.equal((await call(staff.sb, 'delete_customer', { p_id: customerId })).error.code, '42501');

  const selfDemote = await call(admin.sb, 'admin_update_user', { p_id: admin.id, p_name: 'Aisha Admin', p_role: 'staff', p_active: true });
  assert.equal(selfDemote.error.code, '22023', 'admin cannot demote themselves');

  assert.equal((await call(admin.sb, 'admin_update_user', { p_id: staff.id, p_name: 'Sami Staff', p_role: 'staff', p_active: false })).error, null);
  assert.equal((await call(staff.sb, 'list_customers', {})).error.code, '42501', 'turned-off user is blocked even with a valid session');
  assert.equal((await call(admin.sb, 'save_customer', { p_id: customerId, p_data: { name: 'Gulf Traders LLC', owner_id: staff.id } })).error.fields.owner_id,
    'Pick a user who has access');

  assert.equal((await call(admin.sb, 'delete_customer', { p_id: customerId })).error, null);
  assert.equal((await call(admin.sb, 'get_customer', { p_id: customerId })).error.code, 'P0002');
});

test('users can rename themselves and change their password', async () => {
  assert.equal((await call(admin.sb, 'update_my_name', { p_name: 'Aisha A.' })).error, null);
  assert.equal((await call(admin.sb, 'me')).data.name, 'Aisha A.');
  assert.equal((await admin.sb.auth.updateUser({ password: 'brand-new-password' })).error, null);
  const again = newClient();
  assert.equal((await again.auth.signInWithPassword({ email: 'admin@example.com', password: 'brand-new-password' })).error, null);
  assert.ok((await again.auth.signInWithPassword({ email: 'admin@example.com', password: 'long-enough-password' })).error);
});
