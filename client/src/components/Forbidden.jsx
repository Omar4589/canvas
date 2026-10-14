import { useNavigate } from 'react-router-dom';
import { useAuth, useSignOut } from '../auth/AuthContext.jsx';
import { homeLinkLabel } from '../lib/homePath.js';
import { Button, EmptyState } from './ui/index.js';
import { consoleMemberships } from '../lib/roles.js';

// The ONE "you can't open this page" state, replacing four inline
// <div className="p-8 text-danger">Forbidden…</div>s (ProtectedRoute x3 + App.jsx's
// BillingRoute).
//
// It is ALWAYS rendered INSIDE <Layout/> — see RoleGate.jsx and the App.jsx route tree.
// That is the whole point: the old Forbidden div replaced Layout, so it had no sidebar, no
// org switcher, no Sign out and no link — a dead end that survived a reload and could only
// be escaped by clearing site data. Rendered inside the console, the sidebar IS the escape
// hatch and these buttons are just the shortcut.
//
// Never render this in place of Layout. Org-level failures (not signed in, no active org,
// no console role in the active org) belong in ProtectedRoute, which may only REDIRECT.
export default function Forbidden({
  title = "You don't have access to this page",
  hint = null,
}) {
  const navigate = useNavigate();
  const { homePath, memberships, isSuperAdmin, activeMembership } = useAuth();
  const signOut = useSignOut();

  // Offer the switcher only when there is somewhere else to go — and not when the home button
  // already IS the picker (a multi-org user with no org entered), which would be two buttons to one
  // page.
  const canSwitchOrg =
    (isSuperAdmin || consoleMemberships(memberships).length > 1) && homePath !== '/select-org';
  // homePath can be a campaign's root (a team lead with one active campaign), so the label comes
  // from the shared helper rather than a string comparison.
  const homeLabel = homeLinkLabel(homePath);
  const roleLabel = activeMembership?.role === 'lead' ? 'team lead' : activeMembership?.role;

  return (
    <EmptyState
      title={title}
      hint={
        <>
          {hint}
          {activeMembership && (
            <div className="mt-1 text-xs text-fg-subtle">
              You're {roleLabel === 'admin' ? 'an' : 'a'} {roleLabel} in{' '}
              {activeMembership.organizationName}.
            </div>
          )}
        </>
      }
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" onClick={() => navigate(homePath)}>
            {homeLabel}
          </Button>
          {canSwitchOrg && (
            <Button variant="secondary" onClick={() => navigate('/select-org')}>
              Switch organization
            </Button>
          )}
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      }
    />
  );
}
