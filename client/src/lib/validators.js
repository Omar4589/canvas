// Shared client-side input helpers. These mirror the server's authoritative Zod
// validators (server/src/utils/validators.js) — the server is the real guard; these
// are for good UX (auto-format, block bad input, live feedback). Plain JS, no deps.

// Reduce free-form input to its 10 US digits, or null if it isn't a US phone number.
export function normalizeUsPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : null;
}

export function isValidUsPhone(raw) {
  return normalizeUsPhone(raw) !== null;
}

// As-you-type formatter: keeps only digits (dropping a leading US "1"), caps at 10, and
// formats progressively — "5551234" → "(555) 123-4". Empty in → empty out.
export function formatUsPhoneInput(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(raw) {
  return EMAIL_RE.test(String(raw ?? '').trim());
}

// Strength rules for USER-CHOSEN passwords (self-service change). Mirror of
// server/src/utils/validators.js and mobile/lib/validators.js — the server is the real
// guard; these drive the live requirements checklist. Admin-set temp passwords stay min-8.
export const PASSWORD_MIN = 8;
export const PASSWORD_RULES = [
  { key: 'length', label: 'At least 8 characters', test: (p) => p.length >= PASSWORD_MIN },
  { key: 'upper', label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { key: 'number', label: 'A number', test: (p) => /[0-9]/.test(p) },
  { key: 'special', label: 'A special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export const passwordChecklist = (pw) =>
  PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, ok: r.test(String(pw ?? '')) }));

export const isStrongPassword = (pw) => PASSWORD_RULES.every((r) => r.test(String(pw ?? '')));

export const passwordProblem = (pw) => {
  const miss = PASSWORD_RULES.filter((r) => !r.test(String(pw ?? '')));
  return miss.length ? `Password needs: ${miss.map((r) => r.label.toLowerCase()).join(', ')}.` : null;
};

// The 50 states + DC, for the campaign State picker. { value: 2-letter, label }.
export const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' }, { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' }, { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' }, { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' }, { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' }, { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' }, { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' }, { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];
