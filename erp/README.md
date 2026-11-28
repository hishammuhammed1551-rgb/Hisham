# Lowcaps ERP

Internal system for the Lowcaps team. **Version 0.9 has Customers (CRM), Tasks, Invoices, Payments, Renewals, HR and Finance (phase 1: general ledger; phase 2: payables and VAT)**; expenses and reports are planned next and already appear in the menu as "Soon".

It runs on **Supabase** (database and sign-in) and **GitHub Pages** (the pages), both free. There is no server to run or maintain.

**To put it online, follow [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md).**

## What it does

- **Accounts and roles.** People create their own account; it has no access until an administrator approves it under **Users**, where admins also set each person's role or take access away (effective immediately):
  - **Team member:** sees everything, adds and edits leads and customers, logs activity, comments on any task, and moves the status of tasks assigned to them.
  - **Manager:** everything a team member can do, plus creating, assigning, editing and deleting tasks, managing the **Types of work** list, and deleting customers.
  - **Administrator:** everything, plus managing users.
  - **Employee (HR only):** only the HR section: their own attendance, leave, payslips and record, and colleagues' basic contact details.
- **Tasks.** A manager creates a task (title, customer, type of work, description, due date, priority) and assigns it to someone. It moves through New → In progress → Waiting → Done (or Cancelled), with a history of comments, status changes and re-assignments. Tasks show on a Tasks page (filter by status, person, type of work), on each customer's page, and as **My tasks** on the dashboard.
- **Invoices.** When a manager creates a task for a customer, the ERP goes straight on to a **proforma invoice** (`PRO-2026-0001`). When the task is marked complete, its page and the dashboard prompt for the final **tax invoice** (`INV-2026-0001`), pre-filled from the proforma's charges.
  - Each charge line is 5% VAT, 0% (zero-rated, e.g. international transport), exempt, or no VAT (disbursements such as customs duty paid on the customer's behalf). Totals and VAT are calculated in the database.
  - Invoices are downloaded as PDF (built in the browser) and emailed from your own mailbox: **Email to customer** opens Gmail or your email app with the customer's address, subject and message filled in; attach the PDF, send, then click **I've sent it**.
  - Status: Draft → Sent → Paid, or Cancelled. Sent invoices can't be edited; cancel and re-issue instead. Numbers are never reused and restart each year.
- **Payments.** Managers record money received against an invoice by **bank transfer, cash or cheque**, in full or in parts; the invoice shows Total / Paid / Balance and turns **Paid** by itself when the balance reaches zero.
  - Cheques (including post-dated) keep their number, bank and date, and are marked **Cleared** or **Bounced**; a bounced cheque puts the amount back on the balance.
  - Payments taken against a proforma (advances) move to the tax invoice when it's created.
  - A tax invoice with a balance after its due date shows as **Overdue** (in red, with days late) on the invoice, the invoice list, the customer's page and the dashboard's **Money owed to us**; **Payment reminder** emails the customer from your own mailbox with the PDF showing the balance due.
  - The **Payments** page lists everything received, with filters for method and for cheques not yet cleared.
  - Lowcaps' name, address, TRN and bank details come from **Company settings** (admins) and are copied onto each invoice when it's saved. Tax invoices can't be created until the TRN is filled in.
  - Managers and admins create and send invoices; team members can view them.
- **Renewals.** Recurring services per customer (VAT return every 3 months, trade license every year, residence visa every 2 years…), each with what it's for (e.g. an employee's name or a license number), the next due date, when to start reminding, and who looks after it.
  - The dashboard's **Renewals due** list shows everything inside its reminder period or overdue (red), so nothing is missed.
  - **Remind customer** opens Gmail or your email app with a reminder filled in and records when the customer was reminded.
  - **Mark as renewed** moves the due date on by the repeat period (or to a date you choose) and keeps a history.
  - Managers can **Create task** from a renewal to hand the work to a team member; from there the usual task → proforma → tax invoice flow applies.
  - Renewal types and their default period and reminder are edited by managers under **Types**. Anyone with access can add renewals; managers can delete them (others can **Stop** one instead).
- **Finance (phase 1).** Double-entry accounting for managers and admins; financial year January–December.
  - **Chart of accounts:** a standard UAE chart for a logistics/clearing company (bank, cash, cheques in hand, receivables, disbursements recoverable, VAT input/output, customer advances, payables, capital, revenue by service, cost of sales, expenses). Admins add, rename or switch off accounts; the accounts automatic postings use are protected.
  - **Every entry must balance** (debits = credits), enforced by the database when the entry is saved.
  - **Automatic postings:** a tax invoice when sent (Dr receivables / Cr revenue by type of work / Cr VAT output; out-of-scope disbursement lines credit "Customs duty & disbursements recoverable"); a payment when recorded (Dr the bank or cash account it was received into / Cr receivables); cheques via "Cheques in hand" until cleared, back to receivables if bounced; proforma advances in "Customer advances" until the tax invoice is issued. Cancelling an invoice or deleting a payment reverses its postings. Invoices and payments from before the finance module are posted once when `schema.sql` runs.
  - **Journal entries:** general, adjustments, accruals and prepayments (optionally reversed automatically on a date), opening balances (difference to opening balance equity in one click), reversal of any manual entry. Customer can be set on receivable lines.
  - **Bank & cash:** balances per bank account, cash box and cheques in hand; money in, money out (e.g. expenses, or customs duty paid for a customer to 1300), transfers between accounts.
  - **Reports:** trial balance (opening, movements, closing), profit and loss, balance sheet (checks assets = liabilities + equity), account ledger with running balance and drill-down to each entry and its invoice; Excel (CSV) and PDF export.
  - **Closing the books:** admins set a date up to which nothing can be posted.
