# Lowcaps ERP

Internal system for the Lowcaps team. **Version 0.3 has Customers (CRM) and Tasks**; quotes/invoicing and expenses are planned next and already appear in the menu as "Soon".

It runs on **Supabase** (database and sign-in) and **GitHub Pages** (the pages), both free. There is no server to run or maintain.

**To put it online, follow [`SUPABASE-SETUP.md`](SUPABASE-SETUP.md).**

## What it does

- **Accounts and roles.** People create their own account; it has no access until an administrator approves it under **Users**, where admins also set each person's role or take access away (effective immediately):
  - **Team member:** sees everything, adds and edits leads and customers, logs activity, comments on any task, and moves the status of tasks assigned to them.
  - **Manager:** everything a team member can do, plus creating, assigning, editing and deleting tasks, managing the **Types of work** list, and deleting customers.
  - **Administrator:** everything, plus managing users.
- **Tasks.** A manager creates a task (title, customer, type of work, description, due date, priority) and assigns it to someone. It moves through New → In progress → Waiting → Done (or Cancelled), with a history of comments, status changes and re-assignments. Tasks show on a Tasks page (filter by status, person, type of work), on each customer's page, and as **My tasks** on the dashboard.
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
  vendor/                       # the Supabase browser library (kept here, no CDN needed)
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
