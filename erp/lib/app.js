'use strict';

const fs = require('node:fs');
const path = require('node:path');
const auth = require('./auth');
const { transaction } = require('./db');
const {
  HttpError, clean, checkPasswordStrength,
  CUSTOMER_RULES, CONTACT_RULES, ACTIVITY_RULES, USER_RULES, USER_UPDATE_RULES,
} = require('./validate');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const COOKIE = 'lowcaps_session';
const MAX_BODY = 1024 * 1024;
const PAGE_SIZE = 25;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

/** Today's date (YYYY-MM-DD) in the business's time zone. */
function today(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

// ---------- tiny router ----------

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
  return { re, keys };
}

function createApp({ db, timeZone = 'Asia/Dubai', secureCookies = false }) {
  const routes = [];
  const limiter = new auth.LoginLimiter();
  const route = (method, pattern, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    routes.push({ method, ...compile(pattern), handler, auth: opts.auth ?? 'user' });
  };

  const sessionCookie = (token, maxAge) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  // ---------- auth ----------

  route('GET', '/api/setup', { auth: 'none' }, () => ({ needsSetup: userCount() === 0 }));

  route('POST', '/api/setup', { auth: 'none' }, ({ body }) => {
    const { role: _ignored, ...rules } = USER_RULES;
    const data = clean(body, rules);
    checkPasswordStrength(data.password);
    const user = transaction(db, () => {
      if (userCount() > 0) throw new HttpError(409, 'Setup has already been completed');
      const r = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
        .run(data.name, data.email, auth.hashPassword(data.password));
      return { id: Number(r.lastInsertRowid), name: data.name, email: data.email, role: 'admin' };
    });
    const s = auth.createSession(db, user.id);
    return { status: 201, cookie: sessionCookie(s.token, s.maxAge), body: { user } };
  });

  route('POST', '/api/login', { auth: 'none' }, ({ body, ip }) => {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const key = `${ip}|${email}`;
    if (limiter.blocked(key)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
    const row = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    const ok = auth.verifyPassword(password, row ? row.password_hash : auth.DUMMY_HASH);
    if (!row || !ok) {
      limiter.fail(key);
      throw new HttpError(401, 'Incorrect email or password');
    }
    limiter.reset(key);
    auth.purgeExpiredSessions(db);
    const s = auth.createSession(db, row.id);
    return {
      cookie: sessionCookie(s.token, s.maxAge),
      body: { user: { id: row.id, name: row.name, email: row.email, role: row.role } },
    };
  });

  route('POST', '/api/logout', { auth: 'none' }, ({ token }) => {
    auth.destroySession(db, token);
    return { cookie: sessionCookie('', 0), body: { ok: true } };
  });

  route('GET', '/api/me', ({ user }) => ({ user }));

  route('PUT', '/api/me/password', ({ user, body }) => {
    const current = String(body?.current ?? '');
    const next = String(body?.password ?? '');
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!auth.verifyPassword(current, row.password_hash)) {
      throw new HttpError(422, 'Current password is wrong', { current: 'Current password is wrong' });
    }
    checkPasswordStrength(next);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(next), user.id);
    return { ok: true };
  });

  // ---------- users ----------

  route('GET', '/api/users', ({ user }) => {
    const cols = user.role === 'admin' ? 'id, name, email, role, active, created_at' : 'id, name, active';
    return { users: db.prepare(`SELECT ${cols} FROM users ORDER BY name`).all() };
  });

  route('POST', '/api/users', { auth: 'admin' }, ({ body }) => {
    const data = clean(body, USER_RULES);
    checkPasswordStrength(data.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(data.email)) {
      throw new HttpError(422, 'Email already in use', { email: 'A user with this email already exists' });
    }
    const r = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(data.name, data.email, auth.hashPassword(data.password), data.role);
    return { status: 201, body: { id: Number(r.lastInsertRowid) } };
  });

  route('PUT', '/api/users/:id', { auth: 'admin' }, ({ params, body, user }) => {
    const data = clean(body, USER_UPDATE_RULES);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    if (!target) throw new HttpError(404, 'User not found');
    if (target.id === user.id && (data.role !== 'admin' || !data.active)) {
      throw new HttpError(422, 'You cannot remove your own admin access or deactivate yourself');
    }
    transaction(db, () => {
      db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?')
        .run(data.name, data.role, data.active, target.id);
      if (data.password) {
        checkPasswordStrength(data.password);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(data.password), target.id);
      }
      if (data.password || !data.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    });
    return { ok: true };
  });

  // ---------- dashboard ----------

  route('GET', '/api/dashboard', ({ user }) => {
    const t = today(timeZone);
    const counts = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) AS n FROM customers GROUP BY status').all().map(r => [r.status, r.n]),
    );
    const followUps = (cond, ...args) => db.prepare(`
      SELECT a.id, a.body, a.due_at, a.customer_id, c.name AS customer_name, u.name AS user_name
      FROM activities a JOIN customers c ON c.id = a.customer_id LEFT JOIN users u ON u.id = a.user_id
      WHERE a.kind = 'follow_up' AND a.done = 0 AND ${cond}
      ORDER BY a.due_at, a.id LIMIT 20`).all(...args);
    const weekAhead = new Date(Date.parse(t) + 7 * 86400_000).toISOString().slice(0, 10);
    return {
      today: t,
      counts: { lead: counts.lead || 0, active: counts.active || 0, inactive: counts.inactive || 0 },
      newThisMonth: db.prepare('SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?').get(t.slice(0, 8) + '01').n,
      myCustomers: db.prepare('SELECT COUNT(*) AS n FROM customers WHERE owner_id = ?').get(user.id).n,
      overdue: followUps('a.due_at < ?', t),
      upcoming: followUps('a.due_at BETWEEN ? AND ?', t, weekAhead),
      recent: db.prepare(`
        SELECT a.id, a.kind, a.body, a.created_at, a.customer_id, c.name AS customer_name, u.name AS user_name
        FROM activities a JOIN customers c ON c.id = a.customer_id LEFT JOIN users u ON u.id = a.user_id
        WHERE a.kind != 'follow_up' ORDER BY a.created_at DESC, a.id DESC LIMIT 8`).all(),
    };
  });

  // ---------- customers ----------

  function customerFilter(query, user) {
    const where = [];
    const args = [];
    const q = String(query.get('q') ?? '').trim();
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
      const cols = ['c.name', 'c.email', 'c.phone', 'c.trn', 'c.city'];
      const contactCols = ['k.name', 'k.email', 'k.phone'];
      const test = c => `${c} LIKE ? ESCAPE '\\'`;
      where.push(`(${cols.map(test).join(' OR ')} OR EXISTS (SELECT 1 FROM contacts k WHERE k.customer_id = c.id
        AND (${contactCols.map(test).join(' OR ')})))`);
      for (let i = 0; i < cols.length + contactCols.length; i++) args.push(like);
    }
    const status = query.get('status');
    if (['lead', 'active', 'inactive'].includes(status)) { where.push('c.status = ?'); args.push(status); }
    const owner = query.get('owner');
    if (owner === 'me') { where.push('c.owner_id = ?'); args.push(user.id); }
    else if (owner === 'none') where.push('c.owner_id IS NULL');
    else if (/^\d+$/.test(owner ?? '')) { where.push('c.owner_id = ?'); args.push(Number(owner)); }
    return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
  }

  const SORTS = {
    name: 'c.name COLLATE NOCASE ASC',
    newest: 'c.created_at DESC, c.id DESC',
    updated: 'c.updated_at DESC, c.id DESC',
  };

  route('GET', '/api/customers', ({ query, user }) => {
    const { sql, args } = customerFilter(query, user);
    const order = SORTS[query.get('sort')] || SORTS.name;
    const page = Math.max(1, Number.parseInt(query.get('page'), 10) || 1);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM customers c ${sql}`).get(...args).n;
    const rows = db.prepare(`
      SELECT c.id, c.name, c.kind, c.status, c.email, c.phone, c.city, c.updated_at, c.owner_id,
             u.name AS owner_name,
             (SELECT k.name FROM contacts k WHERE k.customer_id = c.id ORDER BY k.is_primary DESC, k.id LIMIT 1) AS contact_name,
             (SELECT COUNT(*) FROM activities a WHERE a.customer_id = c.id AND a.kind = 'follow_up' AND a.done = 0) AS open_follow_ups
      FROM customers c LEFT JOIN users u ON u.id = c.owner_id
      ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    return { customers: rows, total, page, pageSize: PAGE_SIZE };
  });

  route('GET', '/api/customers/export', ({ query, user }) => {
    const { sql, args } = customerFilter(query, user);
    const rows = db.prepare(`
      SELECT c.id, c.name, c.kind, c.status, c.trn, c.email, c.phone, c.address, c.city, c.country,
             c.source, c.services, u.name AS owner, c.created_at
      FROM customers c LEFT JOIN users u ON u.id = c.owner_id ${sql} ORDER BY c.name COLLATE NOCASE`).all(...args);
    const header = ['ID', 'Name', 'Type', 'Status', 'TRN', 'Email', 'Phone', 'Address', 'City', 'Country',
      'Source', 'Services', 'Owner', 'Created'];
    const csv = [header, ...rows.map(r => Object.values(r))].map(row => row.map(csvCell).join(',')).join('\r\n');
    return {
      raw: '﻿' + csv,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="customers-${today(timeZone)}.csv"`,
      },
    };
  });

  function getCustomer(id) {
    const customer = db.prepare(`
      SELECT c.*, u.name AS owner_name, cb.name AS created_by_name
      FROM customers c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN users cb ON cb.id = c.created_by
      WHERE c.id = ?`).get(id);
    if (!customer) throw new HttpError(404, 'Customer not found');
    return customer;
  }

  function checkOwner(ownerId) {
    if (ownerId && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(ownerId)) {
      throw new HttpError(422, 'Unknown owner', { owner_id: 'Pick an active user' });
    }
  }

  route('POST', '/api/customers', ({ body, user }) => {
    const data = clean(body, CUSTOMER_RULES);
    checkOwner(data.owner_id);
    const fields = Object.keys(data);
    const r = db.prepare(`INSERT INTO customers (${fields.join(', ')}, created_by)
      VALUES (${fields.map(() => '?').join(', ')}, ?)`).run(...Object.values(data), user.id);
    return { status: 201, body: { id: Number(r.lastInsertRowid) } };
  });

  route('GET', '/api/customers/:id', ({ params }) => {
    const customer = getCustomer(params.id);
    customer.contacts = db.prepare(
      'SELECT * FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC, name COLLATE NOCASE').all(params.id);
    customer.activities = db.prepare(`
      SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.customer_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(params.id);
    return { customer, today: today(timeZone) };
  });

  route('PUT', '/api/customers/:id', ({ params, body }) => {
    getCustomer(params.id);
    const data = clean(body, CUSTOMER_RULES);
    checkOwner(data.owner_id);
    const sets = Object.keys(data).map(f => `${f} = ?`).join(', ');
    db.prepare(`UPDATE customers SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(data), params.id);
    return { ok: true };
  });

  route('DELETE', '/api/customers/:id', { auth: 'admin' }, ({ params }) => {
    getCustomer(params.id);
    db.prepare('DELETE FROM customers WHERE id = ?').run(params.id);
    return { ok: true };
  });

  // ---------- contacts ----------

  function saveContact(customerId, data, contactId) {
    return transaction(db, () => {
      if (data.is_primary) {
        db.prepare('UPDATE contacts SET is_primary = 0 WHERE customer_id = ?').run(customerId);
      }
      if (contactId) {
        db.prepare('UPDATE contacts SET name = ?, job_title = ?, email = ?, phone = ?, is_primary = ? WHERE id = ?')
          .run(data.name, data.job_title, data.email, data.phone, data.is_primary, contactId);
        return contactId;
      }
      const r = db.prepare(`INSERT INTO contacts (customer_id, name, job_title, email, phone, is_primary)
        VALUES (?, ?, ?, ?, ?, ?)`).run(customerId, data.name, data.job_title, data.email, data.phone, data.is_primary);
      return Number(r.lastInsertRowid);
    });
  }

  const getContact = id => {
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Contact not found');
    return row;
  };

  route('POST', '/api/customers/:id/contacts', ({ params, body }) => {
    getCustomer(params.id);
    const id = saveContact(params.id, clean(body, CONTACT_RULES));
    return { status: 201, body: { id } };
  });

  route('PUT', '/api/contacts/:id', ({ params, body }) => {
    const contact = getContact(params.id);
    saveContact(contact.customer_id, clean(body, CONTACT_RULES), contact.id);
    return { ok: true };
  });

  route('DELETE', '/api/contacts/:id', ({ params }) => {
    getContact(params.id);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(params.id);
    return { ok: true };
  });

  // ---------- activities ----------

  route('POST', '/api/customers/:id/activities', ({ params, body, user }) => {
    getCustomer(params.id);
    const data = clean(body, ACTIVITY_RULES);
    if (data.kind === 'follow_up' && !data.due_at) {
      throw new HttpError(422, 'A follow-up needs a due date', { due_at: 'Required for a follow-up' });
    }
    if (data.kind !== 'follow_up') data.due_at = null;
    const r = db.prepare('INSERT INTO activities (customer_id, user_id, kind, body, due_at) VALUES (?, ?, ?, ?, ?)')
      .run(params.id, user.id, data.kind, data.body, data.due_at);
    return { status: 201, body: { id: Number(r.lastInsertRowid) } };
  });

  const getActivity = id => {
    const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Activity not found');
    return row;
  };

  route('PATCH', '/api/activities/:id', ({ params, body }) => {
    const activity = getActivity(params.id);
    if (activity.kind !== 'follow_up') throw new HttpError(422, 'Only follow-ups can be marked done');
    db.prepare('UPDATE activities SET done = ? WHERE id = ?').run(body?.done ? 1 : 0, activity.id);
    return { ok: true };
  });

  route('DELETE', '/api/activities/:id', ({ params, user }) => {
    const activity = getActivity(params.id);
    if (user.role !== 'admin' && activity.user_id !== user.id) {
      throw new HttpError(403, 'You can only delete your own entries');
    }
    db.prepare('DELETE FROM activities WHERE id = ?').run(activity.id);
    return { ok: true };
  });

  // ---------- request handling ----------

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

      const match = findRoute(routes, req.method, url.pathname);
      if (!match) throw new HttpError(match === null ? 404 : 405, match === null ? 'Not found' : 'Method not allowed');
      const { r, params } = match;

      const token = parseCookies(req.headers.cookie)[COOKIE];
      const user = auth.getSessionUser(db, token);
      if (r.auth !== 'none' && !user) throw new HttpError(401, 'Please sign in');
      if (r.auth === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Admins only');

      let body;
      if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
        // Requiring JSON blocks cross-site form posts (a JSON content type forces a CORS preflight).
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          throw new HttpError(415, 'Send JSON with Content-Type: application/json');
        }
        body = await readJson(req);
      }

      const result = await r.handler({
        params, body, user, token, query: url.searchParams, ip: req.socket.remoteAddress,
      });
      const out = result && (result.body !== undefined || result.raw !== undefined || result.cookie) ? result : { body: result };
      const headers = { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...(out.headers || {}) };
      if (out.cookie) headers['Set-Cookie'] = out.cookie;
      if (out.raw !== undefined) {
        res.writeHead(out.status || 200, headers).end(out.raw);
      } else {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        res.writeHead(out.status || 200, headers).end(JSON.stringify(out.body ?? {}));
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ error: status === 500 ? 'Something went wrong' : err.message, details: err.details }));
    }
  };
}

function findRoute(routes, method, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = Number(m[i + 1]); });
    return { r, params };
  }
  return pathMatched ? false : null;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Stop spreadsheets from running cell text as a formula; leave plain phone numbers like +971 alone.
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-][\d\s()-]*$/.test(s))) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SECURITY_HEADERS).end();
    return;
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = '/'; }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(404, SECURITY_HEADERS).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(req.method === 'HEAD' ? undefined : data);
  });
}

module.exports = { createApp, csvCell };
