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
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  badge: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.7-1.8 2-2.7 3.5-2.7s2.8.9 3.5 2.7M15 10h4M15 14h3"/>',
  renew: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
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

const ROLE_LABEL = { admin: 'Administrator', manager: 'Manager', staff: 'Team member', employee: 'Employee (HR only)' };
const ROLE_OPTIONS = [['employee', 'Employee (HR only)'], ['staff', 'Team member'], ['manager', 'Manager'], ['admin', 'Administrator']];
const isEmployee = () => state.user?.role === 'employee';
const TASK_STATUS = { new: 'New', in_progress: 'In progress', waiting: 'Waiting', done: 'Done', cancelled: 'Cancelled' };
const PRIORITY = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
const INVOICE_KIND = { proforma: 'Proforma invoice', tax: 'Tax invoice' };
const INVOICE_STATUS = { draft: 'Draft', sent: 'Sent', paid: 'Paid', cancelled: 'Cancelled' };
const VAT_CODES = { standard: '5% VAT', zero: '0% (zero-rated)', exempt: 'Exempt', out_of_scope: 'No VAT (disbursement)' };
const invoiceBadge = st => h('span', { class: `badge inv-${st}` }, INVOICE_STATUS[st] || st);
/** Status including payments: "Overdue · 12 days" or "Partly paid" for sent invoices with a balance. */
function invoiceStateBadge(i, today) {
  const balance = Math.round((Number(i.total) - Number(i.amount_paid || 0)) * 100) / 100;
  if (i.status === 'sent' && balance > 0) {
    if (i.kind === 'tax' && i.due_date && today && i.due_date < today) {
      const days = Math.round((Date.parse(today) - Date.parse(i.due_date)) / 86400000);
      return h('span', { class: 'badge badge-overdue' }, `Overdue · ${days} day${days === 1 ? '' : 's'}`);
    }
    if (Number(i.amount_paid) > 0) return h('span', { class: 'badge inv-partial' }, 'Partly paid');
  }
  return invoiceBadge(i.status);
}
const balanceText = i => (Number(i.amount_paid) > 0 && Number(i.total) > Number(i.amount_paid)
  ? `balance ${money(Number(i.total) - Number(i.amount_paid))}` : null);
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
      isEmployee() ? h('nav', { class: 'nav', 'aria-label': 'Main' },
        link('#/hr', 'home', 'My HR', 'hr'),
        link('#/hr/attendance?mine=1', 'follow_up', 'Attendance', 'hr-attendance'),
        link('#/hr/leave', 'meeting', 'Leave', 'hr-leave'),
        link('#/hr/payslips', 'invoice', 'Payslips', 'hr-payslips'),
        link('#/hr/people', 'users', 'Team', 'hr-people'))
      : h('nav', { class: 'nav', 'aria-label': 'Main' },
        link('#/', 'home', 'Dashboard', 'dashboard'),
        link('#/customers', 'users', 'Customers', 'customers'),
        link('#/tasks', 'task', 'Tasks', 'tasks'),
        link('#/renewals', 'renew', 'Renewals', 'renewals'),
        link('#/invoices', 'invoice', 'Invoices', 'invoices'),
        link('#/payments', 'cash', 'Payments', 'payments'),
        isManager() && h('div', { class: 'nav-heading' }, 'Finance'),
        isManager() && link('#/finance', 'chart', 'Overview', 'finance'),
        isManager() && link('#/finance/journals', 'note', 'Journal entries', 'finance-journals'),
        isManager() && link('#/finance/bank', 'cash', 'Bank & cash', 'finance-bank'),
        isManager() && link('#/finance/reports', 'chart', 'Reports', 'finance-reports'),
        isManager() && link('#/finance/accounts', 'tag', 'Chart of accounts', 'finance-accounts'),
        h('div', { class: 'nav-heading' }, 'HR'),
        link('#/hr', 'badge', 'My HR', 'hr'),
        link('#/hr/attendance', 'follow_up', 'Attendance', 'hr-attendance'),
        link('#/hr/leave', 'meeting', 'Leave', 'hr-leave'),
        link('#/hr/payslips', 'invoice', 'Payslips', 'hr-payslips'),
        link('#/hr/people', 'users', 'Team', 'hr-people'),
        h('div', { class: 'nav-heading' }, 'Next modules'),
        soon('chart', 'Expenses & reports'),
        isManager() && h('div', { class: 'nav-heading' }, 'Manage'),
        isManager() && link('#/work-types', 'tag', 'Types', 'work-types'),
        isAdmin && link('#/users', 'key', 'Users', 'users'),
        isAdmin && link('#/settings', 'gear', 'Company settings', 'settings')),
      h('div', { class: 'sidebar-user' },
        h('strong', {}, state.user.name),
        h('span', { class: 'muted' }, ROLE_LABEL[state.user.role] || state.user.role),
        h('div', { class: 'row' },
          h('a', { href: '#/account' }, 'Account'),
          h('button', { onclick: logout }, 'Log out')))),
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
      h('button', { class: 'btn btn-secondary', onclick: logout }, 'Log out')));
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
  const [d, hr] = await Promise.all([rpc('dashboard'), rpc('my_hr')]);
  const weekend = hr.settings.weekend_days.includes(new Date(hr.today + 'T00:00:00').getDay());
  const hrNotices = [
    !hr.attendance && !hr.on_leave && !weekend && h('p', { class: 'notice' }, 'You haven\'t signed in today. ',
      h('a', { href: '#/hr' }, 'Sign in now')),
    hr.pendingApprovals > 0 && h('p', { class: 'notice' },
      h('a', { href: '#/hr/leave' }, `${hr.pendingApprovals} leave request${hr.pendingApprovals > 1 ? 's are' : ' is'} waiting for approval`)),
  ];
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
    hrNotices,
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
          h('div', { class: 'card-head' }, h('h2', {}, 'Renewals due'),
            d.renewalsOverdue > 0 && h('span', { class: 'badge badge-overdue' }, `${d.renewalsOverdue} overdue`),
            h('a', { class: 'btn btn-secondary btn-sm', href: '#/renewals' }, 'See all')),
          d.renewalsDue.length
            ? h('ul', { class: 'list' }, d.renewalsDue.map(r => h('li', {},
                h('span', { class: 'kind-icon' }, icon('renew')),
                h('div', { class: 'grow' },
                  h('a', { class: 'row-link', href: `#/renewals/${r.id}` }, renewalLabel(r)),
                  h('div', { class: 'meta' }, [r.customer_name, r.last_reminded_at ? `reminded ${fmtDate(r.last_reminded_at)}` : 'not reminded yet']
                    .join(' · '))),
                renewalBadge(r.due_date, d.today, Infinity))))
            : h('p', { class: 'empty' }, 'No renewals due right now.'),
          d.renewalsDueCount > d.renewalsDue.length && h('p', { class: 'notice-inline' },
            h('a', { href: '#/renewals' }, `See all ${d.renewalsDueCount} renewals due`))),
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
          h('div', { class: 'card-head' }, h('h2', {}, 'Ready to invoice')),
          d.toInvoice.length
            ? h('ul', { class: 'list' }, d.toInvoice.map(t => h('li', {},
                h('span', { class: 'kind-icon' }, icon('invoice')),
                h('div', { class: 'grow' },
                  h('a', { class: 'row-link', href: `#/tasks/${t.id}` }, t.title),
                  h('div', { class: 'meta' }, `${t.customer_name}${t.completed_at ? ' · done ' + fmtDate(t.completed_at) : ''}`)),
                h('a', { class: 'btn btn-primary btn-sm', href: `#/invoices/new?kind=tax&task=${t.id}` }, 'Create tax invoice'))))
            : h('p', { class: 'empty' }, 'Every finished task has a tax invoice.')),
        isManager() && h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Money owed to us'),
            h('a', { class: 'btn btn-secondary btn-sm', href: '#/invoices?status=unpaid' }, 'See all')),
          h('dl', { class: 'pay-summary' },
            h('div', {}, h('dt', {}, 'Outstanding'), h('dd', {}, money(d.receivables.outstanding))),
            h('div', { class: d.receivables.overdue > 0 ? 'is-overdue' : '' },
              h('dt', {}, `Overdue (${d.receivables.overdueCount} invoice${d.receivables.overdueCount === 1 ? '' : 's'})`),
              h('dd', {}, money(d.receivables.overdue)))),
          d.overdueInvoices.length
            ? h('ul', { class: 'list' }, d.overdueInvoices.map(i => h('li', {},
                h('div', { class: 'grow' },
                  h('a', { class: 'row-link', href: `#/invoices/${i.id}` }, i.number),
                  h('div', { class: 'meta' }, [i.customer_name, `due ${fmtDate(i.due_date)}`,
                    i.payment_reminded_at ? `reminded ${fmtDate(i.payment_reminded_at)}` : 'not reminded yet'].join(' · '))),
                h('div', { class: 'badge-stack' }, h('strong', {}, money(i.balance)),
                  h('span', { class: 'badge badge-overdue' }, `${daysBetween(i.due_date, d.today)} days late`)))))
            : h('p', { class: 'empty' }, 'Nothing overdue.')),
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
    c.balance.outstanding > 0 && ['Balance owed', h('span', {}, money(c.balance.outstanding),
      c.balance.overdue > 0 && [' ', h('span', { class: 'badge badge-overdue' }, `${money(c.balance.overdue)} overdue`)])],
  ].filter(f => f && f[1]);

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
                h('div', { class: 'badge-stack' }, h('strong', {}, money(i.total)), balanceText(i) && h('span', { class: 'meta' }, balanceText(i)),
                  invoiceStateBadge(i, today)))))
            : h('p', { class: 'empty' }, 'No invoices yet.')),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Renewals'),
            h('a', { class: 'btn btn-secondary btn-sm', href: `#/renewals/new?customer=${id}` }, '+ Add renewal')),
          c.renewals.length
            ? h('ul', { class: 'list' }, c.renewals.map(r => h('li', {},
                h('div', { class: 'grow' },
                  h('a', { class: 'row-link', href: `#/renewals/${r.id}` }, renewalLabel(r)),
                  h('div', { class: 'meta' }, periodText(r.interval_months))),
                renewalBadge(r.due_date, today, r.remind_days, r.active))))
            : h('p', { class: 'empty' }, 'No renewals yet. Add VAT returns, trade license, visas… to get reminded in time.'))),
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
          h('div', { class: 'badge-stack' }, h('strong', {}, money(i.total)), balanceText(i) && h('span', { class: 'meta' }, balanceText(i)),
            invoiceStateBadge(i, today)))))
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

function workTypeDialog(w, refresh, accounts = []) {
  const dlg = openDialog(`Edit "${w.name}"`, handleForm(h('form', { class: 'form' },
    field('Name', input('name', w.name, { required: true, maxlength: 100 })),
    accounts.length > 0 && field('Income account', accountSelect('revenue_account_id', w.revenue_account_id, accounts, {}, a => a.type === 'income'),
      { hint: 'Tax invoices for tasks of this type are posted to this account (empty: "Other operating revenue").' }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: w.active }),
      'In use (switch off to hide it when creating new tasks)'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('save_work_type', { p_id: w.id, p_name: data.name, p_active: data.active });
    if ('revenue_account_id' in data) await rpc('set_work_type_account', { p_id: w.id, p_account_id: data.revenue_account_id || null });
    dlg.close();
    toast('Saved');
    refresh();
  }));
}

async function viewWorkTypes() {
  if (!isManager()) return viewNotFound();
  const [types, renewalTypes, accounts] = await Promise.all([rpc('list_work_types'), rpc('list_renewal_types'), rpc('list_accounts', { p_include_inactive: false })]);
  const refresh = () => render();
  const addForm = handleForm(h('form', { class: 'form' },
    h('div', { class: 'inline-form' },
      field('New type of work', input('name', '', { required: true, maxlength: 100, placeholder: 'e.g. Warehousing' })),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add type of work'))),
  async data => {
    await rpc('save_work_type', { p_id: null, p_name: data.name, p_active: true });
    toast(`Added "${data.name.trim()}"`);
    refresh();
  });
  return layout('work-types',
    pageHead('Types', 'The lists people pick from when creating tasks and renewals.'),
    renewalTypesCard(renewalTypes, refresh),
    h('section', { class: 'card' }, h('h2', {}, 'Types of work'), addForm),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Open tasks'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, types.map(w => h('tr', {},
        h('td', {}, h('a', { class: 'row-link', href: `#/tasks?type=${w.id}&status=all` }, w.name)),
        h('td', {}, w.open_tasks),
        h('td', {}, w.active ? h('span', { class: 'badge badge-active' }, 'In use') : h('span', { class: 'badge badge-inactive' }, 'Switched off')),
        h('td', {}, h('button', { class: 'btn btn-secondary btn-sm', onclick: () => workTypeDialog(w, refresh, accounts) }, 'Edit')))))))));
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
      ['unpaid', 'Balance owed'], ['overdue', 'Overdue'], ['partial', 'Partly paid'], ['paid', 'Paid'], ['cancelled', 'Cancelled']],
      { 'aria-label': 'Status', onchange: e => setParam('status', e.target.value) }));

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const table = data.invoices.length
    ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Number'), h('th', { class: 'hide-sm' }, 'Type'), h('th', {}, 'Customer'),
          h('th', { class: 'hide-sm' }, 'Task'), h('th', { class: 'hide-sm' }, 'Date'),
          h('th', { class: 'num' }, 'Total'), h('th', { class: 'num hide-sm' }, 'Balance'), h('th', {}, 'Status'))),
        h('tbody', {}, data.invoices.map(i => h('tr', {},
          h('td', {}, h('a', { class: 'row-link', href: `#/invoices/${i.id}` }, i.number)),
          h('td', { class: 'hide-sm' }, INVOICE_KIND[i.kind]),
          h('td', {}, i.customer_name),
          h('td', { class: 'hide-sm' }, i.task_id ? h('a', { href: `#/tasks/${i.task_id}` }, i.task_title) : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'hide-sm' }, fmtDate(i.issue_date)),
          h('td', { class: 'num' }, money(i.total)),
          h('td', { class: 'num hide-sm' }, i.status === 'cancelled' ? '—' : money(Number(i.total) - Number(i.amount_paid))),
          h('td', {}, invoiceStateBadge(i, data.today)))))))
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
      h('dt', { class: 'grand' }, 'Total (AED)'), h('dd', { class: 'grand' }, money(inv.total)),
      Number(inv.amount_paid) > 0 && [
        h('dt', {}, 'Paid'), h('dd', {}, `- ${money(inv.amount_paid)}`),
        h('dt', { class: 'grand' }, 'Balance due'), h('dd', { class: 'grand' }, money(Number(inv.total) - Number(inv.amount_paid)))]),
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
  if (Number(inv.amount_paid) > 0) {
    rows.push(['Paid', `- ${money(inv.amount_paid)}`], ['Balance due', money(Number(inv.total) - Number(inv.amount_paid))]);
  }
  rows.forEach(([k, v], i) => {
    const last = k.startsWith('Total (') || k === 'Balance due';
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

/**
 * Email from the user's own mailbox: Gmail or the email app opens pre-filled (an attachment, if any,
 * is downloaded first and attached by hand); "I've sent it" then calls onSent(addresses).
 */
function composeEmail({ title, recipients, to: toValue, subject: subjectValue, body: bodyValue, attachment, onSent }) {
  const to = input('to', toValue, { type: 'email', multiple: true, required: true, list: 'compose-recipients' });
  const subject = input('subject', subjectValue, { maxlength: 300 });
  const body = textarea('body', bodyValue, { rows: 9 });
  const enc = encodeURIComponent;
  const addresses = () => to.value.split(',').map(a => a.trim()).filter(Boolean);
  const needTo = () => {
    if (addresses().length) return true;
    to.reportValidity();
    return false;
  };
  const dlg = openDialog(title, h('div', { class: 'form' },
    h('datalist', { id: 'compose-recipients' }, recipients.map(r => h('option', { value: r }))),
    field('To', to, { hint: recipients.length ? 'From the customer and its contacts. Separate several with commas.' : 'No email saved for this customer.' }),
    field('Subject', subject),
    field('Message', body),
    h('ol', { class: 'steps' },
      attachment && h('li', {}, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: attachment.download },
        icon('download'), attachment.label)),
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
      h('li', {}, attachment ? 'Attach the PDF to the email and send it. Then:' : 'Send the email. Then:')),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: async () => {
          if (!needTo()) return;
          try {
            await onSent(addresses().join(', '));
            dlg.close();
          } catch (err) { toast(err.message, true); }
        },
      }, 'I\'ve sent it'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Close'))));
}

function emailDialog(inv, refresh) {
  const draft = invoiceEmail(inv);
  composeEmail({
    title: `Email ${inv.number} to the customer`,
    recipients: inv.recipients,
    to: inv.sent_to || inv.recipients[0] || '',
    subject: draft.subject,
    body: draft.body,
    attachment: { label: `Download ${inv.number}.pdf`, download: () => downloadInvoicePdf(inv) },
    onSent: async to => {
      await rpc('mark_invoice_sent', { p_id: inv.id, p_to: to });
      toast(`${inv.number} marked as sent`);
      refresh();
    },
  });
}

async function viewInvoice(id) {
  const { invoice: inv, today } = await rpc('get_invoice', { p_id: id });
  const balance = round2(inv.total - inv.amount_paid);
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
    isManager() && inv.kind === 'tax' && inv.status === 'sent' && balance > 0 &&
      h('button', { class: 'btn btn-secondary', onclick: () => paymentReminderDialog(inv, refresh) }, 'Payment reminder'),
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
      ' ', invoiceStateBadge(inv, today)]),
    inv.status === 'draft' && isManager() && h('p', { class: 'notice' },
      'Draft: check the charges, then click "Email to customer". Once sent, the invoice can no longer be changed.'),
    inv.status !== 'cancelled' && paymentsCard(inv, today, refresh),
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
    h('section', { class: 'card' }, form),
    hrSettingsCard(await rpc('get_hr_settings')));
}

