import crypto from 'node:crypto';
import { User } from '../../models/User.js';

// Token lifetimes for the emailed links. A password reset is deliberately short (an hour); an invite /
// set-password link is 72h — the SAME window as TEMP_PASSWORD_TTL_HOURS in routes/auth.js, so an
// emailed set-password link and an admin-issued temporary password expire on the same clock.
export const RESET_TOKEN_HOURS = 1;
export const INVITE_TOKEN_HOURS = 72;

// Web origin the emailed links point at. Same mechanism and fallback as app.js (the API-host redirect):
// WEB_ORIGIN, or the production default when unset.
function webOrigin() {
  return process.env.WEB_ORIGIN || 'https://doorline.app';
}

/** sha256 hex of a raw token. Exported: the reset endpoint hashes the URL token to look the row up. */
export function sha256Hex(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/**
 * Issue a single-use reset / set-password token for a user. The RAW token goes into the email link
 * ONLY; we persist just its sha256 hash + expiry on the User, so a leaked DB row can't be replayed as a
 * working link. Reuses User.passwordResetToken / passwordResetExpiresAt (already on the schema).
 * Returns { rawToken, url }.
 */
export async function issuePasswordResetToken(userId, { hours = RESET_TOKEN_HOURS } = {}) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await User.updateOne(
    { _id: userId },
    { $set: { passwordResetToken: tokenHash, passwordResetExpiresAt: expiresAt } }
  );
  return { rawToken, url: resetPasswordUrl(rawToken) };
}

/** The web page that consumes the raw token. */
export function resetPasswordUrl(rawToken) {
  return `${webOrigin()}/reset-password/${rawToken}`;
}
