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

async function newPage(errors, viewport = { width: 1300, height: 860 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
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

  // Sign out, then back in
  await admin.click('text=Sign out');
  await admin.waitForSelector('h1:text("Sign in")');
  await admin.fill('[name=email]', 'admin@lowcaps.test');
  await admin.fill('[name=password]', 'nope-nope-nope');
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
