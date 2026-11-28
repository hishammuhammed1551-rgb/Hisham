'use strict';

// Tests for finance phase 2: suppliers, bills and credit notes with every VAT treatment, duplicate check,
// payment vouchers and allocation, statements, ageing, the VAT 201 return and VAT settlement.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createClient } = require('@supabase/supabase-js');
const { startLocalDb } = require('../local-db');
const { createStandIn } = require('../stand-in');

let db; let server; let base;

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

let admin; let manager; let staff; let today; let fyStart; let acc; let supplierId; let billId;
const id = code => acc[code].id;
const plus = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function balances() {
  const tb = await ok(manager, 'trial_balance', { p_from: fyStart, p_to: today });
  const out = {};
  for (const r of tb.rows) {
    const c = Math.round((Number(r.opening) + Number(r.debit) - Number(r.credit)) * 100) / 100;
    if (c) out[r.code] = c;
  }
  return out;
}

before(async () => {
  db = await startLocalDb({ port: 54354 });
  server = http.createServer(createStandIn({ pool: db.pool }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await member('Aisha Admin', 'admin@example.com', 'admin');
  manager = await member('Maya Manager', 'maya@example.com', 'manager');
  staff = await member('Sami', 'sami@example.com', 'staff');
  const s = await ok(manager, 'get_finance_settings');
  today = s.today;
  fyStart = s.fy_start;
  acc = Object.fromEntries((await ok(manager, 'list_accounts', {})).map(a => [a.code, a]));
  await ok(admin, 'save_company_settings', { p_data: { legal_name: 'Lowcaps', trn: '100111222333444' } });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.stop();
});

const LINES = () => [
  { description: 'Office rent, this month', account_id: id('6200'), quantity: 1, unit_price: 5000, vat_code: 'standard', recoverable: true },
  { description: 'Electricity (VAT not recoverable)', account_id: id('6210'), quantity: 1, unit_price: 1000, vat_code: 'standard', recoverable: false },
  { description: 'Software subscription from abroad', account_id: id('6500'), quantity: 1, unit_price: 2000, vat_code: 'reverse_charge', recoverable: true },
  { description: 'Customs duty paid for a customer', account_id: id('1300'), quantity: 1, unit_price: 1200, vat_code: 'out_of_scope', recoverable: true },
];

test('suppliers: managers only, TRN checked', async () => {
  const data = { name: 'Gulf Properties LLC', trn: '100222333444555', email: 'accounts@gulfprop.ae', payment_terms_days: 30, default_expense_account_id: id('6200') };
  assert.equal((await call(staff, 'save_supplier', { p_id: null, p_data: data })).error.code, '42501');
  assert.deepEqual((await call(manager, 'save_supplier', { p_id: null, p_data: { ...data, trn: '12' } })).error.fields, { trn: 'TRN must be 15 digits' });
  assert.deepEqual((await call(manager, 'save_supplier', { p_id: null, p_data: { ...data, default_expense_account_id: id('1100') } })).error.fields,
    { default_expense_account_id: 'Pick an expense or asset account' });
  supplierId = await ok(manager, 'save_supplier', { p_id: null, p_data: data });
  assert.deepEqual((await ok(manager, 'supplier_options')).map(s => s.name), ['Gulf Properties LLC']);
});

test('a bill with every VAT treatment posts correctly; drafts are not posted', async () => {
  const bad = await call(manager, 'save_bill', { p_id: null, p_data: { supplier_id: supplierId, supplier_ref: 'GP-1001', bill_date: today,
    lines: [{ description: 'x', account_id: id('1100'), quantity: 1, unit_price: 10, vat_code: 'standard' }] } });
  assert.match(bad.error.fields.lines, /pick an expense, cost or asset account/);

  billId = await ok(manager, 'save_bill', { p_id: null, p_data: { supplier_id: supplierId, supplier_ref: 'GP-1001',
    bill_date: plus(-45), due_date: plus(-40), lines: LINES() } });
  let b = (await ok(manager, 'get_bill', { p_id: billId })).bill;
  assert.match(b.number, /^BILL-\d{4}-0001$/);
  assert.deepEqual([b.subtotal, b.vat_total, b.rcm_vat, b.total], [9200, 300, 100, 9500]);
  assert.deepEqual(await balances(), {}, 'drafts are not in the books');

  assert.equal((await call(staff, 'post_bill', { p_id: billId })).error.code, '42501');
  await ok(manager, 'post_bill', { p_id: billId });
  assert.deepEqual(await balances(), {
    1300: 1200,           // duty recoverable from the customer
    1400: 350,            // VAT input: 250 on rent + 100 reverse charge
    2100: -9500,          // owed to the supplier
    2200: -100,           // reverse charge VAT due
    6200: 5000, 6210: 1050, 6500: 2000,   // electricity carries its unrecoverable VAT
  });
  assert.match((await call(manager, 'save_bill', { p_id: billId, p_data: { supplier_id: supplierId, supplier_ref: 'GP-1001', bill_date: today, lines: LINES() } })).error.message,
    /Only drafts can be changed/);
  b = (await ok(manager, 'get_bill', { p_id: billId })).bill;
  assert.equal(b.status, 'posted');
  assert.ok(b.journal_id);
});

test('the same supplier invoice number cannot be entered twice', async () => {
  const dup = await call(manager, 'save_bill', { p_id: null, p_data: { supplier_id: supplierId, supplier_ref: ' gp-1001 ', bill_date: today, lines: LINES() } });
  assert.match(dup.error.fields.supplier_ref, /Already entered as BILL-\d{4}-0001/);
  const draft = await ok(manager, 'save_bill', { p_id: null, p_data: { supplier_id: supplierId, supplier_ref: 'GP-1002', bill_date: today, lines: LINES().slice(0, 1) } });
  await ok(manager, 'cancel_bill', { p_id: draft });
  const again = await ok(manager, 'save_bill', { p_id: null, p_data: { supplier_id: supplierId, supplier_ref: 'GP-1002', bill_date: today, lines: LINES().slice(0, 1) } });
  assert.ok(again, 'a cancelled document number can be entered again');
  await ok(manager, 'cancel_bill', { p_id: again });
});

let payId;

test('payment vouchers: part allocation, advances, credit notes applied, over-allocation refused', async () => {
  assert.match((await call(manager, 'record_supplier_payment', { p_data: { supplier_id: supplierId, paid_on: today, method: 'bank_transfer',
    account_id: id('1100'), amount: '100', allocations: [{ bill_id: billId, amount: '200' }] } })).error.fields.allocations, /more than the payment/);
  payId = await ok(manager, 'record_supplier_payment', { p_data: { supplier_id: supplierId, paid_on: today, method: 'bank_transfer',
    account_id: id('1100'), amount: '6000', reference: 'FT-77', allocations: [{ bill_id: billId, amount: '4000' }] } });
  let p = (await ok(manager, 'get_supplier_payment', { p_id: payId })).payment;
  assert.match(p.number, /^PV-\d{4}-0001$/);
  assert.equal(p.unallocated, 2000, 'the rest is an advance to the supplier');
  let b = await balances();
  assert.deepEqual([b[1100], b[2100]], [-6000, -3500]);

  // Credit note for part of the rent
  const cn = await ok(manager, 'save_bill', { p_id: null, p_data: { kind: 'credit_note', supplier_id: supplierId, supplier_ref: 'GP-CN-5', bill_date: today,
    lines: [{ description: 'Rent discount', account_id: id('6200'), quantity: 1, unit_price: 400, vat_code: 'standard', recoverable: true }] } });
  await ok(manager, 'post_bill', { p_id: cn });
  b = await balances();
  assert.deepEqual([b[2100], b[6200], b[1400]], [-3080, 4600, 330]);

  const { open_items: open } = await ok(manager, 'get_bill', { p_id: billId });
  assert.deepEqual(open.map(o => [o.type, o.available]).sort(), [['credit_note', 420], ['payment', 2000]]);
  assert.match((await call(manager, 'allocate_to_bill', { p_bill_id: billId, p_source_type: 'payment', p_source_id: payId, p_amount: 2500 })).error.message,
    /up to AED 2,000.00/);
  await ok(manager, 'allocate_to_bill', { p_bill_id: billId, p_source_type: 'credit_note', p_source_id: cn, p_amount: 420 });
  await ok(manager, 'allocate_to_bill', { p_bill_id: billId, p_source_type: 'payment', p_source_id: payId, p_amount: 2000 });
  const bill = (await ok(manager, 'get_bill', { p_id: billId })).bill;
  assert.equal(bill.total - bill.amount_allocated, 3080);
  assert.equal(bill.allocations.length, 3);
  assert.match((await call(manager, 'cancel_bill', { p_id: billId })).error.message, /allocated/);

  const sup = (await ok(manager, 'list_suppliers', {}))[0];
  assert.deepEqual([sup.balance, sup.overdue, sup.unallocated], [3080, 3080, 0]);

  // Removing an allocation frees it again
  await ok(manager, 'remove_allocation', { p_id: bill.allocations.find(a => a.credit_note_id).id });
  assert.equal((await ok(manager, 'list_suppliers', {}))[0].unallocated, 420);
});

test('statement, ageing and voiding a payment voucher', async () => {
  const st = await ok(manager, 'supplier_statement', { p_supplier: supplierId, p_from: fyStart, p_to: today });
  assert.equal(st.closing, 3080);
  assert.equal(st.lines.at(-1).balance, st.closing);
  assert.deepEqual(st.lines.map(l => l.kind), ['bill', 'supplier_payment', 'supplier_credit']);

  const ageing = await ok(manager, 'payables_ageing', {});
  assert.deepEqual(ageing.rows.map(r => [r.name, r.d60, r.current, r.unallocated]), [['Gulf Properties LLC', 3500, 0, 420]],
    'bill 40 days overdue, less the credit note not yet applied');

  await ok(manager, 'void_supplier_payment', { p_id: payId });
  const b = await balances();
  assert.deepEqual([b[1100], b[2100]], [undefined, -9080]);
  assert.equal((await ok(manager, 'get_bill', { p_id: billId })).bill.amount_allocated, 0, 'allocations freed');
});

test('VAT return (VAT 201) from sales and purchases, matches the ledger; settlement', async () => {
  const cust = await ok(staff, 'save_customer', { p_id: null, p_data: { name: 'Gulf Traders LLC', trn: '100999888777666' } });
  const inv = await ok(manager, 'save_invoice', { p_id: null, p_data: { kind: 'tax', customer_id: cust, issue_date: today, lines: [
    { description: 'Clearance', quantity: 1, unit_price: 1000, vat_code: 'standard' },
    { description: 'International freight', quantity: 1, unit_price: 2000, vat_code: 'zero' },
    { description: 'Exempt service', quantity: 1, unit_price: 300, vat_code: 'exempt' },
    { description: 'Duty paid on your behalf', quantity: 1, unit_price: 500, vat_code: 'out_of_scope' }] } });
  await ok(manager, 'mark_invoice_sent', { p_id: inv, p_to: 'a@example.com' });

  const v = await ok(manager, 'vat_return', { p_from: fyStart, p_to: today });
  assert.deepEqual(v.box1, { amount: 1000, vat: 50 });
  assert.deepEqual(v.box3, { amount: 2000, vat: 100 });
  assert.deepEqual(v.box4, { amount: 2000 });
  assert.deepEqual(v.box5, { amount: 300 });
  assert.deepEqual(v.box6, { amount: 0, vat: 0 });
  assert.deepEqual(v.box9, { amount: 4600, vat: 230 }, 'rent 5000 less the 400 credit note; electricity VAT is not recoverable');
  assert.deepEqual(v.box10, { amount: 2000, vat: 100 });
  assert.deepEqual(v.gl, { vat_output: 150, vat_input: 330 }, 'ledger agrees: due 50 + 100, recoverable 230 + 100');
  assert.ok(v.ledger.every(l => l.vat_code !== 'out_of_scope'));
  const sale = v.ledger.find(l => l.side === 'sale' && l.vat_code === 'standard');
  assert.deepEqual([sale.party_trn, sale.box], ['100999888777666', '1']);
  assert.equal(v.settled, null);

  assert.equal((await call(staff, 'post_vat_settlement', { p_from: fyStart, p_to: today })).error.code, '42501');
  await ok(manager, 'post_vat_settlement', { p_from: fyStart, p_to: today });
  const b = await balances();
  assert.deepEqual([b[2200], b[1400], b[2210]], [undefined, undefined, 180], 'refundable 180 moved to VAT payable/receivable from FTA');
  assert.match((await call(manager, 'post_vat_settlement', { p_from: fyStart, p_to: today })).error.message, /already been recorded/);
  assert.ok((await ok(manager, 'vat_return', { p_from: fyStart, p_to: today })).settled.number);
});
