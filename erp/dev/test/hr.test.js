'use strict';

// Tests for HR: the employee role, who sees which details, attendance with location and remarks,
// leave requests and approvals, and payslips.

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

let admin; let manager; let staff; let emp; let emp2; let today; let year;
const OFFICE = { lat: 25.3463, lng: 56.3418 };

before(async () => {
  db = await startLocalDb({ port: 54347 });
  server = http.createServer(createStandIn({ pool: db.pool }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await member('Aisha Admin', 'admin@example.com', 'admin');
  manager = await member('Maya Manager', 'maya@example.com', 'manager');
  staff = await member('Sami Staff', 'sami@example.com', 'staff');
  emp = await member('Ravi Driver', 'ravi@example.com', 'employee');
  emp2 = await member('Lina Clerk', 'lina@example.com', 'employee');
  today = (await ok(emp, 'my_hr')).today;
  year = Number(today.slice(0, 4));
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.stop();
});

test('the employee role only reaches HR', async () => {
  assert.match((await call(emp, 'list_customers', {})).error.message, /HR only/);
  assert.equal((await call(emp, 'dashboard')).error.code, '42501');
  assert.equal((await call(emp, 'list_users')).error.code, '42501');
  assert.equal((await ok(emp, 'me')).role, 'employee');
  assert.ok(await ok(emp, 'my_hr'));
  // Admins can set the new role
  await ok(admin, 'admin_update_user', { p_id: emp2.id, p_name: 'Lina Clerk', p_role: 'employee', p_active: true });
});

test('HR settings: admins only; office location and weekend validated', async () => {
  const settings = { office_lat: OFFICE.lat, office_lng: OFFICE.lng, office_radius_m: 200, work_start: '09:00',
    weekend_days: [0, 6], annual_leave_days: 30, medical_leave_days: 15 };
  assert.equal((await call(manager, 'save_hr_settings', { p_data: settings })).error.code, '42501');
  assert.deepEqual(Object.keys((await call(admin, 'save_hr_settings', { p_data: { ...settings, office_lng: null } })).error.fields), ['office_lat']);
  assert.deepEqual((await call(admin, 'save_hr_settings', { p_data: { ...settings, office_radius_m: 5 } })).error.fields,
    { office_radius_m: 'Use 20 to 5000 metres' });
  await ok(admin, 'save_hr_settings', { p_data: settings });
  const s = await ok(emp, 'get_hr_settings');
  assert.deepEqual([s.office_set, s.work_start, s.weekend_days], [true, '09:00', [0, 6]]);
});

test('employee records: managers see and edit everything; others see their own in full and colleagues\' basics', async () => {
  const record = { employee_no: 'LC-007', designation: 'Driver', department: 'Transport', joining_date: '2024-03-01',
    work_phone: '+971 50 111 2222', date_of_birth: '1990-05-05', nationality: 'Indian', passport_no: 'Z1234567',
    passport_expiry: '2030-01-01', visa_expiry: '2020-01-01', iban: 'ae07 0331 2345 6789 0123 456',
    basic_salary: '3000', housing_allowance: '1000', transport_allowance: '500', other_allowance: '',
    annual_leave_days: '', medical_leave_days: '20' };
  assert.equal((await call(staff, 'save_employee', { p_id: emp.id, p_data: record })).error.code, '42501');
  assert.deepEqual((await call(manager, 'save_employee', { p_id: emp.id, p_data: { ...record, basic_salary: '3,000' } })).error.fields,
    { basic_salary: 'Enter an amount like 4500 or 4500.50' });
  await ok(manager, 'save_employee', { p_id: emp.id, p_data: record });
  await ok(manager, 'save_employee', { p_id: emp2.id, p_data: { designation: 'Accounts clerk', basic_salary: '2500' } });
  await ok(manager, 'save_employee', { p_id: staff.id, p_data: { designation: 'Operations executive', basic_salary: '6000' } });

  const own = await ok(emp, 'get_employee', { p_id: emp.id });
  assert.equal(own.full, true);
  assert.deepEqual([own.basic_salary, own.passport_no, own.iban, own.annual_entitled, own.medical_entitled],
    [3000, 'Z1234567', 'AE070331234567890123456', 30, 20], 'own full record, with company default for annual leave');

  const colleague = await ok(emp2, 'get_employee', { p_id: emp.id });
  assert.deepEqual(colleague, { id: emp.id, name: 'Ravi Driver', email: 'ravi@example.com', role: 'employee', full: false,
    designation: 'Driver', department: 'Transport', work_phone: '+971 50 111 2222' }, 'colleagues only see basics');
  const viaStaff = await ok(staff, 'get_employee', { p_id: emp.id });
  assert.equal(viaStaff.basic_salary, undefined, 'team members are not managers: basics only');

  const full = await ok(manager, 'get_employee', { p_id: emp.id });
  assert.equal(full.basic_salary, 3000);

  const dir = await ok(emp2, 'hr_directory');
  const ravi = dir.find(p => p.name === 'Ravi Driver');
  assert.deepEqual([ravi.designation, ravi.employee_no, ravi.joining_date], ['Driver', null, null]);
  assert.equal((await ok(manager, 'hr_directory')).find(p => p.name === 'Ravi Driver').employee_no, 'LC-007');

  const hr = await ok(manager, 'my_hr');
  assert.deepEqual(hr.expiringDocuments.map(d => [d.name, d.label]), [['Ravi Driver', 'Visa']], 'expired visa flagged for managers');
  assert.equal((await ok(emp, 'my_hr')).expiringDocuments, null);
});

test('attendance: at the office no remark; away or without location a remark is required', async () => {
  const away = await call(emp, 'attendance_sign', { p_action: 'in', p_lat: 25.3463, p_lng: 56.3517, p_accuracy: 20, p_remark: '' });
  assert.match(away.error.fields.remark, /about 995 m from the office/);
  const noLoc = await call(emp, 'attendance_sign', { p_action: 'in', p_lat: null, p_lng: null, p_accuracy: null, p_remark: null });
  assert.match(noLoc.error.fields.remark, /location isn't available/);

  const signedIn = await ok(emp, 'attendance_sign', { p_action: 'in', p_lat: 25.3463, p_lng: 56.3517, p_accuracy: 20,
    p_remark: 'Delivery at Sharjah port first' });
  assert.deepEqual([signedIn.in_at_office, signedIn.in_distance_m, signedIn.in_remark], [false, 995, 'Delivery at Sharjah port first']);
  assert.match((await call(emp, 'attendance_sign', { p_action: 'in', p_lat: OFFICE.lat, p_lng: OFFICE.lng, p_accuracy: 10, p_remark: null })).error.message,
    /already signed in today/);

  const out = await ok(emp, 'attendance_sign', { p_action: 'out', p_lat: 25.3465, p_lng: 56.3419, p_accuracy: 10, p_remark: null });
  assert.equal(out.out_at_office, true, '25 m away is inside the 200 m office radius');
  assert.ok(out.sign_out);
  assert.match((await call(emp2, 'attendance_sign', { p_action: 'out', p_lat: OFFICE.lat, p_lng: OFFICE.lng, p_accuracy: 5, p_remark: null })).error.message,
    /Sign in first/);
  await ok(emp2, 'attendance_sign', { p_action: 'in', p_lat: OFFICE.lat, p_lng: OFFICE.lng, p_accuracy: 5, p_remark: null });

  const mine = await ok(emp, 'my_attendance', {});
  assert.equal(mine.days.length, 1);
  assert.equal((await call(emp, 'my_attendance', { p_profile: emp2.id })).error.code, '42501', 'not someone else\'s');
  assert.equal((await call(staff, 'team_attendance', {})).error.code, '42501');

  const team = await ok(manager, 'team_attendance', {});
  const ravi = team.people.find(p => p.name === 'Ravi Driver');
  assert.deepEqual([ravi.in_at_office, ravi.in_remark, ravi.out_at_office], [false, 'Delivery at Sharjah port first', true]);
  assert.ok(team.people.find(p => p.name === 'Lina Clerk').sign_in);
  assert.equal(team.people.find(p => p.name === 'Sami Staff').sign_in, null);
});

test('managers correct attendance; late is after the work start time', async () => {
  const day = `${year}-01-14`;
  assert.equal((await call(staff, 'save_attendance', { p_profile: emp.id, p_date: day, p_in: '09:30', p_out: '18:00', p_note: null })).error.code, '42501');
  assert.deepEqual((await call(manager, 'save_attendance', { p_profile: emp.id, p_date: day, p_in: '18:00', p_out: '09:00', p_note: null })).error.fields,
    { out: 'Must be after the sign-in time' });
  await ok(manager, 'save_attendance', { p_profile: emp.id, p_date: day, p_in: '09:30', p_out: '18:00', p_note: 'Forgot to sign in' });
  await ok(manager, 'save_attendance', { p_profile: emp2.id, p_date: day, p_in: '08:55', p_out: null, p_note: null });
  const team = await ok(manager, 'team_attendance', { p_date: day });
  assert.equal(team.people.find(p => p.name === 'Ravi Driver').late, true);
  assert.equal(team.people.find(p => p.name === 'Ravi Driver').edit_note, 'Forgot to sign in');
  assert.equal(team.people.find(p => p.name === 'Lina Clerk').late, false);
  const rec = (await ok(emp, 'my_attendance', { p_month: day })).days[0];
  assert.match(rec.sign_in, /T05:30:00/, '09:30 Dubai time is 05:30 UTC');
  await ok(manager, 'save_attendance', { p_profile: emp2.id, p_date: day, p_in: '', p_out: '', p_note: null });
  assert.equal((await ok(emp2, 'my_attendance', { p_month: day })).days.length, 0, 'both empty removes the record');
});

test('leave: working days counted, balance checked, overlap refused, manager approval', async () => {
  // Thu 3 Dec to Mon 7 Dec 2026 style range in the current year: find a Thursday in March
  const thu = (() => { const d = new Date(Date.UTC(year, 2, 1)); while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1); return d; })();
  const iso = d => d.toISOString().slice(0, 10);
  const plus = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

  const id = await ok(emp, 'request_leave', { p_data: { kind: 'annual', start_date: iso(thu), end_date: iso(plus(thu, 4)), reason: 'Family visit' } });
  let sum = await ok(emp, 'leave_summary', {});
  assert.deepEqual(sum.annual, { entitled: 30, taken: 0, pending: 3, remaining: 27 }, 'Thu, Fri, Mon = 3 working days');
  assert.equal(sum.requests[0].days, 3);

  assert.deepEqual((await call(emp, 'request_leave', { p_data: { kind: 'medical', start_date: iso(plus(thu, 1)), end_date: iso(plus(thu, 1)) } })).error.fields,
    { start_date: 'You already have leave requested or approved on some of these days' });
  assert.deepEqual((await call(emp, 'request_leave', { p_data: { kind: 'annual', start_date: iso(plus(thu, 2)), end_date: iso(plus(thu, 3)) } })).error.fields,
    { end_date: 'Those dates are all weekend days' });
  assert.match((await call(emp, 'request_leave', { p_data: { kind: 'annual', start_date: `${year}-06-01`, end_date: `${year}-08-31` } })).error.fields.end_date,
    /That is \d+ days, but you only have 27 annual leave days left/);
  assert.match((await call(emp, 'request_leave', { p_data: { kind: 'annual', start_date: `${year}-12-30`, end_date: `${year + 1}-01-02` } })).error.fields.end_date,
    /can't cross into the next year/);

  // Only managers decide; they see the remaining balance with the request
  assert.equal((await call(staff, 'decide_leave', { p_id: id, p_approve: true, p_note: null })).error.code, '42501');
  const pending = await ok(manager, 'list_leave_requests', {});
  assert.deepEqual(pending.map(r => [r.name, r.days, r.remaining]), [['Ravi Driver', 3, 27]]);
  assert.deepEqual((await ok(emp2, 'list_leave_requests', {})), [], 'employees only see their own requests');
  await ok(manager, 'decide_leave', { p_id: id, p_approve: true, p_note: 'Enjoy' });
  sum = await ok(emp, 'leave_summary', {});
  assert.deepEqual(sum.annual, { entitled: 30, taken: 3, pending: 0, remaining: 27 });
  assert.deepEqual([sum.requests[0].status, sum.requests[0].decided_by_name, sum.requests[0].decision_note], ['approved', 'Maya Manager', 'Enjoy']);
  assert.match((await call(emp, 'cancel_leave', { p_id: id })).error.message, /only be cancelled by a manager/);

  // On leave shows in team attendance
  const team = await ok(manager, 'team_attendance', { p_date: iso(thu) });
  assert.equal(team.people.find(p => p.name === 'Ravi Driver').on_leave, 'annual');

  // Medical: reject, and withdrawing your own pending request
  const med = await ok(emp2, 'request_leave', { p_data: { kind: 'medical', start_date: `${year}-04-06`, end_date: `${year}-04-07`, reason: 'Flu' } });
  await ok(manager, 'decide_leave', { p_id: med, p_approve: false, p_note: 'Please attach a medical certificate and apply again' });
  const med2 = await ok(emp2, 'request_leave', { p_data: { kind: 'medical', start_date: `${year}-04-06`, end_date: `${year}-04-07` } });
  await ok(emp2, 'cancel_leave', { p_id: med2 });
  assert.deepEqual((await ok(emp2, 'leave_summary', {})).requests.map(r => r.status), ['cancelled', 'rejected'], 'newest first');
  assert.deepEqual((await ok(emp2, 'leave_summary', {})).medical, { entitled: 15, taken: 0, pending: 0, remaining: 15 });

  // A manager can't approve their own leave; an admin can approve theirs
  const own = await ok(manager, 'request_leave', { p_data: { kind: 'annual', start_date: `${year}-05-04`, end_date: `${year}-05-04` } });
  assert.match((await call(manager, 'decide_leave', { p_id: own, p_approve: true, p_note: null })).error.message, /Another manager or an administrator/);
  await ok(admin, 'decide_leave', { p_id: own, p_approve: true, p_note: null });
  assert.equal((await call(emp, 'leave_summary', { p_profile: manager.id })).error.code, '42501');
});

test('payslips: generated from the salary package, edited, published; employees see only their own published ones', async () => {
  const period = `${today.slice(0, 7)}-01`;
  assert.equal((await call(staff, 'generate_payslips', { p_period: period })).error.code, '42501');
  assert.equal(await ok(manager, 'generate_payslips', { p_period: period }), 3, 'Ravi, Lina and Sami have salaries');
  assert.equal(await ok(manager, 'generate_payslips', { p_period: period }), 0, 'no duplicates');

  const list = await ok(manager, 'list_payslips', { p_period: period });
  assert.deepEqual(list.payslips.map(p => [p.name, p.gross, p.status]),
    [['Lina Clerk', 2500, 'draft'], ['Ravi Driver', 4500, 'draft'], ['Sami Staff', 6000, 'draft']]);
  assert.deepEqual(list.missing.map(m => m.name).sort(), ['Aisha Admin', 'Maya Manager'], 'who has no payslip this month');

  const ravi = list.payslips.find(p => p.name === 'Ravi Driver').id;
  assert.deepEqual((await call(manager, 'save_payslip', { p_id: ravi, p_data: { basic_salary: 3000, deductions: 99999 } })).error.fields,
    { deductions: "Deductions can't be more than the total earnings" });
  await ok(manager, 'save_payslip', { p_id: ravi, p_data: { basic_salary: '3000', housing_allowance: '1000', transport_allowance: '500',
    overtime: '350.50', deductions: '200', deduction_note: 'Traffic fine' } });

  assert.deepEqual((await ok(emp, 'list_payslips', {})).payslips, [], 'drafts are not visible to the employee');
  assert.equal((await call(emp, 'get_payslip', { p_id: ravi })).error.code, 'P0002');
  await ok(manager, 'set_payslip_published', { p_id: ravi, p_published: true });

  const mine = await ok(emp, 'list_payslips', { p_period: period, p_profile: emp2.id });
  assert.deepEqual(mine.payslips.map(p => p.net), [4650.5], 'own published payslips only, whatever is asked for');
  const slip = await ok(emp, 'get_payslip', { p_id: ravi });
  assert.deepEqual([slip.payslip.gross, slip.payslip.net, slip.employee.employee_no, slip.company.legal_name],
    [4850.5, 4650.5, 'LC-007', 'Lowcaps']);
  assert.equal((await call(emp2, 'get_payslip', { p_id: ravi })).error.code, 'P0002', 'not someone else\'s payslip');
  assert.deepEqual((await ok(emp, 'my_hr')).payslips.map(p => p.net), [4650.5]);

  assert.match((await call(manager, 'save_payslip', { p_id: ravi, p_data: { basic_salary: 1 } })).error.message, /Unpublish it first/);
  assert.match((await call(manager, 'delete_payslip', { p_id: ravi })).error.message, /Unpublish/);
  const lina = list.payslips.find(p => p.name === 'Lina Clerk').id;
  await ok(manager, 'delete_payslip', { p_id: lina });
  assert.deepEqual((await call(manager, 'save_payslip', { p_id: null, p_data: { profile_id: emp.id, period } })).error.fields,
    { period: 'This employee already has a payslip for that month' });
  await ok(manager, 'save_payslip', { p_id: null, p_data: { profile_id: emp2.id, period, basic_salary: '2500', bonus: '300' } });
});
