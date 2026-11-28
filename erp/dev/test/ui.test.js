'use strict';

// Browser test of the ERP pages (index.html + app.js + the vendored supabase-js) against the
// local stand-in. Skipped if Playwright isn't installed.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { startLocalDb } = require('../local-db');
const { createStandIn } = require('../stand-in');

let playwright;
try { playwright = require('playwright'); } catch { /* optional */ }

const SHOTS = process.env.SCREENSHOT_DIR;

let db; let server; let base; let browser;

before(async () => {
  if (!playwright) return;
  db = await startLocalDb({ port: 54332 });
  const onSignup = user => db.pool.query(
    "update public.profiles set role = 'admin', active = true where id = $1 and not exists (select 1 from public.profiles where role = 'admin')",
    [user.id]);
  server = http.createServer(createStandIn({ pool: db.pool, minPasswordLength: 10, onSignup }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/erp/`;
  browser = await playwright.chromium.launch();
});

after(async () => {
  if (!playwright) return;
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await db.stop();
});

async function newPage(errors, viewport = { width: 1300, height: 860 }, contextOptions = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, ...contextOptions });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    // Failed RPCs are expected in some steps (validation errors, pending account); anything else is a bug.
    if (m.type() === 'error' && !/status of (400|401|403|404|422)/.test(m.text())) errors.push(m.text());
  });
  return page;
}

async function signUp(page, name, email) {
  await page.goto(base);
  await page.click('text=Create an account');
  await page.fill('[name=name]', name);
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', 'short');
  assert.equal(await page.$eval('[name=password]', el => el.checkValidity()), false, 'short password is refused by the form');
  await page.fill('[name=password]', 'demo-password-123');
  await page.click('button[type=submit]');
}

test('full flow: sign up, approve staff, customers, contacts, activity, export', { skip: !playwright }, async () => {
  const errors = [];
  const admin = await newPage(errors);

  await signUp(admin, 'Hisham M', 'admin@lowcaps.test');
  await admin.waitForSelector('text=Hello, Hisham');

  // Customer with validation error, then fixed
  await admin.click('text=+ New customer');
  await admin.fill('[name=name]', 'Gulf Traders LLC');
  await admin.fill('[name=email]', 'ops@gulftraders.ae');
  await admin.fill('[name=phone]', '+971 9 238 0000');
  await admin.fill('[name=city]', 'Khor Fakkan');
  await admin.fill('[name=trn]', '123');
  await admin.check('input[value=Shipping]');
  await admin.check('input[value=Customs]');
  await admin.click('button[type=submit]');
  await admin.waitForSelector('.field.invalid >> text=TRN must be 15 digits');
  await admin.fill('[name=trn]', '100123456789012');
  await admin.selectOption('[name=status]', 'active');
  await admin.click('button[type=submit]');
  await admin.waitForSelector('h2:text("Contacts")');
  assert.ok(await admin.isVisible('dd:text("Shipping, Customs")'));

  // Contact and activity
  await admin.click('text=+ Add');
  await admin.fill('dialog [name=name]', 'Omar Khalid');
  await admin.fill('dialog [name=job_title]', 'Logistics manager');
  await admin.fill('dialog [name=phone]', '+971 50 123 4567');
  await admin.check('dialog [name=is_primary]');
  await admin.click('dialog button[type=submit]');
  await admin.waitForSelector('.list strong:text("Omar Khalid")');

  await admin.fill('[name=body]', 'Called about LCL rates from Jebel Ali to Khor Fakkan.');
  await admin.click('text=Save entry');
  await admin.waitForSelector('.list .body:text("Called about LCL")');
  await admin.click('.tabs button:text("Follow-up")');
  await admin.fill('[name=body]', 'Send customs clearance quote');
  await admin.fill('[name=due_at]', '2099-11-20');
  await admin.click('text=Save entry');
  await admin.waitForSelector('text=Due 20 Nov 2099');
  await admin.click('button:text("Mark done")');
  await admin.waitForSelector('button:text("Reopen")');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/customer.png`, fullPage: true });

  // List, search and CSV export
  await admin.goto(base + '#/customers');
  await admin.waitForSelector('a.row-link:text("Gulf Traders LLC")');
  await admin.fill('input[name=q]', 'omar');
  await admin.waitForFunction(() => location.hash.includes('q=omar'));
  await admin.waitForSelector('a.row-link:text("Gulf Traders LLC")');
  const [download] = await Promise.all([admin.waitForEvent('download'), admin.click('button:text("Export CSV")')]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  assert.match(csv, /^﻿ID,Name,Type,Status,TRN/);
  assert.match(csv, /Gulf Traders LLC,company,active,100123456789012,ops@gulftraders\.ae,\+971 9 238 0000/);
  if (SHOTS) {
    await admin.goto(base + '#/customers');
    await admin.waitForSelector('a.row-link');
    await admin.screenshot({ path: `${SHOTS}/list.png` });
  }

  // A staff member signs up and waits for approval
  const staff = await newPage(errors, { width: 390, height: 800 });
  await signUp(staff, 'Sami Staff', 'sami@lowcaps.test');
  await staff.waitForSelector('text=Waiting for access');
  if (SHOTS) await staff.screenshot({ path: `${SHOTS}/pending.png` });

  await admin.goto(base + '#/users');
  await admin.waitForSelector('text=1 account without access');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/users.png` });
  await admin.click('button:text("Give access")');
  await admin.waitForSelector('text=Sami Staff now has access');

  await staff.click('text=Check again');
  await staff.waitForSelector('text=Hello, Sami');
  // Staff can see the customer but not delete it, and the Users page isn't offered
  await staff.goto(base + '#/customers');
  await staff.click('a.row-link:text("Gulf Traders LLC")');
  await staff.waitForSelector('h1:text("Gulf Traders LLC")');
  assert.equal(await staff.isVisible('button:text("Delete")'), false, 'no Delete customer button for staff');

  // Dashboard and account page
  await admin.goto(base + '#/');
  await admin.waitForSelector('text=Recent activity');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/dashboard.png` });
  await admin.goto(base + '#/account');
  await admin.fill('[name=current]', 'wrong-password-1');
  await admin.fill('[name=password]', 'another-password-9');
  await admin.click('button:text("Change password")');
  await admin.waitForSelector('text=Current password is wrong');

  // Log out, then back in
  await admin.click('text=Log out');
  await admin.waitForSelector('h1:text("Sign in")');
  await admin.fill('[name=email]', 'admin@lowcaps.test');
  await admin.fill('[name=password]', 'nope-nope-nope');
  // The eye button shows the password, and hides it again
  await admin.click('button[aria-label="Show password"]');
  assert.equal(await admin.getAttribute('[name=password]', 'type'), 'text');
  assert.equal(await admin.inputValue('[name=password]'), 'nope-nope-nope');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/login-eye.png` });
  await admin.click('button[aria-label="Hide password"]');
  assert.equal(await admin.getAttribute('[name=password]', 'type'), 'password');
  await admin.click('button[type=submit]');
  await admin.waitForSelector('text=Incorrect email or password');
  await admin.fill('[name=password]', 'demo-password-123');
  await admin.click('button[type=submit]');
  await admin.waitForSelector('text=Hello, Hisham');

  const overflow = await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'no sideways scrolling on a phone');
  assert.deepEqual(errors, []);
});

test('shows setup instructions when config.js has not been filled in', { skip: !playwright }, async () => {
  const errors = [];
  const page = await newPage(errors);
  await page.route('**/erp/config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: "window.LOWCAPS_CONFIG = { supabaseUrl: 'https://YOUR-PROJECT.supabase.co', supabaseKey: 'YOUR-ANON-KEY' };",
  }));
  await page.goto(base);
  await page.waitForSelector('text=Connect the ERP to Supabase');
  assert.deepEqual(errors, []);
});

async function signIn(page, email) {
  await page.goto(base + '#/login');
  await page.waitForSelector('h1:text("Sign in")');
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', 'demo-password-123');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Hello,');
}

test('tasks: a manager assigns work, the team member updates it', { skip: !playwright }, async () => {
  const errors = [];
  const admin = await newPage(errors);
  const staff = await newPage(errors);
  await signIn(admin, 'admin@lowcaps.test');
  await signIn(staff, 'sami@lowcaps.test');

  // Team members don't see the manager-only menu or buttons
  assert.equal(await staff.isVisible('a[href="#/work-types"]'), false);
  await staff.goto(base + '#/tasks');
  await staff.waitForSelector('h1:text("Tasks")');
  assert.equal(await staff.isVisible('text=+ New task'), false);

  // Manager-only: add a type of work
  await admin.goto(base + '#/work-types');
  await admin.fill('[name=name]', 'Warehousing');
  await admin.click('button:text("Add type of work")');
  await admin.waitForSelector('a.row-link:text("Warehousing")');

  // Create a task from the customer page, assigned to Sami
  await admin.goto(base + '#/customers');
  await admin.click('a.row-link:text("Gulf Traders LLC")');
  await admin.click('a:text("+ New task")');
  await admin.waitForSelector('h1:text("New task")');
  assert.equal(await admin.$eval('[name=customer_id]', el => el.selectedOptions[0].textContent), 'Gulf Traders LLC');
  await admin.fill('[name=title]', 'Clear container MSKU1234567');
  await admin.selectOption('[name=work_type_id]', { label: 'Customs clearance' });
  await admin.selectOption('[name=assigned_to]', { label: 'Sami Staff' });
  await admin.fill('[name=due_date]', '2020-01-15');
  await admin.selectOption('[name=priority]', 'urgent');
  await admin.fill('[name=description]', 'BL no. MEDU123456. Customer sends invoice + packing list.');
  await admin.uncheck('[name=make_proforma]');
  await admin.click('button:text("Create task")');
  await admin.waitForSelector('text=Assigned to Sami Staff');
  assert.ok(await admin.isVisible('text=Overdue · 15 Jan 2020'));

  // Sami sees it on the dashboard and moves it along
  await staff.goto(base + '#/');
  await staff.click('.list a.row-link:text("Clear container MSKU1234567")');
  await staff.waitForSelector('h2:text("Status")');
  assert.equal(await staff.isVisible('a:text("Edit")'), false, 'team members cannot edit the task itself');
  await staff.selectOption('[name=status]', 'waiting');
  await staff.fill('[name=note]', 'Waiting for the packing list');
  await staff.click('button:text("Update status")');
  await staff.waitForSelector('strong:text("New → Waiting")');
  await staff.fill('[name=body]', 'Customer says it arrives tomorrow');
  await staff.click('button:text("Post comment")');
  await staff.waitForSelector('.list .body:text("Customer says it arrives tomorrow")');
  if (SHOTS) await staff.screenshot({ path: `${SHOTS}/task.png`, fullPage: true });

  // Manager sees it in the task list, filtered
  await admin.goto(base + '#/tasks?assignee=me');
  await admin.waitForSelector('text=No tasks match these filters.');
  await admin.goto(base + '#/tasks');
  await admin.waitForSelector('a.row-link:text("Clear container MSKU1234567")');
  assert.ok(await admin.isVisible('td .badge:text("Waiting")'));
  assert.ok(await admin.isVisible('td .badge:text("Urgent")'));
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/tasks.png` });

  // Promote Sami to manager: the manager tools appear for him
  await admin.goto(base + '#/users');
  await admin.click('tr:has-text("Sami Staff") button:text("Edit")');
  await admin.selectOption('dialog [name=role]', 'manager');
  await admin.click('dialog button[type=submit]');
  await admin.waitForSelector('td:text("Manager")');
  await staff.goto(base + '#/');
  await staff.reload();
  await staff.waitForSelector('a[href="#/work-types"]');
  if (SHOTS) {
    await admin.goto(base + '#/');
    await admin.waitForSelector('h2:text("My tasks")');
    await admin.screenshot({ path: `${SHOTS}/dashboard-tasks.png` });
  }
  assert.deepEqual(errors, []);
});