// ---------- renewals ----------

const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

/** Add months like PostgreSQL does: 31 Jan + 1 month = 28/29 Feb. */
function addMonths(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + Number(months), 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

function periodText(months) {
  if (months % 12 === 0) return months === 12 ? 'Every year' : `Every ${months / 12} years`;
  return months === 1 ? 'Every month' : `Every ${months} months`;
}

/** Red when overdue, amber inside the reminder window, plain otherwise. */
function renewalBadge(due, today, remindDays, active = true) {
  if (!active) return h('span', { class: 'badge badge-inactive' }, 'Stopped');
  const left = daysBetween(today, due);
  if (left < 0) return h('span', { class: 'badge badge-overdue' }, `Overdue by ${-left} day${left === -1 ? '' : 's'} · ${fmtDate(due)}`);
  if (left <= remindDays) {
    return h('span', { class: 'badge badge-lead' }, left === 0 ? `Due today · ${fmtDate(due)}` : `Due in ${left} day${left === 1 ? '' : 's'} · ${fmtDate(due)}`);
  }
  return h('span', { class: 'badge badge-plain' }, `Due ${fmtDate(due)}`);
}

const renewalLabel = r => [r.type_name || 'Renewal', r.reference].filter(Boolean).join(' · ');

async function viewRenewals(params) {
  const query = new URLSearchParams(params);
  const win = query.get('window') || 'due';
  const [types, data] = await Promise.all([
    rpc('list_renewal_types'),
    rpc('list_renewals', {
      p_q: query.get('q') || null, p_window: win, p_type: Number(query.get('type')) || null,
      p_assignee: query.get('assignee') || null, p_page: Number(query.get('page')) || 1,
    }),
    loadUsers(),
  ]);
  const setParam = (key, value) => {
    const q = new URLSearchParams(params);
    if (value) q.set(key, value); else q.delete(key);
    if (key !== 'page') q.delete('page');
    location.hash = '#/renewals' + (q.toString() ? '?' + q : '');
  };
  let searchTimer;
  const filterBar = h('div', { class: 'filters' },
    input('q', query.get('q'), {
      type: 'search', placeholder: 'Search customer, name or document…', 'aria-label': 'Search renewals',
      oninput: e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setParam('q', e.target.value.trim()), 350); },
    }),
    select('window', win, [['due', 'Due for a reminder'], ['overdue', 'Overdue'], ['30', 'Due within 30 days'],
      ['90', 'Due within 90 days'], ['all', 'All active'], ['stopped', 'Stopped']],
      { 'aria-label': 'When', onchange: e => setParam('window', e.target.value === 'due' ? '' : e.target.value) }),
    select('type', query.get('type'), [['', 'All types'], ...types.map(t => [String(t.id), t.name])],
      { 'aria-label': 'Type', onchange: e => setParam('type', e.target.value) }),
    select('assignee', query.get('assignee'), [['', 'Anyone'], ['me', 'Looked after by me'], ['none', 'No one assigned'],
      ...state.users.filter(u => u.active).map(u => [u.id, u.name])],
      { 'aria-label': 'Looked after by', onchange: e => setParam('assignee', e.target.value) }));

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = ['q', 'type', 'assignee'].some(k => query.get(k)) || win !== 'due';
  const table = data.renewals.length
    ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Renewal'), h('th', {}, 'Customer'), h('th', {}, 'Due'),
          h('th', { class: 'hide-sm' }, 'Last reminded'), h('th', { class: 'hide-sm' }, 'Looked after by'))),
        h('tbody', {}, data.renewals.map(r => h('tr', {},
          h('td', {}, h('a', { class: 'row-link', href: `#/renewals/${r.id}` }, r.type_name || 'Renewal'),
            r.reference && h('div', { class: 'meta muted' }, r.reference)),
          h('td', {}, h('a', { href: `#/customers/${r.customer_id}` }, r.customer_name)),
          h('td', {}, renewalBadge(r.due_date, data.today, r.remind_days, r.active)),
          h('td', { class: 'hide-sm' }, r.last_reminded_at ? fmtDate(r.last_reminded_at) : h('span', { class: 'muted' }, 'Not yet')),
          h('td', { class: 'hide-sm' }, r.assignee_name || h('span', { class: 'muted' }, '—')))))))
    : h('p', { class: 'empty' }, filtered ? 'No renewals match these filters.'
        : 'Nothing is due for a reminder right now. Add renewals from a customer\'s page or with "+ Add renewal".');

  return layout('renewals',
    pageHead('Renewals', win === 'due'
      ? `${data.total} due for a reminder (inside their reminder period, or overdue)`
      : `${data.total} renewal${data.total === 1 ? '' : 's'}`,
      h('a', { class: 'btn btn-primary', href: '#/renewals/new' }, '+ Add renewal')),
    h('section', { class: 'card' },
      filterBar,
      table,
      data.total > data.pageSize && h('div', { class: 'pager' },
        h('span', { class: 'muted' }, `Page ${data.page} of ${pages}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page <= 1, onclick: () => setParam('page', data.page - 1) }, 'Previous'),
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page >= pages, onclick: () => setParam('page', data.page + 1) }, 'Next')))));
}

function renewalForm(r, customers, types, onSubmit, cancelHref) {
  const usable = types.filter(t => t.active || t.id === r.type_id);
  const months = input('interval_months', r.interval_months, { type: 'number', min: 1, max: 120, required: true });
  const days = input('remind_days', r.remind_days, { type: 'number', min: 0, max: 365, required: true });
  // Picking a type fills in its usual period and reminder, unless they were changed by hand.
  const touched = { months: Boolean(r.id), days: Boolean(r.id) };
  months.addEventListener('input', () => { touched.months = true; });
  days.addEventListener('input', () => { touched.days = true; });
  const typeSelect = select('type_id', r.type_id ? String(r.type_id) : '', [['', 'Pick a type…'], ...usable.map(t => [String(t.id), t.name])], {
    required: true,
    onchange: e => {
      const t = types.find(x => String(x.id) === e.target.value);
      if (!t) return;
      if (!touched.months) months.value = t.interval_months;
      if (!touched.days) days.value = t.remind_days;
    },
  });
  const people = [['', 'No one'], ...state.users.filter(u => u.active || u.id === r.assigned_to).map(u => [u.id, u.name])];
  return handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field('Customer', select('customer_id', r.customer_id ? String(r.customer_id) : '', [['', 'Pick a customer…'],
        ...customers.map(c => [String(c.id), c.name])], { required: true })),
      field('Type', typeSelect),
      field('For (person, document or reference)', input('reference', r.reference, { maxlength: 200,
        placeholder: 'e.g. Ahmed Ali, or License no. 12345' }), { full: true,
        hint: 'One company can have several of the same type, e.g. a visa for each employee.' }),
      field('Next due date', input('due_date', r.due_date, { type: 'date', required: true })),
      field('Looked after by', select('assigned_to', r.assigned_to || '', people)),
      field('Repeats every (months)', months, { hint: '3 = quarterly, 12 = yearly, 24 = every 2 years.' }),
      field('Start reminding (days before)', days),
      field('Notes (optional)', textarea('notes', r.notes, { rows: 3, maxlength: 2000,
        placeholder: 'e.g. Documents needed: passport copy, photo, Emirates ID' }), { full: true })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, r.id ? 'Save changes' : 'Add renewal'),
      h('a', { class: 'btn btn-secondary', href: cancelHref }, 'Cancel'))),
  onSubmit);
}

async function viewRenewalNew(params) {
  const [customers, types] = await Promise.all([rpc('customer_options'), rpc('list_renewal_types'), loadUsers()]);
  const customerId = Number(params.customer) || null;
  const back = customerId ? `#/customers/${customerId}` : '#/renewals';
  return layout('renewals',
    pageHead('Add renewal', 'A service the customer needs again and again, like a VAT return or a visa.', null, h('a', { href: back }, '← Back')),
    h('section', { class: 'card' }, renewalForm({ customer_id: customerId, assigned_to: state.user.id }, customers, types, async data => {
      const id = await rpc('save_renewal', { p_id: null, p_data: data });
      toast('Renewal added');
      location.hash = `#/renewals/${id}`;
    }, back)));
}

async function viewRenewalEdit(id) {
  const [{ renewal: r }, customers, types] = await Promise.all([
    rpc('get_renewal', { p_id: id }), rpc('customer_options'), rpc('list_renewal_types'), loadUsers()]);
  return layout('renewals',
    pageHead('Edit renewal', renewalLabel(r), null, h('a', { href: `#/renewals/${id}` }, '← Back')),
    h('section', { class: 'card' }, renewalForm(r, customers, types, async data => {
      await rpc('save_renewal', { p_id: id, p_data: data });
      toast('Changes saved');
      location.hash = `#/renewals/${id}`;
    }, `#/renewals/${id}`)));
}

function renewedDialog(r, refresh) {
  const suggested = addMonths(r.due_date, r.interval_months);
  const dlg = openDialog('Mark as renewed', handleForm(h('form', { class: 'form' },
    h('p', { class: 'muted' }, `Current due date: ${fmtDate(r.due_date)}. ${periodText(r.interval_months)}, so the next one is suggested below. Change it if the new expiry date is different.`),
    field('Next due date', input('new_due', suggested, { type: 'date', required: true })),
    field('Note (optional)', textarea('note', '', { rows: 2, maxlength: 2000, placeholder: 'e.g. Renewed until 15 Jan 2028, receipt no. 4471' })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    const next = await rpc('mark_renewed', { p_id: r.id, p_new_due: data.new_due, p_note: data.note || null });
    dlg.close();
    toast(`Renewed. Next due ${fmtDate(next)}`);
    refresh();
  }));
}

function remindDialog(r, company, refresh) {
  const what = [r.type_name ? r.type_name.toLowerCase() : 'renewal', r.reference && `for ${r.reference}`].filter(Boolean).join(' ');
  const body = [
    `Dear ${r.customer_name},`, '',
    `This is a friendly reminder that the ${what} is due on ${fmtDate(r.due_date)}.`, '',
    'To make sure it is completed on time, please send us the required documents, or reply to this email and we will take care of everything for you.',
    r.notes ? `\nFor your reference: ${r.notes}` : null,
    '', 'Kind regards,', state.user.name, company.legal_name, company.phone,
  ].filter(l => typeof l === 'string').join('\n');
  composeEmail({
    title: 'Remind the customer',
    recipients: r.recipients,
    to: r.last_reminded_to || r.recipients[0] || '',
    subject: `Reminder: ${r.type_name || 'Renewal'}${r.reference ? ' (' + r.reference + ')' : ''} due ${fmtDate(r.due_date)}`,
    body,
    onSent: async to => {
      await rpc('mark_renewal_reminded', { p_id: r.id, p_to: to });
      toast('Reminder recorded');
      refresh();
    },
  });
}

const RENEWAL_EVENT = { created: 'Added', reminded: 'Reminded', renewed: 'Renewed', task: 'Task', stopped: 'Stopped', restarted: 'Restarted' };
const RENEWAL_ICON = { created: 'note', reminded: 'email', renewed: 'renew', task: 'task', stopped: 'note', restarted: 'renew' };

async function viewRenewal(id) {
  const [{ renewal: r, today }, company] = await Promise.all([rpc('get_renewal', { p_id: id }), rpc('get_company_settings')]);
  const refresh = () => render();
  const act = (fn, args, message, after) => async () => {
    try {
      const result = await rpc(fn, args);
      toast(message);
      if (after) after(result); else refresh();
    } catch (err) { toast(err.message, true); }
  };
  const facts = [
    ['Customer', h('a', { href: `#/customers/${r.customer_id}` }, r.customer_name)],
    r.reference && ['For', r.reference],
    ['Next due', renewalBadge(r.due_date, today, r.remind_days, r.active)],
    ['Repeats', periodText(r.interval_months)],
    ['Reminders from', `${fmtDate(addDays(r.due_date, -r.remind_days))} (${r.remind_days} days before)`],
    ['Looked after by', r.assignee_name || h('span', { class: 'muted' }, 'No one')],
    ['Last reminded', r.last_reminded_at ? `${fmtDate(r.last_reminded_at, true)}${r.last_reminded_to ? ' · ' + r.last_reminded_to : ''}` : h('span', { class: 'muted' }, 'Not yet this period')],
  ].filter(Boolean);

  return layout('renewals',
    pageHead(r.type_name || 'Renewal', r.reference ? `${r.reference} · ${r.customer_name}` : r.customer_name, [
      r.active && h('button', { class: 'btn btn-primary', onclick: () => remindDialog(r, company, refresh) }, 'Remind customer'),
      r.active && h('button', { class: 'btn btn-secondary', onclick: () => renewedDialog(r, refresh) }, '✓ Mark as renewed'),
      isManager() && r.active && h('button', {
        class: 'btn btn-secondary',
        onclick: act('create_renewal_task', { p_id: id }, 'Task created', taskId => { location.hash = `#/tasks/${taskId}`; }),
      }, 'Create task'),
      h('a', { class: 'btn btn-secondary', href: `#/renewals/${id}/edit` }, 'Edit'),
      h('button', {
        class: 'btn btn-secondary',
        onclick: act('set_renewal_active', { p_id: id, p_active: !r.active }, r.active ? 'Stopped' : 'Restarted'),
      }, r.active ? 'Stop' : 'Restart'),
      isManager() && h('button', {
        class: 'btn btn-danger',
        onclick: () => {
          if (confirmAction('Delete this renewal and its history? To keep the history, use "Stop" instead.')) {
            act('delete_renewal', { p_id: id }, 'Renewal deleted', () => { location.hash = '#/renewals'; })();
          }
        },
      }, 'Delete'),
    ], [h('a', { href: '#/renewals' }, '← Renewals')]),
    h('div', { class: 'grid detail-layout' },
      h('div', {},
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Details')),
          h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
          r.notes && [h('h3', { class: 'notes-heading' }, 'Notes'), h('p', { class: 'prewrap' }, r.notes)]),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Tasks')),
          r.tasks.length
            ? h('ul', { class: 'list' }, r.tasks.map(t => h('li', {},
                h('div', { class: 'grow' }, h('a', { class: 'row-link', href: `#/tasks/${t.id}` }, t.title)),
                taskStatusBadge(t.status))))
            : h('p', { class: 'empty' }, isManager() ? 'Use "Create task" to hand the renewal work to a team member.' : 'No tasks yet.'))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'History')),
        h('ul', { class: 'list' }, r.events.map(e => h('li', {},
          h('span', { class: 'kind-icon' }, icon(RENEWAL_ICON[e.kind] || 'note')),
          h('div', { class: 'grow' },
            h('strong', {}, e.kind === 'renewed' ? `Renewed: ${fmtDate(e.old_due)} → ${fmtDate(e.new_due)}`
              : e.kind === 'created' ? `Added, due ${fmtDate(e.new_due)}` : e.body || RENEWAL_EVENT[e.kind]),
            e.kind === 'renewed' && e.body && h('div', { class: 'body' }, e.body),
            h('div', { class: 'meta' }, `${e.user_name || 'Unknown'} · ${fmtDate(e.created_at, true)}`))))))));
}

// ---------- types of work and renewal types (managers) ----------

