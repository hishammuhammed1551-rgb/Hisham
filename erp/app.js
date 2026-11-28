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
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 11h6M9 15h6"/>',
  call: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  meeting: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  follow_up: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  task: '<path d="m9 11 3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
};
const icon = name => h('span', {
  class: 'icon',
  html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`,
}).firstChild;

const KIND_LABEL = { note: 'Note', call: 'Call', meeting: 'Meeting', email: 'Email', follow_up: 'Follow-up' };
const STATUS_LABEL = { lead: 'Lead', active: 'Active', inactive: 'Inactive' };
const SERVICES = ['Shipping', 'Clearing', 'Customs'];

const statusBadge = s => h('span', { class: `badge badge-${s}` }, STATUS_LABEL[s] || s);

const ROLE_LABEL = { admin: 'Administrator', manager: 'Manager', staff: 'Team member' };
const ROLE_OPTIONS = [['staff', 'Team member'], ['manager', 'Manager'], ['admin', 'Administrator']];
const TASK_STATUS = { new: 'New', in_progress: 'In progress', waiting: 'Waiting', done: 'Done', cancelled: 'Cancelled' };
const PRIORITY = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
const INVOICE_KIND = { proforma: 'Proforma invoice', tax: 'Tax invoice' };
const INVOICE_STATUS = { draft: 'Draft', sent: 'Sent', paid: 'Paid', cancelled: 'Cancelled' };
const VAT_CODES = { standard: '5% VAT', zero: '0% (zero-rated)', exempt: 'Exempt', out_of_scope: 'No VAT (disbursement)' };
const invoiceBadge = st => h('span', { class: `badge inv-${st}` }, INVOICE_STATUS[st] || st);
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const amount = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => `AED ${amount(n)}`;
const localToday = () => new Date().toLocaleDateString('en-CA');
const addDays = (ymd, days) => {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return d.toLocaleDateString('en-CA');
};
const UPDATE_ICON = { created: 'note', comment: 'note', status: 'task', assigned: 'users' };
const isManager = () => ['admin', 'manager'].includes(state.user?.role);
const isOpenTask = status => ['new', 'in_progress', 'waiting'].includes(status);
const taskStatusBadge = st => h('span', { class: `badge task-${st}` }, TASK_STATUS[st] || st);
const priorityBadge = pr => (pr === 'high' || pr === 'urgent'
  ? h('span', { class: `badge prio-${pr}` }, PRIORITY[pr])
  : h('span', { class: 'muted' }, PRIORITY[pr] || pr));
function dueBadge(due, status, today) {
  if (!due) return h('span', { class: 'muted' }, 'No due date');
  const overdue = isOpenTask(status) && due < today;
  return h('span', { class: `badge ${overdue ? 'badge-overdue' : 'badge-plain'}` }, `${overdue ? 'Overdue · ' : 'Due '}${fmtDate(due)}`);
}

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
    h('label', { for: id }, label), input.type === 'password' ? withShowButton(input) : input,
    hint && h('div', { class: 'hint' }, hint));
}

/** Password box with an eye button that shows or hides what was typed. */
function withShowButton(pw) {
  const btn = h('button', {
    type: 'button', class: 'pw-toggle', 'aria-label': 'Show password', 'aria-pressed': 'false', title: 'Show password',
    onclick: () => {
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      const label = show ? 'Hide password' : 'Show password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
      pw.focus();
    },
  }, icon('eye'));
  return h('span', { class: 'pw-wrap' }, pw, btn);
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
        link('#/tasks', 'task', 'Tasks', 'tasks'),
        link('#/invoices', 'invoice', 'Invoices', 'invoices'),
        h('div', { class: 'nav-heading' }, 'Next modules'),
        soon('chart', 'Expenses & reports'),
        isManager() && h('div', { class: 'nav-heading' }, 'Manage'),
        isManager() && link('#/work-types', 'tag', 'Types of work', 'work-types'),
        isAdmin && link('#/users', 'key', 'Users', 'users'),
        isAdmin && link('#/settings', 'gear', 'Company settings', 'settings')),
      h('div', { class: 'sidebar-user' },
        h('strong', {}, state.user.name),
        h('span', { class: 'muted' }, ROLE_LABEL[state.user.role] || state.user.role),
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
    pageHead(`Hello, ${state.user.name.split(' ')[0]}`, `Here's where things stand today, ${fmtDate(d.today)}.`, [
      isManager() && h('a', { class: 'btn btn-secondary', href: '#/tasks/new' }, '+ New task'),
      h('a', { class: 'btn btn-primary', href: '#/customers/new' }, '+ New customer'),
    ]),
    h('div', { class: 'grid stats' },
      stat('Active customers', d.counts.active, '#/customers?status=active'),
      stat('Open leads', d.counts.lead, '#/customers?status=lead'),
      stat('My open tasks', d.myOpenTasks, '#/tasks?assignee=me'),
      isManager()
        ? stat('Overdue tasks (team)', d.overdueTasks, '#/tasks')
        : stat('Customers I own', d.myCustomers, '#/customers?owner=me')),
    h('div', { class: 'grid two-col' },
      h('div', {},
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'My tasks'),
            h('a', { class: 'btn btn-secondary btn-sm', href: '#/tasks?assignee=me' }, 'See all')),
          d.myTasks.length
            ? h('ul', { class: 'list' }, d.myTasks.map(t => h('li', {},
                h('span', { class: 'kind-icon' }, icon('task')),
                h('div', { class: 'grow' },
                  h('a', { class: 'row-link', href: `#/tasks/${t.id}` }, t.title),
                  h('div', { class: 'meta' }, [t.customer_name, t.work_type, TASK_STATUS[t.status]].filter(Boolean).join(' · '))),
                dueBadge(t.due_date, t.status, d.today))))
            : h('p', { class: 'empty' }, 'No open tasks assigned to you.'),
          isManager() && d.unassignedTasks > 0 && h('p', { class: 'notice notice-inline' },
            h('a', { href: '#/tasks?assignee=none' }, `${d.unassignedTasks} open task${d.unassignedTasks > 1 ? 's have' : ' has'} no one assigned`))),
        isManager() && h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Ready to invoice'),
            d.unpaid.count > 0 && h('a', { class: 'btn btn-secondary btn-sm', href: '#/invoices?status=unpaid' },
              `Unpaid: ${money(d.unpaid.total)}`)),
          d.toInvoice.length
            ? h('ul', { class: 'list' }, d.toInvoice.map(t => h('li', {},
                h('span', { class: 'kind-icon' }, icon('invoice')),
                h('div', { class: 'grow' },
                  h('a', { class: 'row-link', href: `#/tasks/${t.id}` }, t.title),
                  h('div', { class: 'meta' }, `${t.customer_name}${t.completed_at ? ' · done ' + fmtDate(t.completed_at) : ''}`)),
                h('a', { class: 'btn btn-primary btn-sm', href: `#/invoices/new?kind=tax&task=${t.id}` }, 'Create tax invoice'))))
            : h('p', { class: 'empty' }, 'Every finished task has a tax invoice.')),
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

  const tasksCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Tasks'),
      isManager() && h('a', { class: 'btn btn-secondary btn-sm', href: `#/tasks/new?customer=${id}` }, '+ New task')),
    c.tasks.length
      ? h('ul', { class: 'list' }, c.tasks.map(t => h('li', {},
          h('div', { class: 'grow' },
            h('a', { class: 'row-link', href: `#/tasks/${t.id}` }, t.title),
            h('div', { class: 'meta' }, `${t.work_type || 'No type of work'} · ${t.assignee_name || 'Unassigned'}`)),
          h('div', { class: 'badge-stack' }, taskStatusBadge(t.status), isOpenTask(t.status) && t.due_date && dueBadge(t.due_date, t.status, today)))))
      : h('p', { class: 'empty' }, 'No tasks for this customer yet.'));

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
      isManager() && h('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (!confirmAction(`Delete ${c.name}? This also deletes its contacts and activity log (its tasks are kept). It cannot be undone.`)) return;
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
        contacts,
        tasksCard,
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Invoices'),
            isManager() && h('a', { class: 'btn btn-secondary btn-sm', href: `#/invoices/new?kind=proforma&customer=${id}` }, '+ Proforma')),
          c.invoices.length
            ? h('ul', { class: 'list' }, c.invoices.map(i => h('li', {},
                h('div', { class: 'grow' },
                  h('a', { class: 'row-link', href: `#/invoices/${i.id}` }, i.number),
                  h('div', { class: 'meta' }, `${INVOICE_KIND[i.kind]} · ${fmtDate(i.issue_date)}`)),
                h('div', { class: 'badge-stack' }, h('strong', {}, money(i.total)), invoiceBadge(i.status)))))
            : h('p', { class: 'empty' }, 'No invoices yet.'))),
      activity));
}

