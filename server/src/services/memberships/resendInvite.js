import { User } from '../../models/User.js';
import { sendMail } from '../mail/mailer.js';
import { inviteSetPassword } from '../mail/templates.js';
import { issuePasswordResetToken, INVITE_TOKEN_HOURS } from '../auth/passwordReset.js';

// Re-send the set-password invite. ONE implementation, shared by the two routes that can trigger it:
//
//   POST /admin/memberships/:userId/resend-invite         — an org admin or lead, inside their org
//   POST /super-admin/users/:userId/resend-invite          — Doorline staff, into any org
//
// They differ only in who is allowed to ask and how the org is chosen; what actually happens must be
// identical. Invites were already a one-shot sent at account creation, and the whole reason this
// exists is that a SECOND invite path drifting from the first is the failure mode worth designing
// out — so the send lives here and neither route reimplements it.
//
// Callers do their own authorization and their own 404s. This function assumes the user, membership
// and org have already been loaded and matched.

// Long enough to swallow a double-click and an impatient re-click, short enough not to obstruct
// "wrong person — fix it and send again".
export const INVITE_COOLDOWN_MS = 60 * 1000;

export class ResendInviteError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Has an invite been minted for this user within the cooldown?
 *
 * Deliberately measured off the TOKEN, not off EmailLog. The obvious implementation — "was an
 * inviteSetPassword row written in the last minute" — races the very thing it is meant to stop:
 * recordEmail() is fire-and-forget inside sendMail (it calls EmailLog.create() and only attaches a
 * .catch), so two clicks 200ms apart can both read an empty EmailLog and both send.
 * issuePasswordResetToken's write IS awaited, so passwordResetExpiresAt is exact.
 *
 * An invite mints a 72h token and a forgot-password reset mints a 1h one, so "expiry still within a
 * minute of the full invite window" identifies a just-issued INVITE with no ambiguity.
 *
 * Accepted caveat: this throttles on MINT rather than on delivery, so a send that failed still starts
 * the cooldown. That is the safer direction — the mint is what kills the recipient's existing link,
 * so it is the half worth rate-limiting.
 */
function invitedWithinCooldown(user) {
  if (!user.passwordResetExpiresAt) return false;
  return (
    user.passwordResetExpiresAt.getTime() >
    Date.now() + INVITE_TOKEN_HOURS * 3600_000 - INVITE_COOLDOWN_MS
  );
}

/**
 * Mint a fresh invite token and email it.
 *
 * @param {object}  user        User doc — needs firstName, email, deletedAt, passwordResetExpiresAt.
 * @param {object}  membership  The target's Membership IN `org`. Only `role` is read.
 * @param {object}  org         Organization doc — needs _id and name.
 * @throws {ResendInviteError}  ACCOUNT_DELETED (409) | INVITE_COOLDOWN (429)
 */
export async function resendInvite({ user, membership, org }) {
  // Deletion must not be undoable by re-inviting someone back to life.
  if (user.deletedAt) {
    throw new ResendInviteError('ACCOUNT_DELETED', 'This account was deleted.', 409);
  }
  if (invitedWithinCooldown(user)) {
    throw new ResendInviteError(
      'INVITE_COOLDOWN',
      'An invite was just sent to this person. Try again in a minute.',
      429
    );
  }

  // Re-minting OVERWRITES User.passwordResetToken — a single field — so any invite or reset link
  // already sitting in their inbox dies right here. That is the intent, and it is why both clients
  // confirm before calling this.
  const { url } = await issuePasswordResetToken(user._id, { hours: INVITE_TOKEN_HOURS });

  // `role` decides app-vs-console copy and MUST come from the membership row: isFieldRole() tests
  // `role === 'canvasser'`, so passing undefined silently renders the console version and a
  // canvasser would get an invite with no app-store links and nothing looking wrong.
  const mail = inviteSetPassword({
    firstName: user.firstName,
    orgName: org.name,
    setPasswordUrl: url,
    role: membership.role,
  });

  // AWAITED, unlike the three create-time sends. Those are fire-and-forget so a mail hiccup can't
  // fail an admin's add; here the send IS the request, so the caller has to learn whether it left.
  const result = await sendMail({
    to: user.email,
    ...mail,
    kind: 'inviteSetPassword',
    meta: { organizationId: org._id, organizationName: org.name, userId: user._id },
  });

  return { sent: !!result?.sent, to: user.email, expiresInHours: INVITE_TOKEN_HOURS };
}

/** The projection both callers need — keep the field list in one place. */
export const RESEND_USER_FIELDS = 'firstName email deletedAt passwordResetExpiresAt lastLoginAt';

/** Load a user for a resend, or null. */
export const loadResendUser = (userId) => User.findById(userId).select(RESEND_USER_FIELDS);
