import { useMemo, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import { Card, Button } from '../components/ui';

// In-campaign roster (/campaigns/:campaignId/team). Surfaces CampaignAssignment — the
// per-campaign roster that GATES mobile visibility — so admins can add/remove the org
// members who canvass THIS campaign, in context. Reuses the existing
// /admin/campaigns/:id/assignments endpoints (same as the org-level Assignments modal).
export default function CampaignTeamPage() {
  const { campaignId } = useParams();
  const qc = useQueryClient();
  const { selected, isLoading: campaignLoading } = useCampaignSelection(campaignId);
  const [search, setSearch] = useState('');

  const membersQ = useQuery({ queryKey: ['memberships'], queryFn: () => api('/admin/memberships') });
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/assignments`),
    enabled: !!campaignId,
  });

  const assignMut = useMutation({
    mutationFn: (userIds) => api(`/admin/campaigns/${campaignId}/assignments`, { method: 'POST', body: { userIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] }),
  });
  const unassignMut = useMutation({
    mutationFn: (userId) => api(`/admin/campaigns/${campaignId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] }),
  });

  const assignedSet = useMemo(
    () => new Set((assignmentsQ.data?.assignments || []).map((a) => a.userId)),
    [assignmentsQ.data]
  );
  const members = (membersQ.data?.members || []).filter((m) => m.user.isActive && m.isActive);
  const filtered = members.filter((m) => {
    if (!search.trim()) return true;
    return `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  const usersReturn = `/users?return=${encodeURIComponent(`/campaigns/${campaignId}/team`)}`;

  if (!campaignLoading && !selected) return <Navigate to="/campaigns" replace />;

  function toggle(userId) {
    if (assignedSet.has(userId)) unassignMut.mutate(userId);
    else assignMut.mutate([userId]);
  }
  function addAllVisible() {
    const ids = filtered.map((m) => m.user.id).filter((id) => !assignedSet.has(id));
    if (ids.length) assignMut.mutate(ids);
  }
  const busy = assignMut.isPending || unassignMut.isPending;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-fg">Team</h1>
      <p className="mb-5 text-sm text-fg-muted">
        The canvassers on <span className="font-medium text-fg">{selected?.name || 'this campaign'}</span>
        {assignedSet.size > 0 && <> · {assignedSet.size} assigned</>}. Only people on this list see the campaign
        in the mobile app — and assigning someone a book adds them here automatically.
      </p>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search org members…"
            className="min-w-0 flex-1 rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <Button variant="secondary" size="sm" onClick={addAllVisible} disabled={busy}>Add all visible</Button>
          <Link
            to={usersReturn}
            className="rounded-md border border-border-strong bg-card px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-sunken"
          >
            Create a new member →
          </Link>
        </div>

        {membersQ.isLoading || assignmentsQ.isLoading ? (
          <div className="py-8 text-center text-sm text-fg-muted">Loading…</div>
        ) : !members.length ? (
          <div className="rounded border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
            No members in this org yet.{' '}
            <Link to={usersReturn} className="font-medium text-brand-accent hover:underline">Add one on Users →</Link>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {filtered.map((m) => {
              const u = m.user;
              const assigned = assignedSet.has(u.id);
              return (
                <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-fg">{u.firstName} {u.lastName}</span>
                      {m.role === 'admin' && (
                        <span className="rounded bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">admin</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-fg-muted">{u.email}</div>
                  </div>
                  <button
                    onClick={() => toggle(u.id)}
                    disabled={busy}
                    className={
                      assigned
                        ? 'shrink-0 rounded-md border border-danger/30 bg-danger-tint px-3 py-1 text-xs font-semibold text-danger disabled:opacity-50'
                        : 'shrink-0 rounded-md border border-brand-accent/30 bg-brand-tint px-3 py-1 text-xs font-semibold text-brand-accent disabled:opacity-50'
                    }
                  >
                    {assigned ? 'Remove' : 'Add'}
                  </button>
                </li>
              );
            })}
            {!filtered.length && <li className="px-3 py-3 text-center text-sm text-fg-muted">No matches.</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}
