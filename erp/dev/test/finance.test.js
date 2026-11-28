'use strict';

// Tests for finance phase 1: automatic postings from invoices and payments, manual journals,
// reversals, opening balances, bank and cash, closing the books, and the reports.

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

let admin; let manager; let staff; let today; let fyStart; let acc; let customerId; let taskId;
const id = code => acc[code].id;

/** Balance of each account code from the trial balance (signed: + debit, - credit). */
async function balances(to = today) {
  const tb = await ok(manager, 'trial_balance', { p_from: fyStart, p_to: to });
  const out = {};
  let dr = 0; let cr = 0;
  for (const r of tb.rows) {
    const closing = Math.round((Number(r.opening) + Number(r.debit) - Number(r.credit)) * 100) / 100;
    if (closing) out[r.code] = closing;
    if (closing > 0) dr += closing; else cr -= closing;
  }
  assert.equal(Math.round(dr * 100), Math.round(cr * 100), 'trial balance must balance');
  return out;
}

before(async () => {
  db = await startLocalDb({ port: 54350 });
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
  customerId = await ok(staff, 'save_customer', { p_id: null, p_data: { name: 'Gulf Traders LLC' } });
  const types = await ok(manager, 'list_work_types');
  taskId = await ok(manager, 'save_task', { p_id: null, p_data: { title: 'Import', customer_id: customerId,
    work_type_id: types.find(t => t.name === 'Customs clearance').id } });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.stop();
});

test('finance is for managers and admins; standard UAE chart of accounts', async () => {
  assert.equal((await call(staff, 'list_accounts', {})).error.code, '42501');
  assert.equal((await call(staff, 'trial_balance', { p_from: fyStart, p_to: today })).error.code, '42501');
  assert.deepEqual(['1100', '1150', '1200', '1300', '2150', '2200', '3900', '4130'].map(c => acc[c].name), [
    'Bank - current account', 'Cheques in hand (not yet cleared)', 'Accounts receivable', 'Customs duty & disbursements recoverable',
    'Customer advances', 'VAT output', 'Opening balance equity', 'Customs clearance fees']);
  assert.ok((await ok(manager, 'list_work_types')).find(t => t.name === 'Customs clearance').revenue_account_id === id('4130'));
});

test('admins manage the chart; system accounts are protected', async () => {
  const data = { code: '1110', name: 'Bank - savings', type: 'asset', subtype: 'bank', bank_name: 'Example Bank', account_number: 'AE07...', active: true };
  assert.equal((await call(manager, 'save_account', { p_id: null, p_data: data })).error.code, '42501');
  assert.deepEqual((await call(admin, 'save_account', { p_id: null, p_data: { ...data, code: '1010' } })).error.fields,
    { code: 'Another account already uses this code' });
  assert.deepEqual((await call(admin, 'save_account', { p_id: null, p_data: { ...data, subtype: 'revenue' } })).error.fields,
    { subtype: 'Pick a group that matches the type' });
  const savings = await ok(admin, 'save_account', { p_id: null, p_data: data });
  acc['1110'] = { id: savings };
  const ar = acc['1200'];
  assert.match((await call(admin, 'save_account', { p_id: ar.id, p_data: { code: '1200', name: 'Debtors', type: 'asset', subtype: 'receivable', active: false } })).error.fields.type,
    /used by automatic postings/);
  await ok(admin, 'save_account', { p_id: ar.id, p_data: { code: '1200', name: 'Trade debtors', type: 'asset', subtype: 'receivable', active: true } });
  await ok(admin, 'save_account', { p_id: ar.id, p_data: { code: '1200', name: 'Accounts receivable', type: 'asset', subtype: 'receivable', active: true } });
});

let invId;

