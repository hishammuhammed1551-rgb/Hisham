'use strict';

/* Lowcaps ERP — single-page front end on Supabase.
   Every data operation is a call to a database function in supabase/schema.sql (sb.rpc), which
   checks permissions and validates input. All user data goes through h()/text nodes, never innerHTML. */

const state = { user: null, users: [], recovering: false };
const app = document.getElementById('app');
const config = window.LOWCAPS_CONFIG || {};
const MIN_PASSWORD = Number(config.minPasswordLength) || 10;
const configured = Boolean(config.supabaseUrl && config.supabaseKey && !/YOUR-/.test(config.supabaseUrl + config.supabaseKey));
const sb = configured && window.supabase
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// ---------- helpers ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // static markup (icons) only
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 11h6M9 15h6"/>',
  call: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  meeting: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  follow_up: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
};
const icon = name => h('span', {
  class: 'icon',
  html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`,
}).firstChild;

const KIND_LABEL = { note: 'Note', call: 'Call', meeting: 'Meeting', email: 'Email', follow_up: 'Follow-up' };
const STATUS_LABEL = { lead: 'Lead', active: 'Active', inactive: 'Inactive' };
const SERVICES = ['Shipping', 'Clearing', 'Customs'];

const statusBadge = s => h('span', { class: `badge badge-${s}` }, STATUS_LABEL[s] || s);

function fmtDate(value, withTime = false) {
  if (!value) return '';
  // Plain dates (YYYY-MM-DD) are calendar days; everything else is an ISO timestamp with a zone.
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(isDay ? value + 'T00:00:00' : value);
  return d.toLocaleString('en-GB', withTime && !isDay
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function toast(message, isError = false) {
  const el = h('div', { class: isError ? 'error' : '' }, message);
  document.getElementById('toast').append(el);
  setTimeout(() => el.remove(), 3500);
}

class ApiError extends Error {
  constructor(code, message, fields) {
    super(message || 'Something went wrong');
    this.code = code;
    this.details = fields || {};
  }
}

/** Call a database function. Field errors come back as JSON in the error's "details". */
async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (!error) return data;
  let fields = {};
  try { fields = JSON.parse(error.details || '{}') || {}; } catch { /* plain text */ }
  if (error.code === '28000' || error.code === 'PGRST301' || error.code === 'PGRST303') {
    // Session is missing or expired: go back to the sign-in page.
    state.user = null;
    location.hash = '#/login';
  } else if (error.code === '42501' && /waiting for an administrator/.test(error.message) && state.user) {
    state.user.active = false;
    setTimeout(render);
  }
  throw new ApiError(error.code, error.message, fields);
}

/** Supabase Auth errors (sign in, sign up, password) as an ApiError. */
function authError(error) {
  const known = {
    invalid_credentials: 'Incorrect email or password',
    email_not_confirmed: 'Please confirm your email first: open the link we sent you',
    user_already_exists: 'An account with this email already exists. Sign in instead.',
    over_email_send_rate_limit: 'Too many emails sent. Please wait a while and try again.',
  };
  return new ApiError(error.code, known[error.code] || error.message);
}

function checkNewPassword(password) {
  if (String(password || '').length < MIN_PASSWORD) {
    throw new ApiError('weak_password', 'Password too short', { password: `Use at least ${MIN_PASSWORD} characters` });
  }
}

function field(label, input, { hint, full } = {}) {
  const id = input.id || (input.id = 'f-' + (input.name || Math.random().toString(36).slice(2)));
  return h('div', { class: 'field' + (full ? ' full' : ''), 'data-field': input.name },
    h('label', { for: id }, label), input, hint && h('div', { class: 'hint' }, hint));
}

const input = (name, value, attrs = {}) => h('input', { name, value: value ?? '', ...attrs });
const textarea = (name, value, attrs = {}) => { const t = h('textarea', { name, ...attrs }); t.value = value ?? ''; return t; };
function select(name, value, options, attrs = {}) {
  const s = h('select', { name, ...attrs },
    options.map(([v, label]) => h('option', { value: v }, label)));
  s.value = value ?? '';
  return s;
}

/** Wire a <form> to submit JSON; shows field errors from the API. */
function handleForm(form, submit) {
  const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  form.prepend(errorBox);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.field.invalid').forEach(f => {
      f.classList.remove('invalid');
      f.querySelector('.error')?.remove();
    });
    errorBox.hidden = true;
    const data = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') {
        if (el.dataset.group) (data[el.dataset.group] ||= []).push(...(el.checked ? [el.value] : []));
        else data[el.name] = el.checked;
      } else data[el.name] = el.value;
    }
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await submit(data);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      for (const [name, msg] of Object.entries(err.details || {})) {
        const f = form.querySelector(`[data-field="${CSS.escape(name)}"]`);
        if (f) { f.classList.add('invalid'); f.append(h('div', { class: 'error' }, msg)); }
      }
      if (!(err instanceof ApiError)) console.error(err);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  return form;
}

function openDialog(title, content) {
  const dlg = h('dialog', { 'aria-label': title }, h('h2', {}, title), content);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}

function confirmAction(message) {
  return window.confirm(message);
}

// ---------- layout ----------

function layout(active, ...content) {
  const isAdmin = state.user.role === 'admin';
  const link = (href, name, label, key) =>
    h('a', { href, 'aria-current': active === key ? 'page' : null }, icon(name), label);
  const soon = (name, label) =>
    h('a', { href: '#/coming-soon', 'aria-disabled': 'true', title: 'Coming in a later version' },
      icon(name), label, h('span', { class: 'soon' }, 'Soon'));

  const shell = h('div', { class: 'shell' });
  shell.append(
    h('div', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo-mark' }, 'L'), 'Lowcaps ERP'),
      h('button', { class: 'btn btn-secondary btn-sm', 'aria-label': 'Menu', onclick: () => shell.classList.toggle('menu-open') }, icon('menu'))),
    h('aside', { class: 'sidebar', onclick: e => { if (e.target.closest('a')) shell.classList.remove('menu-open'); } },
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo-mark' }, 'L'),
        h('span', {}, 'Lowcaps', h('small', {}, 'ERP'))),
      h('nav', { class: 'nav', 'aria-label': 'Main' },
        link('#/', 'home', 'Dashboard', 'dashboard'),
        link('#/customers', 'users', 'Customers', 'customers'),
        h('div', { class: 'nav-heading' }, 'Next modules'),
        soon('box', 'Shipments & jobs'),
        soon('invoice', 'Quotes & invoices'),
        soon('chart', 'Expenses & reports'),
        isAdmin && h('div', { class: 'nav-heading' }, 'Admin'),
        isAdmin && link('#/users', 'key', 'Users', 'users')),
      h('div', { class: 'sidebar-user' },
        h('strong', {}, state.user.name),
        h('span', { class: 'muted' }, state.user.role === 'admin' ? 'Administrator' : 'Staff'),
        h('div', { class: 'row' },
          h('a', { href: '#/account' }, 'Account'),
          h('button', { onclick: logout }, 'Sign out')))),
    h('main', { class: 'main', id: 'main' }, ...content));
  return shell;
}

function pageHead(title, subtitle, actions, crumbs) {
  return h('div', { class: 'page-head' },
    h('div', {},
      crumbs && h('div', { class: 'crumbs' }, crumbs),
      h('h1', {}, title),
      subtitle && h('p', { class: 'muted' }, subtitle)),
    actions && h('div', { class: 'btn-row' }, actions));
}

async function logout() {
  try { await sb.auth.signOut(); } catch { /* already signed out */ }
  state.user = null;
  location.hash = '#/login';
  render();
}

// ---------- auth views ----------

function authCard(title, intro, ...content) {
  return h('div', { class: 'auth' },
    h('div', { class: 'card' },
      h('div', { class: 'brand' }, h('span', { class: 'logo-mark' }, 'L'), h('span', {}, 'Lowcaps', h('small', {}, 'ERP'))),
      h('h1', {}, title),
      intro && h('p', { class: 'muted' }, intro),
      ...content));
}

const authLinks = (...links) => h('p', { class: 'auth-links' }, links.flatMap((l, i) => (i ? [' · ', l] : [l])));
const pageUrl = () => location.origin + location.pathname;

function viewLogin() {
  const form = handleForm(h('form', { class: 'form' },
    field('Email', input('email', '', { type: 'email', autocomplete: 'username', required: true, autofocus: true })),
    field('Password', input('password', '', { type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in')),
  async data => {
    const { error } = await sb.auth.signInWithPassword({ email: data.email.trim(), password: data.password });
    if (error) throw authError(error);
    state.user = null;
    location.hash = '#/';
    render();
  });
  return authCard('Sign in', null, form,
    authLinks(h('a', { href: '#/signup' }, 'Create an account'), h('a', { href: '#/forgot' }, 'Forgot password?')));
}

function viewSignup() {
  const form = handleForm(h('form', { class: 'form' },
    field('Your name', input('name', '', { required: true, autocomplete: 'name', autofocus: true, maxlength: 100 })),
    field('Work email', input('email', '', { type: 'email', required: true, autocomplete: 'username' })),
    field('Password', input('password', '', { type: 'password', required: true, autocomplete: 'new-password', minlength: MIN_PASSWORD }),
      { hint: `At least ${MIN_PASSWORD} characters.` }),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create account')),
  async data => {
    checkNewPassword(data.password);
    const { data: res, error } = await sb.auth.signUp({
      email: data.email.trim(),
      password: data.password,
      options: { data: { name: data.name.trim() }, emailRedirectTo: pageUrl() },
    });
    if (error) throw authError(error);
    if (!res.session) {
      // "Confirm email" is switched on in Supabase: they must click the link first.
      form.replaceWith(h('p', {}, `Almost done: we sent a confirmation link to ${data.email.trim()}. Open it, then sign in.`));
      return;
    }
    state.user = null;
    location.hash = '#/';
    render();
  });
  return authCard('Create an account',
    'For Lowcaps staff. After you sign up, an administrator needs to give your account access.',
    form, authLinks(h('a', { href: '#/login' }, 'Already have an account? Sign in')));
}

function viewForgot() {
  const form = handleForm(h('form', { class: 'form' },
    field('Email', input('email', '', { type: 'email', required: true, autocomplete: 'username', autofocus: true })),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send reset link')),
  async data => {
    const { error } = await sb.auth.resetPasswordForEmail(data.email.trim(), { redirectTo: pageUrl() });
    if (error) throw authError(error);
    form.replaceWith(h('p', {}, 'If that email has an account, a reset link is on its way. Open it on this device and browser.'));
  });
  return authCard('Reset your password', null, form, authLinks(h('a', { href: '#/login' }, 'Back to sign in')));
}

function viewResetPassword() {
  const form = handleForm(h('form', { class: 'form' },
    field('New password', input('password', '', { type: 'password', required: true, autocomplete: 'new-password', minlength: MIN_PASSWORD, autofocus: true }),
      { hint: `At least ${MIN_PASSWORD} characters.` }),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save new password')),
  async data => {
    checkNewPassword(data.password);
    const { error } = await sb.auth.updateUser({ password: data.password });
    if (error) throw authError(error);
    state.recovering = false;
    toast('Password changed');
    location.hash = '#/';
  });
  return authCard('Choose a new password', null, form);
}

function viewPending() {
  return authCard('Waiting for access',
    `Hi ${state.user.name}, your account (${state.user.email}) is set up, but an administrator still needs to give it access to the ERP.`,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', onclick: () => { state.user = null; render(); } }, 'Check again'),
      h('button', { class: 'btn btn-secondary', onclick: logout }, 'Sign out')));
}

function viewNotConfigured() {
  return authCard('Connect the ERP to Supabase',
    'This copy of the ERP doesn\'t know which Supabase project to use yet.',
    h('ol', {},
      h('li', {}, 'In Supabase, open Project Settings → API and copy the Project URL and the anon (public) key.'),
      h('li', {}, 'Put them in erp/config.js and publish the change.')),
    h('p', { class: 'muted' }, 'Full steps: erp/SUPABASE-SETUP.md in the repository.'));
}

// ---------- dashboard ----------

async function viewDashboard() {
  const d = await rpc('dashboard');
  const stat = (label, value, href) =>
    h('a', { class: 'card stat', href }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));

  const followList = (items, overdue) => items.length
    ? h('ul', { class: 'list' }, items.map(a => h('li', {},
        h('span', { class: 'kind-icon' }, icon('follow_up')),
        h('div', { class: 'grow' },
          h('div', { class: 'body' }, a.body),
          h('div', { class: 'meta' },
            h('a', { href: `#/customers/${a.customer_id}` }, a.customer_name), ' · ', a.user_name || 'Unknown')),
        h('span', { class: `badge ${overdue ? 'badge-overdue' : 'badge-plain'}` }, fmtDate(a.due_at)))))
    : h('p', { class: 'empty' }, overdue ? 'Nothing overdue.' : 'Nothing due in the next 7 days.');

  return layout('dashboard',
    pageHead(`Hello, ${state.user.name.split(' ')[0]}`, `Here's where your customers stand today, ${fmtDate(d.today)}.`,
      h('a', { class: 'btn btn-primary', href: '#/customers/new' }, '+ New customer')),
    h('div', { class: 'grid stats' },
      stat('Active customers', d.counts.active, '#/customers?status=active'),
      stat('Open leads', d.counts.lead, '#/customers?status=lead'),
      stat('Assigned to me', d.myCustomers, '#/customers?owner=me'),
      stat('Added this month', d.newThisMonth, '#/customers?sort=newest')),
    h('div', { class: 'grid two-col' },
      h('div', {},
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Overdue follow-ups'),
            d.overdue.length > 0 && h('span', { class: 'badge badge-overdue' }, d.overdue.length)),
          followList(d.overdue, true)),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Due this week')),
          followList(d.upcoming, false))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Recent activity')),
        d.recent.length
          ? h('ul', { class: 'list' }, d.recent.map(a => h('li', {},
              h('span', { class: 'kind-icon', title: KIND_LABEL[a.kind] }, icon(a.kind)),
              h('div', { class: 'grow' },
                h('div', { class: 'body' }, a.body.length > 160 ? a.body.slice(0, 160) + '…' : a.body),
                h('div', { class: 'meta' },
                  h('a', { href: `#/customers/${a.customer_id}` }, a.customer_name),
                  ` · ${KIND_LABEL[a.kind]} by ${a.user_name || 'Unknown'} · ${fmtDate(a.created_at, true)}`)))))
          : h('p', { class: 'empty' }, 'No activity yet. Open a customer to log a call, meeting or note.'))));
}

