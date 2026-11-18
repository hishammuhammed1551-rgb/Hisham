# Lowcaps ERP

Internal system for the Lowcaps team. **Version 0.1 contains the Customers (CRM) module**; shipments, invoicing and expenses are planned next and already appear in the menu as "Soon".

It uses Node.js and the SQLite database built into Node, so **there is nothing to `npm install`**.

## What it does

- **Staff logins.** The first person to open the ERP creates the administrator account. Admins add staff, reset passwords and deactivate accounts.
- **Customers.** Company or individual, status (lead / active / inactive), UAE TRN (checked as 15 digits), contact details, address, how they found Lowcaps, which services they want (shipping, clearing, customs), notes, and the staff member who owns the account.
- **Contacts.** Several people per customer, one marked as the main contact.
- **Activity log.** Notes, calls, meetings and emails on each customer, plus follow-ups with a due date that can be marked done.
- **Dashboard.** Active customers, open leads, customers assigned to you, new this month, overdue follow-ups, follow-ups due this week, and recent activity.
- **Search and filters** across names, email, phone, TRN, city and contact people; filter by status and owner; **export to CSV** (opens in Excel).

Staff can add and edit customers. Only admins can delete a customer (which also deletes its contacts and activity) or manage users.

## Run it

Requires **Node.js 22.5 or newer** (check with `node --version`).

```bash
cd erp
npm start
# open http://127.0.0.1:3000 and create the admin account
```

Run the tests with `npm test`.

### Settings (environment variables)

| Variable        | Default              | Meaning |
| --------------- | -------------------- | ------- |
| `PORT`          | `3000`               | Port to listen on. |
| `HOST`          | `127.0.0.1`          | Use `0.0.0.0` to let other computers on the network connect. |
| `DB_FILE`       | `erp/data/lowcaps.db`| Where the database is stored. |
| `TZ_BUSINESS`   | `Asia/Dubai`         | Time zone used to decide what "today" and "overdue" mean. |
| `COOKIE_SECURE` | `false`              | Set to `true` once the ERP is served over HTTPS. |
| `TRUST_PROXY`   | `false`              | Set to `true` only when a reverse proxy (e.g. Caddy) sits in front, so login limits use the visitor's real IP. |

## Putting it online for the team

**Chosen setup: Oracle Cloud Always Free, UAE region.** Follow [`deploy/ORACLE-CLOUD.md`](deploy/ORACLE-CLOUD.md); `deploy/setup.sh` installs and configures everything on the server (HTTPS, auto-restart, nightly backups) and `deploy/update.sh` installs new versions.

Other options, for reference:

The website in the parent folder is static and can live on GitHub Pages, but **the ERP needs a server** because it has a database and logins. Options:

- **A small VPS** (e.g. DigitalOcean, Hetzner, AWS Lightsail): install Node 22, copy the `erp` folder, run `npm start` under a process manager such as `systemd` or `pm2`, and put **Caddy or Nginx with HTTPS** in front of it. Then set `COOKIE_SECURE=true`.
- **A platform with a persistent disk** (e.g. Render, Railway, Fly.io): point `DB_FILE` at the mounted disk so data survives restarts.
- **One office PC:** run it with `HOST=0.0.0.0` and staff open `http://<that-pc's-ip>:3000` on the office network.

Always serve it over HTTPS if it is reachable from the internet.

### Backups

All data is in one file (`data/lowcaps.db` plus `-wal`/`-shm` files while running). Back up safely while the ERP is running with:

```bash
sqlite3 erp/data/lowcaps.db ".backup 'lowcaps-backup.db'"
```

or stop the ERP and copy the `data` folder. The `data` folder is git-ignored so customer data never gets committed.

## Code layout

```
erp/
  server.js          # starts the HTTP server
  lib/db.js          # database schema
  lib/auth.js        # password hashing (scrypt), sessions, login rate limiting
  lib/validate.js    # input validation rules
  lib/app.js         # API routes and static file serving
  public/            # the web interface (plain HTML/CSS/JS, same brand colours as the website)
  test/api.test.js   # end-to-end API tests
```

### Security notes

- Passwords are hashed with scrypt; sessions are random tokens stored hashed, in `HttpOnly`, `SameSite=Strict` cookies, valid for 7 days.
- After 8 failed logins for an email from one address, logins are paused for 15 minutes.
- Changes must be sent as JSON, which together with `SameSite=Strict` blocks cross-site request forgery.
- A strict Content-Security-Policy is sent, and the interface never inserts user data as HTML.
- CSV exports neutralise cells that spreadsheet programs would run as formulas.
