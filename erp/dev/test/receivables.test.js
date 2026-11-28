'use strict';

// Tests for finance phase 3: customer credit notes, receipt vouchers and allocation, customer statements,
// receivables ageing, recurring invoices, bank statement import and reconciliation, petty cash.

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

let admin; let manager; let staff; let today; let fyStart; let acc;
let custId; let inv1; let inv2; let inv3; let cnId; let rvId;
const id = code => acc[code].id;
const plus = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const invoice = async invId => (await ok(manager, 'get_invoice', { p_id: invId })).invoice;

async function balances() {
  const tb = await ok(manager, 'trial_balance', { p_from: fyStart, p_to: today });
  const out = {};
  for (const r of tb.rows) {
    const c = Math.round((Number(r.opening) + Number(r.debit) - Number(r.credit)) * 100) / 100;
    if (c) out[r.code] = c;
  }
  return out;
}

async function sentInvoice(lines, extra = {}) {
  const invId = await ok(manager, 'save_invoice', { p_id: null, p_data: { kind: 'tax', customer_id: custId, issue_date: today, lines, ...extra } });
  await ok(manager, 'mark_invoice_sent', { p_id: invId, p_to: 'accounts@gulftraders.ae' });
  return invId;
}

before(async () => {
  db = await startLocalDb({ port: 54357 });
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
  custId = await ok(staff, 'save_customer', { p_id: null, p_data: { name: 'Gulf Traders LLC', trn: '100999888777666', email: 'accounts@gulftraders.ae' } });
  inv1 = await sentInvoice([
    { description: 'Customs clearance', quantity: 1, unit_price: 1000, vat_code: 'standard' },
    { description: 'Duty paid on your behalf', quantity: 1, unit_price: 500, vat_code: 'out_of_scope' }]);
  inv2 = await sentInvoice([{ description: 'Sea freight handling', quantity: 1, unit_price: 2000, vat_code: 'standard' }],
    { issue_date: plus(-40), due_date: plus(-10) });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.stop();
});

