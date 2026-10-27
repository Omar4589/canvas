import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

export default function CampaignAssignmentsModal({ campaign, onClose }) {
  const qc = useQueryClient();
  const { isOrgAdmin, user } = useAuth();
  const [search, setSearch] = useState('');

  // This modal opens from the Campaigns page's UNGATED ⋮ action list, so a team lead reaches it too.
  // It lists the campaign's own team (its roster) and takes people OFF it. Putting people ON a campaign
  // is the Team page's Add people (docs/PROPOSAL_PEOPLE_PAGES.md §E.6) — by email, or for an org admin
  // from the organization, with the crew chosen and its door check — so this window's old Assign
  // buttons became a link there: an Assign here couldn't pick a crew or say what a returning person's
  // earlier doors would do.
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', campaign._id],
    queryFn: ({ signal }) => api(`/admin/campaigns/${campaign._id}/assignments`, { signal }),
  });

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unassignMut = useMutation({
    mutationFn: (userId) =>
      api(`/admin/campaigns/${campaign._id}/assignments/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaign._id] });
      // A lead's Team page reads the crew endpoint too; without this the removed person stays listed.
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaign._id] });
      qc.invalidateQueries({ queryKey: ['memberships'] });
      qc.invalidateQueries({ queryKey: ['turf-assignments'] });
      qc.invalidateQueries({ queryKey: ['turfs'] });
    },
  });

  const team = useMemo(
    () =>
      [...(assignmentsQ.data?.assignments || [])].sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      ),
    [assignmentsQ.data]
  );
  const filtered = team.filter((a) => {
    if (!search.trim()) return true;
    return `${a.firstName} ${a.lastName} ${a.email}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  // An archived campaign's roster is frozen (the server answers 409); it still lists who walked it.
  const archived = campaign.isActive === false;
  const addLink = `/campaigns/${campaign._id}/team?add=${isOrgAdmin ? 'org' : 'email'}`;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-overlay/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-fg">Assignments</h2>
            <p className="text-sm text-fg-muted">
              Campaign: <span className="font-medium">{campaign.name}</span>
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              Only people on this campaign’s team see it in the mobile app.
            </p>
            {!archived && (
              <p className="mt-1 text-xs text-fg-muted">
                To add people, use{' '}
                <Link to={addLink} onClick={onClose} className="font-medium text-brand-accent hover:underline">
                  Add people on the Team page
                </Link>
                , where you choose their crew and see what their earlier doors will do.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted"
            aria-label="Close"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="mb-3 flex items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this team…"
              className="flex-1 rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>

          {archived && (
            <p className="mb-3 text-xs text-fg-muted">This campaign is archived, so its team can’t change.</p>
          )}
          {unassignMut.error && <p className="mb-3 text-sm text-danger">{unassignMut.error.message}</p>}

          {assignmentsQ.isLoading ? (
            <div className="py-8 text-center text-sm text-fg-muted">Loading…</div>
          ) : team.length === 0 ? (
            <div className="rounded border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
              No one is on this campaign yet.
            </div>
          ) : (
            <ul className="max-h-80 overflow-auto divide-y divide-border rounded-md border border-border">
              {filtered.map((a) => {
                // The server's rule for a lead (assignments.js, item 41): they take off canvassers, people
                // no longer in the org, and themselves; admins, other leads and staff are an org admin's
                // to remove.
                const isSelf = String(a.userId) === String(user?.id);
                const mayRemove =
                  isOrgAdmin || isSelf || a.status === 'removed' || (a.role === 'canvasser' && !a.isSuperAdmin);
                return (
                  <li key={a.userId} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg">{a.firstName} {a.lastName}</span>
                        {(a.role === 'admin' || a.role === 'lead') && (
                          <span className="rounded bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                            {a.role}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-fg-muted">{a.email}</div>
                    </div>
                    {archived ? null : mayRemove ? (
                      <button
                        onClick={() => unassignMut.mutate(a.userId)}
                        disabled={unassignMut.isPending}
                        className="rounded-md border border-danger/30 bg-danger-tint px-3 py-1 text-xs font-semibold text-danger hover:bg-danger-tint disabled:opacity-50"
                      >
                        Unassign
                      </button>
                    ) : (
                      <span className="text-xs text-fg-subtle">An org admin manages this one</span>
                    )}
                  </li>
                );
              })}
              {!filtered.length && (
                <li className="px-3 py-3 text-center text-sm text-fg-muted">
                  No matches.
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-6 py-3 text-right">
          <button
            onClick={onClose}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-sunken"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