function renewalTypeDialog(t, refresh) {
  const dlg = openDialog(t.id ? `Edit "${t.name}"` : 'Add renewal type', handleForm(h('form', { class: 'form' },
    field('Name', input('name', t.name, { required: true, maxlength: 100, placeholder: 'e.g. Establishment card renewal' })),
    h('div', { class: 'form-grid' },
      field('Repeats every (months)', input('interval_months', t.interval_months ?? 12, { type: 'number', min: 1, max: 120, required: true })),
      field('Remind (days before)', input('remind_days', t.remind_days ?? 30, { type: 'number', min: 0, max: 365, required: true }))),
    h('p', { class: 'hint' }, 'These are the defaults for new renewals of this type. Existing renewals keep their own settings.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: t.active !== false }), 'In use'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('save_renewal_type', { p_id: t.id || null, p_data: data });
    dlg.close();
    toast('Saved');
    refresh();
  }));
}

function renewalTypesCard(types, refresh) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Renewal types'),
      h('button', { class: 'btn btn-secondary btn-sm', onclick: () => renewalTypeDialog({}, refresh) }, '+ Add')),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Repeats'), h('th', {}, 'Reminder'),
        h('th', { class: 'hide-sm' }, 'Active renewals'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, types.map(t => h('tr', {},
        h('td', {}, h('a', { class: 'row-link', href: `#/renewals?type=${t.id}&window=all` }, t.name)),
        h('td', {}, periodText(t.interval_months)),
        h('td', {}, `${t.remind_days} days before`),
        h('td', { class: 'hide-sm' }, t.renewals),
        h('td', {}, t.active ? h('span', { class: 'badge badge-active' }, 'In use') : h('span', { class: 'badge badge-inactive' }, 'Switched off')),
        h('td', {}, h('button', { class: 'btn btn-secondary btn-sm', onclick: () => renewalTypeDialog(t, refresh) }, 'Edit'))))))));
}

// ---------- payments ----------

const PAY_METHOD = { bank_transfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', other: 'Other' };
const CHEQUE_STATUS = { pending: 'Not cleared yet', cleared: 'Cleared', bounced: 'Bounced' };
const chequeBadge = st => h('span', { class: `badge cheque-${st}` }, CHEQUE_STATUS[st]);

async function recordPaymentDialog(inv, refresh) {
  let banks = [];
  try { banks = (await rpc('cash_accounts')).filter(a => a.active && a.subtype !== 'pdc'); } catch (err) { toast(err.message, true); return; }
  const defaultFor = m => (banks.find(a => a.subtype === (m === 'cash' ? 'cash' : 'bank')) || banks[0] || {}).id;
  let intoTouched = false;
  const into = select('account_id', String(defaultFor('bank_transfer') || ''), banks.map(a => [String(a.id), `${a.code} · ${a.name}`]),
    { onchange: () => { intoTouched = true; } });
  const intoField = field('Received into', into, { hint: 'For a cheque: the bank it will be deposited in. Until cleared it sits in "Cheques in hand".' });
  const balance = round2(inv.total - inv.amount_paid);
  const refField = field('Transfer reference', input('reference', '', { maxlength: 100, placeholder: 'e.g. FT2611ABC' }));
  const chequeFields = h('div', { class: 'form-grid', hidden: true },
    field('Cheque bank', input('cheque_bank', '', { maxlength: 100 })),
    field('Cheque date', input('cheque_date', '', { type: 'date' }), { hint: 'For a post-dated cheque, the date written on it.' }));
  const REF_LABEL = { bank_transfer: 'Transfer reference', cash: 'Receipt number (optional)', cheque: 'Cheque number', other: 'Reference (optional)' };
  const method = select('method', 'bank_transfer', Object.entries(PAY_METHOD), {
    onchange: e => {
      refField.querySelector('label').textContent = REF_LABEL[e.target.value];
      refField.querySelector('input').required = e.target.value === 'cheque';
      chequeFields.hidden = e.target.value !== 'cheque';
      if (!intoTouched) into.value = String(defaultFor(e.target.value) || '');
    },
  });
  const dlg = openDialog(`Record payment for ${inv.number}`, handleForm(h('form', { class: 'form' },
    h('p', { class: 'muted' }, `Total ${money(inv.total)} · paid so far ${money(inv.amount_paid)} · balance ${money(balance)}`),
    h('div', { class: 'form-grid' },
      field('Amount received (AED)', input('amount', balance.toFixed(2), { type: 'number', min: '0.01', max: balance.toFixed(2), step: '0.01', required: true }),
        { hint: 'Change it for a part payment.' }),
      field('Received on', input('paid_on', localToday(), { type: 'date', max: localToday(), required: true })),
      field('Paid by', method),
      refField,
      banks.length > 0 && intoField),
    chequeFields,
    field('Note (optional)', textarea('notes', '', { rows: 2, maxlength: 1000 })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save payment'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('record_payment', { p_invoice_id: inv.id, p_data: data });
    dlg.close();
    const left = round2(balance - Number(data.amount));
    toast(left > 0 ? `Payment saved. Balance now ${money(left)}` : 'Payment saved. Invoice fully paid');
    refresh();
  }));
}

function paymentReminderDialog(inv, refresh) {
  const sup = inv.supplier || {};
  const balance = round2(inv.total - inv.amount_paid);
  const pay = paymentLines(sup);
  const body = [
    `Dear ${inv.customer_name},`, '',
    `This is a friendly reminder that invoice ${inv.number}${inv.due_date ? `, due on ${fmtDate(inv.due_date)},` : ''} has a balance of ${money(balance)}.`,
    inv.amount_paid > 0 ? `Invoice total ${money(inv.total)}, received so far ${money(inv.amount_paid)}.` : null,
    '', 'We would be grateful if you could arrange payment at your earliest convenience. If you have already paid, please send us the payment details and ignore this reminder.',
    ...(pay.length ? ['', 'Payment details:', ...pay] : []),
    '', 'Kind regards,', state.user.name, sup.legal_name, sup.phone,
  ].filter(l => typeof l === 'string').join('\n');
  composeEmail({
    title: `Payment reminder for ${inv.number}`,
    recipients: inv.recipients,
    to: inv.payment_reminded_to || inv.sent_to || inv.recipients[0] || '',
    subject: `Payment reminder: ${inv.number} (balance ${money(balance)})`,
    body,
    attachment: { label: `Download ${inv.number}.pdf`, download: () => downloadInvoicePdf(inv) },
    onSent: async to => {
      await rpc('mark_payment_reminded', { p_invoice_id: inv.id, p_to: to });
      toast('Reminder recorded');
      refresh();
    },
  });
}

function paymentsCard(inv, today, refresh) {
  const balance = round2(inv.total - inv.amount_paid);
  const overdue = inv.kind === 'tax' && inv.status === 'sent' && balance > 0 && inv.due_date && inv.due_date < today;
  const act = (fn, args, message) => async () => {
    try { await rpc(fn, args); toast(message); refresh(); } catch (err) { toast(err.message, true); }
  };
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Payments'),
      isManager() && inv.status !== 'cancelled' && balance > 0 &&
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => recordPaymentDialog(inv, refresh) }, '+ Record payment')),
    h('dl', { class: 'pay-summary' },
      h('div', {}, h('dt', {}, 'Total'), h('dd', {}, money(inv.total))),
      h('div', {}, h('dt', {}, 'Paid'), h('dd', {}, money(inv.amount_paid))),
      h('div', { class: overdue ? 'is-overdue' : balance > 0 ? '' : 'is-paid' },
        h('dt', {}, overdue ? `Balance · overdue ${daysBetween(inv.due_date, today)} days` : 'Balance'),
        h('dd', {}, money(balance)))),
    inv.payment_reminded_at && h('p', { class: 'muted' },
      `Payment reminder sent ${fmtDate(inv.payment_reminded_at, true)}${inv.payment_reminded_to ? ' to ' + inv.payment_reminded_to : ''}.`),
    inv.payments.length
      ? h('ul', { class: 'list' }, inv.payments.map(p => h('li', { class: p.cheque_status === 'bounced' ? 'done' : '' },
          h('div', { class: 'grow' },
            h('div', { class: 'body' }, h('strong', {}, money(p.amount)), ` · ${PAY_METHOD[p.method]}`,
              p.reference ? ` · ${p.method === 'cheque' ? 'Cheque no. ' : ''}${p.reference}` : ''),
            h('div', { class: 'meta' }, [
              `Received ${fmtDate(p.paid_on)}`,
              p.method === 'cheque' && [p.cheque_bank, p.cheque_date && `dated ${fmtDate(p.cheque_date)}`].filter(Boolean).join(', '),
              p.recorded_by_name && `recorded by ${p.recorded_by_name}`,
            ].filter(Boolean).join(' · ')),
            p.notes && h('div', { class: 'meta prewrap' }, p.notes)),
          h('div', { class: 'badge-stack' },
            p.cheque_status && chequeBadge(p.cheque_status),
            isManager() && h('div', { class: 'btn-row' },
              p.cheque_status && p.cheque_status !== 'cleared' &&
                h('button', { class: 'btn btn-secondary btn-sm', onclick: act('set_cheque_status', { p_id: p.id, p_status: 'cleared' }, 'Cheque cleared') }, 'Cleared'),
              p.cheque_status === 'pending' &&
                h('button', {
                  class: 'btn btn-danger btn-sm',
                  onclick: () => {
                    if (confirmAction(`Mark cheque ${p.reference} as bounced? ${money(p.amount)} goes back on the balance.`)) {
                      act('set_cheque_status', { p_id: p.id, p_status: 'bounced' }, 'Cheque marked as bounced')();
                    }
                  },
                }, 'Bounced'),
              h('button', {
                class: 'btn btn-danger btn-sm', 'aria-label': 'Delete payment',
                onclick: () => {
                  if (confirmAction(`Delete this ${money(p.amount)} payment? Only do this if it was entered by mistake.`)) {
                    act('delete_payment', { p_id: p.id }, 'Payment deleted')();
                  }
                },
              }, 'Delete'))))))
      : h('p', { class: 'empty' }, 'No payments recorded yet.'));
}

async function viewPayments(params) {
  const query = new URLSearchParams(params);
  const data = await rpc('list_payments', {
    p_q: query.get('q') || null, p_method: query.get('method') || null, p_cheque_status: query.get('cheque') || null,
    p_page: Number(query.get('page')) || 1,
  });
  const setParam = (key, value) => {
    const q = new URLSearchParams(params);
    if (value) q.set(key, value); else q.delete(key);
    if (key !== 'page') q.delete('page');
    location.hash = '#/payments' + (q.toString() ? '?' + q : '');
  };
  let searchTimer;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return layout('payments',
    pageHead('Payments', `${data.total} payment${data.total === 1 ? '' : 's'} · ${money(data.amount)} received (bounced cheques not counted)`),
    h('section', { class: 'card' },
      h('div', { class: 'filters' },
        input('q', query.get('q'), {
          type: 'search', placeholder: 'Search invoice, customer or reference…', 'aria-label': 'Search payments',
          oninput: e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setParam('q', e.target.value.trim()), 350); },
        }),
        select('method', query.get('method'), [['', 'Any method'], ...Object.entries(PAY_METHOD)],
          { 'aria-label': 'Method', onchange: e => setParam('method', e.target.value) }),
        select('cheque', query.get('cheque'), [['', 'All cheques'], ['pending', 'Cheques not cleared yet'], ['cleared', 'Cleared cheques'], ['bounced', 'Bounced cheques']],
          { 'aria-label': 'Cheques', onchange: e => setParam('cheque', e.target.value) })),
      data.payments.length
        ? h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {},
              h('th', {}, 'Received'), h('th', {}, 'Invoice'), h('th', {}, 'Customer'), h('th', {}, 'Method'),
              h('th', { class: 'hide-sm' }, 'Reference'), h('th', { class: 'num' }, 'Amount'))),
            h('tbody', {}, data.payments.map(p => h('tr', {},
              h('td', {}, fmtDate(p.paid_on)),
              h('td', {}, h('a', { class: 'row-link', href: `#/invoices/${p.invoice_id}` }, p.invoice_number)),
              h('td', {}, p.customer_id ? h('a', { href: `#/customers/${p.customer_id}` }, p.customer_name) : p.customer_name),
              h('td', {}, PAY_METHOD[p.method], p.cheque_status && [' ', chequeBadge(p.cheque_status)],
                p.cheque_date && h('div', { class: 'meta muted' }, `Cheque dated ${fmtDate(p.cheque_date)}`)),
              h('td', { class: 'hide-sm' }, p.reference || h('span', { class: 'muted' }, '—')),
              h('td', { class: 'num' }, money(p.amount)))))))
        : h('p', { class: 'empty' }, [...query.keys()].length ? 'No payments match these filters.' : 'No payments recorded yet. Record them from an invoice.'),
      data.total > data.pageSize && h('div', { class: 'pager' },
        h('span', { class: 'muted' }, `Page ${data.page} of ${pages}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page <= 1, onclick: () => setParam('page', data.page - 1) }, 'Previous'),
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page >= pages, onclick: () => setParam('page', data.page + 1) }, 'Next')))));
}

// ---------- HR ----------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LEAVE_KIND = { annual: 'Annual leave', medical: 'Medical leave' };
const LEAVE_STATUS = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
const leaveBadge = st => h('span', { class: `badge leave-${st}` }, LEAVE_STATUS[st] || st);
const fmtTime = ts => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '');
const monthLabel = ymd => new Date(ymd.slice(0, 7) + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const num = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });

function hoursBetween(a, b) {
  if (!a || !b) return '';
  const mins = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function distanceM(lat1, lng1, lat2, lng2) {
  const rad = d => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function getLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

/** "At office" / "1.2 km away" / "No location", with the remark if any. */
function placeText(atOffice, distance, remark) {
  const where = atOffice === true ? h('span', { class: 'badge badge-active' }, 'At office')
    : atOffice === false ? h('span', { class: 'badge badge-lead' }, distance == null ? 'No location' : `${distance >= 1000 ? (distance / 1000).toFixed(1) + ' km' : distance + ' m'} away`)
      : null;
  return [where, remark && h('div', { class: 'meta prewrap' }, `Remark: ${remark}`)];
}

/** Sign in / out: get the location; away from the office (or none) ask for a remark first. */
async function signAttendance(action, settings, button, refresh) {
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Getting your location…';
  const loc = await getLocation();
  button.disabled = false;
  button.textContent = label;
  let away = false;
  let distance = null;
  if (settings.office_set) {
    if (!loc) away = true;
    else {
      distance = Math.round(distanceM(settings.office_lat, settings.office_lng, loc.lat, loc.lng));
      away = distance > settings.office_radius_m;
    }
  }
  const send = async remark => {
    await rpc('attendance_sign', { p_action: action, p_lat: loc ? loc.lat : null, p_lng: loc ? loc.lng : null,
      p_accuracy: loc ? loc.accuracy : null, p_remark: remark || null });
    toast(action === 'in' ? `Signed in at ${fmtTime(new Date().toISOString())}` : `Signed out at ${fmtTime(new Date().toISOString())}`);
    refresh();
  };
  const askRemark = message => {
    const dlg = openDialog(action === 'in' ? 'Signing in away from the office' : 'Signing out away from the office', handleForm(h('form', { class: 'form' },
      h('p', {}, message),
      field('Remark', textarea('remark', '', { rows: 3, required: true, maxlength: 300,
        placeholder: 'e.g. Client visit at Sharjah port, or working from the customs office' })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, action === 'in' ? 'Sign in' : 'Sign out'),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
    async data => {
      await send(data.remark);
      dlg.close();
    }));
  };
  if (away) {
    askRemark(loc
      ? `You're about ${distance >= 1000 ? (distance / 1000).toFixed(1) + ' km' : distance + ' m'} from the office. You can still ${action === 'in' ? 'sign in' : 'sign out'}; please say why.`
      : 'Your location isn\'t available (it may be switched off or blocked for this site). You can still continue; please say where you are.');
    return;
  }
  try {
    await send(null);
  } catch (err) {
    if (err.details && err.details.remark) askRemark(err.details.remark);
    else toast(err.message, true);
  }
}

function attendanceCard(hr, refresh) {
  const a = hr.attendance;
  const weekend = hr.settings.weekend_days.includes(new Date(hr.today + 'T00:00:00').getDay());
  let status;
  let button = null;
  if (a && a.sign_out) status = `Signed in ${fmtTime(a.sign_in)} · signed out ${fmtTime(a.sign_out)} · ${hoursBetween(a.sign_in, a.sign_out)}`;
  else if (a && a.sign_in) status = `Signed in at ${fmtTime(a.sign_in)}`;
  else if (hr.on_leave) status = `You're on ${LEAVE_KIND[hr.on_leave].toLowerCase()} today.`;
  else status = weekend ? 'It\'s the weekend. You can still sign in if you\'re working.' : 'You haven\'t signed in yet today.';
  if (!a || !a.sign_in) {
    button = h('button', { class: 'btn btn-primary btn-big', onclick: e => signAttendance('in', hr.settings, e.currentTarget, refresh) }, 'Sign in');
  } else if (!a.sign_out) {
    button = h('button', { class: 'btn btn-primary btn-big', onclick: e => signAttendance('out', hr.settings, e.currentTarget, refresh) }, 'Sign out');
  }
  return h('section', { class: 'card attendance-card' },
    h('div', { class: 'card-head' }, h('h2', {}, `Today, ${fmtDate(hr.today)}`),
      h('a', { class: 'btn btn-secondary btn-sm', href: '#/hr/attendance?mine=1' }, 'My attendance')),
    h('p', { class: 'attendance-status' }, status),
    a && a.sign_in && h('div', { class: 'meta' }, 'In: ', placeText(a.in_at_office, a.in_distance_m, a.in_remark)),
    a && a.sign_out && h('div', { class: 'meta' }, 'Out: ', placeText(a.out_at_office, a.out_distance_m, a.out_remark)),
    button,
    !hr.settings.office_set && h('p', { class: 'muted' }, 'The office location isn\'t set yet, so sign-ins are not checked against it.'));
}