// ---------- customers list ----------

async function loadUsers() {
  state.users = await rpc('list_users');
}

async function viewCustomers(params) {
  await loadUsers();
  const query = new URLSearchParams(params);
  const filters = { p_q: query.get('q') || null, p_status: query.get('status') || null, p_owner: query.get('owner') || null };
  const data = await rpc('list_customers', { ...filters, p_sort: query.get('sort') || 'name', p_page: Number(query.get('page')) || 1 });

  const setParam = (key, value) => {
    const q = new URLSearchParams(params);
    if (value) q.set(key, value); else q.delete(key);
    if (key !== 'page') q.delete('page');
    location.hash = '#/customers' + (q.toString() ? '?' + q : '');
  };

  let searchTimer;
  const search = input('q', query.get('q'), {
    type: 'search', placeholder: 'Search name, email, phone, TRN, city or contact…', 'aria-label': 'Search customers',
    oninput: e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setParam('q', e.target.value.trim()), 350); },
  });

  const ownerOptions = [['', 'All owners'], ['me', 'Assigned to me'], ['none', 'Unassigned'],
    ...state.users.filter(u => u.active).map(u => [String(u.id), u.name])];

  const filterBar = h('div', { class: 'filters' },
    search,
    select('status', query.get('status'), [['', 'All statuses'], ['lead', 'Leads'], ['active', 'Active'], ['inactive', 'Inactive']],
      { 'aria-label': 'Status', onchange: e => setParam('status', e.target.value) }),
    select('owner', query.get('owner'), ownerOptions, { 'aria-label': 'Owner', onchange: e => setParam('owner', e.target.value) }),
    select('sort', query.get('sort') || 'name', [['name', 'Sort: Name'], ['newest', 'Sort: Newest'], ['updated', 'Sort: Recently updated']],
      { 'aria-label': 'Sort', onchange: e => setParam('sort', e.target.value === 'name' ? '' : e.target.value) }));


  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = Math.min(data.page * data.pageSize, data.total);

  const table = data.customers.length
    ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Customer'), h('th', {}, 'Status'), h('th', { class: 'hide-sm' }, 'Main contact'),
          h('th', { class: 'hide-sm' }, 'Phone'), h('th', { class: 'hide-sm' }, 'City'), h('th', {}, 'Owner'))),
        h('tbody', {}, data.customers.map(c => h('tr', {},
          h('td', {},
            h('a', { class: 'row-link', href: `#/customers/${c.id}` }, c.name),
            c.open_follow_ups > 0 && h('div', { class: 'meta muted' }, `${c.open_follow_ups} open follow-up${c.open_follow_ups > 1 ? 's' : ''}`)),
          h('td', {}, statusBadge(c.status)),
          h('td', { class: 'hide-sm' }, c.contact_name || h('span', { class: 'muted' }, '—')),
          h('td', { class: 'hide-sm' }, c.phone || h('span', { class: 'muted' }, '—')),
          h('td', { class: 'hide-sm' }, c.city || h('span', { class: 'muted' }, '—')),
          h('td', {}, c.owner_name || h('span', { class: 'muted' }, 'Unassigned')))))))
    : h('p', { class: 'empty' },
        [...query.keys()].some(k => ['q', 'status', 'owner'].includes(k))
          ? 'No customers match these filters.'
          : 'No customers yet. Add your first one to get started.');

  return layout('customers',
    pageHead('Customers', `${data.total} customer${data.total === 1 ? '' : 's'}`, [
      h('button', { class: 'btn btn-secondary', onclick: e => exportCsv(e.currentTarget, filters) }, 'Export CSV'),
      h('a', { class: 'btn btn-primary', href: '#/customers/new' }, '+ New customer'),
    ]),
    h('section', { class: 'card' },
      filterBar,
      table,
      data.total > data.pageSize && h('div', { class: 'pager' },
        h('span', { class: 'muted' }, `Showing ${from}–${to} of ${data.total}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page <= 1, onclick: () => setParam('page', data.page - 1) }, 'Previous'),
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page >= pages, onclick: () => setParam('page', data.page + 1) }, 'Next')))));
}

// Stop spreadsheets from running cell text as a formula; leave plain phone numbers like +971 alone.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-][\d\s()-]*$/.test(s))) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv(button, filters) {
  button.disabled = true;
  try {
    const rows = await rpc('export_customers', filters);
    const header = ['ID', 'Name', 'Type', 'Status', 'TRN', 'Email', 'Phone', 'Address', 'City', 'Country',
      'Source', 'Services', 'Owner', 'Created'];
    const keys = ['id', 'name', 'kind', 'status', 'trn', 'email', 'phone', 'address', 'city', 'country',
      'source', 'services', 'owner', 'created_at'];
    const csv = [header, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `customers-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
  }
}

// ---------- customer form ----------

function customerForm(c, onSubmit) {
  const owners = [['', 'Unassigned'], ...state.users.filter(u => u.active || u.id === c.owner_id).map(u => [String(u.id), u.name])];
  const services = (c.services || '').split(',').map(s => s.trim()).filter(Boolean);
  return handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field('Customer name', input('name', c.name, { required: true, maxlength: 200 }), { full: true }),
      field('Type', select('kind', c.kind || 'company', [['company', 'Company'], ['individual', 'Individual']])),
      field('Status', select('status', c.status || 'lead', [['lead', 'Lead'], ['active', 'Active'], ['inactive', 'Inactive']])),
      field('Email', input('email', c.email, { type: 'email' })),
      field('Phone', input('phone', c.phone, { type: 'tel', placeholder: '+971 9 000 0000' })),
      field('TRN', input('trn', c.trn, { inputmode: 'numeric', placeholder: '100000000000003' }), { hint: 'UAE VAT Tax Registration Number, 15 digits. Optional.' }),
      field('Owner', select('owner_id', c.owner_id ? String(c.owner_id) : (c.id ? '' : String(state.user.id)), owners),
        { hint: 'Staff member responsible for this customer.' }),
      field('Address', textarea('address', c.address, { rows: 2 }), { full: true }),
      field('City', input('city', c.city, { placeholder: 'Khor Fakkan' })),
      field('Country', input('country', c.country ?? 'United Arab Emirates')),
      field('Source', select('source', c.source, [['', '—'], ['Website', 'Website'], ['Referral', 'Referral'],
        ['Walk-in', 'Walk-in'], ['Phone', 'Phone'], ['Existing client', 'Existing client'], ['Other', 'Other']]),
        { hint: 'How they found Lowcaps.' }),
      h('div', { class: 'field', 'data-field': 'services' },
        h('label', {}, 'Services of interest'),
        h('div', { class: 'btn-row' }, SERVICES.map(s => h('label', { class: 'check' },
          h('input', { type: 'checkbox', name: 'svc', 'data-group': 'services', value: s, checked: services.includes(s) }), s)))),
      field('Notes', textarea('notes', c.notes, { rows: 4 }), { full: true })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, c.id ? 'Save changes' : 'Create customer'),
      h('a', { class: 'btn btn-secondary', href: c.id ? `#/customers/${c.id}` : '#/customers' }, 'Cancel'))),
  data => {
    delete data.svc;
    data.services = (data.services || []).join(', ');
    return onSubmit(data);
  });
}

