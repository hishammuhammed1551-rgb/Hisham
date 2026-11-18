'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDatabase } = require('../lib/db');
const { createApp, csvCell } = require('../lib/app');

let server;
let base;

before(async () => {
  const db = openDatabase(':memory:');
  server = http.createServer(createApp({ db }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

/** A tiny client that keeps its own session cookie. */
function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
  };
}

const admin = client();
const staff = client();
const anon = client();
let customerId;

test('first run requires setup, then creates an admin once', async () => {
  assert.deepEqual((await anon('GET', '/api/setup')).data, { needsSetup: true });
  assert.equal((await anon('GET', '/api/customers')).status, 401);

  const weak = await admin('POST', '/api/setup', { name: 'Admin', email: 'admin@example.com', password: 'short' });
  assert.equal(weak.status, 422);

  const res = await admin('POST', '/api/setup', { name: 'Aisha Admin', email: 'Admin@Example.com', password: 'correct-horse-battery' });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.role, 'admin');
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);

  const again = await anon('POST', '/api/setup', { name: 'X', email: 'x@example.com', password: 'another-long-pass' });
  assert.equal(again.status, 409);
  assert.equal((await admin('GET', '/api/me')).data.user.name, 'Aisha Admin');
});

test('admin adds a staff user who can sign in; wrong passwords are rejected', async () => {
  const add = await admin('POST', '/api/users', { name: 'Sami Staff', email: 'sami@example.com', password: 'staff-password-1' });
  assert.equal(add.status, 201);
  const dup = await admin('POST', '/api/users', { name: 'Dup', email: 'SAMI@example.com', password: 'staff-password-1' });
  assert.equal(dup.status, 422);

  assert.equal((await staff('POST', '/api/login', { email: 'sami@example.com', password: 'nope' })).status, 401);
  assert.equal((await staff('POST', '/api/login', { email: 'nobody@example.com', password: 'nope' })).status, 401);
  const ok = await staff('POST', '/api/login', { email: 'Sami@example.com', password: 'staff-password-1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'staff');

  assert.equal((await staff('POST', '/api/users', { name: 'X', email: 'x@example.com', password: 'xxxxxxxxxxxx' })).status, 403);
  const list = await staff('GET', '/api/users');
  assert.equal(list.data.users[0].email, undefined, 'staff should not see emails of other users');
});

test('mutations without JSON content type are refused', async () => {
  const res = await fetch(base + '/api/login', { method: 'POST', body: 'email=a&password=b',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});

test('create, validate, read and update a customer', async () => {
  const bad = await staff('POST', '/api/customers', { name: '', email: 'not-an-email', trn: '123', status: 'vip' });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.details.name && bad.data.details.email && bad.data.details.trn && bad.data.details.status);

  const res = await staff('POST', '/api/customers', {
    name: 'Gulf Traders LLC', status: 'lead', email: 'ops@gulftraders.ae', phone: '+971 9 238 0000',
    trn: '100-1234-5678-9012', city: 'Khor Fakkan', services: 'Shipping, Customs', owner_id: 2,
  });
  assert.equal(res.status, 201);
  customerId = res.data.id;

  const got = await staff('GET', `/api/customers/${customerId}`);
  assert.equal(got.data.customer.trn, '100123456789012', 'TRN is normalised to digits');
  assert.equal(got.data.customer.owner_name, 'Sami Staff');
  assert.equal(got.data.customer.country, 'United Arab Emirates');

  const upd = await staff('PUT', `/api/customers/${customerId}`, { ...got.data.customer, status: 'active', owner_id: 999 });
  assert.equal(upd.status, 422, 'unknown owner is rejected');
  const upd2 = await staff('PUT', `/api/customers/${customerId}`, { ...got.data.customer, status: 'active' });
  assert.equal(upd2.status, 200);
  assert.equal((await staff('GET', `/api/customers/${customerId}`)).data.customer.status, 'active');
  assert.equal((await staff('GET', '/api/customers/12345')).status, 404);
});

test('contacts: only one main contact per customer', async () => {
  const a = await staff('POST', `/api/customers/${customerId}/contacts`, { name: 'Omar', email: 'omar@gulftraders.ae', is_primary: true });
  const b = await staff('POST', `/api/customers/${customerId}/contacts`, { name: 'Lina', is_primary: true });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const { contacts } = (await staff('GET', `/api/customers/${customerId}`)).data.customer;
  assert.deepEqual(contacts.map(c => [c.name, c.is_primary]), [['Lina', 1], ['Omar', 0]]);

  assert.equal((await staff('PUT', `/api/contacts/${a.data.id}`, { name: 'Omar K', is_primary: false })).status, 200);
  assert.equal((await staff('DELETE', `/api/contacts/${b.data.id}`)).status, 200);
  const after = (await staff('GET', `/api/customers/${customerId}`)).data.customer.contacts;
  assert.deepEqual(after.map(c => c.name), ['Omar K']);
});

test('search, filters and pagination', async () => {
  await staff('POST', '/api/customers', { name: 'Sharjah Steel 100% Co', status: 'lead' });
  await admin('POST', '/api/customers', { name: 'Fujairah Foods', status: 'inactive', city: 'Fujairah' });

  const byContact = await staff('GET', '/api/customers?q=omar');
  assert.deepEqual(byContact.data.customers.map(c => c.name), ['Gulf Traders LLC']);
  assert.equal(byContact.data.customers[0].contact_name, 'Omar K');

  const pct = await staff('GET', '/api/customers?q=' + encodeURIComponent('100%'));
  assert.deepEqual(pct.data.customers.map(c => c.name), ['Sharjah Steel 100% Co'], '% is matched literally');

  assert.equal((await staff('GET', '/api/customers?status=inactive')).data.total, 1);
  assert.equal((await staff('GET', '/api/customers?owner=me')).data.total, 1);
  assert.equal((await staff('GET', '/api/customers?owner=none')).data.total, 2);
  const all = await staff('GET', '/api/customers');
  assert.equal(all.data.total, 3);
  assert.deepEqual(all.data.customers.map(c => c.name), ['Fujairah Foods', 'Gulf Traders LLC', 'Sharjah Steel 100% Co']);
});

test('activities, follow-ups and the dashboard', async () => {
  const noDate = await staff('POST', `/api/customers/${customerId}/activities`, { kind: 'follow_up', body: 'Send quote' });
  assert.equal(noDate.status, 422);

  const overdue = await staff('POST', `/api/customers/${customerId}/activities`, { kind: 'follow_up', body: 'Chase BL copy', due_at: '2020-01-01' });
  const call = await staff('POST', `/api/customers/${customerId}/activities`, { kind: 'call', body: 'Discussed LCL rates', due_at: '2020-01-01' });
  assert.equal(overdue.status, 201);
  assert.equal(call.status, 201);

  let dash = (await staff('GET', '/api/dashboard')).data;
  assert.equal(dash.counts.active, 1);
  assert.equal(dash.counts.lead, 1);
  assert.equal(dash.myCustomers, 1);
  assert.deepEqual(dash.overdue.map(a => a.body), ['Chase BL copy']);
  assert.deepEqual(dash.recent.map(a => a.body), ['Discussed LCL rates']);

  const detail = (await staff('GET', `/api/customers/${customerId}`)).data.customer;
  assert.equal(detail.activities.find(a => a.kind === 'call').due_at, null, 'only follow-ups keep a due date');

  assert.equal((await staff('PATCH', `/api/activities/${call.data.id}`, { done: true })).status, 422);
  assert.equal((await staff('PATCH', `/api/activities/${overdue.data.id}`, { done: true })).status, 200);
  dash = (await staff('GET', '/api/dashboard')).data;
  assert.equal(dash.overdue.length, 0);

  const adminNote = await admin('POST', `/api/customers/${customerId}/activities`, { kind: 'note', body: 'VIP' });
  assert.equal((await staff('DELETE', `/api/activities/${adminNote.data.id}`)).status, 403, 'staff cannot delete others\' entries');
  assert.equal((await staff('DELETE', `/api/activities/${call.data.id}`)).status, 200);
});

test('CSV export escapes values and guards against formulas', async () => {
  await staff('POST', '/api/customers', { name: '=HYPERLINK("http://evil")', notes: 'x' });
  const res = await staff('GET', '/api/customers/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.data, /"'=HYPERLINK\(""http:\/\/evil""\)"/);
  assert.match(res.data, /\+971 9 238 0000/);
  assert.equal(csvCell('-cmd'), "'-cmd");
  assert.equal(csvCell('+971 50 123 4567'), '+971 50 123 4567');
});

test('only admins delete customers; deactivating a user ends their session', async () => {
  assert.equal((await staff('DELETE', `/api/customers/${customerId}`)).status, 403);

  assert.equal((await admin('PUT', '/api/users/1', { name: 'Aisha Admin', role: 'staff', active: true })).status, 422,
    'admin cannot demote themselves');
  assert.equal((await admin('PUT', '/api/users/2', { name: 'Sami Staff', role: 'staff', active: false })).status, 200);
  assert.equal((await staff('GET', '/api/me')).status, 401);
  assert.equal((await staff('POST', '/api/login', { email: 'sami@example.com', password: 'staff-password-1' })).status, 401);

  assert.equal((await admin('DELETE', `/api/customers/${customerId}`)).status, 200);
  assert.equal((await admin('GET', `/api/customers/${customerId}`)).status, 404);
});

test('change own password and sign out', async () => {
  assert.equal((await admin('PUT', '/api/me/password', { current: 'wrong', password: 'brand-new-password' })).status, 422);
  assert.equal((await admin('PUT', '/api/me/password', { current: 'correct-horse-battery', password: 'brand-new-password' })).status, 200);
  assert.equal((await admin('POST', '/api/logout', {})).status, 200);
  assert.equal((await admin('GET', '/api/me')).status, 401);
  assert.equal((await admin('POST', '/api/login', { email: 'admin@example.com', password: 'brand-new-password' })).status, 200);
});

test('static files are served and path traversal is blocked', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await page.text(), /Lowcaps ERP/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/..%2fserver.js')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/lib/app.js')).status, 404);
});