test('invoices: proforma when the task is created, tax invoice when it is done', { skip: !playwright }, async () => {
  const errors = [];
  const admin = await newPage(errors);
  await admin.context().route('https://mail.google.com/**', route => route.fulfill({ contentType: 'text/html', body: 'gmail' }));
  await signIn(admin, 'admin@lowcaps.test');

  // Company details (with TRN) for the invoices
  await admin.goto(base + '#/settings');
  await admin.fill('[name=legal_name]', 'Lowcaps Logistics LLC');
  await admin.fill('[name=address]', 'Office 4, Port Road\nKhor Fakkan, Sharjah, UAE');
  await admin.fill('[name=phone]', '+971 9 000 0000');
  await admin.fill('[name=trn]', '100111222333444');
  await admin.fill('[name=bank_name]', 'Example Bank');
  await admin.fill('[name=account_name]', 'Lowcaps Logistics LLC');
  await admin.fill('[name=iban]', 'AE07 0331 2345 6789 0123 456');
  await admin.click('button:text("Save")');
  await admin.waitForSelector('text=Company settings saved');

  // New task for a customer -> straight on to the proforma
  await admin.goto(base + '#/tasks/new');
  await admin.fill('[name=title]', 'Import 1x40ft MSCU7654321');
  await admin.selectOption('[name=customer_id]', { label: 'Gulf Traders LLC' });
  await admin.selectOption('[name=work_type_id]', { label: 'Sea freight' });
  assert.equal(await admin.isChecked('[name=make_proforma]'), true);
  await admin.click('button:text("Create task")');
  await admin.waitForSelector('h1:text("New proforma invoice")');
  assert.equal(await admin.inputValue('.l-desc'), 'Sea freight: Import 1x40ft MSCU7654321');
  await admin.selectOption('.l-vat', 'zero');
  await admin.fill('.l-price', '2500');
  await admin.click('button:text("+ Add line")');
  await admin.locator('.l-desc').nth(1).fill('Customs clearance fee');
  await admin.locator('.l-price').nth(1).fill('350');
  await admin.waitForSelector('.inv-form-totals dd.grand:text("AED 2,867.50")');
  await admin.click('button:text("Create proforma invoice")');
  await admin.waitForSelector('.inv-title:text("PROFORMA INVOICE")');
  const proNumber = await admin.textContent('h1');
  assert.match(proNumber, /^PRO-\d{4}-0001$/);
  assert.ok(await admin.isVisible('.inv-billto >> text=Gulf Traders LLC'));
  assert.ok(await admin.isVisible('.inv-totals dd.grand:text("AED 2,867.50")'));

  // PDF download
  const [pdf] = await Promise.all([admin.waitForEvent('download'), admin.click('button:text("PDF")')]);
  assert.equal(pdf.suggestedFilename(), `${proNumber}.pdf`);
  const bytes = fs.readFileSync(await pdf.path());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 3000);
  assert.match(bytes.toString('latin1'), /PROFORMA INVOICE/);

  // Email: Gmail opens pre-filled, then mark as sent
  await admin.click('button:text("Email to customer")');
  assert.equal(await admin.inputValue('dialog [name=to]'), 'ops@gulftraders.ae');
  assert.match(await admin.inputValue('dialog [name=body]'), /Total: AED 2,867\.50 \(including VAT of AED 17\.50\)/);
  const [gmail] = await Promise.all([admin.context().waitForEvent('page'), admin.click('dialog button:text("Open in Gmail")')]);
  const gmailUrl = new URL(gmail.url());
  assert.equal(gmailUrl.searchParams.get('to'), 'ops@gulftraders.ae');
  assert.equal(gmailUrl.searchParams.get('su'), `Proforma Invoice ${proNumber} from Lowcaps Logistics LLC`);
  await gmail.close();
  await admin.click('dialog button:text("I\'ve sent it")');
  await admin.waitForSelector('.crumbs .badge:text("Sent")');
  assert.equal(await admin.isVisible('a:text("Edit")'), false, 'sent invoices cannot be edited');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/proforma.png`, fullPage: true });

  // Finish the task -> create the tax invoice from the proforma
  await admin.click('.crumbs a');
  await admin.waitForSelector('h2:text("Invoices")');
  await admin.click('button:text("✓ Mark as complete")');
  await admin.waitForSelector('text=This task is complete. Send the customer the final tax invoice.');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/task-invoices.png`, fullPage: true });
  await admin.click('.notice a:text("Create tax invoice")');
  await admin.waitForSelector('h1:text("New tax invoice")');
  assert.equal(await admin.locator('.l-desc').count(), 2, 'charges copied from the proforma');
  await admin.locator('.l-price').nth(1).fill('400');
  await admin.click('button:text("+ Add line")');
  await admin.locator('.l-desc').nth(2).fill('Customs duty paid on your behalf');
  await admin.locator('.l-price').nth(2).fill('1200');
  await admin.locator('.l-vat').nth(2).selectOption('out_of_scope');
  await admin.waitForSelector('.inv-form-totals dd.grand:text("AED 4,120.00")');
  await admin.click('button:text("Create tax invoice")');
  await admin.waitForSelector('.inv-title:text("TAX INVOICE")');
  assert.match(await admin.textContent('h1'), /^INV-\d{4}-0001$/);
  assert.ok(await admin.isVisible(`.inv-meta dd:text("${proNumber}")`), 'refers to the proforma');
  assert.ok(await admin.isVisible('.inv-head >> text=TRN: 100111222333444'));
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/tax-invoice.png`, fullPage: true });
  await admin.click('button:text("Email to customer")');
  await admin.click('dialog button:text("I\'ve sent it")');
  // Part payment by cash, then the rest by cheque; a bounced cheque re-opens the balance
  await admin.click('button:text("Record payment")');
  assert.equal(await admin.inputValue('dialog [name=amount]'), '4120.00', 'defaults to the full balance');
  await admin.fill('dialog [name=amount]', '1000');
  await admin.selectOption('dialog [name=method]', 'cash');
  await admin.click('dialog button:text("Save payment")');
  await admin.waitForSelector('text=Payment saved. Balance now AED 3,120.00');
  await admin.waitForSelector('.crumbs .badge:text("Partly paid")');
  assert.ok(await admin.isVisible('.inv-totals dd.grand:text("AED 3,120.00")'), 'balance due shown on the invoice');
  await admin.click('button:text("+ Record payment")');
  await admin.selectOption('dialog [name=method]', 'cheque');
  await admin.click('dialog button:text("Save payment")');
  assert.equal(await admin.$eval('dialog [name=reference]', el => el.checkValidity()), false, 'cheque number is required');
  await admin.fill('dialog [name=reference]', '000123');
  await admin.fill('dialog [name=cheque_bank]', 'Example Bank');
  await admin.click('dialog button:text("Save payment")');
  await admin.waitForSelector('text=Payment saved. Invoice fully paid');
  await admin.waitForSelector('.crumbs .badge:text("Paid")');
  assert.ok(await admin.isVisible('.badge:text("Not cleared yet")'));
  admin.once('dialog', d => d.accept());
  await admin.click('button:text("Bounced")');
  await admin.waitForSelector('.crumbs .badge:text("Partly paid")');
  await admin.click('button:text("Cleared")');
  await admin.waitForSelector('.crumbs .badge:text("Paid")');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/invoice-payments.png`, fullPage: true });
  await admin.goto(base + '#/payments');
  await admin.waitForSelector('h1:text("Payments")');
  assert.equal(await admin.locator('tbody tr').count(), 2);
  assert.ok(await admin.isVisible('text=AED 4,120.00 received'));

  // Invoices list and dashboard
  await admin.goto(base + '#/invoices');
  await admin.waitForSelector('td .badge:text("Paid")');
  assert.equal(await admin.locator('tbody tr').count(), 2);
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/invoices.png` });
  await admin.goto(base + '#/');
  await admin.waitForSelector('h2:text("Ready to invoice")');
  assert.ok(await admin.isVisible('text=Every finished task has a tax invoice.'));
  assert.deepEqual(errors, []);
});

test('renewals: add for a customer, see it due, remind, renew, turn into a task', { skip: !playwright }, async () => {
  const errors = [];
  const admin = await newPage(errors);
  await admin.context().route('https://mail.google.com/**', route => route.fulfill({ contentType: 'text/html', body: 'gmail' }));
  await signIn(admin, 'admin@lowcaps.test');
  const today = await admin.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const inDays = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  // Add a trade license renewal from the customer's page; the type fills in its usual period and reminder
  await admin.goto(base + '#/customers');
  await admin.click('a.row-link:text("Gulf Traders LLC")');
  await admin.click('a:text("+ Add renewal")');
  await admin.waitForSelector('h1:text("Add renewal")');
  assert.equal(await admin.$eval('[name=customer_id]', el => el.selectedOptions[0].textContent), 'Gulf Traders LLC');
  await admin.selectOption('[name=type_id]', { label: 'Trade license renewal' });
  assert.equal(await admin.inputValue('[name=interval_months]'), '12');
  assert.equal(await admin.inputValue('[name=remind_days]'), '30');
  await admin.fill('[name=reference]', 'License no. 12345');
  await admin.fill('[name=due_date]', inDays(20));
  await admin.click('button:text("Add renewal")');
  await admin.waitForSelector('h1:text("Trade license renewal")');
  assert.ok(await admin.isVisible('.badge:text("Due in 20 days")'));

  // A VAT return that is already overdue
  await admin.goto(base + '#/renewals/new');
  await admin.selectOption('[name=customer_id]', { label: 'Gulf Traders LLC' });
  await admin.selectOption('[name=type_id]', { label: 'VAT return filing' });
  assert.equal(await admin.inputValue('[name=interval_months]'), '3');
  await admin.fill('[name=reference]', 'Q3 return');
  await admin.fill('[name=due_date]', inDays(-2));
  await admin.click('button:text("Add renewal")');
  await admin.waitForSelector('.badge:text("Overdue by 2 days")');

  // Both show on the dashboard, overdue first
  await admin.goto(base + '#/');
  await admin.waitForSelector('h2:text("Renewals due")');
  const due = await admin.locator('section:has(h2:text("Renewals due")) a.row-link').allTextContents();
  assert.deepEqual(due, ['VAT return filing · Q3 return', 'Trade license renewal · License no. 12345']);
  assert.ok(await admin.isVisible('.badge:text("1 overdue")'));
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/dashboard-renewals.png` });

  // Remind the customer by email, then renew: the due date moves on 3 months
  await admin.click('a.row-link:text("VAT return filing · Q3 return")');
  await admin.click('button:text("Remind customer")');
  assert.equal(await admin.inputValue('dialog [name=to]'), 'ops@gulftraders.ae');
  assert.match(await admin.inputValue('dialog [name=subject]'), /^Reminder: VAT return filing \(Q3 return\) due /);
  assert.match(await admin.inputValue('dialog [name=body]'), /friendly reminder that the vat return filing for Q3 return is due on/);
  const [gmail] = await Promise.all([admin.context().waitForEvent('page'), admin.click('dialog button:text("Open in Gmail")')]);
  await gmail.close();
  await admin.click('dialog button:text("I\'ve sent it")');
  await admin.waitForSelector('strong:text("Reminded ops@gulftraders.ae")');

  await admin.click('button:text("✓ Mark as renewed")');
  const suggested = await admin.inputValue('dialog [name=new_due]');
  const expected = await admin.evaluate(([d]) => addMonths(d, 3), [inDays(-2)]);
  assert.equal(suggested, expected, 'next due date suggested 3 months on');
  await admin.fill('dialog [name=note]', 'Filed on the FTA portal');
  await admin.click('dialog button:text("Save")');
  await admin.waitForSelector('strong:text("Renewed:")');
  assert.ok(await admin.isVisible('text=Filed on the FTA portal'));
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/renewal.png`, fullPage: true });

  // Turn the license renewal into a task for the team
  await admin.goto(base + '#/renewals');
  await admin.waitForSelector('a.row-link:text("Trade license renewal")');
  assert.equal(await admin.locator('tbody tr').count(), 1, 'the renewed VAT return is no longer due');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/renewals.png` });
  await admin.click('a.row-link:text("Trade license renewal")');
  await admin.click('button:text("Create task")');
  await admin.waitForSelector('h1:text("Trade license renewal: License no. 12345")');
  assert.ok(await admin.isVisible('a:text("Gulf Traders LLC")'));

  // Managers see renewal types on the Types page
  await admin.goto(base + '#/work-types');
  await admin.waitForSelector('h2:text("Renewal types")');
  assert.ok(await admin.isVisible('td:text("Every 2 years")'));
  assert.deepEqual(errors, []);
});

