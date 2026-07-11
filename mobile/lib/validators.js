// Shared phone helpers for the mobile app — mirror the web (client/src/lib/validators.js)
// and the server's authoritative Zod validator. The server is the real guard; this makes
// the phone field auto-format and keeps letters out (phone-pad still allows paste).

export function normalizeUsPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : null;
}

export function isValidUsPhone(raw) {
  return normalizeUsPhone(raw) !== null;
}

// As-you-type formatter: "5551234" → "(555) 123-4". Empty in → empty out.
export function formatUsPhoneInput(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Strength rules for USER-CHOSEN passwords (self-service change). Mirror of
// server/src/utils/validators.js and client/src/lib/validators.js — the server is the real
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

// An ADMIN-SET TEMPORARY password (create user / admin reset / create canvasser). No complexity
// rule — a simple temp like "victory26" is fine; the person sets a strong one at first login.
// Mirrors the server's passwordSchema (the real guard): min 8, max 200, no control characters,
// no leading/trailing whitespace (a copy-paste footgun). Returns a problem string, or null.
export const tempPasswordProblem = (pw) => {
  const s = String(pw ?? '');
  if (s.length < PASSWORD_MIN) return `Temporary password must be at least ${PASSWORD_MIN} characters.`;
  if (s.length > 200) return 'Temporary password is too long.';
  if ([...s].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f))
    return 'Temporary password can’t contain control characters.';
  if (s !== s.trim()) return 'Temporary password can’t start or end with a space.';
  return null;
};

export const isValidTempPassword = (pw) => tempPasswordProblem(pw) === null;
