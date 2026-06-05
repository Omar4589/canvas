/**
 * Blocks every protected surface for a user who was issued a temporary password
 * and hasn't chosen a new one yet (User.mustChangePassword === true).
 *
 * Must run AFTER requireAuth (it reads req.user). It is intentionally NOT applied
 * to the /auth router, so a locked-out user can still reach:
 *   - POST /auth/change-password  (to clear the flag)
 *   - GET  /auth/me
 *   - POST /auth/logout
 *
 * requireAuth reloads the user from the DB on every request, so the flag is always
 * fresh — there's no stale-JWT window.
 */
export function blockIfMustChangePassword(req, res, next) {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({
      error: 'You must set a new password before continuing.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
  next();
}