test('payments: an overdue balance shows on the dashboard and customer, with a payment reminder', { skip: !playwright }, async () => {
  const errors = [];
  const admin = await newPage(errors);
  await admin.context().route('https://mail.google.com/**', route => route.fulfill({ contentType: 'text/html', body: 'gmail' }));
  await signIn(admin, 'admin@lowcaps.test');
  const today = await admin.evaluate(() => new Date().toLocaleDateString('en-CA'));
  const inDays = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  // A tax invoice that was due 10 days ago, half paid
  await admin.goto(base + '#/invoices/new?kind=tax');
  await admin.selectOption('[name=customer_id]', { label: 'Gulf Traders LLC' });
  await admin.fill('[name=issue_date]', inDays(-40));
  await admin.fill('[name=due_date]', inDays(-10));
  await admin.fill('.l-desc', 'Warehousing, October');
  await admin.fill('.l-price', '1000');
  await admin.click('button:text("Create tax invoice")');
  await admin.waitForSelector('.inv-title:text("TAX INVOICE")');
  const number = await admin.textContent('h1');
  await admin.click('button:text("Email to customer")');
  await admin.click('dialog button:text("I\'ve sent it")');
  await admin.waitForSelector('.crumbs .badge:text("Overdue · 10 days")');
  await admin.click('button:text("Record payment")');
  await admin.fill('dialog [name=amount]', '525');
  await admin.click('dialog [name=reference]');
  await admin.fill('dialog [name=reference]', 'FT-998877');
  await admin.click('dialog button:text("Save payment")');
  await admin.waitForSelector('text=Payment saved. Balance now AED 525.00');
  await admin.waitForSelector('.pay-summary .is-overdue dd:text("AED 525.00")');
  assert.ok(await admin.isVisible('.pay-summary .is-overdue dt:text("Balance · overdue 10 days")'));

  // Payment reminder by email
  await admin.click('button:text("Payment reminder")');
  assert.match(await admin.inputValue('dialog [name=subject]'), new RegExp(`^Payment reminder: ${number} \\(balance AED 525\\.00\\)$`));
  assert.match(await admin.inputValue('dialog [name=body]'), /has a balance of AED 525\.00/);
  const [gmail] = await Promise.all([admin.context().waitForEvent('page'), admin.click('dialog button:text("Open in Gmail")')]);
  await gmail.close();
  await admin.click('dialog button:text("I\'ve sent it")');
  await admin.waitForSelector('text=Payment reminder sent');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/invoice-overdue.png`, fullPage: true });

  // Dashboard, customer page and the overdue filter
  await admin.goto(base + '#/');
  await admin.waitForSelector('h2:text("Money owed to us")');
  assert.ok(await admin.isVisible(`section:has(h2:text("Money owed to us")) a.row-link:text("${number}")`));
  assert.ok(await admin.isVisible('.badge:text("10 days late")'));
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/dashboard-money.png`, fullPage: true });
  await admin.goto(base + '#/customers');
  await admin.click('a.row-link:text("Gulf Traders LLC")');
  await admin.waitForSelector('dt:text("Balance owed")');
  assert.ok(await admin.isVisible('.badge:text("AED 525.00 overdue")'));
  await admin.goto(base + '#/invoices?status=overdue');
  await admin.waitForSelector(`tbody a.row-link:text("${number}")`);
  assert.equal(await admin.locator('tbody tr').count(), 1);
  assert.deepEqual(errors, []);
});