test('a tax invoice posts when sent: receivables, revenue by type of work, disbursements, VAT', async () => {
  invId = await ok(manager, 'save_invoice', { p_id: null, p_data: {
    kind: 'tax', task_id: taskId, customer_id: customerId, issue_date: today, lines: [
      { description: 'Customs clearance fee', quantity: 1, unit_price: 400, vat_code: 'standard' },
      { description: 'Customs duty paid on your behalf', quantity: 1, unit_price: 1200, vat_code: 'out_of_scope' }] } });
  assert.deepEqual(await balances(), {}, 'drafts are not posted');
  await ok(manager, 'mark_invoice_sent', { p_id: invId, p_to: 'a@example.com' });
  assert.deepEqual(await balances(), { 1200: 1620, 1300: -1200, 2200: -20, 4130: -400 });
  await ok(manager, 'mark_invoice_sent', { p_id: invId, p_to: 'a@example.com' });
  assert.deepEqual(await balances(), { 1200: 1620, 1300: -1200, 2200: -20, 4130: -400 }, 'sending again does not post twice');

  const list = await ok(manager, 'list_journals', { p_kind: 'automatic' });
  const j = (await ok(manager, 'get_journal', { p_id: list.journals[0].id })).journal;
  assert.equal(j.kind, 'invoice');
  assert.match(j.number, /^JV-\d{4}-0001$/);
  assert.equal(j.source.invoice_id, invId);
  assert.equal(j.lines.find(l => l.code === '1200').customer_name, 'Gulf Traders LLC');
});

test('payments: cash and bank transfer into chosen accounts; cheques via cheques in hand; bounce and delete reverse', async () => {
  const pay = data => ok(manager, 'record_payment', { p_invoice_id: invId, p_data: { paid_on: today, ...data } });
  assert.deepEqual((await call(manager, 'record_payment', { p_invoice_id: invId, p_data: { amount: 1, method: 'cash', paid_on: today, account_id: id('4130') } })).error.fields,
    { account_id: 'Pick a bank or cash account' });
  await pay({ amount: 100, method: 'cash' });
  await pay({ amount: 300, method: 'bank_transfer', account_id: acc['1110'].id });
  const cheque = await pay({ amount: 1000, method: 'cheque', reference: '000123', account_id: id('1100') });
  assert.deepEqual(await balances(), { 1010: 100, 1110: 300, 1150: 1000, 1200: 220, 1300: -1200, 2200: -20, 4130: -400 });

  await ok(manager, 'set_cheque_status', { p_id: cheque, p_status: 'cleared' });
  assert.equal((await balances())[1100], 1000, 'cleared: from cheques in hand into the bank');
  assert.equal((await balances())[1150], undefined);
  await ok(manager, 'set_cheque_status', { p_id: cheque, p_status: 'bounced' });
  let b = await balances();
  assert.deepEqual([b[1100], b[1200]], [undefined, 1220], 'bounced: back on the customer\'s account');

  const inv = (await ok(manager, 'get_invoice', { p_id: invId })).invoice;
  const cashPay = inv.payments.find(p => p.method === 'cash');
  assert.equal(inv.payments.find(p => p.method === 'bank_transfer').account_name, 'Bank - savings');
  await ok(manager, 'delete_payment', { p_id: cashPay.id });
  b = await balances();
  assert.deepEqual([b[1010], b[1200]], [undefined, 1320], 'deleting a payment reverses its posting');
  await ok(manager, 'delete_payment', { p_id: cheque });
  assert.equal((await balances())[1200], 1320, 'a bounced cheque had nothing left to reverse');
});