// ---------- tasks ----------

async function viewTasks(params) {
  const query = new URLSearchParams(params);
  const [workTypes] = await Promise.all([rpc('list_work_types'), loadUsers()]);
  const status = query.get('status') || 'open';
  const data = await rpc('list_tasks', {
    p_q: query.get('q') || null, p_status: status, p_assignee: query.get('assignee') || null,
    p_work_type: Number(query.get('type')) || null, p_page: Number(query.get('page')) || 1,
  });

  const setParam = (key, value) => {
    const q = new URLSearchParams(params);
    if (value) q.set(key, value); else q.delete(key);
    if (key !== 'page') q.delete('page');
    location.hash = '#/tasks' + (q.toString() ? '?' + q : '');
  };
  let searchTimer;
  const filterBar = h('div', { class: 'filters' },
    input('q', query.get('q'), {
      type: 'search', placeholder: 'Search task or customer…', 'aria-label': 'Search tasks',
      oninput: e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setParam('q', e.target.value.trim()), 350); },
    }),
    select('status', status, [['open', 'Open tasks'], ['all', 'All tasks'], ...Object.entries(TASK_STATUS)],
      { 'aria-label': 'Status', onchange: e => setParam('status', e.target.value === 'open' ? '' : e.target.value) }),
    select('assignee', query.get('assignee'), [['', 'Anyone'], ['me', 'Assigned to me'], ['none', 'Unassigned'],
      ...state.users.filter(u => u.active).map(u => [u.id, u.name])],
      { 'aria-label': 'Assigned to', onchange: e => setParam('assignee', e.target.value) }),
    select('type', query.get('type'), [['', 'All types of work'], ...workTypes.map(w => [String(w.id), w.name])],
      { 'aria-label': 'Type of work', onchange: e => setParam('type', e.target.value) }));

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = Math.min(data.page * data.pageSize, data.total);
  const filtered = ['q', 'assignee', 'type'].some(k => query.get(k)) || status !== 'open';

  const table = data.tasks.length
    ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Task'), h('th', { class: 'hide-sm' }, 'Type of work'), h('th', {}, 'Assigned to'),
          h('th', {}, 'Due'), h('th', { class: 'hide-sm' }, 'Priority'), h('th', {}, 'Status'))),
        h('tbody', {}, data.tasks.map(t => h('tr', {},
          h('td', {},
            h('a', { class: 'row-link', href: `#/tasks/${t.id}` }, t.title),
            t.customer_name && h('div', { class: 'meta muted' }, t.customer_name)),
          h('td', { class: 'hide-sm' }, t.work_type || h('span', { class: 'muted' }, '—')),
          h('td', {}, t.assignee_name || h('span', { class: 'muted' }, 'Unassigned')),
          h('td', {}, t.due_date ? dueBadge(t.due_date, t.status, data.today) : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'hide-sm' }, priorityBadge(t.priority)),
          h('td', {}, taskStatusBadge(t.status)))))))
    : h('p', { class: 'empty' }, filtered ? 'No tasks match these filters.'
        : isManager() ? 'No open tasks. Create one with "+ New task".' : 'No open tasks.');

  return layout('tasks',
    pageHead('Tasks', `${data.total} ${status === 'open' ? 'open ' : ''}task${data.total === 1 ? '' : 's'}`,
      isManager() && h('a', { class: 'btn btn-primary', href: '#/tasks/new' }, '+ New task')),
    h('section', { class: 'card' },
      filterBar,
      table,
      data.total > data.pageSize && h('div', { class: 'pager' },
        h('span', { class: 'muted' }, `Showing ${from}–${to} of ${data.total}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page <= 1, onclick: () => setParam('page', data.page - 1) }, 'Previous'),
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page >= pages, onclick: () => setParam('page', data.page + 1) }, 'Next')))));
}

async function loadTaskOptions() {
  const [customers, workTypes] = await Promise.all([rpc('customer_options'), rpc('list_work_types'), loadUsers()]);
  return { customers, workTypes };
}

function taskForm(t, opts, onSubmit, cancelHref) {
  const people = [['', 'Unassigned'], ...state.users
    .filter(u => u.active || u.id === t.assigned_to)
    .map(u => [u.id, u.role === 'staff' ? u.name : `${u.name} (${ROLE_LABEL[u.role]})`])];
  const customers = [['', 'No customer'], ...opts.customers.map(c => [String(c.id), c.name])];
  const types = [['', '—'], ...opts.workTypes.filter(w => w.active || w.id === t.work_type_id).map(w => [String(w.id), w.name])];
  return handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field('Task', input('title', t.title, { required: true, maxlength: 200, placeholder: 'e.g. Clear container MSKU1234567' }), { full: true }),
      field('Customer', select('customer_id', t.customer_id ? String(t.customer_id) : '', customers)),
      field('Type of work', select('work_type_id', t.work_type_id ? String(t.work_type_id) : '', types)),
      field('Assign to', select('assigned_to', t.assigned_to || '', people)),
      field('Due date', input('due_date', t.due_date, { type: 'date' })),
      field('Priority', select('priority', t.priority || 'normal', Object.entries(PRIORITY))),
      field('Status', select('status', t.status || 'new', Object.entries(TASK_STATUS))),
      field('Description', textarea('description', t.description, { rows: 5, maxlength: 5000,
        placeholder: 'What needs doing, documents, references (BL / AWB / container no.)…' }), { full: true })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, t.id ? 'Save changes' : 'Create task'),
      !t.id && h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'make_proforma', checked: true }),
        'Then create a proforma invoice for the customer'),
      h('a', { class: 'btn btn-secondary', href: cancelHref }, 'Cancel'))),
  onSubmit);
}

async function viewTaskNew(params) {
  if (!isManager()) return viewNotFound();
  const opts = await loadTaskOptions();
  const customerId = Number(params.customer) || null;
  return layout('tasks',
    pageHead('New task', null, null, h('a', { href: customerId ? `#/customers/${customerId}` : '#/tasks' }, '← Back')),
    h('section', { class: 'card' }, taskForm({ customer_id: customerId }, opts, async data => {
      const makeProforma = data.make_proforma && data.customer_id;
      delete data.make_proforma;
      const id = await rpc('save_task', { p_id: null, p_data: data });
      toast('Task created');
      location.hash = makeProforma ? `#/invoices/new?kind=proforma&task=${id}` : `#/tasks/${id}`;
    }, customerId ? `#/customers/${customerId}` : '#/tasks')));
}

async function viewTaskEdit(id) {
  if (!isManager()) return viewNotFound();
  const [{ task: t }, opts] = await Promise.all([rpc('get_task', { p_id: id }), loadTaskOptions()]);
  return layout('tasks',
    pageHead(`Edit task`, null, null, h('a', { href: `#/tasks/${id}` }, `← ${t.title}`)),
    h('section', { class: 'card' }, taskForm(t, opts, async data => {
      await rpc('save_task', { p_id: id, p_data: data });
      toast('Changes saved');
      location.hash = `#/tasks/${id}`;
    }, `#/tasks/${id}`)));
}

async function viewTask(id) {
  const { task: t, today } = await rpc('get_task', { p_id: id });
  const refresh = () => render();
  const canChangeStatus = isManager() || t.assigned_to === state.user.id;

  const facts = [
    ['Customer', t.customer_id ? h('a', { href: `#/customers/${t.customer_id}` }, t.customer_name) : h('span', { class: 'muted' }, 'None')],
    ['Type of work', t.work_type || h('span', { class: 'muted' }, 'Not set')],
    ['Assigned to', t.assignee_name || h('span', { class: 'muted' }, 'Unassigned')],
    ['Priority', priorityBadge(t.priority)],
    ['Due', dueBadge(t.due_date, t.status, today)],
    ['Created', `${fmtDate(t.created_at, true)}${t.created_by_name ? ' by ' + t.created_by_name : ''}`],
    t.completed_at && ['Completed', fmtDate(t.completed_at, true)],
  ].filter(Boolean);

  const statusCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Status')),
    canChangeStatus
      ? handleForm(h('form', { class: 'form' },
          field('Move to', select('status', t.status, Object.entries(TASK_STATUS))),
          field('Note (optional)', textarea('note', '', { rows: 2, maxlength: 5000, placeholder: 'e.g. Waiting for the customer to send the BL' })),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-primary', type: 'submit' }, 'Update status'),
            isOpenTask(t.status) && h('button', {
              class: 'btn btn-secondary', type: 'button',
              onclick: async e => {
                const note = e.currentTarget.form.elements.note.value.trim();
                try {
                  await rpc('update_task_status', { p_id: id, p_status: 'done', p_note: note || null });
                  toast('Task completed');
                  refresh();
                } catch (err) { toast(err.message, true); }
              },
            }, '✓ Mark as complete'))),
        async data => {
          if (data.status === t.status && !data.note.trim()) return;
          if (data.status === t.status) {
            await rpc('add_task_comment', { p_id: id, p_body: data.note });
          } else {
            await rpc('update_task_status', { p_id: id, p_status: data.status, p_note: data.note || null });
          }
          toast(data.status === t.status ? 'Note added' : `Moved to ${TASK_STATUS[data.status]}`);
          refresh();
        })
      : h('p', { class: 'muted' },
          `Only ${t.assignee_name || 'the person this task is assigned to'} or a manager can change the status. You can still add a comment.`));

  const activeTax = t.invoices.find(i => i.kind === 'tax' && i.status !== 'cancelled');
  const invoicesCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Invoices'),
      isManager() && t.customer_id && h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-secondary btn-sm', href: `#/invoices/new?kind=proforma&task=${id}` }, '+ Proforma'),
        h('a', { class: 'btn btn-secondary btn-sm', href: `#/invoices/new?kind=tax&task=${id}` }, '+ Tax invoice'))),
    isManager() && t.status === 'done' && t.customer_id && !activeTax && h('div', { class: 'notice' },
      h('p', {}, 'This task is complete. Send the customer the final tax invoice.'),
      h('a', { class: 'btn btn-primary btn-sm', href: `#/invoices/new?kind=tax&task=${id}` }, 'Create tax invoice')),
    t.invoices.length
      ? h('ul', { class: 'list' }, t.invoices.map(i => h('li', {},
          h('div', { class: 'grow' },
            h('a', { class: 'row-link', href: `#/invoices/${i.id}` }, i.number),
            h('div', { class: 'meta' }, `${INVOICE_KIND[i.kind]} · ${fmtDate(i.issue_date)}`)),
          h('div', { class: 'badge-stack' }, h('strong', {}, money(i.total)), invoiceBadge(i.status)))))
      : h('p', { class: 'empty' }, t.customer_id ? 'No invoices yet.' : 'Link a customer to this task (Edit) to invoice it.'));

  const commentForm = handleForm(h('form', { class: 'form' },
    field('Add a comment', textarea('body', '', { rows: 3, required: true, maxlength: 5000, placeholder: 'Progress, questions, document numbers…' })),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Post comment'))),
  async data => {
    await rpc('add_task_comment', { p_id: id, p_body: data.body });
    toast('Comment added');
    refresh();
  });

  const history = h('ul', { class: 'list' }, t.updates.map(u => h('li', {},
    h('span', { class: 'kind-icon' }, icon(UPDATE_ICON[u.kind] || 'note')),
    h('div', { class: 'grow' },
      u.kind === 'status'
        ? h('div', {}, h('strong', {}, `${TASK_STATUS[u.from_status] || u.from_status} → ${TASK_STATUS[u.to_status] || u.to_status}`))
        : u.kind !== 'comment' && h('div', {}, h('strong', {}, u.body)),
      (u.kind === 'comment' || (u.kind === 'status' && u.body)) && h('div', { class: 'body' }, u.body),
      h('div', { class: 'meta' }, `${u.user_name || 'Unknown'} · ${fmtDate(u.created_at, true)}`)))));

  return layout('tasks',
    pageHead(t.title, null, isManager() && [
      h('a', { class: 'btn btn-secondary', href: `#/tasks/${id}/edit` }, 'Edit'),
      h('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (!confirmAction(`Delete the task "${t.title}"? This cannot be undone.`)) return;
          try {
            await rpc('delete_task', { p_id: id });
            toast('Task deleted');
            location.hash = '#/tasks';
          } catch (e) { toast(e.message, true); }
        },
      }, 'Delete'),
    ], [h('a', { href: '#/tasks' }, '← Tasks'), ' ', taskStatusBadge(t.status)]),
    h('div', { class: 'grid detail-layout' },
      h('div', {},
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Details')),
          h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
          t.description && [h('h3', { class: 'notes-heading' }, 'Description'), h('p', { class: 'prewrap' }, t.description)]),
        statusCard,
        invoicesCard),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Updates')),
        commentForm,
        h('hr', { class: 'divider' }),
        history)));
}

