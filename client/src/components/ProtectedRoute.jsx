import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { isConsoleRole } from '../lib/roles.js';

// The ORG-level gate. It wraps <Layout/>, so it may only ever REDIRECT — never render a
// message in Layout's place. That was the dead end: a Forbidden <div> here nuked the
// sidebar, the org switcher and Sign out, leaving no way out but clearing site data.
// Role-level checks that SHOULD show a message now live in RoleGate, inside Layout.
// The two exceptions render only when there is NO user (so no Layout to nuke), and both have a
// way out: the password prompt at page load, and the "Couldn't reach Doorline" wall.
//
// Props:
//   requireActiveOrg     (default true) — an org must be selected
//   requireConsoleAccess — USER-level: does this user hold an admin/lead role in ANY org?
//   allowPasswordChange  — the one screen a password-owing user may see
// requireOrgAdmin / requireSuperAdmin / requireConsoleUser are GONE — that is RoleGate's job.
export default function ProtectedRoute({
  children,
  requireActiveOrg = true,
  requireConsoleAccess = false,
  allowPasswordChange = false,
}) {
  const {
    user,
    memberships,
    activeOrgId,
    activeMembership,
    isSuperAdmin,
    hasConsoleAccess,
    mustChangePassword,
    loading,
    reauth,
    bootError,
    endedReason,
  } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-fg-muted">
        Loading…
      </div>
    );
  }

  if (!user) {
    // The page opened on a sign-in that ran out: the password prompt (components/ReauthModal.jsx)
    // covers this, and the page loads right here once it is entered — the deep link and the
    // active org are kept.
    if (reauth) return <div className="h-screen bg-sunken" />;
    // The check couldn't reach Doorline. The sign-in is kept; it used to be thrown away, so a
    // server blip at page load signed the browser out.
    if (bootError) {
      return (
        <div className="flex h-screen items-center justify-center bg-sunken px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-fg">Couldn&apos;t reach Doorline.</p>
            <p className="mt-1 text-sm text-fg-muted">Check your connection, then try again.</p>
            <div className="mt-5 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                Try again
              </button>
              <a href="/login" className="text-sm font-semibold text-brand-accent hover:underline">
                Sign in again
              </a>
            </div>
          </div>
        </div>
      );
    }
    return <Navigate to="/login" state={{ from: location, signedOut: endedReason }} replace />;
  }

  // A user owing a password change can only reach the change-password screen.
  if (mustChangePassword && !allowPasswordChange) {
    return <Navigate to="/change-password" state={{ from: location }} replace />;
  }

  // No memberships at all → the picker, which says "ask an admin to add you" + Sign out.
  // Every redirect below is gated on requireActiveOrg / requireConsoleAccess, and the
  // targets (/select-org, /change-password) are mounted with those OFF — so no branch here
  // can fire on them and no redirect loop is possible.
  if (requireActiveOrg && !isSuperAdmin && memberships.length === 0) {
    return <Navigate to="/select-org" state={{ from: location }} replace />;
  }

  // Can't use the console anywhere (a canvasser) → the picker explains why + Sign out.
  if (requireConsoleAccess && !hasConsoleAccess) {
    return <Navigate to="/select-org" state={{ from: location }} replace />;
  }

  if (requireActiveOrg && !activeOrgId) {
    return (
      <Navigate
        to={isSuperAdmin ? '/super-admin' : '/select-org'}
        state={{ from: location }}
        replace
      />
    );
  }

  // ── THE STRUCTURAL FIX ──
  // There IS an active org, but this user has no console role in it. However we got here —
  // a stale localStorage activeOrgId, a role changed under the user mid-session, a
  // hand-typed URL — the answer is the picker, NEVER a Forbidden that replaces the Layout.
  // AuthContext also clears the bad id (its self-heal effect), so this is belt-and-braces;
  // the redirect guarantees correctness even in the render before that effect runs.
  if (requireActiveOrg && !isSuperAdmin && !isConsoleRole(activeMembership?.role)) {
    return <Navigate to="/select-org" state={{ from: location }} replace />;
  }

  return children;
}