test('advances on a proforma sit in customer advances and move to receivables when the tax invoice is issued', async () => {
  const pro = await ok(manager, 'save_invoice', { p_id: null, p_data: { kind: 'proforma', task_id: taskId, customer_id: customerId, issue_date: today,
    lines: [{ description: 'Clearance', quantity: 1, unit_price: 1000, vat_code: 'standard' }] } });
  await ok(manager, 'mark_invoice_sent', { p_id: pro, p_to: 'a@example.com' });
  assert.equal((await balances())[1200], 1320, 'proformas are never posted');
  await ok(manager, 'record_payment', { p_invoice_id: pro, p_data: { amount: 500, method: 'bank_transfer', paid_on: today } });
  assert.equal((await balances())[2150], -500);

  const tax = await ok(manager, 'save_invoice', { p_id: null, p_data: { kind: 'tax', task_id: taskId, customer_id: customerId, proforma_id: pro,
    issue_date: today, lines: [{ description: 'Clearance', quantity: 1, unit_price: 1000, vat_code: 'standard' }] } });
  assert.equal((await balances())[2150], -500, 'still an advance while the tax invoice is a draft');
  await ok(manager, 'mark_invoice_sent', { p_id: tax, p_to: 'a@example.com' });
  const b = await balances();
  assert.equal(b[2150], undefined, 'advance applied');
  assert.equal(b[1200], 1320 + 1050 - 500);

  // A cancelled tax invoice is reversed
  const extra = await ok(manager, 'save_invoice', { p_id: null, p_data: { kind: 'tax', customer_id: customerId, issue_date: today,
    lines: [{ description: 'Storage', quantity: 1, unit_price: 100, vat_code: 'standard' }] } });
  await ok(manager, 'mark_invoice_sent', { p_id: extra, p_to: 'a@example.com' });
  assert.equal((await balances())[4190], -100, 'no task: other operating revenue');
  await ok(manager, 'cancel_invoice', { p_id: extra });
  assert.equal((await balances())[4190], undefined);
});

test('manual journals must balance; accruals can reverse automatically; reversals; staff cannot post', async () => {
  const lines = [{ account_id: id('6200'), debit: '5000', credit: '' }, { account_id: id('1100'), debit: '', credit: '4000' }];
  assert.equal((await call(staff, 'post_manual_journal', { p_data: { entry_date: today, memo: 'Rent', lines } })).error.code, '42501');
  assert.equal((await call(manager, 'post_manual_journal', { p_data: { entry_date: today, memo: 'Rent', lines } })).error.fields.lines,
    'Debits (AED 5,000.00) and credits (AED 4,000.00) differ by AED 1,000.00');
  assert.match((await call(manager, 'post_manual_journal', { p_data: { entry_date: today, memo: 'x',
    lines: [{ account_id: id('6200'), debit: '10', credit: '10' }, { account_id: id('1100'), credit: '0' }] } })).error.fields.lines, /either a debit or a credit/);

  const rent = await ok(manager, 'post_manual_journal', { p_data: { entry_date: today, memo: 'Office rent, this month', reference: 'Lease 2026',
    lines: [{ account_id: id('6200'), debit: '5000' }, { account_id: id('1100'), credit: '5000' }] } });
  assert.equal((await balances())[6200], 5000);
  const rev = await ok(manager, 'reverse_entry', { p_id: rent, p_date: today, p_memo: null });
  assert.equal((await balances())[6200], undefined);
  const j = (await ok(manager, 'get_journal', { p_id: rent })).journal;
  assert.equal(j.reversed_by_id, rev);
  assert.match((await call(manager, 'reverse_entry', { p_id: rent, p_date: today })).error.message, /already been reversed/);

  const auto = (await ok(manager, 'list_journals', { p_kind: 'invoice' })).journals[0].id;
  assert.match((await call(manager, 'reverse_entry', { p_id: auto, p_date: today })).error.message, /cancel or correct the invoice instead/);

  // Accrual for an expense not yet billed, reversed automatically on the first of next month
  const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10);
  await ok(manager, 'post_manual_journal', { p_data: { entry_date: today, kind: 'accrual', memo: 'Electricity not yet billed', reverse_on: next,
    lines: [{ account_id: id('6210'), debit: '800' }, { account_id: id('2300'), credit: '800' }] } });
  assert.equal((await balances(today))[2300], -800);
  assert.equal((await balances(next))[2300], undefined, 'reversed on the chosen date');
});