// ---------- types of work (managers) ----------

function workTypeDialog(w, refresh) {
  const dlg = openDialog(`Edit "${w.name}"`, handleForm(h('form', { class: 'form' },
    field('Name', input('name', w.name, { required: true, maxlength: 100 })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: w.active }),
      'In use (switch off to hide it when creating new tasks)'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('save_work_type', { p_id: w.id, p_name: data.name, p_active: data.active });
    dlg.close();
    toast('Saved');
    refresh();
  }));
}

async function viewWorkTypes() {
  if (!isManager()) return viewNotFound();
  const types = await rpc('list_work_types');
  const refresh = () => render();
  const addForm = handleForm(h('form', { class: 'form' },
    h('div', { class: 'inline-form' },
      field('New type of work', input('name', '', { required: true, maxlength: 100, placeholder: 'e.g. Warehousing' })),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add'))),
  async data => {
    await rpc('save_work_type', { p_id: null, p_name: data.name, p_active: true });
    toast(`Added "${data.name.trim()}"`);
    refresh();
  });
  return layout('work-types',
    pageHead('Types of work', 'The choices managers pick from when creating a task.'),
    h('section', { class: 'card' }, addForm),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Open tasks'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, types.map(w => h('tr', {},
        h('td', {}, h('a', { class: 'row-link', href: `#/tasks?type=${w.id}&status=all` }, w.name)),
        h('td', {}, w.open_tasks),
        h('td', {}, w.active ? h('span', { class: 'badge badge-active' }, 'In use') : h('span', { class: 'badge badge-inactive' }, 'Switched off')),
        h('td', {}, h('button', { class: 'btn btn-secondary btn-sm', onclick: () => workTypeDialog(w, refresh) }, 'Edit')))))))));
}