async function viewCustomerNew() {
  await loadUsers();
  return layout('customers',
    pageHead('New customer', null, null, h('a', { href: '#/customers' }, '← Customers')),
    h('section', { class: 'card' }, customerForm({}, async data => {
      const id = await rpc('save_customer', { p_id: null, p_data: data });
      toast('Customer created');
      location.hash = `#/customers/${id}`;
    })));
}

async function viewCustomerEdit(id) {
  await loadUsers();
  const { customer: c } = await rpc('get_customer', { p_id: id });
  return layout('customers',
    pageHead(`Edit ${c.name}`, null, null, h('a', { href: `#/customers/${id}` }, `← ${c.name}`)),
    h('section', { class: 'card' }, customerForm(c, async data => {
      await rpc('save_customer', { p_id: id, p_data: data });
      toast('Changes saved');
      location.hash = `#/customers/${id}`;
    })));
}

// ---------- customer detail ----------

function contactDialog(customerId, contact, refresh) {
  const c = contact || {};
  const dlg = openDialog(contact ? 'Edit contact' : 'Add contact', handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field('Name', input('name', c.name, { required: true }), { full: true }),
      field('Job title', input('job_title', c.job_title, { placeholder: 'Logistics manager' })),
      field('Phone', input('phone', c.phone, { type: 'tel' })),
      field('Email', input('email', c.email, { type: 'email' }), { full: true }),
      h('label', { class: 'check full' }, h('input', { type: 'checkbox', name: 'is_primary', checked: !!c.is_primary }), 'Main contact for this customer')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, contact ? 'Save' : 'Add contact'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('save_contact', { p_customer_id: customerId, p_id: contact ? contact.id : null, p_data: data });
    dlg.close();
    toast(contact ? 'Contact saved' : 'Contact added');
    refresh();
  }));
}

