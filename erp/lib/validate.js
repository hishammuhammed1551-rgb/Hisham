'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9 ()\-]{6,20}$/;
const TRN_RE = /^\d{15}$/; // UAE Tax Registration Number: 15 digits

/**
 * Check `input` against `rules` and return a clean object with only known fields.
 * rule: { type: 'string'|'enum'|'bool'|'int'|'date', required, max, values, format }
 * With partial=true, missing fields are skipped instead of defaulted (for updates).
 */
function clean(input, rules, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Expected a JSON object');
  }
  const out = {};
  const errors = {};

  for (const [field, rule] of Object.entries(rules)) {
    const present = Object.prototype.hasOwnProperty.call(input, field);
    if (!present && partial) continue;
    let value = input[field];

    if (rule.type === 'bool') {
      out[field] = value === true || value === 1 || value === 'true' ? 1 : 0;
      continue;
    }
    if (rule.type === 'int') {
      if (value === undefined || value === null || value === '') {
        if (rule.required) errors[field] = 'Required';
        else out[field] = null;
        continue;
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) errors[field] = 'Invalid';
      else out[field] = n;
      continue;
    }

    value = value === undefined || value === null ? '' : String(value).trim();
    if (value === '') {
      if (rule.required) errors[field] = 'Required';
      else out[field] = rule.default ?? null;
      continue;
    }
    if (rule.max && value.length > rule.max) {
      errors[field] = `Must be ${rule.max} characters or fewer`;
      continue;
    }
    if (rule.type === 'enum' && !rule.values.includes(value)) {
      errors[field] = `Must be one of: ${rule.values.join(', ')}`;
      continue;
    }
    if (rule.type === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)))) {
      errors[field] = 'Use a date like 2026-01-31';
      continue;
    }
    if (rule.format === 'email' && !EMAIL_RE.test(value)) errors[field] = 'Invalid email address';
    else if (rule.format === 'phone' && !PHONE_RE.test(value)) errors[field] = 'Invalid phone number';
    else if (rule.format === 'trn' && !TRN_RE.test(value.replace(/[\s-]/g, ''))) errors[field] = 'TRN must be 15 digits';
    else out[field] = rule.format === 'trn' ? value.replace(/[\s-]/g, '') : value;
  }

  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', errors);
  return out;
}

const CUSTOMER_RULES = {
  name: { type: 'string', required: true, max: 200 },
  kind: { type: 'enum', values: ['company', 'individual'], default: 'company' },
  status: { type: 'enum', values: ['lead', 'active', 'inactive'], default: 'lead' },
  trn: { type: 'string', format: 'trn' },
  email: { type: 'string', max: 200, format: 'email' },
  phone: { type: 'string', format: 'phone' },
  address: { type: 'string', max: 500 },
  city: { type: 'string', max: 100 },
  country: { type: 'string', max: 100, default: 'United Arab Emirates' },
  source: { type: 'string', max: 100 },
  services: { type: 'string', max: 200 },
  notes: { type: 'string', max: 5000 },
  owner_id: { type: 'int' },
};

const CONTACT_RULES = {
  name: { type: 'string', required: true, max: 200 },
  job_title: { type: 'string', max: 100 },
  email: { type: 'string', max: 200, format: 'email' },
  phone: { type: 'string', format: 'phone' },
  is_primary: { type: 'bool' },
};

const ACTIVITY_RULES = {
  kind: { type: 'enum', required: true, values: ['note', 'call', 'meeting', 'email', 'follow_up'] },
  body: { type: 'string', required: true, max: 5000 },
  due_at: { type: 'date' },
};

const USER_RULES = {
  name: { type: 'string', required: true, max: 100 },
  email: { type: 'string', required: true, max: 200, format: 'email' },
  password: { type: 'string', required: true, max: 200 },
  role: { type: 'enum', values: ['admin', 'staff'], default: 'staff' },
};

const USER_UPDATE_RULES = {
  name: { type: 'string', required: true, max: 100 },
  role: { type: 'enum', required: true, values: ['admin', 'staff'] },
  active: { type: 'bool' },
  password: { type: 'string', max: 200 },
};

function checkPasswordStrength(password) {
  if (password.length < 10) {
    throw new HttpError(422, 'Password too short', { password: 'Use at least 10 characters' });
  }
}

module.exports = {
  HttpError,
  clean,
  checkPasswordStrength,
  CUSTOMER_RULES,
  CONTACT_RULES,
  ACTIVITY_RULES,
  USER_RULES,
  USER_UPDATE_RULES,
};