function leaveTiles(annual, medical) {
  const tile = (title, b) => h('div', { class: 'card stat' },
    h('div', { class: 'label' }, title),
    h('div', { class: 'value' }, num(b.remaining), h('span', { class: 'value-of' }, ` of ${num(b.entitled)} left`)),
    h('div', { class: 'meta' }, `${num(b.taken)} taken · ${num(b.pending)} waiting for approval`));
  return h('div', { class: 'grid two-col' }, tile('Annual leave', annual), tile('Medical leave', medical));
}

async function viewMyHr() {
  const hr = await rpc('my_hr');
  const refresh = () => render();
  return layout('hr',
    pageHead(`Hello, ${state.user.name.split(' ')[0]}`, hr.designation || ROLE_LABEL[state.user.role],
      h('a', { class: 'btn btn-secondary', href: '#/hr/people/me' }, 'My details')),
    isManager() && hr.pendingApprovals > 0 && h('p', { class: 'notice' },
      h('a', { href: '#/hr/leave' }, `${hr.pendingApprovals} leave request${hr.pendingApprovals > 1 ? 's are' : ' is'} waiting for approval`)),
    attendanceCard(hr, refresh),
    h('div', { class: 'card-head section-head' }, h('h2', {}, `Leave in ${hr.today.slice(0, 4)}`),
      h('a', { class: 'btn btn-primary btn-sm', href: '#/hr/leave' }, 'Request leave')),
    leaveTiles(hr.annual, hr.medical),
    h('div', { class: 'grid two-col' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'My payslips'), h('a', { class: 'btn btn-secondary btn-sm', href: '#/hr/payslips' }, 'See all')),
        hr.payslips.length
          ? h('ul', { class: 'list' }, hr.payslips.map(p => h('li', {},
              h('div', { class: 'grow' }, h('a', { class: 'row-link', href: `#/hr/payslips/${p.id}` }, monthLabel(p.period))),
              h('strong', {}, money(p.net)))))
          : h('p', { class: 'empty' }, 'No payslips yet.')),
      isManager() && h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Documents expiring soon')),
        hr.expiringDocuments.length
          ? h('ul', { class: 'list' }, hr.expiringDocuments.map(x => h('li', {},
              h('div', { class: 'grow' }, h('a', { class: 'row-link', href: `#/hr/people/${x.id}` }, x.name), h('div', { class: 'meta' }, x.label)),
              h('span', { class: `badge ${x.expiry < hr.today ? 'badge-overdue' : 'badge-lead'}` },
                `${x.expiry < hr.today ? 'Expired' : 'Expires'} ${fmtDate(x.expiry)}`))))
          : h('p', { class: 'empty' }, 'No visas, Emirates IDs or passports expiring in the next 60 days.'))));
}

// Attendance: managers see the team for a day; everyone sees their own month.
async function viewAttendance(params) {
  if (isManager() && !params.mine && !params.person) return viewTeamAttendance(params);
  const month = params.month ? `${params.month}-01` : null;
  const data = await rpc('my_attendance', { p_month: month, p_profile: params.person || null });
  const byDate = Object.fromEntries(data.days.map(d => [d.work_date, d]));
  const leaveOn = ymd => data.leaves.find(l => l.start_date <= ymd && l.end_date >= ymd);
  const days = [];
  const first = new Date(data.month + 'T00:00:00');
  for (let d = new Date(first); d.getMonth() === first.getMonth(); d.setDate(d.getDate() + 1)) {
    const ymd = d.toLocaleDateString('en-CA');
    if (ymd > data.today) break;
    days.push({ ymd, dow: d.getDay() });
  }
  days.reverse();
  const present = data.days.filter(d => d.sign_in).length;
  const late = data.days.filter(d => d.sign_in && fmtTime(d.sign_in) > data.work_start).length;
  const qs = new URLSearchParams(params);
  return layout('hr-attendance',
    pageHead(params.person ? `Attendance: ${data.name}` : 'My attendance', `${monthLabel(data.month)} · ${present} days present · ${late} late (after ${data.work_start})`,
      input('month', data.month.slice(0, 7), { type: 'month', 'aria-label': 'Month', max: data.today.slice(0, 7),
        onchange: e => { qs.set('month', e.target.value); if (!qs.get('person')) qs.set('mine', '1'); location.hash = '#/hr/attendance?' + qs; } }),
      isManager() && h('a', { href: '#/hr/attendance' }, '← Team attendance')),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', {}, 'Status'), h('th', {}, 'Signed in'), h('th', {}, 'Signed out'), h('th', { class: 'hide-sm' }, 'Hours'))),
      h('tbody', {}, days.map(({ ymd, dow }) => {
        const a = byDate[ymd];
        const leave = leaveOn(ymd);
        const weekend = data.weekend_days.includes(dow);
        const status = a && a.sign_in
          ? (fmtTime(a.sign_in) > data.work_start ? h('span', { class: 'badge badge-lead' }, 'Late') : h('span', { class: 'badge badge-active' }, 'Present'))
          : leave ? h('span', { class: 'badge leave-approved' }, LEAVE_KIND[leave.kind])
            : weekend ? h('span', { class: 'muted' }, 'Weekend')
              : ymd === data.today ? h('span', { class: 'muted' }, 'Not signed in yet') : h('span', { class: 'badge badge-overdue' }, 'Absent');
        return h('tr', {},
          h('td', {}, `${DAY_NAMES[dow].slice(0, 3)} ${fmtDate(ymd)}`),
          h('td', {}, status, a && a.edit_note && h('div', { class: 'meta muted' }, a.edit_note)),
          h('td', {}, a && a.sign_in ? [fmtTime(a.sign_in), ' ', placeText(a.in_at_office, a.in_distance_m, a.in_remark)] : ''),
          h('td', {}, a && a.sign_out ? [fmtTime(a.sign_out), ' ', placeText(a.out_at_office, a.out_distance_m, a.out_remark)] : ''),
          h('td', { class: 'hide-sm' }, a ? hoursBetween(a.sign_in, a.sign_out) : ''));
      }))))));
}

function attendanceEditDialog(p, date, refresh) {
  const dlg = openDialog(`Correct attendance: ${p.name}, ${fmtDate(date)}`, handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field('Signed in', input('in', fmtTime(p.sign_in), { type: 'time' })),
      field('Signed out', input('out', fmtTime(p.sign_out), { type: 'time' }))),
    field('Reason for the change', input('note', p.edit_note || '', { maxlength: 300, placeholder: 'e.g. Forgot to sign out' }),
      { hint: 'Leave both times empty to remove the day\'s record.' }),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('save_attendance', { p_profile: p.id, p_date: date, p_in: data.in, p_out: data.out, p_note: data.note });
    dlg.close();
    toast('Attendance corrected');
    refresh();
  }));
}

async function viewTeamAttendance(params) {
  const data = await rpc('team_attendance', { p_date: params.date || null });
  const refresh = () => render();
  const counts = { present: 0, late: 0, leave: 0, absent: 0 };
  const rows = data.people.map(p => {
    let status;
    if (p.sign_in) {
      if (p.late) { counts.late++; status = h('span', { class: 'badge badge-lead' }, 'Late'); } else { counts.present++; status = h('span', { class: 'badge badge-active' }, 'Present'); }
    } else if (p.on_leave) { counts.leave++; status = h('span', { class: 'badge leave-approved' }, LEAVE_KIND[p.on_leave]); }
    else if (data.weekend) status = h('span', { class: 'muted' }, 'Weekend');
    else { counts.absent++; status = h('span', { class: 'badge badge-overdue' }, data.date === data.today ? 'Not signed in' : 'Absent'); }
    return h('tr', {},
      h('td', {}, h('a', { class: 'row-link', href: `#/hr/attendance?person=${p.id}` }, p.name), p.designation && h('div', { class: 'meta muted' }, p.designation)),
      h('td', {}, status, p.edit_note && h('div', { class: 'meta muted' }, p.edit_note)),
      h('td', {}, p.sign_in ? [fmtTime(p.sign_in), ' ', placeText(p.in_at_office, p.in_distance_m, p.in_remark)] : ''),
      h('td', {}, p.sign_out ? [fmtTime(p.sign_out), ' ', placeText(p.out_at_office, p.out_distance_m, p.out_remark)] : ''),
      h('td', { class: 'hide-sm' }, hoursBetween(p.sign_in, p.sign_out)),
      h('td', {}, h('button', { class: 'btn btn-secondary btn-sm', onclick: () => attendanceEditDialog(p, data.date, refresh) }, 'Correct')));
  });
  return layout('hr-attendance',
    pageHead('Team attendance', `${DAY_NAMES[new Date(data.date + 'T00:00:00').getDay()]} ${fmtDate(data.date)} · ${counts.present} on time · ${counts.late} late · ${counts.leave} on leave · ${counts.absent} ${data.date === data.today ? 'not signed in' : 'absent'}`, [
      input('date', data.date, { type: 'date', max: data.today, 'aria-label': 'Day', onchange: e => { location.hash = '#/hr/attendance?date=' + e.target.value; } }),
      h('a', { class: 'btn btn-secondary', href: '#/hr/attendance?mine=1' }, 'My attendance'),
    ]),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Employee'), h('th', {}, 'Status'), h('th', {}, 'Signed in'), h('th', {}, 'Signed out'), h('th', { class: 'hide-sm' }, 'Hours'), h('th', {}, ''))),
      h('tbody', {}, rows)))));
}

// ---------- leave ----------

function countLeaveDays(start, end, weekend) {
  if (!start || !end || end < start) return 0;
  let n = 0;
  for (let d = new Date(start + 'T00:00:00'); d.toLocaleDateString('en-CA') <= end; d.setDate(d.getDate() + 1)) {
    if (!weekend.includes(d.getDay())) n++;
  }
  return n;
}

function decideDialog(r, approve, refresh) {
  const dlg = openDialog(`${approve ? 'Approve' : 'Reject'} ${r.name}'s ${LEAVE_KIND[r.kind].toLowerCase()}`, handleForm(h('form', { class: 'form' },
    h('p', {}, `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)} · ${num(r.days)} day${Number(r.days) === 1 ? '' : 's'}${r.reason ? ' · ' + r.reason : ''}`),
    h('p', { class: 'muted' }, `${num(r.remaining)} of ${r.entitled} days left including this request.`),
    field(approve ? 'Note (optional)' : 'Reason (shown to the employee)', textarea('note', '', { rows: 2, maxlength: 500, required: !approve })),
    h('div', { class: 'btn-row' },
      h('button', { class: approve ? 'btn btn-primary' : 'btn btn-danger', type: 'submit' }, approve ? 'Approve' : 'Reject'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('decide_leave', { p_id: r.id, p_approve: approve, p_note: data.note || null });
    dlg.close();
    toast(approve ? 'Leave approved' : 'Leave rejected');
    refresh();
  }));
}

function leaveRequestList(requests, { showName, canCancel, refresh }) {
  return requests.length
    ? h('ul', { class: 'list' }, requests.map(r => h('li', {},
        h('div', { class: 'grow' },
          h('div', { class: 'body' }, showName && [h('strong', {}, r.name), ' · '], `${LEAVE_KIND[r.kind]}: ${fmtDate(r.start_date)}${r.end_date !== r.start_date ? ' – ' + fmtDate(r.end_date) : ''} · ${num(r.days)} day${Number(r.days) === 1 ? '' : 's'}`),
          r.reason && h('div', { class: 'meta prewrap' }, r.reason),
          (r.decided_by_name || r.decision_note) && h('div', { class: 'meta' },
            [r.decided_by_name && `${LEAVE_STATUS[r.status]} by ${r.decided_by_name}`, r.decision_note && `"${r.decision_note}"`].filter(Boolean).join(' · '))),
        h('div', { class: 'badge-stack' }, leaveBadge(r.status),
          canCancel(r) && h('button', {
            class: 'btn btn-secondary btn-sm',
            onclick: async () => {
              if (!confirmAction('Cancel this leave request?')) return;
              try { await rpc('cancel_leave', { p_id: r.id }); toast('Leave cancelled'); refresh(); } catch (err) { toast(err.message, true); }
            },
          }, r.status === 'pending' && !showName ? 'Withdraw' : 'Cancel')))))
    : h('p', { class: 'empty' }, 'None.');
}

async function viewLeave(params) {
  const mgr = isManager();
  const [sum, all] = await Promise.all([
    rpc('leave_summary', {}),
    mgr ? rpc('list_leave_requests', { p_status: params.status ?? 'pending', p_year: null }) : null,
  ]);
  const refresh = () => render();
  const kind = select('kind', 'annual', Object.entries(LEAVE_KIND));
  const start = input('start_date', '', { type: 'date', required: true });
  const end = input('end_date', '', { type: 'date', required: true });
  const preview = h('p', { class: 'muted' }, 'Pick the dates to see how many leave days it uses.');
  const update = () => {
    if (start.value && !end.value) end.value = start.value;
    const n = countLeaveDays(start.value, end.value, sum.weekend_days);
    const b = sum[kind.value];
    preview.textContent = start.value && end.value
      ? `${n} working day${n === 1 ? '' : 's'} (weekends not counted). You have ${num(b.remaining)} ${kind.value} leave days left.`
      : 'Pick the dates to see how many leave days it uses.';
    preview.className = n > b.remaining ? 'form-error' : 'muted';
  };
  [kind, start, end].forEach(el => el.addEventListener('change', update));
  const form = handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field('Type', kind), h('div'),
      field('First day', start), field('Last day', end)),
    preview,
    field('Reason (optional)', textarea('reason', '', { rows: 2, maxlength: 1000, placeholder: 'e.g. Family visit; for medical leave, mention the certificate' })),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send request'))),
  async data => {
    await rpc('request_leave', { p_data: data });
    toast('Leave requested. A manager will review it.');
    refresh();
  });

  return layout('hr-leave',
    pageHead('Leave', `${sum.year} · annual and medical leave need a manager's approval`),
    leaveTiles(sum.annual, sum.medical),
    mgr && h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Team requests'),
        select('status', params.status ?? 'pending', [['pending', 'Waiting for approval'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['', 'All']],
          { 'aria-label': 'Show', onchange: e => { location.hash = '#/hr/leave?status=' + e.target.value; } })),
      all.length
        ? h('ul', { class: 'list' }, all.map(r => h('li', {},
            h('div', { class: 'grow' },
              h('div', { class: 'body' }, h('a', { class: 'row-link', href: `#/hr/people/${r.profile_id}` }, r.name),
                ` · ${LEAVE_KIND[r.kind]}: ${fmtDate(r.start_date)}${r.end_date !== r.start_date ? ' – ' + fmtDate(r.end_date) : ''} · ${num(r.days)} day${Number(r.days) === 1 ? '' : 's'}`),
              h('div', { class: 'meta' }, [r.designation, `${num(r.remaining)} of ${r.entitled} days left`, r.reason].filter(Boolean).join(' · ')),
              r.decided_by_name && h('div', { class: 'meta' }, `${LEAVE_STATUS[r.status]} by ${r.decided_by_name}${r.decision_note ? ': "' + r.decision_note + '"' : ''}`)),
            h('div', { class: 'badge-stack' }, leaveBadge(r.status),
              h('div', { class: 'btn-row' },
                r.status === 'pending' && (r.profile_id !== state.user.id || state.user.role === 'admin') && [
                  h('button', { class: 'btn btn-primary btn-sm', onclick: () => decideDialog(r, true, refresh) }, 'Approve'),
                  h('button', { class: 'btn btn-danger btn-sm', onclick: () => decideDialog(r, false, refresh) }, 'Reject')],
                r.status === 'approved' && h('button', {
                  class: 'btn btn-secondary btn-sm',
                  onclick: async () => {
                    if (!confirmAction(`Cancel ${r.name}'s approved leave? The days go back to their balance.`)) return;
                    try { await rpc('cancel_leave', { p_id: r.id }); toast('Leave cancelled'); refresh(); } catch (err) { toast(err.message, true); }
                  },
                }, 'Cancel'))))))
        : h('p', { class: 'empty' }, (params.status ?? 'pending') === 'pending' ? 'No requests waiting for approval.' : 'None.')),
    h('div', { class: 'grid two-col' },
      h('section', { class: 'card' }, h('h2', {}, 'Request leave'), form),
      h('section', { class: 'card' }, h('h2', {}, 'My requests'),
        leaveRequestList(sum.requests, { showName: false, canCancel: r => r.status === 'pending', refresh }))));
}

// ---------- payslips ----------

