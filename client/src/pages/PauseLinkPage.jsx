import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { isConsoleRole } from '../lib/roles.js';

// The automatic-pause alert email's link: /pause/:orgId/:campaignId/:pauseId (docs/PROPOSAL_PACE_PAUSE.md
// §F.3). Every id is in the PATH because login and the org picker restore a path, never a query string.
// Mounted with requireActiveOrg={false}, so a reader with no active org yet — a multi-org admin just signed
// in, a super admin — lands here instead of on the picker. It switches the reader into the pause's org when
// they hold a console role there (switching into an org where they are only a canvasser would bounce them
// to the picker), then hands off to the campaign's Audit page, whose panel handles a deleted pause or a lost
// grant itself.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const PauseLinkPage = () => {
  const { orgId, campaignId, pauseId } = useParams();
  const { memberships, activeOrgId, switchOrg } = useAuth();
  const valid = [orgId, campaignId, pauseId].every((id) => OBJECT_ID.test(String(id || '')));
  const member = valid ? memberships.find((m) => m.organizationId === orgId && isConsoleRole(m.role)) : null;

  useEffect(() => {
    if (member && activeOrgId !== orgId) switchOrg(orgId);
  }, [member, activeOrgId, orgId, switchOrg]);

  if (!member) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sunken px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-fg">You don&apos;t have access to this organization.</p>
          <p className="mt-1 text-sm text-fg-muted">
            This link opens an automatic pause for the admins and team leads of the organization it came from.
          </p>
          <a href="/" className="mt-5 inline-block text-sm font-semibold text-brand-accent hover:underline">
            Go to Doorline
          </a>
        </div>
      </div>
    );
  }
  if (activeOrgId !== orgId) {
    return <div className="flex min-h-screen items-center justify-center text-fg-muted">Opening the pause…</div>;
  }
  return <Navigate to={`/campaigns/${campaignId}/audit/pauses/${pauseId}`} replace />;
};

export default PauseLinkPage;