- **Finance (phase 2): payables and VAT.**
  - **Suppliers:** name, TRN, contact, payment terms and the usual expense account; each supplier's page shows what is owed, bills, payments and a **statement of account** (Excel/PDF).
  - **Bills (purchase invoices) and supplier credit notes:** saved as drafts, then **posted** (Dr expense or asset / Dr VAT input / Cr payables). Each line has an account and a VAT treatment: 5%, zero-rated, exempt, out of scope, or **reverse charge** for imported services or goods (the 5% is self-accounted: VAT output and, if recoverable, VAT input). Untick **Recov.** for VAT that can't be reclaimed; it is added to the cost. The same supplier invoice number can't be entered twice. Cancelling a posted bill reverses its entry.
  - **Payment vouchers:** pay one or several bills in full or in part from a bank or cash account; anything not allocated stays as an **advance** to the supplier and can be applied to a later bill, as can a credit note. Vouchers download as PDF with signature lines; voiding one reverses its entry.
  - **Payables ageing** (Reports): not yet due, 1–30, 31–60, 61–90 and over 90 days past due, per supplier.
  - **VAT return:** for any period (quarter buttons), the FTA VAT 201 boxes 1–14 from sales invoices and bills, checked against the VAT accounts in the ledger, with the **VAT ledger** (every transaction, party TRN and box) to export as supporting documents. **Record this VAT return in the books** moves VAT output and input into "VAT payable to FTA".
  - Coming in later phases: customer credit notes, recurring invoices, customer statements and receivables ageing; bank statement import and reconciliation; petty cash; cash flow and profitability reports; recurring journals.
- **HR.**
  - **Employee records:** job (employee no., designation, department, joining date), contact, personal and emergency details, documents (Emirates ID, passport, visa with expiry warnings), bank and monthly salary package, leave entitlement. Managers and admins see and edit everyone's full record; everyone else sees their own in full and only name, designation, department, email and phone of colleagues.
  - **Attendance:** **Sign in** on arrival and **Sign out** when leaving. The location is recorded; away from the office (or with location off) a **remark is required** saying why. Managers see the whole team for any day (on time, late, on leave, not signed in, where they signed in from, remarks) and can correct mistakes.
  - **Leave:** annual and medical leave requests (counted in working days, skipping the weekend days set in Company settings) go to a manager for approval. Everyone sees their entitlement, taken, waiting and remaining days. Managers can't approve their own leave.
  - **Payslips:** managers create the month's payslips for everyone from their salary packages in one click, adjust overtime, bonus and deductions, and publish; employees see and download only their own published payslips (PDF).
  - Office location, "counts as at office" radius, work start time (for late), weekend days and default leave days are set by admins under **Company settings**.
- **Customers.** Company or individual, status (lead / active / inactive), UAE TRN (checked as 15 digits), contact details, address, how they found Lowcaps, which services they want (shipping, clearing, customs), notes, and the staff member who owns the account.
- **Contacts.** Several people per customer, one marked as the main contact.
- **Activity log.** Notes, calls, meetings and emails on each customer, plus follow-ups with a due date that can be marked done.
- **Dashboard.** Active customers, open leads, customers assigned to you, new this month, overdue follow-ups, follow-ups due this week, and recent activity.
- **Search and filters** across names, email, phone, TRN, city and contact people; filter by status and owner; **export to CSV** (opens in Excel).

Deleting a customer also deletes its contacts and activity log; its tasks are kept without a customer. Team members can delete only their own activity entries.

## How it's built

```
erp/
  index.html, app.css, app.js   # the ERP pages (plain HTML/CSS/JS, same brand colours as the website)
  config.js                     # your Supabase project URL and public key
  vendor/                       # Supabase, jsPDF and jspdf-autotable browser builds (kept here, no CDN needed)
  supabase/schema.sql           # the whole database: tables, rules and permissions
  dev/                          # local test setup (not needed to run the ERP)
```

**Security model.** The browser never touches the tables directly. Every action calls a function in `schema.sql` (for example `save_customer` or `delete_customer`). Each function checks who is signed in, whether their account has access, and whether they're an admin, and validates the input. Direct table access is revoked and row level security is on, so the public key in `config.js` can't reach the data any other way. The pages never insert user data as HTML, and send a strict Content-Security-Policy.

## Testing locally

`dev/` runs the ERP against a real local PostgreSQL 16 loaded with `schema.sql`, plus a small stand-in for Supabase's sign-in and function-call endpoints. Requires Node.js 22 and PostgreSQL 16 server binaries (`/usr/lib/postgresql/16/bin`, or set `PG_BIN`).

```bash
cd erp/dev
npm install
npm test        # database/permission tests via supabase-js, plus browser tests if Playwright is installed
npm start       # try it at http://127.0.0.1:8787/erp/ (the first account becomes admin; data is temporary)
```

The stand-in is for testing only; the real thing is Supabase.