test('opening balances go to balance sheet accounts only', async () => {
  const first = `${today.slice(0, 4)}-01-01`;
  assert.match((await call(manager, 'post_manual_journal', { p_data: { entry_date: first, kind: 'opening', memo: 'Opening balances',
    lines: [{ account_id: id('4100'), credit: '10' }, { account_id: id('3900'), debit: '10' }] } })).error.fields.lines, /balance sheet accounts only/);
  await ok(manager, 'post_manual_journal', { p_data: { entry_date: first, kind: 'opening', memo: 'Opening balances',
    lines: [{ account_id: id('1100'), debit: '50000' }, { account_id: id('1200'), debit: '7000', customer_id: customerId },
            { account_id: id('3100'), credit: '20000' }, { account_id: id('3900'), credit: '37000' }] } });
  const ledger = await ok(manager, 'account_ledger', { p_account: id('1200'), p_from: fyStart, p_to: today, p_customer: customerId });
  assert.equal(ledger.lines[0].debit, 7000);
  assert.equal(ledger.lines[0].customer_name, 'Gulf Traders LLC');
  const last = ledger.lines.at(-1);
  assert.equal(last.balance, ledger.closing, 'running balance ends at the closing balance');
  assert.equal(ledger.closing, 7000 + 1870);
});

test('bank and cash: money in, money out, transfers', async () => {
  assert.deepEqual((await call(manager, 'bank_transaction', { p_data: { kind: 'transfer', entry_date: today, account_id: id('1100'),
    other_account_id: id('6400'), amount: '1', memo: 'x' } })).error.fields, { other_account_id: 'Transfers go to another bank or cash account' });
  await ok(manager, 'bank_transaction', { p_data: { kind: 'out', entry_date: today, account_id: id('1100'), other_account_id: id('6400'), amount: '25', memo: 'Bank charges' } });
  await ok(manager, 'bank_transaction', { p_data: { kind: 'transfer', entry_date: today, account_id: id('1100'), other_account_id: id('1020'), amount: '1000', memo: 'Top up petty cash' } });
  await ok(manager, 'bank_transaction', { p_data: { kind: 'in', entry_date: today, account_id: id('1010'), other_account_id: id('4900'), amount: '150', memo: 'Scrap sale' } });
  const cash = Object.fromEntries((await ok(manager, 'cash_accounts')).map(a => [a.code, a.balance]));
  assert.equal(cash['1020'], 1000);
  assert.equal(cash['1010'], 150);
  assert.equal(cash['1100'], 50000 + 500 - 25 - 1000, 'opening + advance received - charges - transfer');
});

test('P&L, balance sheet and closing the books', async () => {
  const pl = await ok(manager, 'profit_loss', { p_from: fyStart, p_to: today });
  const byCode = Object.fromEntries(pl.rows.map(r => [r.code, r.amount]));
  assert.deepEqual(byCode, { 4130: 1400, 4900: 150, 6210: 800, 6400: 25 });
  const profit = 1400 + 150 - 800 - 25;

  const bs = await ok(manager, 'balance_sheet', { p_as_of: today });
  assert.equal(bs.current_year_profit, profit);
  const sum = t => bs.rows.filter(r => r.type === t).reduce((s, r) => s + Number(r.amount), 0);
  assert.equal(Math.round(sum('asset') * 100), Math.round((sum('liability') + sum('equity') + profit) * 100), 'assets = liabilities + equity');

  const ov = await ok(manager, 'finance_overview');
  assert.equal(ov.receivables, 7000 + 1870);
  assert.equal(ov.year.income, 1550);

  assert.equal((await call(manager, 'set_books_locked_until', { p_date: today })).error.code, '42501', 'only admins close the books');
  await ok(admin, 'set_books_locked_until', { p_date: today });
  assert.match((await call(manager, 'post_manual_journal', { p_data: { entry_date: today, memo: 'late',
    lines: [{ account_id: id('6900'), debit: '1' }, { account_id: id('1010'), credit: '1' }] } })).error.message, /books are closed/);
  assert.match((await call(manager, 'record_payment', { p_invoice_id: invId, p_data: { amount: 1, method: 'cash', paid_on: today } })).error.message,
    /books are closed/, 'automatic postings respect the closed period too');
  await ok(admin, 'set_books_locked_until', { p_date: null });
});
