import crypto from 'node:crypto';

// Seal/open small secrets for storage in Mongo.
//
// Two kinds of value use it. A bearer credential for ANOTHER system, held
// per-organization (an org's FbTime Partner API key), and — since the client
// report links plan (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §B) — a client link's
// password, kept so the campaign's admins and leads can see it again
// (services/reports/shareLinks.js sealLinkPassword / openLinkPassword). Neither
// is ever looked up by value; each is only decrypted at the moment of use, so it
// can — and therefore must — sit encrypted at rest. It is deliberately NOT the
// pattern used by ReportShareLink.token — that token is a capability WE mint and
// must look up by value, so it has to be stored readable and unique-indexed. The
// difference a Mongo snapshot leak makes: useless ciphertext instead of a working
// credential, and the key lives at a different company from the database.
//
// AES-256-GCM with a single master key from CREDENTIAL_SEAL_KEY (32 bytes,
// base64), a fresh random 12-byte IV per seal, and the GCM tag stored alongside
// so tampering fails loudly at open. Optional associated data (`aad`) binds a
// sealed value to what it belongs to — a link password is sealed with
// `report-link:<its bcrypt hash>`, so a copy left behind when the hash changed,
// or a value sealed for anything else, never opens as that link's password. The
// associated data isn't stored: the opener must name it again. An empty one
// equals none, so FbTime's single-argument seals and opens are exactly what they
// were, and the `v1:` format is unchanged. Never replace the key: every sealed
// FbTime key and every kept link password would stop opening.
//
// Absent (or malformed) key: the FbTime integration is dormant, not broken —
// connect routes answer 503 "not configured" and the sync loop no-ops, the
// mailer's dormant-switch posture (services/mail/mailer.js) — and link passwords
// are not kept: links still work, but their passwords can't be shown again.

const VERSION = 'v1';

const masterKey = () => {
  const raw = process.env.CREDENTIAL_SEAL_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  // A truncated key must fail here, at config time, not as a garbage decrypt
  // that reads like a revoked credential.
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_SEAL_KEY must be 32 bytes, base64-encoded');
  }
  return key;
};

export const sealedSecretConfigured = () => {
  try {
    return masterKey() !== null;
  } catch {
    return false;
  }
};

// The associated data, when there is any (an empty one equals none — GCM computes the same tag).
const aadOf = (aad) => (aad == null || aad === '' ? null : Buffer.from(String(aad), 'utf8'));

export const sealSecret = (plaintext, aad = null) => {
  const key = masterKey();
  if (!key) throw new Error('CREDENTIAL_SEAL_KEY is not configured');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const bound = aadOf(aad);
  if (bound) cipher.setAAD(bound);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
};

// Throws on anything that doesn't open — never with the secret in the message, but callers of a value
// a person can see (link passwords) still catch it and answer a reason, never the error: the error
// handler sends err.message back in production (middleware/error.js).
export const openSecret = (sealed, aad = null) => {
  const key = masterKey();
  if (!key) throw new Error('CREDENTIAL_SEAL_KEY is not configured');

  const [version, ivB64, tagB64, ctB64] = String(sealed || '').split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Sealed secret is malformed');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  const bound = aadOf(aad);
  if (bound) decipher.setAAD(bound);
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  // Throws on tamper or wrong key — the desired failure mode. Callers treat it
  // as "connection needs re-linking", never as an empty key.
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8'
  );
};
