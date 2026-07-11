import { z } from 'zod';
import { STATE_TZ } from './usStateTimeZone.js';

// Shared input validators — one definition, reused across routes so every field is
// validated the same way everywhere (and phone/name/state aren't re-defined per route).

// The canonical set of valid 2-letter US states (50 + DC), reused from the timezone map.
export const US_STATES = new Set(Object.keys(STATE_TZ));

// Reduce free-form input to its 10 US digits, or null if it isn't a US phone number.
// Accepts an optional leading country code 1.
export function normalizeUsPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : null;
}

// Format 10 digits as (555) 123-4567. Expects exactly 10 digits.
export function formatUsPhone(tenDigits) {
  return `(${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

// Optional US phone. Absent / empty → undefined. A valid number is stored canonical as
// "(555) 123-4567". Letters or the wrong digit count are rejected.
export const phoneSchema = z.preprocess(
  (v) => {
    if (v == null) return undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
  },
  z
    .string()
    .max(40)
    .refine((v) => normalizeUsPhone(v) !== null, {
      message: 'Enter a valid US phone number, e.g. (555) 123-4567.',
    })
    .transform((v) => formatUsPhone(normalizeUsPhone(v)))
    .optional()
);

// A required 2-letter US state, uppercased and checked against the real list.
export const usStateSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => US_STATES.has(v), { message: 'Enter a valid 2-letter US state.' });

// A civil date as a 'YYYY-MM-DD' string — compared lexicographically, never Date-parsed.
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use YYYY-MM-DD.' });

// A person's name (given or family). Trimmed, non-empty, bounded.
export const nameSchema = z.string().trim().min(1).max(80);

// A login email. Lowercasing stays in the handlers (some compare against existing values).
export const emailSchema = z.string().trim().email().max(254);

// An admin-set TEMPORARY password (create user / admin reset / create canvasser). Min 8, no
// complexity rule — it's short-lived and the user replaces it at first login, so complexity
// would only add friction. User-CHOSEN passwords use the stronger rules below.
export const passwordSchema = z.string().min(8).max(200);

// Strength rules for USER-CHOSEN passwords (self-service change, incl. the forced change after
// a temp password). Mirrored verbatim in client/src/lib/validators.js and mobile/lib/validators.js
// so the live checklist agrees with the server — the server stays the real guard.
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

// Zod schema for a user-chosen password — enforces the complexity rules with a single,
// human-readable message. (Kept separate from passwordSchema so admin temp passwords stay lax.)
export const strongPasswordSchema = z.string().max(200).superRefine((val, ctx) => {
  const msg = passwordProblem(val);
  if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
});

// An org slug: lowercase kebab-case.
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Use lowercase letters, numbers, and hyphens only.' });
