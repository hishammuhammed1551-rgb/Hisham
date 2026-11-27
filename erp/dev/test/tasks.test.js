'use strict';

// Tests for managers, tasks and work types (schema.sql), through supabase-js.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createClient } = require('@supabase/supabase-js');
const { startLocalDb } = require('../local-db');
const { createStandIn } = require('../stand-in');

let db; let server; let base;

before(async () => {
  db = await startLocalDb({ port: 54335 });
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
  if (role) await db.pool.query('update public.profiles set role = $2, active = true where id = $1', [data.user.id, role]);
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

let admin; let manager; let sami; let lina; let customerId; let taskId; let seaFreight;

test('admins can make someone a manager; work types start with a default list', async () => {
  admin = await member('Aisha Admin', 'admin@example.com', 'admin');
  manager = await member('Maya Manager', 'maya@example.com', 'staff');
  sami = await member('Sami', 'sami@example.com', 'staff');
  lina = await member('Lina', 'lina@example.com', 'staff');

  assert.equal((await call(manager, 'admin_update_user', { p_id: manager.id, p_name: 'Maya', p_role: 'manager', p_active: true })).error.code,
    '42501', 'only admins manage users');
  await ok(admin, 'admin_update_user', { p_id: manager.id, p_name: 'Maya Manager', p_role: 'manager', p_active: true });
  assert.equal((await ok(manager, 'me')).role, 'manager');

  const people = await ok(sami, 'list_users');
  assert.deepEqual(people.find(p => p.name === 'Maya Manager').role, 'manager', 'everyone sees roles');

  const types = await ok(sami, 'list_work_types');
  assert.deepEqual(types.map(t => t.name).sort(),
    ['Air freight', 'Customs clearance', 'Documentation', 'Land transport', 'Other', 'Sea freight']);
  seaFreight = types.find(t => t.name === 'Sea freight').id;
});

test('staff can add leads; only managers and admins can manage work types', async () => {
  customerId = await ok(sami, 'save_customer', { p_id: null, p_data: { name: 'Gulf Traders LLC', status: 'lead' } });
  assert.deepEqual((await ok(lina, 'customer_options')).map(c => c.name), ['Gulf Traders LLC']);

  assert.equal((await call(sami, 'save_work_type', { p_id: null, p_name: 'Warehousing' })).error.code, '42501');
  const wh = await ok(manager, 'save_work_type', { p_id: null, p_name: 'Warehousing' });
  assert.deepEqual((await call(manager, 'save_work_type', { p_id: null, p_name: 'warehousing' })).error.fields,
    { name: 'This type of work already exists' });
  await ok(admin, 'save_work_type', { p_id: wh, p_name: 'Warehousing', p_active: false });
  const types = await ok(sami, 'list_work_types');
  assert.equal(types.at(-1).name, 'Warehousing', 'switched-off types are listed last');
  assert.equal(types.at(-1).active, false);
});

test('managers create and assign tasks; staff cannot', async () => {
  const denied = await call(sami, 'save_task', { p_id: null, p_data: { title: 'Do it myself' } });
  assert.equal(denied.error.code, '42501');

  const bad = await call(manager, 'save_task', { p_id: null, p_data: {
    title: '', customer_id: 999999, work_type_id: 999999, priority: 'asap', due_date: 'tomorrow' } });
  assert.deepEqual(Object.keys(bad.error.fields).sort(), ['due_date', 'priority', 'title']);
  const badRefs = await call(manager, 'save_task', { p_id: null, p_data: {
    title: 'X', customer_id: 999999, work_type_id: 999999, assigned_to: '00000000-0000-0000-0000-000000000000' } });
  assert.deepEqual(Object.keys(badRefs.error.fields).sort(), ['assigned_to', 'customer_id', 'work_type_id']);

  taskId = await ok(manager, 'save_task', { p_id: null, p_data: {
    title: 'Clear container MSKU1234567', description: 'BL attached by customer', customer_id: customerId,
    work_type_id: seaFreight, assigned_to: sami.id, priority: 'high', due_date: '2020-01-01' } });

  const { task } = await ok(sami, 'get_task', { p_id: taskId });
  assert.equal(task.status, 'new');
  assert.equal(task.customer_name, 'Gulf Traders LLC');
  assert.equal(task.work_type, 'Sea freight');
  assert.equal(task.assignee_name, 'Sami');
  assert.equal(task.created_by_name, 'Maya Manager');
  assert.deepEqual(task.updates.map(u => [u.kind, u.body]).reverse(),
    [['created', 'Created the task'], ['assigned', 'Assigned to Sami']]);
});

test('the assignee and managers can change status; other staff cannot, but anyone can comment', async () => {
  assert.equal((await call(lina, 'update_task_status', { p_id: taskId, p_status: 'done' })).error.code, '42501');
  await ok(sami, 'update_task_status', { p_id: taskId, p_status: 'in_progress', p_note: 'Started on it' });
  await ok(sami, 'update_task_status', { p_id: taskId, p_status: 'waiting', p_note: null });
  await ok(lina, 'add_task_comment', { p_id: taskId, p_body: 'Customer called, docs coming Monday' });
  assert.equal((await call(lina, 'add_task_comment', { p_id: taskId, p_body: '  ' })).error.fields.body, 'Required');
  assert.equal((await call(sami, 'update_task_status', { p_id: taskId, p_status: 'finished' })).error.code, '22023');

  const { task } = await ok(manager, 'get_task', { p_id: taskId });
  assert.equal(task.status, 'waiting');
  assert.deepEqual(task.updates.slice(0, 3).map(u => [u.kind, u.user_name, u.from_status, u.to_status, u.body]), [
    ['comment', 'Lina', null, null, 'Customer called, docs coming Monday'],
    ['status', 'Sami', 'in_progress', 'waiting', null],
    ['status', 'Sami', 'new', 'in_progress', 'Started on it'],
  ]);
});

test('reassigning and editing logs history; done sets the completion time', async () => {
  const { task } = await ok(manager, 'get_task', { p_id: taskId });
  await ok(manager, 'save_task', { p_id: taskId, p_data: { ...task, assigned_to: lina.id } });
  assert.equal((await call(sami, 'update_task_status', { p_id: taskId, p_status: 'done' })).error.code, '42501',
    'Sami is no longer the assignee');
  await ok(lina, 'update_task_status', { p_id: taskId, p_status: 'done', p_note: 'Cleared and delivered' });

  const after = (await ok(admin, 'get_task', { p_id: taskId })).task;
  assert.equal(after.status, 'done');
  assert.ok(after.completed_at);
  assert.deepEqual(after.updates.slice(0, 2).map(u => [u.kind, u.body]),
    [['status', 'Cleared and delivered'], ['assigned', 'Assigned to Lina']]);

  await ok(manager, 'save_task', { p_id: taskId, p_data: { ...after, status: 'in_progress', assigned_to: null } });
  const reopened = (await ok(admin, 'get_task', { p_id: taskId })).task;
  assert.equal(reopened.completed_at, null);
  assert.equal(reopened.updates[0].body, 'Unassigned');
});

test('task list filters, dashboard counts and the customer page', async () => {
  const t2 = await ok(manager, 'save_task', { p_id: null, p_data: { title: 'Prepare customs declaration', assigned_to: sami.id, priority: 'urgent' } });
  const t3 = await ok(admin, 'save_task', { p_id: null, p_data: { title: 'Book air freight', customer_id: customerId, status: 'done', assigned_to: sami.id } });
  await ok(manager, 'save_task', { p_id: null, p_data: { title: 'Quote land transport to Muscat' } });

  const open = await ok(sami, 'list_tasks', {});
  assert.deepEqual(open.tasks.map(t => t.title),
    ['Clear container MSKU1234567', 'Prepare customs declaration', 'Quote land transport to Muscat'],
    'open tasks, earliest due first, then by priority');
  assert.equal((await ok(sami, 'list_tasks', { p_status: 'all' })).total, 4);
  assert.deepEqual((await ok(sami, 'list_tasks', { p_status: 'done' })).tasks.map(t => t.id), [t3]);
  assert.deepEqual((await ok(sami, 'list_tasks', { p_assignee: 'me' })).tasks.map(t => t.id), [t2]);
  assert.equal((await ok(sami, 'list_tasks', { p_assignee: 'none' })).total, 2);
  assert.equal((await ok(sami, 'list_tasks', { p_work_type: seaFreight })).total, 1);
  assert.equal((await ok(sami, 'list_tasks', { p_q: 'gulf', p_status: 'all' })).total, 2, 'search matches customer names');
  assert.equal((await ok(sami, 'list_tasks', { p_customer_id: customerId, p_status: 'all' })).total, 2);

  const dash = await ok(sami, 'dashboard');
  assert.deepEqual(dash.myTasks.map(t => t.title), ['Prepare customs declaration']);
  assert.equal(dash.myOpenTasks, 1);
  assert.equal(dash.overdueTasks, 1);
  assert.equal(dash.unassignedTasks, 2);

  const { customer } = await ok(sami, 'get_customer', { p_id: customerId });
  assert.deepEqual(customer.tasks.map(t => [t.title, t.status]),
    [['Clear container MSKU1234567', 'in_progress'], ['Book air freight', 'done']], 'open tasks first');
});

test('managers can delete tasks and customers; staff cannot; tasks survive their customer', async () => {
  assert.equal((await call(sami, 'delete_task', { p_id: taskId })).error.code, '42501');
  await ok(manager, 'delete_task', { p_id: taskId });
  assert.equal((await call(manager, 'get_task', { p_id: taskId })).error.code, 'P0002');

  assert.equal((await call(sami, 'delete_customer', { p_id: customerId })).error.code, '42501');
  await ok(manager, 'delete_customer', { p_id: customerId });
  const left = await ok(manager, 'list_tasks', { p_q: 'air freight', p_status: 'all' });
  assert.equal(left.tasks[0].customer_id, null, 'task is kept, without a customer');
});
