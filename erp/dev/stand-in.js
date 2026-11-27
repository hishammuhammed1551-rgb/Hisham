'use strict';

// A small stand-in for the two Supabase services the ERP uses, for local testing only:
//   /auth/v1/...       sign up, sign in, refresh, change password, sign out (like Supabase Auth)
//   /rest/v1/rpc/:fn   call a database function as the signed-in user (like PostgREST)
// Database functions run exactly as on Supabase: as role "authenticated" (or "anon"), with
// the caller's id available to auth.uid(). Everything else (permissions, validation) is the
// real schema.sql in a real PostgreSQL.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const NAME_RE = /^[a-z_][a-z0-9_]*$/;

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32));
}

function createStandIn({ pool, minPasswordLength = 6, onSignup }) {
  const tokens = new Map();   // access token -> user id
  const refresh = new Map();  // refresh token -> user id

  const userJson = u => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.created_at, user_metadata: u.raw_user_meta_data || {},
    app_metadata: { provider: 'email', providers: ['email'] }, created_at: u.created_at,
    updated_at: u.created_at, identities: [],
  });

  function session(u) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp,
      session_id: crypto.randomUUID(),
    })}.${crypto.randomBytes(16).toString('base64url')}`;
    const rt = crypto.randomBytes(24).toString('base64url');
    tokens.set(access, u.id);
    refresh.set(rt, u.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt, user: userJson(u) };
  }

  const getUser = async id => (await pool.query('select * from auth.users where id = $1', [id])).rows[0];
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer /i, '');

  async function auth(req, url, body) {
    const route = url.pathname.slice('/auth/v1'.length);
    if (route === '/signup' && req.method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      if (String(body.password || '').length < minPasswordLength) {
        return [422, { code: 422, error_code: 'weak_password', msg: `Password should be at least ${minPasswordLength} characters.` }];
      }
      if ((await pool.query('select 1 from auth.users where email = $1', [email])).rowCount) {
        return [422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }];
      }
      const { rows } = await pool.query(
        'insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning *',
        [email, hashPassword(String(body.password)), JSON.stringify(body.data || {})]);
      if (onSignup) await onSignup(rows[0]);
      return [200, session(rows[0])];
    }
    if (route === '/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const { rows } = await pool.query('select * from auth.users where email = $1', [String(body.email || '').trim().toLowerCase()]);
        if (!rows[0] || !checkPassword(String(body.password || ''), rows[0].encrypted_password)) {
          return [400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }];
        }
        return [200, session(rows[0])];
      }
      if (grant === 'refresh_token') {
        const id = refresh.get(body.refresh_token);
        if (!id) return [400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }];
        refresh.delete(body.refresh_token);
        return [200, session(await getUser(id))];
      }
    }
    if (route === '/user') {
      const id = tokens.get(bearer(req));
      if (!id) return [401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }];
      if (req.method === 'PUT' && body.password !== undefined) {
        if (String(body.password).length < minPasswordLength) {
          return [422, { code: 422, error_code: 'weak_password', msg: `Password should be at least ${minPasswordLength} characters.` }];
        }
        await pool.query('update auth.users set encrypted_password = $2 where id = $1', [id, hashPassword(String(body.password))]);
      }
      return [200, userJson(await getUser(id))];
    }
    if (route === '/logout' && req.method === 'POST') {
      const id = tokens.get(bearer(req));
      for (const map of [tokens, refresh]) for (const [k, v] of map) if (v === id) map.delete(k);
      return [204, null];
    }
    if (route === '/recover' && req.method === 'POST') return [200, {}];
    return [404, { code: 404, msg: 'Not found' }];
  }

  async function rpc(req, url, body) {
    const fn = url.pathname.slice('/rest/v1/rpc/'.length);
    if (!NAME_RE.test(fn)) return [404, { code: 'PGRST202', message: 'Unknown function' }];
    const args = Object.entries(body || {});
    if (args.some(([k]) => !NAME_RE.test(k))) return [400, { code: 'PGRST100', message: 'Bad argument name' }];

    const token = bearer(req);
    const userId = tokens.get(token);
    if (token && !userId && token !== 'local-dev-anon-key') {
      return [401, { code: 'PGRST301', message: 'JWT expired' }];
    }
    const claims = userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' };

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)",
        [claims.role, JSON.stringify(claims)]);
      const params = args.map(([, v]) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      const call = `select public."${fn}"(${args.map(([k], i) => `"${k}" => $${i + 1}`).join(', ')}) as r`;
      const res = await client.query(call, params);
      await client.query('commit');
      const type = res.fields[0].dataTypeID;
      if (type === 2278) return [204, null];               // void
      const value = res.rows[0].r;
      return [200, type === 20 && value !== null ? Number(value) : value];  // bigint -> number, like PostgREST
    } catch (err) {
      await client.query('rollback').catch(() => {});
      if (!err.code) throw err;
      const status = err.code === '42501' ? (userId ? 403 : 401) : err.code === 'P0002' ? 404 : 400;
      return [status, { code: err.code, message: err.message, details: err.detail ?? null, hint: err.hint ?? null }];
    } finally {
      client.release();
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
      res.end(data === null ? undefined : type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
        }).end();
        return;
      }
      if (url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/rpc/')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        const [status, data] = url.pathname.startsWith('/auth/') ? await auth(req, url, body) : await rpc(req, url, body);
        return send(status, data);
      }

      // The ERP pages, with config.js pointing at this stand-in instead of a real Supabase project.
      if (url.pathname === '/erp/config.js') {
        return send(200, `window.LOWCAPS_CONFIG = { supabaseUrl: location.origin, supabaseKey: 'local-dev-anon-key', minPasswordLength: ${minPasswordLength} };`, 'text/javascript');
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '/erp') return res.writeHead(302, { Location: '/erp/' }).end();
      if (!rel.startsWith('/erp/')) return send(404, 'Not found', 'text/plain');
      rel = rel.slice('/erp/'.length) || 'index.html';
      const file = path.join(ROOT, path.normalize(rel));
      if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}dev${path.sep}`)) return send(404, 'Not found', 'text/plain');
      fs.readFile(file, (err, data) => {
        if (err) return send(404, 'Not found', 'text/plain');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
      });
    } catch (err) {
      console.error(err);
      send(500, { message: 'Stand-in error: ' + err.message });
    }
  };
}

module.exports = { createStandIn };
