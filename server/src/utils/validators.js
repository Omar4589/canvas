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

// A person's name (given or family). Trimmed, non-empty, bounded.
export const nameSchema = z.string().trim().min(1).max(80);

// A login email. Lowercasing stays in the handlers (some compare against existing values).
export const emailSchema = z.string().trim().email().max(254);

// A password (admin-set temporary or user-chosen). Min 8; no complexity rule — these are
// temporary passwords the user replaces at first login, so complexity would only add friction.
export const passwordSchema = z.string().min(8).max(200);

// An org slug: lowercase kebab-case.
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Use lowercase letters, numbers, and hyphens only.' });