// ---------- invoices ----------

async function viewInvoices(params) {
  const query = new URLSearchParams(params);
  const data = await rpc('list_invoices', {
    p_q: query.get('q') || null, p_kind: query.get('kind') || null, p_status: query.get('status') || null,
    p_page: Number(query.get('page')) || 1,
  });
  const setParam = (key, value) => {
    const q = new URLSearchParams(params);
    if (value) q.set(key, value); else q.delete(key);
    if (key !== 'page') q.delete('page');
    location.hash = '#/invoices' + (q.toString() ? '?' + q : '');
  };
  let searchTimer;
  const filterBar = h('div', { class: 'filters' },
    input('q', query.get('q'), {
      type: 'search', placeholder: 'Search number, customer or task…', 'aria-label': 'Search invoices',
      oninput: e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setParam('q', e.target.value.trim()), 350); },
    }),
    select('kind', query.get('kind'), [['', 'All invoices'], ['proforma', 'Proforma invoices'], ['tax', 'Tax invoices']],
      { 'aria-label': 'Type', onchange: e => setParam('kind', e.target.value) }),
    select('status', query.get('status'), [['', 'Any status'], ['draft', 'Draft'], ['sent', 'Sent'],
      ['unpaid', 'Sent, not paid'], ['paid', 'Paid'], ['cancelled', 'Cancelled']],
      { 'aria-label': 'Status', onchange: e => setParam('status', e.target.value) }));

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const table = data.invoices.length
    ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Number'), h('th', { class: 'hide-sm' }, 'Type'), h('th', {}, 'Customer'),
          h('th', { class: 'hide-sm' }, 'Task'), h('th', { class: 'hide-sm' }, 'Date'),
          h('th', { class: 'num' }, 'Total'), h('th', {}, 'Status'))),
        h('tbody', {}, data.invoices.map(i => h('tr', {},
          h('td', {}, h('a', { class: 'row-link', href: `#/invoices/${i.id}` }, i.number)),
          h('td', { class: 'hide-sm' }, INVOICE_KIND[i.kind]),
          h('td', {}, i.customer_name),
          h('td', { class: 'hide-sm' }, i.task_id ? h('a', { href: `#/tasks/${i.task_id}` }, i.task_title) : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'hide-sm' }, fmtDate(i.issue_date)),
          h('td', { class: 'num' }, money(i.total)),
          h('td', {}, invoiceBadge(i.status)))))))
    : h('p', { class: 'empty' }, [...query.keys()].length ? 'No invoices match these filters.'
        : 'No invoices yet. They are created from a task (or "+ New proforma").');

  return layout('invoices',
    pageHead('Invoices', `${data.total} invoice${data.total === 1 ? '' : 's'}`,
      isManager() && h('a', { class: 'btn btn-primary', href: '#/invoices/new?kind=proforma' }, '+ New proforma')),
    h('section', { class: 'card' },
      filterBar,
      table,
      data.total > data.pageSize && h('div', { class: 'pager' },
        h('span', { class: 'muted' }, `Page ${data.page} of ${pages}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page <= 1, onclick: () => setParam('page', data.page - 1) }, 'Previous'),
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page >= pages, onclick: () => setParam('page', data.page + 1) }, 'Next')))));
}

/** The form for a draft invoice: customer, dates, charge lines with live VAT totals. */
function invoiceForm(inv, kind, customers, onSubmit, cancelHref) {
  const tbody = h('tbody', {});
  const totals = h('dl', { class: 'inv-form-totals' });

  const recalc = () => {
    let net = 0;
    let vat = 0;
    for (const row of tbody.rows) {
      const lineNet = round2(Number(row.querySelector('.l-qty').value) * Number(row.querySelector('.l-price').value));
      const lineVat = row.querySelector('.l-vat').value === 'standard' ? round2(lineNet * 0.05) : 0;
      row.querySelector('.l-amount').textContent = Number.isFinite(lineNet) ? amount(lineNet) : '—';
      net += Number.isFinite(lineNet) ? lineNet : 0;
      vat += lineVat || 0;
    }
    totals.replaceChildren(
      h('dt', {}, 'Total excl. VAT'), h('dd', {}, money(net)),
      h('dt', {}, 'VAT 5%'), h('dd', {}, money(vat)),
      h('dt', { class: 'grand' }, 'Total'), h('dd', { class: 'grand' }, money(round2(net + vat))));
  };

  const addLine = (l = {}) => {
    const row = h('tr', {},
      h('td', {}, h('input', { class: 'l-desc', value: l.description ?? '', required: true, maxlength: 500,
        'aria-label': 'Description', placeholder: 'e.g. Customs clearance fee' })),
      h('td', {}, h('input', { class: 'l-qty', type: 'number', min: '0.001', step: '0.001', value: l.quantity ?? 1,
        required: true, 'aria-label': 'Quantity', oninput: recalc })),
      h('td', {}, h('input', { class: 'l-price', type: 'number', min: '0', step: '0.01', value: l.unit_price ?? '',
        required: true, 'aria-label': 'Unit price in AED', placeholder: '0.00', oninput: recalc })),
      h('td', {}, select('', l.vat_code || 'standard', Object.entries(VAT_CODES), { class: 'l-vat', 'aria-label': 'VAT', onchange: recalc })),
      h('td', { class: 'num l-amount' }),
      h('td', {}, h('button', {
        class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': 'Remove line',
        onclick: () => { if (tbody.rows.length > 1) { row.remove(); recalc(); } },
      }, '×')));
    tbody.append(row);
    recalc();
  };
  (inv.lines && inv.lines.length ? inv.lines : [{}]).forEach(addLine);

  const customerOptions = [['', 'Pick a customer…'], ...customers.map(c => [String(c.id), c.name])];
  return handleForm(h('form', { class: 'form' },
    h('input', { type: 'hidden', name: 'task_id', value: inv.task_id ?? '' }),
    h('input', { type: 'hidden', name: 'proforma_id', value: inv.proforma_id ?? '' }),
    h('div', { class: 'form-grid' },
      field('Customer', select('customer_id', inv.customer_id ? String(inv.customer_id) : '', customerOptions, { required: true }), { full: true }),
      field('Invoice date', input('issue_date', inv.issue_date, { type: 'date', required: true })),
      field(kind === 'tax' ? 'Payment due' : 'Valid until', input('due_date', inv.due_date, { type: 'date' })),
      kind === 'tax' && field('Date of supply', input('supply_date', inv.supply_date, { type: 'date' }),
        { hint: 'When the work was done, if different from the invoice date.' })),
    h('div', { class: 'field', 'data-field': 'lines' },
      h('label', {}, 'Charges (AED)'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'inv-edit' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Description'), h('th', {}, 'Qty'), h('th', {}, 'Unit price'), h('th', {}, 'VAT'),
          h('th', { class: 'num' }, 'Amount'), h('th', {}, ''))),
        tbody)),
      h('div', { class: 'inv-edit-foot' },
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => addLine() }, '+ Add line'),
        totals),
      h('div', { class: 'hint' },
        'Use 0% for international transport, and "No VAT (disbursement)" for costs paid on the customer\'s behalf, such as customs duty.')),
    field('Notes on the invoice (optional)', textarea('notes', inv.notes, { rows: 2, maxlength: 2000,
      placeholder: 'e.g. BL no. MEDU123456, container MSKU1234567' })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, inv.id ? 'Save changes' : `Create ${INVOICE_KIND[kind].toLowerCase()}`),
      h('a', { class: 'btn btn-secondary', href: cancelHref }, 'Cancel'))),
  data => {
    data.kind = kind;
    data.lines = [...tbody.rows].map(row => ({
      description: row.querySelector('.l-desc').value,
      quantity: row.querySelector('.l-qty').value,
      unit_price: row.querySelector('.l-price').value,
      vat_code: row.querySelector('.l-vat').value,
    }));
    return onSubmit(data);
  });
}

function missingTrnNotice(settings) {
  return h('p', { class: 'notice' },
    'Tax invoices must show Lowcaps\' TRN. ',
    state.user.role === 'admin'
      ? h('a', { href: '#/settings' }, 'Add it under Company settings first.')
      : 'Ask an administrator to add it under Company settings first.');
}

async function viewInvoiceNew(params) {
  if (!isManager()) return viewNotFound();
  const kind = params.kind === 'tax' ? 'tax' : 'proforma';
  const taskId = Number(params.task) || null;
  const [customers, settings, taskRes] = await Promise.all([
    rpc('customer_options'), rpc('get_company_settings'), taskId ? rpc('get_task', { p_id: taskId }) : null]);
  const task = taskRes && taskRes.task;

  let lines = [];
  let proformaId = null;
  if (task && kind === 'tax') {
    // Start the tax invoice from the latest proforma's charges, ready to adjust to the final amounts.
    const pro = [...task.invoices].reverse().find(i => i.kind === 'proforma' && i.status !== 'cancelled');
    if (pro) {
      lines = (await rpc('get_invoice', { p_id: pro.id })).invoice.lines;
      proformaId = pro.id;
    }
  }
  if (task && !lines.length) {
    lines = [{ description: task.work_type ? `${task.work_type}: ${task.title}` : task.title, quantity: 1, vat_code: 'standard' }];
  }
  const issue = localToday();
  const inv = {
    task_id: taskId, proforma_id: proformaId, lines, issue_date: issue,
    customer_id: (task && task.customer_id) || Number(params.customer) || null,
    due_date: kind === 'tax' ? addDays(issue, settings.payment_terms_days) : addDays(issue, 7),
    supply_date: kind === 'tax' ? (task && task.completed_at ? new Date(task.completed_at).toLocaleDateString('en-CA') : issue) : null,
  };
  const back = taskId ? `#/tasks/${taskId}` : '#/invoices';
  return layout('invoices',
    pageHead(`New ${INVOICE_KIND[kind].toLowerCase()}`,
      task ? `For task: ${task.title}${proformaId ? ' · charges copied from the proforma, adjust them to the final amounts' : ''}`
        : 'The invoice number is given when you save.',
      null, h('a', { href: back }, '← Back')),
    kind === 'tax' && !settings.trn && missingTrnNotice(settings),
    h('section', { class: 'card' }, invoiceForm(inv, kind, customers, async data => {
      const id = await rpc('save_invoice', { p_id: null, p_data: data });
      toast(`${INVOICE_KIND[kind]} created`);
      location.hash = `#/invoices/${id}`;
    }, back)));
}

async function viewInvoiceEdit(id) {
  if (!isManager()) return viewNotFound();
  const [{ invoice: inv }, customers] = await Promise.all([rpc('get_invoice', { p_id: id }), rpc('customer_options')]);
  if (inv.status !== 'draft') {
    return layout('invoices', pageHead(`${inv.number} can't be edited`, null, null, h('a', { href: `#/invoices/${id}` }, '← Back')),
      h('section', { class: 'card' }, h('p', {}, 'Only draft invoices can be changed. To correct a sent invoice, cancel it and create a new one.')));
  }
  return layout('invoices',
    pageHead(`Edit ${inv.number}`, INVOICE_KIND[inv.kind], null, h('a', { href: `#/invoices/${id}` }, '← Back')),
    h('section', { class: 'card' }, invoiceForm(inv, inv.kind, customers, async data => {
      await rpc('save_invoice', { p_id: id, p_data: data });
      toast('Invoice saved');
      location.hash = `#/invoices/${id}`;
    }, `#/invoices/${id}`)));
}

const VAT_SHORT = { standard: '5%', zero: '0%', exempt: 'Exempt', out_of_scope: 'Out of scope' };
const qtyText = q => Number(q).toLocaleString('en-US', { maximumFractionDigits: 3 });

function supplierLines(sup) {
  return [...String(sup.address || '').split('\n'), [sup.phone, sup.email].filter(Boolean).join(' · '),
    sup.trn && `TRN: ${sup.trn}`].filter(Boolean);
}

function paymentLines(sup) {
  return [sup.account_name && `Account name: ${sup.account_name}`, sup.bank_name && `Bank: ${sup.bank_name}`,
    sup.iban && `IBAN: ${sup.iban}`, sup.swift && `SWIFT: ${sup.swift}`].filter(Boolean);
}

const PROFORMA_NOTE = 'This proforma invoice is not a tax invoice. A tax invoice will be issued when the work is completed.';

/** On-screen version of the invoice, laid out like the PDF. */
function invoiceDocument(inv) {
  const sup = inv.supplier || {};
  const meta = [
    ['Invoice no.', inv.number], ['Date', fmtDate(inv.issue_date)],
    inv.supply_date && ['Date of supply', fmtDate(inv.supply_date)],
    inv.due_date && [inv.kind === 'tax' ? 'Payment due' : 'Valid until', fmtDate(inv.due_date)],
    inv.proforma_number && ['Proforma ref.', inv.proforma_number],
  ].filter(Boolean);
  const pay = paymentLines(sup);
  return h('article', { class: 'inv-doc', 'aria-label': `${INVOICE_KIND[inv.kind]} ${inv.number}` },
    h('header', { class: 'inv-head' },
      h('div', {},
        h('div', { class: 'inv-supplier' }, sup.legal_name || 'Lowcaps'),
        supplierLines(sup).map(l => h('div', { class: 'muted' }, l))),
      h('div', { class: 'inv-title-block' },
        h('div', { class: 'inv-title' }, inv.kind === 'tax' ? 'TAX INVOICE' : 'PROFORMA INVOICE'),
        h('dl', { class: 'inv-meta' }, meta.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])))),
    h('section', { class: 'inv-billto' },
      h('div', { class: 'inv-label' }, 'Bill to'),
      h('strong', {}, inv.customer_name),
      inv.customer_address && h('div', { class: 'prewrap' }, inv.customer_address),
      inv.customer_trn && h('div', {}, `TRN: ${inv.customer_trn}`)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'inv-lines' },
      h('thead', {}, h('tr', {},
        h('th', {}, '#'), h('th', {}, 'Description'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Unit price'),
        h('th', {}, 'VAT'), h('th', { class: 'num' }, 'Amount'), h('th', { class: 'num' }, 'VAT (AED)'))),
      h('tbody', {}, inv.lines.map((l, i) => h('tr', {},
        h('td', {}, i + 1), h('td', { class: 'prewrap' }, l.description), h('td', { class: 'num' }, qtyText(l.quantity)),
        h('td', { class: 'num' }, amount(l.unit_price)), h('td', {}, VAT_SHORT[l.vat_code]),
        h('td', { class: 'num' }, amount(l.net)), h('td', { class: 'num' }, amount(l.vat))))))),
    h('dl', { class: 'inv-totals' },
      h('dt', {}, 'Total excl. VAT'), h('dd', {}, money(inv.subtotal)),
      h('dt', {}, 'VAT 5%'), h('dd', {}, money(inv.vat_total)),
      h('dt', { class: 'grand' }, 'Total (AED)'), h('dd', { class: 'grand' }, money(inv.total))),
    inv.notes && h('p', { class: 'prewrap' }, inv.notes),
    pay.length > 0 && h('section', { class: 'inv-pay' }, h('div', { class: 'inv-label' }, 'Payment details'), pay.map(l => h('div', {}, l))),
    sup.invoice_notes && h('p', { class: 'muted prewrap' }, sup.invoice_notes),
    inv.kind === 'proforma' && h('p', { class: 'muted' }, PROFORMA_NOTE));
}

