'use strict';

// Tests for finance phase 4: departments and profitability tags, profitability by customer / type of work /
// department, cash flow statement, detailed trial balance, recurring journals, accruals and prepayments schedules.

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

let admin; let manager; let staff; let today; let fyStart; let acc; let tags;
let custA; let custB; let supplier; let clearance; let deptAdmin;
const id = code => acc[code].id;
const plus = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthStart = n => { const d = new Date(today.slice(0, 8) + '01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const monthEnd = n => { const d = new Date(monthStart(n + 1) + 'T00:00:00Z'); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
const row = (rows, name) => rows.find(r => r.name === name);

before(async () => {
  db = await startLocalDb({ port: 54360 });
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
  custA = await ok(staff, 'save_customer', { p_id: null, p_data: { name: 'Alpha Trading' } });
  custB = await ok(staff, 'save_customer', { p_id: null, p_data: { name: 'Beta Foods' } });
  supplier = await ok(manager, 'save_supplier', { p_id: null, p_data: { name: 'Port Services LLC' } });
  tags = await ok(manager, 'profit_tags');
  clearance = tags.work_types.find(w => w.name === 'Customs clearance');
  deptAdmin = tags.departments.find(d => d.name === 'Administration').id;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.stop();
});

test('departments: standard ones linked to the types of work; managers manage them', async () => {
  const deps = await ok(staff, 'list_departments');
  assert.deepEqual(deps.map(d => d.name).sort(), ['Administration', 'Customs clearance', 'Freight forwarding', 'PRO services', 'Transport']);
  assert.deepEqual(row(deps, 'Freight forwarding').work_types, ['Air freight', 'Sea freight']);
  assert.equal(clearance.department_id, row(deps, 'Customs clearance').id);
  assert.equal((await call(staff, 'save_department', { p_id: null, p_name: 'Warehousing' })).error.code, '42501');
  const wh = await ok(manager, 'save_department', { p_id: null, p_name: 'Warehousing' });
  assert.deepEqual((await call(manager, 'save_department', { p_id: null, p_name: 'warehousing' })).error.fields, { name: 'There is already a department with this name' });
  const other = tags.work_types.find(w => w.name === 'Other');
  await ok(manager, 'set_work_type_department', { p_id: other.id, p_department: wh });
  assert.equal((await ok(manager, 'list_work_types')).find(w => w.name === 'Other').department_id, wh);
});

test('profitability by customer, type of work and department, from invoices, credit notes, bills and journals', async () => {
  const task = await ok(manager, 'save_task', { p_id: null, p_data: { title: 'Clear container MSKU1', customer_id: custA, work_type_id: clearance.id } });
  const inv = await ok(manager, 'save_invoice', { p_id: null, p_data: { kind: 'tax', customer_id: custA, task_id: task, issue_date: today,
    lines: [{ description: 'Clearance', quantity: 1, unit_price: 1000, vat_code: 'standard' }] } });
  await ok(manager, 'mark_invoice_sent', { p_id: inv, p_to: 'a@example.com' });
  const invB = await ok(manager, 'save_invoice', { p_id: null, p_data: { kind: 'tax', customer_id: custB, issue_date: today,
    lines: [{ description: 'Freight', quantity: 1, unit_price: 600, vat_code: 'zero' }] } });
  await ok(manager, 'mark_invoice_sent', { p_id: invB, p_to: 'b@example.com' });
  const cn = await ok(manager, 'save_credit_note', { p_id: null, p_data: { invoice_id: inv, issue_date: today, reason: 'Discount',
    lines: [{ description: 'Discount', quantity: 1, unit_price: 100, vat_code: 'standard' }] } });
  await ok(manager, 'issue_credit_note', { p_id: cn });

  // A port charge for customer A's clearance job (cost of sales), and office rent with no tags
  const bill = await ok(manager, 'save_bill', { p_id: null, p_data: { supplier_id: supplier, supplier_ref: 'PS-1', bill_date: today,
    customer_id: custA, work_type_id: clearance.id, lines: [{ description: 'Port handling', account_id: id('5110'), quantity: 1, unit_price: 400, vat_code: 'standard' }] } });
  await ok(manager, 'post_bill', { p_id: bill });
  assert.equal((await ok(manager, 'get_bill', { p_id: bill })).bill.customer_id, custA);
  const rent = await ok(manager, 'save_bill', { p_id: null, p_data: { supplier_id: supplier, supplier_ref: 'PS-2', bill_date: today,
    lines: [{ description: 'Rent', account_id: id('6200'), quantity: 1, unit_price: 300, vat_code: 'exempt' }] } });
  await ok(manager, 'post_bill', { p_id: rent });
  await ok(manager, 'post_manual_journal', { p_data: { entry_date: today, memo: 'Phone bill', department_id: deptAdmin, lines: [
    { account_id: id('6210'), debit: 50 }, { account_id: id('1100'), credit: 50 }] } });
  await ok(manager, 'record_petty_cash', { p_data: { spent_on: today, payee: 'Shop', description: 'Tea', expense_account_id: id('6900'), vat_code: 'zero', total: 20, department_id: deptAdmin } });

  assert.equal((await call(staff, 'profitability', { p_from: fyStart, p_to: today, p_by: 'customer' })).error.code, '42501');
  const byCust = (await ok(manager, 'profitability', { p_from: fyStart, p_to: today, p_by: 'customer' })).rows;
  const a = row(byCust, 'Alpha Trading');
  assert.deepEqual([Number(a.revenue), Number(a.direct_costs), Number(a.other_expenses)], [900, 400, 0]);
  assert.equal(Number(row(byCust, 'Beta Foods').revenue), 600);
  const na = row(byCust, 'Not assigned');
  assert.deepEqual([na.key, Number(na.revenue), Number(na.other_expenses)], [null, 0, 370]);
  assert.equal(byCust.at(-1).name, 'Not assigned', 'unassigned last');

  const byType = (await ok(manager, 'profitability', { p_from: fyStart, p_to: today, p_by: 'work_type' })).rows;
  assert.deepEqual([Number(row(byType, 'Customs clearance').revenue), Number(row(byType, 'Customs clearance').direct_costs)], [900, 400]);
  assert.equal(Number(row(byType, 'Not assigned').revenue), 600);
  const byDept = (await ok(manager, 'profitability', { p_from: fyStart, p_to: today, p_by: 'department' })).rows;
  assert.equal(Number(row(byDept, 'Customs clearance').revenue), 900);
  assert.equal(Number(row(byDept, 'Administration').other_expenses), 70);
  // Totals agree with the profit and loss
  const pl = await ok(manager, 'profit_loss', { p_from: fyStart, p_to: today });
  const plProfit = pl.rows.reduce((t, r) => t + (r.type === 'income' ? Number(r.amount) : -Number(r.amount)), 0);
  const total = byCust.reduce((t, r) => t + Number(r.revenue) - Number(r.direct_costs) - Number(r.other_expenses), 0);
  assert.equal(Math.round(total * 100) / 100, Math.round(plProfit * 100) / 100);
});

test('cash flow statement: profit, working capital, investing, financing, ties to the change in cash; opening balances left out', async () => {
  await ok(manager, 'post_manual_journal', { p_data: { entry_date: fyStart, kind: 'opening', memo: 'Opening', lines: [
    { account_id: id('1100'), debit: 10000 }, { account_id: id('3900'), credit: 10000 }] } });
  await ok(manager, 'bank_transaction', { p_data: { kind: 'out', entry_date: today, account_id: id('1100'), other_account_id: id('1600'), amount: 2000, memo: 'Laptop' } });
  await ok(manager, 'bank_transaction', { p_data: { kind: 'in', entry_date: today, account_id: id('1100'), other_account_id: id('3100'), amount: 5000, memo: 'Capital' } });
  await ok(manager, 'post_manual_journal', { p_data: { entry_date: today, memo: 'Depreciation', lines: [
    { account_id: id('6700'), debit: 100 }, { account_id: id('1690'), credit: 100 }] } });
  const cf = await ok(manager, 'cash_flow', { p_from: fyStart, p_to: today });
  const sum = Number(cf.operating_total) + Number(cf.investing_total) + Number(cf.financing_total);
  assert.equal(Math.round(sum * 100) / 100, Math.round((Number(cf.cash_end) - Number(cf.cash_start)) * 100) / 100, 'ties to the change in cash');
  assert.equal(Number(cf.cash_start), 10000, 'opening balances count as cash at the start');
  assert.deepEqual(cf.investing.map(x => [x.code, Number(x.amount)]), [['1600', -2000]]);
  assert.deepEqual(cf.financing.map(x => [x.code, Number(x.amount)]), [['3100', 5000]]);
  assert.deepEqual(cf.adjustments.map(x => [x.code, Number(x.amount)]), [['1690', 100]], 'depreciation added back');
  assert.ok(cf.working_capital.some(x => x.code === '1200' && Number(x.amount) < 0), 'receivables went up');
  assert.ok(cf.working_capital.some(x => x.code === '2100' && Number(x.amount) > 0), 'payables went up');
});

test('detailed trial balance: receivables and payables by customer and supplier', async () => {
  const parties = await ok(manager, 'trial_balance_parties', { p_from: fyStart, p_to: today });
  const ar = parties.filter(p => p.account_id === id('1200'));
  assert.deepEqual(ar.map(p => [p.name, Number(p.debit) - Number(p.credit)]).sort(), [['Alpha Trading', 1050 - 105], ['Beta Foods', 600]]);
  const ap = parties.filter(p => p.account_id === id('2100'));
  assert.deepEqual(ap.map(p => [p.party_type, p.name, Number(p.credit)]), [['supplier', 'Port Services LLC', 720]]);
  const tb = await ok(manager, 'trial_balance', { p_from: fyStart, p_to: today });
  const arRow = tb.rows.find(r => r.code === '1200');
  assert.equal(ar.reduce((t, p) => t + Number(p.opening) + Number(p.debit) - Number(p.credit), 0), Number(arRow.opening) + Number(arRow.debit) - Number(arRow.credit));
});

test('recurring journals: posted when due, catching up, department on expense lines, reversible', async () => {
  const data = { memo: 'Office rent {period}', every_months: '1', next_date: plus(-35), department_id: deptAdmin,
    lines: [{ account_id: id('6200'), debit: 4000 }, { account_id: id('2300'), credit: 4000 }] };
  assert.equal((await call(staff, 'save_recurring_journal', { p_id: null, p_data: data })).error.code, '42501');
  assert.match((await call(manager, 'save_recurring_journal', { p_id: null, p_data: { ...data, lines: [{ account_id: id('6200'), debit: 4000 }, { account_id: id('2300'), credit: 3000 }] } })).error.fields.lines,
    /differ by AED 1,000.00/);
  const rid = await ok(manager, 'save_recurring_journal', { p_id: null, p_data: data });
  assert.equal((await ok(manager, 'finance_overview')).journals_due, 1);
  const run = await ok(manager, 'run_recurring_journals', {});
  assert.equal(run.created.length, 2);
  const j = (await ok(manager, 'get_journal', { p_id: run.created[0].id })).journal;
  const month = new Date(plus(-35) + 'T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  assert.equal(j.memo, `Office rent ${month}`);
  assert.equal(j.entry_date, plus(-35));
  const lines = (await db.pool.query('select a.code, l.department_id from public.journal_lines l join public.accounts a on a.id = l.account_id where l.journal_id = $1 order by a.code', [j.id])).rows;
  assert.deepEqual(lines.map(l => [l.code, l.department_id === null ? null : Number(l.department_id)]), [['2300', null], ['6200', deptAdmin]]);
  assert.equal((await ok(manager, 'run_recurring_journals', {})).created.length, 0);
  await ok(manager, 'reverse_entry', { p_id: j.id, p_date: today });
  const r = (await ok(manager, 'get_recurring_journal', { p_id: rid })).recurring;
  assert.deepEqual([r.journals.length, r.journals.filter(x => x.reversed).length], [2, 1]);
  assert.ok(r.next_date > today);
});

test('prepayment and accrual schedules: monthly postings at month end, rounding, edits limited once posted, undo', async () => {
  const data = { kind: 'prepayment', name: 'Insurance policy 2026', total: 12000, months: 12, start_month: monthStart(-2), expense_account_id: id('6900') };
  assert.equal((await call(staff, 'save_schedule', { p_id: null, p_data: data })).error.code, '42501');
  assert.deepEqual((await call(manager, 'save_schedule', { p_id: null, p_data: { ...data, expense_account_id: id('1100') } })).error.fields,
    { expense_account_id: 'Pick an expense account' });
  const sid = await ok(manager, 'save_schedule', { p_id: null, p_data: data });
  let s = await ok(manager, 'get_schedule', { p_id: sid });
  assert.equal(s.schedule.balance_account, '1350 · Prepaid expenses');
  assert.equal(s.plan.length, 12);
  assert.deepEqual([s.plan[0].period, s.plan[0].post_on, Number(s.plan[0].amount)], [monthStart(-2), monthEnd(-2), 1000]);
  const ended = s.plan.filter(p => p.post_on <= today).length;
  assert.equal((await ok(manager, 'list_schedules')).rows[0].due, ended);

  const run = await ok(manager, 'run_schedules', { p_id: sid });
  assert.equal(run.created.length, ended);
  s = await ok(manager, 'get_schedule', { p_id: sid });
  assert.ok(s.plan[0].journal_number);
  const tb = await ok(manager, 'trial_balance', { p_from: fyStart, p_to: today });
  const prepaid = tb.rows.find(r => r.code === '1350');
  assert.equal(Number(prepaid.credit), 1000 * ended);
  assert.equal((await ok(manager, 'run_schedules', { p_id: sid })).created.length, 0, 'nothing posted twice');
  assert.match((await call(manager, 'save_schedule', { p_id: sid, p_data: { ...data, total: 6000 } })).error.message, /already been posted/);
  await ok(manager, 'save_schedule', { p_id: sid, p_data: { ...data, name: 'Insurance 2026 (renamed)', active: true } });
  assert.match((await call(manager, 'delete_schedule', { p_id: sid })).error.message, /Undo them first/);
  await ok(manager, 'undo_schedule_posting', { p_id: s.plan[0].posting_id });
  s = await ok(manager, 'get_schedule', { p_id: sid });
  assert.equal(s.plan[0].posting_id, null);

  // Accrual: default account, and the last month takes the rounding
  const acc3 = await ok(manager, 'save_schedule', { p_id: null, p_data: { kind: 'accrual', name: 'Audit fee', total: 1000, months: 3, start_month: monthStart(0), expense_account_id: id('6500') } });
  const a = await ok(manager, 'get_schedule', { p_id: acc3 });
  assert.equal(a.schedule.balance_account, '2300 · Accrued expenses');
  assert.deepEqual(a.plan.map(p => Number(p.amount)), [333.33, 333.33, 333.34]);
  assert.equal(Number(a.plan.at(-1).balance_after), 0);
  assert.match((await call(manager, 'run_schedules', { p_id: acc3, p_up_to: plus(400) })).error.message, /once they have ended/);
});