const PAY_PARTS = [['basic_salary', 'Basic salary'], ['housing_allowance', 'Housing allowance'], ['transport_allowance', 'Transport allowance'],
  ['other_allowance', 'Other allowance'], ['overtime', 'Overtime'], ['bonus', 'Bonus']];

function payslipDialog(ps, people, period, refresh) {
  const isNew = !ps.id;
  const dlg = openDialog(isNew ? `New payslip for ${monthLabel(period)}` : `Payslip: ${ps.name}, ${monthLabel(ps.period)}`, handleForm(h('form', { class: 'form' },
    isNew && field('Employee', select('profile_id', '', [['', 'Pick…'], ...people.map(p => [p.id, p.name])], { required: true })),
    isNew && h('input', { type: 'hidden', name: 'period', value: period }),
    h('div', { class: 'form-grid' },
      PAY_PARTS.map(([k, label]) => field(`${label} (AED)`, input(k, ps[k] ?? '', { type: 'number', min: 0, step: '0.01' }))),
      field('Deductions (AED)', input('deductions', ps.deductions ?? '', { type: 'number', min: 0, step: '0.01' })),
      field('Deduction reason', input('deduction_note', ps.deduction_note, { maxlength: 300, placeholder: 'e.g. Salary advance, traffic fine' }))),
    field('Note on the payslip (optional)', textarea('notes', ps.notes, { rows: 2, maxlength: 1000 })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('save_payslip', { p_id: ps.id || null, p_data: data });
    dlg.close();
    toast('Payslip saved');
    refresh();
  }));
}

async function viewPayslips(params) {
  const period = params.month ? `${params.month}-01` : null;
  const data = await rpc('list_payslips', { p_period: period, p_profile: null });
  const refresh = () => render();
  if (data.mine) {
    return layout('hr-payslips', pageHead('My payslips', 'Your salary slips, published by a manager each month.'),
      h('section', { class: 'card' }, data.payslips.length
        ? h('ul', { class: 'list' }, data.payslips.map(p => h('li', {},
            h('div', { class: 'grow' }, h('a', { class: 'row-link', href: `#/hr/payslips/${p.id}` }, monthLabel(p.period))),
            h('strong', {}, money(p.net)))))
        : h('p', { class: 'empty' }, 'No payslips yet.')));
  }
  const act = (fn, args, message) => async () => {
    try { await rpc(fn, args); toast(message); refresh(); } catch (err) { toast(err.message, true); }
  };
  const drafts = data.payslips.filter(p => p.status === 'draft');
  return layout('hr-payslips',
    pageHead('Payslips', `${monthLabel(data.period)} · ${data.payslips.length} payslip${data.payslips.length === 1 ? '' : 's'} · net total ${money(data.payslips.reduce((t, p) => t + Number(p.net), 0))}`, [
      input('month', data.period.slice(0, 7), { type: 'month', 'aria-label': 'Month', onchange: e => { location.hash = '#/hr/payslips?month=' + e.target.value; } }),
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          try {
            const n = await rpc('generate_payslips', { p_period: data.period });
            toast(n ? `${n} draft payslip${n === 1 ? '' : 's'} created from salary packages` : 'Everyone with a salary set already has a payslip this month');
            refresh();
          } catch (err) { toast(err.message, true); }
        },
      }, 'Create payslips for this month'),
      drafts.length > 0 && h('button', {
        class: 'btn btn-secondary',
        onclick: async () => {
          if (!confirmAction(`Publish ${drafts.length} draft payslip${drafts.length === 1 ? '' : 's'}? Employees will be able to see them.`)) return;
          try {
            for (const p of drafts) await rpc('set_payslip_published', { p_id: p.id, p_published: true });
            toast('Payslips published');
            refresh();
          } catch (err) { toast(err.message, true); }
        },
      }, `Publish all drafts (${drafts.length})`),
    ]),
    h('section', { class: 'card' },
      data.payslips.length
        ? h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Employee'), h('th', { class: 'num hide-sm' }, 'Earnings'), h('th', { class: 'num hide-sm' }, 'Deductions'),
              h('th', { class: 'num' }, 'Net pay'), h('th', {}, 'Status'), h('th', {}, ''))),
            h('tbody', {}, data.payslips.map(p => h('tr', {},
              h('td', {}, h('a', { class: 'row-link', href: `#/hr/payslips/${p.id}` }, p.name), p.designation && h('div', { class: 'meta muted' }, p.designation)),
              h('td', { class: 'num hide-sm' }, money(p.gross)),
              h('td', { class: 'num hide-sm' }, money(p.deductions)),
              h('td', { class: 'num' }, money(p.net)),
              h('td', {}, p.status === 'published' ? h('span', { class: 'badge badge-active' }, 'Published') : h('span', { class: 'badge badge-plain' }, 'Draft')),
              h('td', {}, h('div', { class: 'btn-row' },
                p.status === 'draft' && h('button', {
                  class: 'btn btn-secondary btn-sm',
                  onclick: async () => {
                    try { payslipDialog({ ...(await rpc('get_payslip', { p_id: p.id })).payslip, name: p.name }, [], data.period, refresh); } catch (err) { toast(err.message, true); }
                  },
                }, 'Edit'),
                h('button', { class: 'btn btn-secondary btn-sm', onclick: act('set_payslip_published', { p_id: p.id, p_published: p.status !== 'published' },
                  p.status === 'published' ? 'Unpublished' : 'Published') }, p.status === 'published' ? 'Unpublish' : 'Publish'),
                p.status === 'draft' && h('button', {
                  class: 'btn btn-danger btn-sm', 'aria-label': `Delete ${p.name}'s payslip`,
                  onclick: () => { if (confirmAction(`Delete ${p.name}'s draft payslip?`)) act('delete_payslip', { p_id: p.id }, 'Payslip deleted')(); },
                }, 'Delete'))))))))
        : h('p', { class: 'empty' }, 'No payslips for this month yet. "Create payslips for this month" makes drafts from each employee\'s salary package.'),
      data.missing.length > 0 && h('div', { class: 'missing-payslips' },
        h('p', { class: 'muted' }, `No payslip yet: ${data.missing.map(m => m.name + (Number(m.basic_salary) ? '' : ' (no salary set)')).join(', ')}`),
        h('button', { class: 'btn btn-secondary btn-sm', onclick: () => payslipDialog({}, data.missing, data.period, refresh) }, '+ Add a payslip'))));
}

function payslipDocument(d) {
  const p = d.payslip;
  const e = d.employee;
  const c = d.company;
  return h('article', { class: 'inv-doc payslip-doc' },
    h('header', { class: 'inv-head' },
      h('div', {}, h('div', { class: 'inv-supplier' }, c.legal_name || 'Lowcaps'), String(c.address || '').split('\n').map(l => h('div', { class: 'muted' }, l))),
      h('div', { class: 'inv-title-block' }, h('div', { class: 'inv-title' }, 'PAYSLIP'), h('div', {}, monthLabel(p.period)))),
    h('dl', { class: 'facts' }, [['Employee', e.name], ['Employee no.', e.employee_no], ['Designation', e.designation], ['Department', e.department],
      ['Joining date', e.joining_date && fmtDate(e.joining_date)], ['Paid to', [e.bank_name, e.iban].filter(Boolean).join(' · ')]]
      .filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('table', { class: 'inv-lines' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Earnings'), h('th', { class: 'num' }, 'AED'))),
      h('tbody', {}, PAY_PARTS.filter(([k]) => Number(p[k]) > 0).map(([k, label]) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, amount(p[k])))),
        h('tr', {}, h('td', {}, h('strong', {}, 'Total earnings')), h('td', { class: 'num' }, h('strong', {}, amount(p.gross)))),
        Number(p.deductions) > 0 && h('tr', {}, h('td', {}, `Deductions${p.deduction_note ? ' (' + p.deduction_note + ')' : ''}`), h('td', { class: 'num' }, `- ${amount(p.deductions)}`)))),
    h('dl', { class: 'inv-totals' }, h('dt', { class: 'grand' }, 'Net pay'), h('dd', { class: 'grand' }, money(p.net))),
    p.notes && h('p', { class: 'prewrap' }, p.notes),
    h('p', { class: 'muted' }, 'This payslip is generated by Lowcaps ERP.'));
}

function buildPayslipPdf(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const p = d.payslip;
  const e = d.employee;
  const c = d.company;
  const GREEN = [74, 122, 92];
  const DARK = [28, 42, 34];
  const GREY = [90, 107, 96];
  const W = 210;
  const M = 15;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...GREEN);
  doc.text(pdfText(c.legal_name || 'Lowcaps'), M, M + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY);
  const addr = String(c.address || '').split('\n').filter(Boolean).map(pdfText);
  addr.forEach((l, i) => doc.text(l, M, M + 11 + i * 4.3));
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...DARK);
  doc.text('PAYSLIP', W - M, M + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(pdfText(monthLabel(p.period)), W - M, M + 11, { align: 'right' });
  let y = Math.max(M + 11 + addr.length * 4.3, M + 14) + 6;
  doc.setDrawColor(219, 229, 222); doc.line(M, y, W - M, y);
  y += 7;
  const info = [['Employee', e.name], ['Employee no.', e.employee_no], ['Designation', e.designation], ['Department', e.department],
    ['Joining date', e.joining_date && fmtDate(e.joining_date)], ['Paid to', [e.bank_name, e.iban].filter(Boolean).join(' - ')]].filter(([, v]) => v);
  doc.setFontSize(9.5);
  info.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...GREY); doc.text(k, M, y + i * 5.5);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...DARK); doc.text(pdfText(v), M + 35, y + i * 5.5);
  });
  y += info.length * 5.5 + 4;
  const body = PAY_PARTS.filter(([k]) => Number(p[k]) > 0).map(([k, label]) => [label, amount(p[k])]);
  body.push([{ content: 'Total earnings', styles: { fontStyle: 'bold' } }, { content: amount(p.gross), styles: { fontStyle: 'bold' } }]);
  if (Number(p.deductions) > 0) body.push([pdfText(`Deductions${p.deduction_note ? ' (' + p.deduction_note + ')' : ''}`), `- ${amount(p.deductions)}`]);
  window.autoTable(doc, {
    startY: y, margin: { left: M, right: M }, head: [['Earnings and deductions', 'AED']], body,
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 2.2, textColor: DARK, lineColor: [219, 229, 222], lineWidth: 0.1 },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 40 } },
    didParseCell: cell => { if (cell.section === 'head' && cell.column.index === 1) cell.cell.styles.halign = 'right'; },
  });
  y = doc.lastAutoTable.finalY + 9;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...DARK);
  doc.text('Net pay', W - M - 45, y, { align: 'right' });
  doc.text(money(p.net), W - M, y, { align: 'right' });
  y += 10;
  if (p.notes) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.splitTextToSize(pdfText(p.notes), W - 2 * M).forEach(l => { doc.text(l, M, y); y += 4.3; });
  }
  doc.setFontSize(8); doc.setTextColor(...GREY);
  doc.text(`Payslip ${pdfText(e.name)} ${monthLabel(p.period)} - confidential`, W - M, 290, { align: 'right' });
  return doc;
}

async function viewPayslip(id) {
  const d = await rpc('get_payslip', { p_id: id });
  const fileName = `Payslip-${d.payslip.period.slice(0, 7)}-${d.employee.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
  return layout('hr-payslips',
    pageHead(`Payslip: ${monthLabel(d.payslip.period)}`, d.employee.name, [
      h('button', {
        class: 'btn btn-primary',
        onclick: () => { try { buildPayslipPdf(d).save(fileName); } catch (err) { toast('Could not create the PDF: ' + err.message, true); } },
      }, icon('download'), 'Download PDF'),
    ], [h('a', { href: '#/hr/payslips' }, '← Payslips'), ' ',
      d.payslip.status === 'published' ? h('span', { class: 'badge badge-active' }, 'Published') : h('span', { class: 'badge badge-plain' }, 'Draft')]),
    h('section', { class: 'card' }, payslipDocument(d)));
}

// ---------- people ----------

async function viewPeople() {
  const people = await rpc('hr_directory');
  const mgr = isManager();
  return layout('hr-people',
    pageHead('Team', mgr ? 'Everyone\'s records. Click a name for the full record.' : 'Colleagues\' contact details. Click your own name for your full record.'),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Designation'), h('th', { class: 'hide-sm' }, 'Department'),
        h('th', {}, 'Email'), h('th', { class: 'hide-sm' }, 'Phone'), mgr && h('th', { class: 'hide-sm' }, 'Joined'))),
      h('tbody', {}, people.map(p => h('tr', {},
        h('td', {}, h('a', { class: 'row-link', href: `#/hr/people/${p.id}` }, p.name),
          p.id === state.user.id && h('span', { class: 'muted' }, ' (you)'),
          p.status === 'left' && [' ', h('span', { class: 'badge badge-inactive' }, 'Left')],
          mgr && p.employee_no && h('div', { class: 'meta muted' }, p.employee_no)),
        h('td', {}, p.designation || h('span', { class: 'muted' }, '—')),
        h('td', { class: 'hide-sm' }, p.department || h('span', { class: 'muted' }, '—')),
        h('td', {}, h('a', { href: `mailto:${p.email}` }, p.email)),
        h('td', { class: 'hide-sm' }, p.work_phone || h('span', { class: 'muted' }, '—')),
        mgr && h('td', { class: 'hide-sm' }, p.joining_date ? fmtDate(p.joining_date) : h('span', { class: 'muted' }, '—')))))))));
}

function expiryBadge(date, today) {
  if (!date) return null;
  const days = daysBetween(today, date);
  if (days < 0) return h('span', { class: 'badge badge-overdue' }, `Expired ${fmtDate(date)}`);
  if (days <= 60) return h('span', { class: 'badge badge-lead' }, `Expires ${fmtDate(date)}`);
  return fmtDate(date);
}