/** The standard PDF fonts only cover Western European characters; swap or drop anything else. */
function pdfText(text) {
  return String(text ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/→/g, '->').replace(/…/g, '...').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');
}

function buildInvoicePdf(inv) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const sup = inv.supplier || {};
  const GREEN = [74, 122, 92];
  const DARK = [28, 42, 34];
  const GREY = [90, 107, 96];
  const W = 210;
  const M = 15;
  const LH = 4.3;
  const ensureSpace = (y, needed) => (y + needed > 280 ? (doc.addPage(), M + 5) : y);

  // Supplier (left) and title + invoice details (right)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...GREEN);
  doc.text(pdfText(sup.legal_name || 'Lowcaps'), M, M + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY);
  const supLines = supplierLines(sup).map(pdfText);
  supLines.forEach((l, i) => doc.text(l, M, M + 11 + i * LH));

  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...DARK);
  doc.text(inv.kind === 'tax' ? 'TAX INVOICE' : 'PROFORMA INVOICE', W - M, M + 5, { align: 'right' });
  const meta = [
    ['Invoice no.', inv.number], ['Date', fmtDate(inv.issue_date)],
    inv.supply_date && ['Date of supply', fmtDate(inv.supply_date)],
    inv.due_date && [inv.kind === 'tax' ? 'Payment due' : 'Valid until', fmtDate(inv.due_date)],
    inv.proforma_number && ['Proforma ref.', inv.proforma_number],
  ].filter(Boolean);
  doc.setFontSize(9);
  meta.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...GREY); doc.text(`${k}:`, W - M - 32, M + 12 + i * 5, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...DARK); doc.text(pdfText(v), W - M, M + 12 + i * 5, { align: 'right' });
  });
  let y = Math.max(M + 11 + supLines.length * LH, M + 12 + meta.length * 5) + 6;
  doc.setDrawColor(219, 229, 222); doc.line(M, y, W - M, y);
  y += 7;

  // Bill to
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GREY); doc.text('BILL TO', M, y);
  doc.setFontSize(11); doc.setTextColor(...DARK); doc.text(pdfText(inv.customer_name), M, y + 5.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const billLines = [...String(inv.customer_address || '').split('\n'), inv.customer_trn && `TRN: ${inv.customer_trn}`].filter(Boolean).map(pdfText);
  billLines.forEach((l, i) => doc.text(l, M, y + 10.5 + i * LH));
  y += 10.5 + billLines.length * LH + 3;

  // Charges
  window.autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['#', 'Description', 'Qty', 'Unit price', 'VAT', 'Amount', 'VAT (AED)']],
    body: inv.lines.map((l, i) => [i + 1, pdfText(l.description), qtyText(l.quantity), amount(l.unit_price),
      VAT_SHORT[l.vat_code], amount(l.net), amount(l.vat)]),
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: DARK, lineColor: [219, 229, 222], lineWidth: 0.1 },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8 }, 2: { halign: 'right', cellWidth: 14 }, 3: { halign: 'right', cellWidth: 24 },
      4: { cellWidth: 23 }, 5: { halign: 'right', cellWidth: 25 }, 6: { halign: 'right', cellWidth: 22 },
    },
    didParseCell: cell => {
      if (cell.section === 'head' && [2, 3, 5, 6].includes(cell.column.index)) cell.cell.styles.halign = 'right';
    },
  });
  y = ensureSpace(doc.lastAutoTable.finalY + 7, 24);

  // Totals
  const rows = [['Total excl. VAT', money(inv.subtotal)], ['VAT 5%', money(inv.vat_total)], ['Total (AED)', money(inv.total)]];
  rows.forEach(([k, v], i) => {
    const last = i === rows.length - 1;
    doc.setFont('helvetica', last ? 'bold' : 'normal'); doc.setFontSize(last ? 11 : 9.5); doc.setTextColor(...DARK);
    doc.text(k, W - M - 45, y + i * 6, { align: 'right' });
    doc.text(v, W - M, y + i * 6, { align: 'right' });
  });
  y += rows.length * 6 + 6;

  // Notes, payment details, footer text
  const block = (title, lines) => {
    if (!lines.length) return;
    const wrapped = lines.flatMap(l => doc.splitTextToSize(pdfText(l), W - 2 * M));
    y = ensureSpace(y, 6 + wrapped.length * LH);
    if (title) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GREY); doc.text(title.toUpperCase(), M, y);
      y += 5;
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...DARK);
    wrapped.forEach(l => { doc.text(l, M, y); y += LH; });
    y += 4;
  };
  block('Notes', inv.notes ? String(inv.notes).split('\n') : []);
  block('Payment details', paymentLines(sup));
  block('', sup.invoice_notes ? String(sup.invoice_notes).split('\n') : []);
  if (inv.kind === 'proforma') block('', [PROFORMA_NOTE]);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY);
    doc.text(`${inv.number} · Page ${p} of ${pages}`, W - M, 290, { align: 'right' });
  }
  return doc;
}