async function viewCustomer(id) {
  const { customer: c, today } = await rpc('get_customer', { p_id: id });
  const refresh = () => render();
  const isAdmin = state.user.role === 'admin';

  const facts = [
    ['Type', c.kind === 'company' ? 'Company' : 'Individual'],
    ['Email', c.email && h('a', { href: `mailto:${c.email}` }, c.email)],
    ['Phone', c.phone && h('a', { href: `tel:${c.phone.replace(/[^+\d]/g, '')}` }, c.phone)],
    ['TRN', c.trn],
    ['Address', [c.address, c.city, c.country].filter(Boolean).join('\n')],
    ['Services', c.services],
    ['Source', c.source],
    ['Owner', c.owner_name || 'Unassigned'],
    ['Added', `${fmtDate(c.created_at)}${c.created_by_name ? ' by ' + c.created_by_name : ''}`],
    ['Updated', fmtDate(c.updated_at, true)],
  ].filter(([, v]) => v);

  const contacts = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Contacts'),
      h('button', { class: 'btn btn-secondary btn-sm', onclick: () => contactDialog(id, null, refresh) }, '+ Add')),
    c.contacts.length
      ? h('ul', { class: 'list' }, c.contacts.map(k => h('li', {},
          h('div', { class: 'grow' },
            h('strong', {}, k.name), ' ', k.is_primary ? h('span', { class: 'badge badge-active' }, 'Main') : null,
            k.job_title && h('div', { class: 'meta' }, k.job_title),
            h('div', { class: 'meta' },
              k.phone && h('a', { href: `tel:${k.phone.replace(/[^+\d]/g, '')}` }, k.phone),
              k.phone && k.email && ' · ',
              k.email && h('a', { href: `mailto:${k.email}` }, k.email))),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-secondary btn-sm', onclick: () => contactDialog(id, k, refresh) }, 'Edit'),
            h('button', {
              class: 'btn btn-danger btn-sm', 'aria-label': `Remove ${k.name}`,
              onclick: async () => {
                if (!confirmAction(`Remove ${k.name} from contacts?`)) return;
                await rpc('delete_contact', { p_id: k.id }).catch(e => toast(e.message, true));
                refresh();
              },
            }, 'Remove')))))
      : h('p', { class: 'empty' }, 'No contacts yet.'));

  // Activity: log form + timeline with filter tabs
  let kind = 'note';
  const due = input('due_at', '', { type: 'date', min: today });
  const dueField = field('Due date', due);
  dueField.hidden = true;
  const kindTabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Entry type' },
    Object.entries(KIND_LABEL).map(([k, label]) => h('button', {
      type: 'button', 'aria-pressed': String(k === kind),
      onclick: e => {
        kind = k;
        kindTabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        dueField.hidden = k !== 'follow_up';
        due.required = k === 'follow_up';
      },
    }, label)));
  const logForm = handleForm(h('form', { class: 'form' },
    kindTabs,
    field('Details', textarea('body', '', { rows: 3, required: true, placeholder: 'What happened, or what needs doing?' })),
    dueField,
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save entry'))),
  async data => {
    await rpc('add_activity', { p_customer_id: id, p_data: { ...data, kind } });
    toast(`${KIND_LABEL[kind]} saved`);
    refresh();
  });

  const timeline = h('ul', { class: 'list' }, c.activities.map(a => {
    const overdue = a.kind === 'follow_up' && !a.done && a.due_at < today;
    return h('li', { class: a.done ? 'done' : '' },
      h('span', { class: 'kind-icon', title: KIND_LABEL[a.kind] }, icon(a.kind)),
      h('div', { class: 'grow' },
        h('div', { class: 'body' }, a.body),
        h('div', { class: 'meta' },
          `${KIND_LABEL[a.kind]} · ${a.user_name || 'Unknown'} · ${fmtDate(a.created_at, true)}`,
          a.kind === 'follow_up' && [' · ', h('span', { class: `badge ${overdue ? 'badge-overdue' : 'badge-plain'}` },
            a.done ? 'Done' : `Due ${fmtDate(a.due_at)}`)])),
      h('div', { class: 'btn-row' },
        a.kind === 'follow_up' && h('button', {
          class: 'btn btn-secondary btn-sm',
          onclick: async () => {
            await rpc('set_follow_up_done', { p_id: a.id, p_done: !a.done }).catch(e => toast(e.message, true));
            refresh();
          },
        }, a.done ? 'Reopen' : 'Mark done'),
        (isAdmin || a.user_id === state.user.id) && h('button', {
          class: 'btn btn-danger btn-sm', 'aria-label': 'Delete entry',
          onclick: async () => {
            if (!confirmAction('Delete this entry?')) return;
            await rpc('delete_activity', { p_id: a.id }).catch(e => toast(e.message, true));
            refresh();
          },
        }, 'Delete')));
  }));

  const activity = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Activity')),
    logForm,
    h('hr', { class: 'divider' }),
    c.activities.length ? timeline : h('p', { class: 'empty' }, 'Nothing logged yet.'));

  return layout('customers',
    pageHead(c.name, null, [
      h('a', { class: 'btn btn-secondary', href: `#/customers/${id}/edit` }, 'Edit'),
      isAdmin && h('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (!confirmAction(`Delete ${c.name}? This also deletes its contacts and activity, and cannot be undone.`)) return;
          try {
            await rpc('delete_customer', { p_id: id });
            toast('Customer deleted');
            location.hash = '#/customers';
          } catch (e) { toast(e.message, true); }
        },
      }, 'Delete'),
    ], [h('a', { href: '#/customers' }, '← Customers'), ' ', statusBadge(c.status)]),
    h('div', { class: 'grid detail-layout' },
      h('div', {},
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Details')),
          h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
          c.notes && [h('h3', { class: 'notes-heading' }, 'Notes'), h('p', { class: 'prewrap' }, c.notes)]),
        contacts),
      activity));
}