test('credit notes: against a sent tax invoice, limited to its total, posted when issued and set against the balance', async () => {
  const cnLines = [{ description: 'Clearance overcharged', quantity: 1, unit_price: 200, vat_code: 'standard' }];
  assert.equal((await call(staff, 'save_credit_note', { p_id: null, p_data: { invoice_id: inv1, issue_date: today, reason: 'x', lines: cnLines } })).error.code, '42501');
  const draftInv = await ok(manager, 'save_invoice', { p_id: null, p_data: { kind: 'tax', customer_id: custId, issue_date: today, lines: cnLines } });
  assert.match((await call(manager, 'save_credit_note', { p_id: null, p_data: { invoice_id: draftInv, issue_date: today, reason: 'x', lines: cnLines } })).error.message,
    /tax invoice that has been sent/);
  const tooMuch = await call(manager, 'save_credit_note', { p_id: null, p_data: { invoice_id: inv1, issue_date: today, reason: 'Wrong',
    lines: [{ description: 'Everything', quantity: 1, unit_price: 2000, vat_code: 'standard' }] } });
  assert.match(tooMuch.error.fields.lines, /can't be more than AED 1,550.00/);
  assert.deepEqual((await call(manager, 'save_credit_note', { p_id: null, p_data: { invoice_id: inv1, issue_date: today, lines: cnLines } })).error.fields,
    { reason: 'Required' });

  const before = await balances();
  cnId = await ok(manager, 'save_credit_note', { p_id: null, p_data: { invoice_id: inv1, issue_date: today, reason: 'Clearance fee overcharged', lines: cnLines } });
  let cn = (await ok(manager, 'get_credit_note', { p_id: cnId })).credit_note;
  assert.match(cn.number, /^CN-\d{4}-0001$/);
  assert.deepEqual([cn.status, Number(cn.subtotal), Number(cn.vat_total), Number(cn.total), cn.customer_trn], ['draft', 200, 10, 210, '100999888777666']);
  assert.deepEqual(await balances(), before, 'a draft is not in the books');

  await ok(manager, 'issue_credit_note', { p_id: cnId });
  cn = (await ok(manager, 'get_credit_note', { p_id: cnId })).credit_note;
  assert.deepEqual([cn.status, Number(cn.amount_applied)], ['issued', 210]);
  const after1 = await balances();
  assert.equal(after1['1200'], before['1200'] - 210);
  assert.equal(after1['2200'], before['2200'] + 10, 'VAT output reduced');
  assert.equal(after1['4190'], before['4190'] + 200, 'revenue reduced');
  const i1 = await invoice(inv1);
  assert.deepEqual([Number(i1.amount_paid), i1.status, i1.credit_notes.length, i1.allocations[0].source], [210, 'sent', 1, cn.number]);
  assert.match((await call(manager, 'cancel_invoice', { p_id: inv1 })).error.message, /Remove them first|credit note/);
  assert.match((await call(manager, 'save_credit_note', { p_id: cnId, p_data: { issue_date: today, reason: 'y', lines: cnLines } })).error.message, /issued/);
  const second = await call(manager, 'save_credit_note', { p_id: null, p_data: { invoice_id: inv1, issue_date: today, reason: 'More',
    lines: [{ description: 'Rest', quantity: 1, unit_price: 1300, vat_code: 'standard' }] } });
  assert.match(second.error.fields.lines, /AED 1,340.00 .*less earlier credit notes/);

  // A cancelled draft frees its amount; the VAT return shows the credit note as negative sales
  const v = await ok(manager, 'vat_return', { p_from: fyStart, p_to: today });
  assert.deepEqual(v.box1, { amount: 2800, vat: 140 });
  assert.ok(v.ledger.some(l => l.doc_type === 'credit_note' && Number(l.vat) === -10 && l.box === '1'));
  assert.deepEqual(v.gl.vat_output, 140);
});

test('receipt vouchers: several invoices at once, the rest as an advance, applied later, cheques cleared and bounced, void', async () => {
  const bank = id('1100');
  assert.equal((await call(staff, 'record_receipt', { p_data: {} })).error.code, '42501');
  const over = await call(manager, 'record_receipt', { p_data: { customer_id: custId, received_on: today, amount: 100, method: 'bank_transfer', account_id: bank,
    allocations: [{ invoice_id: inv1, amount: 100 }, { invoice_id: inv2, amount: 50 }] } });
  assert.match(over.error.fields.allocations, /more than the amount received/);
  const tooBig = await call(manager, 'record_receipt', { p_data: { customer_id: custId, received_on: today, amount: 5000, method: 'bank_transfer', account_id: bank,
    allocations: [{ invoice_id: inv1, amount: 1400 }] } });
  assert.match(tooBig.error.fields.allocations, /balance of AED 1,340.00/);

  const before = await balances();
  rvId = await ok(manager, 'record_receipt', { p_data: { customer_id: custId, received_on: today, amount: 5000, method: 'bank_transfer', account_id: bank,
    reference: 'FT123', allocations: [{ invoice_id: inv1, amount: 1340 }, { invoice_id: inv2, amount: 2100 }] } });
  let r = (await ok(manager, 'get_receipt', { p_id: rvId })).receipt;
  assert.match(r.number, /^RV-\d{4}-0001$/);
  assert.deepEqual([Number(r.unallocated), r.allocations.length], [1560, 2]);
  assert.equal((await invoice(inv1)).status, 'paid');
  assert.equal((await invoice(inv2)).status, 'paid');
  let b = await balances();
  assert.equal(b['1100'], (before['1100'] || 0) + 5000);
  assert.equal(b['1200'] || 0, 0, 'receivables cleared');
  assert.equal(b['2150'], -1560, 'the rest held as a customer advance');

  // Statement: invoices, credit note, receipt; moving the advance onto invoices nets to nothing
  const st = await ok(manager, 'customer_statement', { p_customer: custId, p_from: fyStart, p_to: today });
  assert.deepEqual(st.lines.map(l => [l.document, Number(l.debit), Number(l.credit)]).sort(),
    [[r.number, 0, 5000], [(await invoice(inv1)).number, 1550, 0], [(await invoice(inv2)).number, 2100, 0], ['CN-' + today.slice(0, 4) + '-0001', 0, 210]].sort());
  assert.equal(Number(st.closing), -1560, 'the customer is in credit');
  assert.deepEqual(st.credits.map(c => [c.type, Number(c.available)]), [['receipt', 1560]]);

  // A new invoice paid from the advance, then taken off again
  inv3 = await sentInvoice([{ description: 'Documentation', quantity: 1, unit_price: 1000, vat_code: 'standard' }]);
  assert.deepEqual((await invoice(inv3)).open_credits.map(c => [c.number, Number(c.available)]), [[r.number, 1560]]);
  assert.match((await call(manager, 'apply_customer_credit', { p_invoice_id: inv3, p_source_type: 'receipt', p_source_id: rvId, p_amount: 2000 })).error.message, /balance of AED 1,050.00/);
  await ok(manager, 'apply_customer_credit', { p_invoice_id: inv3, p_source_type: 'receipt', p_source_id: rvId, p_amount: 1050 });
  assert.equal((await invoice(inv3)).status, 'paid');
  assert.equal((await balances())['2150'], -510);
  await ok(manager, 'remove_receivable_allocation', { p_id: (await invoice(inv3)).allocations[0].id });
  assert.equal((await invoice(inv3)).status, 'sent');
  b = await balances();
  assert.deepEqual([b['1200'], b['2150']], [1050, -1560]);

  // Cheque: in "cheques in hand" until cleared; a bounced cheque undoes everything
  const chq = await ok(manager, 'record_receipt', { p_data: { customer_id: custId, received_on: today, amount: 1000, method: 'cheque', account_id: bank,
    reference: '000123', cheque_bank: 'ENBD', allocations: [{ invoice_id: inv3, amount: 1000 }] } });
  assert.equal((await balances())['1150'], 1000);
  await ok(manager, 'set_receipt_cheque', { p_id: chq, p_status: 'cleared' });
  b = await balances();
  assert.deepEqual([b['1150'] || 0, b['1100']], [0, (before['1100'] || 0) + 6000]);
  const chq2 = await ok(manager, 'record_receipt', { p_data: { customer_id: custId, received_on: today, amount: 50, method: 'cheque', account_id: bank,
    reference: '000124', allocations: [{ invoice_id: inv3, amount: 50 }] } });
  assert.equal((await invoice(inv3)).status, 'paid');
  await ok(manager, 'set_receipt_cheque', { p_id: chq2, p_status: 'bounced' });
  assert.deepEqual([(await invoice(inv3)).status, Number((await invoice(inv3)).amount_paid)], ['sent', 1000]);
  assert.equal((await balances())['1150'] || 0, 0);
  assert.match((await call(manager, 'set_receipt_cheque', { p_id: chq2, p_status: 'cleared' })).error.message, /bounced/);
  const listed = await ok(manager, 'list_receipts', { p_status: 'void' });
  assert.deepEqual(listed.receipts.map(x => x.id), [chq2]);

  // Voiding the first receipt puts both invoices back to unpaid
  await ok(manager, 'void_receipt', { p_id: rvId });
  r = (await ok(manager, 'get_receipt', { p_id: rvId })).receipt;
  assert.deepEqual([r.status, Number(r.unallocated), r.allocations.length], ['void', 0, 0]);
  assert.deepEqual([Number((await invoice(inv1)).amount_paid), (await invoice(inv2)).status], [210, 'sent']);
  b = await balances();
  assert.deepEqual([b['1100'], b['2150'] || 0, b['1200']], [(before['1100'] || 0) + 1000, 0, 1340 + 2100 + 50]);
});

test('receivables ageing and unused credits', async () => {
  // A credit note on the overdue invoice reduces what is overdue
  const cn2 = await ok(manager, 'save_credit_note', { p_id: null, p_data: { invoice_id: inv2, issue_date: today, reason: 'Discount',
    lines: [{ description: 'Agreed discount', quantity: 1, unit_price: 100, vat_code: 'standard' }] } });
  await ok(manager, 'issue_credit_note', { p_id: cn2 });
  const a = await ok(manager, 'receivables_ageing', { p_as_of: today });
  const row = a.rows.find(r => r.id === custId);
  assert.deepEqual([Number(row.current), Number(row.d30), Number(row.unallocated)], [1340 + 50, 2100 - 105, 0]);
  assert.deepEqual((await ok(manager, 'list_credit_notes', { p_status: 'issued' })).credit_notes.length, 2);

  // Cancelling an issued credit note reverses it and puts the balance back
  await ok(manager, 'cancel_credit_note', { p_id: cn2 });
  assert.equal(Number((await invoice(inv2)).amount_paid), 0);
  assert.equal((await ok(manager, 'vat_return', { p_from: fyStart, p_to: today })).box1.vat, 190, 'invoice 3 added 50');
});

test('recurring invoices: draft tax invoices created when due, catching up, period in the description', async () => {
  const data = { customer_id: custId, title: 'Monthly warehousing', every_months: '1', next_date: plus(-35), due_days: 15,
    lines: [{ description: 'Warehousing for {period}', quantity: 1, unit_price: 3000, vat_code: 'standard' }] };
  assert.equal((await call(staff, 'save_recurring_invoice', { p_id: null, p_data: data })).error.code, '42501');
  assert.deepEqual((await call(manager, 'save_recurring_invoice', { p_id: null, p_data: { ...data, lines: [] } })).error.fields, { lines: 'Add at least one line' });
  const rid = await ok(manager, 'save_recurring_invoice', { p_id: null, p_data: data });
  let list = await ok(manager, 'list_recurring_invoices');
  assert.deepEqual([list.rows[0].due, Number(list.rows[0].total)], [true, 3150]);
  assert.equal((await ok(manager, 'finance_overview')).recurring_due, 1);

  const run = await ok(manager, 'run_recurring_invoices', {});
  assert.equal(run.created.length, 2, 'this month and the one missed');
  const first = await invoice(run.created[0].id);
  assert.deepEqual([first.kind, first.status, first.issue_date, first.due_date, Number(first.total)], ['tax', 'draft', plus(-35), plus(-20), 3150]);
  const month = new Date(plus(-35) + 'T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  assert.equal(first.lines[0].description, `Warehousing for ${month}`);
  const r = (await ok(manager, 'get_recurring_invoice', { p_id: rid })).recurring;
  assert.ok(r.next_date > today);
  assert.equal(r.invoices.length, 2);
  assert.equal((await ok(manager, 'run_recurring_invoices', {})).created.length, 0, 'nothing more due');

  // An end date stops it
  await ok(manager, 'save_recurring_invoice', { p_id: rid, p_data: { ...data, next_date: today, end_date: today, active: true } });
  await ok(manager, 'run_recurring_invoices', { p_id: rid });
  list = await ok(manager, 'list_recurring_invoices');
  assert.equal(list.rows[0].active, false);
});

test('bank statement import, automatic and manual matching, entries for bank charges, reconciliation', async () => {
  const bank = id('1100');
  assert.equal((await call(staff, 'bank_reconciliation', { p_account: bank })).error.code, '42501');
  assert.match((await call(manager, 'import_bank_statement', { p_account: id('1010'), p_file_name: 'x.csv', p_lines: [] })).error.message, /bank account/);
  const lines = [
    { date: today, description: 'CHQ 000123 DEPOSIT', reference: '000123', amount: 1000, balance: 1000 },
    { date: today, description: 'MONTHLY FEE', amount: -25, balance: 975 },
  ];
  const imp = await ok(manager, 'import_bank_statement', { p_account: bank, p_file_name: 'statement.csv', p_lines: lines });
  assert.deepEqual([imp.imported, imp.skipped], [2, 0]);
  assert.deepEqual((await ok(manager, 'import_bank_statement', { p_account: bank, p_file_name: 'again.csv', p_lines: lines })).skipped, 2, 'duplicates skipped');
  assert.match((await call(manager, 'import_bank_statement', { p_account: bank, p_file_name: 'bad.csv', p_lines: [{ date: 'yesterday', amount: 'x' }] })).error.message, /could not be read/);

  let rec = await ok(manager, 'bank_reconciliation', { p_account: bank, p_as_of: today });
  assert.equal(rec.statement_lines.length, 2);
  const dep = rec.statement_lines.find(l => Number(l.amount) === 1000);
  assert.ok(dep.suggestion, 'the cleared cheque is suggested');
  assert.equal(rec.ledger_lines.length, 1, 'the voided receipt and its reversal are left out');
  assert.equal(Number(rec.statement_balance), 975);

  const fee = rec.statement_lines.find(l => Number(l.amount) === -25);
  assert.match((await call(manager, 'match_bank_line', { p_statement_line: fee.id, p_journal_line: dep.suggestion.line_id })).error.message, /amounts differ/);
  assert.equal(await ok(manager, 'auto_match_bank', { p_account: bank }), 1);
  assert.match((await call(manager, 'bank_line_entry', { p_statement_line: fee.id, p_other_account: id('1200'), p_memo: '' })).error.message, /receipt or payment voucher/);
  await ok(manager, 'bank_line_entry', { p_statement_line: fee.id, p_other_account: id('6400'), p_memo: 'Bank charges' });

  rec = await ok(manager, 'bank_reconciliation', { p_account: bank, p_as_of: today });
  assert.deepEqual([rec.statement_lines.length, rec.ledger_lines.length, rec.matched.length], [0, 0, 2]);
  assert.equal(Number(rec.book_balance), 975);
  assert.equal(Number(rec.expected_statement_balance), Number(rec.statement_balance), 'reconciled');

  await ok(manager, 'unmatch_bank_line', { p_statement_line: fee.id });
  rec = await ok(manager, 'bank_reconciliation', { p_account: bank, p_as_of: today });
  assert.deepEqual([rec.statement_lines.length, rec.ledger_lines.length], [1, 1]);
  assert.equal(Number(rec.expected_statement_balance), 975, 'still adds up: -25 uncleared in the books, -25 on the statement');
  await ok(manager, 'delete_bank_import', { p_id: imp.import_id });
  assert.equal((await ok(manager, 'bank_reconciliation', { p_account: bank })).matched.length, 0);
});

test('petty cash: top-up, spending with and without recoverable VAT, void, in the VAT return', async () => {
  assert.equal((await call(staff, 'petty_cash', { p_from: fyStart, p_to: today })).error.code, '42501');
  await ok(manager, 'bank_transaction', { p_data: { kind: 'transfer', entry_date: today, account_id: id('1100'), other_account_id: id('1020'), amount: 500, memo: 'Petty cash top-up' } });
  // bank_transaction "transfer" moves money from account_id to other_account_id
  const spend = data => ok(manager, 'record_petty_cash', { p_data: { spent_on: today, expense_account_id: id('6600'), recoverable: true, ...data } });
  assert.deepEqual((await call(manager, 'record_petty_cash', { p_data: { spent_on: today, payee: 'X', description: 'Y', expense_account_id: id('1100'), vat_code: 'standard', total: 10 } })).error.fields,
    { expense_account_id: 'Pick an expense account' });
  const before = await balances();
  const a = await spend({ payee: 'Stationery World', payee_trn: '100333444555666', description: 'Printer paper', vat_code: 'standard', total: 105, receipt_ref: 'R-77' });
  await spend({ payee: 'Water supplier', description: 'Drinking water', vat_code: 'zero', total: 50 });
  await spend({ payee: 'Restaurant', description: 'Client lunch', vat_code: 'standard', recoverable: false, total: 21, expense_account_id: id('6900') });
  const b = await balances();
  assert.equal(b['1020'], 500 - 105 - 50 - 21);
  assert.equal(b['6600'], (before['6600'] || 0) + 100 + 50);
  assert.equal(b['6900'], (before['6900'] || 0) + 21, 'VAT not recoverable is part of the cost');
  assert.equal(b['1400'], (before['1400'] || 0) + 5);
  const pc = await ok(manager, 'petty_cash', { p_from: fyStart, p_to: today });
  assert.deepEqual([pc.expenses.length, Number(pc.closing), pc.money_in.length], [3, 324, 1]);
  assert.match(pc.expenses.find(e => e.id === a).number, /^PC-\d{4}-0001$/);

  let v = await ok(manager, 'vat_return', { p_from: fyStart, p_to: today });
  assert.deepEqual(v.box9, { amount: 100, vat: 5 });
  assert.equal(v.gl.vat_input, 5, 'matches the ledger');
  await ok(manager, 'void_petty_cash', { p_id: a });
  v = await ok(manager, 'vat_return', { p_from: fyStart, p_to: today });
  assert.deepEqual(v.box9, { amount: 0, vat: 0 });
  assert.equal((await balances())['1020'], 429);
});