function downloadInvoicePdf(inv) {
  try {
    buildInvoicePdf(inv).save(`${inv.number}.pdf`);
  } catch (err) {
    console.error(err);
    toast('Could not create the PDF: ' + err.message, true);
  }
}

function invoiceEmail(inv) {
  const sup = inv.supplier || {};
  const label = inv.kind === 'tax' ? 'Tax Invoice' : 'Proforma Invoice';
  const about = inv.task_title ? ` for ${inv.task_title}` : '';
  const pay = paymentLines(sup);
  const body = [
    `Dear ${inv.customer_name},`, '',
    `Please find attached our ${label.toLowerCase()} ${inv.number}${about}.`, '',
    `Total: ${money(inv.total)} (including VAT of ${money(inv.vat_total)})`,
    inv.due_date ? `${inv.kind === 'tax' ? 'Payment due' : 'Valid until'}: ${fmtDate(inv.due_date)}` : null,
    ...(pay.length ? ['', 'Payment details:', ...pay] : []),
    '', 'Kind regards,', state.user.name, sup.legal_name, sup.phone,
  ].filter(l => typeof l === 'string').join('\n');
  return { subject: `${label} ${inv.number} from ${sup.legal_name || 'Lowcaps'}`, body };
}

/** "Prepare email" flow: download the PDF, open Gmail or the email app pre-filled, then record it as sent. */
function emailDialog(inv, refresh) {
  const draft = invoiceEmail(inv);
  const to = input('to', inv.sent_to || inv.recipients[0] || '', { type: 'email', multiple: true, required: true, list: 'inv-recipients' });
  const subject = input('subject', draft.subject, { maxlength: 300 });
  const body = textarea('body', draft.body, { rows: 9 });
  const enc = encodeURIComponent;
  const addresses = () => to.value.split(',').map(a => a.trim()).filter(Boolean);
  const needTo = () => {
    if (addresses().length) return true;
    to.reportValidity();
    return false;
  };
  const dlg = openDialog(`Email ${inv.number} to the customer`, h('div', { class: 'form' },
    h('datalist', { id: 'inv-recipients' }, inv.recipients.map(r => h('option', { value: r }))),
    field('To', to, { hint: inv.recipients.length ? 'From the customer and its contacts. Separate several with commas.' : 'No email saved for this customer.' }),
    field('Subject', subject),
    field('Message', body),
    h('ol', { class: 'steps' },
      h('li', {}, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => downloadInvoicePdf(inv) },
        icon('download'), `Download ${inv.number}.pdf`)),
      h('li', {}, h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-secondary btn-sm', type: 'button',
          onclick: () => {
            if (!needTo()) return;
            window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${enc(addresses().join(','))}&su=${enc(subject.value)}&body=${enc(body.value)}`,
              '_blank', 'noopener');
          },
        }, 'Open in Gmail'),
        h('button', {
          class: 'btn btn-secondary btn-sm', type: 'button',
          onclick: () => {
            if (!needTo()) return;
            location.href = `mailto:${addresses().map(enc).join(',')}?subject=${enc(subject.value)}&body=${enc(body.value)}`;
          },
        }, 'Open email app'),
        h('button', {
          class: 'btn btn-secondary btn-sm', type: 'button',
          onclick: async () => {
            try { await navigator.clipboard.writeText(body.value); toast('Message copied'); } catch { toast('Could not copy; select the text instead', true); }
          },
        }, 'Copy message'))),
      h('li', {}, 'Attach the PDF to the email and send it. Then:')),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: async () => {
          if (!needTo()) return;
          try {
            await rpc('mark_invoice_sent', { p_id: inv.id, p_to: addresses().join(', ') });
            dlg.close();
            toast(`${inv.number} marked as sent`);
            refresh();
          } catch (err) { toast(err.message, true); }
        },
      }, 'I\'ve sent it'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Close'))));
}

async function viewInvoice(id) {
  const { invoice: inv } = await rpc('get_invoice', { p_id: id });
  const refresh = () => render();
  const act = (fn, args, message) => async () => {
    try {
      await rpc(fn, args);
      toast(message);
      refresh();
    } catch (err) { toast(err.message, true); }
  };
  const live = inv.status !== 'cancelled';
  const actions = [
    h('button', { class: 'btn btn-secondary', onclick: () => downloadInvoicePdf(inv) }, icon('download'), 'PDF'),
    isManager() && live && h('button', { class: 'btn btn-primary', onclick: () => emailDialog(inv, refresh) },
      inv.sent_at ? 'Email again' : 'Email to customer'),
    isManager() && inv.status === 'draft' && h('a', { class: 'btn btn-secondary', href: `#/invoices/${id}/edit` }, 'Edit'),
    isManager() && live && inv.kind === 'proforma' && inv.task_id &&
      h('a', { class: 'btn btn-secondary', href: `#/invoices/new?kind=tax&task=${inv.task_id}` }, 'Create tax invoice'),
    isManager() && inv.status === 'sent' && h('button', { class: 'btn btn-secondary', onclick: act('set_invoice_paid', { p_id: id, p_paid: true }, 'Marked as paid') }, 'Mark as paid'),
    isManager() && inv.status === 'paid' && h('button', { class: 'btn btn-secondary', onclick: act('set_invoice_paid', { p_id: id, p_paid: false }, 'Marked as not paid') }, 'Mark as not paid'),
    isManager() && live && h('button', {
      class: 'btn btn-danger',
      onclick: () => {
        if (confirmAction(`Cancel ${inv.number}? It stays on record as cancelled; its number is not reused.`)) {
          act('cancel_invoice', { p_id: id }, 'Invoice cancelled')();
        }
      },
    }, 'Cancel invoice'),
  ];
  const history = [
    `Created ${fmtDate(inv.created_at, true)}${inv.created_by_name ? ' by ' + inv.created_by_name : ''}`,
    inv.sent_at && `Sent to ${inv.sent_to || 'the customer'} on ${fmtDate(inv.sent_at, true)}`,
    inv.paid_at && `Paid on ${fmtDate(inv.paid_at, true)}`,
    inv.cancelled_at && `Cancelled on ${fmtDate(inv.cancelled_at, true)}`,
  ].filter(Boolean).join(' · ');

  return layout('invoices',
    pageHead(inv.number, history, actions, [
      h('a', { href: inv.task_id ? `#/tasks/${inv.task_id}` : '#/invoices' }, inv.task_id ? `← ${inv.task_title}` : '← Invoices'),
      ' ', invoiceBadge(inv.status)]),
    inv.status === 'draft' && isManager() && h('p', { class: 'notice' },
      'Draft: check the charges, then click "Email to customer". Once sent, the invoice can no longer be changed.'),
    h('section', { class: 'card' }, invoiceDocument(inv)));
}

// ---------- company settings (admins) ----------

async function viewCompanySettings() {
  if (state.user.role !== 'admin') return viewNotFound();
  const c = await rpc('get_company_settings');
  const form = handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field('Company legal name', input('legal_name', c.legal_name, { required: true, maxlength: 200 }), { full: true }),
      field('Address', textarea('address', c.address, { rows: 3, maxlength: 500 }), { full: true }),
      field('Phone', input('phone', c.phone, { maxlength: 50 })),
      field('Accounts email', input('email', c.email, { type: 'email', maxlength: 200 })),
      field('TRN (VAT registration number)', input('trn', c.trn, { inputmode: 'numeric', placeholder: '15 digits' }),
        { hint: 'Required on tax invoices.' }),
      field('Payment terms (days)', input('payment_terms_days', c.payment_terms_days, { type: 'number', min: 0, max: 365 }),
        { hint: 'Sets the default due date on tax invoices.' }),
      field('Bank name', input('bank_name', c.bank_name, { maxlength: 200 })),
      field('Account name', input('account_name', c.account_name, { maxlength: 200 })),
      field('IBAN', input('iban', c.iban, { maxlength: 50, placeholder: 'AE07 0331 2345 6789 0123 456' })),
      field('SWIFT / BIC', input('swift', c.swift, { maxlength: 20 })),
      field('Note printed on every invoice (optional)', textarea('invoice_notes', c.invoice_notes, { rows: 2, maxlength: 2000,
        placeholder: 'e.g. Thank you for your business. Please quote the invoice number with your payment.' }), { full: true })),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'))),
  async data => {
    await rpc('save_company_settings', { p_data: data });
    toast('Company settings saved');
    render();
  });
  return layout('settings',
    pageHead('Company settings', 'Printed on every new invoice. Invoices already created keep the details they were made with.'),
    h('section', { class: 'card' }, form));
}

