'use strict';

/* Lowcaps ERP — single-page front end. All user data goes through h()/text nodes, never innerHTML. */

const state = { user: null, users: [] };
const app = document.getElementById('app');

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
  // SQLite datetimes are UTC without a zone; plain dates are calendar days.
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(isDay ? value + 'T00:00:00' : value.replace(' ', 'T') + 'Z');
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
  constructor(status, data) {
    super(data.error || `Request failed (${status})`);
    this.status = status;
    this.details = data.details || {};
  }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : {};
  if (res.status === 401 && !['/api/me', '/api/login', '/api/me/password'].includes(url)) {
    state.user = null;
    location.hash = '#/login';
    throw new ApiError(401, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
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
  try { await api('POST', '/api/logout', {}); } catch { /* already signed out */ }
  state.user = null;
  location.hash = '#/login';
}

// ---------- auth views ----------

function authCard(title, intro, form) {
  return h('div', { class: 'auth' },
    h('div', { class: 'card' },
      h('div', { class: 'brand' }, h('span', { class: 'logo-mark' }, 'L'), h('span', {}, 'Lowcaps', h('small', {}, 'ERP'))),
      h('h1', {}, title),
      intro && h('p', { class: 'muted' }, intro),
      form));
}

function viewLogin() {
  const form = handleForm(h('form', { class: 'form' },
    field('Email', input('email', '', { type: 'email', autocomplete: 'username', required: true, autofocus: true })),
    field('Password', input('password', '', { type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in')),
  async data => {
    const { user } = await api('POST', '/api/login', data);
    state.user = user;
    location.hash = '#/';
  });
  return authCard('Sign in', 'Use the account your administrator created for you.', form);
}

function viewSetup() {
  const form = handleForm(h('form', { class: 'form' },
    field('Your name', input('name', '', { required: true, autocomplete: 'name', autofocus: true })),
    field('Email', input('email', '', { type: 'email', required: true, autocomplete: 'username' })),
    field('Password', input('password', '', { type: 'password', required: true, autocomplete: 'new-password', minlength: 10 }),
      { hint: 'At least 10 characters.' }),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create admin account')),
  async data => {
    const { user } = await api('POST', '/api/setup', data);
    state.user = user;
    toast('Welcome! Your admin account is ready.');
    location.hash = '#/';
  });
  return authCard('Set up Lowcaps ERP', 'Create the first administrator account. You can add your team afterwards.', form);
}

// ---------- dashboard ----------

async function viewDashboard() {
  const d = await api('GET', '/api/dashboard');
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
  state.users = (await api('GET', '/api/users')).users;
}

async function viewCustomers(params) {
  await loadUsers();
  const query = new URLSearchParams(params);
  const data = await api('GET', '/api/customers?' + query);

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

  const filters = h('div', { class: 'filters' },
    search,
    select('status', query.get('status'), [['', 'All statuses'], ['lead', 'Leads'], ['active', 'Active'], ['inactive', 'Inactive']],
      { 'aria-label': 'Status', onchange: e => setParam('status', e.target.value) }),
    select('owner', query.get('owner'), ownerOptions, { 'aria-label': 'Owner', onchange: e => setParam('owner', e.target.value) }),
    select('sort', query.get('sort') || 'name', [['name', 'Sort: Name'], ['newest', 'Sort: Newest'], ['updated', 'Sort: Recently updated']],
      { 'aria-label': 'Sort', onchange: e => setParam('sort', e.target.value === 'name' ? '' : e.target.value) }));

  const exportQuery = new URLSearchParams(query);
  exportQuery.delete('page');

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
      h('a', { class: 'btn btn-secondary', href: '/api/customers/export?' + exportQuery, download: true }, 'Export CSV'),
      h('a', { class: 'btn btn-primary', href: '#/customers/new' }, '+ New customer'),
    ]),
    h('section', { class: 'card' },
      filters,
      table,
      data.total > data.pageSize && h('div', { class: 'pager' },
        h('span', { class: 'muted' }, `Showing ${from}–${to} of ${data.total}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page <= 1, onclick: () => setParam('page', data.page - 1) }, 'Previous'),
          h('button', { class: 'btn btn-secondary btn-sm', disabled: data.page >= pages, onclick: () => setParam('page', data.page + 1) }, 'Next')))));
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
      const { id } = await api('POST', '/api/customers', data);
      toast('Customer created');
      location.hash = `#/customers/${id}`;
    })));
}

async function viewCustomerEdit(id) {
  await loadUsers();
  const { customer: c } = await api('GET', `/api/customers/${id}`);
  return layout('customers',
    pageHead(`Edit ${c.name}`, null, null, h('a', { href: `#/customers/${id}` }, `← ${c.name}`)),
    h('section', { class: 'card' }, customerForm(c, async data => {
      await api('PUT', `/api/customers/${id}`, data);
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
    if (contact) await api('PUT', `/api/contacts/${contact.id}`, data);
    else await api('POST', `/api/customers/${customerId}/contacts`, data);
    dlg.close();
    toast(contact ? 'Contact saved' : 'Contact added');
    refresh();
  }));
}

async function viewCustomer(id) {
  const { customer: c, today } = await api('GET', `/api/customers/${id}`);
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
                await api('DELETE', `/api/contacts/${k.id}`).catch(e => toast(e.message, true));
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
    await api('POST', `/api/customers/${id}/activities`, { ...data, kind });
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
            await api('PATCH', `/api/activities/${a.id}`, { done: !a.done }).catch(e => toast(e.message, true));
            refresh();
          },
        }, a.done ? 'Reopen' : 'Mark done'),
        (isAdmin || a.user_id === state.user.id) && h('button', {
          class: 'btn btn-danger btn-sm', 'aria-label': 'Delete entry',
          onclick: async () => {
            if (!confirmAction('Delete this entry?')) return;
            await api('DELETE', `/api/activities/${a.id}`).catch(e => toast(e.message, true));
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
            await api('DELETE', `/api/customers/${id}`);
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

function userDialog(user, refresh) {
  const u = user || {};
  const fields = user
    ? [
        field('Name', input('name', u.name, { required: true })),
        field('Role', select('role', u.role, [['staff', 'Staff'], ['admin', 'Administrator']])),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: !!u.active }), 'Account active (can sign in)'),
        field('New password', input('password', '', { type: 'password', autocomplete: 'new-password' }),
          { hint: 'Leave blank to keep the current password. Changing it signs the user out everywhere.' }),
      ]
    : [
        field('Name', input('name', '', { required: true })),
        field('Email', input('email', '', { type: 'email', required: true })),
        field('Role', select('role', 'staff', [['staff', 'Staff'], ['admin', 'Administrator']]),
          { hint: 'Administrators can manage users and delete customers.' }),
        field('Temporary password', input('password', '', { type: 'password', required: true, autocomplete: 'new-password', minlength: 10 }),
          { hint: 'At least 10 characters. Ask them to change it under Account.' }),
      ];
  const dlg = openDialog(user ? `Edit ${u.name}` : 'Add user', handleForm(h('form', { class: 'form' },
    ...fields,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, user ? 'Save' : 'Add user'),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))),
  async data => {
    if (user) await api('PUT', `/api/users/${u.id}`, data);
    else await api('POST', '/api/users', data);
    dlg.close();
    toast(user ? 'User saved' : 'User added');
    refresh();
  }));
}