async function viewPerson(idParam) {
  const id = idParam === 'me' ? state.user.id : idParam;
  const e = await rpc('get_employee', { p_id: id });
  const self = id === state.user.id;
  const section = (title, rows) => {
    const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
    return h('section', { class: 'card' }, h('h2', {}, title),
      shown.length ? h('dl', { class: 'facts' }, shown.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : h('p', { class: 'empty' }, 'Not filled in yet.'));
  };
  if (!e.full) {
    return layout('hr-people', pageHead(e.name, e.designation, null, h('a', { href: '#/hr/people' }, '← Team')),
      section('Contact', [['Designation', e.designation], ['Department', e.department], ['Email', h('a', { href: `mailto:${e.email}` }, e.email)], ['Phone', e.work_phone]]));
  }
  const [leave, payslips] = await Promise.all([
    rpc('leave_summary', { p_profile: id }),
    isManager() && !self ? rpc('list_payslips', { p_profile: id }) : null,
  ]);
  const total = ['basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowance'].reduce((t, k) => t + Number(e[k] || 0), 0);
  return layout('hr-people',
    pageHead(e.name, [e.designation, e.department].filter(Boolean).join(' · ') || ROLE_LABEL[e.role], [
      isManager() && h('a', { class: 'btn btn-primary', href: `#/hr/people/${id}/edit` }, 'Edit record'),
      isManager() && !self && h('a', { class: 'btn btn-secondary', href: `#/hr/attendance?person=${id}` }, 'Attendance'),
    ], [h('a', { href: '#/hr/people' }, '← Team'), ' ', e.status === 'left' ? h('span', { class: 'badge badge-inactive' }, 'Left') : null]),
    !isManager() && self && h('p', { class: 'muted' }, 'Only you and managers can see these details. If something is wrong, ask a manager to update it.'),
    h('div', { class: 'grid two-col' },
      h('div', {},
        section('Job', [['Employee no.', e.employee_no], ['Designation', e.designation], ['Department', e.department],
          ['Joining date', e.joining_date && fmtDate(e.joining_date)], ['ERP access', ROLE_LABEL[e.role]],
          ['Left on', e.status === 'left' && e.leaving_date && fmtDate(e.leaving_date)]]),
        section('Contact', [['Work email', h('a', { href: `mailto:${e.email}` }, e.email)], ['Work phone', e.work_phone],
          ['Personal email', e.personal_email], ['Personal phone', e.personal_phone], ['Address', e.address]]),
        section('Personal', [['Date of birth', e.date_of_birth && fmtDate(e.date_of_birth)], ['Gender', e.gender && e.gender[0].toUpperCase() + e.gender.slice(1)],
          ['Nationality', e.nationality],
          ['Emergency contact', [e.emergency_name, e.emergency_relation && `(${e.emergency_relation})`, e.emergency_phone].filter(Boolean).join(' ')]])),
      h('div', {},
        section('Documents', [['Emirates ID', e.emirates_id], ['Emirates ID expiry', expiryBadge(e.emirates_id_expiry, e.today)],
          ['Passport', e.passport_no], ['Passport expiry', expiryBadge(e.passport_expiry, e.today)], ['Visa expiry', expiryBadge(e.visa_expiry, e.today)]]),
        section('Salary and bank', [['Basic salary', Number(e.basic_salary) ? money(e.basic_salary) : null],
          ['Housing allowance', Number(e.housing_allowance) ? money(e.housing_allowance) : null],
          ['Transport allowance', Number(e.transport_allowance) ? money(e.transport_allowance) : null],
          ['Other allowance', Number(e.other_allowance) ? money(e.other_allowance) : null],
          ['Total package', total ? h('strong', {}, `${money(total)} / month`) : null], ['Bank', e.bank_name], ['IBAN', e.iban]]),
        h('section', { class: 'card' }, h('h2', {}, `Leave in ${leave.year}`),
          h('dl', { class: 'facts' },
            h('dt', {}, 'Annual'), h('dd', {}, `${num(leave.annual.remaining)} of ${num(leave.annual.entitled)} left · ${num(leave.annual.taken)} taken · ${num(leave.annual.pending)} pending`),
            h('dt', {}, 'Medical'), h('dd', {}, `${num(leave.medical.remaining)} of ${num(leave.medical.entitled)} left · ${num(leave.medical.taken)} taken · ${num(leave.medical.pending)} pending`)),
          leaveRequestList(leave.requests.slice(0, 5), { showName: false, canCancel: () => false, refresh: () => render() })),
        payslips && h('section', { class: 'card' }, h('h2', {}, 'Payslips'),
          payslips.payslips.length
            ? h('ul', { class: 'list' }, payslips.payslips.map(p => h('li', {},
                h('div', { class: 'grow' }, h('a', { class: 'row-link', href: `#/hr/payslips/${p.id}` }, monthLabel(p.period))),
                h('div', { class: 'badge-stack' }, h('strong', {}, money(p.net)), p.status === 'draft' && h('span', { class: 'badge badge-plain' }, 'Draft')))))
            : h('p', { class: 'empty' }, 'No payslips yet.')),
        e.notes && isManager() && section('Notes (managers only)', [['', h('span', { class: 'prewrap' }, e.notes)]]))));
}

async function viewPersonEdit(id) {
  if (!isManager()) return viewNotFound();
  const e = await rpc('get_employee', { p_id: id });
  const t = (name, label, attrs = {}, opts = {}) => field(label, input(name, e[name] ?? '', attrs), opts);
  const d = (name, label) => field(label, input(name, e[name] ?? '', { type: 'date' }));
  const m = (name, label) => field(`${label} (AED)`, input(name, Number(e[name]) ? e[name] : '', { type: 'number', min: 0, step: '0.01' }));
  const heading = text => h('h2', { class: 'full form-section' }, text);
  const form = handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      heading('Job'),
      t('employee_no', 'Employee no.', { maxlength: 30 }), t('designation', 'Designation', { maxlength: 100, placeholder: 'e.g. Customs clearance officer' }),
      t('department', 'Department', { maxlength: 100, placeholder: 'e.g. Operations' }), d('joining_date', 'Joining date'),
      field('Status', select('status', e.status || 'active', [['active', 'Working here'], ['left', 'Left the company']])), d('leaving_date', 'Leaving date'),
      heading('Contact'),
      t('work_phone', 'Work phone', { type: 'tel', maxlength: 30 }), t('personal_phone', 'Personal phone', { type: 'tel', maxlength: 30 }),
      t('personal_email', 'Personal email', { type: 'email', maxlength: 200 }),
      field('Address', textarea('address', e.address, { rows: 2, maxlength: 500 }), { full: true }),
      heading('Personal'),
      d('date_of_birth', 'Date of birth'),
      field('Gender', select('gender', e.gender || '', [['', '—'], ['male', 'Male'], ['female', 'Female']])),
      t('nationality', 'Nationality', { maxlength: 60 }), h('div'),
      t('emergency_name', 'Emergency contact name', { maxlength: 100 }), t('emergency_relation', 'Relationship', { maxlength: 50 }),
      t('emergency_phone', 'Emergency contact phone', { type: 'tel', maxlength: 30 }), h('div'),
      heading('Documents'),
      t('emirates_id', 'Emirates ID no.', { maxlength: 30, placeholder: '784-XXXX-XXXXXXX-X' }), d('emirates_id_expiry', 'Emirates ID expiry'),
      t('passport_no', 'Passport no.', { maxlength: 30 }), d('passport_expiry', 'Passport expiry'),
      d('visa_expiry', 'Visa expiry'), h('div'),
      heading('Salary package (monthly) and bank'),
      m('basic_salary', 'Basic salary'), m('housing_allowance', 'Housing allowance'),
      m('transport_allowance', 'Transport allowance'), m('other_allowance', 'Other allowance'),
      t('bank_name', 'Bank', { maxlength: 100 }), t('iban', 'IBAN', { maxlength: 50 }),
      heading('Leave entitlement per year'),
      t('annual_leave_days', 'Annual leave days', { type: 'number', min: 0, max: 366, placeholder: `Company default (${e.annual_entitled})` },
        { hint: 'Leave empty to use the company default.' }),
      t('medical_leave_days', 'Medical leave days', { type: 'number', min: 0, max: 366, placeholder: `Company default (${e.medical_entitled})` }),
      field('Notes (managers only)', textarea('notes', e.notes, { rows: 2, maxlength: 2000 }), { full: true })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('a', { class: 'btn btn-secondary', href: `#/hr/people/${id}` }, 'Cancel'))),
  async data => {
    await rpc('save_employee', { p_id: id, p_data: data });
    toast('Employee record saved');
    location.hash = `#/hr/people/${id}`;
  });
  return layout('hr-people',
    pageHead(`Edit: ${e.name}`, `${e.email} · ERP access: ${ROLE_LABEL[e.role]}${state.user.role === 'admin' ? ' (change it under Users)' : ''}`, null,
      h('a', { href: `#/hr/people/${id}` }, '← Back')),
    h('section', { class: 'card' }, form));
}

// ---------- HR settings (admins, on the Company settings page) ----------

function hrSettingsCard(s) {
  const lat = input('office_lat', s.office_lat ?? '', { inputmode: 'decimal', placeholder: 'e.g. 25.3463' });
  const lng = input('office_lng', s.office_lng ?? '', { inputmode: 'decimal', placeholder: 'e.g. 56.3418' });
  const form = handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field('Office latitude', lat), field('Office longitude', lng),
      h('div', { class: 'full' }, h('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: async e => {
          e.currentTarget.disabled = true;
          const loc = await getLocation();
          e.currentTarget.disabled = false;
          if (!loc) { toast('Location not available. Allow location for this site, or type the numbers in.', true); return; }
          lat.value = loc.lat.toFixed(6);
          lng.value = loc.lng.toFixed(6);
          toast(`Location filled in (accurate to about ${Math.round(loc.accuracy)} m). Save to keep it.`);
        },
      }, 'Use my current location (do this at the office)')),
      field('Counts as "at office" within (metres)', input('office_radius_m', s.office_radius_m, { type: 'number', min: 20, max: 5000 })),
      field('Work starts at', input('work_start', s.work_start, { type: 'time' }), { hint: 'Sign-ins after this are marked late.' }),
      field('Annual leave days per year (default)', input('annual_leave_days', s.annual_leave_days, { type: 'number', min: 0, max: 366 })),
      field('Medical leave days per year (default)', input('medical_leave_days', s.medical_leave_days, { type: 'number', min: 0, max: 366 })),
      h('div', { class: 'field full', 'data-field': 'weekend_days' }, h('label', {}, 'Weekend days (not counted as leave)'),
        h('div', { class: 'btn-row' }, [1, 2, 3, 4, 5, 6, 0].map(dnum => h('label', { class: 'check' },
          h('input', { type: 'checkbox', name: 'wd', 'data-group': 'weekend_days', value: String(dnum), checked: s.weekend_days.includes(dnum) }),
          DAY_NAMES[dnum]))))),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save HR settings'))),
  async data => {
    delete data.wd;
    data.weekend_days = (data.weekend_days || []).map(Number);
    await rpc('save_hr_settings', { p_data: data });
    toast('HR settings saved');
    render();
  });
  return h('section', { class: 'card' }, h('h2', {}, 'HR: office, working hours and leave'), form);
}

// ---------- finance ----------

const ACC_TYPE = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
const ACC_SUBTYPE = {
  cash: 'Cash', bank: 'Bank', pdc: 'Cheques in hand', receivable: 'Receivables', current_asset: 'Other current assets',
  fixed_asset: 'Fixed assets', vat_input: 'VAT input', payable: 'Payables', vat_output: 'VAT output', customer_advance: 'Customer advances',
  current_liability: 'Current liabilities', long_term_liability: 'Long-term liabilities', equity: 'Capital', retained_earnings: 'Retained earnings',
  opening_equity: 'Opening balance equity', revenue: 'Revenue', other_income: 'Other income', cost_of_sales: 'Cost of sales', expense: 'Operating expenses',
};
const SUBTYPES_BY_TYPE = {
  asset: ['bank', 'cash', 'pdc', 'receivable', 'current_asset', 'fixed_asset', 'vat_input'],
  liability: ['payable', 'vat_output', 'customer_advance', 'current_liability', 'long_term_liability'],
  equity: ['equity', 'retained_earnings', 'opening_equity'],
  income: ['revenue', 'other_income'],
  expense: ['cost_of_sales', 'expense'],
};
const JOURNAL_KIND = {
  journal: 'Journal', adjustment: 'Adjustment', accrual: 'Accrual', prepayment: 'Prepayment', opening: 'Opening balances',
  invoice: 'Invoice', payment: 'Payment', reversal: 'Reversal', bank_receipt: 'Money in', bank_payment: 'Money out', transfer: 'Transfer',
};
const dc = n => (Number(n) ? amount(Math.abs(n)) + (n > 0 ? ' Dr' : ' Cr') : '—');
const amt0 = n => (Number(n) ? amount(n) : '');

/** <select> of accounts grouped by type, showing "code · name". */
function accountSelect(name, value, accounts, attrs = {}, filter = () => true) {
  const s = h('select', { name, ...attrs }, h('option', { value: '' }, 'Pick an account…'),
    Object.entries(ACC_TYPE).map(([type, label]) => {
      const list = accounts.filter(a => a.type === type && (a.active || String(a.id) === String(value)) && filter(a));
      return list.length > 0 && h('optgroup', { label }, list.map(a => h('option', { value: String(a.id) }, `${a.code} · ${a.name}`)));
    }));
  s.value = value ? String(value) : '';
  return s;
}

function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A report table as a PDF; numCols are right-aligned. Rows may mark bold totals with {bold: true} cells. */
function downloadTablePdf(filename, title, subtitle, header, rows, numCols = []) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: header.length > 5 ? 'landscape' : 'portrait' });
    const W = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(28, 42, 34);
    doc.text(pdfText(title), 14, 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 107, 96);
    doc.text(pdfText(subtitle), 14, 22);
    window.autoTable(doc, {
      startY: 27, margin: { left: 14, right: 14 },
      head: [header.map(pdfText)],
      body: rows.map(r => r.map(c => (c && typeof c === 'object' ? { content: pdfText(c.text), styles: { fontStyle: 'bold' } } : pdfText(c)))),
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: [28, 42, 34], lineColor: [219, 229, 222], lineWidth: 0.1 },
      headStyles: { fillColor: [74, 122, 92], textColor: 255 },
      columnStyles: Object.fromEntries(numCols.map(i => [i, { halign: 'right' }])),
      didParseCell: cell => { if (cell.section === 'head' && numCols.includes(cell.column.index)) cell.cell.styles.halign = 'right'; },
    });
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(7.5); doc.setTextColor(90, 107, 96);
      doc.text(`Lowcaps ERP · printed ${fmtDate(localToday())} · page ${p} of ${pages}`, W - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    }
    doc.save(filename);
  } catch (err) {
    toast('Could not create the PDF: ' + err.message, true);
  }
}

function exportButtons(name, title, subtitle, header, rows, numCols) {
  const plain = rows.map(r => r.map(c => (c && typeof c === 'object' ? c.text : c)));
  return [
    h('button', { class: 'btn btn-secondary btn-sm', onclick: () => downloadCsv(`${name}.csv`, header, plain) }, icon('download'), 'Excel (CSV)'),
    h('button', { class: 'btn btn-secondary btn-sm', onclick: () => downloadTablePdf(`${name}.pdf`, title, subtitle, header, rows, numCols) }, icon('download'), 'PDF'),
  ];
}

const sourceLink = j => (j.source_type === 'invoice' || (j.source && j.source.invoice_id)
  ? `#/invoices/${j.source ? j.source.invoice_id : j.source_id}` : null);

async function viewFinance() {
  const o = await rpc('finance_overview');
  const cashTotal = o.cash.filter(a => a.subtype !== 'pdc').reduce((t, a) => t + Number(a.balance), 0);
  const pdc = o.cash.filter(a => a.subtype === 'pdc').reduce((t, a) => t + Number(a.balance), 0);
  const tile = (label, value, href, sub) => h('a', { class: 'card stat', href }, h('div', { class: 'label' }, label),
    h('div', { class: 'value value-money' }, money(value)), sub && h('div', { class: 'meta' }, sub));
  const result = (label, r) => h('section', { class: 'card' }, h('h2', {}, label),
    h('dl', { class: 'pay-summary' },
      h('div', {}, h('dt', {}, 'Income'), h('dd', {}, money(r.income))),
      h('div', {}, h('dt', {}, 'Expenses'), h('dd', {}, money(r.expenses))),
      h('div', { class: r.income - r.expenses < 0 ? 'is-overdue' : 'is-paid' }, h('dt', {}, r.income - r.expenses < 0 ? 'Loss' : 'Profit'),
        h('dd', {}, money(Math.abs(r.income - r.expenses))))));
  return layout('finance',
    pageHead('Finance', o.books_locked_until ? `Books closed up to ${fmtDate(o.books_locked_until)}` : 'Accounts, ledgers and reports', [
      h('a', { class: 'btn btn-secondary', href: '#/finance/journals/new' }, '+ Journal entry'),
      h('a', { class: 'btn btn-primary', href: '#/finance/reports' }, 'Reports'),
    ]),
    h('div', { class: 'grid stats' },
      tile('Bank & cash', cashTotal, '#/finance/bank', pdc ? `+ ${money(pdc)} in cheques not cleared` : null),
      tile('Receivables', o.receivables, `#/finance/reports?report=tb`, 'Owed by customers'),
      tile('Customer advances', o.advances, '#/finance/bank', 'Received, not yet invoiced'),
      tile('VAT output this quarter', o.vat_output_quarter, '#/finance/reports?report=tb', `Since ${fmtDate(o.quarter_start)}`)),
    h('div', { class: 'grid two-col' }, result(`This month (since ${fmtDate(o.month_start)})`, o.month), result(`This year (since ${fmtDate(o.fy_start)})`, o.year)),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Recent entries'), h('a', { class: 'btn btn-secondary btn-sm', href: '#/finance/journals' }, 'See all')),
      o.recent.length
        ? h('ul', { class: 'list' }, o.recent.map(j => h('li', {},
            h('div', { class: 'grow' }, h('a', { class: 'row-link', href: `#/finance/journals/${j.id}` }, `${j.number} · ${j.memo || JOURNAL_KIND[j.kind]}`),
              h('div', { class: 'meta' }, `${fmtDate(j.entry_date)} · ${JOURNAL_KIND[j.kind]}`)),
            h('strong', {}, money(j.amount)))))
        : h('p', { class: 'empty' }, 'No entries yet. They appear as tax invoices are sent and payments recorded, or add a journal entry.')));
}

// ---------- chart of accounts ----------

function accountDialog(a, refresh) {
  const type = select('type', a.type || 'expense', Object.entries(ACC_TYPE).map(([k, v]) => [k, v.replace(/s$/, '')]));
  const subtype = h('select', { name: 'subtype' });
  const fillSub = () => {
    subtype.replaceChildren(...SUBTYPES_BY_TYPE[type.value].map(k => h('option', { value: k }, ACC_SUBTYPE[k])));
    if (SUBTYPES_BY_TYPE[type.value].includes(a.subtype)) subtype.value = a.subtype;
  };
  type.addEventListener('change', fillSub);
  fillSub();
  const dlg = openDialog(a.id ? `Edit ${a.code} · ${a.name}` : 'Add an account', handleForm(h('form', { class: 'form' },
    a.system_key && h('p', { class: 'muted' }, 'Automatic postings use this account. You can rename it; its type and group stay as they are.'),
    h('div', { class: 'form-grid' },
      field('Code', input('code', a.code, { required: true, inputmode: 'numeric', maxlength: 6, placeholder: 'e.g. 6250' })),
      field('Name', input('name', a.name, { required: true, maxlength: 100 })),
      field('Type', type), field('Group', subtype, { hint: 'Decides where it shows in the reports.' }),
      field('Bank name', input('bank_name', a.bank_name, { maxlength: 100 }), { hint: 'For bank accounts.' }),
      field('Account no. / IBAN', input('account_number', a.account_number, { maxlength: 50 })),
      field('Description', input('description', a.description, { maxlength: 300 }), { full: true })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: a.active !== false }), 'In use'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('save_account', { p_id: a.id || null, p_data: data });
    dlg.close();
    toast('Account saved');
    refresh();
  }));
}

