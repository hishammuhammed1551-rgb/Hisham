'use strict';

// Tests for payments: part payments, methods, cheques (cleared / bounced), balances, overdue, advances.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createClient } = require('@supabase/supabase-js');
const { startLocalDb } = require('../local-db');
const { createStandIn } = require('../stand-in');

let db; let server; let base;

before(async () => {
  db = await startLocalDb({ port: 54344 });
  server = http.createServer(createStandIn({ pool: db.pool }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await setUp();
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

let admin; let manager; let staff; let customerId; let taskId; let today;
const plusDays = n => {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const invoiceOf = async id => (await ok(manager, 'get_invoice', { p_id: id })).invoice;

async function taxInvoice({ amount, due, proformaId = null }) {
  const id = await ok(manager, 'save_invoice', { p_id: null, p_data: {
    kind: 'tax', task_id: taskId, customer_id: customerId, proforma_id: proformaId, issue_date: plusDays(-40), due_date: due,
    lines: [{ description: 'Customs clearance', quantity: 1, unit_price: amount, vat_code: 'zero' }] } });
  await ok(manager, 'mark_invoice_sent', { p_id: id, p_to: 'accounts@gulftraders.ae' });
  return id;
}

async function setUp() {
  admin = await member('Aisha Admin', 'admin@example.com', 'admin');
  manager = await member('Maya Manager', 'maya@example.com', 'manager');
  staff = await member('Sami', 'sami@example.com', 'staff');
  today = (await ok(staff, 'dashboard')).today;
  await ok(admin, 'save_company_settings', { p_data: { legal_name: 'Lowcaps', trn: '100111222333444', payment_terms_days: 30 } });
  customerId = await ok(staff, 'save_customer', { p_id: null, p_data: { name: 'Gulf Traders LLC', email: 'accounts@gulftraders.ae' } });
  taskId = await ok(manager, 'save_task', { p_id: null, p_data: { title: 'Import MSKU1234567', customer_id: customerId } });
}

let invA;

test('part payments by different methods; balance and status follow', async () => {
  invA = await taxInvoice({ amount: 1000, due: plusDays(-10) });   // overdue by 10 days
  const pay = data => call(manager, 'record_payment', { p_invoice_id: invA, p_data: data });

  assert.equal((await call(staff, 'record_payment', { p_invoice_id: invA, p_data: { amount: 1, method: 'cash', paid_on: today } })).error.code,
    '42501', 'team members cannot record payments');
  const bad = await pay({ amount: 'lots', method: 'crypto', paid_on: plusDays(1) });
  assert.deepEqual(Object.keys(bad.error.fields).sort(), ['method']);
  const bad2 = await pay({ amount: 0, method: 'cheque', paid_on: plusDays(1) });
  assert.deepEqual(bad2.error.fields, { amount: 'Enter an amount above 0, with at most 2 decimals',
    paid_on: "Can't be in the future", reference: 'Enter the cheque number' });
  assert.deepEqual((await pay({ amount: 1000.01, method: 'cash', paid_on: today })).error.fields,
    { amount: 'More than the balance of AED 1,000.00' });

  await ok(manager, 'record_payment', { p_invoice_id: invA, p_data: { amount: 300, method: 'cash', paid_on: plusDays(-5), reference: 'Receipt 88' } });
  let inv = await invoiceOf(invA);
  assert.deepEqual([inv.status, inv.amount_paid], ['sent', 300], 'partly paid stays "sent" with an amount paid');

  await ok(manager, 'record_payment', { p_invoice_id: invA, p_data: {
    amount: 200, method: 'bank_transfer', paid_on: plusDays(-1), reference: 'FT2611AB' } });
  inv = await invoiceOf(invA);
  assert.equal(inv.amount_paid, 500);
  assert.deepEqual(inv.payments.map(p => [p.method, p.amount, p.reference, p.recorded_by_name]),
    [['bank_transfer', 200, 'FT2611AB', 'Maya Manager'], ['cash', 300, 'Receipt 88', 'Maya Manager']], 'newest first');

  const { task } = await ok(staff, 'get_task', { p_id: taskId });
  assert.match(task.updates[0].body, /Received AED 200\.00 by bank transfer for INV-/);
});

test('overdue balances on the dashboard, customer page and invoice list', async () => {
  await taxInvoice({ amount: 250, due: plusDays(10) });   // not due yet
  const dash = await ok(manager, 'dashboard');
  assert.deepEqual(dash.receivables, { outstanding: 750, overdue: 500, overdueCount: 1 });
  assert.deepEqual(dash.overdueInvoices.map(i => [i.balance, i.amount_paid, i.total]), [[500, 500, 1000]]);

  const { customer } = await ok(staff, 'get_customer', { p_id: customerId });
  assert.deepEqual(customer.balance, { outstanding: 750, overdue: 500 });

  assert.equal((await ok(staff, 'list_invoices', { p_status: 'overdue' })).total, 1);
  assert.equal((await ok(staff, 'list_invoices', { p_status: 'partial' })).total, 1);
  assert.equal((await ok(staff, 'list_invoices', { p_status: 'unpaid' })).total, 2);
  const row = (await ok(staff, 'list_invoices', { p_status: 'overdue' })).invoices[0];
  assert.deepEqual([row.total, row.amount_paid], [1000, 500]);

  await ok(manager, 'mark_payment_reminded', { p_invoice_id: invA, p_to: 'accounts@gulftraders.ae' });
  assert.ok((await invoiceOf(invA)).payment_reminded_at);
});

test('cheques: pending counts, bounced comes off the balance, cleared stays', async () => {
  const chequeId = await ok(manager, 'record_payment', { p_invoice_id: invA, p_data: {
    amount: 500, method: 'cheque', paid_on: today, reference: '000123', cheque_bank: 'Example Bank', cheque_date: plusDays(15) } });
  let inv = await invoiceOf(invA);
  assert.deepEqual([inv.status, inv.amount_paid], ['paid', 1000], 'fully paid, including a post-dated cheque');
  assert.equal(inv.payments[0].cheque_status, 'pending');
  assert.equal(inv.payments[0].cheque_date, plusDays(15));
  assert.equal((await ok(staff, 'list_payments', { p_cheque_status: 'pending' })).total, 1);

  await ok(manager, 'set_cheque_status', { p_id: chequeId, p_status: 'bounced' });
  inv = await invoiceOf(invA);
  assert.deepEqual([inv.status, inv.amount_paid], ['sent', 500], 'a bounced cheque puts the balance back');
  assert.equal((await ok(manager, 'dashboard')).receivables.overdue, 500);

  await ok(manager, 'set_cheque_status', { p_id: chequeId, p_status: 'cleared' });
  inv = await invoiceOf(invA);
  assert.deepEqual([inv.status, inv.amount_paid], ['paid', 1000]);
  assert.ok(inv.paid_at);

  const cashId = inv.payments.find(p => p.method === 'cash').id;
  assert.equal((await call(manager, 'set_cheque_status', { p_id: cashId, p_status: 'bounced' })).error.code, '22023');
  assert.match((await call(manager, 'cancel_invoice', { p_id: invA })).error.message, /payments recorded/);

  // Deleting a payment entered by mistake re-opens the balance
  assert.equal((await call(staff, 'delete_payment', { p_id: cashId })).error.code, '42501');
  await ok(manager, 'delete_payment', { p_id: cashId });
  inv = await invoiceOf(invA);
  assert.deepEqual([inv.status, inv.amount_paid], ['sent', 700]);

  const all = await ok(staff, 'list_payments', {});
  assert.equal(all.total, 2);
  assert.equal(all.amount, 700);
  assert.equal((await ok(staff, 'list_payments', { p_method: 'cheque' })).payments[0].invoice_number, inv.number);
});

test('an advance paid on the proforma moves to the tax invoice', async () => {
  const pro = await ok(manager, 'save_invoice', { p_id: null, p_data: {
    kind: 'proforma', task_id: taskId, customer_id: customerId, issue_date: today,
    lines: [{ description: 'Sea freight', quantity: 1, unit_price: 2000, vat_code: 'zero' }] } });
  await ok(manager, 'mark_invoice_sent', { p_id: pro, p_to: 'accounts@gulftraders.ae' });
  await ok(manager, 'record_payment', { p_invoice_id: pro, p_data: { amount: 800, method: 'bank_transfer', paid_on: today, reference: 'ADV-1' } });
  assert.equal((await invoiceOf(pro)).amount_paid, 800);

  const tooLow = await call(manager, 'save_invoice', { p_id: null, p_data: {
    kind: 'tax', task_id: taskId, customer_id: customerId, proforma_id: pro, issue_date: today,
    lines: [{ description: 'Sea freight', quantity: 1, unit_price: 500, vat_code: 'zero' }] } });
  assert.match(tooLow.error.fields.lines, /already paid on the proforma/);
  assert.equal((await invoiceOf(pro)).amount_paid, 800, 'nothing moved when the tax invoice was refused');

  const tax = await taxInvoice({ amount: 2000, due: plusDays(30), proformaId: pro });
  const inv = await invoiceOf(tax);
  assert.deepEqual([inv.amount_paid, inv.status, inv.payments[0].reference], [800, 'sent', 'ADV-1']);
  assert.equal((await invoiceOf(pro)).amount_paid, 0);

  const draft = await ok(manager, 'save_invoice', { p_id: null, p_data: {
    kind: 'tax', customer_id: customerId, issue_date: today,
    lines: [{ description: 'Storage', quantity: 1, unit_price: 100, vat_code: 'standard' }] } });
  await ok(manager, 'record_payment', { p_invoice_id: draft, p_data: { amount: 105, method: 'cash', paid_on: today } });
  assert.equal((await invoiceOf(draft)).status, 'draft', 'a paid draft stays a draft until it is sent');
  assert.match((await call(manager, 'save_invoice', { p_id: draft, p_data: { customer_id: customerId, issue_date: today,
    lines: [{ description: 'Storage', quantity: 1, unit_price: 50, vat_code: 'standard' }] } })).error.fields.lines, /already paid/);
  await ok(manager, 'mark_invoice_sent', { p_id: draft, p_to: 'accounts@gulftraders.ae' });
  assert.equal((await invoiceOf(draft)).status, 'paid');
});