async function viewUsers() {
  if (state.user.role !== 'admin') return viewNotFound();
  await loadUsers();
  const refresh = () => render();
  return layout('users',
    pageHead('Users', 'Staff who can sign in to the ERP.',
      h('button', { class: 'btn btn-primary', onclick: () => userDialog(null, refresh) }, '+ Add user')),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, state.users.map(u => h('tr', {},
        h('td', {}, h('strong', {}, u.name), u.id === state.user.id && h('span', { class: 'muted' }, ' (you)')),
        h('td', {}, u.email),
        h('td', {}, u.role === 'admin' ? 'Administrator' : 'Staff'),
        h('td', {}, u.active ? h('span', { class: 'badge badge-active' }, 'Active') : h('span', { class: 'badge badge-inactive' }, 'Deactivated')),
        h('td', {}, h('button', { class: 'btn btn-secondary btn-sm', onclick: () => userDialog(u, refresh) }, 'Edit')))))))));
}

// ---------- account ----------

function viewAccount() {
  const form = handleForm(h('form', { class: 'form narrow' },
    field('Current password', input('current', '', { type: 'password', required: true, autocomplete: 'current-password' })),
    field('New password', input('password', '', { type: 'password', required: true, autocomplete: 'new-password', minlength: 10 }),
      { hint: 'At least 10 characters.' }),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Change password'))),
  async data => {
    await api('PUT', '/api/me/password', data);
    form.reset();
    toast('Password changed');
  });
  return layout(null,
    pageHead('Account', `${state.user.name} · ${state.user.email}`),
    h('section', { class: 'card' }, h('h2', {}, 'Change password'), form));
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
    if (!state.user) {
      try { state.user = (await api('GET', '/api/me')).user; } catch { /* not signed in */ }
    }
    let view;
    if (!state.user) {
      const { needsSetup } = await api('GET', '/api/setup');
      view = needsSetup ? viewSetup() : viewLogin();
      if (needsSetup && path !== '/setup') history.replaceState(null, '', '#/setup');
      else if (!needsSetup && path !== '/login') history.replaceState(null, '', '#/login');
    } else {
      let m;
      if (path === '/login' || path === '/setup') { location.hash = '#/'; return; }
      if (path === '/') view = await viewDashboard();
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
    if (seq !== renderSeq || err.status === 401) return;
    if (err.status === 404 && state.user) {
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
render();
