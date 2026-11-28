'use strict';

// Tests for company settings and proforma / tax invoices (schema.sql), through supabase-js.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createClient } = require('@supabase/supabase-js');
const { startLocalDb } = require('../local-db');
const { createStandIn } = require('../stand-in');

let db; let server; let base;

before(async () => {
  db = await startLocalDb({ port: 54338 });
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

let admin; let manager; let staff; let customerId; let taskId; let proformaId; let taxId;

const LINES = [
  { description: 'Sea freight Jebel Ali → Khor Fakkan, 1x40ft', quantity: 1, unit_price: 2500, vat_code: 'zero' },
  { description: 'Customs clearance fee', quantity: 1, unit_price: 350, vat_code: 'standard' },
  { description: 'Documentation (per bill of lading)', quantity: 3, unit_price: 33.33, vat_code: 'standard' },
  { description: 'Customs duty paid on your behalf', quantity: 1, unit_price: 1200, vat_code: 'out_of_scope' },
];

test('company settings: everyone can read, only admins can change; TRN is validated', async () => {
  admin = await member('Aisha Admin', 'admin@example.com', 'admin');
  manager = await member('Maya Manager', 'maya@example.com', 'manager');
  staff = await member('Sami', 'sami@example.com', 'staff');

  assert.equal((await ok(staff, 'get_company_settings')).legal_name, 'Lowcaps');
  const settings = { legal_name: 'Lowcaps Logistics LLC', address: 'Khor Fakkan, Sharjah, UAE', phone: '+971 9 000 0000',
    email: 'accounts@example.com', trn: '100111222333444', bank_name: 'Example Bank', account_name: 'Lowcaps Logistics LLC',
    iban: 'ae07 0331 2345 6789 0123 456', swift: 'exbkaead', payment_terms_days: 15, invoice_notes: 'Thank you for your business.' };
  assert.equal((await call(manager, 'save_company_settings', { p_data: settings })).error.code, '42501');
  assert.deepEqual((await call(admin, 'save_company_settings', { p_data: { ...settings, trn: '12' } })).error.fields,
    { trn: 'TRN must be 15 digits' });
  await ok(admin, 'save_company_settings', { p_data: settings });
  const saved = await ok(staff, 'get_company_settings');
  assert.equal(saved.iban, 'AE070331234567890123456', 'IBAN is stored without spaces, upper case');
  assert.equal(saved.swift, 'EXBKAEAD');
  assert.equal(saved.payment_terms_days, 15);
});

test('managers create a proforma for a task; VAT is 5% only on standard-rated lines', async () => {
  customerId = await ok(staff, 'save_customer', { p_id: null, p_data: {
    name: 'Gulf Traders LLC', email: 'accounts@gulftraders.ae', trn: '100999888777666', address: 'Plot 12, Port Road', city: 'Khor Fakkan' } });
  await ok(staff, 'save_contact', { p_customer_id: customerId, p_id: null, p_data: { name: 'Omar', email: 'Omar@GulfTraders.ae', is_primary: true } });
  await ok(staff, 'save_contact', { p_customer_id: customerId, p_id: null, p_data: { name: 'Ops', email: 'accounts@gulftraders.ae' } });
  taskId = await ok(manager, 'save_task', { p_id: null, p_data: { title: 'Import 1x40ft MSKU1234567', customer_id: customerId, assigned_to: staff.id } });

  const invoice = { kind: 'proforma', task_id: taskId, customer_id: customerId, issue_date: '2026-11-28', due_date: '2026-12-05', lines: LINES };
  assert.equal((await call(staff, 'save_invoice', { p_id: null, p_data: invoice })).error.code, '42501', 'team members cannot invoice');

  const bad = await call(manager, 'save_invoice', { p_id: null, p_data: { ...invoice, due_date: '2026-11-01', lines: [
    { description: '', quantity: 1, unit_price: 10, vat_code: 'standard' },
    { description: 'X', quantity: 0, unit_price: 10, vat_code: 'standard' },
    { description: 'Y', quantity: 1, unit_price: 'ten', vat_code: 'standard' },
    { description: 'Z', quantity: 1, unit_price: 1.234, vat_code: 'standard' },
    { description: 'W', quantity: 1, unit_price: 1, vat_code: '7%' },
  ] } });
  assert.equal(bad.error.fields.due_date, "Can't be before the invoice date");
  assert.equal(bad.error.fields.lines, 'Line 1: add a description. Line 2: quantity must be more than 0. ' +
    'Line 3: quantity and price must be numbers. Line 4: price must be 0 or more, with at most 2 decimals. Line 5: pick a VAT treatment');
  assert.equal((await call(manager, 'save_invoice', { p_id: null, p_data: { ...invoice, lines: [] } })).error.fields.lines, 'Add at least one charge');

  proformaId = await ok(manager, 'save_invoice', { p_id: null, p_data: invoice });
  const { invoice: inv } = await ok(staff, 'get_invoice', { p_id: proformaId });
  assert.equal(inv.number, 'PRO-2026-0001');
  assert.equal(inv.status, 'draft');
  assert.equal(inv.customer_name, 'Gulf Traders LLC');
  assert.equal(inv.customer_address, 'Plot 12, Port Road\nKhor Fakkan\nUnited Arab Emirates');
  assert.equal(inv.customer_trn, '100999888777666');
  assert.equal(inv.supplier.trn, '100111222333444', 'company details are copied onto the invoice');
  // 2500 (0%) + 350 (5% = 17.50) + 3 x 33.33 = 99.99 (5% = 5.00) + 1200 (out of scope)
  assert.deepEqual(inv.lines.map(l => [l.net, l.vat]), [[2500, 0], [350, 17.5], [99.99, 5], [1200, 0]]);
  assert.deepEqual([inv.subtotal, inv.vat_total, inv.total], [4149.99, 22.5, 4172.49]);
  assert.deepEqual(inv.recipients, ['accounts@gulftraders.ae', 'omar@gulftraders.ae'], 'customer email first, no duplicates');
  assert.equal(inv.task_title, 'Import 1x40ft MSKU1234567');

  const { task } = await ok(staff, 'get_task', { p_id: taskId });
  assert.deepEqual(task.invoices.map(i => [i.number, i.kind, i.total]), [['PRO-2026-0001', 'proforma', 4172.49]]);
  assert.match(task.updates[0].body, /Created proforma invoice PRO-2026-0001 \(AED 4,172\.49\)/);
});

test('drafts can be edited; sent invoices are locked and can only be cancelled', async () => {
  await ok(manager, 'save_invoice', { p_id: proformaId, p_data: {
    task_id: taskId, customer_id: customerId, issue_date: '2026-11-28', lines: LINES.slice(0, 2) } });
  assert.equal((await ok(manager, 'get_invoice', { p_id: proformaId })).invoice.total, 2867.5);

  assert.equal((await call(staff, 'mark_invoice_sent', { p_id: proformaId, p_to: 'x@example.com' })).error.code, '42501');
  await ok(manager, 'mark_invoice_sent', { p_id: proformaId, p_to: 'accounts@gulftraders.ae' });
  const sent = (await ok(manager, 'get_invoice', { p_id: proformaId })).invoice;
  assert.equal(sent.status, 'sent');
  assert.equal(sent.sent_to, 'accounts@gulftraders.ae');
  assert.ok(sent.sent_at);

  const locked = await call(manager, 'save_invoice', { p_id: proformaId, p_data: {
    customer_id: customerId, issue_date: '2026-11-28', lines: LINES } });
  assert.match(locked.error.message, /already been sent/);
});

test('a tax invoice needs the company TRN, gets its own number series, and shows on the dashboard until created', async () => {
  await ok(staff, 'update_task_status', { p_id: taskId, p_status: 'done' });
  let dash = await ok(manager, 'dashboard');
  assert.deepEqual(dash.toInvoice.map(t => t.title), ['Import 1x40ft MSKU1234567']);

  const settings = await ok(admin, 'get_company_settings');
  await ok(admin, 'save_company_settings', { p_data: { ...settings, trn: null } });
  const noTrn = await call(manager, 'save_invoice', { p_id: null, p_data: {
    kind: 'tax', task_id: taskId, customer_id: customerId, proforma_id: proformaId, issue_date: '2026-11-30', lines: LINES } });
  assert.match(noTrn.error.message, /Add Lowcaps' TRN/);
  await ok(admin, 'save_company_settings', { p_data: settings });

  taxId = await ok(manager, 'save_invoice', { p_id: null, p_data: {
    kind: 'tax', task_id: taskId, customer_id: customerId, proforma_id: proformaId,
    issue_date: '2026-11-30', supply_date: '2026-11-29', due_date: '2026-12-15', lines: LINES } });
  const tax = (await ok(manager, 'get_invoice', { p_id: taxId })).invoice;
  assert.equal(tax.number, 'INV-2026-0001');
  assert.equal(tax.proforma_number, 'PRO-2026-0001');
  assert.equal(tax.supply_date, '2026-11-29');

  dash = await ok(manager, 'dashboard');
  assert.deepEqual(dash.toInvoice, [], 'no longer waiting for an invoice');
  assert.deepEqual(dash.unpaid, { count: 0, total: 0 }, 'drafts are not counted as unpaid');
  await ok(manager, 'mark_invoice_sent', { p_id: taxId, p_to: 'accounts@gulftraders.ae' });
  dash = await ok(manager, 'dashboard');
  assert.deepEqual(dash.unpaid, { count: 1, total: 4172.49 });

  await ok(manager, 'set_invoice_paid', { p_id: taxId, p_paid: true });
  assert.equal((await ok(manager, 'get_invoice', { p_id: taxId })).invoice.status, 'paid');
  await ok(manager, 'set_invoice_paid', { p_id: taxId, p_paid: false });
  assert.equal((await ok(manager, 'get_invoice', { p_id: taxId })).invoice.status, 'sent', 'un-paying goes back to sent');
  await ok(manager, 'set_invoice_paid', { p_id: taxId, p_paid: true });
});

test('cancelled numbers are never reused; list filters; customer page shows invoices', async () => {
  const p2 = await ok(manager, 'save_invoice', { p_id: null, p_data: { customer_id: customerId, issue_date: '2026-11-30', lines: LINES.slice(1, 2) } });
  await ok(manager, 'cancel_invoice', { p_id: p2 });
  assert.equal((await call(manager, 'mark_invoice_sent', { p_id: p2, p_to: 'x@example.com' })).error.code, '22023');
  const p3 = await ok(manager, 'save_invoice', { p_id: null, p_data: { customer_id: customerId, issue_date: '2026-11-30', lines: LINES.slice(1, 2) } });
  const nextYear = await ok(manager, 'save_invoice', { p_id: null, p_data: { customer_id: customerId, issue_date: '2027-01-02', lines: LINES.slice(1, 2) } });
  assert.equal((await ok(manager, 'get_invoice', { p_id: p3 })).invoice.number, 'PRO-2026-0003');
  assert.equal((await ok(manager, 'get_invoice', { p_id: nextYear })).invoice.number, 'PRO-2027-0001', 'numbering restarts each year');

  assert.equal((await ok(staff, 'list_invoices', {})).total, 5);
  assert.equal((await ok(staff, 'list_invoices', { p_kind: 'tax' })).total, 1);
  assert.equal((await ok(staff, 'list_invoices', { p_status: 'cancelled' })).total, 1);
  assert.equal((await ok(staff, 'list_invoices', { p_status: 'paid' })).total, 1);
  assert.equal((await ok(staff, 'list_invoices', { p_q: 'MSKU' })).total, 2, 'search matches the task title');
  assert.equal((await ok(staff, 'list_invoices', { p_q: 'INV-2026' })).total, 1);

  const { customer } = await ok(staff, 'get_customer', { p_id: customerId });
  assert.equal(customer.invoices.length, 5);

  // Deleting the customer keeps the invoices (with the customer details copied onto them).
  await ok(admin, 'delete_customer', { p_id: customerId });
  const kept = (await ok(admin, 'get_invoice', { p_id: taxId })).invoice;
  assert.equal(kept.customer_id, null);
  assert.equal(kept.customer_name, 'Gulf Traders LLC');
  assert.equal(kept.status, 'paid');
});