async function viewAccounts() {
  const [accounts, settings] = await Promise.all([rpc('list_accounts', {}), rpc('get_finance_settings')]);
  const refresh = () => render();
  const admin = state.user.role === 'admin';
  const lockForm = admin && handleForm(h('form', { class: 'form' },
    h('div', { class: 'inline-form' },
      field('Close the books up to', input('date', settings.books_locked_until, { type: 'date', max: settings.today }),
        { hint: 'Nothing can be posted on or before this date (e.g. after a VAT return or the year-end). Leave empty to reopen.' }),
      h('button', { class: 'btn btn-secondary', type: 'submit' }, 'Save'))),
  async data => {
    await rpc('set_books_locked_until', { p_date: data.date || null });
    toast(data.date ? `Books closed up to ${fmtDate(data.date)}` : 'Books reopened');
    refresh();
  });
  return layout('finance-accounts',
    pageHead('Chart of accounts', `${accounts.length} accounts · balances for this financial year`,
      admin && h('button', { class: 'btn btn-primary', onclick: () => accountDialog({}, refresh) }, '+ Add account')),
    lockForm && h('section', { class: 'card' }, lockForm),
    Object.entries(ACC_TYPE).map(([type, label]) => h('section', { class: 'card' },
      h('h2', {}, label),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Account'), h('th', { class: 'hide-sm' }, 'Group'),
          h('th', { class: 'num' }, 'Balance'), admin && h('th', {}, ''))),
        h('tbody', {}, accounts.filter(a => a.type === type).map(a => h('tr', { class: a.active ? '' : 'row-off' },
          h('td', {}, a.code),
          h('td', {}, h('a', { class: 'row-link', href: `#/finance/ledger/${a.id}` }, a.name),
            !a.active && [' ', h('span', { class: 'badge badge-inactive' }, 'Switched off')],
            a.account_number && h('div', { class: 'meta muted' }, [a.bank_name, a.account_number].filter(Boolean).join(' · '))),
          h('td', { class: 'hide-sm' }, ACC_SUBTYPE[a.subtype]),
          h('td', { class: 'num' }, Number(a.balance) ? money(a.balance) : h('span', { class: 'muted' }, '—')),
          admin && h('td', {}, h('button', { class: 'btn btn-secondary btn-sm', onclick: () => accountDialog(a, refresh) }, 'Edit'))))))))));
}

// ---------- journals ----------

async function viewJournals(params) {
  const q = new URLSearchParams(params);
  const data = await rpc('list_journals', {
    p_q: q.get('q') || null, p_kind: q.get('kind') || null, p_from: q.get('from') || null, p_to: q.get('to') || null,
    p_page: Number(q.get('page')) || 1,
  });
  const setParam = (key, value) => {
    const n = new URLSearchParams(params);
    if (value) n.set(key, value); else n.delete(key);
    if (key !== 'page') n.delete('page');
    location.hash = '#/finance/journals' + (n.toString() ? '?' + n : '');
  };
  let timer;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return layout('finance-journals',
    pageHead('Journal entries', `${data.total} entr${data.total === 1 ? 'y' : 'ies'}`, [
      h('a', { class: 'btn btn-secondary', href: '#/finance/journals/new?kind=opening' }, 'Opening balances'),
      h('a', { class: 'btn btn-primary', href: '#/finance/journals/new' }, '+ Journal entry'),
    ]),
    h('section', { class: 'card' },
      h('div', { class: 'filters' },
        input('q', q.get('q'), { type: 'search', placeholder: 'Search number, description or reference…', 'aria-label': 'Search',
          oninput: e => { clearTimeout(timer); timer = setTimeout(() => setParam('q', e.target.value.trim()), 350); } }),
        select('kind', q.get('kind'), [['', 'All entries'], ['manual', 'Entered by hand'], ['automatic', 'From invoices & payments'],
          ...Object.entries(JOURNAL_KIND)], { 'aria-label': 'Kind', onchange: e => setParam('kind', e.target.value) }),
        input('from', q.get('from'), { type: 'date', 'aria-label': 'From', onchange: e => setParam('from', e.target.value) }),
        input('to', q.get('to'), { type: 'date', 'aria-label': 'To', onchange: e => setParam('to', e.target.value) })),
      data.journals.length
        ? h('div', { class: 'table-wrap' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Entry'), h('th', {}, 'Description'), h('th', { class: 'hide-sm' }, 'Kind'),
              h('th', { class: 'num' }, 'Amount'))),
            h('tbody', {}, data.journals.map(j => h('tr', { class: j.reversed_by_id ? 'row-off' : '' },
              h('td', {}, fmtDate(j.entry_date)),
              h('td', {}, h('a', { class: 'row-link', href: `#/finance/journals/${j.id}` }, j.number),
                j.reversed_by_id && h('div', { class: 'meta muted' }, 'Reversed')),
              h('td', {}, j.memo || '—', j.reference && h('div', { class: 'meta muted' }, j.reference)),
              h('td', { class: 'hide-sm' }, JOURNAL_KIND[j.kind]),
              h('td', { class: 'num' }, money(j.amount)))))))
        : h('p', { class: 'empty' }, 'No entries match.'),
      data.total > data.pageSize && h('div', { class: 'pager' },
        h('span', { class: 'muted' }, `Page ${data.page} of ${pages}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page <= 1, onclick: () => setParam('page', data.page - 1) }, 'Previous'),
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page >= pages, onclick: () => setParam('page', data.page + 1) }, 'Next')))));
}

async function viewJournalNew(params) {
  const opening = params.kind === 'opening';
  const [accounts, customers] = await Promise.all([rpc('list_accounts', { p_include_inactive: false }), rpc('customer_options')]);
  const tbody = h('tbody', {});
  const totals = h('p', { class: 'journal-totals' });
  const usable = opening ? a => ['asset', 'liability', 'equity'].includes(a.type) : () => true;
  const recalc = () => {
    let dr = 0; let cr = 0;
    for (const row of tbody.rows) {
      dr += Number(row.querySelector('.j-dr').value) || 0;
      cr += Number(row.querySelector('.j-cr').value) || 0;
    }
    dr = round2(dr); cr = round2(cr);
    const diff = round2(dr - cr);
    totals.replaceChildren(`Debits ${money(dr)} · Credits ${money(cr)} · `,
      diff === 0 && dr > 0 ? h('strong', { class: 'ok' }, 'Balanced ✓') : h('strong', { class: 'bad' }, `Difference ${money(Math.abs(diff))}`));
    return diff;
  };
  const addLine = (l = {}) => {
    const custCell = h('td', {});
    const acct = accountSelect('', l.account_id, accounts, { class: 'j-acct', 'aria-label': 'Account', required: true }, usable);
    const showCustomer = () => {
      const a = accounts.find(x => String(x.id) === acct.value);
      custCell.replaceChildren(a && ['receivable', 'customer_advance'].includes(a.subtype)
        ? select('', l.customer_id ? String(l.customer_id) : '', [['', 'Customer (optional)'], ...customers.map(c => [String(c.id), c.name])],
          { class: 'j-cust', 'aria-label': 'Customer' })
        : '');
    };
    acct.addEventListener('change', showCustomer);
    const dr = h('input', { class: 'j-dr', type: 'number', min: '0', step: '0.01', value: l.debit ?? '', 'aria-label': 'Debit', placeholder: '0.00', oninput: recalc });
    const cr = h('input', { class: 'j-cr', type: 'number', min: '0', step: '0.01', value: l.credit ?? '', 'aria-label': 'Credit', placeholder: '0.00', oninput: recalc });
    const row = h('tr', {},
      h('td', {}, acct),
      h('td', {}, h('input', { class: 'j-desc', value: l.description ?? '', maxlength: 300, 'aria-label': 'Line description', placeholder: 'Optional' })),
      custCell, h('td', {}, dr), h('td', {}, cr),
      h('td', {}, h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': 'Remove line',
        onclick: () => { if (tbody.rows.length > 2) { row.remove(); recalc(); } } }, '×')));
    tbody.append(row);
    showCustomer();
    recalc();
    return row;
  };
  addLine(); addLine();
  const openingEquity = accounts.find(a => a.system_key === 'opening_equity');
  const balanceOpening = () => {
    const diff = recalc();
    if (!diff) return;
    let row = [...tbody.rows].find(r => r.querySelector('.j-acct').value === String(openingEquity.id));
    if (!row) row = addLine({ account_id: openingEquity.id, description: 'Balancing figure' });
    const cur = (Number(row.querySelector('.j-dr').value) || 0) - (Number(row.querySelector('.j-cr').value) || 0);
    const next = round2(cur - diff);
    row.querySelector('.j-dr').value = next > 0 ? next.toFixed(2) : '';
    row.querySelector('.j-cr').value = next < 0 ? (-next).toFixed(2) : '';
    recalc();
  };
  const reverseField = field('Reverse automatically on (optional)', input('reverse_on', '', { type: 'date' }),
    { hint: 'For accruals and prepayments: the entry is undone on this date, e.g. the 1st of next month.' });
  const kind = select('kind', opening ? 'opening' : 'journal', [['journal', 'Journal'], ['adjustment', 'Adjustment'], ['accrual', 'Accrual'],
    ['prepayment', 'Prepayment'], ['opening', 'Opening balances']], {
    onchange: e => { reverseField.hidden = !['accrual', 'prepayment'].includes(e.target.value); },
  });
  reverseField.hidden = true;
  const form = handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field(opening ? 'Balances as at' : 'Date', input('entry_date', opening ? `${localToday().slice(0, 4)}-01-01` : localToday(), { type: 'date', required: true }),
        opening ? { hint: 'Usually the day you start using the ERP for accounts, e.g. 1 January.' } : {}),
      field('Kind', kind),
      field('Description', input('memo', opening ? 'Opening balances' : '', { required: true, maxlength: 500, placeholder: 'e.g. Office rent for December' }), { full: true }),
      field('Reference (optional)', input('reference', '', { maxlength: 100, placeholder: 'e.g. invoice or contract number' })),
      reverseField),
    h('div', { class: 'field', 'data-field': 'lines' },
      h('label', {}, 'Lines'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'inv-edit journal-edit' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Account'), h('th', {}, 'Line description'), h('th', {}, 'Customer'),
          h('th', {}, 'Debit (AED)'), h('th', {}, 'Credit (AED)'), h('th', {}, ''))),
        tbody)),
      h('div', { class: 'inv-edit-foot' },
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => addLine() }, '+ Add line'),
          opening && h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: balanceOpening }, 'Balance with Opening balance equity')),
        totals),
      h('div', { class: 'hint' }, opening
        ? 'Enter what each bank, cash, receivable, payable, VAT and capital account stood at. Put customer balances on Accounts receivable with the customer chosen. The difference goes to Opening balance equity.'
        : 'Debits must equal credits before the entry can be saved.')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Post entry'),
      h('a', { class: 'btn btn-secondary', href: '#/finance/journals' }, 'Cancel'))),
  async data => {
    data.lines = [...tbody.rows].map(r => ({
      account_id: r.querySelector('.j-acct').value, description: r.querySelector('.j-desc').value,
      debit: r.querySelector('.j-dr').value, credit: r.querySelector('.j-cr').value,
      customer_id: r.querySelector('.j-cust') ? r.querySelector('.j-cust').value : null,
    }));
    const id = await rpc('post_manual_journal', { p_data: data });
    toast('Entry posted');
    location.hash = `#/finance/journals/${id}`;
  });
  return layout('finance-journals',
    pageHead(opening ? 'Opening balances' : 'New journal entry', null, null, h('a', { href: '#/finance/journals' }, '← Journal entries')),
    h('section', { class: 'card' }, form));
}

function reverseDialog(j, refresh) {
  const dlg = openDialog(`Reverse ${j.number}`, handleForm(h('form', { class: 'form' },
    h('p', { class: 'muted' }, 'A new entry with the same lines, debits and credits swapped, cancels this one out. Both stay on record.'),
    field('Date of the reversal', input('date', localToday() < j.entry_date ? j.entry_date : localToday(), { type: 'date', required: true, min: j.entry_date })),
    field('Reason (optional)', input('memo', '', { maxlength: 500 })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-danger', type: 'submit' }, 'Reverse'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    const id = await rpc('reverse_entry', { p_id: j.id, p_date: data.date, p_memo: data.memo || null });
    dlg.close();
    toast('Entry reversed');
    location.hash = `#/finance/journals/${id}`;
  }));
}

async function viewJournal(id) {
  const { journal: j } = await rpc('get_journal', { p_id: id });
  const dr = j.lines.reduce((t, l) => t + Number(l.debit), 0);
  const cr = j.lines.reduce((t, l) => t + Number(l.credit), 0);
  const src = sourceLink(j);
  return layout('finance-journals',
    pageHead(j.number, `${fmtDate(j.entry_date)} · ${JOURNAL_KIND[j.kind]}${j.created_by_name ? ' · by ' + j.created_by_name : ''}`, [
      !j.source_type && !j.reversed_by_id && !j.reverses_id && h('button', { class: 'btn btn-danger', onclick: () => reverseDialog(j, () => render()) }, 'Reverse'),
    ], [h('a', { href: '#/finance/journals' }, '← Journal entries')]),
    h('section', { class: 'card' },
      h('dl', { class: 'facts' }, [
        ['Description', j.memo], ['Reference', j.reference],
        j.source && ['From', src ? h('a', { href: src }, j.source.label) : j.source.label],
        j.reverses_id && ['Reverses', h('a', { href: `#/finance/journals/${j.reverses_id}` }, j.reverses_number)],
        j.reversed_by_id && ['Reversed by', h('a', { href: `#/finance/journals/${j.reversed_by_id}` }, j.reversed_by_number)],
      ].filter(r => r && r[1]).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Account'), h('th', {}, 'Description'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'))),
        h('tbody', {}, j.lines.map(l => h('tr', {},
          h('td', {}, h('a', { class: 'row-link', href: `#/finance/ledger/${l.account_id}` }, `${l.code} · ${l.account}`),
            l.customer_name && h('div', { class: 'meta muted' }, l.customer_name)),
          h('td', {}, l.description || ''),
          h('td', { class: 'num' }, amt0(l.debit)), h('td', { class: 'num' }, amt0(l.credit)))),
          h('tr', { class: 'total-row' }, h('td', {}, 'Total'), h('td', {}), h('td', { class: 'num' }, amount(dr)), h('td', { class: 'num' }, amount(cr))))))));
}

// ---------- ledger ----------

async function viewLedger(accountId, params) {
  const fy = `${localToday().slice(0, 4)}-01-01`;
  const l = await rpc('account_ledger', { p_account: accountId, p_from: params.from || fy, p_to: params.to || localToday(),
    p_customer: Number(params.customer) || null });
  const a = l.account;
  const go = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); location.hash = `#/finance/ledger/${accountId}?` + n; };
  const header = ['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance'];
  const rows = [
    [fmtDate(l.from), '', { text: 'Opening balance' }, '', '', { text: amount(l.opening) }],
    ...l.lines.map(x => [fmtDate(x.entry_date), x.number, [x.memo, x.description, x.customer_name].filter(Boolean).join(' · '),
      amt0(x.debit), amt0(x.credit), amount(x.balance)]),
    [fmtDate(l.to), '', { text: 'Closing balance' }, '', '', { text: amount(l.closing) }],
  ];
  const subtitle = `${fmtDate(l.from)} – ${fmtDate(l.to)}${l.customer ? ' · ' + l.customer : ''} · balances shown as ${['asset', 'expense'].includes(a.type) ? 'debit' : 'credit'}`;
  return layout('finance-accounts',
    pageHead(`${a.code} · ${a.name}`, subtitle, [
      input('from', l.from, { type: 'date', 'aria-label': 'From', onchange: e => go('from', e.target.value) }),
      input('to', l.to, { type: 'date', 'aria-label': 'To', onchange: e => go('to', e.target.value) }),
      ...exportButtons(`Ledger-${a.code}-${l.from}-${l.to}`, `Ledger: ${a.code} ${a.name}`, subtitle, header, rows, [3, 4, 5]),
    ], [h('a', { href: '#/finance/accounts' }, '← Chart of accounts'), l.customer && [' · ', h('a', { href: `#/finance/ledger/${accountId}` }, 'All customers')]]),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, header.map((t, i) => h('th', { class: i >= 3 ? 'num' : '' }, t)))),
      h('tbody', {},
        h('tr', { class: 'total-row' }, h('td', {}, fmtDate(l.from)), h('td', {}), h('td', {}, 'Opening balance'), h('td', {}), h('td', {}), h('td', { class: 'num' }, amount(l.opening))),
        l.lines.map(x => h('tr', {},
          h('td', {}, fmtDate(x.entry_date)),
          h('td', {}, h('a', { class: 'row-link', href: `#/finance/journals/${x.journal_id}` }, x.number)),
          h('td', {}, x.memo || JOURNAL_KIND[x.kind], x.description && h('div', { class: 'meta muted' }, x.description),
            x.customer_name && h('div', { class: 'meta' }, h('a', { href: `#/finance/ledger/${accountId}?customer=${x.customer_id}` }, x.customer_name))),
          h('td', { class: 'num' }, amt0(x.debit)), h('td', { class: 'num' }, amt0(x.credit)), h('td', { class: 'num' }, amount(x.balance)))),
        h('tr', { class: 'total-row' }, h('td', {}, fmtDate(l.to)), h('td', {}), h('td', {}, 'Closing balance'), h('td', {}), h('td', {}), h('td', { class: 'num' }, amount(l.closing))))))));
}