// ---------- users (admin) ----------

function userDialog(u, refresh) {
  const isSelf = u.id === state.user.id;
  const dlg = openDialog(`Edit ${u.name}`, handleForm(h('form', { class: 'form' },
    h('p', { class: 'muted' }, u.email),
    field('Name', input('name', u.name, { required: true, maxlength: 100 })),
    field('Role', select('role', u.role, [['staff', 'Staff'], ['admin', 'Administrator']], { disabled: isSelf }),
      { hint: 'Administrators can manage users and delete customers.' }),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'active', checked: !!u.active, disabled: isSelf }), 'Has access to the ERP'),
    isSelf && h('p', { class: 'muted' }, 'You can\'t remove your own admin access or turn off your own account.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('admin_update_user', {
      p_id: u.id, p_name: data.name, p_role: isSelf ? u.role : data.role, p_active: isSelf ? true : data.active,
    });
    dlg.close();
    toast('User saved');
    refresh();
  }));
}

async function viewUsers() {
  if (state.user.role !== 'admin') return viewNotFound();
  await loadUsers();
  const refresh = () => render();
  const giveAccess = async u => {
    try {
      await rpc('admin_update_user', { p_id: u.id, p_name: u.name, p_role: u.role, p_active: true });
      toast(`${u.name} now has access`);
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  const waiting = state.users.filter(u => !u.active).length;
  return layout('users',
    pageHead('Users', 'Staff create their own account on the sign-in page ("Create an account"). Then give them access here.'),
    waiting > 0 && h('p', { class: 'notice' }, `${waiting} account${waiting > 1 ? 's' : ''} without access. Only give access to people you recognise.`),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, 'Access'), h('th', {}, ''))),
      h('tbody', {}, state.users.map(u => h('tr', {},
        h('td', {}, h('strong', {}, u.name), u.id === state.user.id && h('span', { class: 'muted' }, ' (you)')),
        h('td', {}, u.email),
        h('td', {}, u.role === 'admin' ? 'Administrator' : 'Staff'),
        h('td', {}, u.active ? h('span', { class: 'badge badge-active' }, 'Yes') : h('span', { class: 'badge badge-lead' }, 'No access')),
        h('td', {}, h('div', { class: 'btn-row' },
          !u.active && h('button', { class: 'btn btn-primary btn-sm', onclick: () => giveAccess(u) }, 'Give access'),
          h('button', { class: 'btn btn-secondary btn-sm', onclick: () => userDialog(u, refresh) }, 'Edit'))))))))));
}

