'use strict';

// Tests for renewals (recurring services per customer) in schema.sql, through supabase-js.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createClient } = require('@supabase/supabase-js');
const { startLocalDb } = require('../local-db');
const { createStandIn } = require('../stand-in');

let db; let server; let base;

before(async () => {
  db = await startLocalDb({ port: 54341 });
  server = http.createServer(createStandIn({ pool: db.pool }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.stop();
});

async function member(name, email, role) {
  const sb = createClient(base, 'local-dev-anon-key', { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signUp({ email, password: 'long-enough-password', options: { data: { name } } });
  assert.equal(error, null);
  await db.pool.query('update public.profiles set role = $2, active = true where id = $1', [data.user.id, role]);
  return { sb, id: data.user.id };
}
async function call(who, fn, args) {
  const { data, error } = await who.sb.rpc(fn, args);
  if (!error) return { data, error: null };
  let fields = {};
  try { fields = JSON.parse(error.details || '{}'); } catch { /* not JSON */ }
  return { data: null, error: { code: error.code, message: error.message, fields } };
}
const ok = async (...a) => {
  const r = await call(...a);
  assert.equal(r.error, null, JSON.stringify(r.error));
  return r.data;
};

// Dates relative to "today" in Dubai, as the database sees it.
let today;
const plusDays = n => {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let manager; let staff; let customerId; let types; let vatId; let licenseId; let visaId;

test('renewal types: defaults, managers can edit, team members cannot', async () => {
  manager = await member('Maya Manager', 'maya@example.com', 'manager');
  staff = await member('Sami', 'sami@example.com', 'staff');
  today = (await db.pool.query("select (now() at time zone 'Asia/Dubai')::date::text as d")).rows[0].d;

  types = Object.fromEntries((await ok(staff, 'list_renewal_types')).map(t => [t.name, t]));
  assert.equal(types['VAT return filing'].interval_months, 3);
  assert.equal(types['Trade license renewal'].interval_months, 12);
  assert.equal(types['Residence visa renewal'].interval_months, 24);

  const data = { name: 'Establishment card renewal', interval_months: 12, remind_days: 30, active: true };
  assert.equal((await call(staff, 'save_renewal_type', { p_id: null, p_data: data })).error.code, '42501');
  const id = await ok(manager, 'save_renewal_type', { p_id: null, p_data: data });
  assert.deepEqual((await call(manager, 'save_renewal_type', { p_id: null, p_data: { ...data, name: 'establishment CARD renewal' } })).error.fields,
    { name: 'This renewal type already exists' });
  assert.deepEqual((await call(manager, 'save_renewal_type', { p_id: id, p_data: { ...data, interval_months: 0, remind_days: 400 } })).error.fields,
    { interval_months: 'Use 1 to 120 months', remind_days: 'Use 0 to 365 days' });
  await ok(manager, 'save_renewal_type', { p_id: id, p_data: { ...data, active: false } });
  const off = (await ok(staff, 'list_renewal_types')).at(-1);
  assert.deepEqual([off.name, off.active], ['Establishment card renewal', false]);
});

test('team members add renewals; periods default from the type; validation', async () => {
  customerId = await ok(staff, 'save_customer', { p_id: null, p_data: { name: 'Gulf Traders LLC', email: 'pro@gulftraders.ae' } });
  await ok(staff, 'save_contact', { p_customer_id: customerId, p_id: null, p_data: { name: 'HR', email: 'hr@gulftraders.ae', is_primary: true } });

  const bad = await call(staff, 'save_renewal', { p_id: null, p_data: { customer_id: 999999, type_id: 999999, due_date: 'soon' } });
  assert.deepEqual(Object.keys(bad.error.fields).sort(), ['due_date']);
  const bad2 = await call(staff, 'save_renewal', { p_id: null, p_data: { customer_id: 999999, type_id: 999999, due_date: plusDays(5) } });
  assert.deepEqual(Object.keys(bad2.error.fields).sort(), ['customer_id', 'type_id']);
  const offType = (await ok(staff, 'list_renewal_types')).find(t => !t.active);
  assert.deepEqual((await call(staff, 'save_renewal', { p_id: null, p_data: { customer_id: customerId, type_id: offType.id, due_date: plusDays(5) } })).error.fields,
    { type_id: 'Pick a renewal type from the list' }, 'switched-off types cannot be picked');

  vatId = await ok(staff, 'save_renewal', { p_id: null, p_data: {
    customer_id: customerId, type_id: types['VAT return filing'].id, reference: 'Q4 VAT return', due_date: plusDays(10) } });
  licenseId = await ok(staff, 'save_renewal', { p_id: null, p_data: {
    customer_id: customerId, type_id: types['Trade license renewal'].id, reference: 'License no. 12345', due_date: plusDays(-3),
    assigned_to: staff.id } });
  visaId = await ok(staff, 'save_renewal', { p_id: null, p_data: {
    customer_id: customerId, type_id: types['Residence visa renewal'].id, reference: 'Ahmed Ali', due_date: plusDays(200),
    interval_months: 36, remind_days: 60 } });

  const { renewal: vat } = await ok(staff, 'get_renewal', { p_id: vatId });
  assert.deepEqual([vat.interval_months, vat.remind_days, vat.type_name, vat.customer_name],
    [3, 15, 'VAT return filing', 'Gulf Traders LLC'], 'defaults copied from the type');
  assert.deepEqual(vat.recipients, ['pro@gulftraders.ae', 'hr@gulftraders.ae']);
  assert.equal(vat.events[0].kind, 'created');
  const { renewal: visa } = await ok(staff, 'get_renewal', { p_id: visaId });
  assert.deepEqual([visa.interval_months, visa.remind_days], [36, 60], 'own period and reminder override the type');
});

test('due list, filters and dashboard: inside the reminder window or overdue', async () => {
  const due = await ok(staff, 'list_renewals', {});
  assert.deepEqual(due.renewals.map(r => r.reference), ['License no. 12345', 'Q4 VAT return'],
    'overdue license and VAT (10 days left, reminder window 15) are due; visa (200 days) is not');
  assert.equal((await ok(staff, 'list_renewals', { p_window: 'overdue' })).total, 1);
  assert.equal((await ok(staff, 'list_renewals', { p_window: '90' })).total, 2);
  assert.equal((await ok(staff, 'list_renewals', { p_window: 'all' })).total, 3);
  assert.equal((await ok(staff, 'list_renewals', { p_window: 'all', p_assignee: 'me' })).total, 1);
  assert.equal((await ok(staff, 'list_renewals', { p_window: 'all', p_assignee: 'none' })).total, 2);
  assert.equal((await ok(staff, 'list_renewals', { p_window: 'all', p_type: types['Residence visa renewal'].id })).total, 1);
  assert.equal((await ok(staff, 'list_renewals', { p_window: 'all', p_q: 'ahmed' })).total, 1);

  const dash = await ok(staff, 'dashboard');
  assert.deepEqual(dash.renewalsDue.map(r => [r.type_name, r.reference]),
    [['Trade license renewal', 'License no. 12345'], ['VAT return filing', 'Q4 VAT return']]);
  assert.equal(dash.renewalsDueCount, 2);
  assert.equal(dash.renewalsOverdue, 1);

  const { customer } = await ok(staff, 'get_customer', { p_id: customerId });
  assert.deepEqual(customer.renewals.map(r => r.reference), ['License no. 12345', 'Q4 VAT return', 'Ahmed Ali']);
});

test('remind, renew (rolls the date forward by the period), stop and restart', async () => {
  await ok(staff, 'mark_renewal_reminded', { p_id: vatId, p_to: 'pro@gulftraders.ae' });
  let vat = (await ok(staff, 'get_renewal', { p_id: vatId })).renewal;
  assert.equal(vat.last_reminded_to, 'pro@gulftraders.ae');
  assert.equal(vat.events[0].body, 'Reminded pro@gulftraders.ae');

  const next = await ok(staff, 'mark_renewed', { p_id: vatId, p_new_due: null, p_note: 'Filed on the FTA portal' });
  const expected = (await db.pool.query("select ($1::date + interval '3 months')::date::text as d", [plusDays(10)])).rows[0].d;
  assert.equal(next, expected);
  vat = (await ok(staff, 'get_renewal', { p_id: vatId })).renewal;
  assert.equal(vat.due_date, expected);
  assert.equal(vat.last_reminded_at, null, 'reminder resets for the next period');
  assert.deepEqual([vat.events[0].kind, vat.events[0].old_due, vat.events[0].new_due, vat.events[0].body],
    ['renewed', plusDays(10), expected, 'Filed on the FTA portal']);

  assert.deepEqual((await call(staff, 'mark_renewed', { p_id: licenseId, p_new_due: plusDays(-10) })).error.fields,
    { new_due: 'The next due date must be after the current one' });
  assert.equal(await ok(staff, 'mark_renewed', { p_id: licenseId, p_new_due: plusDays(400) }), plusDays(400), 'a chosen date is used as is');

  assert.equal((await ok(staff, 'list_renewals', {})).total, 0, 'nothing due after renewing');

  await ok(staff, 'set_renewal_active', { p_id: visaId, p_active: false });
  assert.equal((await ok(staff, 'list_renewals', { p_window: 'all' })).total, 2);
  assert.equal((await ok(staff, 'list_renewals', { p_window: 'stopped' })).total, 1);
  await ok(staff, 'set_renewal_active', { p_id: visaId, p_active: true });
  const kinds = (await ok(staff, 'get_renewal', { p_id: visaId })).renewal.events.map(e => e.kind);
  assert.deepEqual(kinds, ['restarted', 'stopped', 'created']);
});

test('managers turn a renewal into a task; only managers delete renewals', async () => {
  assert.equal((await call(staff, 'create_renewal_task', { p_id: licenseId })).error.code, '42501');
  const taskId = await ok(manager, 'create_renewal_task', { p_id: licenseId });
  const { task } = await ok(staff, 'get_task', { p_id: taskId });
  assert.equal(task.title, 'Trade license renewal: License no. 12345');
  assert.equal(task.customer_id, customerId);
  assert.equal(task.assigned_to, staff.id, 'assigned to the person who looks after the renewal');
  assert.equal(task.due_date, plusDays(400));
  assert.equal(task.renewal_id, licenseId);
  const { renewal } = await ok(staff, 'get_renewal', { p_id: licenseId });
  assert.deepEqual(renewal.tasks.map(t => t.id), [taskId]);

  assert.equal((await call(staff, 'delete_renewal', { p_id: visaId })).error.code, '42501');
  await ok(manager, 'delete_renewal', { p_id: visaId });
  assert.equal((await call(staff, 'get_renewal', { p_id: visaId })).error.code, 'P0002');
});