// ---------- bank & cash ----------

function bankDialog(kind, accounts, cashAccounts, refresh) {
  const titles = { in: 'Money in', out: 'Money out', transfer: 'Transfer between accounts' };
  const banks = cashAccounts.filter(a => a.subtype !== 'pdc' && a.active);
  const dlg = openDialog(titles[kind], handleForm(h('form', { class: 'form' },
    h('div', { class: 'form-grid' },
      field(kind === 'in' ? 'Into' : 'From', select('account_id', banks[0] ? String(banks[0].id) : '', banks.map(a => [String(a.id), `${a.code} · ${a.name}`]), { required: true })),
      kind === 'transfer'
        ? field('To', select('other_account_id', banks[1] ? String(banks[1].id) : '', banks.map(a => [String(a.id), `${a.code} · ${a.name}`]), { required: true }))
        : field(kind === 'in' ? 'What it is for (income or other account)' : 'What it was for (expense or other account)',
          accountSelect('other_account_id', '', accounts, { required: true }, a => !['bank', 'cash', 'pdc'].includes(a.subtype))),
      field('Amount (AED)', input('amount', '', { type: 'number', min: '0.01', step: '0.01', required: true })),
      field('Date', input('entry_date', localToday(), { type: 'date', required: true })),
      field('Description', input('memo', '', { required: true, maxlength: 500, placeholder: kind === 'out' ? 'e.g. Electricity bill, November' : kind === 'in' ? 'e.g. Refund of deposit' : 'e.g. Top up petty cash' }), { full: true }),
      field('Reference (optional)', input('reference', '', { maxlength: 100 }))),
    kind !== 'transfer' && h('p', { class: 'hint' }, 'Customer payments for invoices are recorded on the invoice instead (Record payment). Supplier bills with VAT come in phase 2.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    await rpc('bank_transaction', { p_data: { ...data, kind } });
    dlg.close();
    toast('Saved');
    refresh();
  }));
}

async function viewBank() {
  const [cashAccounts, accounts] = await Promise.all([rpc('cash_accounts'), rpc('list_accounts', { p_include_inactive: false })]);
  const refresh = () => render();
  return layout('finance-bank',
    pageHead('Bank & cash', 'Balances of each bank account, cash box and cheques not yet cleared.', [
      h('button', { class: 'btn btn-secondary', onclick: () => bankDialog('in', accounts, cashAccounts, refresh) }, '+ Money in'),
      h('button', { class: 'btn btn-secondary', onclick: () => bankDialog('out', accounts, cashAccounts, refresh) }, '− Money out'),
      h('button', { class: 'btn btn-secondary', onclick: () => bankDialog('transfer', accounts, cashAccounts, refresh) }, '⇄ Transfer'),
    ]),
    h('div', { class: 'grid stats' }, cashAccounts.filter(a => a.active || Number(a.balance)).map(a => h('a', { class: 'card stat', href: `#/finance/ledger/${a.id}` },
      h('div', { class: 'label' }, `${a.code} · ${a.name}`),
      h('div', { class: 'value value-money' }, money(a.balance)),
      h('div', { class: 'meta' }, a.subtype === 'pdc' ? 'Cheques received, not cleared yet' : [ACC_SUBTYPE[a.subtype], a.bank_name, a.account_number].filter(Boolean).join(' · '))))),
    state.user.role === 'admin' && h('p', { class: 'muted' }, 'Add more bank accounts or a petty cash box in the ', h('a', { href: '#/finance/accounts' }, 'chart of accounts'),
      ' (type Asset, group Bank or Cash).'));
}

// ---------- reports ----------

function periodPresets(from, to, onPick) {
  const t = localToday();
  const y = t.slice(0, 4);
  const m = t.slice(0, 7);
  const qm = String(Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0');
  const presets = [['This month', `${m}-01`, t], ['This quarter', `${y}-${qm}-01`, t], ['This year', `${y}-01-01`, t],
    ['Last year', `${Number(y) - 1}-01-01`, `${Number(y) - 1}-12-31`]];
  return h('div', { class: 'btn-row' }, presets.map(([label, f, to2]) =>
    h('button', { class: `btn btn-sm ${f === from && to2 === to ? 'btn-primary' : 'btn-secondary'}`, type: 'button', onclick: () => onPick(f, to2) }, label)));
}

async function viewReports(params) {
  const report = params.report || 'pl';
  const t = localToday();
  const from = params.from || `${t.slice(0, 4)}-01-01`;
  const to = params.to || t;
  const go = changes => {
    const n = new URLSearchParams({ report, from, to, ...changes });
    location.hash = '#/finance/reports?' + n;
  };
  const tabs = h('div', { class: 'tabs' }, [['pl', 'Profit & loss'], ['bs', 'Balance sheet'], ['tb', 'Trial balance']].map(([k, label]) =>
    h('button', { type: 'button', 'aria-pressed': String(report === k), onclick: () => go({ report: k }) }, label)));
  const dates = h('div', { class: 'filters report-dates' },
    report !== 'bs' && input('from', from, { type: 'date', 'aria-label': 'From', onchange: e => go({ from: e.target.value }) }),
    input('to', to, { type: 'date', 'aria-label': report === 'bs' ? 'As at' : 'To', onchange: e => go({ to: e.target.value }) }),
    report !== 'bs' && periodPresets(from, to, (f, t2) => go({ from: f, to: t2 })));
  const ledgerLink = (r, text) => h('a', { class: 'row-link', href: `#/finance/ledger/${r.id}?from=${report === 'bs' ? `${to.slice(0, 4)}-01-01` : from}&to=${to}` }, text);

  let body;
  let exportRows = [];
  let header = [];
  let numCols = [];
  let title = '';
  let subtitle = '';

  if (report === 'tb') {
    const tb = await rpc('trial_balance', { p_from: from, p_to: to });
    title = 'Trial balance';
    subtitle = `${fmtDate(tb.from)} – ${fmtDate(tb.to)}`;
    header = ['Code', 'Account', 'Opening', 'Debit', 'Credit', 'Closing debit', 'Closing credit'];
    numCols = [2, 3, 4, 5, 6];
    const tot = { dr: 0, cr: 0, cdr: 0, ccr: 0 };
    const rows = tb.rows.map(r => {
      const closing = round2(Number(r.opening) + Number(r.debit) - Number(r.credit));
      tot.dr += Number(r.debit); tot.cr += Number(r.credit);
      if (closing > 0) tot.cdr += closing; else tot.ccr -= closing;
      return { r, closing };
    });
    exportRows = [...rows.map(({ r, closing }) => [r.code, r.name, dc(r.opening), amt0(r.debit), amt0(r.credit), closing > 0 ? amount(closing) : '', closing < 0 ? amount(-closing) : '']),
      [{ text: 'Total' }, '', '', { text: amount(tot.dr) }, { text: amount(tot.cr) }, { text: amount(tot.cdr) }, { text: amount(tot.ccr) }]];
    const balanced = round2(tot.cdr) === round2(tot.ccr);
    body = [
      h('p', { class: balanced ? 'muted' : 'form-error' }, balanced ? 'Debits equal credits ✓' : `Out of balance by ${money(Math.abs(tot.cdr - tot.ccr))}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'report' },
        h('thead', {}, h('tr', {}, header.map((x, i) => h('th', { class: numCols.includes(i) ? 'num' : '' }, x)))),
        h('tbody', {}, rows.map(({ r, closing }) => h('tr', {},
          h('td', {}, r.code), h('td', {}, ledgerLink(r, r.name)), h('td', { class: 'num' }, dc(r.opening)),
          h('td', { class: 'num' }, amt0(r.debit)), h('td', { class: 'num' }, amt0(r.credit)),
          h('td', { class: 'num' }, closing > 0 ? amount(closing) : ''), h('td', { class: 'num' }, closing < 0 ? amount(-closing) : ''))),
          h('tr', { class: 'total-row' }, h('td', {}, 'Total'), h('td', {}), h('td', {}), h('td', { class: 'num' }, amount(tot.dr)), h('td', { class: 'num' }, amount(tot.cr)),
            h('td', { class: 'num' }, amount(tot.cdr)), h('td', { class: 'num' }, amount(tot.ccr))))))];
  } else if (report === 'pl') {
    const pl = await rpc('profit_loss', { p_from: from, p_to: to });
    title = 'Profit and loss';
    subtitle = `${fmtDate(pl.from)} – ${fmtDate(pl.to)}`;
    header = ['Account', 'AED'];
    numCols = [1];
    const sum = st => pl.rows.filter(r => st.includes(r.subtype)).reduce((t, r) => t + Number(r.amount), 0);
    const revenue = sum(['revenue']); const cos = sum(['cost_of_sales']); const opex = sum(['expense']); const other = sum(['other_income']);
    const gross = revenue - cos; const net = gross - opex + other;
    const section = (label, st) => {
      const rows = pl.rows.filter(r => st.includes(r.subtype));
      exportRows.push([{ text: label }, ''], ...rows.map(r => [`${r.code} ${r.name}`, amount(r.amount)]), [{ text: `Total ${label.toLowerCase()}` }, { text: amount(sum(st)) }]);
      return [h('tr', { class: 'section-row' }, h('td', { colspan: 2 }, label)),
        rows.length ? rows.map(r => h('tr', {}, h('td', {}, ledgerLink(r, `${r.code} · ${r.name}`)), h('td', { class: 'num' }, amount(r.amount))))
          : h('tr', {}, h('td', { class: 'muted' }, 'None'), h('td', {})),
        h('tr', { class: 'total-row' }, h('td', {}, `Total ${label.toLowerCase()}`), h('td', { class: 'num' }, amount(sum(st))))];
    };
    const line = (label, v, cls = 'total-row') => { exportRows.push([{ text: label }, { text: amount(v) }]); return h('tr', { class: cls }, h('td', {}, label), h('td', { class: 'num' }, amount(v))); };
    body = h('div', { class: 'table-wrap' }, h('table', { class: 'report report-narrow' }, h('tbody', {},
      section('Revenue', ['revenue']), section('Cost of sales', ['cost_of_sales']), line('Gross profit', gross, 'grand-row'),
      section('Operating expenses', ['expense']), section('Other income', ['other_income']),
      line(net >= 0 ? 'Net profit' : 'Net loss', net, 'grand-row'))));
  } else {
    const bs = await rpc('balance_sheet', { p_as_of: to });
    title = 'Balance sheet';
    subtitle = `As at ${fmtDate(bs.as_of)}`;
    header = ['Account', 'AED'];
    numCols = [1];
    const groupRows = type => {
      const rows = bs.rows.filter(r => r.type === type);
      const out = [];
      for (const st of SUBTYPES_BY_TYPE[type]) {
        const g = rows.filter(r => r.subtype === st);
        if (!g.length) continue;
        out.push(h('tr', { class: 'sub-row' }, h('td', { colspan: 2 }, ACC_SUBTYPE[st])));
        exportRows.push([ACC_SUBTYPE[st], '']);
        g.forEach(r => { out.push(h('tr', {}, h('td', {}, ledgerLink(r, `${r.code} · ${r.name}`)), h('td', { class: 'num' }, amount(r.amount)))); exportRows.push([`${r.code} ${r.name}`, amount(r.amount)]); });
      }
      return out;
    };
    const total = type => bs.rows.filter(r => r.type === type).reduce((t, r) => t + Number(r.amount), 0);
    const assets = total('asset'); const liabilities = total('liability'); const equity = total('equity') + Number(bs.current_year_profit);
    const block = (label, type, extra, tot) => {
      exportRows.push([{ text: label }, '']);
      const rows = groupRows(type);
      if (extra) exportRows.push([extra[0], amount(extra[1])]);
      exportRows.push([{ text: `Total ${label.toLowerCase()}` }, { text: amount(tot) }]);
      return [h('tr', { class: 'section-row' }, h('td', { colspan: 2 }, label)), rows,
        extra && h('tr', {}, h('td', {}, extra[0]), h('td', { class: 'num' }, amount(extra[1]))),
        h('tr', { class: 'total-row' }, h('td', {}, `Total ${label.toLowerCase()}`), h('td', { class: 'num' }, amount(tot)))];
    };
    const ok = round2(assets) === round2(liabilities + equity);
    exportRows.push([{ text: 'Total liabilities and equity' }, { text: amount(liabilities + equity) }]);
    body = [
      h('div', { class: 'table-wrap' }, h('table', { class: 'report report-narrow' }, h('tbody', {},
        block('Assets', 'asset', null, assets),
        block('Liabilities', 'liability', null, liabilities),
        block('Equity', 'equity', [`Profit for the year to date (since ${fmtDate(bs.fy_start)})`, bs.current_year_profit], equity),
        h('tr', { class: 'grand-row' }, h('td', {}, 'Total liabilities and equity'), h('td', { class: 'num' }, amount(liabilities + equity)))))),
      h('p', { class: ok ? 'muted' : 'form-error' }, ok ? 'Assets equal liabilities plus equity ✓' : `Difference of ${money(Math.abs(assets - liabilities - equity))}`)];
  }
  return layout('finance-reports',
    pageHead('Reports', null, exportButtons(`${title.replace(/ /g, '-')}-${report === 'bs' ? to : from + '-to-' + to}`, title, subtitle, header, exportRows, numCols)),
    tabs, dates,
    h('section', { class: 'card' }, h('h2', {}, title), h('p', { class: 'muted' }, subtitle), body));
}

// ---------- users (admin) ----------

function userDialog(u, refresh) {
  const isSelf = u.id === state.user.id;
  const dlg = openDialog(`Edit ${u.name}`, handleForm(h('form', { class: 'form' },
    h('p', { class: 'muted' }, u.email),
    field('Name', input('name', u.name, { required: true, maxlength: 100 })),
    field('Role', select('role', u.role, ROLE_OPTIONS, { disabled: isSelf }),
      { hint: 'Employees only see HR (their attendance, leave, payslips). Team members use the whole ERP. Managers also assign tasks, approve leave and see everyone\'s HR records. Administrators also manage users.' }),
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
      else if (publicPages[path]) { location.hash = isEmployee() ? '#/hr' : '#/'; return; }
      else if (isEmployee() && !path.startsWith('/hr') && path !== '/account') { location.hash = '#/hr'; return; }
      else if (path === '/hr') view = await viewMyHr();
      else if (path === '/hr/attendance') view = await viewAttendance(params);
      else if (path === '/hr/leave') view = await viewLeave(params);
      else if (path === '/hr/payslips') view = await viewPayslips(params);
      else if ((m = path.match(/^\/hr\/payslips\/(\d+)$/))) view = await viewPayslip(Number(m[1]));
      else if (path === '/hr/people') view = await viewPeople();
      else if ((m = path.match(/^\/hr\/people\/(me|[0-9a-f-]{36})$/))) view = await viewPerson(m[1]);
      else if ((m = path.match(/^\/hr\/people\/([0-9a-f-]{36})\/edit$/))) view = await viewPersonEdit(m[1]);
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
      else if (path === '/payments') view = await viewPayments(params);
      else if (path.startsWith('/finance') && !isManager()) view = viewNotFound();
      else if (path === '/finance') view = await viewFinance();
      else if (path === '/finance/accounts') view = await viewAccounts();
      else if (path === '/finance/journals') view = await viewJournals(params);
      else if (path === '/finance/journals/new') view = await viewJournalNew(params);
      else if ((m = path.match(/^\/finance\/journals\/(\d+)$/))) view = await viewJournal(Number(m[1]));
      else if ((m = path.match(/^\/finance\/ledger\/(\d+)$/))) view = await viewLedger(Number(m[1]), params);
      else if (path === '/finance/bank') view = await viewBank();
      else if (path === '/finance/reports') view = await viewReports(params);
      else if (path === '/renewals') view = await viewRenewals(params);
      else if (path === '/renewals/new') view = await viewRenewalNew(params);
      else if ((m = path.match(/^\/renewals\/(\d+)$/))) view = await viewRenewal(Number(m[1]));
      else if ((m = path.match(/^\/renewals\/(\d+)\/edit$/))) view = await viewRenewalEdit(Number(m[1]));
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
