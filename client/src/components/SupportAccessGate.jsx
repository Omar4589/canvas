import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext.jsx';
import StartSupportSessionForm from './StartSupportSessionForm.jsx';

// The handle on the lock.
//
// Platform staff can no longer enter a customer organization they hold no membership in without a
// support access grant: time-boxed, carrying a typed reason, and with every request that touches
// voter data written to the audit log. That gate is correct — but the first cut of it shipped with NO WAY TO
// OBTAIN A GRANT from the product. The org switcher still listed every customer, and each one dead-ended
// in a 403 whose message told the operator to start a session with a reason, while the app offered no
// means to do so. A Retry button that can never succeed.
//
// This is that means. It listens for the `doorline:support-access-required` event that api/client.js
// broadcasts on the 403 — from ANY query on ANY screen, which is why it lives once at the layout level
// rather than as a hook each page has to remember to add.
//
// The form itself (reason/kind/hours + the logged-against-your-name warning) lives in
// StartSupportSessionForm.jsx, shared with the Support access page's deliberate "Start a session"
// flow. This component owns what is specific to the 403 path: the modal, and what declining means.
export default function SupportAccessGate() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { switchOrg } = useAuth();
  const [org, setOrg] = useState(null); // { organizationId, organizationName } | null

  useEffect(() => {
    function onRequired(e) {
      // Don't stack modals if several queries 403 at once — the first one wins.
      setOrg((cur) => cur || e.detail);
    }
    window.addEventListener('doorline:support-access-required', onRequired);
    return () => window.removeEventListener('doorline:support-access-required', onRequired);
  }, []);

  useEffect(() => {
    if (!org) return;
    function onKey(e) {
      if (e.key === 'Escape') decline();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [org]);

  // Backing out has to actually take you OUT of the organization.
  //
  // Merely hiding the modal is a trap: the page behind it is still scoped to an org you cannot read,
  // every query on it is still 403ing, and each 403 re-fires the event that opened this — so the modal
  // reappears the instant you dismiss it. And because the backdrop covers the sidebar, the org switcher
  // is unreachable while it is up. Cancel became a button that does nothing, with no way out but editing
  // the URL. (Found in production verification, right after ending a session and clicking Voters.)
  //
  // So declining does what declining means: drop the org context and go back to the platform view. Same
  // path the switcher's "🌐 Platform view" takes. You said no, so you are no longer in the customer's
  // organization — which is also the honest state to be in.
  function decline() {
    setOrg(null);
    switchOrg(null);
    // Drop the org-scoped cache but KEEP the platform org list, or the switcher blanks and refetches
    // on the way out. Same predicate OrgSwitcher.resetOrgScopedCache uses.
    qc.removeQueries({
      predicate: (q) => !(q.queryKey?.[0] === 'super-admin' && q.queryKey?.[1] === 'organizations'),
    });
    navigate('/super-admin', { replace: true });
  }

  if (!org) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-fg">
          Start a support session in {org.organizationName}
        </h2>
        <StartSupportSessionForm
          organizationId={org.organizationId}
          organizationName={org.organizationName}
          cancelLabel={"Don't go in"}
          onCancel={decline}
          onStarted={() => {
            setOrg(null);
            // Every panel on screen 403'd. Refetch them all now that the door is open.
            qc.invalidateQueries();
          }}
        />
      </div>
    </div>
  );
}
