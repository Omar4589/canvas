import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

const ROLE_LABEL = { admin: 'an admin', canvasser: 'a canvasser' };

/**
 * Notifies a user, in-app, when an admin has added them to an organization.
 * Shows one dismissible bar per not-yet-acknowledged membership (memberships
 * carry `isNew` from the server). Dismissing records acknowledgedAt so it won't
 * reappear. This is how a user finds out they were linked into a new org —
 * there's no email channel.
 */
export default function AddedToOrgBanner() {
  const { memberships, acknowledgeMembership } = useAuth();
  const [dismissing, setDismissing] = useState({});

  const fresh = (memberships || []).filter((m) => m.isNew);
  if (fresh.length === 0) return null;

  async function onDismiss(membershipId) {
    setDismissing((d) => ({ ...d, [membershipId]: true }));
    try {
      await acknowledgeMembership(membershipId);
    } catch {
      setDismissing((d) => ({ ...d, [membershipId]: false }));
    }
  }

  return (
    <div className="mb-4 space-y-2">
      {fresh.map((m) => (
        <div
          key={m.membershipId}
          className="flex items-start justify-between gap-3 rounded-md border border-brand-accent/30 bg-brand-tint px-4 py-3 text-sm text-brand-accent"
        >
          <div>
            You've been added to{' '}
            <span className="font-semibold">{m.organizationName}</span> as{' '}
            <span className="font-semibold">
              {ROLE_LABEL[m.role] || m.role}
            </span>
            .
          </div>
          <button
            type="button"
            onClick={() => onDismiss(m.membershipId)}
            disabled={!!dismissing[m.membershipId]}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand-accent hover:bg-brand-tint disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
