import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { isConsoleRole } from '../lib/roles.js';

// The ORG-level gate. It wraps <Layout/>, so it may only ever REDIRECT — never render a
// message in Layout's place. That was the dead end: a Forbidden <div> here nuked the
// sidebar, the org switcher and Sign out, leaving no way out but clearing site data.
// Role-level checks that SHOULD show a message now live in RoleGate, inside Layout.
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
    return <Navigate to="/login" state={{ from: location }} replace />;
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
