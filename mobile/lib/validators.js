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