// ---------- users (admin) ----------

function userDialog(u, refresh) {
  const isSelf = u.id === state.user.id;
  const dlg = openDialog(`Edit ${u.name}`, handleForm(h('form', { class: 'form' },
    h('p', { class: 'muted' }, u.email),
    field('Name', input('name', u.name, { required: true, maxlength: 100 })),
    field('Role', select('role', u.role, ROLE_OPTIONS, { disabled: isSelf }),
      { hint: 'Managers create and assign tasks and can delete customers. Administrators can also manage users.' }),
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
        h('td', {}, ROLE_LABEL[u.role] || u.role),
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
      h('p', {}, 'Quotes & invoices and expenses & reports are planned as the next ERP modules. They will link to the customers and tasks you add now.'),
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
      else if (path === '/tasks') view = await viewTasks(params);
      else if (path === '/tasks/new') view = await viewTaskNew(params);
      else if ((m = path.match(/^\/tasks\/(\d+)$/))) view = await viewTask(Number(m[1]));
      else if ((m = path.match(/^\/tasks\/(\d+)\/edit$/))) view = await viewTaskEdit(Number(m[1]));
      else if (path === '/work-types') view = await viewWorkTypes();
      else if (path === '/invoices') view = await viewInvoices(params);
      else if (path === '/invoices/new') view = await viewInvoiceNew(params);
      else if ((m = path.match(/^\/invoices\/(\d+)$/))) view = await viewInvoice(Number(m[1]));
      else if ((m = path.match(/^\/invoices\/(\d+)\/edit$/))) view = await viewInvoiceEdit(Number(m[1]));
      else if (path === '/settings') view = await viewCompanySettings();
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
        h('section', { class: 'card' }, h('a', { href: '#/' }, 'Back to the dashboard'))));
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
