import crypto from 'node:crypto';

// Seal/open small secrets (third-party API keys) for storage in Mongo.
//
// This exists for exactly one kind of value: a bearer credential for ANOTHER
// system, held per-organization (today: an org's FbTime Partner API key). It is
// deliberately NOT the pattern used by ReportShareLink.token — that token is a
// capability WE mint and must look up by value, so it has to be stored readable
// and unique-indexed. A third-party key is never looked up by value; it is only
// ever decrypted at the moment of use, so it can — and therefore must — sit
// encrypted at rest. The difference a Mongo snapshot leak makes: useless
// ciphertext instead of a working credential into another system's PII.
//
// AES-256-GCM with a single master key from CREDENTIAL_SEAL_KEY (32 bytes,
// base64), a fresh random 12-byte IV per seal, and the GCM tag stored alongside
// so tampering fails loudly at open. Named generically because a second
// integration should reuse this, not grow a sibling.
//
// Absent key = the integration is dormant, not broken: connect routes answer
// 503 "not configured" and the sync loop no-ops — the mailer's dormant-switch
// posture (services/mail/mailer.js), so the feature can merge before the env
// var exists anywhere.

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

export const sealSecret = (plaintext) => {
  const key = masterKey();
  if (!key) throw new Error('CREDENTIAL_SEAL_KEY is not configured');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
};

export const openSecret = (sealed) => {
  const key = masterKey();
  if (!key) throw new Error('CREDENTIAL_SEAL_KEY is not configured');

  const [version, ivB64, tagB64, ctB64] = String(sealed || '').split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Sealed secret is malformed');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  // Throws on tamper or wrong key — the desired failure mode. Callers treat it
  // as "connection needs re-linking", never as an empty key.
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8'
  );
};