test('HR: employee role, sign in with remark when away, leave approval, payslips, private details', { skip: !playwright }, async () => {
  const errors = [];
  const OFFICE = { latitude: 25.3463, longitude: 56.3418 };
  const AWAY = { latitude: 25.3463, longitude: 56.3517 };   // about 1 km east
  const admin = await newPage(errors);
  await signIn(admin, 'admin@lowcaps.test');

  // Admin: office location for attendance
  await admin.goto(base + '#/settings');
  await admin.waitForSelector('h2:text("HR: office, working hours and leave")');
  await admin.fill('[name=office_lat]', String(OFFICE.latitude));
  await admin.fill('[name=office_lng]', String(OFFICE.longitude));
  await admin.click('button:text("Save HR settings")');
  await admin.waitForSelector('text=HR settings saved');

  // A new person signs up and is given the Employee (HR only) role
  const emp = await newPage(errors, { width: 390, height: 844 }, { geolocation: AWAY, permissions: ['geolocation'] });
  await signUp(emp, 'Ravi Driver', 'ravi@lowcaps.test');
  await emp.waitForSelector('text=Waiting for access');
  await admin.goto(base + '#/users');
  await admin.click('tr:has-text("Ravi Driver") button:text("Give access")');
  await admin.waitForSelector('text=Ravi Driver now has access');
  await admin.click('tr:has-text("Ravi Driver") button:text("Edit")');
  await admin.selectOption('dialog [name=role]', 'employee');
  await admin.click('dialog button[type=submit]');
  await admin.waitForSelector('td:text("Employee (HR only)")');

  // Manager fills in the HR record
  await admin.goto(base + '#/hr/people');
  await admin.click('a.row-link:text("Ravi Driver")');
  await admin.click('a:text("Edit record")');
  await admin.fill('[name=employee_no]', 'LC-007');
  await admin.fill('[name=designation]', 'Driver');
  await admin.fill('[name=department]', 'Transport');
  await admin.fill('[name=joining_date]', '2024-03-01');
  await admin.fill('[name=passport_no]', 'Z1234567');
  await admin.fill('[name=basic_salary]', '3000');
  await admin.fill('[name=housing_allowance]', '1000');
  await admin.click('button:text("Save")');
  await admin.waitForSelector('text=Employee record saved');
  assert.ok(await admin.isVisible('strong:text("AED 4,000.00 / month")'));

  // The employee only sees HR; signing in 1 km away needs a remark
  await emp.click('text=Check again');
  await emp.waitForSelector('h2:text("Today,")');
  assert.equal(await emp.locator('.sidebar a[href="#/customers"]').count(), 0, 'no Customers link for employees');
  await emp.goto(base + '#/customers');
  await emp.waitForSelector('h2:text("Today,")');
  assert.match(emp.url(), /#\/hr$/, 'redirected back to HR');
  await emp.click('button:text("Sign in")');
  await emp.waitForSelector('dialog >> text=from the office');
  assert.match(await emp.textContent('dialog'), /about 995 m from the office/);
  await emp.fill('dialog [name=remark]', 'Delivery at Sharjah port first');
  await emp.click('dialog button:text("Sign in")');
  await emp.waitForSelector('.attendance-status:text("Signed in at")');
  assert.ok(await emp.isVisible('text=Remark: Delivery at Sharjah port first'));
  if (SHOTS) await emp.screenshot({ path: `${SHOTS}/hr-employee.png`, fullPage: true });
  // Back at the office: sign out without a remark
  await emp.context().setGeolocation(OFFICE);
  await emp.click('button:text("Sign out")');
  await emp.waitForSelector('.attendance-status:text("signed out")');
  assert.equal(await emp.locator('dialog').count(), 0);

  // Leave request: Thursday to Monday = 3 working days
  const thu = await emp.evaluate(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 1);
    while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
    const mon = new Date(d); mon.setDate(mon.getDate() + 4);
    return [d.toLocaleDateString('en-CA'), mon.toLocaleDateString('en-CA')];
  });
  await emp.goto(base + '#/hr/leave');
  await emp.fill('[name=start_date]', thu[0]);
  await emp.fill('[name=end_date]', thu[1]);
  await emp.dispatchEvent('[name=end_date]', 'change');
  await emp.waitForSelector('text=3 working days (weekends not counted). You have 30 annual leave days left.');
  await emp.fill('[name=reason]', 'Family visit');
  await emp.click('button:text("Send request")');
  await emp.waitForSelector('text=Leave requested');
  await emp.waitForSelector('.badge:text("Waiting for approval")');

  // Colleagues' details are basic only; own record is full
  await emp.goto(base + '#/hr/people');
  await emp.click('a.row-link:text("Hisham M")');
  await emp.waitForSelector('h2:text("Contact")');
  assert.equal(await emp.locator('h2:text("Salary and bank")').count(), 0, 'no salary for colleagues');
  await emp.goto(base + '#/hr/people/me');
  await emp.waitForSelector('h2:text("Salary and bank")');
  assert.ok(await emp.isVisible('dd:text("Z1234567")'));

  // Manager approves; team attendance shows where Ravi signed in from
  await admin.goto(base + '#/');
  await admin.waitForSelector('a:text("1 leave request is waiting for approval")');
  await admin.click('a:text("1 leave request is waiting for approval")');
  await admin.click('li:has-text("Ravi Driver") button:text("Approve")');
  await admin.click('dialog button:text("Approve")');
  await admin.waitForSelector('text=Leave approved');
  if (SHOTS) {
    await admin.selectOption('[name=status]', '');
    await admin.waitForSelector('.badge:text("Approved")');
    await admin.screenshot({ path: `${SHOTS}/hr-leave.png`, fullPage: true });
  }
  await admin.goto(base + '#/hr/attendance');
  await admin.waitForSelector('h1:text("Team attendance")');
  const row = admin.locator('tr:has-text("Ravi Driver")');
  assert.ok(await row.locator('text=995 m away').isVisible());
  assert.ok(await row.locator('text=Remark: Delivery at Sharjah port first').isVisible());
  assert.ok(await row.locator('.badge:text("At office")').isVisible(), 'signed out at the office');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/hr-attendance.png`, fullPage: true });

  // Payslips: create from salary packages, publish, employee downloads the PDF
  await admin.goto(base + '#/hr/payslips');
  await admin.click('button:text("Create payslips for this month")');
  await admin.waitForSelector('text=1 draft payslip created from salary packages');
  await admin.click('tr:has-text("Ravi Driver") button:text("Edit")');
  await admin.fill('dialog [name=overtime]', '250');
  await admin.fill('dialog [name=deductions]', '100');
  await admin.fill('dialog [name=deduction_note]', 'Traffic fine');
  await admin.click('dialog button:text("Save")');
  await admin.waitForSelector('td:text("AED 4,150.00")');
  admin.once('dialog', d => d.accept());
  await admin.click('button:text("Publish all drafts")');
  await admin.waitForSelector('.badge:text("Published")');
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/hr-payslips.png` });

  await emp.goto(base + '#/hr/payslips');
  await emp.click('.list a.row-link');
  await emp.waitForSelector('.inv-title:text("PAYSLIP")');
  assert.ok(await emp.isVisible('dd.grand:text("AED 4,150.00")'));
  const [pdf] = await Promise.all([emp.waitForEvent('download'), emp.click('button:text("Download PDF")')]);
  assert.match(pdf.suggestedFilename(), /^Payslip-\d{4}-\d{2}-Ravi-Driver\.pdf$/);
  const bytes = fs.readFileSync(await pdf.path());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  if (SHOTS) await emp.screenshot({ path: `${SHOTS}/hr-payslip.png`, fullPage: true });

  const overflow = await emp.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'no sideways scrolling on a phone');
  assert.deepEqual(errors, []);
});