// ---------- account ----------

function viewAccount() {
  const nameForm = handleForm(h('form', { class: 'form narrow' },
    field('Name', input('name', state.user.name, { required: true, maxlength: 100 })),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save name'))),
  async data => {
    await rpc('update_my_name', { p_name: data.name });
    state.user.name = data.name.trim();
    toast('Name saved');
    render();
  });
  const pwForm = handleForm(h('form', { class: 'form narrow' },
    field('Current password', input('current', '', { type: 'password', required: true, autocomplete: 'current-password' })),
    field('New password', input('password', '', { type: 'password', required: true, autocomplete: 'new-password', minlength: MIN_PASSWORD }),
      { hint: `At least ${MIN_PASSWORD} characters.` }),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Change password'))),
  async data => {
    checkNewPassword(data.password);
    const check = await sb.auth.signInWithPassword({ email: state.user.email, password: data.current });
    if (check.error) throw new ApiError('invalid_credentials', 'Current password is wrong', { current: 'Current password is wrong' });
    const { error } = await sb.auth.updateUser({ password: data.password });
    if (error) throw authError(error);
    pwForm.reset();
    toast('Password changed');
  });
  return layout(null,
    pageHead('Account', state.user.email),
    h('section', { class: 'card' }, h('h2', {}, 'Your name'), nameForm),
    h('section', { class: 'card' }, h('h2', {}, 'Change password'), pwForm));
}

function viewComingSoon() {
  return layout(null,
    pageHead('Coming soon', null),
    h('section', { class: 'card' },
      h('p', {}, 'Shipments & jobs, quotes & invoices, and expenses & reports are planned as the next ERP modules. They will link to the customers you add now.'),
      h('a', { class: 'btn btn-secondary', href: '#/customers' }, 'Go to customers')));
}

function viewNotFound() {
  return layout(null, pageHead('Page not found', null),
    h('section', { class: 'card' }, h('a', { href: '#/' }, 'Back to the dashboard')));
}

// ---------- router ----------

let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const [pathPart, queryPart = ''] = location.hash.replace(/^#/, '').split('?');
  const path = pathPart || '/';
  const params = Object.fromEntries(new URLSearchParams(queryPart));

  try {
    let view;
    if (!sb) {
      view = viewNotConfigured();
    } else {
      if (!state.user) {
        const { data } = await sb.auth.getSession();  // also finishes any sign-in link in the URL
        // Remove ?code=... left by a confirmation or reset link now that Supabase has used it.
        if (location.search) history.replaceState(null, '', location.pathname + location.hash);
        state.user = data.session ? await rpc('me') : null;
      }
      const publicPages = { '/login': viewLogin, '/signup': viewSignup, '/forgot': viewForgot };
      let m;
      if (state.recovering && state.user) view = viewResetPassword();
      else if (!state.user) {
        view = (publicPages[path] || viewLogin)();
        if (!publicPages[path]) history.replaceState(null, '', '#/login');
      } else if (!state.user.active) view = viewPending();
      else if (publicPages[path]) { location.hash = '#/'; return; }
      else if (path === '/') view = await viewDashboard();
      else if (path === '/customers') view = await viewCustomers(params);
      else if (path === '/customers/new') view = await viewCustomerNew();
      else if ((m = path.match(/^\/customers\/(\d+)$/))) view = await viewCustomer(Number(m[1]));
      else if ((m = path.match(/^\/customers\/(\d+)\/edit$/))) view = await viewCustomerEdit(Number(m[1]));
      else if (path === '/users') view = await viewUsers();
      else if (path === '/account') view = viewAccount();
      else if (path === '/coming-soon') view = viewComingSoon();
      else view = viewNotFound();
    }
    if (seq !== renderSeq) return; // a newer navigation finished first
    const focused = document.activeElement?.name === 'q' ? document.activeElement : null;
    const caret = focused?.selectionStart;
    app.replaceChildren(view);
    if (focused) {
      const q = app.querySelector('input[name="q"]');
      q?.focus();
      if (q && caret != null) q.setSelectionRange(caret, caret);
    }
  } catch (err) {
    if (seq !== renderSeq || err.code === '28000') return;
    if (err.code === 'P0002' && state.user) {
      app.replaceChildren(layout(null, pageHead('Not found', err.message),
        h('section', { class: 'card' }, h('a', { href: '#/customers' }, 'Back to customers'))));
      return;
    }
    console.error(err);
    app.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'card' },
      h('h1', {}, 'Something went wrong'), h('p', { class: 'muted' }, err.message),
      h('button', { class: 'btn btn-primary', onclick: () => render() }, 'Try again'))));
  }
}

window.addEventListener('hashchange', render);
if (sb) {
  sb.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') {
      // Opened a password-reset link: ask for a new password before anything else.
      state.recovering = true;
      state.user = null;
      setTimeout(render);
    } else if (event === 'SIGNED_OUT') {
      state.user = null;
    }
  });
}
render();
